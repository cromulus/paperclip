# NMC production source build

The November 25 upgrade integrates upstream `304854ee9926dfe677e98c282e1dc08dda0000ad`
and the retained NMC production source changes. The root Dockerfile builds the UI,
server, adapters, and Runner together. Do not apply the old compiled-bundle patches
to a new upstream image. `Dockerfile.2026-1106-legacy` and the patch scripts are
historical recovery material for that release only.

Preserved behavior includes the trusted owner MCP boundary, separate public MCP
origin, disabled hosted connector policy, direct GitHub repository discovery,
agent-owned execution environments, routine claim contention, and remote MCP
callback routing. Upstream now supplies the chat/sidebar loading improvements.
Runtime secrets and deployment policy values remain in Dokploy.

Build from a clean committed checkout:

```sh
revision=$(git rev-parse HEAD)
upstream=304854ee9926dfe677e98c282e1dc08dda0000ad
docker build --target production \
  --build-arg PAPERCLIP_BUILD_COMMIT="$revision" \
  --build-arg PAPERCLIP_RUNNER_SOURCE_REVISION="$revision" \
  -t nmc/paperclip-source:"$revision" .
docker build -f deploy/nmc/Dockerfile \
  --build-arg NMC_SOURCE_IMAGE=nmc/paperclip-source:"$revision" \
  --build-arg NMC_FORK_REVISION="$revision" \
  --build-arg NMC_UPSTREAM_REVISION="$upstream" \
  -t nmc/paperclip:"$revision" .
```

The Runner source revision is valid only while its build inputs match upstream.
Verify its input digest when reusing Runner artifacts. Never reuse an old image's
UI or compiled server modules as bind mounts over the new build.

## Database and deployment

Rehearse every pending migration on a restored production dump, on an internal
network without production credentials or outbound access. This upgrade includes
upstream maintenance migrations: stop old application writers before cutover.
Keep a fresh database dump, private configuration/secret backups, and the previous
Compose/image. Rollback after schema migration requires restoring that dump, not
merely switching the image back.

NMC previously shipped `0375_stiff_meggan.sql`; upstream independently allocated
0375. Preserve the original database receipt. Its exact SQL is archived under
`legacy-migrations/`. Generated migration `0510_illegal_kate_bishop.sql` validates
and preserves the existing nullable UUID owner column and index, or installs them
on a new database. It creates indexes concurrently and runs outside a transaction.
It never rewrites the historical receipt or skips upstream's own 0375 migration.

Retain four CPUs for both application and database, PostgreSQL JIT disabled, and
the NMC heartbeat recovery lookup index. Verify health, build stamp, trusted owner
and anonymous MCP boundaries, existing chat history, and a harmless tool read
through the real agent path after deployment. A successful build alone is not
production acceptance.

`master` has a daily draft upstream sync PR workflow. Sync does not deploy;
production promotion requires this migration and runtime verification process.
