import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateConfig } from "../../src/config";

async function exampleConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile("config.example.json", "utf8")) as Record<string, unknown>;
}

test("example config satisfies the v0.3 Sol/Luna runtime contract", async () => {
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

test("authority is fixed to GPT-6 Sol/High", async () => {
  const config = await exampleConfig();
  config.authority = { model: "gpt-6-astra", effort: "high", mirrorFreshReviewer: true };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("authority.model must equal gpt-6-sol");
});

test("authority effort is fixed to high", async () => {
  const config = await exampleConfig();
  config.authority = { model: "gpt-6-sol", effort: "max", mirrorFreshReviewer: true };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("authority.effort must equal high");
});

test("implementation mappings reject old 5.6 and Terra routes", async () => {
  const config = await exampleConfig();
  const roles = config.roles as Record<string, unknown>;
  roles.routineImplementer = { nativeRole: "routine-implementer", model: "gpt-5.6-luna", effort: "max" };
  roles.complexImplementer = { nativeRole: "complex-implementer", model: "gpt-5.6-terra", effort: "high" };
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("roles.routineImplementer.model must equal gpt-6-luna");
  expect(result.errors).toContain("roles.complexImplementer.model must equal gpt-6-sol");
});

test("owner contracts require owner level and non-empty text", async () => {
  const config = await exampleConfig();
  config.ownerContracts = [{ id: "bad", level: "parent", text: "" }];
  const result = validateConfig(config);
  expect(result.valid).toBeFalse();
  expect(result.errors).toContain("owner contract bad must have level=owner");
  expect(result.errors).toContain("owner contract bad missing text");
});
