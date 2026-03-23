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
      break;
    }

    if (tool.sideEffectClass !== 'read') {
      break;
    }

    if (!tool.inputSchema.safeParse(step.input).success) {
      break;
    }

    if (getStepSemanticValidationError(step) !== undefined) {
      break;
    }

    salvageableSteps.push(step);
  }

  if (salvageableSteps.length === 0) {
    return undefined;
  }

  return {
    steps: salvageableSteps,
    reason: 'Executing a validated read-only observation prefix before replanning.',
  };
}
