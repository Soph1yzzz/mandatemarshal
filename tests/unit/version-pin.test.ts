import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expectedPluginCacheSource,
  inspectMandateMarshalPin,
  inspectMandateMarshalVersion,
  maybeDelegateToPinnedCli,
  parseSkillVersion,
  pinMandateMarshal,
  readPinRecord,
  resolveCodexBin,
  type PinCommandRunner,
} from "../../src/runtime/version-pin";

function skillContent(version: string, suffix = ""): string {
  return `---\nname: mandatemarshal\nversion: "${version}"\n---\n${suffix}`;
}

function releaseFetch(targetVersion: string, targetSkillVersion = targetVersion): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) {
      return new Response(JSON.stringify({ tag_name: `v${targetVersion}` }), { status: 200 });
    }
    if (url.includes("/releases/tags/")) {
      return new Response(JSON.stringify({ tag_name: `v${targetVersion}` }), { status: 200 });
    }
    if (url.endsWith("/.codex-plugin/plugin.json")) {
      return new Response(JSON.stringify({ name: "mandatemarshal", version: targetVersion }), { status: 200 });
    }
    if (url.endsWith("/skills/orchestration/SKILL.md")) {
      const match = url.match(/\/v([^/]+)\/skills\/orchestration\/SKILL\.md$/u);
      const requestedVersion = match?.[1] ?? targetVersion;
      const version = requestedVersion === targetVersion ? targetSkillVersion : requestedVersion;
      return new Response(skillContent(version), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function preparePluginCache(
  codexHome: string,
  version: string,
  skill = skillContent(version).replace(/\n/gu, "\r\n"),
): Promise<string> {
  const cache = expectedPluginCacheSource(version, undefined, codexHome);
  await mkdir(join(cache, ".codex-plugin"), { recursive: true });
  await mkdir(join(cache, "skills", "mandatemarshal"), { recursive: true });
  await writeFile(
    join(cache, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "mandatemarshal", version })}\n`,
    "utf8",
  );
  await writeFile(join(cache, "skills", "mandatemarshal", "SKILL.md"), skill, "utf8");
  return cache;
}

function runnerFor(
  version: string,
  marketplaceRoot: string,
  calls: string[][],
  initial: { installed?: boolean; marketplace?: boolean } = {},
): PinCommandRunner {
  let installed = initial.installed ?? false;
  let marketplace = initial.marketplace ?? false;
  return async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "plugin" && args[1] === "list") {
      return {
        code: 0,
        stdout: JSON.stringify({
          installed: installed
            ? [
                {
                  pluginId: "mandatemarshal@mandatemarshal",
                  version,
                  source: { source: "local", path: join(marketplaceRoot, "plugins", "mandatemarshal") },
                },
              ]
            : [],
        }),
        stderr: "",
      };
    }
    if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
      return {
        code: 0,
        stdout: JSON.stringify({ marketplaces: marketplace ? [{ name: "mandatemarshal", root: marketplaceRoot }] : [] }),
        stderr: "",
      };
    }
    if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
      marketplace = true;
      return {
        code: 0,
        stdout: JSON.stringify({ marketplaceName: "mandatemarshal", installedRoot: marketplaceRoot }),
        stderr: "",
      };
    }
    if (args[0] === "plugin" && args[1] === "add") {
      installed = true;
      return { code: 0, stdout: "{}", stderr: "" };
    }
    if (args[0] === "plugin" && args[1] === "remove") {
      if (!installed) return { code: 1, stdout: "", stderr: "not installed" };
      installed = false;
      return { code: 0, stdout: "{}", stderr: "" };
    }
    if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "remove") {
      if (!marketplace) return { code: 1, stdout: "", stderr: "not configured" };
      marketplace = false;
      return { code: 0, stdout: "{}", stderr: "" };
    }
    return { code: 0, stdout: "{}", stderr: "" };
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
  }
}

describe("MandateMarshal version pinning", () => {
  test("pins an explicit release and records the exact Codex versioned plugin cache as canonical", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-home-"));
    const codexHome = join(home, ".codex");
    const marketplaceRoot = join(home, "codex-marketplace");
    const cache = await preparePluginCache(codexHome, "0.2.4");
    const calls: string[][] = [];
    const record = await pinMandateMarshal("v0.2.4", {
      home,
      codexHome,
      codexBin: "codex-test",
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", marketplaceRoot, calls),
      now: () => new Date("2026-09-03T10:00:00.000Z"),
    });

    expect(record.schemaVersion).toBe(2);
    expect(record.version).toBe("0.2.4");
    expect(record.ref).toBe("v0.2.4");
    expect(record.marketplaceSource).toBe(marketplaceRoot);
    expect(record.runtimeSource).toBe(marketplaceRoot);
    expect(record.pluginCacheSource).toBe(cache);
    expect(calls).toContainEqual([
      "codex-test",
      "plugin",
      "marketplace",
      "add",
      "Soph1yzzz/mandatemarshal",
      "--ref",
      "v0.2.4",
      "--json",
    ]);
    expect(calls).toContainEqual(["codex-test", "plugin", "add", "mandatemarshal@mandatemarshal", "--json"]);
    expect((await readPinRecord(home, codexHome))?.pluginCacheSource).toBe(cache);
  });

  test("latest resolves once and records the exact released version", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-latest-"));
    const codexHome = join(home, ".codex");
    await preparePluginCache(codexHome, "0.2.4");
    const calls: string[][] = [];
    const record = await pinMandateMarshal("latest", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", join(home, "marketplace"), calls),
    });
    expect(record.version).toBe("0.2.4");
    expect(record.ref).toBe("v0.2.4");
  });

  test("refuses version-skewed Skill metadata before changing Codex installation state", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-skew-"));
    const calls: string[][] = [];
    await expect(
      pinMandateMarshal("0.2.4", {
        home,
        fetchImpl: releaseFetch("0.2.4", "0.2.3"),
        runner: runnerFor("0.2.4", join(home, "marketplace"), calls),
      }),
    ).rejects.toThrow("PIN_TARGET_VERSION_MISMATCH");
    expect(calls).toEqual([]);
  });

  test("version info reports plugin cache Skill as canonical and requires no legacy Skill", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-version-info-"));
    const codexHome = join(home, ".codex");
    const marketplaceRoot = join(home, "marketplace");
    await preparePluginCache(codexHome, "0.2.4");
    await pinMandateMarshal("0.2.4", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", marketplaceRoot, []),
    });

    const info = await inspectMandateMarshalVersion({
      home,
      codexHome,
      runner: runnerFor("0.2.4", marketplaceRoot, [], { installed: true, marketplace: true }),
    });
    expect(info).toEqual({
      version: "0.2.4",
      pinStatus: "pinned",
      pinnedVersion: "0.2.4",
      installedPluginVersion: "0.2.4",
      pluginCacheVersion: "0.2.4",
      pluginCacheSkillVersion: "0.2.4",
      legacySkillVersion: null,
      aligned: true,
    });
  });

  test("status reports drift when Codex has a different installed plugin version", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-drift-"));
    const codexHome = join(home, ".codex");
    const marketplaceRoot = join(home, "marketplace");
    await preparePluginCache(codexHome, "0.2.4");
    await pinMandateMarshal("0.2.4", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", marketplaceRoot, []),
    });

    const status = await inspectMandateMarshalPin({
      home,
      codexHome,
      runner: runnerFor("0.2.3", marketplaceRoot, [], { installed: true, marketplace: true }),
    });
    expect(status.status).toBe("drifted");
    expect(status.record?.version).toBe("0.2.4");
    expect(status.installedPluginVersion).toBe("0.2.3");
    expect(status.pluginCacheVersion).toBe("0.2.4");
    expect(status.pluginCacheSkillVersion).toBe("0.2.4");
    expect(status.legacySkillVersion).toBeNull();
  });

  test("pin removes an exact legacy MandateMarshal Skill after proving release provenance", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-legacy-clean-"));
    const codexHome = join(home, ".codex");
    const legacyDir = join(codexHome, "skills", "mandatemarshal");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "SKILL.md"),
      skillContent("0.2.3").replace(/\n/gu, "\r\n"),
      "utf8",
    );
    await writeFile(join(legacyDir, "user-note.txt"), "preserve me\n", "utf8");
    await preparePluginCache(codexHome, "0.2.4");

    await pinMandateMarshal("0.2.4", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", join(home, "marketplace"), []),
    });

    expect(await pathExists(join(legacyDir, "SKILL.md"))).toBeFalse();
    expect(await pathExists(legacyDir)).toBeTrue();
    expect(await readFile(join(legacyDir, "user-note.txt"), "utf8")).toBe("preserve me\n");
    const status = await inspectMandateMarshalPin({
      home,
      codexHome,
      runner: runnerFor("0.2.4", join(home, "marketplace"), [], { installed: true, marketplace: true }),
    });
    expect(status.status).toBe("pinned");
    expect(status.legacySkillVersion).toBeNull();
  });

  test("customized legacy Skill blocks pinning before Codex installation state is changed", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-legacy-conflict-"));
    const codexHome = join(home, ".codex");
    const legacyDir = join(codexHome, "skills", "mandatemarshal");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "SKILL.md"), skillContent("0.2.3", "customized\n"), "utf8");
    const calls: string[][] = [];

    await expect(
      pinMandateMarshal("0.2.4", {
        home,
        codexHome,
        fetchImpl: releaseFetch("0.2.4"),
        runner: runnerFor("0.2.4", join(home, "marketplace"), calls),
      }),
    ).rejects.toThrow("LEGACY_SKILL_CONFLICT");
    expect(calls).toEqual([]);
    expect(await pathExists(legacyDir)).toBeTrue();
  });

  test("missing canonical versioned plugin cache fails closed instead of searching other copies", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-cache-missing-"));
    const codexHome = join(home, ".codex");
    await expect(
      pinMandateMarshal("0.2.4", {
        home,
        codexHome,
        fetchImpl: releaseFetch("0.2.4"),
        runner: runnerFor("0.2.4", join(home, "marketplace"), []),
      }),
    ).rejects.toThrow("PIN_CACHE_MISSING");
    expect(await readPinRecord(home, codexHome)).toBeUndefined();
  });

  test("cache Skill content must match the published release after line-ending normalization", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-cache-hash-"));
    const codexHome = join(home, ".codex");
    await preparePluginCache(codexHome, "0.2.4", skillContent("0.2.4", "tampered\n"));
    await expect(
      pinMandateMarshal("0.2.4", {
        home,
        codexHome,
        fetchImpl: releaseFetch("0.2.4"),
        runner: runnerFor("0.2.4", join(home, "marketplace"), []),
      }),
    ).rejects.toThrow("PIN_CACHE_SKILL_HASH_MISMATCH");
  });

  test("schema v1 pin records migrate deterministically to the expected versioned cache path", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-v1-"));
    const codexHome = join(home, ".codex");
    const stateDir = join(home, ".mandatemarshal");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      join(stateDir, "pin.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "0.2.3",
        ref: "v0.2.3",
        repository: "Soph1yzzz/mandatemarshal",
        marketplace: "mandatemarshal",
        pluginSource: join(home, "marketplace", "plugins", "mandatemarshal"),
        runtimeSource: join(home, "marketplace"),
        pinnedAt: "2026-09-03T07:10:39.080Z",
      }),
      "utf8",
    );
    const record = await readPinRecord(home, codexHome);
    expect(record?.schemaVersion).toBe(2);
    expect(record?.pluginCacheSource).toBe(expectedPluginCacheSource("0.2.3", home, codexHome));
  });

  test("normal commands delegate to the CLI bundled in the pinned marketplace release", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-delegate-"));
    const codexHome = join(home, ".codex");
    const marketplaceRoot = join(home, "marketplace");
    await mkdir(join(marketplaceRoot, "bin"), { recursive: true });
    await writeFile(join(marketplaceRoot, "bin", "mandatemarshal.ts"), "process.exit(7);\n", "utf8");
    await preparePluginCache(codexHome, "0.2.4");
    await pinMandateMarshal("0.2.4", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.4"),
      runner: runnerFor("0.2.4", marketplaceRoot, []),
    });

    const code = await maybeDelegateToPinnedCli(["activation", "status"], { home, codexHome });
    expect(code).toBe(7);
  });

  test("resolves a Codex executable from the Codex home when PATH has no codex", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-bin-"));
    const codexHome = join(home, ".codex");
    const executable = join(
      codexHome,
      "plugins",
      ".plugin-appserver",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    await mkdir(join(codexHome, "plugins", ".plugin-appserver"), { recursive: true });
    await writeFile(executable, "test", "utf8");
    const resolved = await resolveCodexBin({ home, codexHome, which: () => undefined });
    expect(resolved).toBe(executable);
  });

  test("parses quoted and unquoted Skill frontmatter versions", () => {
    expect(parseSkillVersion('---\nversion: "0.2.4"\n---\n')).toBe("0.2.4");
    expect(parseSkillVersion("---\nversion: 0.2.4\n---\n")).toBe("0.2.4");
  });
});
