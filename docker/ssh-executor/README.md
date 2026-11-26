# Paperclip SSH executor

This image runs the existing Paperclip SSH environment transport in a separate
container. Paperclip keeps run admission, policy, activity, process identity,
cancellation, and MCP gateway authority. The remote adapter child runs as a
dedicated unprivileged Unix user inside a distinct Docker CPU/memory/pid cgroup.

The image is based on the exact Paperclip server image, so provider CLIs and
Node match the API image. Build it after the Paperclip image is available:

```sh
docker build \
  --build-arg PAPERCLIP_EXECUTOR_BASE_IMAGE="$PAPERCLIP_SERVER_IMAGE" \
  -f docker/ssh-executor/Dockerfile \
  -t "$PAPERCLIP_EXECUTOR_IMAGE" .
```

Add `docker/docker-compose.agent-executor.yml` to the existing Paperclip Compose
project. The overlay publishes no host port; `agent-executor:22` is available
only on the existing private network. Set the CPU, memory, and PID values for
the host's available capacity. The defaults are 4 CPUs, 4 GiB, and 1024 PIDs.
The app must share that private network (directly or through its Tailscale
network namespace). The overlay inherits the base Compose network definition
without changing it.

## Accounts and keys

Create `/var/lib/nmc/paperclip/executor/accounts.json` as a root-owned file with
mode `0600` or `0640`. It contains public keys only:

```json
{
  "accounts": [
    {
      "agentId": "00000000-0000-4000-8000-000000000001",
      "username": "pc-agent-one",
      "uid": 20001,
      "publicKeys": ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... paperclip-agent-one"]
    }
  ]
}
```

Use one unique Unix user and UID per Paperclip agent. The entrypoint rejects
duplicate identities, unknown fields, non-Ed25519/ECDSA keys, unsafe account
configuration, and home directories owned by a different UID. It writes only
that account's `authorized_keys`; each key gets OpenSSH's `restrict` option.
There is no shared shell account, private key, app credential, Docker socket,
or Paperclip data directory in this service.

Persist these root-owned paths on the host:

- `/var/lib/nmc/paperclip/executor/accounts.json` — public key/account map,
  mounted read-only.
- `/var/lib/nmc/paperclip/executor/hostkeys` — SSH host private key, mode
  `0600`, directory mode `0700`.
- `/var/lib/nmc/paperclip/executor/homes` — separate homes/workspaces, mounted
  read-write. Each user can traverse only its own home.

The container creates an Ed25519 host key on first start if the host-key
directory is empty. Keep that directory across recreates. Read the public key
from `ssh_host_ed25519_key.pub` and pin it in each Paperclip SSH environment's
`knownHosts`; use `strictHostKeyChecking: true`.

For each agent, create an SSH environment with:

- `host: agent-executor`, `port: 22`, and that agent's unique `username`.
- `remoteWorkspacePath: /var/lib/paperclip-executor/homes/<username>/workspaces`.
- The matching private key stored as a Paperclip Secret and referenced through
  `privateKeySecretRef`; never place private keys in Compose or this account map.
- The pinned host key and strict host-key checking enabled.
- `ownerAgentId` set to the same agent ID. Do not assign an owned environment
  to another agent.

Paperclip's SSH driver stages the selected workspace and supported managed
provider home to that account, executes the configured adapter command, and
collects output through the existing SSH process runner. The API retains stop
and cancellation ownership. The R7 Paperclip callback bridge keeps internal
MCP credentials on the controller and forwards only per-run bridge authority.
External MCP server URLs remain as configured.

## Verification

Run `scripts/preflight-ssh-executor.sh` against the built image. It starts a
disposable container with no network and no production volumes, then checks
OpenSSH policy, per-user UID/home isolation, and the configured Docker CPU,
memory, and PID limits. Follow with the Paperclip SSH environment probe and a
real bounded agent run for each adapter engine being migrated. A passing image
preflight does not qualify managed provider authentication or a production
environment binding.

Rollback by assigning the agent back to its prior environment only after its
current run reaches a terminal state and reports confirmed process stop. Keep
the executor volumes and its host key until all leases using it are released.
