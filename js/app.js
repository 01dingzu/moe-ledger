/* ═══════════ app.js — 启动与事件绑定 ═══════════ */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const App = window.App = {
    currentType: 'expense',
    editingAccountId: null,

    async init() {
      Store.load();
      Views.renderMonth();

      // 汇率：启动时若从未加载过则静默拉取
      if (!Store.data.fx.rates.length) {
        try {
          await Fx.fetchRates(Store.getSettings().fxUrl);
        } catch (e) {
          console.warn('汇率拉取失败', e);
        }
      }

      this.bindTabs();
      this.bindMonthNav();
      this.bindQuickAdd();
      this.bindFlow();
      this.bindAccounts();
      this.bindSettings();

      Views.renderQuickAdd();
      this.renderAll();
      this.registerSW();
    },

    renderAll() {
      Views.renderMonth();
      Views.renderHome();
      Views.renderFlow();
      Views.renderAccounts();
      Views.renderStats();
      Views.renderSettings();
    },

    switchView(view) {
      Views.state.view = view;
      $$('.view').forEach(v => v.hidden = v.dataset.view !== view);
      $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
      window.scrollTo({ top: 0 });
      // 切视图时刷新对应数据
      if (view === 'flow') Views.renderFlow();
      if (view === 'accounts') Views.renderAccounts();
      if (view === 'stats') Views.renderStats();
      if (view === 'settings') Views.renderSettings();
    },

    /* ── Tab 导航 ── */
    bindTabs() {
      $$('#tab-bar .tab').forEach(t => {
        t.addEventListener('click', () => this.switchView(t.dataset.view));
      });
    },

    /* ── 月份导航 ── */
    bindMonthNav() {
      const shift = (n) => {
        const [y, m] = Views.state.month.split('-').map(Number);
        const d = new Date(y, m - 1 + n, 1);
        Views.state.month = d.toISOString().slice(0, 7);
        Views.renderMonth();
        Views.renderHome();
        Views.renderFlow();
        Views.renderStats();
      };
      $('#prev-month').addEventListener('click', () => shift(-1));
      $('#next-month').addEventListener('click', () => shift(1));
    },

    /* ── 快捷记账 ── */
    bindQuickAdd() {
      const form = $('#quick-add');

      // 类型切换
      $$('#type-tabs .type-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this.currentType = tab.dataset.type;
          $$('#type-tabs .type-tab').forEach(t => t.classList.toggle('active', t === tab));
          const isTransfer = this.currentType === 'transfer';
          $('#tx-to-account').style.display = isTransfer ? '' : 'none';
          // 转账时隐藏分类
          $('#category-chips').style.display = isTransfer ? 'none' : '';
          // 转账时 label 提示
          $('#tx-to-account').title = isTransfer ? '转入账户' : '';
          Views.renderCategoryChips();
          Views.updateCnyHint();
        });
      });

      $('#tx-currency').addEventListener('change', () => Views.updateCnyHint());
      $('#tx-amount').addEventListener('input', () => Views.updateCnyHint());
      $('#tx-date').addEventListener('change', () => Views.updateCnyHint());

      // 分类点选
      $('#category-chips').addEventListener('click', (e) => {
        const chip = e.target.closest('.cat-chip');
        if (!chip) return;
        const wasActive = chip.classList.contains('active');
        $$('#category-chips .cat-chip').forEach(c => c.classList.remove('active'));
        if (!wasActive) chip.classList.add('active');
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveTransaction();
      });
    },

    saveTransaction() {
      const amount = parseFloat($('#tx-amount').value);
      const currency = $('#tx-currency').value;
      const toAccSel = $('#tx-to-account');
      const toAccount = toAccSel.style.display !== 'none' ? toAccSel.value : null;

      const tx = {
        date: $('#tx-date').value || Engine.today(),
        type: this.currentType,
        amount,
        currency,
        account_id: $('#tx-account').value || null,
        to_account_id: toAccount || null,
        category_id: null,
        note: $('#tx-note').value.trim(),
      };

      // 分类
      if (this.currentType !== 'transfer') {
        const active = $('#category-chips .cat-chip.active');
        tx.category_id = active ? active.dataset.cat : null;
      } else {
        // 换汇判断：目标账户主币种 ≠ 交易币种 → 换汇
        const toAcc = Store.getAccount(toAccount);
        if (toAcc && toAcc.currency !== currency) {
          const rate = Fx.getRate(toAcc.currency, tx.date);
          const outRate = Fx.getRate(currency, tx.date);
          if (rate && outRate) {
            tx.to_currency = toAcc.currency;
            tx.to_amount = Math.round(amount * outRate / rate * 100) / 100;
          }
        }
      }

      const errors = Engine.validate(tx);
      if (errors.length) { Views.toast(errors[0]); return; }

      // 折算人民币（外币）
      tx.cny_amount = Fx.toCNY(tx.amount, tx.currency, tx.date);

      Store.addTransaction(tx);
      $('#tx-amount').value = '';
      $('#tx-note').value = '';
      Views.updateCnyHint();

      const msg = tx.type === 'expense' ? '已记支出' : tx.type === 'income' ? '已记收入' : '已记转账';
      Views.toast(`${msg} ${Engine.fmtCur(tx.amount, tx.currency)}`);

      // 回到记账当月视图刷新
      Views.state.month = tx.date.slice(0, 7);
      Views.renderMonth();
      Views.renderHome();
      Views.renderFlow();
      Views.renderAccounts();
      Views.renderStats();
    },

    /* ── 流水视图 ── */
    bindFlow() {
      const refresh = () => Views.renderFlow();
      ['#filter-account', '#filter-category', '#filter-type'].forEach(sel => {
        $(sel).addEventListener('change', refresh);
      });
      // 删除交易（事件委托）
      $('#flow-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-del]');
        if (!btn) return;
        const id = btn.dataset.del;
        if (!confirm('删除这笔交易？')) return;
        Store.deleteTransaction(id);
        this.renderAll();
        Views.toast('已删除');
      });
      // 填充筛选器
      const fillFilters = () => {
        const accOpts = '<option value="">全部账户</option>' +
          Store.getAccounts().map(a => `<option value="${a.id}">${esc2(a.name)}</option>`).join('');
        const catOpts = '<option value="">全部分类</option>' +
          Store.getCategories('expense').concat(Store.getCategories('income'))
            .map(c => `<option value="${c.id}">${esc2(c.icon + ' ' + c.name)}</option>`).join('');
        const accSel = $('#filter-account'), catSel = $('#filter-category');
        const accV = accSel.value, catV = catSel.value;
        accSel.innerHTML = accOpts; catSel.innerHTML = catOpts;
        accSel.value = accV; catSel.value = catV;
      };
      this._fillFilters = fillFilters;
      fillFilters();
    },

    /* ── 账户视图 ── */
    bindAccounts() {
      $('#btn-add-account').addEventListener('click', () => this.openAccountModal(null));

      $('#account-list').addEventListener('click', (e) => {
        const item = e.target.closest('[data-acc]');
        if (item) this.openAccountModal(item.dataset.acc);
      });

      $('#acc-cancel').addEventListener('click', () => { $('#account-modal').hidden = true; });
      $('#acc-save').addEventListener('click', () => this.saveAccount());
      $('#acc-delete').addEventListener('click', () => {
        if (!this.editingAccountId) return;
        if (!confirm('删除该账户？')) return;
        const r = Store.deleteAccount(this.editingAccountId);
        if (!r.ok) { Views.toast(r.msg); return; }
        $('#account-modal').hidden = true;
        this.renderAll();
        Views.renderQuickAdd();
        this._fillFilters();
        Views.toast('账户已删除');
      });
    },

    openAccountModal(id) {
      this.editingAccountId = id;
      const acc = id ? Store.getAccount(id) : null;
      $('#account-modal-title').textContent = acc ? '编辑账户' : '添加账户';
      $('#acc-name').value = acc ? acc.name : '';
      $('#acc-type').value = acc ? acc.type : 'asset';
      $('#acc-currency').innerHTML = Store.CURRENCIES.map(c =>
        `<option value="${c.code}">${c.code} ${c.name}</option>`).join('');
      $('#acc-currency').value = acc ? acc.currency : 'CNY';
      $('#acc-init-balance').value = acc ? (acc.init_balance || 0) : '';
      $('#acc-delete').hidden = !acc;
      $('#account-modal').hidden = false;
    },

    saveAccount() {
      const name = $('#acc-name').value.trim();
      if (!name) { Views.toast('请输入账户名称'); return; }
      const payload = {
        name,
        type: $('#acc-type').value,
        currency: $('#acc-currency').value,
        init_balance: parseFloat($('#acc-init-balance').value) || 0,
      };
      if (this.editingAccountId) {
        Store.updateAccount(this.editingAccountId, payload);
        Views.toast('账户已更新');
      } else {
        Store.addAccount(payload);
        Views.toast('账户已添加');
      }
      $('#account-modal').hidden = true;
      this.renderAll();
      Views.renderQuickAdd();
      this._fillFilters();
    },

    /* ── 设置 ── */
    bindSettings() {
      $('#btn-fetch-fx').addEventListener('click', async () => {
        const url = $('#fx-url').value.trim();
        Views.toast('正在拉取汇率…');
        try {
          const n = await Fx.fetchRates(url);
          Store.setSettings({ fxUrl: url });
          // 重新折算所有外币交易的 cny_amount
          this.recalcCNY();
          Views.renderSettings();
          Views.renderHome();
          Views.renderFlow();
          Views.toast(`汇率已更新（${n} 天）`);
        } catch (e) {
          Views.toast('拉取失败：' + e.message);
        }
      });

      $('#btn-add-cat').addEventListener('click', () => {
        const name = $('#new-cat-name').value.trim();
        const type = $('#new-cat-type').value;
        if (!name) { Views.toast('请输入分类名'); return; }
        const c = Store.addCategory(name, type);
        if (!c) { Views.toast('分类已存在'); return; }
        $('#new-cat-name').value = '';
        Views.renderSettings();
        Views.renderQuickAdd();
        this._fillFilters();
        Views.toast('分类已添加');
      });

      $('#cat-manage').addEventListener('click', (e) => {
        const del = e.target.closest('[data-delcat]');
        if (!del) return;
        const r = Store.deleteCategory(del.dataset.delcat);
        if (!r.ok) { Views.toast(r.msg); return; }
        Views.renderSettings();
        Views.renderQuickAdd();
        this._fillFilters();
        Views.toast('分类已删除');
      });

      $('#btn-export').addEventListener('click', () => {
        const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `moekan-backup-${Engine.today()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        Views.toast('备份已导出');
      });

      $('#btn-import').addEventListener('click', () => $('#import-file').click());
      $('#import-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const r = Store.importJSON(reader.result);
          if (r.ok) {
            this.renderAll();
            Views.renderQuickAdd();
            this._fillFilters();
            Views.toast('备份已导入');
          } else {
            Views.toast(r.msg);
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });
    },

    // 汇率更新后重算所有交易的人民币折算值
    recalcCNY() {
      for (const t of Store.getTransactions()) {
        t.cny_amount = Fx.toCNY(t.amount, t.currency, t.date);
      }
      Store.save();
    },

    registerSW() {
      if ('serviceWorker' in navigator && location.protocol === 'https:') {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    },
  };

  function esc2(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', () => App.init());
})();
