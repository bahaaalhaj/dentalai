FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json
# Reviewed native build tool installation: esbuild validates its binary version.
# Other arbitrary dependency lifecycle scripts remain disabled.
RUN npm install --global npm@11.17.0 --ignore-scripts && \
    npm ci --ignore-scripts --prefer-offline --no-audit
RUN npm approve-scripts esbuild && npm rebuild esbuild
COPY . .
RUN npm run build
# Assemble only runtime workspace content; no CLI generators, source, tests or ML data.
RUN mkdir -p /private/objects && chown -R 10001:10001 /private && \
    find packages -mindepth 2 -maxdepth 2 -type d ! -name dist ! -name drizzle -exec rm -r '{}' + && \
    rm -rf packages/database/dist/cli

# A fresh production-only installation, not pruning a potentially hoisted dev tree.
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY scripts/install-runtime.mjs scripts/install-runtime.mjs
RUN npm install --global npm@11.17.0 --ignore-scripts && node scripts/install-runtime.mjs

# No npm/corepack, shell, Perl, mount/nsenter, package manager or build Go binaries.
# This is attack-surface reduction, not an exemption from full vulnerability scanning.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c AS runtime
ENV NODE_ENV=production
ENV PATH="/nodejs/bin:/usr/bin:/bin"
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/migrate-release.mjs ./scripts/migrate-release.mjs
COPY --from=build /app/scripts/check-private-files.mjs ./scripts/check-private-files.mjs
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY --from=build --chown=10001:10001 /private /private
USER 10001:10001
EXPOSE 3000
ENTRYPOINT []
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/server.js", "--production"]
