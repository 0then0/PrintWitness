import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appRoot } from '../../src/node/paths.ts';

export const metadata = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8')) as {
  version: string;
  desktop: { nodeVersion: string };
};
if (
  !['darwin', 'win32', 'linux'].includes(process.platform) ||
  !['x64', 'arm64'].includes(process.arch)
)
  throw new Error(`Unsupported packaging host: ${process.platform}-${process.arch}`);
export const target = `${process.platform}-${process.arch}`;
export const output = join(appRoot, 'artifacts/desktop', target);
export const prepared = join(output, 'prepared');
export const app =
  process.platform === 'darwin'
    ? join(prepared, 'PrintWitness.app/Contents/Resources/app')
    : join(prepared, 'PrintWitness');
export const launcher =
  process.platform === 'darwin'
    ? join(prepared, 'PrintWitness.app/Contents/MacOS/PrintWitness')
    : join(app, process.platform === 'win32' ? 'PrintWitness.exe' : 'PrintWitness');
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return new Promise<void>((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? appRoot,
      env: options.env ?? process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}
export const npm = (args: string[], cwd: string) =>
  run(
    process.execPath,
    [
      // npm_execpath is set by npm scripts on every platform, including Windows.
      process.env.npm_execpath ??
        (() => {
          throw new Error('Run this command through npm.');
        })(),
      ...args,
    ],
    { cwd },
  );
