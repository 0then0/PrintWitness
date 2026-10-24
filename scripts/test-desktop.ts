import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, relative } from 'node:path';
import { app, metadata, output, run, target } from './desktop/common.ts';
import { fixtureServer } from './fixture-server.ts';

// UI automation also uses the packaged engine, not a developer's browser cache.
process.env.PLAYWRIGHT_BROWSERS_PATH = join(app, 'browsers');
const { chromium } = await import('playwright');

const testRoot = join(output, 'smoke test 日本語');
async function makeRemovable(path: string) {
  if (process.platform === 'win32') return;
  await chmod(path, 0o755).catch(() => {});
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory()) await makeRemovable(join(path, entry.name));
}
await makeRemovable(testRoot);
await rm(testRoot, { recursive: true, force: true });
await mkdir(testRoot, { recursive: true });
const bundles = join(output, 'bundles');
const stem = `PrintWitness-${metadata.version}-${target}`;
// Windows tar can corrupt Unicode in -C arguments. Node sets cwd through the
// native Unicode process API, preserving the non-ASCII installation-path test.
await run(
  'tar',
  ['-xf', join(bundles, `${stem}.${process.platform === 'linux' ? 'tar.gz' : 'zip'}`)],
  { cwd: testRoot },
);
const portable =
  process.platform === 'darwin'
    ? join(testRoot, 'PrintWitness.app/Contents/Resources/app')
    : join(testRoot, 'PrintWitness');
const executableFor = (root: string) =>
  process.platform === 'darwin'
    ? join(root, '../../MacOS/PrintWitness')
    : join(root, process.platform === 'win32' ? 'PrintWitness.exe' : 'PrintWitness');
const emptyPath = join(testRoot, 'empty-path');
await mkdir(emptyPath);
const env: NodeJS.ProcessEnv = { ...process.env, PATH: emptyPath };
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
// A foreign service on the usual port must never be treated as our running instance.
const foreign = createServer((_req, res) => res.end('A different application'));
await new Promise<void>((done, reject) => {
  foreign.once('error', (e) =>
    (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? done() : reject(e),
  );
  foreign.listen(4173, '127.0.0.1', done);
});
const fixture = await fixtureServer();
// The test browser shares the engine directory with the portable application.
const browser = await chromium.launch({ args: ['--enable-logging=stderr'] });
const stateDir = join(testRoot, 'user state');
await mkdir(stateDir);
// Recover a real stale lock without a live PID (0 is not a process identifier here).
await writeFile(join(stateDir, 'instance.json'), '{');
const { utimes } = await import('node:fs/promises');
await utimes(join(stateDir, 'instance.json'), new Date(0), new Date(0));
async function inventory(root: string, writable?: boolean): Promise<string[]> {
  const result: string[] = [];
  async function walk(path: string) {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const item of await readdir(path)) await walk(join(path, item));
      if (writable === false && process.platform !== 'win32') await chmod(path, 0o555);
    } else {
      result.push(`${relative(root, path)}:${info.size}:${info.mtimeMs}`);
      if (writable === false && process.platform !== 'win32')
        await chmod(path, info.mode & 0o111 ? 0o555 : 0o444);
    }
  }
  await walk(root);
  return result.sort();
}
async function waitFor<T>(fn: () => Promise<T | undefined>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Desktop startup/shutdown timed out');
}
function launch(root: string, state: string) {
  const child = spawn(executableFor(root), ['--no-open', `--state-dir=${state}`], {
    cwd: testRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  child.stderr.on('data', (x) => {
    errors += x;
  });
  const exited = new Promise<number | null>((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  return { child, exited, errors: () => errors };
}
async function stateAt(state: string) {
  return (await readFile(join(state, 'instance.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => undefined)) as { port: number; pid: number; instanceId: string } | undefined;
}
async function healthy(state: string, child: ReturnType<typeof launch>) {
  return await waitFor(async () => {
    if (child.child.exitCode !== null && child.child.exitCode !== 0)
      throw new Error(child.errors() || `Launcher exited with ${child.child.exitCode}`);
    const value = await stateAt(state);
    if (!value?.port) return;
    const data = await fetch(`http://127.0.0.1:${value.port}/api/runtime`)
      .then((r) => r.json())
      .catch(() => undefined);
    return data?.instanceId === value.instanceId ? value : undefined;
  });
}
const original = await inventory(portable, false);
const first = launch(portable, stateDir);
try {
  const state = await healthy(stateDir, first);
  assert.notEqual(
    state.port,
    4173,
    'use another port when the default belongs to a foreign service',
  );
  const base = `http://127.0.0.1:${state.port}`;
  const api = async (path: string, body: unknown) => {
    const response = await fetch(`${base}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PrintWitness': '1' },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    assert(response.ok, JSON.stringify(value));
    return value;
  };
  const duplicate = launch(portable, stateDir);
  assert.equal(await duplicate.exited, 0, duplicate.errors());
  assert.equal(
    (await stateAt(stateDir))?.pid,
    state.pid,
    'duplicate launch must preserve the server',
  );
  const demo = await fetch(`${base}/api/demo`).then((r) => r.json());
  assert(demo.source.startsWith(portable), 'demo must come from the relocated distribution');
  const options = {
    source: demo.source,
    selectors: demo.selectors,
    exclusions: ['.screen-note'],
    ready: { mode: 'signal', value: 'PRINTWITNESS_READY', timeout: 10_000 },
  };
  const manifest = await api('capture', options);
  assert.equal(
    manifest.sections.flatMap((s: { expectations: unknown[] }) => s.expectations).length,
    109,
  );
  for (const variant of ['broken', 'fixed']) {
    const result = await api('print', {
      manifest,
      options: { ...options, source: `${fixture.url}?variant=${variant}` },
    });
    assert.equal(result.report.status, variant === 'broken' ? 'mismatch' : 'found');
    assert.equal(
      result.report.findings.filter((f: { status: string }) => f.status === 'mismatch').length,
      variant === 'broken' ? 6 : 0,
    );
    const image = await fetch(`${base}/api/results/${result.id}/page-1.png`);
    assert(image.ok);
    assert(
      (await image.arrayBuffer()).byteLength > 1000,
      'bundled native PDF canvas must render previews',
    );
    const html = await fetch(`${base}/api/results/${result.id}/report.html`).then((r) => r.text());
    assert(html.includes('data:image/png;base64,'));
    const pdfResponse = await fetch(`${base}/api/results/${result.id}/document.pdf`);
    const pdf = Buffer.from(new Uint8Array(await pdfResponse.arrayBuffer()));
    const imported = await api('check', {
      manifest,
      name: 'existing.pdf',
      pdf: pdf.toString('base64'),
    });
    assert.equal(imported.report.status, result.report.status);
  }
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'Is every required item still there?' }).waitFor();
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Quit PrintWitness', exact: true }).click();
  assert((await fetch(`${base}/api/runtime`)).ok, 'cancel must leave the application running');
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Quit PrintWitness', exact: true }).click();
  await page.getByText('PrintWitness has stopped. You can close this tab.').waitFor();
  assert.equal(await first.exited, 0, first.errors());
  await waitFor(async () => ((await stateAt(stateDir)) ? undefined : true));
  assert.equal(await stateAt(stateDir), undefined, 'quit must remove the instance lock');
  assert.deepEqual(await inventory(portable), original, 'runtime must not modify its installation');
  // Recover a valid state file left behind by a terminated predecessor as well.
  await writeFile(join(stateDir, 'instance.json'), JSON.stringify(state));
  const restart = launch(portable, stateDir);
  const restarted = await healthy(stateDir, restart);
  assert.equal(
    restarted.port,
    state.port,
    'restart should preserve the origin and browser preferences',
  );
  await fetch(`http://127.0.0.1:${restarted.port}/api/desktop/quit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PrintWitness': '1' },
    body: '{}',
  });
  assert.equal(await restart.exited, 0);
  await waitFor(async () => ((await stateAt(stateDir)) ? undefined : true));
  console.log(
    'Portable: clean PATH, Unicode/space paths, read-only bundle, port collision, stale lock, duplicate launch, capture, broken/fixed PDF, PDF upload, native previews, UI quit and restart passed.',
  );
  // Extract or mount the installer and launch its identical payload as well.
  let installed: string;
  let detach: (() => Promise<void>) | undefined;
  if (process.platform === 'darwin') {
    const mount = join(testRoot, 'installer mount');
    await mkdir(mount);
    await run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mount,
      join(bundles, `${stem}.dmg`),
    ]);
    installed = join(mount, 'PrintWitness.app/Contents/Resources/app');
    detach = () => run('/usr/bin/hdiutil', ['detach', mount]);
  } else if (process.platform === 'win32') {
    installed = join(testRoot, 'installed');
    await run(join(bundles, `${stem}-setup.exe`), ['/S', `/D=${installed}`]);
    detach = () => run(join(installed, 'Uninstall.exe'), ['/S', `_?=${installed}`]);
  } else {
    const deb = join(testRoot, 'deb');
    await run('dpkg-deb', ['-x', join(bundles, `${stem}.deb`), deb]);
    installed = join(deb, 'opt/printwitness');
  }
  try {
    for (const file of ['build.json', 'runtime/LICENSE', 'src/node/server.ts']) {
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      assert.equal(
        hash(await readFile(join(installed, file))),
        hash(await readFile(join(app, file))),
      );
    }
    const installedState = join(testRoot, 'installed state');
    let child: ReturnType<typeof launch>;
    if (process.platform === 'darwin') {
      await run('/usr/bin/open', [
        '-n',
        join(installed, '../../..'),
        '--args',
        '--no-open',
        `--state-dir=${installedState}`,
      ]);
      const state = await waitFor(async () => {
        const value = await stateAt(installedState);
        return value?.port ? value : undefined;
      });
      await fetch(`http://127.0.0.1:${state.port}/api/desktop/quit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PrintWitness': '1' },
        body: '{}',
      });
      await waitFor(async () => ((await stateAt(installedState)) ? undefined : true));
      console.log('macOS LaunchServices: one-click application bundle launch passed.');
      child = launch(installed, installedState);
    } else child = launch(installed, installedState);
    const ready = await healthy(installedState, child);
    await fetch(`http://127.0.0.1:${ready.port}/api/desktop/quit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PrintWitness': '1' },
      body: '{}',
    });
    assert.equal(await child.exited, 0, child.errors());
    await waitFor(async () => ((await stateAt(installedState)) ? undefined : true));
    console.log('Installer payload: identical resources, launch and shutdown passed.');
  } finally {
    await detach?.();
  }
} finally {
  first.child.kill('SIGTERM');
  await browser.close();
  await fixture.close();
  if (foreign.listening) await new Promise<void>((done) => foreign.close(() => done()));
}
