#!/usr/bin/env bash
set -euo pipefail

# Preflight a Paperclip image that is already present on the Dokploy host.
# This never pulls or retags images, and every container is disposable,
# network-isolated, and uses only fresh tmpfs storage.

image=${1:?usage: scripts/preflight-paperclip-image.sh <image-ref-on-dokploy>}
if [[ ! "$image" =~ ^[A-Za-z0-9._/:@-]+$ ]]; then
  echo "invalid image reference" >&2
  exit 2
fi

image_id=$(ssh dokploy "sudo -n docker image inspect --format '{{.Id}}' '$image'")
printf 'image=%s\n' "$image_id"

# Check the two exact TypeScript source entrypoints that the server's runtime
# shims load dynamically. The source import also validates their transitive
# local module paths in the image.
source_output=$(ssh dokploy "sudo -n docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev --entrypoint node '$image' --experimental-strip-types --input-type=module -e 'await import(\"file:///app/packages/paperclip-runner/src/index.ts\"); await import(\"file:///app/packages/paperclip-runner/src/live/index.ts\"); console.log(\"runner_source_imports=ok\");'")
if [[ "$source_output" != *"runner_source_imports=ok"* ]]; then
  echo "runner source import preflight failed" >&2
  exit 1
fi
echo "$source_output" | tail -1

# Confirm the compiled deployment bundle contains the environment owner
# persistence path, without executing or modifying a deployment database.
ssh dokploy "sudo -n docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev --entrypoint sh '$image' -lc 'grep -R -F -q --include=\"*.mjs\" \"ownerAgentId: input.ownerAgentId ?? null\" /app/server/dist-runtime'"
echo "owner_agent_insert_bundle=present"

# Start the real image entrypoint with a fresh in-container app home, no
# production environment, no secrets, no network, and no persistent mounts.
# Reaching the documented missing-auth-secret guard proves initialization got
# past static imports; module-path failures are classified separately.
set +e
startup_output=$(ssh dokploy "sudo -n timeout --signal=TERM 35s docker run --rm --network none --stop-timeout 2 --tmpfs /paperclip:rw,nosuid,nodev,size=1g --tmpfs /tmp:rw,nosuid,nodev,size=256m '$image'" 2>&1)
startup_status=$?
set -e

if grep -Eq 'ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package|SyntaxError' <<<"$startup_output"; then
  echo "runtime startup failed during module loading" >&2
  exit 1
fi
if grep -Fq 'BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET) must be set' <<<"$startup_output"; then
  echo "runtime_entry_graph=loaded; startup_guard=expected_missing_auth_config"
  exit 0
fi

echo "runtime entry did not reach the expected auth configuration guard (exit=$startup_status)" >&2
grep -E 'Error:|error:|failed to start|ERR_' <<<"$startup_output" | tail -12 >&2 || true
exit 1
