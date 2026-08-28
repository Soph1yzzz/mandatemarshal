import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("provider-neutral core contains no provider/model branding", async () => {
  const root = resolve(import.meta.dir, "../../src/core");
  const files = (await readdir(root)).filter((name) => name.endsWith(".ts"));
  const forbidden = [
    /\bcodex\b/i,
    /\bclaude\b/i,
    /\bopenai\b/i,
    /gpt-5/i,
    /\bluna\b/i,
    /\bterra\b/i,
    /\bsol\b/i,
  ];
  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const pattern of forbidden) {
      expect(text.match(pattern), `${file} must remain provider-neutral (${pattern})`).toBeNull();
    }
  }
});
