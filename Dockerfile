# Cartwise container.
#
# Two stages: Bun installs and builds (it is the package manager this repo uses),
# Node runs. The floor is Node 22.5, where `node:sqlite` landed; 24 is pinned
# here simply because the image is free to use a newer runtime than a host might
# have. Either way there is no native module to compile, which is why this image
# needs no build toolchain at runtime.

FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# The build never touches the database: seeding happens on first request.
RUN bun run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Next's standalone output carries only the server and the modules it needs.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# SQLite lives on the mounted volume so data survives deploys.
ENV CARTWISE_DB=/data/cartwise.db
RUN mkdir -p /data

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
