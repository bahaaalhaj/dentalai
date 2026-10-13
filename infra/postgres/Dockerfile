FROM postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
# Preserve the upstream PostgreSQL init/permissions flow; replace only its unused Go runtime.
RUN apk add --no-cache su-exec=0.3-r0 && \
    test "$(grep -c 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh)" = 1 && \
    sed -i 's/exec gosu postgres /exec su-exec postgres /' /usr/local/bin/docker-entrypoint.sh && \
    rm /usr/local/bin/gosu && \
    su-exec postgres id && postgres --version
