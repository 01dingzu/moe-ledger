'use strict';
/* ============================================================
 * 萌账 v2 存储层
 * - 元数据（账户/分类）一个 key；交易按月分 key，写放大消除
 * - 零外部依赖：没有汇率请求、没有跨域，离线完全可用
 * - 首次运行自动迁移 v1 数据（moekan-data-v1）
 * ============================================================ */

const META_KEY = 'moeledger-v2-meta';
const TX_PREFIX = 'moeledger-v2-tx-';
const V1_KEY = 'moekan-data-v1';
const SCHEMA_VERSION = 2;

const DEFAULT_ACCOUNTS = [
  { id: 'a_wechat', name: '微信钱包', icon: '💬', currency: 'CNY' },
  { id: 'a_alipay', name: '支付宝',   icon: '🅰️', currency: 'CNY' },
  { id: 'a_cash',   name: '现金',     icon: '💴', currency: 'CNY' },
  { id: 'a_bank',   name: '银行卡',   icon: '🏦', currency: 'CNY' },
];

/* 分类体系：一级固定六个支出桶 + 五个收入类，二级可增删 */
const DEFAULT_CATEGORIES = [
  { id: 'exp-house',  name: '住房',   icon: '🏠', kind: 'expense', parent_id: null },
  { id: 'exp-food',   name: '餐饮',   icon: '🍜', kind: 'expense', parent_id: null },
  { id: 'exp-hobby',  name: '爱好',   icon: '🧸', kind: 'expense', parent_id: null },
  { id: 'exp-travel', name: '旅行',   icon: '✈️', kind: 'expense', parent_id: null },
  { id: 'exp-daily',  name: '日用品', icon: '🧴', kind: 'expense', parent_id: null },
  { id: 'exp-big',    name: '大件',   icon: '📦', kind: 'expense', parent_id: null },
  { id: 'exp-house-rent',  name: '房租',     parent_id: 'exp-house',  kind: 'expense' },
  { id: 'exp-house-utility', name: '水电燃气', parent_id: 'exp-house', kind: 'expense' },
  { id: 'exp-house-wuye',  name: '物业',     parent_id: 'exp-house',  kind: 'expense' },
  { id: 'exp-house-net',   name: '通讯网费', parent_id: 'exp-house',  kind: 'expense' },
  { id: 'exp-food-meal',   name: '三餐',     parent_id: 'exp-food',   kind: 'expense' },
  { id: 'exp-food-waimai', name: '外卖',     parent_id: 'exp-food',   kind: 'expense' },
  { id: 'exp-food-grocery', name: '食材',    parent_id: 'exp-food',   kind: 'expense' },
  { id: 'exp-food-snack',  name: '零食饮品', parent_id: 'exp-food',   kind: 'expense' },
  { id: 'exp-hobby-acg',   name: '二次元',   parent_id: 'exp-hobby',  kind: 'expense' },
  { id: 'exp-hobby-book',  name: '书籍',     parent_id: 'exp-hobby',  kind: 'expense' },
  { id: 'exp-hobby-media', name: '影音娱乐', parent_id: 'exp-hobby',  kind: 'expense' },
  { id: 'exp-travel-traffic', name: '交通',  parent_id: 'exp-travel', kind: 'expense' },
  { id: 'exp-travel-stay',    name: '住宿',  parent_id: 'exp-travel', kind: 'expense' },
  { id: 'exp-travel-ticket',  name: '门票',  parent_id: 'exp-travel', kind: 'expense' },
  { id: 'exp-travel-shop',    name: '旅行购物', parent_id: 'exp-travel', kind: 'expense' },
  { id: 'exp-daily-wash',  name: '洗护',     parent_id: 'exp-daily',  kind: 'expense' },
  { id: 'exp-daily-clean', name: '清洁',     parent_id: 'exp-daily',  kind: 'expense' },
  { id: 'exp-daily-other', name: '其他日用', parent_id: 'exp-daily',  kind: 'expense' },
  { id: 'exp-big-digital', name: '电子产品', parent_id: 'exp-big',    kind: 'expense' },
  { id: 'exp-big-home',    name: '家电家具', parent_id: 'exp-big',    kind: 'expense' },
  { id: 'inc-salary', name: '工资',     icon: '💼', kind: 'income', parent_id: null },
  { id: 'inc-bonus',  name: '奖金·副业', icon: '🎁', kind: 'income', parent_id: null },
  { id: 'inc-resale', name: '出二手',   icon: '♻️', kind: 'income', parent_id: null },
  { id: 'inc-invest', name: '投资收益', icon: '📈', kind: 'income', parent_id: null },
  { id: 'inc-other',  name: '其他收入', icon: '✨', kind: 'income', parent_id: null },
];

const BUILTIN_CURRENCY = ['CNY', 'JPY', 'USD'];

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function ymOf(dateStr) { return dateStr.slice(0, 7); }
function fmtAmount(n, currency) {
  const negative = n < 0;
  const abs = Math.abs(n);
  let s;
  if (currency === 'JPY') s = abs.toFixed(0);
  else s = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (negative ? '-' : '') + s;
}

const Store = {
  meta: null,
  _months: new Map(),   // 'YYYY-MM' -> tx 数组（内存缓存，写穿）
  migrated: null,       // 迁移信息 {from:'v1', txs:n, accounts:n} 或 null

  /* ---------- 初始化 ---------- */
  init() {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      try { this.meta = JSON.parse(raw); } catch (e) { this.meta = null; }
    }
    if (!this.meta || !this.meta.accounts) {
      // 全新安装：先建默认元数据，再尝试迁移 v1
      this.meta = { schema: SCHEMA_VERSION, accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)), categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)) };
      this.migrateV1();
      this.saveMeta();
    }
  },

  saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(this.meta));
  },

  /* ---------- 账户 ---------- */
  accounts() { return this.meta.accounts; },
  account(id) { return this.meta.accounts.find(a => a.id === id); },
  addAccount(name, currency, icon) {
    const a = { id: uid('a'), name, currency, icon: icon || '💳' };
    this.meta.accounts.push(a); this.saveMeta(); return a;
  },
  updateAccount(id, patch) {
    const a = this.account(id); if (!a) return;
    Object.assign(a, patch); this.saveMeta();
  },
  deleteAccount(id) {
    // 有交易记录的账户不允许删除（保护数据）
    for (const ym of this.listMonths()) {
      if (this._months.get(ym).some(t => t.account_id === id || t.to_account_id === id)) return false;
    }
    this.meta.accounts = this.meta.accounts.filter(a => a.id !== id); this.saveMeta();
    return true;
  },

  /* ---------- 分类 ---------- */
  categories() { return this.meta.categories; },
  category(id) { return this.meta.categories.find(c => c.id === id); },
  topCategories(kind) { return this.meta.categories.filter(c => c.kind === kind && !c.parent_id); },
  subCategories(topId) { return this.meta.categories.filter(c => c.parent_id === topId); },
  addSubCategory(topId, name) {
    const top = this.category(topId); if (!top) return null;
    const c = { id: uid('c'), name, parent_id: topId, kind: top.kind };
    this.meta.categories.push(c); this.saveMeta(); return c;
  },
  deleteCategory(id) {
    const c = this.category(id); if (!c || !c.parent_id) return false; // 只允许删二级
    this.meta.categories = this.meta.categories.filter(x => x.id !== id); this.saveMeta();
    return true;
  },
  setBudget(topId, budget) {
    const c = this.category(topId); if (!c) return;
    if (budget === null || budget === '' || isNaN(budget)) delete c.budget;
    else c.budget = Number(budget);
    this.saveMeta();
  },

  /* ---------- 交易（按月分 key） ---------- */
  _loadMonth(ym) {
    if (this._months.has(ym)) return this._months.get(ym);
    let txs = [];
    try { txs = JSON.parse(localStorage.getItem(TX_PREFIX + ym) || '[]'); } catch (e) { txs = []; }
    this._months.set(ym, txs);
    return txs;
  },
  _saveMonth(ym) {
    const txs = this._months.get(ym) || [];
    localStorage.setItem(TX_PREFIX + ym, JSON.stringify(txs));
  },
  listMonths() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(TX_PREFIX)) {
        const ym = k.slice(TX_PREFIX.length);
        if (!this._months.has(ym)) this._loadMonth(ym);
        out.push(ym);
      }
    }
    for (const ym of this._months.keys()) if (!out.includes(ym)) out.push(ym);
    return out.sort().reverse();
  },
  addTx(tx) {
    const t = Object.assign({ id: uid('t'), created_at: Date.now() }, tx);
    const ym = ymOf(t.date);
    this._loadMonth(ym).push(t);
    this._saveMonth(ym);
    return t;
  },
  updateTx(id, patch) {
    const old = this.getTxById(id); if (!old) return null;
    const newYm = ymOf(patch.date || old.date);
    const oldYm = ymOf(old.date);
    const merged = Object.assign({}, old, patch);
    if (oldYm !== newYm) {
      const arr = this._months.get(oldYm);
      arr.splice(arr.indexOf(old), 1); this._saveMonth(oldYm);
      this._loadMonth(newYm).push(merged); this._saveMonth(newYm);
    } else {
      const arr = this._months.get(oldYm);
      arr.splice(arr.indexOf(old), 1, merged); this._saveMonth(oldYm);
    }
    return merged;
  },
  deleteTx(id) {
    const t = this.getTxById(id); if (!t) return false;
    const ym = ymOf(t.date);
    const arr = this._months.get(ym);
    arr.splice(arr.indexOf(t), 1); this._saveMonth(ym);
    return true;
  },
  getTxById(id) {
    for (const ym of this.listMonths()) {
      const t = this._months.get(ym).find(x => x.id === id);
      if (t) return t;
    }
    return null;
  },
  monthTx(ym) { return this._loadMonth(ym); },
  allTx() {
    const out = [];
    for (const ym of this.listMonths()) out.push(...this._months.get(ym));
    return out;
  },

  /* ---------- 统计 ---------- */
  /* 某日期（含）之前各账户余额；dateStr=null 表示全部 */
  balances(dateStr) {
    const out = {};
    for (const a of this.meta.accounts) out[a.id] = 0;
    const txs = this.allTx();
    txs.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.created_at - y.created_at));
    for (const t of txs) {
      if (dateStr && t.date > dateStr) continue;
      const cur = t.currency || (this.account(t.account_id) || {}).currency || 'CNY';
      if (t.type === 'expense') out[t.account_id] -= t.amount;
      else if (t.type === 'income') out[t.account_id] += t.amount;
      else if (t.type === 'transfer') {
        if (t.account_id in out) out[t.account_id] -= t.amount;
        if (t.to_account_id in out) out[t.to_account_id] += t.amount;
      } else if (t.type === 'adjust') {
        if (t.account_id in out) out[t.account_id] += t.amount;
      }
    }
    return out;
  },

  /* 月度汇总（限币种），按一级分类聚合 */
  monthTotals(ym, currency) {
    const income = { total: 0, byTop: {} };
    const expense = { total: 0, byTop: {} };
    for (const t of this.monthTx(ym)) {
      if ((t.currency || 'CNY') !== currency) continue;
      if (t.type === 'income') {
        income.total += t.amount;
        const top = this._topOf(t.category_id);
        income.byTop[top] = (income.byTop[top] || 0) + t.amount;
      } else if (t.type === 'expense') {
        expense.total += t.amount;
        const top = this._topOf(t.category_id);
        expense.byTop[top] = (expense.byTop[top] || 0) + t.amount;
      }
    }
    return { income, expense };
  },
  _topOf(catId) {
    const c = this.category(catId);
    if (!c) return 'unknown';
    return c.parent_id ? c.parent_id : c.id;
  },

  /* 最近 n 个月结余（限币种） */
  surplusSeries(n, currency) {
    const months = this._lastMonthNames(n);
    return months.map(ym => {
      const t = this.monthTotals(ym, currency);
      return { ym, income: t.income.total, expense: t.expense.total };
    });
  },

  /* 最近 n 个月月末净资产（限币种，跨账户加总） */
  netWorthSeries(n, currency) {
    const months = this._lastMonthNames(n);
    return months.map(ym => {
      const dayEnd = ym + '-31'; // 字符串比较天然覆盖整月
      const bal = this.balances(dayEnd);
      let sum = 0;
      for (const a of this.meta.accounts) {
        if (a.currency !== currency) continue;
        sum += bal[a.id] || 0;
      }
      return { ym, amount: sum };
    });
  },
  _lastMonthNames(n) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0'));
    }
    return out;
  },

  /* ---------- 备份与迁移 ---------- */
  exportAll() {
    const payload = { app: 'moe-ledger', schema: SCHEMA_VERSION, exported_at: new Date().toISOString(), meta: this.meta, months: {} };
    for (const ym of this.listMonths()) payload.months[ym] = this._months.get(ym);
    return JSON.stringify(payload, null, 2);
  },

  /* 导入：v2 备份全量恢复；v1 备份走迁移 */
  importJSON(text) {
    const data = JSON.parse(text);
    if (data.schema >= 2 && data.meta && data.months) {
      this.meta = data.meta;
      this._months.clear();
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(TX_PREFIX)) localStorage.removeItem(k);
      }
      let n = 0;
      for (const ym of Object.keys(data.months)) {
        this._months.set(ym, data.months[ym]);
        this._saveMonth(ym);
        n += data.months[ym].length;
      }
      this.saveMeta();
      return { mode: 'v2', txs: n, accounts: this.meta.accounts.length };
    }
    if (data.accounts && (data.transactions || data.expenseCategories)) {
      return this.migrateV1(data);
    }
    throw new Error('无法识别的备份格式');
  },

  /* v1 → v2 迁移
   * - 汇率/cny_amount/to_amount/to_currency 等字段丢弃
   * - 负债账户降级为普通账户（期初取负，余额负数=欠款）
   * - 期初余额转成 adjust 交易，落在最早交易那天（或今天）
   * - 换汇转账拆成：一笔转账 + 一笔目标账户的差额 adjust，保证余额精确
   */
  migrateV1(v1data) {
    const v1 = v1data || (() => { const r = localStorage.getItem(V1_KEY); return r ? JSON.parse(r) : null; })();
    if (!v1 || !v1.accounts) return null;
    const accounts = v1.accounts.map(a => ({
      id: a.id, name: a.name, icon: a.icon || this._iconFor(a.name), currency: a.currency || 'CNY',
    }));
    // 追加 v1 独有账户
    for (const a of accounts) {
      if (!this.meta.accounts.find(x => x.id === a.id)) this.meta.accounts.push(a);
    }
    // 避免重复迁移
    if (this.meta._v1migrated) return null;
    this.meta._v1migrated = true;

    const txs = v1.transactions || [];
    const dates = txs.map(t => t.date || '').sort();
    const anchor = (dates[0] && dates[0] >= '2000-01-01') ? dates[0] : todayStr();

    // 期初余额 → adjust 交易（负债取负）
    for (const a of v1.accounts) {
      const init = Number(a.init_balance || 0);
      if (!init) continue;
      this.addTx({
        type: 'adjust', date: anchor, account_id: a.id,
        amount: a.type === 'liability' ? -init : init,
        currency: a.currency || 'CNY', category_id: null,
        note: 'v1 迁移·期初余额' + (a.type === 'liability' ? '（负债，余额负数=欠款）' : ''),
      });
    }

    const catMap = this._buildCategoryMap(v1);
    let count = 0;
    for (const t of txs) {
      const base = {
        id: t.id || uid('t'), date: t.date, created_at: t.created_at || Date.now(),
        amount: Number(t.amount || 0), currency: t.currency || 'CNY',
        account_id: t.accountId || t.account_id, category_id: catMap(t.categoryId || t.category_id) || null,
        note: t.note || '',
      };
      if (!base.date || !base.account_id) continue;
      if (t.type === 'expense') {
        this.addTx(Object.assign(base, { type: 'expense' }));
      } else if (t.type === 'income') {
        this.addTx(Object.assign(base, { type: 'income' }));
      } else if (t.type === 'transfer') {
        const toId = t.toAccountId || t.to_account_id;
        const toCur = t.toCurrency || t.to_currency;
        const toAmt = t.toAmount != null ? Number(t.toAmount) : (t.to_amount != null ? Number(t.to_amount) : null);
        if (toId && toCur && base.currency !== toCur) {
          // 换汇转账：转账记原币，目标账户差额用 adjust 补正
          this.addTx(Object.assign({}, base, { type: 'transfer', to_account_id: toId, note: (base.note ? base.note + '；' : '') + 'v1 迁移·换汇（目标差额见相邻调整）' }));
          if (toAmt != null) {
            this.addTx({ type: 'adjust', date: base.date, account_id: toId, amount: toAmt - base.amount, currency: toCur, category_id: null, note: 'v1 迁移·换汇差额补正', created_at: Date.now() });
          }
        } else {
          this.addTx(Object.assign(base, { type: 'transfer', to_account_id: toId }));
        }
      }
      count++;
    }
    this.saveMeta();
    this.migrated = { from: 'v1', txs: count, accounts: accounts.length };
    // 迁移完成后清除 v1 原始 key？——保留，用户确认 v2 无误后可在设置里清除
    return this.migrated;
  },
  clearV1Key() { localStorage.removeItem(V1_KEY); },
  hasV1Key() { return !!localStorage.getItem(V1_KEY); },

  _buildCategoryMap(v1) {
    const map = {};
    const rule = [
      [/餐|食|吃|饭|外卖|早|午|晚|夜宵|饮/, 'exp-food'],
      [/房|租|水|电|气|物业|网|话|通讯/, 'exp-house'],
      [/谷|二次元|手办|游戏|书|漫|影音|娱乐|acg|票/, 'exp-hobby'],
      [/旅|行|宿|门|机票|车票|酒店/, 'exp-travel'],
      [/日|用|洗|清|纸|护|品/, 'exp-daily'],
      [/电|家|具|器|设备/, 'exp-big'],
    ];
    const incRule = [
      [/工资|薪/, 'inc-salary'], [/奖|副业|兼职/, 'inc-bonus'],
      [/二手|出|卖/, 'inc-resale'], [/投资|理财|利息|收益/, 'inc-invest'],
    ];
    const pick = (name, rules, fallback) => {
      for (const [re, id] of rules) if (re.test(name)) return id;
      return fallback;
    };
    const ensureSub = (topId, name) => {
      const exist = this.meta.categories.find(c => c.parent_id === topId && c.name === name);
      if (exist) return exist.id;
      const c = this.addSubCategory(topId, name);
      return c ? c.id : topId;
    };
    for (const c of (v1.expenseCategories || [])) {
      const top = pick(c.name, rule, 'exp-daily');
      if (this.category(c.id)) { map[c.id] = this.category(c.id).parent_id ? c.id : c.id; continue; }
      if (this.topCategories('expense').find(x => x.id === c.id)) { map[c.id] = c.id; continue; }
      map[c.id] = ensureSub(top, c.name);
    }
    for (const c of (v1.incomeCategories || [])) {
      const top = pick(c.name, incRule, 'inc-other');
      if (this.category(c.id)) { map[c.id] = c.id; continue; }
      map[c.id] = this.meta.categories.find(x => x.id === top) ? (this.topCategories('income').find(x => x.id === top) ? top : top) : 'inc-other';
    }
    return id => (id && map[id]) || null;
  },
  _iconFor(name) {
    if (/微信/.test(name)) return '💬';
    if (/支付宝/.test(name)) return '🅰️';
    if (/现金/.test(name)) return '💴';
    if (/卡/.test(name)) return '🏦';
    if (/理财/.test(name)) return '📈';
    return '💳';
  },
};

/* Node 环境下可 require（用于测试），浏览器端无影响 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Store, fmtAmount, todayStr, uid };
}
