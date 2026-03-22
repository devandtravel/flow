import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { AgentRuntime } from '../core/loop/runtime';
import { loadConfig } from '../config';

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks.length === 0 ? {} : (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload, null, 2));
}

export function createApiServer(workspaceRoot: string) {
  const config = loadConfig(workspaceRoot);
  const runtime = new AgentRuntime({ workspaceRoot, config });

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/tasks') {
      const body = await readJsonBody(request);
      const task = runtime.createTask(String(body.goal ?? ''));
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
      sendJson(response, 200, runtime.inspectTask(taskId));
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/runs/')) {
      const runId = requestUrl.pathname.split('/')[2];
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
