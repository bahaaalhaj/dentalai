FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --ignore-scripts
# Reviewed native build tool installation: esbuild validates its binary version.
# Other arbitrary dependency lifecycle scripts remain disabled.
RUN npm install --global npm@11.17.0 --ignore-scripts && \
    npm ci --ignore-scripts --prefer-offline --no-audit && npm rebuild esbuild
RUN npm approve-scripts esbuild && npm rebuild esbuild
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/migrate-release.mjs ./scripts/migrate-release.mjs
COPY --from=build /app/scripts/check-private-files.mjs ./scripts/check-private-files.mjs
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
# Remove build-time source/test/seed content from the production image.
RUN find packages -mindepth 2 -maxdepth 2 -type d ! -name dist ! -name drizzle -exec rm -r '{}' + && \
    groupadd --gid 10001 dentalai && useradd --uid 10001 --gid 10001 dentalai && \
    mkdir -p /private/objects && chown -R dentalai:dentalai /private
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js", "--production"]
