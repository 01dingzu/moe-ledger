'use strict';
/* 萌账 v2 存储层逻辑测试：模拟 localStorage + 构造 v1 数据，验证迁移/余额/统计 */
// --- localStorage mock ---
const _ls = new Map();
global.localStorage = {
  getItem: k => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: k => _ls.delete(k),
  get length() { return _ls.size; },
  key(i) { return [..._ls.keys()][i]; },
};

const { Store } = require('./js/store.js');

// --- 构造 v1 数据 ---
const v1 = {
  accounts: [
    { id: 'a_wechat', name: '微信钱包', type: 'asset', currency: 'CNY', init_balance: 1000 },
    { id: 'a_bank', name: '银行卡', type: 'asset', currency: 'CNY', init_balance: 20000 },
    { id: 'a_jpy', name: '日本钱包', type: 'asset', currency: 'JPY', init_balance: 50000 },
    { id: 'a_card', name: '信用卡', type: 'liability', currency: 'CNY', init_balance: 3000 },
  ],
  expenseCategories: [
    { id: 'e_food', name: '吃饭' }, { id: 'e_acg', name: '二次元' },
    { id: 'e_house', name: '房租' }, { id: 'e_unknow', name: '神秘分类' },
  ],
  incomeCategories: [{ id: 'i_salary', name: '工资' }],
  transactions: [
    { id: 't1', date: '2026-09-01', type: 'expense', amount: 25.5, currency: 'CNY', accountId: 'a_wechat', categoryId: 'e_food', note: '午饭' },
    { id: 't2', date: '2026-09-05', type: 'expense', amount: 299, currency: 'CNY', accountId: 'a_card', categoryId: 'e_acg', note: '谷子' },
    { id: 't3', date: '2026-09-10', type: 'income', amount: 12000, currency: 'CNY', accountId: 'a_bank', categoryId: 'i_salary' },
    { id: 't4', date: '2026-09-12', type: 'transfer', amount: 2000, currency: 'CNY', accountId: 'a_bank', toAccountId: 'a_wechat' },
    { id: 't5', date: '2026-09-15', type: 'transfer', amount: 10000, currency: 'CNY', accountId: 'a_bank', toAccountId: 'a_jpy', toAmount: 210000, toCurrency: 'JPY', note: '换汇' },
    { id: 't6', date: '2026-10-01', type: 'expense', amount: 3000, currency: 'CNY', accountId: 'a_wechat', categoryId: 'e_house', note: '房租' },
    { id: 't7', date: '2026-10-03', type: 'expense', amount: 88, currency: 'CNY', accountId: 'a_wechat', categoryId: 'e_unknow', note: '杂' },
  ],
};
_ls.set('moekan-data-v1', JSON.stringify(v1));

// --- 跑初始化（触发迁移） ---
Store.init();
const T = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name) || (!cond && process.exitCode === undefined && (process.exitCode = 1));

const bal = Store.balances();
// 期初:wechat 1000, bank 20000, jpy 50000, card -3000(负债取负)
// wechat: 1000 -25.5 +2000 -3000 -88 = -113.5
T('微信余额 -113.5', Math.abs(bal.a_wechat - (-113.5)) < 1e-9);
// bank: 20000 +12000 -2000 -10000 = 20000
T('银行卡余额 20000', Math.abs(bal.a_bank - 20000) < 1e-9);
// jpy: 50000(期初) + (转账转入 10000 错币种) + (换汇差额 210000-10000=200000) = 260000
T('日本钱包余额 260000', Math.abs(bal.a_jpy - 260000) < 1e-9);
// card: -3000(期初) -299(支出) = -3299
T('信用卡余额 -3299（负=欠款）', Math.abs(bal.a_card - (-3299)) < 1e-9);

// 分类映射
T('吃饭→餐饮桶下', (Store.category(Store.getTxById('t1').category_id) || {}).parent_id === 'exp-food');
T('二次元→爱好桶下', (Store.category(Store.getTxById('t2').category_id) || {}).parent_id === 'exp-hobby');
T('房租→住房桶下', (Store.category(Store.getTxById('t6').category_id) || {}).parent_id === 'exp-house');
T('未知分类→日用品桶下（兜底）', (Store.category(Store.getTxById('t7').category_id) || {}).parent_id === 'exp-daily');
T('工资→工资', Store.getTxById('t3').category_id === 'inc-salary');

// 月统计（2026-10, CNY）
const oct = Store.monthTotals('2026-10', 'CNY');
T('10月支出 3088', Math.abs(oct.expense.total - 3088) < 1e-9);
T('10月住房桶 3000', Math.abs((oct.expense.byTop['exp-house'] || 0) - 3000) < 1e-9);
T('10月不含 JPX/换汇干扰', oct.income.total === 0);
const sep = Store.monthTotals('2026-09', 'CNY');
T('9月收入 12000', Math.abs(sep.income.total - 12000) < 1e-9);
T('9月支出(含信用卡谷子) 324.5', Math.abs(sep.expense.total - 324.5) < 1e-9);

// 净资产（CNY）：wechat -113.5 + bank 20000 + card -3299 = 16587.5（jpy 是 JPY 不计入）
const nw = Store.netWorthSeries(1, 'CNY');
T('10月末净资产(CNY) 16587.5', Math.abs(nw[0].amount - 16587.5) < 1e-9);

// 导出再导入（v2 全量恢复）
const backup = Store.exportAll();
_ls.clear();
global.localStorage = { getItem: k => (_ls.has(k) ? _ls.get(k) : null), setItem: (k, v) => _ls.set(k, String(v)), removeItem: k => _ls.delete(k), get length() { return _ls.size; }, key(i) { return [..._ls.keys()][i]; } };
global.Store = Store; // 保持引用
const r = Store.importJSON(backup);
T('v2 备份导入 tx 数 = 12（7 笔 + 4 期初 + 1 换汇差额）', r.txs === 12);
const bal2 = Store.balances();
T('导入后微信余额一致', Math.abs(bal2.a_wechat - (-113.5)) < 1e-9);

console.log('\n全部断言结束，exitCode =', process.exitCode || 0);
