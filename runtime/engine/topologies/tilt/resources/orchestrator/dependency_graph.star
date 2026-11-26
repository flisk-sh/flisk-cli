# Copyright (c) 2026 Flisk Landscape contributors
# SPDX-License-Identifier: MIT
# =============================================================================
# 🧩 ORCHESTRATOR APPLY - DEPENDENCY GRAPH
# =============================================================================
# Turns a manifest's dependsOn into Tilt `resource_deps`: shared Postgres and
# database-resource aliases, service and stack resolution, infra dependencies,
# the companion gates (<svc>-healthy, <job>-done), the dependency-cycle guard,
# and deferStart dependency resolution.
# =============================================================================

load('../../../../../discovery/native_windows.star', 'file_exists')
load('../../common/dependencies.star', 'declared_dependencies', 'find_dependency_cycle')
load('../../../platform/docker/constants.star', 'PlatformDockerConstants')
load('../../../platform/docker/networking/sablier_container_cycle.star', 'sablier_middleware_suffix')
load('../../../platform/docker/compose/one_shot_job.star', 'is_one_shot_job')
load('../shared-platform-postgres.star',
     'is_shared_platform_postgres_dependency',
     _is_database_manifest = 'is_database_manifest')


def _is_database_resource(name, all_services_map):
    """True when `name` is the appName of a discovered `database` resource (the project's Postgres, declared in a service.json)."""
    service = (all_services_map or {}).get(name)
    if not service:
        return False
    for res in service.get('resources', []):
        if res.get('name', '') == name and _is_database_manifest(res.get('_manifest', {}) or {}):
            return True
    return False


def database_resource_names(all_services_map):
    """The appNames of every discovered `database` resource."""
    names = []
    for svc in (all_services_map or {}).values():
        for res in svc.get('resources', []):
            name = res.get('name', '')
            if name and name not in names and _is_database_manifest(res.get('_manifest', {}) or {}):
                names.append(name)
    return names


def build_infra_dependencies(resource_name, should_enable, ctx=None, has_backend=False, uses_golden_image=True):
    """Infra deps every resource of the stack waits for.

    feature off -> no postgres; feature on -> has postgres (plus backend
    provision-db edge when has_backend is true). The golden build is a dependency only
    when uses_golden_image is true.
    """
    ctx = ctx if ctx != None else {}
    infra_deps = []
    if should_enable('database-management'):
        infra_deps.append('postgres')
        if has_backend:
            infra_deps.append('provision-db-' + resource_name)
    if should_enable(PlatformDockerConstants.VERDACCIO_RESOURCE_NAME):
        project_root = ctx.get('project_root', '')
        verdaccio_compose = ((project_root.rstrip('/') + '/') if project_root else '') + 'docker-compose.verdaccio.yml'
        if file_exists(verdaccio_compose):
            infra_deps.append(PlatformDockerConstants.VERDACCIO_RESOURCE_NAME)
    if uses_golden_image and should_enable('golden-image') and ctx.get('golden_image_resource'):
        infra_deps.append(ctx['golden_image_resource'])
    return infra_deps


def resolve_dependency_to_resource(dep_name, all_services_map):
    """
    Resolve a short dependency name (e.g., 'identity') to the full YAML resource name.

    The discovery registry creates YAML resources with names like:
    - 'identity-management-backend-yaml' for identity backend
    - 'api-gateway-yaml' for api-gateway

    But manifests reference them as short names like 'identity' or 'api-gateway'.

    Shared platform Postgres aliases (`postgres`, `database-management`) resolve
    to the literal Tilt resource `postgres` in BOTH feature states — they must
    NOT fall through to `postgres-yaml` or any other name.
    """
    # Shared platform Postgres: exact names only (typos stay on the normal path).
    if is_shared_platform_postgres_dependency(dep_name) or _is_database_resource(dep_name, all_services_map):
        return 'postgres'

    # Check if already a full YAML resource name
    if dep_name in all_services_map:
        return dep_name

    # Try with -yaml suffix (for resources already resolved)
    yaml_name = dep_name + '-yaml'
    if yaml_name in all_services_map:
        return yaml_name

    # Try to find matching service by stack/short name
    for resource_name, resource_info in all_services_map.items():
        # Check if this service's stack matches the dependency
        resource_domain = resource_info.get('stack', '')
        if resource_domain == dep_name:
            # Return the first resource of this service with -yaml suffix
            resources = resource_info.get('resources', [])
            if resources:
                # Prefer backend resources over frontends
                for res in resources:
                    if not res.get('frontend', False):
                        return res['name'] + '-yaml'
                # Fallback to first resource
                return resources[0]['name'] + '-yaml'

    # Try pattern matching: identity -> identity-*-yaml
    for resource_name in all_services_map.keys():
        if resource_name.startswith(dep_name + '-') and resource_name.endswith('-yaml'):
            return resource_name

    # Return original with -yaml suffix as last resort
    return dep_name + '-yaml'


# App types the registration loop skips (see register_compose_resources): they get no Tilt resource, so nothing can wait for them
# and their own dependsOn never reaches the graph.
_UNREGISTERED_APP_TYPES = ['library', 'sdk', 'infra', 'database']


def _is_registered_resource(res):
    """True when the registration loop creates a Tilt resource for this discovered resource."""
    app_type = (res.get('_manifest', {}) or {}).get('appType', 'backend')
    return app_type not in _UNREGISTERED_APP_TYPES


def _is_unregistered_resource(name, all_services_map):
    """True when `name` is a discovered resource of a type the registration loop skips (library, sdk, infra).

    Such a resource has no Tilt resource under its own name (a library's only resource is `<name>-yaml`, which also does not
    exist for the skipped types), so a dependsOn on it can never become a wait edge; Tilt would only print "dependency ignored".
    """
    service = (all_services_map or {}).get(name)
    if not service:
        return False
    for res in service.get('resources', []):
        if res.get('name', '') == name:
            return not _is_registered_resource(res)
    return False


def _is_known_resource(name, all_services_map):
    """True when `name` is the name of a resource (a runnable service), not of a stack or an alias."""
    service = (all_services_map or {}).get(name)
    if not service:
        return False
    for res in service.get('resources', []):
        if res.get('name', '') == name:
            return True
    return False


def resolve_dependency_to_resources(dep_name, all_services_map):
    """Resolve one dependsOn entry to the Tilt resources it makes a service wait for.

    - the shared platform Postgres names, and the appName of a `database` resource -> `postgres`
    - a resource (service) name -> that resource
    - a stack name -> every backend-side resource of that stack. Frontends are left out, as in the `--focus` closure
      (get_all_needed_services), so a service that depends on a stack never waits for the stack's UI.
    - anything else -> [] (a typo; `flisk up` and `flisk config verify` name it)
    """
    if is_shared_platform_postgres_dependency(dep_name) or _is_database_resource(dep_name, all_services_map):
        return ['postgres']
    all_services_map = all_services_map or {}
    if _is_known_resource(dep_name, all_services_map):
        # A library, sdk or infra resource gets no Tilt resource, so there is nothing to wait for.
        return [] if _is_unregistered_resource(dep_name, all_services_map) else [dep_name]
    names = []
    for service in all_services_map.values():
        if service.get('stack', '') != dep_name and service.get('name', '') != dep_name:
            continue
        for res in service.get('resources', []):
            res_name = res.get('name', '')
            if res_name and not res.get('frontend', False) and _is_registered_resource(res) and res_name not in names:
                names.append(res_name)
    return names


def build_all_services_map(all_services):
    """Map each service group (stack) name and each resource name to its service group."""
    all_services_map = {}
    for svc in all_services:
        svc_name = svc.get('name', '')
        if svc_name:
            all_services_map[svc_name] = svc
        for res in svc.get('resources', []):
            res_name = res.get('name', '')
            if res_name:
                all_services_map[res_name] = svc
    return all_services_map


def fail_on_dependency_cycle(all_services_map):
    """Stop the Tiltfile with a clear message when the services wait for each other in a circle.

    Tilt checks the resource graph itself, but when it rejects a cycle it stops watching the service.json files, so fixing the
    file does nothing and the stack stays on the old graph until it is restarted. An ordinary Starlark error keeps every watch,
    so the Tiltfile reloads on its own once the cycle is gone. The edges are the ones `build_resource_deps` gives resource_deps.
    """
    edges = {}
    for svc in all_services_map.values():
        for res in svc.get('resources', []):
            name = res.get('name', '')
            if not name or name in edges or not _is_registered_resource(res):
                continue
            manifest = res.get('_manifest', {}) or {}
            waits = []
            for dep in declared_dependencies(manifest):
                for target in resolve_dependency_to_resources(dep, all_services_map):
                    if target != 'postgres' and target != name and target not in waits:
                        waits.append(target)
            if res.get('frontend', False):
                backend_name = manifest.get('backendName', name.replace('frontend', 'backend'))
                if backend_name != name and _is_known_resource(backend_name, all_services_map) and backend_name not in waits:
                    waits.append(backend_name)
            edges[name] = waits
    cycle = find_dependency_cycle(edges)
    if cycle:
        fail("""
❌ ═══════════════════════════════════════════════════════════════════
❌  CIRCULAR dependsOn
❌ ═══════════════════════════════════════════════════════════════════
   {cycle}

   These services wait for each other, so none of them can start.
   Remove one "dependsOn" entry (or "backendName") in their service.json files.
   This Tiltfile reloads by itself once the circle is gone.
❌ ═══════════════════════════════════════════════════════════════════
""".format(cycle=' -> '.join(cycle)))


def build_resource_deps(res, res_name, manifest, resource_config, infra_deps, config_gen_resources=None, resource_manifests=None, runtime_flags=None, all_services_map=None):
    """The full resource_deps list of one resource.

    Ensures the dependsOn->resource_deps edge is exercised by tests: feature off
    + dependsOn postgres -> postgres edge present; feature on + dependsOn ->
    exactly one postgres edge (infra_deps already carries it).
    """
    config_gen_resources = config_gen_resources if config_gen_resources != None else {}
    resource_manifests = resource_manifests if resource_manifests != None else {}
    runtime_flags = runtime_flags if runtime_flags != None else {
        'enforce_migrator_deps': False,
        'auto_init_apps': True,
        'disable_app_replicas': False,
    }

    # Drop self-deps: shared infra_deps always includes verdaccio when enabled, so
    # registering verdaccio itself would otherwise produce resource_deps=['verdaccio'].
    res_deps = [dep for dep in infra_deps if dep != res_name]
    if res_name in config_gen_resources:
        res_deps.append(config_gen_resources[res_name])
    if res.get('frontend', False):
        backend_name = manifest.get('backendName', res_name.replace('frontend', 'backend'))
        # The backend may live in another stack, so look it up among all services, not only this stack's resources.
        if backend_name != res_name and (backend_name in resource_manifests or _is_known_resource(backend_name, all_services_map)):
            res_deps.append(backend_name)
    elif runtime_flags['enforce_migrator_deps'] and resource_config.get('has_migrator', False):
        migrator_name = resource_config['name'] + '-db-migrator'
        if migrator_name not in res_deps:
            res_deps.append(migrator_name)

    # Resolve dependsOn from the manifest: services, stacks (their backend-side services) and the shared Postgres.
    conditions = dict(manifest.get('dependsOnConditions', {})) if manifest and type(manifest.get('dependsOnConditions')) == 'dict' else {}
    if manifest and type(manifest.get('dependsOn')) == 'list':
        for entry in manifest['dependsOn']:
            if type(entry) == 'dict':
                entry_name = entry.get('name')
                entry_cond = entry.get('condition')
                if entry_name and entry_cond and entry_name not in conditions:
                    conditions[entry_name] = entry_cond

    for dep in declared_dependencies(manifest):
        resolved = resolve_dependency_to_resources(dep, all_services_map)
        if not resolved and not _is_unregistered_resource(dep, all_services_map):
            # Not a service or stack: keep the name Tilt has always been given (a `-yaml` echo resource, or nothing).
            resolved = [resolve_dependency_to_resource(dep, all_services_map or {})]

        is_direct = _is_known_resource(dep, all_services_map) or is_shared_platform_postgres_dependency(dep) or _is_database_resource(dep, all_services_map)
        is_expanded_stack = (not is_direct) or (len(resolved) > 1)
        dep_condition = conditions.get(dep, None)

        for resolved_dep in resolved:
            if resolved_dep and resolved_dep != res_name and resolved_dep not in res_deps:
                res_deps.append(resolved_dep)

            # Check if resolved_dep is a valid runnable resource (or not an unregistered echo name)
            is_valid_res = resolved_dep and resolved_dep != res_name and (not resolved_dep.endswith("-yaml") or _is_known_resource(resolved_dep, all_services_map))

            if is_valid_res:
                dep_is_job = _is_job_resource(resolved_dep, all_services_map)

                if is_expanded_stack:
                    # Expanded stack dependency (e.g. {"name": "shop", "condition": "service_healthy"}).
                    # Route each member service to its valid companion gate:
                    # - service_healthy: persistent services with health checks wait for <svc>-healthy; one-shot migrators wait for <job>-done.
                    # - service_completed_successfully: migrators wait for <job>-done; persistent services wait for <svc>-healthy.
                    # - service_started: all members only wait for container start (no companion gates).
                    # - unconditioned (default): persistent services wait for start; migrators default to <job>-done (#2871).
                    if dep_condition == "service_healthy":
                        if dep_is_job:
                            companion = job_done_resource_name(resolved_dep)
                            if companion not in res_deps:
                                res_deps.append(companion)
                        elif _service_has_health_check(resolved_dep, all_services_map):
                            companion = job_healthy_resource_name(resolved_dep)
                            if companion not in res_deps:
                                res_deps.append(companion)
                    elif dep_condition == "service_completed_successfully":
                        companion = job_done_resource_name(resolved_dep) if dep_is_job else job_healthy_resource_name(resolved_dep)
                        if companion not in res_deps:
                            res_deps.append(companion)
                    elif dep_condition == "service_started":
                        pass
                    elif dep_is_job:
                        done = job_done_resource_name(resolved_dep)
                        if done not in res_deps:
                            res_deps.append(done)
                else:
                    # Directly named service or one-shot job dependency. Enforce strict condition validity.
                    if dep_condition == "service_healthy":
                        if dep_is_job:
                            fail("MANIFEST ERROR: dependency '{}' of '{}' specifies condition 'service_healthy', but '{}' is a one-shot job that exits on completion without a health check. Use 'service_completed_successfully' or 'service_started'.".format(resolved_dep, res_name, resolved_dep))
                        if not _service_has_health_check(resolved_dep, all_services_map):
                            fail("MANIFEST ERROR: dependency '{}' of '{}' specifies condition 'service_healthy', but '{}' has no health check configured (or healthCheck is disabled). Configure healthCheck (path, port, or command) or use 'service_started'.".format(resolved_dep, res_name, resolved_dep))
                        healthy = job_healthy_resource_name(resolved_dep)
                        if healthy not in res_deps:
                            res_deps.append(healthy)

                    elif dep_condition == "service_completed_successfully":
                        if not dep_is_job:
                            fail("MANIFEST ERROR: dependency '{}' of '{}' specifies condition 'service_completed_successfully', but '{}' is a long-running service that does not exit on completion. Use 'service_healthy' or 'service_started'.".format(resolved_dep, res_name, resolved_dep))
                        done = job_done_resource_name(resolved_dep)
                        if done not in res_deps:
                            res_deps.append(done)

                    elif dep_condition == "service_started":
                        pass

                    elif resolved_dep == 'postgres' and (is_shared_platform_postgres_dependency(dep) or _is_database_resource(dep, all_services_map)):
                        # A service that names the project's Postgres waits until it accepts connections, not only until its
                        # container runs: Tilt counts a running container as ready, so the API started while Postgres was still
                        # `starting` and logged connection errors (#683). Write `condition: "service_started"` to opt out.
                        healthy = job_healthy_resource_name(resolved_dep)
                        if healthy not in res_deps:
                            res_deps.append(healthy)

                    elif dep_is_job:
                        # Direct dependency on a one-shot job with no explicit condition: default to completion (#2871)
                        done = job_done_resource_name(resolved_dep)
                        if done not in res_deps:
                            res_deps.append(done)

    return res_deps


def job_healthy_resource_name(svc):
    """The Tilt resource that waits for a service to become healthy (see register_healthy_resource)."""
    return svc + '-healthy'


def job_done_resource_name(job):
    """The Tilt resource that waits for a one-shot job to exit (see register_job_done_resource)."""
    return job + '-done'


def _is_job_resource(name, all_services_map):
    """True when `name` is a registered one-shot job (a migrator, or bring-your-own with "restart": "no")."""
    service = (all_services_map or {}).get(name)
    if not service:
        return False
    for res in service.get('resources', []):
        if res.get('name', '') == name:
            return _is_registered_resource(res) and is_one_shot_job(res.get('_manifest', {}) or {})
    return False


def _find_resource_manifest(name, all_services_map):
    """Locate the manifest for a resource by name across all_services_map."""
    service = (all_services_map or {}).get(name)
    if service:
        for res in service.get('resources', []):
            if res.get('name', '') == name:
                return res.get('_manifest', {}) or {}
    for svc in (all_services_map or {}).values():
        if type(svc) == 'dict':
            for res in svc.get('resources', []):
                if res.get('name', '') == name:
                    return res.get('_manifest', {}) or {}
    return None


def _service_has_health_check(name, all_services_map):
    """True when `name` has an active health check configured (path, port, command, or postgres default)."""
    if is_shared_platform_postgres_dependency(name) or _is_database_resource(name, all_services_map):
        return True
    manifest = _find_resource_manifest(name, all_services_map)
    if manifest == None:
        # Unknown/external resource: assume true to avoid false negative when manifest is omitted
        return True
    hc = manifest.get('healthCheck')
    if hc == False or (type(hc) == 'dict' and hc.get('enabled') == False):
        return False
    if type(hc) == 'dict' and (hc.get('path') or hc.get('port') or hc.get('command')):
        return True
    if manifest.get('healthCheckPath'):
        return True
    app_type = manifest.get('appType')
    if app_type == 'bring-your-own':
        return False
    if app_type == 'migrator':
        return False
    return True


def resource_defers_start(manifest):
    """True when a manifest opts into `sablier.enable` + `sablier.deferStart`
    AND the licensed sablier module is actually active.

    deferStart stays behind the same FLISK_LICENSE_KEY gate as the rest of
    `sablier` (an explicit product decision, not just the opt-in manifest
    flag): the free-tier stub's sablier_middleware_suffix() always reports
    `enabled=False` regardless of what the manifest says, so checking through
    it here -- rather than reading manifest['sablier']['enable'] directly --
    is what keeps deferStart off for unlicensed projects. Without this check,
    a project with no license would still get "no container created or
    started," silently bypassing the license boundary for the disable-the-
    container half of the feature even though the Docker-label wake half
    stays correctly disabled.

    A deferred resource's image still builds (docker_build has no auto_init
    gate), but its dc_resource/run-only/replica resources are held back with
    auto_init=False: no container is created or started until the Traefik
    static route wakes it on first request (see openspec/changes/
    prioritized-cold-start)."""
    _, sablier_licensed_and_enabled = sablier_middleware_suffix(manifest, '')
    sablier = manifest.get('sablier', {}) if manifest else {}
    defers_start = bool(sablier.get('enable', False) and sablier.get('deferStart', False))
    if defers_start and not sablier_licensed_and_enabled:
        print("⚠️  '{}' requests sablier.deferStart but the licensed Sablier overlay is disabled; starting normally".format(manifest.get('name', 'resource')))
    if not sablier_licensed_and_enabled:
        return False
    return defers_start


def resolve_manifest_dependency_names(manifest, all_services_map):
    """Resolve a manifest's `dependsOn` short names to full resource names,
    reusing the same `resolve_dependency_to_resource` that `build_resource_deps`
    already trusts for Tilt's own resource_deps ordering -- an ambiguous name
    behaves identically here as it already does there."""
    resolved = []
    for dep in declared_dependencies(manifest):
        names = resolve_dependency_to_resources(dep, all_services_map)
        if not names and not _is_unregistered_resource(dep, all_services_map):
            names = [resolve_dependency_to_resource(dep, all_services_map or {})]
        for resolved_dep in names:
            if resolved_dep and resolved_dep not in resolved:
                resolved.append(resolved_dep)
    return resolved


def resolve_defer_start_dependencies(manifest, resource_manifests, all_services_map):
    """Of a deferStart resource's manifest dependencies, resolve the subset
    that are themselves deferStart resources, for the wake gateway's
    X-Wake-Deps (see generate_static_wake_route's `dependencies` param and
    openspec/changes/prioritized-cold-start design.md D5).

    A dependsOn name `resolve_dependency_to_resource` can't map to an exact
    resource (its own fallback branches -- see that function) won't be a key
    in `resource_manifests` either, so it's quietly excluded here rather than
    guessed at -- consistent with D5's existing stance. Always-on infra
    (database, NATS) is never itself a deferStart resource (D5), so in
    practice this only ever picks up the one case D5 flags as mattering: a
    deferStart resource depending on another."""
    dependencies = []
    for resolved_dep in resolve_manifest_dependency_names(manifest, all_services_map):
        dep_manifest = resource_manifests.get(resolved_dep)
        if not dep_manifest or not resource_defers_start(dep_manifest):
            continue
        dep_service_name = all_services_map.get(resolved_dep, {}).get('name', '')
        if not dep_service_name:
            continue
        dependencies.append((resolved_dep, PlatformDockerConstants.compose_project_name(dep_service_name)))
    return dependencies
