# NMC production overlay

Base: upstream release `2026.1106.0`, commit `d69631b01`, pinned by image digest.
The `nmc/production` branch carries upstream fix `ee29e2850` (#17340), selected
with `git cherry-pick -x`. It fixes shared tool discovery for reassigned and
delegated tasks while retaining checks for GitHub guest-sponsored tasks.

The Dockerfile applies the existing owner proxy, routine queue, direct GitHub,
hosted-connector policy, and split public MCP origin patches. It compiles the
backported source function into the bundle that this release actually executes.
Build assertions refuse a changed base. Runtime configuration and credentials
remain in the deployment manager; none belong in this repository.

`front-door-nginx.conf` and `webhook-nginx.conf` are deployment-side nginx
configuration, separate from the Paperclip application image. The webhook
ingress allowlist is limited to signed POSTs for Slack/GitHub and AgentMail
Svix webhooks, plus the existing routine and MCP routes. Keep public webhook
paths out of browser, OAuth callback, and general API routing.

Build from the repository root:

```sh
docker build --network=none -f deploy/nmc/Dockerfile \
  --build-arg NMC_FORK_REVISION="$(git rev-parse HEAD)" \
  -t nmc/paperclip:2026.1106.0-nmc-20261120-r6 .
node --test deploy/nmc/proxy-owner.test.mjs deploy/nmc/direct-connections.test.mjs
```

Use a disposable container with no production mounts or credentials for tests.
Run Vitest as an unprivileged user so embedded PostgreSQL can start. Execute
`chat-github-tools.test.ts` and `chat-channels/run-origin.test.ts`. Run
`prepare-runtime-regression.mjs` inside the image to generate an additional test
that uses the same database fixtures against the executed bundle function.
Run that generated `chat-github-tools.runtime.test.ts` too. Skipped tests do not
count as a pass. Keep the original two failing tests as pre-fix evidence.

For deployment, retain a database dump, secret/data backups and the previous
Compose configuration. Wait for active agent runs to finish. Change the saved
Compose image, recreate the service, and verify through the real delegated agent
gateway with harmless upstream reads. This patch has no migrations. Roll back to
the previous image using the retained Compose if verification fails.

`master` tracks current upstream with a daily draft sync PR workflow. Updating
it does not deploy production. A full release upgrade must review the overlay
anchors, migrations, session compatibility and rollback separately. Remove the
backport when promoting a release that already contains #17340.
