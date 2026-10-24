import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('artifacts/weasyprint-2469');
await mkdir(`${root}/work`, { recursive: true });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function get(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  assert(response.ok, `${url}: ${response.status}`);
  return response;
}
const revisions = {
  parent: [
    '8ace950151b4fdf380721e06f3ff65af9a464158',
    '15f4d27a4f815fc6a42956c3105987f413a4dc75d4572a79d3de59e993e794ff',
  ],
  fix: [
    '8415e28a6269144cbc28e20c4b22d2d85e3b6d0e',
    'c3bf1b480193b533c47a4a857c5e8bd10d32bf416a05083d40031bce19390c65',
  ],
};
for (const [name, [sha, expected]] of Object.entries(revisions)) {
  const path = `${root}/work/${name}.tar.gz`;
  const bytes = new Uint8Array(
    await (await get(`https://codeload.github.com/Kozea/WeasyPrint/tar.gz/${sha}`)).arrayBuffer(),
  );
  assert.equal(hash(bytes), expected, `Archive changed for ${sha}; inspect before accepting.`);
  await writeFile(path, bytes);
  execFileSync('tar', ['-xzf', path, '-C', `${root}/work`]);
}
const issue = await (await get('https://api.github.com/repos/Kozea/WeasyPrint/issues/2469')).json();
const comments = [];
for (let page = 1; ; page++) {
  const batch = await (
    await get(
      `https://api.github.com/repos/Kozea/WeasyPrint/issues/2469/comments?per_page=100&page=${page}`,
    )
  ).json();
  comments.push(...batch);
  if (batch.length < 100) break;
}
const comment = comments.find((c) => c.id === 4060916782);
assert(comment, 'Late minimal reproducer comment missing.');
const html = `${comment.body.match(/```html\n([\s\S]*?)\n```/)[1]}\n`;
assert.equal(
  hash(html),
  '699af6e0833dc72bb383a75077608002c07aea1fdd7d10809a42e8a0bb6707b0',
  'Upstream reproducer changed.',
);
await writeFile(`${root}/work/upstream.html`, html);
await writeFile(
  `${root}/issue-evidence.json`,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      url: issue.html_url,
      state: issue.state,
      updatedAt: issue.updated_at,
      commentCount: comments.length,
      comments: comments.map((c) => ({
        id: c.id,
        url: c.html_url,
        author: c.user.login,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        bodySha256: hash(c.body),
      })),
    },
    null,
    2,
  ),
);
await writeFile(
  `${root}/LICENSE.WeasyPrint`,
  await readFile(`${root}/work/WeasyPrint-${revisions.fix[0]}/LICENSE`),
);
console.log('Fetched and hash-verified both source archives and the unchanged late reproducer.');
