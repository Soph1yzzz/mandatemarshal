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

test("plugin manifest points to bundled skills", async () => {
  const text = await readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8");
  const manifest = JSON.parse(text) as { name: string; version: string; skills: string };
  expect(manifest.name).toBe("mandatemarshal");
  expect(manifest.version).toBe("0.1.0");
  expect(manifest.skills).toBe("./skills/");
});
