/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained server bundle for the Docker image.
  output: 'standalone',
  /**
   * Pin the tracing root to THIS directory.
   *
   * Next otherwise walks up to guess a monorepo root, and because this project
   * lives under a path containing a space ("personal code"), it picked the
   * parent — nesting the standalone output at
   * `.next/standalone/personal code/cartwise/server.js`. The Dockerfile would
   * then build an image with no server.js where CMD expects it, failing only at
   * container start.
   */
  outputFileTracingRoot: import.meta.dirname,
  // node:sqlite is a Node 24 built-in; keep it out of the client bundle graph.
  serverExternalPackages: ['node:sqlite'],
  // Linting runs as its own step (`bun run lint` -> oxlint), not inside the build.
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
