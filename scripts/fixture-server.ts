import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
export async function fixtureServer() {
  const html = await readFile(resolve('fixtures/validation.html'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/validation.html`,
    close: () => new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done()))),
  };
}
