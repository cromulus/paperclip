#!/usr/bin/env python3
"""Start the bounded SSH executor from root-owned, public-key-only config."""

from __future__ import annotations

import json
import os
import pwd
import base64
import secrets
import re
import stat
import subprocess
import sys
from pathlib import Path


USERNAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,30}$")
AGENT_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
KEY_TYPES = {"ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"}
MIN_UID = 20_000
MAX_UID = 60_000
MAX_CONFIG_BYTES = 1_048_576


class ConfigurationError(RuntimeError):
    pass


def fail(message: str) -> "None":
    raise ConfigurationError(message)


def require_root_owned_private_file(path: Path, *, max_bytes: int) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        fail(f"Required executor configuration is unavailable ({exc.__class__.__name__}).")
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        fail("Executor configuration must be a regular, non-symlink file.")
    if metadata.st_uid != 0 or metadata.st_mode & 0o022:
        fail("Executor configuration must be root-owned and not group/world writable.")
    if metadata.st_size > max_bytes:
        fail("Executor configuration exceeds the configured size limit.")
    return path.read_bytes()


def ensure_root_directory(path: Path, *, mode: int) -> None:
    path.mkdir(parents=True, exist_ok=True)
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        fail("Executor data path must be a real directory.")
    if metadata.st_uid != 0:
        fail("Executor data directory must be root-owned.")
    os.chmod(path, mode)


def parse_accounts(data: bytes) -> list[dict[str, object]]:
    try:
        document = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("Executor account configuration is not valid JSON.")
    if not isinstance(document, dict) or set(document) != {"accounts"}:
        fail("Executor account configuration must contain only an accounts array.")
    accounts = document["accounts"]
    if not isinstance(accounts, list) or not accounts:
        fail("Executor account configuration must contain at least one account.")

    seen_users: set[str] = set()
    seen_uids: set[int] = set()
    seen_agents: set[str] = set()
    normalized: list[dict[str, object]] = []
    for index, account in enumerate(accounts):
        if not isinstance(account, dict) or set(account) != {"agentId", "username", "uid", "publicKeys"}:
            fail(f"Executor account entry {index} has an unsupported shape.")
        agent_id, username, uid, public_keys = (
            account["agentId"], account["username"], account["uid"], account["publicKeys"]
        )
        if not isinstance(agent_id, str) or not AGENT_ID_RE.fullmatch(agent_id):
            fail(f"Executor account entry {index} has an invalid agent ID.")
        if not isinstance(username, str) or not USERNAME_RE.fullmatch(username):
            fail(f"Executor account entry {index} has an invalid username.")
        if not isinstance(uid, int) or isinstance(uid, bool) or not MIN_UID <= uid <= MAX_UID:
            fail(f"Executor account entry {index} has a UID outside the reserved range.")
        if agent_id in seen_agents or username in seen_users or uid in seen_uids:
            fail(f"Executor account entry {index} duplicates an identity.")
        if not isinstance(public_keys, list) or not public_keys:
            fail(f"Executor account entry {index} must include public SSH keys.")
        for key in public_keys:
            if not isinstance(key, str) or "\n" in key or "\r" in key or len(key) > 16_384:
                fail(f"Executor account entry {index} contains an invalid public key line.")
            fields = key.split()
            if len(fields) < 2 or fields[0] not in KEY_TYPES or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", fields[1]):
                fail(f"Executor account entry {index} contains an unsupported public key.")
            try:
                blob = base64.b64decode(fields[1], validate=True)
                key_name_size = int.from_bytes(blob[:4], "big")
                embedded_type = blob[4:4 + key_name_size].decode("ascii")
            except (ValueError, UnicodeDecodeError):
                fail(f"Executor account entry {index} contains an invalid public key blob.")
            if key_name_size == 0 or embedded_type != fields[0] or len(blob) <= 4 + key_name_size:
                fail(f"Executor account entry {index} contains a mismatched public key blob.")
        seen_agents.add(agent_id)
        seen_users.add(username)
        seen_uids.add(uid)
        normalized.append({"agentId": agent_id, "username": username, "uid": uid, "publicKeys": public_keys})
    return normalized


def provision_account(account: dict[str, object], home_root: Path, group_id: int) -> None:
    username = str(account["username"])
    uid = int(account["uid"])
    home = home_root / username
    try:
        current = pwd.getpwnam(username)
    except KeyError:
        current = None
    if current is not None and (current.pw_uid != uid or Path(current.pw_dir) != home or current.pw_gid != group_id):
        fail(f"Configured executor username {username} conflicts with an existing account.")
    try:
        uid_account = pwd.getpwuid(uid)
    except KeyError:
        uid_account = None
    if uid_account is not None and uid_account.pw_name != username:
        fail(f"Configured executor UID {uid} conflicts with an existing account.")
    if current is None:
        subprocess.run(
            ["useradd", "--no-create-home", "--home-dir", str(home), "--shell", "/bin/bash",
             "--uid", str(uid), "--gid", str(group_id), "--no-user-group", username],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # OpenSSH rejects accounts whose shadow password is locked even when
        # public-key authentication is enabled. Install an unpredictable
        # throwaway hash; PasswordAuthentication and keyboard-interactive are
        # disabled in sshd_config, so it can never authenticate over SSH.
        salt = secrets.token_hex(12)
        password_hash = subprocess.run(
            ["openssl", "passwd", "-6", "-salt", salt, "-stdin"],
            input=secrets.token_urlsafe(48) + "\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
        ).stdout.strip()
        subprocess.run(
            ["chpasswd", "-e"],
            input=f"{username}:{password_hash}\n",
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
    if home.exists():
        metadata = home.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            fail(f"Executor home for {username} must be a real directory.")
        if metadata.st_uid != uid or metadata.st_gid != group_id:
            fail(f"Executor home for {username} has unexpected ownership.")
    else:
        home.mkdir(mode=0o700)
        os.chown(home, uid, group_id)
    os.chmod(home, 0o700)

    ssh_dir = home / ".ssh"
    if ssh_dir.exists():
        metadata = ssh_dir.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            fail(f"SSH directory for {username} must be a real directory.")
        if metadata.st_uid != uid or metadata.st_gid != group_id:
            fail(f"SSH directory for {username} has unexpected ownership.")
    else:
        ssh_dir.mkdir(mode=0o700)
        os.chown(ssh_dir, uid, group_id)
    os.chmod(ssh_dir, 0o700)

    authorized_keys = ssh_dir / "authorized_keys"
    if authorized_keys.exists() and (authorized_keys.is_symlink() or not authorized_keys.is_file()):
        fail(f"Authorized keys for {username} must be a regular, non-symlink file.")
    contents = "".join(f"restrict {key}\n" for key in account["publicKeys"])
    temporary = ssh_dir / ".authorized_keys.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(contents)
        os.chown(temporary, uid, group_id)
        os.chmod(temporary, 0o600)
        os.replace(temporary, authorized_keys)
    finally:
        temporary.unlink(missing_ok=True)


def ensure_host_key(hostkey_root: Path) -> None:
    private_key = hostkey_root / "ssh_host_ed25519_key"
    public_key = hostkey_root / "ssh_host_ed25519_key.pub"
    if private_key.exists() or public_key.exists():
        for key_path in (private_key, public_key):
            if not key_path.exists() or key_path.is_symlink() or not key_path.is_file():
                fail("Executor SSH host key pair is incomplete or unsafe.")
            metadata = key_path.stat()
            unsafe_permissions = metadata.st_mode & 0o077 if key_path == private_key else metadata.st_mode & 0o022
            if metadata.st_uid != 0 or unsafe_permissions:
                fail("Executor SSH host keys must be root-owned and private.")
        return
    result = subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(private_key)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if result.returncode != 0:
        fail("Executor could not initialize its SSH host identity.")
    os.chmod(private_key, 0o600)
    os.chmod(public_key, 0o644)


def main() -> int:
    if os.geteuid() != 0:
        fail("SSH executor entrypoint must start as root.")
    accounts_path = Path(os.environ.get("PAPERCLIP_EXECUTOR_ACCOUNTS", "/etc/paperclip-executor/accounts.json"))
    home_root = Path(os.environ.get("PAPERCLIP_EXECUTOR_HOME_ROOT", "/var/lib/paperclip-executor/homes"))
    hostkey_root = Path(os.environ.get("PAPERCLIP_EXECUTOR_HOSTKEY_ROOT", "/etc/ssh/hostkeys"))
    accounts = parse_accounts(require_root_owned_private_file(accounts_path, max_bytes=MAX_CONFIG_BYTES))
    ensure_root_directory(home_root, mode=0o711)
    ensure_root_directory(hostkey_root, mode=0o700)
    group_id = __import__("grp").getgrnam("paperclip-executor").gr_gid
    for account in accounts:
        provision_account(account, home_root, group_id)
    ensure_host_key(hostkey_root)
    config_path = "/etc/paperclip-executor/sshd_config"
    subprocess.run(["/usr/sbin/sshd", "-t", "-f", config_path], check=True)
    os.execv("/usr/sbin/sshd", ["/usr/sbin/sshd", "-D", "-e", "-f", config_path])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ConfigurationError as exc:
        print(f"paperclip-ssh-executor: {exc}", file=sys.stderr)
        raise SystemExit(78)
