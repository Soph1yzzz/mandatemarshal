import { expect, test } from "bun:test";
import { access, readFile, readdir } from "node:fs/promises";

const ACTIVE_AGENT_FILES = [
  "mandatemarshal_routine_implementer.toml",
  "mandatemarshal_complex_implementer.toml",
  "mandatemarshal_fresh_reviewer.toml",
] as const;

async function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../../templates/codex-agents/${name}`, import.meta.url), "utf8");
}

function skillVersion(text: string): string | undefined {
  return text.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/mu)?.[1];
}

test("Codex agent templates pin the v0.3 Sol/Luna mappings", async () => {
  const routine = await readTemplate("mandatemarshal_routine_implementer.toml");
  const complex = await readTemplate("mandatemarshal_complex_implementer.toml");
  const reviewer = await readTemplate("mandatemarshal_fresh_reviewer.toml");
  expect(routine).toContain('model = "gpt-6-luna"');
  expect(routine).toContain('model_reasoning_effort = "max"');
  expect(complex).toContain('model = "gpt-6-sol"');
  expect(complex).toContain('model_reasoning_effort = "high"');
  expect(complex).toContain("only after Parent records a concrete blocker");
  expect(reviewer).toContain('model = "gpt-6-sol"');
  expect(reviewer).toContain('model_reasoning_effort = "high"');
  expect(reviewer).toContain('sandbox_mode = "read-only"');
});

test("v0.3 marketplace package exposes exactly the three active Sol/Luna profiles", async () => {
  const files = (await readdir(new URL("../../plugins/mandatemarshal-runtime/agents/", import.meta.url))).sort();
  expect(files).toEqual([...ACTIVE_AGENT_FILES].sort());
});

test("npm package allowlist excludes legacy profile directories", async () => {
  const packageText = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  const packageJson = JSON.parse(packageText) as { files: string[] };
  expect(packageJson.files).not.toContain("agents");
  expect(packageJson.files).not.toContain("templates");
  expect(packageJson.files).not.toContain("plugins");
  expect(packageJson.files).toContain("plugins/mandatemarshal-runtime");
  for (const name of ACTIVE_AGENT_FILES) {
    expect(packageJson.files).toContain(`agents/${name}`);
    expect(packageJson.files).toContain(`templates/codex-agents/${name}`);
  }
});

test("package, root plugin, marketplace plugin, and canonical plugin Skill metadata share one release version", async () => {
  const [manifestText, packagedManifestText, packageText, packagedSkillText] = await Promise.all([
    readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../../plugins/mandatemarshal-runtime/.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../plugins/mandatemarshal-runtime/skills/mandatemarshal/SKILL.md", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as { name: string; version: string; skills: string };
  const packagedManifest = JSON.parse(packagedManifestText) as { name: string; version: string; skills: string };
  const packageJson = JSON.parse(packageText) as { name: string; version: string };
  expect(manifest.name).toBe("mandatemarshal");
  expect(packagedManifest.name).toBe("mandatemarshal");
  expect(manifest.version).toBe(packageJson.version);
  expect(packagedManifest.version).toBe(packageJson.version);
  expect(skillVersion(packagedSkillText)).toBe(packageJson.version);
  expect(manifest.skills).toBe("./plugins/mandatemarshal-runtime/skills/");
  expect(packagedManifest.skills).toBe("./skills/");
});

test("Codex marketplace exposes the dedicated MandateMarshal plugin package", async () => {
  const text = await readFile(new URL("../../.agents/plugins/marketplace.json", import.meta.url), "utf8");
  const marketplace = JSON.parse(text) as { name: string; plugins: Array<{ name: string; source: { source: string; path: string } }> };
  expect(marketplace.name).toBe("mandatemarshal");
  expect(marketplace.plugins).toHaveLength(1);
  expect(marketplace.plugins[0]?.name).toBe("mandatemarshal");
  expect(marketplace.plugins[0]?.source).toEqual({ source: "local", path: "./plugins/mandatemarshal-runtime" });
});

test("all active bundled agent profiles stay byte-identical to installer templates", async () => {
  for (const name of ACTIVE_AGENT_FILES) {
    const [template, rootBundled, marketplaceBundled] = await Promise.all([
      readTemplate(name),
      readFile(new URL(`../../agents/${name}`, import.meta.url), "utf8"),
      readFile(new URL(`../../plugins/mandatemarshal-runtime/agents/${name}`, import.meta.url), "utf8"),
    ]);
    expect(rootBundled).toBe(template);
    expect(marketplaceBundled).toBe(template);
  }
});

test("runtime plugin Skill is the single active committed Skill source", async () => {
  const canonical = await readFile(new URL("../../plugins/mandatemarshal-runtime/skills/mandatemarshal/SKILL.md", import.meta.url), "utf8");
  expect(canonical).toContain("# MandateMarshal");
  expect(skillVersion(canonical)).toBeDefined();
  for (const reference of ["portable-entry.md", "role-contracts.md"]) {
    expect(await readFile(new URL(`../../plugins/mandatemarshal-runtime/skills/mandatemarshal/references/${reference}`, import.meta.url), "utf8")).not.toBeEmpty();
  }
  const [legacyPointer, oldPluginPointer] = await Promise.all([
    readFile(new URL("../../skills/orchestration/SKILL.md", import.meta.url), "utf8"),
    readFile(new URL("../../plugins/mandatemarshal/skills/mandatemarshal/SKILL.md", import.meta.url), "utf8"),
  ]);
  expect(skillVersion(legacyPointer)).toBeUndefined();
  expect(skillVersion(oldPluginPointer)).toBeUndefined();
  expect(legacyPointer).toContain("plugins/mandatemarshal-runtime/skills/mandatemarshal/SKILL.md");
  expect(oldPluginPointer).toContain("plugins/mandatemarshal-runtime/skills/mandatemarshal/SKILL.md");
});
