import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { z } from 'zod';
import { AgentRuntime, type RuntimeUpdateEvent } from '../core/loop/runtime';
import { loadConfig, type RuntimeConfig } from '../config';
import { approvalStatusSchema, capabilityNameSchema, eventLevelSchema, maintenanceOperationSchema, maintenanceTriggerSchema, taskStateSchema } from '../domain';
import { isDomainError } from '../errors';
import { getDashboardAsset } from './ui';
import {
  buildArtifactBrowserViewModel,
  buildArtifactPreviewViewModel,
  buildDashboardFiltersViewModel,
  buildRunViewModel,
  filterApprovalsByStatus,
  filterRunEventsByLevel,
  filterTasksByState,
} from './view-models';

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

const logQuerySchema = z.object({
  tail: z.number().int().positive().max(5000).optional(),
});

const dashboardFilterQuerySchema = z.object({
  taskState: taskStateSchema.optional(),
  approvalStatus: approvalStatusSchema.optional(),
  eventLevel: eventLevelSchema.optional(),
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

function parseLogQuery(requestUrl: URL): z.infer<typeof logQuerySchema> {
  const tailValue = requestUrl.searchParams.get('tail');
  return logQuerySchema.parse({
    tail: tailValue ? Number(tailValue) : undefined,
  });
}

function parseDashboardFilterQuery(requestUrl: URL): z.infer<typeof dashboardFilterQuerySchema> {
  const taskStateValue = requestUrl.searchParams.get('taskState');
  const approvalStatusValue = requestUrl.searchParams.get('approvalStatus');
  const eventLevelValue = requestUrl.searchParams.get('eventLevel');
  return dashboardFilterQuerySchema.parse({
    taskState: taskStateValue ? taskStateSchema.parse(taskStateValue) : undefined,
    approvalStatus: approvalStatusValue ? approvalStatusSchema.parse(approvalStatusValue) : undefined,
    eventLevel: eventLevelValue ? eventLevelSchema.parse(eventLevelValue) : undefined,
  });
}

function tailText(content: string, lineCount: number): string {
  const lines = content.split('\n');
  return lines.slice(Math.max(lines.length - lineCount, 0)).join('\n');
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

function sendText(response: ServerResponse, statusCode: number, payload: string, contentType: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', contentType);
  response.end(payload);
}

function writeServerEvent(response: ServerResponse, event: RuntimeUpdateEvent | { kind: 'connected'; timestamp: string }): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
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
  let workerController: AbortController | undefined;

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
      const dashboardAsset = getDashboardAsset(requestUrl.pathname);

      if (request.method === 'GET' && dashboardAsset) {
        sendText(response, 200, dashboardAsset.body, dashboardAsset.contentType);
        return;
      }

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

      if (request.method === 'GET' && requestUrl.pathname === '/dashboard/state') {
        const taskId = requestUrl.searchParams.get('taskId');
        const filters = parseDashboardFilterQuery(requestUrl);
        const tasks = filterTasksByState(runtime.listTasks(), filters.taskState);
        const approvals = filterApprovalsByStatus(runtime.listApprovals(), filters.approvalStatus);
        const timeline = taskId ? runtime.getTaskTimeline(taskId, { limit: 20, offset: 0 }) : undefined;
        sendJson(response, 200, {
          health: {
            status: 'ok',
            mode: config.mode,
            autonomy: config.autonomy.mode,
          },
          filters: buildDashboardFiltersViewModel(filters),
          tasks,
          approvals,
          targets: runtime.listTargets(),
          schedules: runtime.listSchedules(),
          maintenance: {
            status: runtime.getMaintenanceStatus(),
            summary: runtime.getMaintenanceSummary(),
          },
          metrics: runtime.metrics.snapshot(),
          timeline: timeline
            ? {
                ...timeline,
                runs: timeline.runs.map((run) => ({
                  ...run,
                  events: filterRunEventsByLevel(run.events, filters.eventLevel),
                })),
              }
            : undefined,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/stream') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        });

        writeServerEvent(response, {
          kind: 'connected',
          timestamp: new Date().toISOString(),
        });

        const unsubscribe = runtime.subscribe((event) => {
          writeServerEvent(response, event);
        });

        const keepAlive = setInterval(() => {
          response.write(': keep-alive\n\n');
        }, 15000);

        request.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
          response.end();
        });
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
        if (requestUrl.pathname.endsWith('/artifacts/browser')) {
          sendJson(response, 200, buildArtifactBrowserViewModel(taskId, runtime.getTaskArtifacts(taskId)));
          return;
        }
        if (requestUrl.pathname.endsWith('/artifacts')) {
          sendJson(response, 200, runtime.getTaskArtifacts(taskId));
          return;
        }
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
        if (requestUrl.pathname.endsWith('/view')) {
          const filters = parseDashboardFilterQuery(requestUrl);
          const runPayload = runtime.getRun(runId);
          const task = runtime.inspectTask(runPayload.run.task_id).task;
          if (!task) {
            sendJson(response, 404, { error: 'Task not found for run' });
            return;
          }
          sendJson(
            response,
            200,
            buildRunViewModel(
              task,
              runPayload.run,
              runPayload.steps,
              filterRunEventsByLevel(runPayload.events, filters.eventLevel),
              runPayload.evaluations,
            ),
          );
          return;
        }
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

        if (requestUrl.pathname.endsWith('/view')) {
          sendJson(response, 200, buildArtifactPreviewViewModel(runtime.getArtifactView(artifactId)));
          return;
        }

        sendJson(response, 200, {
          artifact,
          content: readFileSync(artifact.path, 'utf8'),
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/logs/runtime') {
        const query = parseLogQuery(requestUrl);
        const logsPath = path.join(workspaceRoot, '.agent', 'logs', 'runtime.log');
        const content = existsSync(logsPath) ? readFileSync(logsPath, 'utf8') : '';
        sendJson(response, 200, {
          path: logsPath,
          tail: query.tail ?? 400,
          content: tailText(content, query.tail ?? 400),
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
    start(options?: { worker?: boolean }) {
      return new Promise<void>((resolve) => {
        server.listen(config.server.port, config.server.host, () => {
          if (options?.worker === true) {
            this.startWorker();
          }
          resolve();
        });
      });
    },
    startWorker() {
      if (workerController) {
        return;
      }

      workerController = new AbortController();
      void runtime.startWorkerLoop(workerController.signal);
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        if (workerController) {
          workerController.abort();
          workerController = undefined;
        }
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
