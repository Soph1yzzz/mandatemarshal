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

test("authority config binds Parent and Fresh Reviewer to the same Astra effort", async () => {
  const config = await exampleConfig();
  const roles = config.roles as Record<string, unknown>;
  roles.freshReviewer = { nativeRole: "fresh-reviewer", model: "gpt-6-astra", effort: "high" };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("roles.freshReviewer must mirror authority model/effort");
});

test("unsupported Ultra label is rejected instead of being treated as a runtime effort", async () => {
  const config = await exampleConfig();
  config.authority = { model: "gpt-6-astra", effort: "ultra", mirrorFreshReviewer: true };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("authority.effort must be one of low|medium|high|xhigh|max");
});

test("authority config rejects unknown effort instead of silently substituting", async () => {
  const config = await exampleConfig();
  config.authority = { model: "gpt-6-astra", effort: "turbo", mirrorFreshReviewer: true };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("authority.effort must be one of low|medium|high|xhigh|max");
});

test("owner contracts require owner level and non-empty text", async () => {
  const config = await exampleConfig();
  config.ownerContracts = [{ id: "bad", level: "parent", text: "" }];
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("owner contract bad must have level=owner");
  expect(result.errors).toContain("owner contract bad missing text");
});
