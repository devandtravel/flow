import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { z } from 'zod';
import { AgentRuntime } from '../core/loop/runtime';
import { loadConfig, type RuntimeConfig } from '../config';
import { capabilityNameSchema, eventLevelSchema, maintenanceOperationSchema, maintenanceTriggerSchema } from '../domain';
import { isDomainError } from '../errors';

const createTaskBodySchema = z.object({
  goal: z.string().min(1),
  targetId: z.string().min(1).optional(),
  autorun: z.boolean().optional(),
});

const createScheduleBodySchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  targetId: z.string().min(1).optional(),
  intervalSeconds: z.number().int().positive(),
  enabled: z.boolean().default(true),
});

const createTargetBodySchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  readPaths: z.array(z.string().min(1)).min(1),
  writePaths: z.array(z.string().min(1)).min(1),
  capabilities: z.array(capabilityNameSchema).min(1),
});

const cleanupBodySchema = z.object({
  keepLatestArtifacts: z.number().int().nonnegative().optional(),
  keepLatestRunEvents: z.number().int().nonnegative().optional(),
  keepLatestMemoryEntries: z.number().int().nonnegative().optional(),
  maxArtifactAgeDays: z.number().nonnegative().nullable().optional(),
  maxRunEventAgeDays: z.number().nonnegative().nullable().optional(),
  maxMemoryEntryAgeDays: z.number().nonnegative().nullable().optional(),
  dryRun: z.boolean().optional(),
});

const pageQuerySchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});

function parsePageQuery(requestUrl: URL): z.infer<typeof pageQuerySchema> {
  const limitValue = requestUrl.searchParams.get('limit');
  const offsetValue = requestUrl.searchParams.get('offset');
  return pageQuerySchema.parse({
    limit: limitValue ? Number(limitValue) : undefined,
    offset: offsetValue ? Number(offsetValue) : undefined,
  });
}

function parseRunEventFilter(requestUrl: URL): { level?: z.infer<typeof eventLevelSchema> } {
  const levelValue = requestUrl.searchParams.get('level');
  return {
    level: levelValue ? eventLevelSchema.parse(levelValue) : undefined,
  };
}

function parseMaintenanceEventFilter(requestUrl: URL): {
  operation?: z.infer<typeof maintenanceOperationSchema>;
  dryRun?: boolean;
  trigger?: z.infer<typeof maintenanceTriggerSchema>;
} {
  const operationValue = requestUrl.searchParams.get('operation');
  const dryRunValue = requestUrl.searchParams.get('dryRun');
  const triggerValue = requestUrl.searchParams.get('trigger');
  const parsedDryRun =
    dryRunValue === null
      ? undefined
      : z.enum(['true', 'false']).parse(dryRunValue) === 'true';
  return {
    operation: operationValue ? maintenanceOperationSchema.parse(operationValue) : undefined,
    dryRun: parsedDryRun,
    trigger: triggerValue ? maintenanceTriggerSchema.parse(triggerValue) : undefined,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload, null, 2));
}

function mapErrorToStatusCode(error: unknown): number {
  if (error instanceof z.ZodError) {
    return 422;
  }

  if (!isDomainError(error)) {
    return 500;
  }

  if (error.code === 'not_found') {
    return 404;
  }

  if (error.code === 'conflict') {
    return 409;
  }

  if (error.code === 'validation') {
    return 422;
  }

  return 400;
}

export function createApiServer(workspaceRoot: string, configOverride?: RuntimeConfig) {
  const config = configOverride ?? loadConfig(workspaceRoot);
  const runtime = new AgentRuntime({ workspaceRoot, config });

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
          status: 'ok',
          mode: config.mode,
          autonomy: config.autonomy.mode,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/metrics') {
        sendJson(response, 200, runtime.metrics.snapshot());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/tasks') {
        const body = createTaskBodySchema.parse(await readJsonBody(request));
        const task = runtime.createTask(body.goal, body.targetId);
        if (body.autorun === true) {
          const summary = await runtime.runTask(task.id);
          sendJson(response, 201, summary);
          return;
        }

        sendJson(response, 201, task);
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/tasks') {
        sendJson(response, 200, runtime.listTasks());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/tasks/')) {
        const taskId = requestUrl.pathname.split('/')[2];
        if (requestUrl.pathname.endsWith('/timeline')) {
          sendJson(response, 200, runtime.getTaskTimeline(taskId, parsePageQuery(requestUrl)));
          return;
        }

        sendJson(response, 200, runtime.inspectTask(taskId));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/approvals') {
        sendJson(response, 200, runtime.listApprovals());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname.endsWith('/approve')) {
        const approvalId = requestUrl.pathname.split('/')[2];
        sendJson(response, 200, runtime.approve(approvalId));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname.endsWith('/reject')) {
        const approvalId = requestUrl.pathname.split('/')[2];
        sendJson(response, 200, runtime.reject(approvalId));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/targets') {
        sendJson(response, 200, runtime.listTargets());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/targets/')) {
        const targetId = requestUrl.pathname.split('/')[2];
        sendJson(response, 200, runtime.getTarget(targetId));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/targets') {
        const body = createTargetBodySchema.parse(await readJsonBody(request));
        sendJson(
          response,
          201,
          runtime.upsertTarget({
            id: body.id,
            root: body.root,
            read_paths: body.readPaths,
            write_paths: body.writePaths,
            capabilities: body.capabilities,
          }),
        );
        return;
      }

      if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/targets/')) {
        const targetId = requestUrl.pathname.split('/')[2];
        runtime.deleteTarget(targetId);
        sendJson(response, 200, { id: targetId, deleted: true });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/schedules') {
        sendJson(response, 200, runtime.listSchedules());
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/schedules') {
        const body = createScheduleBodySchema.parse(await readJsonBody(request));
        sendJson(
          response,
          201,
          runtime.upsertSchedule({
            id: body.id,
            goal: body.goal,
            targetId: body.targetId,
            intervalSeconds: body.intervalSeconds,
            enabled: body.enabled,
          }),
        );
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/worker/run-once') {
        const summary = await runtime.workOnce();
        sendJson(response, 200, summary ?? { status: 'idle' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/maintenance/cleanup') {
        const body = cleanupBodySchema.parse(await readJsonBody(request));
        sendJson(response, 200, runtime.cleanupState({ ...body, trigger: 'api_manual' }));
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/maintenance/run-due') {
        sendJson(response, 200, runtime.runDueMaintenance({ trigger: 'api_run_due' }) ?? { status: 'idle' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/maintenance/status') {
        sendJson(response, 200, runtime.getMaintenanceStatus());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/maintenance/summary') {
        sendJson(response, 200, runtime.getMaintenanceSummary());
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/maintenance/events') {
        sendJson(response, 200, runtime.listMaintenanceEvents(parsePageQuery(requestUrl), parseMaintenanceEventFilter(requestUrl)));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/runs/')) {
        const runId = requestUrl.pathname.split('/')[2];
        if (requestUrl.pathname.endsWith('/events')) {
          sendJson(response, 200, runtime.getRunEvents(runId, parsePageQuery(requestUrl), parseRunEventFilter(requestUrl)));
          return;
        }

        sendJson(response, 200, runtime.getRun(runId));
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/artifacts/')) {
        const artifactId = requestUrl.pathname.split('/')[2];
        const artifact = runtime.getArtifact(artifactId);
        if (!artifact) {
          sendJson(response, 404, { error: 'Artifact not found' });
          return;
        }

        sendJson(response, 200, {
          artifact,
          content: readFileSync(artifact.path, 'utf8'),
        });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown server error';
      sendJson(response, mapErrorToStatusCode(error), { error: message });
    }
  });

  return {
    runtime,
    server,
    start() {
      return new Promise<void>((resolve) => {
        server.listen(config.server.port, config.server.host, () => resolve());
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
