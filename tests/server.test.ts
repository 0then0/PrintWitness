import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/node/server.ts';

const headers = { 'Content-Type': 'application/json', 'X-PrintWitness': '1' };
test('desktop lifecycle API uses the actual bound port and retains browser-origin protection', async () => {
  let quit = false;
  const server = await startServer({
    port: 0,
    desktop: {
      instanceId: 'test-instance',
      quit: () => {
        quit = true;
      },
    },
  });
  try {
    assert(server.port > 0);
    const runtime = await fetch(`${server.url}/api/runtime`).then((r) => r.json());
    assert.deepEqual(runtime, { desktop: true, instanceId: 'test-instance' });
    const forbidden = await fetch(`${server.url}/api/desktop/quit`, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://foreign.example' },
      body: '{}',
    });
    assert.equal(forbidden.status, 403);
    const missingHeader = await fetch(`${server.url}/api/desktop/quit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(quit, false);
    const accepted = await fetch(`${server.url}/api/desktop/quit`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.deepEqual(await accepted.json(), { stopped: true });
    await new Promise((done) => setImmediate(done));
    assert.equal(quit, true);
  } finally {
    await server.close();
  }
});
test('source-server mode does not expose desktop shutdown and resolves its own fixture path', async () => {
  const server = await startServer({ port: 0 });
  try {
    assert.deepEqual(await fetch(`${server.url}/api/runtime`).then((r) => r.json()), {
      desktop: false,
    });
    const quit = await fetch(`${server.url}/api/desktop/quit`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(quit.status, 404);
    const demo = await fetch(`${server.url}/api/demo`).then((r) => r.json());
    assert.equal(
      demo.source,
      fileURLToPath(new URL('../fixtures/validation.html', import.meta.url)),
    );
  } finally {
    await server.close();
  }
});
