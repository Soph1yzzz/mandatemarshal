import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

async function readTemplate(name: string): Promise<string> {
  return readFile(new URL(`../../templates/codex-agents/${name}`, import.meta.url), "utf8");
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

test("plugin manifest points to bundled skills and stays version-aligned with the package", async () => {
  const [manifestText, packageText] = await Promise.all([
    readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8"),
    readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText) as { name: string; version: string; skills: string };
  const packageJson = JSON.parse(packageText) as { name: string; version: string };
  expect(manifest.name).toBe("mandatemarshal");
  expect(manifest.version).toBe(packageJson.version);
  expect(manifest.skills).toBe("./skills/");
});
