'use strict';
/* ============================================================
 * 萌账 v2 应用层：视图渲染 + 手写 SVG 图表（无任何库）
 * ============================================================ */

const CUR_SYMBOL = { CNY: '¥', JPY: '¥', USD: '$' };
const CAT_COLOR = {
  'exp-house': '#534AB7', 'exp-food': '#D85A30', 'exp-hobby': '#D4537E',
  'exp-travel': '#1D9E75', 'exp-daily': '#BA7517', 'exp-big': '#185FA5', 'unknown': '#888780',
};
const TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账', adjust: '调整' };

const state = {
  tab: 'record',
  recordType: 'expense',
  recordTop: null, recordSub: null,
  editingId: null,
  listYm: null, listType: 'all', listAcc: '',
  statsYm: null, statsCur: 'CNY',
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function fmt(n, cur) { return fmtAmount(n, cur); }
function curSym(c) { return CUR_SYMBOL[c] || c; }
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
}

/* ============ 图表（纯 SVG） ============ */
function donutSVG(items) {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return '<div class="empty-tip">本月暂无支出</div>';
  const r = 54, c = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map(x => {
    const len = x.value / total * c;
    const seg = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${x.color}" stroke-width="22" stroke-dasharray="${len.toFixed(1)} ${(c - len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 80 80)"/>`;
    offset += len;
    return seg;
  }).join('');
  return `<svg viewBox="0 0 160 160" role="img">${segs}
    <text x="80" y="76" text-anchor="middle" font-size="11" fill="#888780">本月支出</text>
    <text x="80" y="96" text-anchor="middle" font-size="16" font-weight="600" fill="#2C2C2A">${fmt(total, state.statsCur)}</text></svg>`;
}
function barsSVG(items) {
  if (!items.length) return '';
  const vals = items.map(x => x.income - x.expense);
  const max = Math.max(...vals.map(Math.abs), 1);
  const W = 320, H = 130, pad = 6, bw = (W - pad * 2) / items.length;
  const base = H - 22, upMax = H - 34;
  const bars = items.map((x, i) => {
    const v = vals[i];
    const h = Math.max(Math.abs(v) / max * (upMax * 0.75), v ? 2 : 0);
    const y = v >= 0 ? base - h : base;
    const color = v >= 0 ? '#0F6E56' : '#A32D2D';
    return `<rect x="${(pad + i * bw + bw * 0.22).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.56).toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${color}"/>
      <text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#888780">${x.ym.slice(5)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="${pad}" y1="${base}" x2="${W - pad}" y2="${base}" stroke="#D3D1C7" stroke-width="1"/>${bars}</svg>`;
}
function lineSVG(items) {
  const vals = items.map(x => x.amount);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const W = 320, H = 130, padX = 16, top = 14, bottom = H - 24;
  const pts = items.map((x, i) => {
    const px = padX + i / (items.length - 1) * (W - padX * 2);
    const py = bottom - (x.amount - min) / range * (bottom - top);
    return [px, py];
  });
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const dots = pts.map((p, i) => i === pts.length - 1 || i === 0
    ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#534AB7"/>
       <text x="${p[0].toFixed(1)}" y="${(p[1] - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#444441" font-weight="600">${fmt(items[i].amount, state.statsCur)}</text>`
    : `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="#534AB7"/>`).join('');
  const labels = items.map((x, i) => i % 3 === 0 || i === items.length - 1
    ? `<text x="${pts[i][0].toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#888780">${x.ym.slice(2)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}"><path d="${path}" fill="none" stroke="#534AB7" stroke-width="2"/>${dots}${labels}</svg>`;
}

/* ============ 记一笔 ============ */
function recordView() {
  const t = state.recordType;
  const isEsp = t === 'expense' || t === 'income';
  const kind = t === 'income' ? 'income' : 'expense';
  const tops = isEsp ? Store.topCategories(kind) : [];
  const accs = Store.accounts();
  const accOpts = sel => accs.map(a => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const curOpts = sel => BUILTIN_CURRENCY.map(c => `<option ${sel === c ? 'selected' : ''}>${c}</option>`).join('');

  let catHtml = '';
  if (isEsp) {
    catHtml = `<div class="cat-grid">${tops.map(c => `
      <div class="cat-chip ${state.recordTop === c.id ? 'active' : ''}" data-top="${c.id}">
        <span class="ic">${c.icon || '📁'}</span>${esc(c.name)}</div>`).join('')}</div>`;
    const subs = state.recordTop ? Store.subCategories(state.recordTop) : [];
    if (subs.length) {
      catHtml += `<div class="sub-row">${subs.map(c => `
        <span class="sub-chip ${state.recordSub === c.id ? 'active' : ''}" data-sub="${c.id}">${esc(c.name)}</span>`).join('')}</div>`;
    }
  }

  let accHtml = '';
  if (t === 'transfer') {
    accHtml = `<div class="field-row">
      <div><div class="card" style="padding:8px 10px;margin:0"><h3>从</h3><select id="acc-from">${accOpts(accs[0] && accs[0].id)}</select></div></div>
      <div><div class="card" style="padding:8px 10px;margin:0"><h3>到</h3><select id="acc-to">${accOpts(accs[1] && accs[1].id)}</select></div></div>
    </div>`;
  } else {
    accHtml = `<div class="field-row">
      <select id="acc-one">${accOpts(accs[0] && accs[0].id)}</select>
      <select id="currency">${curOpts(t === 'adjust' ? 'CNY' : 'CNY')}</select>
    </div>`;
  }

  const saveLabel = state.editingId ? '保存修改' : { expense: '记一笔支出', income: '记一笔收入', transfer: '记转账', adjust: '记余额调整' }[t];
  const form = state._form || {};

  return `
  <div class="card">
    <div class="type-seg">${['expense', 'income', 'transfer', 'adjust'].map(x =>
      `<button data-type="${x}" class="${t === x ? 'active' : ''}">${TYPE_LABEL[x]}</button>`).join('')}</div>
    <div class="amount-row"><span class="cur-sym">${curSym(accs[0] ? accs[0].currency : 'CNY')}</span>
      <input id="amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${esc(form.amount || '')}"></div>
    ${catHtml}
    ${accHtml}
    ${t === 'adjust' ? `<div class="note-input"><input id="note" type="text" placeholder="为什么调整？（对账差异、漏记补正…）" value="${esc(form.note || '')}"></div>`
      : `<input class="note-input" id="note" type="text" placeholder="备注（可选）" value="${esc(form.note || '')}">`}
    <input id="date" type="date" value="${esc(form.date || todayStr())}" style="margin-bottom:12px">
    <button class="btn-primary" id="save-btn">${saveLabel}</button>
    ${state.editingId ? '<div class="btn-row"><button class="btn-danger" id="del-btn">删除这条</button><button class="btn-ghost" id="cancel-btn">取消编辑</button></div>' : ''}
  </div>
  <div class="card"><h3>说明</h3><div style="font-size:12px;color:var(--text-3);line-height:1.7">
    · 转账不算收支：钱在账户间挪动（含买理财），总资产不变<br>
    · 余额调整不算收支：对账时发现差异用它对齐，报表保持干净<br>
    · 币种只是标签，不做折算；统计只在同币种内进行</div></div>`;
}

function bindRecordView() {
  const view = document.getElementById('view');
  view.querySelectorAll('.type-seg button').forEach(b => b.onclick = () => {
    state.recordType = b.dataset.type;
    state.recordTop = null; state.recordSub = null;
    if (state.editingId) cancelEdit();
    render();
  });
  view.querySelectorAll('.cat-chip').forEach(el => el.onclick = () => {
    if (state.recordTop === el.dataset.top) { state.recordTop = null; state.recordSub = null; }
    else { state.recordTop = el.dataset.top; state.recordSub = null; }
    render();
  });
  view.querySelectorAll('.sub-chip').forEach(el => el.onclick = () => {
    state.recordSub = state.recordSub === el.dataset.sub ? null : el.dataset.sub;
    render();
  });
  const saveBtn = view.querySelector('#save-btn');
  if (saveBtn) saveBtn.onclick = saveRecord;
  const delBtn = view.querySelector('#del-btn');
  if (delBtn) delBtn.onclick = () => {
    confirmModal('确定删除这条记录？', () => { Store.deleteTx(state.editingId); cancelEdit(); toast('已删除'); render(); });
  };
  const cancelBtn = view.querySelector('#cancel-btn');
  if (cancelBtn) cancelBtn.onclick = cancelEdit;
}

function cancelEdit() { state.editingId = null; state._form = null; state._keepForm = false; render(); }

function saveRecord() {
  const amtEl = document.getElementById('amount');
  const amount = parseFloat(amtEl.value);
  if (!amount || isNaN(amount)) { toast('先填金额'); return; }
  const t = state.recordType;
  const tx = {
    type: t, amount: Math.abs(amount),
    currency: (document.getElementById('currency') || {}).value || 'CNY',
    date: document.getElementById('date').value || todayStr(),
    note: document.getElementById('note').value.trim(),
  };
  if (t === 'transfer') {
    tx.account_id = document.getElementById('acc-from').value;
    tx.to_account_id = document.getElementById('acc-to').value;
    if (tx.account_id === tx.to_account_id) { toast('转出和转入不能是同一个账户'); return; }
  } else {
    tx.account_id = document.getElementById('acc-one').value;
  }
  if (t === 'expense' || t === 'income') tx.category_id = state.recordSub || state.recordTop;
  if (t === 'adjust' && amount > 0) tx.amount = amount; // 调整支持负数
  if (t === 'adjust') tx.amount = amount;

  if (state.editingId) {
    Store.updateTx(state.editingId, tx);
    toast('已保存');
    cancelEdit();
  } else {
    Store.addTx(tx);
    toast(t === 'expense' ? '记好了，支出 ' + fmt(tx.amount, tx.currency) : '记好了');
    state._form = null;
    state.recordSub = null;
  }
  render();
}

function loadTxToForm(id) {
  const tx = Store.getTxById(id); if (!tx) return;
  state.editingId = id;
  state.tab = 'record';
  state.recordType = tx.type;
  state.recordTop = null; state.recordSub = null;
  state._form = { amount: tx.amount, note: tx.note || '', date: tx.date };
  render();
  const setv = (id2, v) => { const el = document.getElementById(id2); if (el && v != null) el.value = v; };
  setv('amount', tx.amount);
  setv('note', tx.note);
  setv('date', tx.date);
  if (tx.type === 'transfer') { setv('acc-from', tx.account_id); setv('acc-to', tx.to_account_id); }
  else { setv('acc-one', tx.account_id); setv('currency', tx.currency); }
  if (tx.category_id) {
    const c = Store.category(tx.category_id);
    if (c) {
      if (c.parent_id) { state.recordTop = c.parent_id; state.recordSub = c.id; }
      else state.recordTop = c.id;
      render();
      setv('amount', tx.amount); setv('note', tx.note); setv('date', tx.date);
      if (tx.type !== 'transfer') { setv('acc-one', tx.account_id); setv('currency', tx.currency); }
    }
  }
}

/* ============ 流水 ============ */
function listView() {
  if (!state.listYm) state.listYm = todayStr().slice(0, 7);
  const txs = Store.monthTx(state.listYm);
  const curAcc = Store.accounts().find(a => a.id === state.listAcc);
  const filtered = txs.filter(t =>
    (state.listType === 'all' || t.type === state.listType) &&
    (!state.listAcc || t.account_id === state.listAcc || t.to_account_id === state.listAcc));
  filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created_at - a.created_at));

  const groups = {};
  for (const t of filtered) (groups[t.date] = groups[t.date] || []).push(t);

  const txRow = t => {
    const acc = Store.account(t.account_id);
    const toAcc = Store.account(t.to_account_id);
    let icon = '📄', title = '', cls = '', sign = '';
    if (t.type === 'expense') {
      const c = Store.category(t.category_id);
      const sub = c && c.parent_id ? c : null;
      const top = sub ? Store.category(c.parent_id) : c;
      icon = (top && top.icon) || '📁';
      title = sub ? `${top.name}·${sub.name}` : (c ? c.name : '未分类支出');
      cls = 'expense'; sign = '-';
    } else if (t.type === 'income') {
      const c = Store.category(t.category_id);
      icon = (c && c.icon) || '💰';
      title = c ? c.name : '未分类收入';
      cls = 'income'; sign = '+';
    } else if (t.type === 'transfer') {
      icon = '🔁'; title = `${acc ? acc.name : '?'} → ${toAcc ? toAcc.name : '?'}`;
      cls = 'adjust';
    } else { icon = '🧮'; title = '余额调整'; cls = 'adjust'; }
    const noteAcc = t.type !== 'transfer' ? acc ? acc.name : '' : '';
    return `<div class="tx-item" data-id="${t.id}">
      <div class="tx-ic">${icon}</div>
      <div class="tx-main"><div class="tx-title">${esc(title)}</div>
        <div class="tx-note">${esc(noteAcc)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
      <div class="tx-amt ${cls}">${sign}${fmt(t.amount, t.currency)}</div></div>`;
  };

  const listHtml = filtered.length
    ? Object.keys(groups).sort().reverse().map(d =>
      `<div class="day-head">${dayLabel(d)}</div>${groups[d].map(txRow).join('')}`).join('')
    : '<div class="empty-tip">这个月还没有记录</div>';

  return `
  <div class="month-nav">
    <button id="prev-m">‹</button><b>${state.listYm}</b><button id="next-m">›</button>
  </div>
  <div class="filter-row">
    ${['all', 'expense', 'income', 'transfer', 'adjust'].map(x =>
      `<span class="filter-chip ${state.listType === x ? 'active' : ''}" data-ft="${x}">${x === 'all' ? '全部' : TYPE_LABEL[x]}</span>`).join('')}
    <select class="filter-select" id="filter-acc">
      <option value="">全部账户</option>
      ${Store.accounts().map(a => `<option value="${a.id}" ${state.listAcc === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
    </select>
  </div>
  ${listHtml}`;
}

function bindListView() {
  const view = document.getElementById('view');
  const shift = n => {
    const [y, m] = state.listYm.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    state.listYm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    render();
  };
  view.querySelector('#prev-m').onclick = () => shift(-1);
  view.querySelector('#next-m').onclick = () => shift(1);
  view.querySelectorAll('[data-ft]').forEach(el => el.onclick = () => { state.listType = el.dataset.ft; render(); });
  view.querySelector('#filter-acc').onchange = e => { state.listAcc = e.target.value; render(); };
  view.querySelectorAll('.tx-item').forEach(el => el.onclick = () => loadTxToForm(el.dataset.id));
}

/* ============ 统计 ============ */
function statsView() {
  if (!state.statsYm) state.statsYm = todayStr().slice(0, 7);
  const cur = state.statsCur;
  const tot = Store.monthTotals(state.statsYm, cur);
  const surplus = tot.income.total - tot.expense.total;

  // 支出构成
  const donutItems = Store.topCategories('expense').map(c => ({
    label: c.name, value: tot.expense.byTop[c.id] || 0,
    color: CAT_COLOR[c.id] || '#888780',
  })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);

  // 预算执行
  const budgetRows = Store.topCategories('expense')
    .filter(c => c.budget > 0)
    .map(c => {
      const used = tot.expense.byTop[c.id] || 0;
      const pct = Math.min(used / c.budget * 100, 999);
      return `<div class="budget-row">
        <div class="budget-line"><span>${c.icon} ${c.name}</span><span>${fmt(used, cur)} / ${fmt(c.budget, cur)}（${pct.toFixed(0)}%）</span></div>
        <div class="budget-bar"><div class="budget-fill ${pct > 100 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></div></div>
      </div>`;
    }).join('');

  const surplus12 = Store.surplusSeries(12, cur);
  const nw12 = Store.netWorthSeries(12, cur);

  return `
  <div class="month-nav">
    <button id="s-prev">‹</button><b>${state.statsYm}</b><button id="s-next">›</button>
  </div>
  <div class="filter-row" style="justify-content:flex-end">
    <select class="filter-select" id="stats-cur">${BUILTIN_CURRENCY.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>
  </div>
  <div class="stat-cards">
    <div class="stat-card"><div class="lab">收入</div><div class="val income">${fmt(tot.income.total, cur)}</div></div>
    <div class="stat-card"><div class="lab">支出</div><div class="val expense">${fmt(tot.expense.total, cur)}</div></div>
    <div class="stat-card"><div class="lab">结余</div><div class="val ${surplus >= 0 ? 'income' : 'expense'}">${fmt(surplus, cur)}</div></div>
  </div>
  ${budgetRows ? `<div class="card"><h3>预算执行 <button class="mini-btn" id="edit-budget" style="float:right">编辑预算</button></h3>${budgetRows}</div>`
    : `<div class="card"><h3>预算执行</h3><div class="empty-tip" style="padding:14px 0">还没设预算 <button class="mini-btn" id="edit-budget">去设置</button></div></div>`}
  <div class="card"><h3>支出构成（按大桶）</h3>
    <div class="chart-wrap">${donutSVG(donutItems)}</div>
    ${donutItems.length ? `<div class="legend">${donutItems.map(x => `
      <div class="legend-item"><span class="legend-dot" style="background:${x.color}"></span>${esc(x.label)}
        <span class="lv">${fmt(x.value, cur)}</span></div>`).join('')}</div>` : ''}
  </div>
  <div class="card"><h3>近 12 个月结余（${cur}）</h3><div class="chart-wrap">${barsSVG(surplus12)}</div></div>
  <div class="card"><h3>净资产曲线（${cur}，月末）</h3><div class="chart-wrap">${lineSVG(nw12)}</div></div>`;
}

function bindStatsView() {
  const view = document.getElementById('view');
  const shift = n => {
    const [y, m] = state.statsYm.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    state.statsYm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    render();
  };
  view.querySelector('#s-prev').onclick = () => shift(-1);
  view.querySelector('#s-next').onclick = () => shift(1);
  view.querySelector('#stats-cur').onchange = e => { state.statsCur = e.target.value; render(); };
  const eb = view.querySelector('#edit-budget');
  if (eb) eb.onclick = budgetModal;
}

/* ============ 设置 ============ */
function settingsView() {
  const accs = Store.accounts().map(a => {
    const bal = Store.balances()[a.id] || 0;
    return `<div class="set-item">
      <div class="tx-ic">${a.icon}</div>
      <div class="grow"><div class="name">${esc(a.name)}</div><div class="meta">${a.currency}${bal ? ' · 余额 ' + fmt(bal, a.currency) : ''}</div></div>
      <button class="mini-btn" data-edit-acc="${a.id}">编辑</button>
      <button class="mini-btn" data-del-acc="${a.id}">删除</button>
    </div>`;
  }).join('');

  const catTree = Store.topCategories('expense').map(top => {
    const subs = Store.subCategories(top.id);
    const budget = top.budget ? ` · 预算 ${fmt(top.budget, 'CNY')}` : '';
    return `<div class="set-item"><div class="tx-ic">${top.icon}</div>
      <div class="grow"><div class="name">${esc(top.name)}${budget}</div>
        <div class="meta">${subs.map(s => esc(s.name)).join(' · ') || '（无二级）'}</div></div>
      <button class="mini-btn" data-add-sub="${top.id}">加二级</button>
    </div>`;
  }).join('');

  return `
  <div class="card"><h3>账户</h3>${accs}
    <div class="btn-row"><button class="btn-ghost" id="add-acc">＋ 新建账户</button></div>
  </div>
  <div class="card"><h3>支出分类（一级固定，二级可增删）</h3>${catTree}</div>
  <div class="card"><h3>备份</h3>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">导出为 JSON 文件保存好；换手机或重装后导入即可完整恢复。</div>
    <div class="btn-row">
      <button class="btn-ghost" id="export-btn">导出备份</button>
      <button class="btn-ghost" id="import-btn">导入备份</button>
    </div>
    <input type="file" id="import-file" accept=".json" hidden>
    ${Store.hasV1Key() ? `<div style="font-size:12px;color:var(--text-3);margin-top:10px">
      检测到 v1 旧数据（moekan-data-v1）。已在首次打开时自动迁移；确认 v2 一切正常后可清除原数据。
      <button class="mini-btn" id="clear-v1" style="margin-left:4px">清除 v1 数据</button></div>` : ''}
  </div>
  <div class="card"><h3>关于</h3>
    <div style="font-size:12px;color:var(--text-3);line-height:1.7">
      萌账 v2 · 核心版 —— 记一笔 / 流水 / 统计 / 备份。<br>
      无框架 · 无构建 · 零外部依赖，数据只存在本机浏览器。<br>
      v1 老版本仍可访问：<a href="v1/index.html">v1/index.html</a></div></div>`;
}

function bindSettingsView() {
  const view = document.getElementById('view');
  view.querySelector('#add-acc').onclick = () => accountModal(null);
  view.querySelectorAll('[data-edit-acc]').forEach(b => b.onclick = () => accountModal(b.dataset.editAcc));
  view.querySelectorAll('[data-del-acc]').forEach(b => b.onclick = () => {
    confirmModal('删除账户？（有交易记录的账户无法删除）', () => {
      const ok = Store.deleteAccount(b.dataset.delAcc);
      toast(ok ? '已删除' : '该账户有交易记录，不能删除');
      render();
    });
  });
  view.querySelectorAll('[data-add-sub]').forEach(b => b.onclick = () => {
    promptModal('新二级分类（属于哪个大桶见上一行）', name => {
      if (name) { Store.addSubCategory(b.dataset.addSub, name.trim()); toast('已添加'); render(); }
    });
  });
  view.querySelector('#export-btn').onclick = () => {
    const blob = new Blob([Store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'moe-ledger-backup-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  view.querySelector('#import-btn').onclick = () => view.querySelector('#import-file').click();
  view.querySelector('#import-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = Store.importJSON(reader.result);
        toast(`导入成功：${r.txs} 条交易，${r.accounts} 个账户`);
        render();
      } catch (err) { toast('导入失败：' + err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };
  const cv = view.querySelector('#clear-v1');
  if (cv) cv.onclick = () => confirmModal('确定清除 v1 原始数据？此操作不可恢复（建议先导出 v2 备份）。', () => {
    Store.clearV1Key(); toast('已清除'); render();
  });
}

/* ============ 弹层 ============ */
function openModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').hidden = false;
}
function closeModal() { document.getElementById('modal').hidden = true; }
function confirmModal(text, onOk) {
  openModal(`<h3>确认</h3><p style="font-size:14px;margin-bottom:14px">${esc(text)}</p>
    <div class="btn-row"><button class="btn-ghost" id="m-cancel">取消</button><button class="btn-primary" id="m-ok" style="padding:9px">确定</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-ok').onclick = () => { closeModal(); onOk(); };
}
function promptModal(title, onOk) {
  openModal(`<h3>${esc(title)}</h3><input type="text" id="m-input" style="margin-bottom:12px">
    <div class="btn-row"><button class="btn-ghost" id="m-cancel">取消</button><button class="btn-primary" id="m-ok" style="padding:9px">确定</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-ok').onclick = () => { const v = document.getElementById('m-input').value; closeModal(); onOk(v); };
  document.getElementById('m-input').focus();
}
function accountModal(id) {
  const a = id ? Store.account(id) : null;
  openModal(`<h3>${a ? '编辑账户' : '新建账户'}</h3>
    <div style="margin-bottom:10px"><input type="text" id="m-name" placeholder="名称" value="${a ? esc(a.name) : ''}"></div>
    <div style="margin-bottom:12px"><select id="m-cur">${BUILTIN_CURRENCY.map(c => `<option ${a && a.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="btn-row"><button class="btn-ghost" id="m-cancel">取消</button><button class="btn-primary" id="m-ok" style="padding:9px">保存</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-ok').onclick = () => {
    const name = document.getElementById('m-name').value.trim();
    if (!name) { toast('名称不能为空'); return; }
    const cur = document.getElementById('m-cur').value;
    if (a) Store.updateAccount(a.id, { name, currency: cur });
    else Store.addAccount(name, cur);
    closeModal(); toast('已保存'); render();
  };
}
function budgetModal() {
  const tops = Store.topCategories('expense');
  openModal(`<h3>月度预算（按大桶，单位 CNY）</h3>
    ${tops.map(c => `<div class="set-item"><div class="tx-ic">${c.icon}</div>
      <div class="grow"><div class="name">${esc(c.name)}</div></div>
      <input type="number" min="0" step="50" style="max-width:100px" data-budget="${c.id}" value="${c.budget || ''}" placeholder="不限"></div>`).join('')}
    <div class="btn-row"><button class="btn-ghost" id="m-cancel">取消</button><button class="btn-primary" id="m-ok" style="padding:9px">保存</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-ok').onclick = () => {
    document.querySelectorAll('[data-budget]').forEach(el => Store.setBudget(el.dataset.budget, el.value));
    closeModal(); toast('预算已保存'); render();
  };
}

/* ============ 主框架 ============ */
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function render() {
  /* 重渲染（选分类等触发的）前暂存正在输入的表单值，渲染后由 recordView 回填 */
  if (state.tab === 'record') {
    const amtEl0 = document.getElementById('amount');
    if (amtEl0) {
      state._form = {
        amount: amtEl0.value,
        note: (document.getElementById('note') || {}).value || '',
        date: (document.getElementById('date') || {}).value || todayStr(),
      };
    } else if (!state._keepForm) {
      state._form = null;
    }
  }
  const view = document.getElementById('view');
  if (state.tab === 'record') { view.innerHTML = recordView(); bindRecordView(); }
  else if (state.tab === 'list') { view.innerHTML = listView(); bindListView(); }
  else if (state.tab === 'stats') { view.innerHTML = statsView(); bindStatsView(); }
  else { view.innerHTML = settingsView(); bindSettingsView(); }
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  window.scrollTo(0, 0);
}

document.getElementById('tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) { state.tab = btn.dataset.tab; render(); }
});
document.getElementById('modal').addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
});

Store.init();
if (Store.migrated) setTimeout(() => toast(`已从 v1 迁移 ${Store.migrated.txs} 条记录`), 600);
render();
