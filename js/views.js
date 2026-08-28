/* ═══════════ views.js — 各视图渲染 ═══════════ */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  window.Views = {
    state: { view: 'home', month: Engine.currentYM() },

    /* ── 首页汇总 ── */
    renderHome() {
      const s = Engine.monthStats(this.state.month);
      $('#sum-expense').textContent = Engine.fmtCNY(s.expense);
      $('#sum-income').textContent = Engine.fmtCNY(s.income);
      const net = s.net;
      $('#sum-net').textContent = (net >= 0 ? '+' : '') + Engine.fmtCNY(net);
      $('#sum-net').style.color = net >= 0 ? 'var(--green)' : 'var(--accent)';
      this.renderRecent();
    },

    /* ── 最近记录（首页，最近 10 条） ── */
    renderRecent() {
      const list = $('#recent-list');
      const txs = Store.getTransactions().slice(0, 10);
      list.innerHTML = this.renderTxGroups(txs, false);
    },

    /* ── 流水视图 ── */
    renderFlow() {
      const ym = this.state.month;
      let txs = Store.getTransactions().filter(t => t.date.startsWith(ym));

      const fAcc = $('#filter-account').value;
      const fCat = $('#filter-category').value;
      const fType = $('#filter-type').value;
      if (fAcc) txs = txs.filter(t => t.account_id === fAcc || t.to_account_id === fAcc);
      if (fCat) txs = txs.filter(t => t.category_id === fCat);
      if (fType) txs = txs.filter(t => t.type === fType);

      // 统计
      let exp = 0, inc = 0, missing = 0;
      txs.forEach(t => {
        const cny = t.cny_amount != null ? t.cny_amount : Fx.toCNY(t.amount, t.currency, t.date);
        if (cny == null) { missing++; return; }
        if (t.type === 'expense') exp += cny;
        if (t.type === 'income') inc += cny;
      });
      let totalHtml = `本月支出 ${Engine.fmtCNY(exp)} ｜ 收入 ${Engine.fmtCNY(inc)}`;
      if (missing) totalHtml += ` ｜ ⚠ ${missing} 笔缺汇率未计入`;
      $('#flow-total').innerHTML = totalHtml;
      $('#flow-list').innerHTML = this.renderTxGroups(txs, true);
    },

    /* 交易列表 → 按日分组渲染 */
    renderTxGroups(txs, withDelete) {
      if (!txs.length) return '<div class="empty-tip">暂无记录 · 记下第一笔吧</div>';
      const groups = {};
      txs.forEach(t => { (groups[t.date] = groups[t.date] || []).push(t); });
      const dates = Object.keys(groups).sort().reverse();
      let html = '';
      for (const d of dates) {
        const dayExp = groups[d]
          .filter(t => t.type === 'expense')
          .reduce((s, t) => s + (t.cny_amount != null ? t.cny_amount : (Fx.toCNY(t.amount, t.currency, t.date) || 0)), 0);
        html += `<div class="flow-day-group">
          <div class="day-header"><span>${this.dayLabel(d)}</span>
          <span class="day-total">支 ${Engine.fmtCNY(dayExp)}</span></div>`;
        for (const t of groups[d]) html += this.renderTxItem(t, withDelete);
        html += '</div>';
      }
      return html;
    },

    renderTxItem(t, withDelete) {
      const cat = t.category_id ? Store.getCategory(t.category_id) : null;
      const acc = Store.getAccount(t.account_id);
      const toAcc = Store.getAccount(t.to_account_id);
      const icon = t.type === 'transfer' ? '🔁' : (cat ? cat.icon : '❔');
      let title, sub;
      if (t.type === 'transfer') {
        title = `${acc ? esc(acc.name) : '?'} → ${toAcc ? esc(toAcc.name) : '?'}`;
        const exchanged = t.to_amount != null && (t.to_amount !== t.amount || t.to_currency !== t.currency);
        sub = exchanged ? `换汇 · ${Engine.fmtCur(t.to_amount, t.to_currency || t.currency)}` : '转账';
      } else {
        title = cat ? cat.name : '未分类';
        sub = `${acc ? esc(acc.name) : ''}${t.note ? ' · ' + esc(t.note) : ''}`;
      }
      const amtCls = t.type;
      const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '-' : '';
      let amtHtml = `<div class="amt ${amtCls}">${sign}${Engine.fmtCur(t.amount, t.currency)}</div>`;
      if (t.currency !== 'CNY') {
        const cny = t.cny_amount != null ? t.cny_amount : Fx.toCNY(t.amount, t.currency, t.date);
        amtHtml += `<div class="sub">${cny == null ? '缺汇率' : '≈¥' + Engine.fmt(cny)}</div>`;
      }
      const del = withDelete ? `<button class="fi-del" data-del="${t.id}" title="删除">✕</button>` : '';
      return `<div class="flow-item">
        <div class="fi-icon ${t.type}">${icon}</div>
        <div class="fi-main"><div class="fi-title">${title}</div><div class="fi-sub">${sub}</div></div>
        <div class="fi-amount">${amtHtml}</div>${del}
      </div>`;
    },

    dayLabel(d) {
      const today = Engine.today();
      const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      if (d === today) return '今天';
      if (d === yest) return '昨天';
      const [y, m, day] = d.split('-');
      const wk = ['日', '一', '二', '三', '四', '五', '六'][new Date(d).getDay()];
      return `${Number(m)}月${Number(day)}日 · 周${wk}`;
    },

    /* ── 账户视图 ── */
    renderAccounts() {
      const balances = Engine.accountBalances();
      const nw = Engine.netWorth();
      $('#net-worth').textContent = Engine.fmtCNY(nw.net);
      $('#net-worth-sub').textContent =
        `资产 ${Engine.fmtCNY(nw.assets)} ｜ 负债 ${Engine.fmtCNY(nw.liabilities)}`;

      const list = $('#account-list');
      const accs = Store.getAccounts();
      if (!accs.length) {
        list.innerHTML = '<div class="empty-tip">还没有账户，点上方＋添加</div>';
        return;
      }
      let html = '';
      for (const a of accs) {
        const b = balances[a.id] || {};
        const iconMap = { asset: '💳', virtual_asset: '🧸', liability: '🏦' };
        const typeName = { asset: '资产', virtual_asset: '虚拟资产', liability: '负债' }[a.type];
        const curs = Object.keys(b).filter(c => b[c] !== 0 || c === a.currency);
        let balHtml = '', subHtml = typeName;
        if (curs.length) {
          const main = curs.map(c =>
            `<span>${Engine.fmtCur(b[c], c)}</span>`).join('<br>');
          balHtml = `<div class="amt">${main}</div>`;
          const total = Engine.accountCNYTotal(a.id, balances);
          const hasForeign = curs.some(c => c !== 'CNY');
          if (hasForeign || curs.length > 1) {
            balHtml += `<div class="cny">≈${Engine.fmtCNY(total)}</div>`;
          }
        } else {
          balHtml = '<div class="amt">—</div>';
        }
        subHtml += ' · ' + Engine.curName(a.currency);
        html += `<div class="account-item" data-acc="${a.id}">
          <div class="acc-icon ${a.type}">${iconMap[a.type]}</div>
          <div class="acc-main"><div class="acc-name">${esc(a.name)}</div><div class="acc-sub">${subHtml}</div></div>
          <div class="acc-balance">${balHtml}</div>
        </div>`;
      }
      list.innerHTML = html;
    },

    /* ── 统计视图 ── */
    renderStats() {
      const s = Engine.monthStats(this.state.month);
      $('#stats-cards').innerHTML = `
        <div class="stat-card expense"><div class="sc-label">支出</div><div class="sc-value">${Engine.fmtCNY(s.expense)}</div></div>
        <div class="stat-card income"><div class="sc-label">收入</div><div class="sc-value">${Engine.fmtCNY(s.income)}</div></div>
        <div class="stat-card net"><div class="sc-label">结余</div><div class="sc-value">${(s.net >= 0 ? '+' : '') + Engine.fmtCNY(s.net)}</div></div>
        <div class="stat-card count"><div class="sc-label">笔数</div><div class="sc-value">${s.count}</div></div>`;

      // 分类构成
      const cats = Object.entries(s.byCategory)
        .sort((x, y) => y[1] - x[1]);
      const max = cats.length ? cats[0][1] : 1;
      $('#cat-bars').innerHTML = cats.length ? cats.map(([id, val]) => {
        const c = Store.getCategory(id);
        const pct = Math.max(3, Math.round(val / max * 100));
        return `<div class="cat-bar-row">
          <div class="cat-bar-head"><span class="name">${c ? c.icon + ' ' + esc(c.name) : '未分类'}</span>
          <span class="val">${Engine.fmtCNY(val)} · ${Math.round(val / s.expense * 100)}%</span></div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('') : '<div class="empty-tip">本月暂无支出</div>';

      // 每日走势（支出）
      const days = new Date(Number(this.state.month.slice(0, 4)), Number(this.state.month.slice(5, 7)), 0).getDate();
      const maxDay = Math.max(1, ...Object.values(s.byDay));
      const todayDD = Engine.today().slice(8, 10);
      const thisMonth = this.state.month === Engine.currentYM();
      let bars = '';
      for (let d = 1; d <= days; d++) {
        const dd = String(d).padStart(2, '0');
        const v = s.byDay[dd] || 0;
        const h = Math.max(2, Math.round(v / maxDay * 100));
        const isToday = thisMonth && dd === todayDD;
        bars += `<div class="trend-day ${isToday ? 'today' : ''}">
          <div class="bar" style="height:${h}%"></div><div class="lbl">${d % 5 === 0 || d === 1 ? d : ''}</div>
        </div>`;
      }
      $('#trend-chart').innerHTML = bars;
    },

    /* ── 设置视图 ── */
    renderSettings() {
      $('#fx-url').value = Store.getSettings().fxUrl;
      $('#fx-status').textContent = Fx.statusText();
      // 分类管理
      const mk = (list, type) => list.map(c =>
        `<span class="cat-chip">${esc(c.icon)} ${esc(c.name)}<span class="del" data-delcat="${c.id}">✕</span></span>`).join('');
      $('#cat-manage').innerHTML =
        '<div style="width:100%;font-size:12px;color:var(--ink-3);margin-bottom:6px">支出分类</div>' +
        mk(Store.getCategories('expense')) +
        '<div style="width:100%;font-size:12px;color:var(--ink-3);margin:10px 0 6px">收入分类</div>' +
        mk(Store.getCategories('income'));
    },

    /* ── 快捷记账表单 ── */
    renderQuickAdd() {
      // 币种
      $('#tx-currency').innerHTML = Store.CURRENCIES.map(c =>
        `<option value="${c.code}">${c.code}</option>`).join('');
      // 账户
      const accOpts = Store.getAccounts().map(a =>
        `<option value="${a.id}">${esc(a.name)}</option>`).join('');
      $('#tx-account').innerHTML = accOpts || '<option value="">请先添加账户</option>';
      $('#tx-to-account').innerHTML = accOpts || '<option value="">请先添加账户</option>';
      if (!Engine.today()) return;
      $('#tx-date').value = Engine.today();
      this.renderCategoryChips();
      this.updateCnyHint();
    },

    renderCategoryChips() {
      const type = window.App ? App.currentType : 'expense';
      const cats = Store.getCategories(type === 'income' ? 'income' : 'expense');
      $('#category-chips').innerHTML = type === 'transfer' ? '' :
        cats.map(c => `<button type="button" class="cat-chip" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('');
      if (type !== 'transfer' && cats.length) {
        $('#category-chips .cat-chip').classList.add('active');
      }
    },

    updateCnyHint() {
      const cur = $('#tx-currency').value;
      const amt = parseFloat($('#tx-amount').value);
      if (cur === 'CNY' || !amt) { $('#cny-hint').textContent = ''; return; }
      const date = $('#tx-date').value || Engine.today();
      const cny = Fx.toCNY(amt, cur, date);
      $('#cny-hint').textContent = cny == null ? '⚠ 缺汇率，去设置更新' : '≈¥' + Engine.fmt(cny);
    },

    /* ── 月份导航 ── */
    renderMonth() {
      $('#month-label').textContent = this.state.month;
    },

    /* ── Toast ── */
    toast(msg) {
      const el = $('#toast');
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
    },
  };
})();
