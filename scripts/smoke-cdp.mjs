'use strict';
/* 萌账 v2 渲染冒烟：Node 22 内置 WebSocket 连 CDP，零 npm 依赖 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPORT = join(ROOT, 'smoke-report.txt');
const lines = [];
const report = (s) => lines.push(s);
let exitCode = 0;
process.on('uncaughtException', e => { report('UNCAUGHT: ' + e.stack); finish(99); });
process.on('unhandledRejection', e => { report('REJECTION: ' + String(e)); finish(99); });
const watchdog = setTimeout(() => { report('WATCHDOG TIMEOUT'); finish(98); }, 60000);

let finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  try { await writeFile2(REPORT, lines.join('\n')); } catch {}
  console.log('SMOKE RESULT: pass=' + passCount + ' fail=' + failCount + ' exit=' + code);
  process.exit(code);
}
import { writeFile as writeFile2 } from 'node:fs/promises';
let passCount = 0, failCount = 0;
function assert(name, cond, extra) {
  if (cond) { passCount++; report('PASS  ' + name); }
  else { failCount++; report('FAIL  ' + name + (extra ? ' | ' + extra : '')); exitCode = exitCode || 1; }
}

/* --- 静态服务 --- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
report('server port ' + PORT);

/* --- 找浏览器 --- */
const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browser = candidates.find(existsSync);
if (!browser) { report('NO BROWSER FOUND'); await finish(97); }
report('browser ' + browser);

const profile = mkdtempSync(join(tmpdir(), 'smoke-moe-'));
const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'];
const proc = spawn(browser, args, { stdio: 'ignore' });

/* --- 等 CDP 端口文件 --- */
let debugPort = 0;
for (let i = 0; i < 50; i++) {
  await new Promise(r => setTimeout(r, 200));
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) {
    const txt = await readFile(f, 'utf8');
    debugPort = parseInt(txt.split('\n')[0], 10);
    if (debugPort > 0) break;
  }
}
if (!debugPort) { report('NO CDP PORT'); await finish(97); }
report('cdp port ' + debugPort);

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let msgId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
};
function send(method, params) {
  return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { error: JSON.stringify(r.result.exceptionDetails).slice(0, 300) };
  return { value: r.result && r.result.result ? r.result.result.value : undefined };
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await new Promise(r => setTimeout(r, 1200));

/* --- 断言 --- */
let v = await evalJs('document.body.innerText.length');
assert('非白屏 innerText>40', v.value > 40, 'got ' + JSON.stringify(v).slice(0, 200));

v = await evalJs('!!document.querySelector(".type-seg")');
assert('记一笔视图：类型分段存在', v.value === true);

v = await evalJs('document.querySelectorAll(".cat-chip").length');
assert('记一笔：六大支出桶渲染', v.value === 6, 'got ' + v.value);

/* 记一笔支出 25.5 */
v = await evalJs(`(function(){
  const amt = document.getElementById('amount');
  amt.value = '25.5'; amt.dispatchEvent(new Event('input', {bubbles:true}));
  document.querySelector('.cat-chip[data-top="exp-food"]').click();
  return document.querySelectorAll('.sub-chip').length;
})()`);
assert('点餐饮桶出现二级分类', v.value >= 3, 'got ' + v.value);
v = await evalJs(`(function(){
  const subs = document.querySelectorAll('.sub-chip');
  subs[0].click();
  document.getElementById('save-btn').click();
  return 'clicked';
})()`);
await new Promise(r => setTimeout(r, 300));
v = await evalJs(`Object.keys(localStorage).filter(k=>k.startsWith('moeledger-v2-tx-')).length`);
assert('交易按月分 key 落盘', v.value >= 1, 'got ' + v.value);
v = await evalJs(`(function(){ const arr = JSON.parse(localStorage.getItem('moeledger-v2-tx-' + new Date().toISOString().slice(0,7)) || localStorage[Object.keys(localStorage).find(k=>k.startsWith('moeledger-v2-tx-'))]); const t = arr[arr.length-1]; return t.type+':'+t.amount+':'+(t.category_id||''); })()`);
assert('记录内容正确 expense:25.5:exp-food-*', /^expense:25\.5:exp-food-/.test(v.value || ''), 'got ' + v.value);

/* 切流水 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="list"]').click();
  return document.querySelectorAll('.tx-item').length;
})()`);
assert('流水列表出现 1 条记录', v.value === 1, 'got ' + v.value);
v = await evalJs('document.querySelector(".tx-item .tx-amt").textContent');
assert('流水金额显示 -25.50', v.value === '-25.50', 'got ' + v.value);

/* 记一笔收入 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="record"]').click();
  document.querySelector('.type-seg button[data-type="income"]').click();
  document.getElementById('amount').value = '5000';
  document.querySelector('.cat-grid .cat-chip').click();
  document.getElementById('save-btn').click();
  return 'ok';
})()`);
await new Promise(r => setTimeout(r, 200));
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="list"]').click();
  return document.querySelectorAll('.tx-item').length;
})()`);
assert('收入后流水 2 条', v.value === 2, 'got ' + v.value);

/* 转账 + 调整 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="record"]').click();
  document.querySelector('.type-seg button[data-type="transfer"]').click();
  document.getElementById('amount').value = '100';
  const sels = document.querySelectorAll('select');
  document.getElementById('save-btn').click();
  return 'ok';
})()`);
await new Promise(r => setTimeout(r, 200));
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="record"]').click();
  document.querySelector('.type-seg button[data-type="adjust"]').click();
  document.getElementById('amount').value = '-12';
  document.getElementById('save-btn').click();
  return 'ok';
})()`);
await new Promise(r => setTimeout(r, 200));
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="list"]').click();
  return document.querySelectorAll('.tx-item').length;
})()`);
assert('转账+调整后流水 4 条', v.value === 4, 'got ' + v.value);

/* 统计 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="stats"]').click();
  const svgs = document.querySelectorAll('.chart-wrap svg');
  return svgs.length;
})()`);
assert('统计页 3 张 SVG 图（构成/结余/净资产）', v.value === 3, 'got ' + v.value);
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="stats"]').click();
  return document.body.innerText.includes('收入') && document.body.innerText.includes('5,000.00');
})()`);
assert('统计卡片显示收入 5,000.00', v.value === true, 'got ' + JSON.stringify(v).slice(0, 120));

/* 预算设置 → 统计出预算条 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="settings"]').click();
  const btn = document.getElementById('add-acc');
  return !!btn;
})()`);
assert('设置页渲染（新建账户按钮）', v.value === true);
v = await evalJs(`(function(){
  document.getElementById('add-acc').click();
  document.getElementById('m-name').value = '理财账户';
  document.getElementById('m-ok').click();
  return document.body.innerText.includes('理财账户');
})()`);
assert('新建账户成功', v.value === true);

/* 恶意输入 */
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="record"]').click();
  document.querySelector('.type-seg button[data-type="expense"]').click();
  document.getElementById('amount').value = '1';
  document.getElementById('note').value = '<script>alert(1)</script> & "quotes" {{}} __proto__';
  document.getElementById('save-btn').click();
  return 'ok';
})()`);
await new Promise(r => setTimeout(r, 200));
v = await evalJs(`(function(){
  document.querySelector('.tab[data-tab="list"]').click();
  const item = document.querySelector('.tx-item');
  return !item.querySelector('script') && document.body.innerText.includes('__proto__');
})()`);
assert('恶意备注：不注入脚本且文本正常显示', v.value === true);

/* 异常检查 */
assert('无未捕获运行时异常', exceptions.length === 0, exceptions.join(' ; ').slice(0, 300));

report('--- excerpt ---');
const ex = await evalJs('document.body.innerText.slice(0, 500)');
report(ex.value || '(none)');

/* 清理 */
try { ws.close(); } catch {}
try { proc.kill(); } catch {}
try { server.close(); } catch {}
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { report('cleanup: ' + e.message); }
await finish(exitCode);
