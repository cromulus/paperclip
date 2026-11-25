# Build the complete checkout with the root Dockerfile first. This stage only
# records deployment provenance; all fixes are compiled from source.
ARG NMC_SOURCE_IMAGE
FROM ${NMC_SOURCE_IMAGE}
ARG NMC_FORK_REVISION
ARG NMC_UPSTREAM_REVISION
LABEL io.nmc.paperclip.fork="https://github.com/cromulus/paperclip" \
      io.nmc.paperclip.fork-revision=$NMC_FORK_REVISION \
      io.nmc.paperclip.upstream-revision=$NMC_UPSTREAM_REVISION
