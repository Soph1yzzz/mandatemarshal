import type { EscalationOption, EscalationPacket, OwnerContract } from "./types";

export interface ConflictInput {
  source: "parent" | "reviewer";
  existingContract: OwnerContract | string;
  newRequirement: string;
  whyConflict: string;
  checked: string[];
  simultaneouslySatisfiable: "yes" | "no" | "uncertain";
  options: EscalationOption[];
  recommendation?: string;
  decisionRequired: string;
  heldAction: string;
  safeWorkMayContinue?: string[];
}

export function buildEscalationPacket(input: ConflictInput): EscalationPacket {
  const existingRule = typeof input.existingContract === "string"
    ? input.existingContract
    : `${input.existingContract.id}: ${input.existingContract.text}`;

  if (input.options.length === 0 && input.simultaneouslySatisfiable !== "yes") {
    throw new Error("Escalation must include at least one investigated option unless the conflict is already satisfiable");
  }
  if (!input.decisionRequired.trim()) throw new Error("decisionRequired must be non-empty");
  if (!input.heldAction.trim()) throw new Error("heldAction must be non-empty");

  return {
    schemaVersion: 1,
    source: input.source,
    conflict: {
      existingRule,
      newRequirement: input.newRequirement,
      whyConflict: input.whyConflict,
    },
    investigation: {
      checked: input.checked,
      simultaneouslySatisfiable: input.simultaneouslySatisfiable,
    },
    options: input.options,
    ...(input.recommendation === undefined ? {} : { recommendation: input.recommendation }),
    decisionRequired: input.decisionRequired,
    heldAction: input.heldAction,
    ...(input.safeWorkMayContinue === undefined ? {} : { safeWorkMayContinue: input.safeWorkMayContinue }),
  };
}

export class OwnerContractStore {
  private readonly contracts = new Map<string, OwnerContract>();

  constructor(initial: OwnerContract[] = []) {
    for (const contract of initial) this.addInitial(contract);
  }

  list(): OwnerContract[] {
    return [...this.contracts.values()].map(cloneOwnerContract);
  }

  get(id: string): OwnerContract | undefined {
    const value = this.contracts.get(id);
    return value ? cloneOwnerContract(value) : undefined;
  }

  applyExplicitUserDecision(contract: OwnerContract): void {
    this.assertContract(contract);
    this.contracts.set(contract.id, cloneOwnerContract(contract));
  }

  /**
   * There is intentionally no Parent/Reviewer mutation method.
   * Tier-0 changes can only enter through an explicit user-decision API.
   */
  private addInitial(contract: OwnerContract): void {
    this.assertContract(contract);
    if (this.contracts.has(contract.id)) throw new Error(`Duplicate owner contract id: ${contract.id}`);
    this.contracts.set(contract.id, cloneOwnerContract(contract));
  }

  private assertContract(contract: OwnerContract): void {
    if (contract.level !== "owner") throw new Error("Owner contract level must be 'owner'");
    if (!contract.id.trim()) throw new Error("Owner contract id must be non-empty");
    if (!contract.text.trim()) throw new Error("Owner contract text must be non-empty");
  }
}

function cloneOwnerContract(contract: OwnerContract): OwnerContract {
  return {
    id: contract.id,
    level: contract.level,
    text: contract.text,
    ...(contract.tags === undefined ? {} : { tags: [...contract.tags] }),
  };
}
