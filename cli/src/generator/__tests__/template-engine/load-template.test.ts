// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import type { ProjectConfig } from "./test-support.js";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  fs,
  generateDatabaseManagementCompose,
  it,
  loadTemplate,
  os,
  path,
  projectConfig,
  REAL_TEMPLATES,
  readEngine,
  TemplateEngine,
} from "./test-support.js";

describe("loadTemplate", () => {
  for (const [filename, marker] of Object.entries(REAL_TEMPLATES)) {
    it(`should load ${filename} and return its own content`, () => {
      const content = loadTemplate(filename);
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain(marker);
    });
  }

  it("should return distinct content for each template (not the same file/dir every time)", () => {
    const contents = Object.keys(REAL_TEMPLATES).map((filename) => loadTemplate(filename));
    expect(new Set(contents).size).toBe(contents.length);
  });

  it("Tiltfile passes the golden-layers resource to app resources via TILT_CONTEXT", () => {
    // Regression: Infra.load_all() returns the golden-layers-build resource name, and app
    // and migrator resources add it to resource_deps only if ctx['golden_image_resource']
    // is set. The template dropped it, so service image builds started before their base
    // images existed, failed with "pull access denied", and Tilt never retried - a clean
    // machine 404'd forever while any machine that had built the layers before worked.
    const tiltfile = loadTemplate("Tiltfile.hbs");
    expect(tiltfile).toMatch(/GOLDEN_IMAGE_RESOURCE\s*=\s*Infra\.load_all\(/);
    expect(tiltfile).toMatch(/'golden_image_resource':\s*GOLDEN_IMAGE_RESOURCE/);
    expect(tiltfile).toMatch(/'focus_mode':\s*FOCUS_MODE/);
    expect(tiltfile).toMatch(/'focus_enabled_resources':\s*FOCUS_ENABLED_RESOURCES/);
  });

  it("focus mode enables a frontend's -typecheck resource alongside the service", () => {
    // Regression: the <service>-typecheck resource is registered by the engine for a frontend with
    // the standard `tsc && vite build` script. Focus mode only enables names it knows, so the template
    // must name the same resource (from the same FrontendBuildPlan) and enable it with its service.
    // Otherwise Tilt shows the typecheck as disabled and it never runs.
    const tiltfile = loadTemplate("Tiltfile.hbs");
    expect(tiltfile).toMatch(/'FrontendBuildPlan',/);
    expect(tiltfile).toMatch(/_KNOWN_TILT_RESOURCES\.add\(_KNOWN_RES_NAME \+ '-typecheck'\)/);
    expect(tiltfile).toMatch(/if _R \+ '-typecheck' in _KNOWN_TILT_RESOURCES:/);
    expect(tiltfile).toMatch(/if _STACK_RES_NAME \+ '-typecheck' in _KNOWN_TILT_RESOURCES:/);
  });

  it("standalone Traefik only starts sablier and wake-gateway when Sablier is licensed", () => {
    // Regression: the standalone compose always started the sablier container (read-write
    // Docker socket), built and ran the wake gateway, and had Traefik download the Sablier
    // plugin from GitHub - for every free-tier user, who cannot use any of it. The license
    // only gated the per-service labels. (Verified by loading the Tiltfile: free tier
    // renders only `traefik`; forcing the flag on renders all three.)
    const compose = readEngine("topologies/platform/docker/compose/traefik_standalone.star");
    expect(compose).toMatch(
      /def generate_standalone_traefik_compose\(sablier_enabled\s*=\s*False,\s*http_host_port\s*=\s*"8080",\s*https_host_port\s*=\s*"8443",\s*bind_address\s*=\s*"127\.0\.0\.1"\)/,
    );
    for (const marker of ["  sablier:\n", "  wake-gateway:\n", "--experimental.plugins.sablier"]) {
      const at = compose.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      const guard = compose.lastIndexOf("_SABLIER_", at);
      // each only lives inside a _SABLIER_* constant, which is emitted conditionally
      expect(guard, marker).toBeGreaterThan(-1);
      expect(compose.slice(0, guard)).toContain("def generate_standalone_traefik_compose");
    }
    expect(compose).toMatch(/if sablier_enabled else ""/);

    const loader = readEngine("topologies/tilt/resources/infra-loader.star");
    expect(loader).toMatch(
      /generate_standalone_traefik_compose\(\s*sablier_enabled,\s*os\.environ\.get\('FLISK_HTTP_PORT', '8080'\),\s*os\.environ\.get\('FLISK_HTTPS_PORT', '8443'\),\s*os\.environ\.get\('FLISK_BIND_ADDRESS', '127\.0\.0\.1'\),?\s*\)/,
    );
    expect(loader).toMatch(/sablier_middleware_suffix\(\{"sablier":\s*\{"enable":\s*True\}\}/);
  });

  it("published dev ports bind to loopback unless FLISK_BIND_ADDRESS opts in", () => {
    // Regression (GHSA-3hj3-f39v-j2x5): a `ports:` entry with no host IP makes Docker bind
    // 0.0.0.0, so Traefik (80/443), the Postgres port and the Traefik API were reachable by
    // anyone on the same network. Dev ports now default to 127.0.0.1.
    const traefik = readEngine("topologies/platform/docker/compose/traefik_standalone.star");
    expect(traefik).toContain('"{bind_address}:{http_host_port}:80"');
    expect(traefik).toContain('"{bind_address}:{https_host_port}:443"');
    expect(traefik).not.toContain("--api.insecure=true");

    const loader = readEngine("topologies/tilt/resources/infra-loader.star");
    expect(loader).toContain('"{bind_address}:{host_port}:5432"');
    expect(loader).toMatch(/os\.environ\.get\('FLISK_BIND_ADDRESS', '127\.0\.0\.1'\)/);

    const postgres = generateDatabaseManagementCompose({
      project: { name: "port_test", version: "1.0.0" },
    } as ProjectConfig);
    expect(postgres).toContain(
      '"$' + "{FLISK_BIND_ADDRESS:-127.0.0.1}:$" + '{FLISK_POSTGRES_PORT:-15432}:5432"',
    );
  });

  it("focus mode keeps the discovery daemon enabled, or a new service.json never reloads a running Tilt", () => {
    // Found by a real `flisk up` (tests/chaos): every `flisk up` is a focus run, set_enabled_resources() disables whatever it
    // does not list, and the daemon was not listed. It was created but stayed Disabled, so scaffolding a service while the stack
    // ran changed nothing until some other watched file was edited.
    const tiltfile = loadTemplate("Tiltfile.hbs");
    const focusBlock = tiltfile.slice(
      tiltfile.indexOf("if FOCUS_MODE and FOCUS_ENABLED_RESOURCES:"),
    );

    expect(focusBlock).toMatch(
      /if _AUTO_DISCOVER_ENABLED:\s*\n\s*_ALWAYS_ENABLED_INFRA_RESOURCES\.append\('service-discovery-daemon'\)/,
    );
    // Only when the daemon is registered: enabling a name Tilt never registered fails Tiltfile evaluation.
    const daemonBlock = tiltfile.slice(tiltfile.indexOf("# 👁️ AUTO-DISCOVERY DAEMON"));
    expect(daemonBlock).toMatch(/^if _AUTO_DISCOVER_ENABLED:\s*\n/m);
    expect(daemonBlock).toContain("watch_file('snapshots/resource-snapshot.json')");
  });

  it("writes the first resource snapshot during the load, so a clean start does not reload the Tiltfile (#4128)", () => {
    // The daemon wrote the first snapshot after Tilt watched it, and every clean start (each `flisk demo`) evaluated the
    // whole Tiltfile twice: 46.8 s on a cold demo start. The first snapshot must exist before watch_file, and writing it must
    // never fail the load, because a missing Python only stops the daemon.
    const tiltfile = loadTemplate("Tiltfile.hbs");
    const daemonBlock = tiltfile.slice(tiltfile.indexOf("# 👁️ AUTO-DISCOVERY DAEMON"));
    const save = daemonBlock.indexOf('python3 "$2" save');
    const watch = daemonBlock.indexOf("watch_file('snapshots/resource-snapshot.json')");

    expect(save).toBeGreaterThan(-1);
    expect(save).toBeLessThan(watch);
    expect(daemonBlock).toContain(
      "if not os.path.exists(config.main_dir + '/snapshots/resource-snapshot.json'):",
    );
    expect(daemonBlock).toContain("save >/dev/null 2>&1 || true");
    expect(daemonBlock).toMatch(/save \*> \$null \}; exit 0/);
  });

  it("focus mode always enables nats and every messaging-compose service, not just the hardcoded infra names", () => {
    // Regression (flisk#155): pre-alpha always exercises this focus
    // branch (see the FOCUS_MODE comment above it), and its always-enabled
    // infra list only re-added init-networks/postgres/traefik/golden-layers-build
    // to config.set_enabled_resources(). A resource with "nats" in
    // featuresEnabled built and started, then retried its broker connection
    // forever, because the "nats" Tilt resource itself stayed Disabled. Any
    // other service in services/platform/messaging/docker-compose.yml (e.g. a
    // local mail catcher) was disabled the same way.
    const tiltfile = loadTemplate("Tiltfile.hbs");
    const focusBlock = tiltfile.slice(
      tiltfile.indexOf("if FOCUS_MODE and FOCUS_ENABLED_RESOURCES:"),
    );

    expect(focusBlock).toMatch(
      /_ALWAYS_ENABLED_INFRA_RESOURCES\s*=\s*\[\s*'init-networks',\s*'traefik',\s*'golden-layers-build',?\s*\]/,
    );
    // A filtered feature-off run can have no Postgres resource. Passing an
    // unregistered name to set_enabled_resources makes Tiltfile evaluation fail.
    expect(focusBlock).toMatch(
      /if should_enable\('database-management'\) or TILT_CONTEXT\.get\('_shared_platform_postgres_force_started', False\):\s*\n\s*_ALWAYS_ENABLED_INFRA_RESOURCES\.append\('postgres'\)/,
    );
    // Read from the messaging compose file, not a second hardcoded list, so a
    // service added to that file later (mailpit, a mail catcher, ...) is
    // covered without another Tiltfile.hbs change.
    expect(focusBlock).toMatch(/read_yaml\(_messaging_compose_path,\s*default=\{\}\)/);
    expect(focusBlock).toMatch(/_messaging_compose_doc\.get\('services',\s*\{\}\)\.keys\(\)/);
    expect(focusBlock).toContain("_ALWAYS_ENABLED_INFRA_RESOURCES.append(_messaging_svc_name)");
    expect(focusBlock).toContain("_ALWAYS_ENABLED_INFRA_RESOURCES.append('nats')");
    // The `-image` prebuild only exists when deferStart is active (licensed);
    // enabling a name Tilt never registered fails `tilt up`.
    expect(focusBlock).toMatch(
      /if _STACK_RES_NAME \+ '-image' in _DEFERRED_IMAGE_RESOURCES:\s*\n\s*_FILTERED_RESOURCES\.append\(_STACK_RES_NAME \+ '-image'\)/,
    );
    expect(tiltfile).toContain("if resource_defers_start(_KNOWN_RES_MANIFEST) and");
    // `_manifest` is the original service.json, which has no `syncs` unless written by hand; the
    // resource carries the normalized default that registration uses. Gating on the original left a
    // scaffolded deferStart service's `-image` registered but never enabled (#1235).
    expect(tiltfile).toContain("and _KNOWN_RES.get('syncs'):");
    expect(tiltfile).not.toContain("_KNOWN_RES_MANIFEST.get('syncs')");
    // Config.apply_focus expands a stack target into concrete service
    // resources before this template filter sees it. Deferred image
    // prebuilds must follow that concrete-resource path too.
    expect(tiltfile).toMatch(/_DEFERRED_IMAGE_RESOURCES\.add\(_KNOWN_RES_NAME \+ '-image'\)/);
    expect(focusBlock).toMatch(
      /if _R \+ '-image' in _DEFERRED_IMAGE_RESOURCES:\s*\n\s*_FILTERED_RESOURCES\.append\(_R \+ '-image'\)/,
    );
    // Both must land in the list Tilt is actually told to enable.
    const alwaysBlockEnd = focusBlock.indexOf("for _KR in _KNOWN_TILT_RESOURCES:");
    expect(focusBlock.slice(0, alwaysBlockEnd)).toMatch(
      /for _INFRA in _ALWAYS_ENABLED_INFRA_RESOURCES:\s*\n\s*_FILTERED_RESOURCES\.append\(_INFRA\)/,
    );
  });

  it("should throw (not silently return directory bytes) for non-existent template", () => {
    expect(() => loadTemplate("non-existent.hbs")).toThrow("Failed to load template");
  });

  it("includes the read error for each attempted location when a template is missing", () => {
    expect(() => loadTemplate("non-existent.hbs")).toThrow(/ENOENT/);
  });

  it.skipIf(process.platform === "win32")(
    "reports a directory read error instead of only listing attempted paths",
    () => {
      expect(() => loadTemplate(".")).toThrow(/EISDIR/);
    },
  );

  describe("executable-relative fallback (compiled binary layout)", () => {
    let fakeExecDir: string;
    let originalExecPath: string;

    beforeEach(() => {
      // Mirrors what scripts/release-binaries.sh bundles next to the
      // compiled binary: <exeDir>/flisk-cli/cli/templates/<filename>.
      fakeExecDir = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-exec-"));
      const bundledTemplatesDir = path.join(fakeExecDir, "flisk-cli", "cli", "templates");
      fs.mkdirSync(bundledTemplatesDir, { recursive: true });
      fs.writeFileSync(path.join(bundledTemplatesDir, "only-in-bundle.hbs"), "bundled-marker");

      originalExecPath = process.execPath;
      Object.defineProperty(process, "execPath", {
        value: path.join(fakeExecDir, "flisk"),
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, "execPath", {
        value: originalExecPath,
        configurable: true,
      });
      fs.rmSync(fakeExecDir, { recursive: true, force: true });
    });

    it("finds a template that only exists next to the executable", () => {
      expect(loadTemplate("only-in-bundle.hbs")).toBe("bundled-marker");
    });
  });

  it("renders from an explicit templates directory instead of the bundled one", () => {
    const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-custom-templates-"));
    try {
      fs.writeFileSync(path.join(templatesDir, "Tiltfile.hbs"), "custom tilt for {{project.name}}");
      const engine = new TemplateEngine(templatesDir);
      expect(engine.generateTiltfile(engine.buildContext(projectConfig()))).toBe(
        "custom tilt for test-project",
      );
    } finally {
      fs.rmSync(templatesDir, { recursive: true, force: true });
    }
  });

  it("throws Template not found when neither the templates directory nor the embedded copy has it", () => {
    const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), "flisk-empty-templates-"));
    try {
      const engine = new TemplateEngine(templatesDir) as unknown as {
        loadTemplate(templateName: string): unknown;
      };
      expect(() => engine.loadTemplate("missing-template")).toThrow(
        `Template not found: ${path.join(templatesDir, "missing-template.hbs")}`,
      );
    } finally {
      fs.rmSync(templatesDir, { recursive: true, force: true });
    }
  });
});
