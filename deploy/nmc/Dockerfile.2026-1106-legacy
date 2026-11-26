FROM ghcr.io/paperclipai/paperclip@sha256:d6584f05cf57a4b26c117eb083725f18c1fe69ddafa7d16c9f8cce83f6fa17da
COPY deploy/nmc/proxy-owner.mjs /app/nmc-proxy-owner.mjs
COPY deploy/nmc/patch-runtime.mjs /tmp/nmc-patch-runtime.mjs
COPY deploy/nmc/verify-runtime.mjs /tmp/nmc-verify-runtime.mjs
COPY deploy/nmc/patch-guest-discovery.mjs /app/nmc-patch-guest-discovery.mjs
COPY server/src/services/chat-github-tools.ts /tmp/nmc-chat-github-tools.ts
COPY server/src/services/chat-github-tools.test.ts /app/server/src/services/chat-github-tools.test.ts
RUN node /tmp/nmc-patch-runtime.mjs \
 && node /app/nmc-patch-guest-discovery.mjs \
 && node --check /app/server/dist-runtime/server.mjs \
 && node --check /app/server/dist-runtime/chunk-TYL6XQKY.mjs \
 && node --check /app/server/dist-runtime/chunk-URIDYK22.mjs \
 && node /tmp/nmc-verify-runtime.mjs \
 && rm /tmp/nmc-patch-runtime.mjs /tmp/nmc-verify-runtime.mjs /tmp/nmc-chat-github-tools.ts /app/nmc-patch-guest-discovery.mjs
ARG NMC_FORK_REVISION
LABEL io.nmc.paperclip.fork="https://github.com/cromulus/paperclip" \
      io.nmc.paperclip.fork-revision=$NMC_FORK_REVISION \
      io.nmc.paperclip.upstream-fix="ee29e2850d0edc6cf11be9a8166a7829bce9c311"
