FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.json tsup.config.ts vitest.config.ts .eslintrc.cjs .prettierrc.json README.md ./
COPY packages ./packages
COPY apps ./apps
COPY templates ./templates
COPY scripts ./scripts
RUN corepack prepare pnpm@9.15.4 --activate && pnpm install --frozen-lockfile=false && pnpm build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY templates ./templates
COPY scripts ./scripts
VOLUME ["/app/.agent"]
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4310/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/daemon/index.js"]
