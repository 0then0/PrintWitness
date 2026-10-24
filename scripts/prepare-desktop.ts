import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { appRoot } from '../src/node/paths.ts';
import { app, launcher, metadata, npm, output, prepared, run, target } from './desktop/common.ts';

const cache = join(appRoot, 'artifacts/desktop-cache', target);
await mkdir(cache, { recursive: true });
await rm(prepared, { recursive: true, force: true });
await mkdir(app, { recursive: true });
for (const path of [
  'dist',
  'src/core',
  'src/node',
  'src/i18n',
  'fixtures',
  'LICENSE',
  'package.json',
  'package-lock.json',
])
  await cp(join(appRoot, path), join(app, path), { recursive: true });
await copyFile(join(appRoot, 'docs/desktop.md'), join(app, 'README.md'));
await npm(
  ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--cache', join(appRoot, '.npm-cache')],
  app,
);
// The runtime is an official redistributable, never the host's possibly dynamically-linked Node.
const version = metadata.desktop.nodeVersion;
if (!/^24\.\d+\.\d+$/.test(version)) throw new Error('Pin a supported Node.js 24 runtime version.');
const platform = process.platform === 'win32' ? 'win' : process.platform;
const filename = `node-v${version}-${platform}-${process.arch}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
const base = `https://nodejs.org/dist/v${version}`;
async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
const expected = sums
  .split('\n')
  .find((line) => line.trim().split(/\s+/)[1] === filename)
  ?.split(/\s+/)[0];
if (!expected || !/^[a-f\d]{64}$/.test(expected))
  throw new Error('Node archive is missing from official checksums.');
const archive = join(cache, filename);
let bytes = await readFile(archive).catch(() => undefined);
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
  bytes = await download(`${base}/${filename}`);
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Node archive checksum mismatch.');
  await writeFile(archive, bytes);
}
const unpack = join(cache, `node-v${version}`);
await rm(unpack, { recursive: true, force: true });
await mkdir(unpack, { recursive: true });
await run('tar', ['-xf', archive, '-C', unpack]);
const nodeRoot = join(unpack, `node-v${version}-${platform}-${process.arch}`);
await mkdir(join(app, 'runtime'), { recursive: true });
await copyFile(
  join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'bin/node'),
  join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
);
await copyFile(join(nodeRoot, 'LICENSE'), join(app, 'runtime/LICENSE'));
if (process.platform !== 'win32') await chmod(join(app, 'runtime/node'), 0o755);

// Reuse this checkout's known browser binaries when present, otherwise install only the
// headless Chromium engine (and Playwright's companion assets) into a build cache.
const browsers = join(cache, 'browsers');
await mkdir(browsers, { recursive: true });
const local = join(appRoot, '.local-browsers');
for (const entry of await readdir(local).catch(() => []))
  if (/^(chromium_headless_shell|ffmpeg|winldd)-/.test(entry))
    await cp(join(local, entry), join(browsers, entry), { recursive: true });
await run(
  process.execPath,
  [join(appRoot, 'node_modules/playwright/cli.js'), 'install', 'chromium', '--only-shell'],
  {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
  },
);
await cp(browsers, join(app, 'browsers'), {
  recursive: true,
  filter: (source) => !source.endsWith('/.links') && !source.endsWith('\\.links'),
});
await writeFile(
  join(app, 'build.json'),
  JSON.stringify(
    {
      version: metadata.version,
      target,
      node: version,
      nodeSha256: expected,
      playwright: JSON.parse(
        await readFile(join(app, 'node_modules/playwright/package.json'), 'utf8'),
      ).version,
    },
    null,
    2,
  ),
);

// Generate native launcher icons from the repository SVG with the installed renderer.
process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const { chromium } = await import('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:256px;height:256px;background:#e6e4e0">${(await readFile(join(appRoot, 'public/icon.svg'), 'utf8')).replace('<svg ', '<svg width="216" height="162" ')}</body>`,
  );
  await page.screenshot({ path: join(app, 'icon.png') });
} finally {
  await browser.close();
}
if (process.platform === 'darwin') {
  const contents = join(prepared, 'PrintWitness.app/Contents');
  await mkdir(dirname(launcher), { recursive: true });
  // Release the LaunchServices bootstrap so another Finder launch can reopen the
  // browser. The background Node process owns the instance lock and UI shutdown.
  await writeFile(
    launcher,
    '#!/bin/sh\nAPP_ROOT="$(CDPATH= cd -- "$(/usr/bin/dirname "$0")/../Resources/app" && pwd)"\n"$APP_ROOT/runtime/node" "$APP_ROOT/src/node/launcher.ts" "$@" >/dev/null 2>&1 &\n',
    { mode: 0o755 },
  );
  const iconset = join(cache, 'PrintWitness.iconset');
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2])
      await run('/usr/bin/sips', [
        '-z',
        String(size * scale),
        String(size * scale),
        join(app, 'icon.png'),
        '--out',
        join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
      ]);
  }
  await run('/usr/bin/iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    join(contents, 'Resources/PrintWitness.icns'),
  ]);
  await writeFile(
    join(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>org.printwitness.desktop</string><key>CFBundleName</key><string>PrintWitness</string><key>CFBundleExecutable</key><string>PrintWitness</string><key>CFBundleIconFile</key><string>PrintWitness</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${metadata.version}</string><key>CFBundleVersion</key><string>${metadata.version}</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>LSUIElement</key><true/></dict></plist>`,
  );
} else if (process.platform === 'win32') {
  const png = await readFile(join(app, 'icon.png'));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile(join(app, 'icon.ico'), Buffer.concat([header, png]));
  const compiler = join(
    process.env.WINDIR ?? 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  await run(compiler, [
    '/nologo',
    '/target:winexe',
    `/out:${launcher}`,
    `/win32icon:${join(app, 'icon.ico')}`,
    '/reference:System.Windows.Forms.dll',
    join(appRoot, 'scripts/desktop/Launcher.cs'),
  ]);
} else {
  await writeFile(
    launcher,
    '#!/bin/sh\nAPP_ROOT="$(CDPATH= cd -- "$(/usr/bin/dirname "$0")" && pwd)"\nexec "$APP_ROOT/runtime/node" "$APP_ROOT/src/node/launcher.ts" "$@"\n',
    { mode: 0o755 },
  );
}
await writeFile(
  join(output, 'prepared.json'),
  JSON.stringify({ app, launcher, target, version: metadata.version }, null, 2),
);
console.log(`Prepared ${target}: ${launcher}`);
