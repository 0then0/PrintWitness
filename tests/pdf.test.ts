import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compare } from '../src/core/compare.ts';
import { parseManifest } from '../src/core/manifest.ts';
import { analyzePdf } from '../src/node/pdf.ts';
import { pdfResourceRoot } from '../src/node/pdf-resources.ts';

const fixture = (name: string) => readFile(new URL(`../fixtures/pdf/${name}.pdf`, import.meta.url));
const manifest = parseManifest(
  JSON.parse(
    await readFile(new URL('../fixtures/pdf/cmap-manifest.json', import.meta.url), 'utf8'),
  ),
);
const check = (index: Awaited<ReturnType<typeof analyzePdf>>['index']) =>
  compare(manifest, index, { name: 'fixture.pdf', sha256: 'synthetic' });
const controlManifest = structuredClone(manifest);
Object.assign(controlManifest.sections[0], { anchor: 'Required', endContext: 'End' });
controlManifest.sections[0].expectations[0].text = 'Plain control';

test('predefined CMap yields independent Unicode expectation through normal comparison', async () => {
  const { index, images } = await analyzePdf(await fixture('predefined-cmap'));
  assert.equal(index.error, undefined);
  assert.deepEqual(
    index.pages.map((p) => p.text),
    ['日本語'],
  );
  assert.deepEqual(
    index.tokens.map((t) => t.text),
    ['日本語'],
  );
  assert.equal(check(index).status, 'found');
  assert.equal(check(index).findings[0].evidence[0].text, '日本語');
  assert(images[0].startsWith('data:image/png;base64,'));
});

test('plain text, textless and corrupt controls have distinct results', async () => {
  const plain = await analyzePdf(await fixture('plain'));
  assert.equal(plain.index.error, undefined);
  assert.equal(plain.index.pages[0].text, 'Required Plain control End');
  assert.equal(
    compare(controlManifest, plain.index, { name: 'plain.pdf', sha256: 'test' }).status,
    'found',
  );
  const empty = await analyzePdf(await fixture('textless'));
  assert.equal(empty.index.error, undefined);
  assert.equal(empty.index.pages[0].text, '');
  assert.equal(check(empty.index).status, 'unverifiable');
  assert.equal(check(empty.index).findings[0].reason, 'No usable text layer. OCR is outside v0.1.');
  const corrupt = await analyzePdf(await fixture('corrupt'));
  assert.match(corrupt.index.error ?? '', /^Cannot read PDF:/);
  assert.equal(check(corrupt.index).status, 'unverifiable');
});

test('missing required resources cannot masquerade as a textless or fully checked PDF', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'PrintWitness resources 日本語 '));
  const root = pathToFileURL(`${directory}/`);
  try {
    for (const name of ['cmaps', 'standard_fonts'])
      await cp(new URL(`${name}/`, pdfResourceRoot), join(directory, name), { recursive: true });
    // WASM is unused by these documents and is deliberately not copied.
    const complete = await analyzePdf(await fixture('predefined-cmap'), { resourceRoot: root });
    assert.equal(check(complete.index).status, 'found');
    // Reproduce PDF.js's recovery itself, without our failure tracking.
    for (const available of [true, false]) {
      if (!available) await rm(new URL('cmaps/UniJIS-UCS2-H.bcmap', root));
      const task = getDocument({
        data: new Uint8Array(await fixture('predefined-cmap')),
        cMapUrl: fileURLToPath(new URL('cmaps/', root)).replaceAll('\\', '/'),
        cMapPacked: true,
        useSystemFonts: false,
        stopAtErrors: true,
      });
      try {
        const doc = await task.promise;
        const content = await (await doc.getPage(1)).getTextContent();
        assert.equal(
          content.items
            .filter((i) => 'str' in i)
            .map((i) => i.str)
            .join(''),
          available ? '日本語' : '',
        );
      } finally {
        await task.destroy();
      }
    }
    const missing = await analyzePdf(await fixture('predefined-cmap'), { resourceRoot: root });
    assert.match(
      missing.index.error ?? '',
      /^PDF runtime resource unavailable:.*UniJIS-UCS2-H.bcmap/,
    );
    assert.equal(check(missing.index).status, 'unverifiable');
    assert.match(check(missing.index).findings[0].reason, /Processing is incomplete/);
    const plain = await analyzePdf(await fixture('plain'), { resourceRoot: root });
    assert.equal(plain.index.error, undefined, 'an unused CMap must not break plain PDFs');
    await rm(new URL('standard_fonts/LiberationSans-Regular.ttf', root));
    const partial = await analyzePdf(await fixture('plain'), { resourceRoot: root });
    assert(
      partial.index.tokens.length > 0,
      'even surviving text must not mask a failed resource load',
    );
    assert.match(partial.index.error ?? '', /standardFontDataUrl\/LiberationSans-Regular.ttf/);
    const report = compare(controlManifest, partial.index, { name: 'partial.pdf', sha256: 'test' });
    assert.equal(report.status, 'unverifiable');
    assert(report.findings.every((finding) => finding.status === 'unverifiable'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
