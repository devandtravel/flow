import { createApiServer } from '../../packages/api/server';

async function main(): Promise<void> {
  const api = createApiServer(process.cwd());
  await api.start({ worker: true });
}

void main();
