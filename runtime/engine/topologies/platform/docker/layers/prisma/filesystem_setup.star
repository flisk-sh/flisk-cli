# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
"""
Filesystem Setup Dockerfile Fragment

Generates the RUN/COPY instructions that:
  - (The Alpine tools migrate.sh needs - jq, nc, curl - are installed by the migrator
    runtime stage, which now shares the backend's base image, not the retired
    golden l4-migrator image)
  - Create required directories and fix ownership so Prisma can write generated files

All functions return Dockerfile instruction strings.
"""

load(
    './constants.star',
    'APP_DIR',
    'BUN_USER',
    'NODE_MODULES_DIR',
    'PRISMA_CONFIG_ABS_PATH',
    'PRISMA_CONFIG_FILE',
    'PRISMA_DIR_NAME',
    'PRISMA_SCHEMA_PATH',
)


def prisma_dir_and_permissions(base = APP_DIR):
    """
    Create directories that Prisma writes to at runtime and ensure the `bun` user owns
    them.  Handles both the standard `node_modules/.prisma/client` path and custom
    output paths like `../src/generated` or `../generated-client`.

    node_modules itself is not chowned: it arrives through a COPY that is identical to the
    service image's, and a `chown -R` over it in its own RUN rewrites every file into a second
    layer (that doubled the migrator image: 332 MB of 1.5 GB). Only node_modules/.prisma, the
    directory `prisma generate` writes to, is created and owned here; the rest of the tree
    stays shared.

    `base` itself is owned by `bun` too: `migrate.sh` runs `prisma generate` as `bun`,
    and a generator output such as `../generated/prisma` (the `flisk resource
    --feature prisma` scaffold) makes Prisma create a new directory directly under
    `base`, which fails with EACCES while root owns it.

    Args:
        base: Working directory the stage COPYs the service into (/app on the old layout,
            /app/<res_path> now that the migrator shares the service's tree).
    """
    node_modules = base + "/" + NODE_MODULES_DIR
    return (
        "# Ensure Prisma can write generated files including custom output paths\n"
        + "RUN mkdir -p " + node_modules + "/.prisma " + base + "/src " + base + "/generated " + base + "/generated-client"
        + " && chown " + BUN_USER + ":" + BUN_USER + " " + base
        + " && chown -R " + BUN_USER + ":" + BUN_USER
        + " " + base + "/" + PRISMA_DIR_NAME + " " + base + "/src " + base + "/generated " + base + "/generated-client"
        + " " + node_modules + "/.prisma " + base + "/" + PRISMA_CONFIG_FILE + " || true\n"
    )


def prisma_config_inline(config_path = PRISMA_CONFIG_ABS_PATH):
    """
    Inline-generate prisma.config.ts so Prisma v7 migration commands pick up
    the datasource URL from the environment without requiring a build-time file copy.

    Args:
        config_path: Absolute path the file is written to (the stage's WORKDIR is
            its parent, so the relative `schema` entry resolves against it).
    """
    return (
        "# Prisma v7 migration commands require datasource.url in prisma.config.ts\n"
        + "RUN cat > " + config_path + " << 'EOF'\n"
        + "export default {\n"
        + "  schema: '" + PRISMA_SCHEMA_PATH + "',\n"
        + "  datasource: {\n"
        + "    url: process.env.DATABASE_URL,\n"
        + "  },\n"
        + "};\n"
        + "EOF\n"
    )

