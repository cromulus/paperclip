# syntax=docker/dockerfile:1.6
# Use the exact Paperclip server image as the CLI/runtime base so remote legacy
# adapters see the same Node and provider CLI versions as local execution.
ARG PAPERCLIP_EXECUTOR_BASE_IMAGE
FROM ${PAPERCLIP_EXECUTOR_BASE_IMAGE}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-server openssl python3 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system paperclip-executor \
  && mkdir -p /run/sshd /etc/paperclip-executor /etc/ssh/hostkeys /var/lib/paperclip-executor/homes \
  && chmod 0755 /run/sshd \
  && chmod 0750 /etc/paperclip-executor \
  && chmod 0711 /var/lib/paperclip-executor \
  && chmod 0700 /etc/ssh/hostkeys /var/lib/paperclip-executor/homes

COPY docker/ssh-executor/sshd_config /etc/paperclip-executor/sshd_config
COPY docker/ssh-executor/entrypoint.py /usr/local/lib/paperclip-executor/entrypoint.py
RUN chmod 0644 /etc/paperclip-executor/sshd_config \
  && chmod 0755 /usr/local/lib/paperclip-executor/entrypoint.py

ENV PAPERCLIP_EXECUTOR_ACCOUNTS=/etc/paperclip-executor/accounts.json \
    PAPERCLIP_EXECUTOR_HOME_ROOT=/var/lib/paperclip-executor/homes \
    PAPERCLIP_EXECUTOR_HOSTKEY_ROOT=/etc/ssh/hostkeys

ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/usr/local/lib/paperclip-executor/entrypoint.py"]
