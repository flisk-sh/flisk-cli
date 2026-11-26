# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 🐳 PLATFORM DOCKER CONSTANTS
# =============================================================================
# Centralized configuration constants for Docker Compose generation.
# All DATABASE_URL formats, project names, runtime versions, and other
# shared constants are defined here to ensure consistency across the topology.
# =============================================================================

# Load the project name for this checkout (makes Flisk CLI portable across projects).
# FLISK_PROJECT_NAME wins, then the gitignored .flisk/project.local.json, then the tracked .flisk/project.json (#4046).
# Falls back to 'flisk_project' / 'flisk-project' when none is found.
# Use FLISK_PROJECT_ROOT env var set by Tilt, fallback to current directory.
def _name_from_json(path, default):
    if not os.path.exists(path):
        return default
    _json = read_json(path)
    # A file that is not an object, or whose "project" is null or not an object, names nothing (as in project-reader.ts).
    _project = _json.get('project') if type(_json) == 'dict' else None
    _name = _project.get('name') if type(_project) == 'dict' else None
    if type(_name) == 'string' and _name.strip():
        return _name.strip().lower()
    return default

def _load_project_names():
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '')
    prefix = project_root + '/' if project_root else ''
    override = os.environ.get('FLISK_PROJECT_NAME', '').strip().lower()
    # Lowercase: Compose project names (and the container, network and volume names built from them) must be lowercase,
    # so "Lychee" is used as "lychee" everywhere (#1519). Keep in step with readProjectNameOrUndefined in
    # cli/src/utils/project-reader.ts.
    _PROJECT_NAME_HYPHEN = override or _name_from_json(prefix + '.flisk/project.local.json', '') or _name_from_json(prefix + '.flisk/project.json', 'flisk-project')
    # Convert hyphenated name to underscore (e.g., "my-project" -> "my_project")
    _PROJECT_NAME = _PROJECT_NAME_HYPHEN.replace('-', '_')
    return _PROJECT_NAME, _PROJECT_NAME_HYPHEN

_PROJECT_NAME, _PROJECT_NAME_HYPHEN = _load_project_names()

_CHECKOUT_ID_HEX = '0123456789abcdef'


def _load_checkout_db_suffix():
    """Suffix for a linked git worktree's logical databases (#4698).

    A linked worktree has a `.git` FILE beginning with `gitdir:`; the main checkout has a `.git` DIRECTORY. Only linked
    worktrees get a suffix, so generated names in the main checkout stay byte-identical. The id is the per-checkout id
    created by #4694 in `.flisk/.project-id`; `flisk up` exports the same value as FLISK_CHECKOUT_ID.
    """
    project_root = os.environ.get('FLISK_PROJECT_ROOT', '').rstrip('/\\')
    if not project_root:
        return ''
    dot_git = project_root + '/.git'
    # Git directories always contain HEAD; a linked worktree's `.git` file never does. Check both separators because
    # Tilt sees Windows project roots with backslashes.
    if (
        not os.path.exists(dot_git)
        or os.path.exists(dot_git + '/HEAD')
        or os.path.exists(dot_git + '\\HEAD')
    ):
        return ''
    if not str(read_file(dot_git, default='')).strip().startswith('gitdir:'):
        return ''
    raw = str(read_file(project_root + '/.flisk/.project-id', default='')).strip()
    if not raw.startswith('{'):
        return ''
    parsed = decode_json(raw)
    if type(parsed) != 'dict':
        return ''
    checkout_id = parsed.get('id', '')
    if type(checkout_id) != 'string' or len(checkout_id) != 8:
        return ''
    for char in checkout_id.elems():
        if char not in _CHECKOUT_ID_HEX:
            return ''
    recorded_path = parsed.get('path')
    if type(recorded_path) != 'string' or recorded_path != os.path.realpath(project_root):
        return ''
    return '_' + checkout_id


_CHECKOUT_DB_SUFFIX = _load_checkout_db_suffix()


# Keep in sync with `scopeDatabaseName` in cli/src/utils/database-name.ts.
_HASH_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-.'


def _name_hash(name):
    """32-bit FNV-1a over the name as 8 hex digits, matching the CLI."""
    h = 2166136261
    for char in name.elems():
        h = ((h ^ (_HASH_ALPHABET.find(char) + 1)) * 16777619) % 4294967296
    out = ''
    for _ in range(8):
        out = '0123456789abcdef'[h % 16] + out
        h = h // 16
    return out


def with_checkout_db_suffix(db_name):
    """Adds this checkout's suffix once, keeping the name within Postgres' 63-byte identifier limit.

    A name that would not fit is shortened and given a hash of the full base, so the suffix survives and the CLI and the
    engine resolve identical names.
    """
    suffix = _CHECKOUT_DB_SUFFIX
    if not suffix or db_name.endswith(suffix):
        return db_name
    if len(db_name) + len(suffix) <= 63:
        return db_name + suffix
    keep = 63 - len(suffix) - 9
    return db_name[:keep] + '_' + _name_hash(db_name) + suffix


# Project name constants
PROJECT_NAME = _PROJECT_NAME
PROJECT_NAME_HYPHEN = _PROJECT_NAME_HYPHEN


def _load_domain(project_name):
    """Host domain for this checkout's Traefik routes (#4697).

    `flisk up` exports FLISK_CHECKOUT_DOMAIN for linked worktrees (and for a
    main checkout with FLISK_CHECKOUT_HOST=always). Every other checkout keeps
    the historical `<project>.localhost` domain, so generated main-checkout
    files stay byte-identical. `FLISK_SERVICE_BASE_URL` is a printed-URL
    override handled by the CLI and deliberately does not rewrite routes.
    """
    checkout_domain = os.environ.get('FLISK_CHECKOUT_DOMAIN', '')
    if checkout_domain:
        return checkout_domain
    name = os.environ.get('FLISK_CHECKOUT_NAME', '')
    if name and os.environ.get('FLISK_CHECKOUT_HOST', '').lower() == 'always':
        return name + '.flisk-project.localhost'
    return project_name + '.localhost'


# Domain constants
LOCAL_DOMAIN = _load_domain(PROJECT_NAME_HYPHEN)
APP_SUBDOMAIN_PREFIX = "app"
API_SUBDOMAIN_PREFIX = "api"
APP_LOCAL_DOMAIN = APP_SUBDOMAIN_PREFIX + "." + LOCAL_DOMAIN
API_LOCAL_DOMAIN = API_SUBDOMAIN_PREFIX + "." + LOCAL_DOMAIN
EMAIL_DOMAIN = PROJECT_NAME_HYPHEN + ".local"

# Published resource-config JSON Schema, same for every project (not project-specific like EMAIL_DOMAIN)
RESOURCE_SCHEMA_URL = "https://flisk.sh/schema.service.json"

# NPM scope constant
NPM_SCOPE = "@" + PROJECT_NAME_HYPHEN + "/"

# Bun runtime constants
BUN_VERSION = "1.3.11"
BUN_IMAGE = "oven/bun:" + BUN_VERSION + "-alpine"

# Database connection constants
DB_USER = PROJECT_NAME
DB_HOST = PROJECT_NAME + "_postgres"
DB_PORT = "5432"
# ⚠️ SECURITY: No default password - must be provided via DB_PASSWORD env var
DB_PASSWORD_SHELL = "${DB_PASSWORD}"  # Requires DB_PASSWORD to be set
DB_SCHEMA = "public"

# Network names
NETWORK_TRAEFIK_PUBLIC = PROJECT_NAME + "_traefik-public"
NETWORK_BACKEND = PROJECT_NAME + "_backend"
NETWORK_DATABASE = PROJECT_NAME + "_database"
NETWORK_INFISICAL = PROJECT_NAME + "_infisical-network"
NETWORK_PROXY = PROJECT_NAME + "_proxy"


def infisical_network_enabled():
    """True when the project turned Infisical on (INFISICAL_ENABLED=true): only then do app services join the infisical network."""
    return os.environ.get("INFISICAL_ENABLED", "false").lower() == "true"

# Traefik file-provider dynamic config: one generated YAML per `sablier.deferStart`
# resource's static route (see openspec/changes/prioritized-cold-start), mounted
# read-only into the standalone Traefik container at /etc/traefik/dynamic.
TRAEFIK_DYNAMIC_DIR_REL = ".flisk/.flisk-out/traefik-dynamic"
TRAEFIK_WAKE_GATEWAY_CONTAINER = PROJECT_NAME_HYPHEN + "-wake-gateway"
TRAEFIK_WAKE_GATEWAY_PORT = 9999

# NATS constants
NATS_HOST = PROJECT_NAME + "_nats"
NATS_PORT = "4222"
NATS_URL = "nats://" + NATS_HOST + ":" + NATS_PORT

# Verdaccio constants
VERDACCIO_PORT = 4873
VERDACCIO_HOST = "localhost"
VERDACCIO_HOST_DOCKER = "host.docker.internal"
VERDACCIO_CONTAINER_NAME = PROJECT_NAME_HYPHEN + "-verdaccio"
VERDACCIO_URL_LOCAL = "http://" + VERDACCIO_HOST + ":" + str(VERDACCIO_PORT)
VERDACCIO_URL_DOCKER = "http://" + VERDACCIO_HOST_DOCKER + ":" + str(VERDACCIO_PORT)
VERDACCIO_NETWORK = PROJECT_NAME + "_verdaccio-network"
VERDACCIO_NPM_REGISTRY = "https://registry.npmjs.org/"
# Resource and service names
VERDACCIO_RESOURCE_NAME = "verdaccio"
VERDACCIO_CONNECT_NETWORK_RESOURCE = "verdaccio-connect-network"
VERDACCIO_DOMAIN = "verdaccio"
VERDACCIO_TRAEFIK_HOST = "verdaccio.localhost"

# Docker names for one stack's generated services. Every name carries the Flisk
# project, so two projects that both have a stack called `people` (two Tilt
# instances on one Docker daemon) never share a Compose project, container or
# image. Without it, the second `flisk up` runs `--remove-orphans` against the
# first project's containers and overwrites its images.
def compose_project_name(stack):
    """Compose project for a stack: <project>-<stack>-autogenerated (e.g. flisk-erp-system-analytics-autogenerated)."""
    return PROJECT_NAME_HYPHEN + "-" + stack + "-autogenerated"

def app_image_name(stack, res_name):
    """Image tag (:dev) of one service: <project>_<stack>_<resource>:dev."""
    return PROJECT_NAME + "_" + stack + "_" + res_name + ":dev"

def infra_compose_project_name(infra):
    """Compose project for a shared platform stack: <project>-<infra> (e.g. flisk-erp-system-database-management)."""
    return PROJECT_NAME_HYPHEN + "-" + infra

def migrator_image_name(stack):
    """Image tag (:dev) of a stack's migrator: <project>_<stack>-db-migrator:dev."""
    return PROJECT_NAME + "_" + stack + "-db-migrator:dev"

# Helper function to generate database name
def get_db_name(domain_or_service):
    """Returns standardized database name for a domain or service in this checkout."""
    return with_checkout_db_suffix(PROJECT_NAME + "_" + domain_or_service.replace("-", "_"))

# Base JDBC URL format (without database name)
def get_database_url_base():
    """Returns base DATABASE_URL format without database name."""
    return "postgresql://" + DB_USER + ":" + DB_PASSWORD_SHELL + "@" + DB_HOST + ":" + DB_PORT + "/"

# Complete DATABASE_URL with database name (for .env files). The URL carries no ?schema= parameter
# on purpose: it is a Prisma-only setting that Bun's SQL client, libpq and other drivers forward to
# Postgres as a startup parameter, which fails with `unrecognized configuration parameter "schema"`
# (#3659). Prisma defaults to the `public` schema when the parameter is absent, so nothing is lost.
def get_database_url_for_env(db_name):
    """Returns DATABASE_URL format for .env files (shell syntax preserved)."""
    return get_database_url_base() + db_name

# Complete DATABASE_URL with database name (for shell scripts)
def get_database_url_for_shell(db_name):
    """Returns DATABASE_URL format for shell scripts."""
    return "postgresql://" + DB_USER + ":$DB_PASSWORD@" + DB_HOST + ":" + DB_PORT + "/" + db_name

# Docker Compose environment variable format with fallback
def get_compose_env_database_url(db_name):
    """Returns Docker Compose environment variable format with fallback."""
    base_url = get_database_url_for_env(db_name)
    return "${{DATABASE_URL:-" + base_url + "}}"

# Tilt resource DATABASE_URL format (for Starlark .format() with host/port placeholders)
def get_tilt_database_url_template():
    """Returns DATABASE_URL template with {host} and {port} placeholders for .format()."""
    # ⚠️ SECURITY: No default password - DB_PASSWORD must be set
    return "postgresql://" + PROJECT_NAME + ":${DB_PASSWORD}@{host}:{port}/{db}"

# Database config entry for config.star
DB_CONFIG = {
    "host": DB_HOST,
    "port": int(DB_PORT),
    "user": DB_USER,
    "password": DB_PASSWORD_SHELL,
    "name_prefix": PROJECT_NAME + "_",
}

PlatformDockerConstants = struct(
    PROJECT_NAME = PROJECT_NAME,
    PROJECT_NAME_HYPHEN = PROJECT_NAME_HYPHEN,
    LOCAL_DOMAIN = LOCAL_DOMAIN,
    APP_SUBDOMAIN_PREFIX = APP_SUBDOMAIN_PREFIX,
    API_SUBDOMAIN_PREFIX = API_SUBDOMAIN_PREFIX,
    APP_LOCAL_DOMAIN = APP_LOCAL_DOMAIN,
    API_LOCAL_DOMAIN = API_LOCAL_DOMAIN,
    EMAIL_DOMAIN = EMAIL_DOMAIN,
    RESOURCE_SCHEMA_URL = RESOURCE_SCHEMA_URL,
    NPM_SCOPE = NPM_SCOPE,
    BUN_VERSION = BUN_VERSION,
    BUN_IMAGE = BUN_IMAGE,
    DB_USER = DB_USER,
    DB_HOST = DB_HOST,
    DB_PORT = DB_PORT,
    DB_PASSWORD_SHELL = DB_PASSWORD_SHELL,
    DB_SCHEMA = DB_SCHEMA,
    NETWORK_TRAEFIK_PUBLIC = NETWORK_TRAEFIK_PUBLIC,
    NETWORK_BACKEND = NETWORK_BACKEND,
    NETWORK_DATABASE = NETWORK_DATABASE,
    NETWORK_INFISICAL = NETWORK_INFISICAL,
    NETWORK_PROXY = NETWORK_PROXY,
    infisical_network_enabled = infisical_network_enabled,
    TRAEFIK_DYNAMIC_DIR_REL = TRAEFIK_DYNAMIC_DIR_REL,
    TRAEFIK_WAKE_GATEWAY_CONTAINER = TRAEFIK_WAKE_GATEWAY_CONTAINER,
    TRAEFIK_WAKE_GATEWAY_PORT = TRAEFIK_WAKE_GATEWAY_PORT,
    NATS_HOST = NATS_HOST,
    NATS_PORT = NATS_PORT,
    NATS_URL = NATS_URL,
    # Verdaccio constants
    VERDACCIO_PORT = VERDACCIO_PORT,
    VERDACCIO_HOST = VERDACCIO_HOST,
    VERDACCIO_HOST_DOCKER = VERDACCIO_HOST_DOCKER,
    VERDACCIO_CONTAINER_NAME = VERDACCIO_CONTAINER_NAME,
    VERDACCIO_URL_LOCAL = VERDACCIO_URL_LOCAL,
    VERDACCIO_URL_DOCKER = VERDACCIO_URL_DOCKER,
    VERDACCIO_NETWORK = VERDACCIO_NETWORK,
    VERDACCIO_NPM_REGISTRY = VERDACCIO_NPM_REGISTRY,
    VERDACCIO_RESOURCE_NAME = VERDACCIO_RESOURCE_NAME,
    VERDACCIO_CONNECT_NETWORK_RESOURCE = VERDACCIO_CONNECT_NETWORK_RESOURCE,
    VERDACCIO_DOMAIN = VERDACCIO_DOMAIN,
    VERDACCIO_TRAEFIK_HOST = VERDACCIO_TRAEFIK_HOST,
    DB_CONFIG = DB_CONFIG,
    get_db_name = get_db_name,
    with_checkout_db_suffix = with_checkout_db_suffix,
    checkout_db_suffix = _CHECKOUT_DB_SUFFIX,
    compose_project_name = compose_project_name,
    infra_compose_project_name = infra_compose_project_name,
    app_image_name = app_image_name,
    migrator_image_name = migrator_image_name,
    get_database_url_base = get_database_url_base,
    get_database_url_for_env = get_database_url_for_env,
    get_database_url_for_shell = get_database_url_for_shell,
    get_compose_env_database_url = get_compose_env_database_url,
    get_tilt_database_url_template = get_tilt_database_url_template,
)

CONSTANTS = {}
