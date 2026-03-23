import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDefaultConfig } from '../packages/config';
import { createApiServer } from '../packages/api/server';

let workspaceRoot = '';
let api: ReturnType<typeof createApiServer>;
let nextPort = 4310;
let currentBaseUrl = '';

beforeEach(async () => {
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'flow-api-'));
  const config = buildDefaultConfig(workspaceRoot, 'system');
  config.llm.provider = 'mock';
  config.server.port = nextPort;
  currentBaseUrl = `http://127.0.0.1:${String(nextPort)}`;
  nextPort += 1;
  api = createApiServer(workspaceRoot, config);
  await api.start();
});

afterEach(async () => {
  await api.stop();
});

describe('API server', () => {
  it('serves dashboard assets and aggregated state', async () => {
    const dashboardResponse = await fetch(`${currentBaseUrl}/`);
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.headers.get('content-type')).toContain('text/html');

    const dashboardStateResponse = await fetch(`${currentBaseUrl}/dashboard/state`);
    expect(dashboardStateResponse.status).toBe(200);
    const dashboardStateJson = await dashboardStateResponse.json();
    expect(dashboardStateJson.health).toEqual(
      expect.objectContaining({
        status: 'ok',
      }),
    );
    expect(Array.isArray(dashboardStateJson.tasks)).toBe(true);
    expect(Array.isArray(dashboardStateJson.approvals)).toBe(true);
    expect(Array.isArray(dashboardStateJson.targets)).toBe(true);
  });

  it('returns dashboard state without 404 for a stale task selection', async () => {
    const staleTaskId = '843db5d1-e9e1-4820-8583-14094f3d80b9';
    const dashboardStateResponse = await fetch(`${currentBaseUrl}/dashboard/state?taskId=${staleTaskId}`);
    expect(dashboardStateResponse.status).toBe(200);
    const dashboardStateJson = await dashboardStateResponse.json();
    expect(dashboardStateJson).toEqual(
      expect.objectContaining({
        selection: expect.objectContaining({
          requestedTaskId: staleTaskId,
          resolvedTaskId: '',
          requestedTaskMissing: true,
        }),
      }),
    );
    expect(dashboardStateJson.timeline).toBeUndefined();
  });

  it('creates and runs a task through the REST API', async () => {
    const response = await fetch(`${currentBaseUrl}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'write api output', autorun: true }),
    });

    expect(response.status).toBe(201);
    const summaryJson = await response.json();
    expect(typeof summaryJson).toBe('object');
    if (!summaryJson || typeof summaryJson !== 'object') {
      throw new Error('Expected a summary payload.');
    }

    if (!('state' in summaryJson) || typeof summaryJson.state !== 'string') {
      throw new Error('Summary payload is missing the state field.');
    }

    expect(summaryJson.state).toBe('completed');

    const approvalsResponse = await fetch(`${currentBaseUrl}/approvals`);
    const approvalsJson = await approvalsResponse.json();
    expect(Array.isArray(approvalsJson)).toBe(true);

    if ('task' in summaryJson && summaryJson.task && typeof summaryJson.task === 'object' && 'id' in summaryJson.task && typeof summaryJson.task.id === 'string') {
      const timelineResponse = await fetch(`${currentBaseUrl}/tasks/${summaryJson.task.id}/timeline?limit=1&offset=0`);
      const timelineJson = await timelineResponse.json();
      expect(timelineResponse.status).toBe(200);
      expect(timelineJson).toEqual(
        expect.objectContaining({
          page: expect.objectContaining({
            limit: 1,
            offset: 0,
          }),
          approvals: expect.any(Array),
          runs: expect.any(Array),
        }),
      );
    } else {
      throw new Error('Summary payload is missing task.id.');
    }

    if ('runId' in summaryJson && typeof summaryJson.runId === 'string') {
      const runEventsResponse = await fetch(`${currentBaseUrl}/runs/${summaryJson.runId}/events?limit=1&offset=0`);
      expect(runEventsResponse.status).toBe(200);
      const runEventsJson = await runEventsResponse.json();
      expect(runEventsJson).toEqual(
        expect.objectContaining({
          page: expect.objectContaining({
            limit: 1,
            offset: 0,
          }),
          events: expect.any(Array),
        }),
      );

      const filteredRunEventsResponse = await fetch(`${currentBaseUrl}/runs/${summaryJson.runId}/events?limit=10&offset=0&level=info`);
      expect(filteredRunEventsResponse.status).toBe(200);

      const runViewResponse = await fetch(`${currentBaseUrl}/runs/${summaryJson.runId}/view?eventLevel=info`);
      expect(runViewResponse.status).toBe(200);
      const runViewJson = await runViewResponse.json();
      expect(runViewJson).toEqual(
        expect.objectContaining({
          run: expect.objectContaining({
            id: summaryJson.runId,
          }),
          summary: expect.objectContaining({
            completedSteps: expect.any(Number),
            changedFiles: expect.any(Array),
          }),
        }),
      );
    }

    if ('task' in summaryJson && summaryJson.task && typeof summaryJson.task === 'object' && 'id' in summaryJson.task && typeof summaryJson.task.id === 'string') {
      const dashboardTaskStateResponse = await fetch(`${currentBaseUrl}/dashboard/state?taskId=${summaryJson.task.id}`);
      expect(dashboardTaskStateResponse.status).toBe(200);
      const dashboardTaskStateJson = await dashboardTaskStateResponse.json();
      expect(dashboardTaskStateJson).toEqual(
        expect.objectContaining({
          timeline: expect.objectContaining({
            task: expect.objectContaining({
              id: summaryJson.task.id,
            }),
          }),
        }),
      );

      const filteredDashboardResponse = await fetch(
        `${currentBaseUrl}/dashboard/state?taskId=${summaryJson.task.id}&taskState=completed&approvalStatus=pending&eventLevel=info&runLimit=5&runOffset=0`,
      );
      expect(filteredDashboardResponse.status).toBe(200);
      const filteredDashboardJson = await filteredDashboardResponse.json();
      expect(filteredDashboardJson).toEqual(
        expect.objectContaining({
          filters: expect.objectContaining({
            taskState: 'completed',
            approvalStatus: 'pending',
            eventLevel: 'info',
          }),
        }),
      );

      const artifactBrowserResponse = await fetch(`${currentBaseUrl}/tasks/${summaryJson.task.id}/artifacts/browser?limit=8&offset=0`);
      expect(artifactBrowserResponse.status).toBe(200);
      const artifactBrowserJson = await artifactBrowserResponse.json();
      expect(artifactBrowserJson).toEqual(
        expect.objectContaining({
          taskId: summaryJson.task.id,
          page: expect.objectContaining({
            limit: 8,
            offset: 0,
          }),
          runs: expect.any(Array),
        }),
      );

      const artifactId = artifactBrowserJson.runs?.[0]?.steps?.[0]?.artifacts?.[0]?.artifact?.id;
      expect(typeof artifactId).toBe('string');
      const artifactViewResponse = await fetch(`${currentBaseUrl}/artifacts/${artifactId}/view`);
      expect(artifactViewResponse.status).toBe(200);
      const artifactViewJson = await artifactViewResponse.json();
      expect(artifactViewJson).toEqual(
        expect.objectContaining({
          artifact: expect.objectContaining({
            id: artifactId,
          }),
          summary: expect.objectContaining({
            title: expect.any(String),
          }),
        }),
      );
    }
  }, 10000);

  it('manages targets, schedules, and maintenance endpoints', async () => {
    const targetsResponse = await fetch(`${currentBaseUrl}/targets`);
    const targetsJson = await targetsResponse.json();
    expect(Array.isArray(targetsJson)).toBe(true);

    const targetCreateResponse = await fetch(`${currentBaseUrl}/targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'service-b',
        root: path.join(workspaceRoot, 'service-b'),
        readPaths: ['.'],
        writePaths: ['.'],
        capabilities: ['fs.read', 'fs.write', 'repo.test'],
      }),
    });
    expect(targetCreateResponse.status).toBe(201);

    const targetShowResponse = await fetch(`${currentBaseUrl}/targets/service-b`);
    expect(targetShowResponse.status).toBe(200);
    const targetShowJson = await targetShowResponse.json();
    expect(targetShowJson).toEqual(
      expect.objectContaining({
        id: 'service-b',
      }),
    );

    const conflictingTargetResponse = await fetch(`${currentBaseUrl}/targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'service-b-conflict',
        root: path.join(workspaceRoot, 'service-b', 'nested'),
        readPaths: ['.'],
        writePaths: ['.'],
        capabilities: ['fs.read'],
      }),
    });
    expect(conflictingTargetResponse.status).toBe(409);

    const invalidTargetResponse = await fetch(`${currentBaseUrl}/targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'invalid-target',
        root: path.join(workspaceRoot, 'invalid-target'),
        readPaths: [],
        writePaths: ['.'],
        capabilities: ['fs.read'],
      }),
    });
    expect(invalidTargetResponse.status).toBe(422);

    const scheduleCreateResponse = await fetch(`${currentBaseUrl}/schedules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'nightly-write',
        goal: 'write scheduled api output',
        intervalSeconds: 3600,
        enabled: true,
      }),
    });
    expect(scheduleCreateResponse.status).toBe(201);

    const schedulesResponse = await fetch(`${currentBaseUrl}/schedules`);
    const schedulesJson = await schedulesResponse.json();
    expect(Array.isArray(schedulesJson)).toBe(true);

    const workerResponse = await fetch(`${currentBaseUrl}/worker/run-once`, {
      method: 'POST',
    });
    expect(workerResponse.status).toBe(200);

    const updatedTargetsResponse = await fetch(`${currentBaseUrl}/targets`);
    const updatedTargetsJson = await updatedTargetsResponse.json();
    expect(Array.isArray(updatedTargetsJson)).toBe(true);
    expect(updatedTargetsJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'service-b',
        }),
      ]),
    );

    const deleteTargetResponse = await fetch(`${currentBaseUrl}/targets/service-b`, {
      method: 'DELETE',
    });
    expect(deleteTargetResponse.status).toBe(200);

    const missingTargetResponse = await fetch(`${currentBaseUrl}/targets/missing-target`);
    expect(missingTargetResponse.status).toBe(404);

    const missingTaskResponse = await fetch(`${currentBaseUrl}/tasks/missing-task-id`);
    expect(missingTaskResponse.status).toBe(404);

    const missingRunResponse = await fetch(`${currentBaseUrl}/runs/00000000-0000-0000-0000-000000000000`);
    expect(missingRunResponse.status).toBe(404);

    const cleanupResponse = await fetch(`${currentBaseUrl}/maintenance/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keepLatestArtifacts: 1,
        keepLatestRunEvents: 1,
        keepLatestMemoryEntries: 1,
        maxArtifactAgeDays: 0,
        maxRunEventAgeDays: 0,
        maxMemoryEntryAgeDays: 0,
        dryRun: true,
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    const cleanupJson = await cleanupResponse.json();
    expect(cleanupJson).toEqual(
      expect.objectContaining({
        maintenanceEventId: expect.any(String),
        dryRun: true,
        retention: expect.objectContaining({
          maxArtifactAgeDays: 0,
          maxRunEventAgeDays: 0,
          maxMemoryEntryAgeDays: 0,
        }),
        deletedArtifactIds: expect.any(Array),
        deletedRunEventIds: expect.any(Array),
        deletedMemoryEntryIds: expect.any(Array),
      }),
    );

    const maintenanceStatusResponse = await fetch(`${currentBaseUrl}/maintenance/status`);
    expect(maintenanceStatusResponse.status).toBe(200);
    const maintenanceStatusJson = await maintenanceStatusResponse.json();
    expect(maintenanceStatusJson).toEqual(
      expect.objectContaining({
        operation: 'cleanup',
        intervalSeconds: null,
        due: false,
      }),
    );

    const maintenanceSummaryResponse = await fetch(`${currentBaseUrl}/maintenance/summary`);
    expect(maintenanceSummaryResponse.status).toBe(200);
    const maintenanceSummaryJson = await maintenanceSummaryResponse.json();
    expect(maintenanceSummaryJson).toEqual(
      expect.objectContaining({
        operation: 'cleanup',
        totals: expect.objectContaining({
          all: expect.any(Number),
          apiManual: expect.any(Number),
        }),
      }),
    );

    const maintenanceEventsResponse = await fetch(`${currentBaseUrl}/maintenance/events?limit=10&offset=0&operation=cleanup&dryRun=true&trigger=api_manual`);
    expect(maintenanceEventsResponse.status).toBe(200);
    const maintenanceEventsJson = await maintenanceEventsResponse.json();
    expect(maintenanceEventsJson).toEqual(
      expect.objectContaining({
        page: expect.objectContaining({
          total: expect.any(Number),
          limit: 10,
          offset: 0,
        }),
        events: expect.any(Array),
      }),
    );

    const maintenanceRunDueResponse = await fetch(`${currentBaseUrl}/maintenance/run-due`, {
      method: 'POST',
    });
    expect(maintenanceRunDueResponse.status).toBe(200);
    const maintenanceRunDueJson = await maintenanceRunDueResponse.json();
    expect(maintenanceRunDueJson).toEqual(
      expect.objectContaining({
        status: 'idle',
      }),
    );
  }, 10000);
});
