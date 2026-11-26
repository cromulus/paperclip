#!/usr/bin/env bash
set -euo pipefail

image="${PAPERCLIP_EXECUTOR_IMAGE:-}"
if [[ -z "$image" ]]; then
  echo "Set PAPERCLIP_EXECUTOR_IMAGE to the built executor image." >&2
  exit 2
fi
if [[ "$(id -u)" != "0" ]]; then
  echo "Run as root so the disposable bind-mounted account fixture is root-owned." >&2
  exit 2
fi
command -v docker >/dev/null
command -v ssh-keygen >/dev/null

tmp="$(mktemp -d /tmp/paperclip-ssh-executor-preflight.XXXXXX)"
container="paperclip-ssh-executor-preflight-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -m 0700 "$tmp/hostkeys" "$tmp/homes"
ssh-keygen -q -t ed25519 -N "" -f "$tmp/agent-one"
ssh-keygen -q -t ed25519 -N "" -f "$tmp/agent-two"
key_one="$(cat "$tmp/agent-one.pub")"
key_two="$(cat "$tmp/agent-two.pub")"
python3 - "$tmp/accounts.json" "$key_one" "$key_two" <<'PY'
import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({"accounts": [
  {"agentId": "00000000-0000-4000-8000-000000000001", "username": "pc-test-one", "uid": 29001, "publicKeys": [sys.argv[2]]},
  {"agentId": "00000000-0000-4000-8000-000000000002", "username": "pc-test-two", "uid": 29002, "publicKeys": [sys.argv[3]]},
]}, separators=(",", ":")) + "\n")
PY
chmod 0600 "$tmp/accounts.json" "$tmp/agent-one" "$tmp/agent-two"
chmod 0644 "$tmp/agent-one.pub" "$tmp/agent-two.pub"

docker run -d --name "$container" --network none \
  --cpus 0.5 --memory 1g --pids-limit 128 \
  -v "$tmp/accounts.json:/etc/paperclip-executor/accounts.json:ro" \
  -v "$tmp/hostkeys:/etc/ssh/hostkeys:rw" \
  -v "$tmp/homes:/var/lib/paperclip-executor/homes:rw" \
  -v "$tmp/agent-one:/tmp/agent-one:ro" \
  -v "$tmp/agent-two:/tmp/agent-two:ro" \
  "$image" >/dev/null

for attempt in $(seq 1 40); do
  if docker exec "$container" python3 -c "import socket; s=socket.create_connection(('127.0.0.1',22),1); s.close()" >/dev/null 2>&1; then
    break
  fi
  if [[ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ]]; then
    docker logs "$container" >&2
    exit 1
  fi
  sleep 0.25
done

docker exec "$container" /usr/sbin/sshd -t -f /etc/paperclip-executor/sshd_config
policy="$(docker exec "$container" /usr/sbin/sshd -T -f /etc/paperclip-executor/sshd_config)"
for expected in "permitrootlogin no" "passwordauthentication no" "kbdinteractiveauthentication no" "allowtcpforwarding no" "allowagentforwarding no" "x11forwarding no" "permittty no"; do
  if ! grep -Fqx "$expected" <<<"$policy"; then
    echo "Missing SSH policy: $expected" >&2
    exit 1
  fi
done

uid_one="$(docker exec "$container" ssh -F /dev/null -i /tmp/agent-one \
  -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  pc-test-one@127.0.0.1 id -u 2>/dev/null)"
uid_two="$(docker exec "$container" ssh -F /dev/null -i /tmp/agent-two \
  -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  pc-test-two@127.0.0.1 id -u 2>/dev/null)"
[[ "$uid_one" == "29001" && "$uid_two" == "29002" ]]

fingerprint_before="$(docker exec "$container" ssh-keygen -lf /etc/ssh/hostkeys/ssh_host_ed25519_key.pub)"
docker restart "$container" >/dev/null
for attempt in $(seq 1 40); do
  if docker exec "$container" python3 -c "import socket; s=socket.create_connection(('127.0.0.1',22),1); s.close()" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
fingerprint_after="$(docker exec "$container" ssh-keygen -lf /etc/ssh/hostkeys/ssh_host_ed25519_key.pub)"
[[ "$fingerprint_before" == "$fingerprint_after" ]]
uid_after_restart="$(docker exec "$container" ssh -F /dev/null -i /tmp/agent-one \
  -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  pc-test-one@127.0.0.1 id -u 2>/dev/null)"
[[ "$uid_after_restart" == "29001" ]]

docker exec -u pc-test-one "$container" sh -c \
  'test "$(id -u)" = 29001 && test ! -r /var/lib/paperclip-executor/homes/pc-test-two/.ssh/authorized_keys'
docker exec -u pc-test-two "$container" sh -c \
  'test "$(id -u)" = 29002 && test ! -r /var/lib/paperclip-executor/homes/pc-test-one/.ssh/authorized_keys'

limits="$(docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}}' "$container")"
[[ "$limits" == "500000000 1073741824 128" ]]
docker exec "$container" test -s /etc/ssh/hostkeys/ssh_host_ed25519_key.pub

echo "SSH executor preflight passed: SSH key auth before/after restart, non-root per-agent UIDs, private homes, persistent host key, and isolated Docker CPU/memory/PID limits verified."
