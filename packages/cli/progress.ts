import type { TaskState } from '../domain';
import type { RuntimeUpdateEvent } from '../core/loop/runtime';

function writeProgressLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

function getTaskStateLabel(state: TaskState): string {
  switch (state) {
    case 'queued':
      return 'в очереди';
    case 'planning':
      return 'планирование';
    case 'validating':
      return 'проверка плана';
    case 'executing':
      return 'исполнение';
    case 'awaiting_approval':
      return 'ожидает подтверждения';
    case 'verifying':
      return 'проверка результата';
    case 'completed':
      return 'завершено';
    case 'failed':
      return 'ошибка';
    case 'retryable':
      return 'доступен повтор';
    case 'blocked':
      return 'заблокировано';
    case 'cancelled':
      return 'отменено';
    case 'rolled_back':
      return 'откат выполнен';
    case 'escalated':
      return 'требует оператора';
  }
}

function getStringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' ? value : undefined;
}

function getBooleanValue(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === 'boolean' ? value : undefined;
}

function formatRunEventMessage(event: Extract<RuntimeUpdateEvent, { kind: 'run_event' }>): string {
  const payload = event.payload;

  switch (event.message) {
    case 'run_started': {
      const iteration = getNumberValue(payload, 'iteration');
      const maxIterations = getNumberValue(payload, 'maxIterations');
      if (iteration === undefined) {
        return 'Запуск начат.';
      }

      return maxIterations === undefined
        ? `Запуск начат. Попытка ${String(iteration)}.`
        : `Запуск начат. Попытка ${String(iteration)}/${String(maxIterations)}.`;
    }
    case 'planning_started':
      return 'Планирование начато.';
    case 'planning_completed': {
      const stepCount = getNumberValue(payload, 'stepCount');
      const confidence = getNumberValue(payload, 'confidence');
      if (stepCount === undefined && confidence === undefined) {
        return 'Планирование завершено.';
      }

      const parts: string[] = [];
      if (stepCount !== undefined) {
        parts.push(`шагов: ${String(stepCount)}`);
      }
      if (confidence !== undefined) {
        parts.push(`уверенность: ${confidence.toFixed(2)}`);
      }
      return `Планирование завершено, ${parts.join(', ')}.`;
    }
    case 'plan_invalid': {
      const feedback = payload['feedback'];
      if (!Array.isArray(feedback)) {
        return 'План отклонён критиком.';
      }

      const feedbackItems = feedback.filter((item): item is string => typeof item === 'string');
      if (feedbackItems.length === 0) {
        return 'План отклонён критиком.';
      }

      return `План отклонён критиком. ${feedbackItems[0]}`;
    }
    case 'plan_generation_failed':
      return 'Планирование завершилось ошибкой.';
    case 'step_started': {
      const step = getStringValue(payload, 'step');
      const stepIndex = getNumberValue(payload, 'stepIndex');
      if (step === undefined && stepIndex === undefined) {
        return 'Шаг начат.';
      }

      const label = step ?? 'неизвестный инструмент';
      return stepIndex === undefined
        ? `Шаг ${label} начат.`
        : `Шаг ${String(stepIndex + 1)}: ${label}.`;
    }
    case 'step_completed': {
      const step = getStringValue(payload, 'step') ?? 'неизвестный инструмент';
      const verified = getBooleanValue(payload, 'verified');
      if (verified === undefined) {
        return `Шаг ${step} завершён.`;
      }

      return verified ? `Шаг ${step} подтверждён.` : `Шаг ${step} завершился с неподтверждённым результатом.`;
    }
    case 'approval_requested': {
      const step = getStringValue(payload, 'step');
      return step === undefined ? 'Запрошено подтверждение оператора.' : `Требуется подтверждение для шага ${step}.`;
    }
    case 'supervisor_decision': {
      const decision = getStringValue(payload, 'decision');
      const reason = getStringValue(payload, 'reason');
      if (decision === undefined) {
        return 'Supervisor принял решение по run.';
      }

      return reason === undefined
        ? `Supervisor: ${decision}.`
        : `Supervisor: ${decision}. Причина: ${reason}`;
    }
    case 'operator_action': {
      const action = getStringValue(payload, 'action');
      return action === undefined ? 'Операторское действие применено.' : `Операторское действие: ${action}.`;
    }
    case 'run_completed': {
      const verifiedSteps = getNumberValue(payload, 'verifiedSteps');
      const totalSteps = getNumberValue(payload, 'totalSteps');
      const score = getNumberValue(payload, 'score');
      const parts: string[] = [];
      if (verifiedSteps !== undefined && totalSteps !== undefined) {
        parts.push(`шагов подтверждено: ${String(verifiedSteps)}/${String(totalSteps)}`);
      }
      if (score !== undefined) {
        parts.push(`оценка: ${score.toFixed(2)}`);
      }

      return parts.length === 0 ? 'Запуск завершён.' : `Запуск завершён, ${parts.join(', ')}.`;
    }
    default:
      return `${event.message}.`;
  }
}

export function attachCliRunProgress(taskId: string, subscribe: (listener: (event: RuntimeUpdateEvent) => void) => () => void): () => void {
  const seenTaskStates = new Set<string>();
  const seenRunStates = new Set<string>();

  writeProgressLine(`[flow] задача ${taskId} создана.`);

  return subscribe((event) => {
    if ('taskId' in event && event.taskId !== taskId) {
      return;
    }

    if (event.kind === 'task_changed') {
      const key = `${event.taskId}:${event.state}`;
      if (seenTaskStates.has(key)) {
        return;
      }

      seenTaskStates.add(key);
      writeProgressLine(`[task] ${getTaskStateLabel(event.state)}.`);
      return;
    }

    if (event.kind === 'run_changed') {
      const key = `${event.runId}:${event.state}`;
      if (seenRunStates.has(key)) {
        return;
      }

      seenRunStates.add(key);
      writeProgressLine(`[run] ${getTaskStateLabel(event.state)}.`);
      return;
    }

    if (event.kind === 'run_event') {
      writeProgressLine(`[event] ${formatRunEventMessage(event)}`);
    }
  });
}
