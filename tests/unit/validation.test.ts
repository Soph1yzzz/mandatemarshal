import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { validateImplementationPacket, validateReviewResult } from "../../src/core/validation";
import { packet } from "../fixtures/factories";

 describe("wire contract validation", () => {
  test("routing is mandatory in implementation packet", () => {
    const value = { ...packet() } as Record<string, unknown>;
    delete value.routing;
    const result = validateImplementationPacket(value);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("routing is required");
  });

  test("return contract is mandatory in implementation packet", () => {
    const value = { ...packet() } as Record<string, unknown>;
    delete value.returnContract;
    const result = validateImplementationPacket(value);
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("returnContract is required");
  });

  test("legacy rethink reviewer verdict is rejected", () => {
    const result = validateReviewResult({
      schemaVersion: 1,
      verdict: "rethink",
      candidateId: "c1",
      reason: "architectural preference",
      findings: [],
      requiredAction: "redesign",
      residualRisk: "none",
    });
    expect(result.valid).toBeFalse();
    expect(result.errors).toContain("invalid review verdict");
  });

  test("all shipped JSON schemas parse", async () => {
    for (const name of [
      "implementation-packet.schema.json",
      "review-result.schema.json",
      "escalation.schema.json",
      "run-event.schema.json",
      "project-activation.schema.json",
    ]) {
      const text = await readFile(new URL(`../../schemas/${name}`, import.meta.url), "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });

  test("implementation schema requires routing and return contract", async () => {
    const text = await readFile(new URL("../../schemas/implementation-packet.schema.json", import.meta.url), "utf8");
    const schema = JSON.parse(text) as {
      required: string[];
      properties: { executionContract: { properties: Record<string, unknown> } };
    };
    expect(schema.required).toContain("routing");
    expect(schema.required).toContain("returnContract");
    expect(schema.properties.executionContract.properties).toHaveProperty("expectedSideEffects");
    expect(schema.properties.executionContract.properties).toHaveProperty("forbiddenSideEffects");
  });
});
