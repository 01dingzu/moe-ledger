'use strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try { res.writeHead(200, { 'Content-Type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); res.end(await readFile(join(ROOT, p))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'dbg2-'));
const proc = spawn(browser, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let debugPort = 0;
for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 200)); try { const t = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); debugPort = parseInt(t.split('\n')[0], 10); if (debugPort) break; } catch {} }
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 300) } : r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/index.html` });
await new Promise(r => setTimeout(r, 1200));

const out = [];
out.push(['save evil', await ev(`(function(){
  document.querySelector('.tab[data-tab="record"]').click();
  document.getElementById('amount').value = '1';
  document.getElementById('note').value = '<script>alert(1)</script> & "quotes" {{}} __proto__';
  document.getElementById('save-btn').click();
  return 'ok';
})()`)]);
out.push(['list check', await ev(`(function(){
  document.querySelector('.tab[data-tab="list"]').click();
  const item = document.querySelector('.tx-item');
  return {
    hasItem: !!item,
    hasInjectedScript: item ? !!item.querySelector('script') : null,
    noteText: item ? item.querySelector('.tx-note').textContent : null,
    includes: document.body.innerText.includes('__proto__'),
  };
})()`)]);
console.log(JSON.stringify(out, null, 1));
ws.close(); proc.kill(); srv.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
