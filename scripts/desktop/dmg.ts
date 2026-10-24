import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function createDmg(
  source: string,
  destination: string,
  command: (args: string[]) => Promise<{ stdout: string; stderr: string }> = (args) =>
    execute('/usr/bin/hdiutil', args, { encoding: 'utf8' }),
  wait: (ms: number) => Promise<unknown> = setTimeout,
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A failed create can leave a partial image; never reuse it on a retry.
    await rm(destination, { force: true });
    try {
      const { stdout, stderr } = await command([
        'create',
        '-volname',
        'PrintWitness',
        '-srcfolder',
        source,
        '-format',
        'UDZO',
        destination,
      ]);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      return;
    } catch (error) {
      await rm(destination, { force: true });
      if (
        !(error instanceof Error) ||
        !('stderr' in error) ||
        typeof error.stderr !== 'string' ||
        !/hdiutil: create failed - Resource busy/u.test(error.stderr) ||
        attempt === 3
      )
        throw error;
      console.warn(`DMG creation returned Resource busy (attempt ${attempt}/3); retrying.`);
      await wait(attempt * 1000);
    }
  }
}
