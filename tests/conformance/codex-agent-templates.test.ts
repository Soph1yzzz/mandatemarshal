import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

async function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../../templates/codex-agents/${name}`, import.meta.url), "utf8");
}

function skillVersion(text: string): string | undefined {
  return text.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/mu)?.[1];
}

test("Codex agent templates pin approved v0.1 mappings", async () => {
  const routine = await readTemplate("mandatemarshal_routine_implementer.toml");
  const complex = await readTemplate("mandatemarshal_complex_implementer.toml");
  const reviewer = await readTemplate("mandatemarshal_fresh_reviewer.toml");

  expect(routine).toContain('model = "gpt-5.6-luna"');
  expect(routine).toContain('model_reasoning_effort = "max"');
  expect(complex).toContain('model = "gpt-5.6-terra"');
  expect(complex).toContain('model_reasoning_effort = "high"');
  expect(reviewer).toContain('model = "gpt-5.6-sol"');
  expect(reviewer).toContain('model_reasoning_effort = "high"');
  expect(reviewer).toContain('sandbox_mode = "read-only"');
});

test("package, root plugin, marketplace plugin, and canonical plugin Skill metadata share one release version", async () => {
  const [manifestText, packagedManifestText, packageText, packagedSkillText] = await Promise.all([
    readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../../plugins/mandatemarshal/.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../plugins/mandatemarshal/skills/mandatemarshal/SKILL.md", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as { name: string; version: string; skills: string };
  const packagedManifest = JSON.parse(packagedManifestText) as { name: string; version: string; skills: string };
  const packageJson = JSON.parse(packageText) as { name: string; version: string };

  expect(manifest.name).toBe("mandatemarshal");
  expect(packagedManifest.name).toBe("mandatemarshal");
  expect(manifest.version).toBe(packageJson.version);
  expect(packagedManifest.version).toBe(packageJson.version);
  expect(skillVersion(packagedSkillText)).toBe(packageJson.version);
  expect(manifest.skills).toBe("./plugins/mandatemarshal/skills/");
  expect(packagedManifest.skills).toBe("./skills/");
});

test("Codex marketplace exposes the dedicated MandateMarshal plugin package", async () => {
  const text = await readFile(new URL("../../.agents/plugins/marketplace.json", import.meta.url), "utf8");
  const marketplace = JSON.parse(text) as {
    name: string;
    plugins: Array<{ name: string; source: { source: string; path: string } }>;
  };
  expect(marketplace.name).toBe("mandatemarshal");
  expect(marketplace.plugins).toHaveLength(1);
  expect(marketplace.plugins[0]?.name).toBe("mandatemarshal");
  expect(marketplace.plugins[0]?.source).toEqual({
    source: "local",
    path: "./plugins/mandatemarshal",
  });
});

test("all bundled agent profiles stay byte-identical to installer templates", async () => {
  for (const name of [
    "mandatemarshal_routine_implementer.toml",
    "mandatemarshal_complex_implementer.toml",
    "mandatemarshal_fresh_reviewer.toml",
  ]) {
    const [template, rootBundled, marketplaceBundled] = await Promise.all([
      readTemplate(name),
      readFile(new URL(`../../agents/${name}`, import.meta.url), "utf8"),
      readFile(new URL(`../../plugins/mandatemarshal/agents/${name}`, import.meta.url), "utf8"),
    ]);
    expect(rootBundled).toBe(template);
    expect(marketplaceBundled).toBe(template);
  }
});

test("plugin Skill is the single committed canonical Skill source", async () => {
  const canonical = await readFile(
    new URL("../../plugins/mandatemarshal/skills/mandatemarshal/SKILL.md", import.meta.url),
    "utf8",
  );
  expect(canonical).toContain("# MandateMarshal");
  expect(skillVersion(canonical)).toBeDefined();
  for (const reference of ["portable-entry.md", "role-contracts.md"]) {
    expect(
      await readFile(
        new URL(`../../plugins/mandatemarshal/skills/mandatemarshal/references/${reference}`, import.meta.url),
        "utf8",
      ),
    ).not.toBeEmpty();
  }

  const legacyPointer = await readFile(new URL("../../skills/orchestration/SKILL.md", import.meta.url), "utf8");
  expect(skillVersion(legacyPointer)).toBeUndefined();
  expect(legacyPointer).toContain("plugins/mandatemarshal/skills/mandatemarshal/SKILL.md");
});
