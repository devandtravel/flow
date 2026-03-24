import type { ToolStep } from '../../domain';
import type { ToolDefinition } from '../../tools';
import { getStepSemanticValidationError } from './step-validation';

export interface ObservationSalvagePlan {
  readonly steps: ToolStep[];
  readonly reason: string;
}

function getToolDefinition(step: ToolStep, availableTools: readonly ToolDefinition[]): ToolDefinition | undefined {
  return availableTools.find((tool) => tool.name === step.tool);
}

export function buildObservationSalvagePlan(
  plan: { readonly steps: readonly ToolStep[] },
  availableTools: readonly ToolDefinition[],
): ObservationSalvagePlan | undefined {
  const salvageableSteps: ToolStep[] = [];

  for (const step of plan.steps) {
    const tool = getToolDefinition(step, availableTools);
    if (!tool) {
      continue;
    }

    if (tool.sideEffectClass !== 'read') {
      continue;
    }

    if (!tool.inputSchema.safeParse(step.input).success) {
      continue;
    }

    if (getStepSemanticValidationError(step) !== undefined) {
      continue;
    }

    salvageableSteps.push(step);
  }

  if (salvageableSteps.length === 0) {
    return undefined;
  }

  return {
    steps: salvageableSteps,
    reason: 'Executing all validated read-only observation steps before replanning.',
  };
}
