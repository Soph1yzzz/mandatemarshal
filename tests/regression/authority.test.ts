import { describe, expect, test } from "bun:test";
import { buildEscalationPacket, OwnerContractStore } from "../../src/core/authority";

 describe("authority regressions", () => {
  test("uncertainty produces HOLD + escalation rather than permanent policy mutation", () => {
    const store = new OwnerContractStore([
      { id: "OC-04", level: "owner", text: "Capability X remains disabled without explicit user authorization." },
    ]);
    const before = store.list();
    const escalation = buildEscalationPacket({
      source: "parent",
      existingContract: before[0]!,
      newRequirement: "Enable capability X for one bounded run.",
      whyConflict: "The request needs X while OC-04 requires explicit authorization.",
      checked: ["bounded one-run exception", "contract-preserving alternative"],
      simultaneouslySatisfiable: "uncertain",
      options: [
        {
          name: "bounded exception",
          description: "Authorize X for one run only.",
          preservesOwnerContract: false,
          reversibility: "reversible",
        },
        {
          name: "keep disabled",
          description: "Hold X and continue independent safe work.",
          preservesOwnerContract: true,
          reversibility: "reversible",
        },
      ],
      recommendation: "Prefer the bounded exception only if the owner explicitly approves it.",
      decisionRequired: "Authorize capability X for this single run?",
      heldAction: "Enabling capability X",
      safeWorkMayContinue: ["planning", "read-only inspection"],
    });

    expect(escalation.heldAction).toBe("Enabling capability X");
    expect(store.list()).toEqual(before);
  });

  test("owner contract changes require explicit user-decision API", () => {
    const store = new OwnerContractStore([
      { id: "OC-1", level: "owner", text: "Original" },
    ]);
    store.applyExplicitUserDecision({ id: "OC-1", level: "owner", text: "User-approved replacement" });
    expect(store.get("OC-1")?.text).toBe("User-approved replacement");
  });
});
