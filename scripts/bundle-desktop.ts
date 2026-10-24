import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { appRoot } from '../src/node/paths.ts';
import { app, metadata, output, prepared, run, target } from './desktop/common.ts';
import { createDmg } from './desktop/dmg.ts';

await readFile(join(output, 'prepared.json')); // Fail clearly if preparation was skipped.
const bundles = join(output, 'bundles');
await mkdir(bundles, { recursive: true });
const stem = `PrintWitness-${metadata.version}-${target}`;
if (process.platform === 'darwin') {
  await run('/usr/bin/ditto', [
    '-c',
    '-k',
    '--sequesterRsrc',
    '--keepParent',
    join(prepared, 'PrintWitness.app'),
    join(bundles, `${stem}.zip`),
  ]);
  const applications = join(prepared, 'Applications');
  await symlink('/Applications', applications);
  try {
    await createDmg(prepared, join(bundles, `${stem}.dmg`));
  } finally {
    await unlink(applications);
  }
} else if (process.platform === 'win32') {
  await run('tar', ['-a', '-cf', join(bundles, `${stem}.zip`), '-C', prepared, 'PrintWitness']);
  const nsis =
    process.env.NSIS_EXE ??
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'NSIS/makensis.exe');
  const uninstall: string[] = [];
  const directories: string[] = [];
  const escapeNsis = (value: string) => value.replaceAll('$', () => '$$').replaceAll('"', '$\\"');
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const destination = escapeNsis(relative(app, path).replaceAll('/', '\\'));
      if (entry.isDirectory()) {
        await visit(path);
        directories.push(`  RMDir "$INSTDIR\\${destination}"`);
      } else uninstall.push(`  Delete "$INSTDIR\\${destination}"`);
    }
  }
  await visit(app);
  const manifest = join(output, 'uninstall-files.nsh');
  await writeFile(manifest, [...uninstall, ...directories].join('\n'));
  await run(nsis, [
    `/DAPP_DIR=${app}`,
    `/DOUTPUT_FILE=${join(bundles, `${stem}-setup.exe`)}`,
    `/DVERSION=${metadata.version}`,
    `/DUNINSTALL_FILES=${manifest}`,
    join(appRoot, 'scripts/desktop/windows.nsi'),
  ]);
} else {
  await run('tar', ['-czf', join(bundles, `${stem}.tar.gz`), '-C', prepared, 'PrintWitness']);
  const deb = join(output, 'deb');
  await rm(deb, { recursive: true, force: true });
  await mkdir(join(deb, 'opt'), { recursive: true });
  await cp(app, join(deb, 'opt/printwitness'), { recursive: true });
  await mkdir(join(deb, 'DEBIAN'), { recursive: true });
  const dependencies = [
    'libasound2t64',
    'libatk-bridge2.0-0t64',
    'libatk1.0-0t64',
    'libatspi2.0-0t64',
    'libc6 (>= 2.39)',
    'libcairo2',
    'libcups2t64',
    'libdbus-1-3',
    'libdrm2',
    'libexpat1',
    'libgbm1',
    'libglib2.0-0t64',
    'libnspr4',
    'libnss3',
    'libpango-1.0-0',
    'libx11-6',
    'libxcb1',
    'libxcomposite1',
    'libxdamage1',
    'libxext6',
    'libxfixes3',
    'libxkbcommon0',
    'libxrandr2',
    'libfontconfig1',
    'fonts-liberation',
    'fonts-ipafont-gothic',
    'xdg-utils',
  ];
  await writeFile(
    join(deb, 'DEBIAN/control'),
    `Package: printwitness\nVersion: ${metadata.version}\nArchitecture: ${process.arch === 'arm64' ? 'arm64' : 'amd64'}\nMaintainer: PrintWitness maintainers <noreply@github.com>\nDepends: ${dependencies.join(', ')}\nSection: utils\nPriority: optional\nHomepage: https://github.com/0then0/PrintWitness\nDescription: Local HTML-to-PDF content verification\n Includes Node.js and Chromium. Opens the interface in the default browser.\n`,
  );
  await mkdir(join(deb, 'usr/share/applications'), { recursive: true });
  await writeFile(
    join(deb, 'usr/share/applications/printwitness.desktop'),
    '[Desktop Entry]\nType=Application\nName=PrintWitness\nComment=Verify required HTML content in PDF exports\nExec=/opt/printwitness/PrintWitness\nIcon=/opt/printwitness/icon.png\nTerminal=false\nCategories=Office;Utility;\n',
  );
  await run('dpkg-deb', ['--root-owner-group', '--build', deb, join(bundles, `${stem}.deb`)]);
}
const files = (await readdir(bundles))
  .filter((name) => name.startsWith(stem) && name !== 'SHA256SUMS.txt')
  .sort();
await writeFile(
  join(bundles, 'SHA256SUMS.txt'),
  (
    await Promise.all(
      files.map(
        async (name) =>
          `${createHash('sha256')
            .update(await readFile(join(bundles, name)))
            .digest('hex')}  ${name}\n`,
      ),
    )
  ).join(''),
);
console.log(`Desktop archives and installers: ${bundles}`);
