// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VALID_RESOURCE_TYPES } from "../constants.js";
import {
  createKebabCaseValidator,
  deriveProjectName,
  includes,
  isPathSafe,
  isTargetDirSafe,
  isValidPort,
  RESERVED_INFRASTRUCTURE_NAMES,
  RESERVED_STACK_ONLY_NAMES,
  sanitizeForShell,
  TILTIGNORE_RESERVED_NAMES,
  validateOptionalInfraService,
  validateProjectName,
  validateResourceName,
  validateStackName,
} from "../validation.js";

describe("validateResourceName", () => {
  it.each([
    ["hyphenated", "my-service"],
    ["letters and digits", "service123"],
    ["hyphenated gateway", "api-gateway"],
    ["single letter", "a"],
    ["digits and hyphens", "test-123-abc"],
  ])("should validate correct kebab-case name (%s): %s", (_label, name) => {
    expect(validateResourceName(name)).toEqual({ valid: true });
  });

  it("should reject empty names", () => {
    const result = validateResourceName("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject whitespace-only names", () => {
    const result = validateResourceName("   ");
    expect(result.valid).toBe(false);
  });

  it.each([
    ["camelCase", "myService"],
    ["underscores", "my_service"],
    ["uppercase letters", "My-Service"],
    ["spaces", "my service"],
    ["dots", "my.service"],
  ])("should reject %s: %s", (_label, name) => {
    expect(validateResourceName(name).valid).toBe(false);
  });
});

describe("reserved infrastructure names", () => {
  it.each(RESERVED_INFRASTRUCTURE_NAMES)(
    "rejects %s before it can clash with Flisk's stack",
    (name) => {
      const result = validateResourceName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
      expect(result.error).toContain(name);
    },
  );

  it("still accepts a neutral name", () => {
    expect(validateResourceName("cart")).toEqual({ valid: true });
  });

  it("is used by the interactive name validator too", () => {
    expect(createKebabCaseValidator("resource")("traefik")).toContain("reserved");
  });
});

describe("names hidden by the generated .tiltignore", () => {
  // The names from the issue report are covered explicitly so a template edit cannot silently
  // drop them from the reserved list.
  it.each(["logs", "build", "out", "docker", "tmp", "temp", "dist", "coverage"])(
    "rejects %s as a resource name (#5453)",
    (name) => {
      const result = validateResourceName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Tilt ignores any folder named");
      expect(result.error).toContain(name);
      expect(result.error).toContain("Pick another name");
    },
  );

  it.each(TILTIGNORE_RESERVED_NAMES)("rejects %s as a stack name too", (name) => {
    const result = validateStackName(name);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Tilt ignores any folder named");
    expect(result.error).toContain(name);
  });

  it("covers every reserved tilt-ignore name as a resource name", () => {
    for (const name of TILTIGNORE_RESERVED_NAMES) {
      expect(validateResourceName(name).valid, name).toBe(false);
    }
  });

  it("is used by the interactive name validator too", () => {
    expect(createKebabCaseValidator("resource")("logs")).toContain("Tilt ignores");
    expect(createKebabCaseValidator("stack")("dist")).toContain("Tilt ignores");
  });

  it("still accepts a neutral name", () => {
    expect(validateResourceName("logs-service")).toEqual({ valid: true });
    expect(validateStackName("main")).toEqual({ valid: true });
  });
});

describe("reserved infrastructure names as stack names", () => {
  it.each(["platform", "proxy", "database-management", "golden-image"])(
    "rejects %s as a stack name (#5345)",
    (name) => {
      const result = validateStackName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
      expect(result.error).toContain(name);
      expect(result.error).toContain("Pick another name");
    },
  );

  it.each(["traefik", "monitoring", "verdaccio"])(
    "rejects %s as a stack name too — it is already reserved infrastructure",
    (name) => {
      expect(validateStackName(name).valid).toBe(false);
    },
  );

  it("covers every reserved infrastructure name as a stack name", () => {
    for (const name of RESERVED_INFRASTRUCTURE_NAMES) {
      expect(validateStackName(name).valid, name).toBe(false);
    }
    for (const name of RESERVED_STACK_ONLY_NAMES) {
      expect(validateStackName(name).valid, name).toBe(false);
    }
  });

  it("still accepts a neutral name", () => {
    expect(validateStackName("main")).toEqual({ valid: true });
    expect(validateStackName("cart")).toEqual({ valid: true });
  });

  it("is used by the interactive name validator too", () => {
    expect(createKebabCaseValidator("stack")("platform")).toContain("reserved");
  });

  it("does not newly refuse the names as resource names", () => {
    // "platform" and "golden-image" are stack-only reservations: a resource called
    // "platform" lives under its own stack folder and does not collide with services/platform/.
    expect(validateResourceName("platform")).toEqual({ valid: true });
    expect(validateResourceName("golden-image")).toEqual({ valid: true });
  });
});

describe("Windows reserved device names", () => {
  const reserved = [
    "con",
    "prn",
    "aux",
    "nul",
    ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
  ];

  describe.each([
    ["resource", "Resource name", validateResourceName],
    ["stack", "Stack name", validateStackName],
  ])("as a %s name", (_kind, label, validate) => {
    it.each(reserved)("rejects %s", (name) => {
      expect(validate(name)).toEqual({
        valid: false,
        error: `${label} "${name}" is not valid: Windows reserves it for a device (con, prn, aux, nul, com1-com9, lpt1-lpt9), so the folder cannot exist there. Pick another name, e.g. "console".`,
      });
    });
  });

  it.each(["console", "nulls", "connect"])("still accepts %s", (name) => {
    expect(validateResourceName(name)).toEqual({ valid: true });
    expect(validateStackName(name)).toEqual({ valid: true });
  });
});

describe("createKebabCaseValidator", () => {
  it("should return true for valid resource names", () => {
    const validator = createKebabCaseValidator("resource");
    expect(validator("my-resource")).toBe(true);
  });

  it("should return error for empty resource name", () => {
    const validator = createKebabCaseValidator("resource");
    expect(validator("")).toBe("Resource name is required");
  });

  it("should return error for invalid resource name", () => {
    const validator = createKebabCaseValidator("resource");
    expect(validator("MyResource")).toBe(
      'Resource name "MyResource" is not valid. Use lowercase letters, numbers, and hyphens only, e.g. "my-service".',
    );
  });

  it("should return error for empty stack name", () => {
    const validator = createKebabCaseValidator("stack");
    expect(validator("")).toBe("Stack name is required");
  });

  it("should return error for invalid stack name", () => {
    const validator = createKebabCaseValidator("stack");
    expect(validator("MyStack")).toBe(
      'Stack name "MyStack" is not valid. Use lowercase letters, numbers, and hyphens only, e.g. "my-stack".',
    );
  });
});

describe("validateStackName", () => {
  it("accepts kebab-case names", () => {
    expect(validateStackName("my-stack")).toEqual({ valid: true });
    expect(validateStackName("shop2")).toEqual({ valid: true });
  });

  it("rejects a name ending in an 8-hex segment, which would look like a worktree database suffix", () => {
    expect(validateStackName("api-deadbee5").valid).toBe(false);
    expect(validateStackName("api-deadbee").valid).toBe(true);
  });

  it("rejects spaces and capitals, naming the value and giving an example", () => {
    expect(validateStackName("Bad Stack")).toEqual({
      valid: false,
      error:
        'Stack name "Bad Stack" is not valid. Use lowercase letters, numbers, and hyphens only, e.g. "my-stack".',
    });
    expect(validateStackName("a/b").valid).toBe(false);
  });

  it("rejects a name that starts or ends with a hyphen, such as an option taken as a value", () => {
    for (const name of ["--json", "-x", "x-", "-", "--"]) {
      expect(validateStackName(name).valid, name).toBe(false);
      expect(validateResourceName(name).valid, name).toBe(false);
    }
    expect(validateStackName("a-b--c").valid).toBe(true);
  });

  it("requires a name", () => {
    expect(validateStackName("  ")).toEqual({ valid: false, error: "Stack name is required" });
  });
});

describe("validateOptionalInfraService", () => {
  it.each([
    ["monitoring", "monitoring"],
    ["elk", "elk"],
    ["debezium", "debezium"],
    ["golden image", "golden_image"],
  ])("should accept valid infra service (%s): %s", (_label, service) => {
    expect(validateOptionalInfraService(service).valid).toBe(true);
  });

  it("should reject invalid infra services", () => {
    const result = validateOptionalInfraService("redis");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid service");
  });

  it("should reject empty string", () => {
    expect(validateOptionalInfraService("").valid).toBe(false);
  });
});

describe("isValidPort", () => {
  it.each([
    ["lowest number", 1],
    ["1024", 1024],
    ["3000", 3000],
    ["8080", 8080],
    ["highest number", 65535],
    ["lowest string", "1"],
    ["string 1024", "1024"],
    ["string 3000", "3000"],
    ["string 8080", "8080"],
    ["string 10350", "10350"],
    ["highest string", "65535"],
  ])("should accept valid port (%s): %s", (_label, port) => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([
    ["number 0", 0],
    ["negative number", -1],
    ["number above 65535", 65536],
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["non-integer number", 80.5],
    ["string 0", "0"],
    ["leading zero '01'", "01"],
    ["leading zeros '00123'", "00123"],
    ["string above 65535", "65536"],
    ["large string port", "99999"],
    ["six-digit string port", "100000"],
    ["empty string", ""],
    ["whitespace string", "   "],
    ["string with leading space", " 10350"],
    ["string with trailing space", "10350 "],
    ["non-numeric string", "abc"],
    ["negative string", "-1"],
    ["decimal string", "80.5"],
  ])("should reject %s: %j", (_label, port) => {
    expect(isValidPort(port)).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["boolean", true],
    ["object", { port: 3000 }],
  ])("should reject a value that is neither number nor string (%s)", (_label, port) => {
    expect(isValidPort(port as unknown as number)).toBe(false);
  });
});

describe("sanitizeForShell", () => {
  it("should replace special characters", () => {
    expect(sanitizeForShell("hello$world")).toBe("hello_world");
  });

  it("should keep alphanumeric and hyphens", () => {
    expect(sanitizeForShell("my-service-123")).toBe("my-service-123");
  });

  it("should limit output to 100 chars", () => {
    const long = "a".repeat(200);
    expect(sanitizeForShell(long).length).toBe(100);
  });
});

describe("isPathSafe", () => {
  it("accepts ordinary names and relative paths", () => {
    expect(isPathSafe("my-service")).toBe(true);
    expect(isPathSafe("a/b")).toBe(true);
  });

  it.each(["\0", "<", ">", ":", '"', "|", "?", "*"])(
    "rejects unsafe path character %j",
    (character) => {
      expect(isPathSafe(character)).toBe(false);
    },
  );

  it.each(["a\0b", "../a\0", "a/b\0", "\0../escape"])(
    "rejects NUL anywhere in the path: %j",
    (path) => {
      expect(isPathSafe(path)).toBe(false);
    },
  );

  it.each(["C:\\temp\\x", "a:b", "build/out<1>"])(
    "rejects reserved characters in a Windows-style or mixed path: %j",
    (path) => {
      expect(isPathSafe(path)).toBe(false);
    },
  );

  // isPathSafe only screens characters. Traversal and absolute paths are not
  // branches of this function: callers resolve the path against the project
  // root and check the relative result (see resource.ts). These cases pin that
  // contract so a change to it is deliberate.
  it.each(["../escape", "a/../../b", "/etc/passwd", "", "a\\b", "..\\..\\x"])(
    "leaves traversal, absolute and separator checks to callers: %j",
    (path) => {
      expect(() => isPathSafe(path)).not.toThrow();
      expect(isPathSafe(path)).toBe(true);
    },
  );
});

describe("includes", () => {
  const resourceTypes = ["backend", "worker"] as const;

  it("returns true for a member and false for a non-member", () => {
    expect(includes(resourceTypes, "backend")).toBe(true);
    expect(includes(resourceTypes, "frontend")).toBe(false);
  });

  it("narrows a string to the readonly array's element type", () => {
    const candidate: string = "worker";
    if (!includes(resourceTypes, candidate)) {
      throw new Error("Expected candidate to be a resource type");
    }

    const narrowed: (typeof resourceTypes)[number] = candidate;
    expect(narrowed).toBe("worker");
  });
});

describe("VALID_RESOURCE_TYPES", () => {
  it("should include all expected types", () => {
    const expected = [
      "backend",
      "frontend",
      "library",
      "sdk",
      "worker",
      "migrator",
      "mcp",
      "agent",
      "database",
      "bring-your-own",
    ];
    expect(VALID_RESOURCE_TYPES.sort()).toEqual(expected.sort());
  });
});

describe("name length (found by FALSIFIER: a 64-character name was scaffolded)", () => {
  it("accepts 63 characters and rejects 64 for resources and stacks", () => {
    expect(validateResourceName("x".repeat(63)).valid).toBe(true);
    expect(validateStackName("x".repeat(63)).valid).toBe(true);
    for (const validate of [validateResourceName, validateStackName]) {
      const result = validate("x".repeat(64));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("64 characters");
    }
  });
});

describe("deriveProjectName", () => {
  it("derives a safe name from spaces, capitals and dots", () => {
    expect(deriveProjectName("My App.v2")).toBe("my-app-v2");
  });

  it("keeps already-valid names", () => {
    expect(deriveProjectName("my-project")).toBe("my-project");
    expect(deriveProjectName("service123")).toBe("service123");
  });

  it("uses a stable path hash when no ASCII letters or digits remain", () => {
    const first = deriveProjectName("!!!", resolve("/projects/first"));
    const second = deriveProjectName("...", resolve("/projects/second"));

    expect(first).toMatch(/^project-[0-9a-f]{8}$/);
    expect(second).toMatch(/^project-[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
    expect(validateProjectName(first).valid).toBe(true);
    expect(validateProjectName(second).valid).toBe(true);
  });

  it("gives different non-ASCII folder names different project and Compose names", () => {
    const cyrillic = deriveProjectName("магазин", resolve("/projects/магазин"));
    const chinese = deriveProjectName("店铺", resolve("/projects/店铺"));

    expect(cyrillic).not.toBe("my-project");
    expect(chinese).not.toBe("my-project");
    expect(cyrillic).not.toBe(chinese);
    expect(cyrillic.replace(/-/g, "_")).not.toBe(chinese.replace(/-/g, "_"));
  });

  it("lowercases capital letters", () => {
    expect(deriveProjectName("MyProject")).toBe("myproject");
  });

  it("prefixes a digit-leading slug so it is a valid Postgres identifier", () => {
    expect(deriveProjectName("123 shop")).toBe("p-123-shop");
    expect(deriveProjectName("123")).toBe("p-123");
    expect(validateProjectName(deriveProjectName("123 shop")).valid).toBe(true);
  });

  it("uses a stable path hash for empty input too", () => {
    const first = deriveProjectName("", resolve("/projects/empty"));
    const second = deriveProjectName("   ", resolve("/projects/spaces"));

    expect(first).toMatch(/^project-[0-9a-f]{8}$/);
    expect(second).toMatch(/^project-[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
  });

  it("truncates long derived names to 63 characters", () => {
    expect(deriveProjectName("a".repeat(70))).toBe("a".repeat(63));
  });

  it("trims a trailing dash left after truncation", () => {
    expect(deriveProjectName(`${"a".repeat(62)} b`)).toBe("a".repeat(62));
  });
});

describe("validateProjectName", () => {
  it("accepts valid project names", () => {
    expect(validateProjectName("my-project")).toEqual({ valid: true });
    expect(validateProjectName("a")).toEqual({ valid: true });
  });

  it("rejects invalid project names", () => {
    expect(validateProjectName("My App.v2")).toEqual({
      valid: false,
      error:
        'Project name "My App.v2" is not valid. Use lowercase letters, numbers, and hyphens only, e.g. "my-project".',
    });
    expect(validateProjectName("Bad_Name").valid).toBe(false);
    expect(validateProjectName("").valid).toBe(false);
  });

  it("rejects a project name longer than 63 characters", () => {
    const result = validateProjectName("a".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("64 characters");
  });
});

describe("isTargetDirSafe", () => {
  it.each([
    "D:\\a\\_temp\\flisk-windows-live\\demo project",
    "C:/Users/me/demo",
    "c:\\x",
    "demo",
    "../demo",
    "/home/me/demo",
  ])("accepts a destination directory: %j", (path) => {
    expect(isTargetDirSafe(path)).toBe(true);
  });

  it.each([
    "a:b",
    "C::\\x",
    "1:\\x",
    "C:",
    "C:x",
    "D:\\a<b",
    "D:\\a\0b",
    "D:\\what?",
    "x\\C:\\y",
    ":\\x",
  ])("still rejects anything but a leading drive prefix: %j", (path) => {
    expect(isTargetDirSafe(path)).toBe(false);
  });

  it("leaves isPathSafe strict for paths that must stay inside the project", () => {
    expect(isPathSafe("C:\\temp\\x")).toBe(false);
  });
});
