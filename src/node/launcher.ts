import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { appRoot } from './paths.ts';

interface Instance {
  pid: number;
  port: number;
  instanceId: string;
}
const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const stateArg = args.find((a) => a.startsWith('--state-dir='));
const stateDir = stateArg
  ? resolve(stateArg.slice('--state-dir='.length))
  : join(
      process.platform === 'darwin'
        ? join(homedir(), 'Library/Application Support')
        : process.platform === 'win32'
          ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'))
          : (process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state')),
      'PrintWitness',
    );
const lock = join(stateDir, 'instance.json');
const lastPort = join(stateDir, 'port.json');
const log = join(stateDir, 'launcher.log');
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const own: Instance = { pid: process.pid, port: 0, instanceId: randomUUID() };

async function saveJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await appendFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
async function releaseLock() {
  const current = await readFile(lock, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (current?.instanceId === own.instanceId) await unlink(lock).catch(() => {});
}
async function acquire(): Promise<Instance | undefined> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const file = await open(lock, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify(own));
      } finally {
        await file.close();
      }
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      const raw = await readFile(lock, 'utf8');
      let other: Instance;
      try {
        other = JSON.parse(raw);
      } catch {
        if (Date.now() - (await stat(lock)).mtimeMs > 30_000) await unlink(lock);
        else await delay(100);
        continue;
      }
      if (!Number.isInteger(other.pid) || other.pid <= 0 || typeof other.instanceId !== 'string')
        throw new Error(`Invalid application state. Remove ${lock} after closing PrintWitness.`);
      if (!isAlive(other.pid)) {
        // Do not remove a lock replaced by a concurrent launcher.
        if ((await readFile(lock, 'utf8')) === raw) await unlink(lock);
        continue;
      }
      if (Number.isInteger(other.port) && other.port > 0 && other.port <= 65535) {
        const runtime = await fetch(`http://127.0.0.1:${other.port}/api/runtime`, {
          signal: AbortSignal.timeout(500),
        })
          .then((r) => r.json())
          .catch(() => null);
        if (runtime?.desktop && runtime.instanceId === other.instanceId) return other;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await delay(100);
  }
  throw new Error('PrintWitness is still starting or stopping. Try again in a few seconds.');
}
async function openBrowser(url: string) {
  if (noOpen) return;
  const command =
    process.platform === 'darwin'
      ? '/usr/bin/open'
      : process.platform === 'win32'
        ? 'explorer.exe'
        : 'xdg-open';
  await new Promise<void>((done, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 || (process.platform === 'win32' && code === 1)
        ? done()
        : reject(new Error(`Cannot open the browser. Open ${url} manually.`)),
    );
  });
}
async function main() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const existing = await acquire();
  if (existing) {
    await openBrowser(`http://127.0.0.1:${existing.port}`);
    return;
  }
  let closeOnFailure: (() => Promise<void>) | undefined;
  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(appRoot, 'browsers');
    const { startServer } = await import('./server.ts');
    const saved = await readFile(lastPort, 'utf8')
      .then(JSON.parse)
      .catch(() => 4173);
    const preferred = Number.isInteger(saved) && saved >= 1024 && saved <= 65535 ? saved : 4173;
    let application: Awaited<ReturnType<typeof startServer>> | undefined;
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      try {
        await application?.close();
      } finally {
        await releaseLock();
        clearTimeout(timeout);
      }
    };
    try {
      application = await startServer({
        port: preferred,
        desktop: { instanceId: own.instanceId, quit: () => void stop() },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      application = await startServer({
        port: 0,
        desktop: { instanceId: own.instanceId, quit: () => void stop() },
      });
    }
    closeOnFailure = application.close;
    own.port = application.port;
    await saveJson(lock, own);
    await saveJson(lastPort, own.port);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop());
    await appendFile(log, `${new Date().toISOString()} Listening on ${application.url}\n`, {
      mode: 0o600,
    });
    // A missing default browser does not discard the running application or its address.
    await openBrowser(application.url).catch(async (error) => {
      await appendFile(log, `${String(error)}\n`, { mode: 0o600 });
      console.error(error);
    });
  } catch (error) {
    await closeOnFailure?.();
    await releaseLock();
    throw error;
  }
}
try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await appendFile(log, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }).catch(
    () => {},
  );
  if (!noOpen && process.platform === 'darwin') {
    spawn(
      '/usr/bin/osascript',
      [
        '-e',
        'on run argv\ndisplay alert "PrintWitness" message (item 1 of argv) as critical\nend run',
        `${message}\nLog: ${log}`,
      ],
      { stdio: 'ignore' },
    );
  }
  process.exitCode = 1;
}
