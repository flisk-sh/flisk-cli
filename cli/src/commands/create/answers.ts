// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * The `flisk create` prompt and answer flow: which questions are asked, how flags win over
 * questions, and how a flag or a pick is checked against the generator registries.
 */

import {
  type ArrowChoice,
  arrowMultiSelect,
  arrowSelect,
  arrowText,
} from "../../utils/arrow-prompt.js";
import {
  backendCatalog,
  type CatalogOption,
  extraCatalog,
  frontendCatalog,
  type LanguageOption,
  starterCatalog,
} from "../../utils/create-catalog.js";
import {
  type BackendChoice,
  CREATE_RUNTIMES,
  type CreateAnswers,
  type CreateRuntime,
  isEmptyApp,
  isValidProjectName,
  projectNameError,
  toProjectName,
} from "../../utils/create-plan.js";
import { FliskError } from "../../utils/errors.js";
import { suggestClosest } from "../../utils/suggestions.js";

/** The shape of an app: what to ask about. These are choices about the journey, not generators. */
type AppShape = "both" | "web" | "api" | "starter" | "custom";

const SHAPE_CHOICES: ArrowChoice<AppShape>[] = [
  {
    title: "A website that saves and shows information",
    value: "both",
    hint: "Pages people open in a browser, plus the part behind them (default).",
  },
  { title: "Just a website", value: "web", hint: "Pages people open in a browser." },
  {
    title: "Just the part behind the scenes",
    value: "api",
    hint: "A service other programs talk to (an API).",
  },
  {
    title: "A ready-made app to start from…",
    value: "starter",
    hint: "An online shop, an AI helper, a team tool and more.",
  },
  {
    title: "I know what I want: let me choose every part",
    value: "custom",
    hint: "Pick the framework, language and extras yourself.",
  },
];

/** What to do when a program is missing: one link or command a person can follow without knowing the tool. */
const INSTALL_HELP: Record<string, string> = {
  node: "Node.js (also gives you npm): https://nodejs.org",
  npm: "npm comes with Node.js: https://nodejs.org",
  bun: "Bun: curl -fsSL https://bun.sh/install | bash",
  go: "Go: https://go.dev/dl",
  cargo: "Rust: https://rustup.rs",
  python3: "Python: https://www.python.org/downloads",
  uvicorn: "uvicorn: pip install uvicorn",
};

/** How to get each missing program; empty when nothing is missing or nothing is known about it. */
export function installHelp(missing: string[]): string[] {
  return missing.flatMap((program) =>
    INSTALL_HELP[program] ? [`  ${INSTALL_HELP[program]}`] : [],
  );
}

export interface CreateOptions {
  starter?: string;
  runtime?: string;
  frontend?: string;
  backend?: string;
  language?: string;
  extras?: string;
  yes?: boolean;
  dryRun?: boolean;
  start?: boolean;
  json?: boolean;
}

/**
 * A starter decides its own frontend, backend, language and extras. Reject the flags that would
 * otherwise be accepted and silently ignored, naming every one the caller supplied.
 */
function assertNoStarterConflicts(
  options: CreateOptions,
  starters: readonly CatalogOption[],
): void {
  if (!options.starter) return;

  const conflicts: string[] = [];
  for (const [flag, supplied] of [
    ["--frontend", options.frontend !== undefined],
    ["--backend", options.backend !== undefined],
    ["--language", options.language !== undefined],
    ["--extras", options.extras !== undefined && options.extras !== "none"],
  ] as const) {
    if (supplied) conflicts.push(flag);
  }

  const invalidRuntime =
    options.runtime !== undefined && !CREATE_RUNTIMES.includes(options.runtime as CreateRuntime);
  if (options.runtime !== undefined && !invalidRuntime) {
    const runtime = options.runtime as CreateRuntime;
    const starterLocal = starters.find((option) => option.id === options.starter)?.local ?? false;
    const expected: CreateRuntime = starterLocal ? "local" : "docker";
    if (runtime !== expected) conflicts.push(`--runtime ${options.runtime}`);
  }

  if (conflicts.length === 0 && !invalidRuntime) return;
  if (invalidRuntime && conflicts.length === 0) {
    oneOf("runtime", options.runtime as string, CREATE_RUNTIMES);
  }
  const runtimeError = invalidRuntime
    ? ` Unknown --runtime "${options.runtime}". Use one of: ${CREATE_RUNTIMES.join(", ")}.`
    : "";
  throw new FliskError(
    `${conflicts.join(", ")} cannot be combined with --starter: a starter carries its own parts.${runtimeError}`,
    [
      `Remove the conflicting flags (${conflicts.join(", ")}) and retry, keeping the project name and other options you need.`,
      ...(invalidRuntime ? [`Use --runtime ${CREATE_RUNTIMES.join(" or ")}.`] : []),
      "Or drop --starter and choose the parts yourself.",
    ],
  );
}

/** A flag value must be one of the ids the catalog offers; the error lists them. */
function oneOf(flag: string, value: string, ids: readonly string[], extra: string[] = []): string {
  const allowed = [...ids, ...extra];
  if (allowed.includes(value)) return value;
  const similar = suggestClosest(value, ids);
  const hint = similar ? ` Did you mean "${similar}"?` : "";
  throw new FliskError(`Unknown --${flag} "${value}". Use one of: ${allowed.join(", ")}.${hint}`, [
    `flisk create --${flag} ${similar ?? allowed[0] ?? "<id>"}`,
    "Leave the flag out to be asked, or to take the default.",
  ]);
}

/** Whether the command may ask questions: a terminal on both ends, and no `--yes`. */
export function isInteractive(options: CreateOptions, tty: { in: boolean; out: boolean }): boolean {
  return Boolean(tty.in && tty.out && !options.yes);
}

/** Catalog options as menu rows; a Docker-only option is marked and its pick switches the runtime. */
function toChoices(options: CatalogOption[]): ArrowChoice<string>[] {
  return options.map((option, index) => ({
    title: index === 0 ? `${option.title} (default)` : option.title,
    value: option.id,
    hint: `${option.hint}${option.local ? "" : " · needs Docker"}`.trim(),
  }));
}

/** One row per language + framework: picking a row writes the whole stack, so one Enter replaces two questions.
 *
 * The registries bake the language into every label ("Bun + Hono" for the language, "Bun + Express" for the
 * framework), so a row title is exactly the label of what the row is: the default framework keeps the language's
 * label, any other framework keeps its own. A language with no frameworks keeps its label as a bare row.
 */
function backendChoices(catalog: LanguageOption[]): ArrowChoice<string>[] {
  const rows: ArrowChoice<string>[] = [];
  for (const language of catalog) {
    if (language.frameworks.length === 0) {
      rows.push({ title: language.title, value: language.id, hint: language.hint });
      continue;
    }
    for (const [index, framework] of language.frameworks.entries()) {
      const globalDefault = index === 0 && language.id === catalog[0]?.id;
      rows.push({
        title: `${globalDefault ? language.title : framework.title}${globalDefault ? " (default)" : ""}`,
        value: `${language.id}/${framework.id}`,
        hint: language.hint,
      });
    }
  }
  return rows;
}

/** "bun/hono" is the backend answer; a lone id is a language that owns its runtime. */
function splitStackChoice(pick: string): BackendChoice {
  const [language, framework] = pick.split("/");
  return { language, ...(framework ? { framework } : {}) };
}

/** The error for a `--backend` the JavaScript catalog does not know, pointing at `--language` when that is the answer. */
function unknownBackend(framework: string, known: readonly string[]): never {
  // The languages that own their runtime (their `frameworks` is empty) and the servers they usually run.
  const ownRuntime = backendCatalog().filter((entry) => entry.frameworks.length === 0);
  const owner = ownRuntime.find((entry) => entry.serverFrameworks.includes(framework));
  const languageIds = ownRuntime.map((entry) => entry.id).join("|");
  const suggestions = [`flisk create --backend ${known[0] ?? "<id>"}`];
  if (owner) {
    suggestions.push(`For ${owner.title} use: flisk create <name> --language ${owner.id}`);
  }
  if (languageIds) {
    suggestions.push(`For an API in another language use: --language ${languageIds}`);
  }
  suggestions.push("Leave the flag out to be asked, or to take the default.");
  throw new FliskError(
    `Unknown --backend "${framework}". Use one of: ${known.join(", ")}.`,
    suggestions,
  );
}

/** Resolves `--backend` and `--language` into the API choice the catalog allows, or throws with what it allows. */
function resolveBackend(
  framework: string | undefined,
  language: string | undefined,
): BackendChoice | undefined {
  const catalog = backendCatalog();
  const languages = catalog.map((entry) => entry.id);
  const lang = language ? oneOf("language", language, languages) : undefined;
  // A framework names its language: the one that lists it.
  const owner = framework
    ? catalog.find((entry) => entry.frameworks.some((option) => option.id === framework))
    : undefined;
  if (framework) {
    const everyFramework = catalog.flatMap((entry) => entry.frameworks.map((option) => option.id));
    if (!everyFramework.includes(framework)) {
      unknownBackend(framework, everyFramework);
    }
    if (lang && owner && lang !== owner.id) {
      throw new FliskError(`--backend ${framework} runs on ${owner.id}, not ${lang}.`, [
        `Use --language ${owner.id}, or leave --language out.`,
      ]);
    }
    return { language: owner?.id ?? catalog[0]?.id ?? "", framework };
  }
  const chosen = catalog.find((entry) => entry.id === lang) ?? catalog[0];
  if (!chosen) return undefined;
  return {
    language: chosen.id,
    ...(chosen.frameworks[0] && !lang ? { framework: chosen.frameworks[0].id } : {}),
  };
}

/**
 * Collects the answers. A flag wins over a question, and a question is only asked for a part the chosen shape uses. Without a
 * terminal the registries' defaults fill what a flag did not.
 */
export async function collectAnswers(
  nameArg: string | undefined,
  options: CreateOptions,
  interactive: boolean,
): Promise<CreateAnswers> {
  if (nameArg !== undefined && !isValidProjectName(nameArg)) {
    const { message, suggestions } = projectNameError(nameArg);
    throw new FliskError(message, suggestions);
  }

  const starters = starterCatalog();
  const frontends = frontendCatalog();
  const backends = backendCatalog();
  const extrasCatalog = extraCatalog();
  if (options.starter !== undefined) {
    oneOf(
      "starter",
      options.starter,
      starters.map((option) => option.id),
    );
  }
  // Report every starter conflict first, so a --backend none/--language clash cannot hide the others.
  assertNoStarterConflicts(options, starters);
  if (options.backend === "none" && options.language !== undefined) {
    throw new FliskError(
      `--language ${options.language} has no API to apply to: --backend none leaves the API out.`,
      ["Drop --backend none to get an API in that language, or drop --language."],
    );
  }

  const flagged = {
    frontend: options.frontend !== undefined,
    backend: options.backend !== undefined || options.language !== undefined,
  };

  // 1. What to build.
  let shape: AppShape = "both";
  if (options.starter) shape = "starter";
  else if (flagged.frontend || flagged.backend) {
    shape = options.frontend === "none" ? "api" : options.backend === "none" ? "web" : "both";
    if (!flagged.backend && flagged.frontend) shape = options.frontend === "none" ? "api" : "web";
    if (!flagged.frontend && flagged.backend) shape = options.backend === "none" ? "web" : "api";
  } else if (interactive) {
    shape = await arrowSelect<AppShape>({
      message: "What do you want to make?",
      choices: SHAPE_CHOICES,
    });
  }

  // The plain journey picks the framework, language and extras from the registries' defaults; only
  // "let me choose every part" shows those menus.
  const advanced = shape === "custom";
  if (advanced) shape = "both";

  // 2. A starter carries its own parts and its own runtime.
  let starter: string | undefined;
  if (shape === "starter") {
    starter = options.starter
      ? oneOf(
          "starter",
          options.starter,
          starters.map((option) => option.id),
        )
      : await arrowSelect<string>({
          message: "Which starter?",
          filterable: true,
          choices: [...starters]
            .sort((x, y) => Number(y.local) - Number(x.local))
            .map((option) => ({
              title: option.title,
              value: option.id,
              hint: `${option.hint}${option.local ? " · runs on your computer" : " · needs Docker, see its README"}`,
            })),
        });
  }
  const starterLocal = starters.find((option) => option.id === starter)?.local ?? false;

  // 3. How to run it is never asked: starters decide for themselves, extras and Docker-only parts turn
  //    the app into a Docker project, and everything else runs on the computer with --runtime docker as the escape hatch.
  let runtime: CreateRuntime = starter ? (starterLocal ? "local" : "docker") : "local";

  // 4. The website.
  let frontend: string | undefined;
  if (!starter && shape !== "api") {
    if (options.frontend && options.frontend !== "none") {
      frontend = oneOf(
        "frontend",
        options.frontend,
        frontends.map((option) => option.id),
        ["none"],
      );
    } else if (!options.frontend) {
      frontend =
        interactive && advanced
          ? await arrowSelect<string>({
              message: "Which website framework?",
              filterable: true,
              choices: toChoices(frontends),
            })
          : frontends.find((option) => option.local)?.id;
    }
    const picked = frontends.find((option) => option.id === frontend);
    if (picked && !picked.local) runtime = "docker";
  }

  // 5. The API: one menu of language + framework rows, so a stack is chosen with a single Enter.
  let backend: BackendChoice | undefined;
  if (!starter && shape !== "web") {
    if (flagged.backend && options.backend !== "none") {
      backend = resolveBackend(options.backend, options.language);
    } else if (!flagged.backend) {
      if (interactive && advanced) {
        const stack = await arrowSelect<string>({
          message: "Which API stack?",
          filterable: true,
          choices: backendChoices(backends),
        });
        backend = splitStackChoice(stack);
      } else {
        backend = resolveBackend(undefined, undefined);
      }
    }
  }

  // 6. Extras: infrastructure. Empty keeps the app on your computer; a pick makes it a Docker project.
  let extras: string[] = [];
  if (options.extras !== undefined) {
    extras =
      options.extras === "none"
        ? []
        : options.extras
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) =>
              oneOf(
                "extras",
                value,
                extrasCatalog.map((extra) => extra.id),
                ["none"],
              ),
            );
  } else if (interactive && advanced && !starter) {
    extras = await arrowMultiSelect<string>({
      message: "Add anything else?  Leaving it empty runs the app on this computer.",
      choices: extrasCatalog.map((extra) => ({
        title: extra.title,
        value: extra.id,
        hint: extra.hint,
      })),
    });
  }
  if (options.runtime)
    runtime = oneOf("runtime", options.runtime, CREATE_RUNTIMES) as CreateRuntime;
  else if (extras.length > 0 && !starter) runtime = "docker";
  if (runtime === "local" && extras.length > 0 && !starter) {
    throw new FliskError("--extras (queues, databases, workers) need the Docker runtime.", [
      "Use --runtime docker, or leave --extras out to run on your computer.",
    ]);
  }

  // 7. The name comes last and has a default, so a first run is arrows and Enter, never typing.
  let name = nameArg ?? "my-app";
  if (nameArg === undefined && interactive) {
    const typed = await arrowText({
      message: "Project name?",
      initial: "my-app",
      // Anything readable is fine: "My Shop!" becomes the folder my-shop.
      validate: (value) =>
        isValidProjectName(toProjectName(value)) ||
        "Type a name with at least one letter, e.g. my-shop.",
    });
    name = toProjectName(typed ?? "my-app");
  }

  const answers: CreateAnswers = {
    name,
    ...(starter ? { starter } : {}),
    runtime,
    ...(frontend ? { frontend } : {}),
    ...(backend ? { backend } : {}),
    extras,
  };
  if (isEmptyApp(answers)) {
    throw new FliskError("There is nothing to create: no website, no API and no starter.", [
      "Pick a website or an API, or use --starter <name>.",
    ]);
  }
  return answers;
}
