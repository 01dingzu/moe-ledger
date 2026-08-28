/* ═══════════ store.js — 数据持久化与种子数据 ═══════════ */
(function () {
  'use strict';

  const STORAGE_KEY = 'moekan-data-v1';
  const DATA_VERSION = 1;

  // 支持的币种（与 fx-dashboard safe-rmb-rates.json 对齐 + CNY）
  const CURRENCIES = [
    { code: 'CNY', symbol: '¥', name: '人民币' },
    { code: 'USD', symbol: '$', name: '美元' },
    { code: 'JPY', symbol: '¥', name: '日元' },
    { code: 'EUR', symbol: '€', name: '欧元' },
    { code: 'GBP', symbol: '£', name: '英镑' },
    { code: 'HKD', symbol: 'HK$', name: '港币' },
    { code: 'AUD', symbol: 'A$', name: '澳元' },
    { code: 'KRW', symbol: '₩', name: '韩元' },
    { code: 'SGD', symbol: 'S$', name: '新加坡元' },
    { code: 'CHF', symbol: '₣', name: '瑞郎' },
    { code: 'CAD', symbol: 'C$', name: '加元' },
    { code: 'THB', symbol: '฿', name: '泰铢' },
  ];

  const DEFAULT_EXPENSE_CATEGORIES = [
    { id: 'e_food',    name: '吃饭', icon: '🍜' },
    { id: 'e_grocery', name: '日用购物', icon: '🛒' },
    { id: 'e_transport', name: '交通', icon: '🚇' },
    { id: 'e_housing', name: '住房房租', icon: '🏠' },
    { id: 'e_utility', name: '水电杂费', icon: '💡' },
    { id: 'e_fun',     name: '娱乐', icon: '🎮' },
    { id: 'e_acg',     name: '二次元', icon: '🧸' },
    { id: 'e_restaurant', name: '探店', icon: '🍽️' },
    { id: 'e_travel',  name: '旅行', icon: '✈️' },
    { id: 'e_medical', name: '医疗', icon: '💊' },
    { id: 'e_other',   name: '其他', icon: '📦' },
  ];

  const DEFAULT_INCOME_CATEGORIES = [
    { id: 'i_salary', name: '工资', icon: '💰' },
    { id: 'i_bonus',  name: '奖金', icon: '🎉' },
    { id: 'i_side',   name: '副业', icon: '💼' },
    { id: 'i_sell',   name: '出二手', icon: '🔁' },
    { id: 'i_refund', name: '退款', icon: '↩️' },
    { id: 'i_redpacket', name: '红包', icon: '🧧' },
    { id: 'i_other',  name: '其他收入', icon: '＋' },
  ];

  const DEFAULT_ACCOUNTS = [
    { id: 'a_cash',   name: '现金',     type: 'asset', currency: 'CNY', init_balance: 0 },
    { id: 'a_alipay', name: '支付宝',   type: 'asset', currency: 'CNY', init_balance: 0 },
    { id: 'a_wechat', name: '微信钱包', type: 'asset', currency: 'CNY', init_balance: 0 },
    { id: 'a_bank',   name: '银行卡',   type: 'asset', currency: 'CNY', init_balance: 0 },
  ];

  const DEFAULT_SETTINGS = {
    fxUrl: 'https://01dingzu.github.io/fx-dashboard/data/safe-rmb-rates.json',
  };

  let data = null;

  function emptyData() {
    return {
      version: DATA_VERSION,
      accounts: JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS)),
      transactions: [],
      expenseCategories: JSON.parse(JSON.stringify(DEFAULT_EXPENSE_CATEGORIES)),
      incomeCategories: JSON.parse(JSON.stringify(DEFAULT_INCOME_CATEGORIES)),
      settings: Object.assign({}, DEFAULT_SETTINGS),
      fx: { rates: [], fetchedAt: null, manualRates: {} },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        data = JSON.parse(raw);
        // 兼容缺字段
        data.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        data.fx = Object.assign({ rates: [], fetchedAt: null, manualRates: {} }, data.fx);
        return;
      }
    } catch (e) {
      console.error('数据加载失败', e);
    }
    data = emptyData();
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('数据保存失败', e);
      alert('保存失败：本地存储空间不足或被禁用。请先导出备份！');
    }
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── 对外 API ──
  window.Store = {
    CURRENCIES,
    load, save,
    get data() { return data; },

    // 账户
    getAccounts() { return data.accounts; },
    getAccount(id) { return data.accounts.find(a => a.id === id); },
    addAccount(acc) {
      const a = Object.assign({
        id: uid('a'), type: 'asset', currency: 'CNY', init_balance: 0,
      }, acc);
      data.accounts.push(a);
      save();
      return a;
    },
    updateAccount(id, patch) {
      const a = this.getAccount(id);
      if (a) Object.assign(a, patch);
      save();
    },
    deleteAccount(id) {
      const used = data.transactions.some(t =>
        t.account_id === id || t.to_account_id === id);
      if (used) return { ok: false, msg: '该账户有交易记录，不能删除' };
      data.accounts = data.accounts.filter(a => a.id !== id);
      save();
      return { ok: true };
    },

    // 交易
    getTransactions() { return data.transactions; },
    addTransaction(tx) {
      const t = Object.assign({
        id: uid('t'),
        date: new Date().toISOString().slice(0, 10),
        type: 'expense',           // expense | income | transfer
        amount: 0,                 // 数值，账户侧币种
        currency: 'CNY',
        to_amount: null,           // 转账/换汇时目标账户入账金额
        to_currency: null,
        account_id: null,
        to_account_id: null,       // income=来源账户 / transfer=目标账户
        category_id: null,
        note: '',
        cny_amount: null,          // 创建时按汇率折算（外币侧）
      }, tx);
      data.transactions.push(t);
      data.transactions.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
      save();
      return t;
    },
    deleteTransaction(id) {
      data.transactions = data.transactions.filter(t => t.id !== id);
      save();
    },

    // 分类
    getCategories(type) {
      return type === 'income' ? data.incomeCategories : data.expenseCategories;
    },
    getCategory(id) {
      return data.expenseCategories.find(c => c.id === id) ||
             data.incomeCategories.find(c => c.id === id);
    },
    addCategory(name, type) {
      if (!name.trim()) return null;
      const list = type === 'income' ? data.incomeCategories : data.expenseCategories;
      if (list.some(c => c.name === name.trim())) return null;
      const c = { id: uid(type === 'income' ? 'i' : 'e'), name: name.trim(), icon: type === 'income' ? '＋' : '📦' };
      list.push(c);
      save();
      return c;
    },
    deleteCategory(id) {
      const used = data.transactions.some(t => t.category_id === id);
      if (used) return { ok: false, msg: '该分类下有交易，不能删除' };
      data.expenseCategories = data.expenseCategories.filter(c => c.id !== id);
      data.incomeCategories = data.incomeCategories.filter(c => c.id !== id);
      save();
      return { ok: true };
    },

    // 设置与汇率数据
    getSettings() { return data.settings; },
    setSettings(patch) { Object.assign(data.settings, patch); save(); },
    setFxRates(rates) { data.fx.rates = rates; data.fx.fetchedAt = Date.now(); save(); },
    setManualRate(currency, rate) {
      if (rate == null) delete data.fx.manualRates[currency];
      else data.fx.manualRates[currency] = rate;
      save();
    },

    // 备份
    exportJSON() {
      return JSON.stringify(data, null, 2);
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) {
        return { ok: false, msg: '文件格式不正确' };
      }
      if (!confirm('导入将覆盖当前全部数据（' +
        data.transactions.length + ' 笔交易），确定继续吗？')) {
        return { ok: false, msg: '已取消' };
      }
      parsed.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings);
      parsed.fx = Object.assign({ rates: [], fetchedAt: null, manualRates: {} }, parsed.fx);
      data = parsed;
      save();
      return { ok: true };
    },
    clearAll() {
      if (!confirm('⚠️ 确定清空全部数据？此操作不可恢复！建议先导出备份。')) return false;
      data = emptyData();
      save();
      return true;
    },
  };
})();
