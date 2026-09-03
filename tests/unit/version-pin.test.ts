import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectMandateMarshalPin,
  maybeDelegateToPinnedCli,
  parseSkillVersion,
  pinMandateMarshal,
  readPinRecord,
  type PinCommandRunner,
} from "../../src/runtime/version-pin";

function releaseFetch(version: string, skillVersion = version): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) {
      return new Response(JSON.stringify({ tag_name: `v${version}` }), { status: 200 });
    }
    if (url.includes("/releases/tags/")) {
      return new Response(JSON.stringify({ tag_name: `v${version}` }), { status: 200 });
    }
    if (url.endsWith("/.codex-plugin/plugin.json")) {
      return new Response(JSON.stringify({ name: "mandatemarshal", version }), { status: 200 });
    }
    if (url.endsWith("/skills/orchestration/SKILL.md")) {
      return new Response(`---\nname: mandatemarshal\nversion: "${skillVersion}"\n---\n`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
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

describe("MandateMarshal version pinning", () => {
  test("pins an explicit release through the native Codex plugin marketplace", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-home-"));
    const marketplaceRoot = join(home, "codex-marketplace");
    const calls: string[][] = [];
    const record = await pinMandateMarshal("v0.2.2", {
      home,
      codexBin: "codex-test",
      fetchImpl: releaseFetch("0.2.2"),
      runner: runnerFor("0.2.2", marketplaceRoot, calls),
      syncLegacyCopies: false,
      now: () => new Date("2026-09-03T06:00:00.000Z"),
    });

    expect(record.version).toBe("0.2.2");
    expect(record.ref).toBe("v0.2.2");
    expect(record.pluginSource).toBe(join(marketplaceRoot, "plugins", "mandatemarshal"));
    expect(record.runtimeSource).toBe(marketplaceRoot);
    expect(calls).toContainEqual([
      "codex-test",
      "plugin",
      "marketplace",
      "add",
      "Soph1yzzz/mandatemarshal",
      "--ref",
      "v0.2.2",
      "--json",
    ]);
    expect(calls).toContainEqual(["codex-test", "plugin", "add", "mandatemarshal@mandatemarshal", "--json"]);
    expect((await readPinRecord(home))?.version).toBe("0.2.2");
  });

  test("latest resolves once and records the exact released version", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-latest-"));
    const calls: string[][] = [];
    const record = await pinMandateMarshal("latest", {
      home,
      fetchImpl: releaseFetch("0.2.2"),
      runner: runnerFor("0.2.2", join(home, "marketplace"), calls),
      syncLegacyCopies: false,
    });
    expect(record.version).toBe("0.2.2");
    expect(record.ref).toBe("v0.2.2");
  });

  test("refuses version-skewed Skill metadata before changing Codex installation state", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-skew-"));
    const calls: string[][] = [];
    await expect(
      pinMandateMarshal("0.2.2", {
        home,
        fetchImpl: releaseFetch("0.2.2", "0.2.1"),
        runner: runnerFor("0.2.2", join(home, "marketplace"), calls),
        syncLegacyCopies: false,
      }),
    ).rejects.toThrow("PIN_TARGET_VERSION_MISMATCH");
    expect(calls).toEqual([]);
  });

  test("status reports drift when Codex has a different plugin version than the pin record", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-drift-"));
    const initialCalls: string[][] = [];
    await pinMandateMarshal("0.2.2", {
      home,
      fetchImpl: releaseFetch("0.2.2"),
      runner: runnerFor("0.2.2", join(home, "marketplace"), initialCalls),
      syncLegacyCopies: false,
    });

    const driftCalls: string[][] = [];
    const status = await inspectMandateMarshalPin({
      home,
      runner: runnerFor("0.2.1", join(home, "old-marketplace"), driftCalls, { installed: true, marketplace: true }),
    });
    expect(status.status).toBe("drifted");
    expect(status.record?.version).toBe("0.2.2");
    expect(status.installedPluginVersion).toBe("0.2.1");
    expect(status.legacySkillVersion).toBeNull();
  });

  test("pin synchronizes legacy Skill and agent locations from the pinned plugin package", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-legacy-sync-"));
    const marketplaceRoot = join(home, "marketplace");
    const pluginSource = join(marketplaceRoot, "plugins", "mandatemarshal");
    const codexHome = join(home, "codex-home");
    await mkdir(join(pluginSource, "skills", "mandatemarshal"), { recursive: true });
    await mkdir(join(pluginSource, "agents"), { recursive: true });
    await writeFile(
      join(pluginSource, "skills", "mandatemarshal", "SKILL.md"),
      '---\nname: mandatemarshal\nversion: "0.2.2"\n---\n',
      "utf8",
    );
    for (const name of [
      "mandatemarshal_routine_implementer.toml",
      "mandatemarshal_complex_implementer.toml",
      "mandatemarshal_fresh_reviewer.toml",
    ]) {
      await writeFile(join(pluginSource, "agents", name), `name = "${name}"\n`, "utf8");
    }

    const calls: string[][] = [];
    await pinMandateMarshal("0.2.2", {
      home,
      codexHome,
      fetchImpl: releaseFetch("0.2.2"),
      runner: runnerFor("0.2.2", marketplaceRoot, calls),
    });

    expect(await readFile(join(codexHome, "skills", "mandatemarshal", "SKILL.md"), "utf8")).toContain(
      'version: "0.2.2"',
    );
    expect(
      await readFile(join(codexHome, "agents", "mandatemarshal_fresh_reviewer.toml"), "utf8"),
    ).toContain("mandatemarshal_fresh_reviewer.toml");

    const status = await inspectMandateMarshalPin({
      home,
      codexHome,
      runner: runnerFor("0.2.2", marketplaceRoot, [], { installed: true, marketplace: true }),
    });
    expect(status.status).toBe("pinned");
    expect(status.installedPluginVersion).toBe("0.2.2");
    expect(status.legacySkillVersion).toBe("0.2.2");
  });

  test("normal commands delegate to the CLI bundled in the pinned marketplace release", async () => {
    const home = await mkdtemp(join(tmpdir(), "mandatemarshal-pin-delegate-"));
    const marketplaceRoot = join(home, "marketplace");
    await mkdir(join(marketplaceRoot, "bin"), { recursive: true });
    await writeFile(join(marketplaceRoot, "bin", "mandatemarshal.ts"), "process.exit(7);\n", "utf8");
    const calls: string[][] = [];
    await pinMandateMarshal("0.2.2", {
      home,
      fetchImpl: releaseFetch("0.2.2"),
      runner: runnerFor("0.2.2", marketplaceRoot, calls),
      syncLegacyCopies: false,
    });

    const code = await maybeDelegateToPinnedCli(["activation", "status"], { home });
    expect(code).toBe(7);
  });

  test("parses quoted and unquoted Skill frontmatter versions", () => {
    expect(parseSkillVersion('---\nversion: "0.2.2"\n---\n')).toBe("0.2.2");
    expect(parseSkillVersion("---\nversion: 0.2.2\n---\n")).toBe("0.2.2");
  });
});
