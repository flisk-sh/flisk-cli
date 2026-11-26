# A real Hono app from `create-hono` (Bun template): the scaffolder runs at build time.
FROM oven/bun:1@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18
WORKDIR /work
RUN bun create hono@latest app --template bun --install --pm bun
WORKDIR /work/app
RUN chown -R bun:bun .
USER bun
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT:-3000}" || exit 1
# The template exports the app (`export default app`) and Bun serves it, reading PORT itself, so nothing needs patching.
# `bun run dev` is `bun run --hot src/index.ts`.
CMD ["bun", "run", "dev"]
