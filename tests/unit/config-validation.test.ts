import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateConfig } from "../../src/config";

async function exampleConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile("config.example.json", "utf8")) as Record<string, unknown>;
}

test("example config satisfies the compliant v0.1 runtime contract", async () => {
  const config = await exampleConfig();
  expect(validateConfig(config)).toEqual({ valid: true, errors: [], warnings: [] });
});

test("config cannot disable the Fresh Reviewer read-only request", async () => {
  const config = await exampleConfig();
  config.review = { ...(config.review as Record<string, unknown>), requestedReadOnly: false };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("compliant v0.1 requires Fresh Reviewer read-only to be requested");
});

test("config requires complete semantic role mappings", async () => {
  const config = await exampleConfig();
  config.roles = {};
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("roles.routineImplementer is required");
  expect(result.errors).toContain("roles.complexImplementer is required");
  expect(result.errors).toContain("roles.freshReviewer is required");
  expect(result.errors).toContain("roles.parent is required");
});

test("owner contracts require owner level and non-empty text", async () => {
  const config = await exampleConfig();
  config.ownerContracts = [{ id: "bad", level: "parent", text: "" }];
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("owner contract bad must have level=owner");
  expect(result.errors).toContain("owner contract bad missing text");
});
