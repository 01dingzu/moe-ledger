'use strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const server = await import('node:http').then(h => h.createServer);
const http = await import('node:http');
const srv = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const data = await readFile(join(ROOT, p));
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;

const browser = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'dbg-moe-'));
const proc = spawn(browser, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let debugPort = 0;
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 200));
  try { const t = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); debugPort = parseInt(t.split('\n')[0], 10); if (debugPort) break; } catch {}
}
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(JSON.stringify(m.params).slice(0, 500)); };
const send = (m, p) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? { ERR: JSON.stringify(r.result.exceptionDetails).slice(0, 400) } : r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await new Promise(r => setTimeout(r, 1200));

const out = [];
out.push(await ev(`window.__errs=[]; window.onerror=(m,s,l,c)=>{window.__errs.push(m+'@'+l+':'+c); return true;}; 'hooked'`));
out.push(['step1 set amount', await ev(`(function(){ document.getElementById('amount').value='25.5'; return document.getElementById('amount').value; })()`)]);
out.push(['step2 click cat', await ev(`(function(){ document.querySelector('.cat-chip[data-top="exp-food"]').click(); return {top: state.recordTop, amt: document.getElementById('amount') && document.getElementById('amount').value}; })()`)]);
out.push(['step3 click sub+save', await ev(`(function(){ try { const subs=document.querySelectorAll('.sub-chip'); subs[0].click(); const btn=document.getElementById('save-btn'); btn.click(); return {clicked:true, errs:window.__errs, amt: document.getElementById('amount') ? document.getElementById('amount').value : null}; } catch(e) { return {throw: e.message, errs: window.__errs}; } })()`)]);
out.push(['step4 keys', await ev(`Object.keys(localStorage).filter(k=>k.startsWith('moeledger-v2')).map(k=>k+'#'+JSON.parse(localStorage.getItem(k)||'[]').length).join(',')`)]);
out.push(['runtime exceptions', errs]);
console.log(out.map(o => typeof o === 'string' ? o : JSON.stringify(o)).join('\n'));
ws.close(); proc.kill(); srv.close(); rmSync(profile, { recursive: true, force: true });
process.exit(0);
