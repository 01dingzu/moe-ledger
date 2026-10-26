/* ═══════════ engine.js — 复式记账引擎：余额 / 统计 / 校验 ═══════════ */
(function () {
  'use strict';

  const fmt = (n, digits) => {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: digits == null ? 2 : digits,
      maximumFractionDigits: digits == null ? 2 : digits,
    });
  };

  window.Engine = {

    /* ── 账户余额：按 (账户, 币种) 分组计算 ──
       asset:     期初 + 收入 - 支出 + 转入 - 转出
       liability: 期初 + 支出 - 收入 ... 信用卡记账方向：支出记在卡上=欠款增加
       简化处理：余额 = init_balance + Σ(入) - Σ(出)，
       liability 账户的支出视为"入"（欠款+）、还款转账视为"出"（欠款-）
    */
    accountBalances() {
      const balances = {}; // { accountId: { CNY: n, JPY: n, ... } }
      const ensure = (id, cur) => {
        if (!balances[id]) balances[id] = {};
        if (balances[id][cur] == null) balances[id][cur] = 0;
        return balances[id][cur];
      };
      const accounts = Store.getAccounts();
      accounts.forEach(a => {
        if (a.init_balance) ensure(a.id, a.currency).valueOf; // 占位
        if (a.init_balance) balances[a.id][a.currency] = (balances[a.id][a.currency] || 0) + Number(a.init_balance || 0);
      });

      for (const t of Store.getTransactions()) {
        const acc = Store.getAccount(t.account_id);
        if (!acc) continue;
        const dir = acc.type === 'liability' ? -1 : 1; // 负债账户记账方向取反

        if (t.type === 'expense') {
          ensure(t.account_id, t.currency);
          balances[t.account_id][t.currency] -= dir * t.amount;
        } else if (t.type === 'income') {
          ensure(t.account_id, t.currency);
          balances[t.account_id][t.currency] += dir * t.amount;
        } else if (t.type === 'transfer') {
          // 转出侧
          ensure(t.account_id, t.currency);
          balances[t.account_id][t.currency] -= dir * t.amount;
          // 转入侧（支持换汇：to_amount / to_currency）
          const toAcc = Store.getAccount(t.to_account_id);
          if (toAcc) {
            const inAmt = t.to_amount != null ? t.to_amount : t.amount;
            const inCur = t.to_currency || t.currency;
            ensure(t.to_account_id, inCur);
            balances[t.to_account_id][inCur] += (toAcc.type === 'liability' ? -1 : 1) * inAmt;
          }
        }
      }
      return balances;
    },

    // 账户折合人民币总额（多币种按交易当日/最近汇率折算的近似值）
    accountCNYTotal(accountId, balances) {
      const b = balances[accountId];
      if (!b) return 0;
      let total = 0, missing = false;
      for (const cur of Object.keys(b)) {
        const cny = Fx.toCNY(b[cur], cur, new Date().toISOString().slice(0, 10));
        if (cny == null) missing = true; else total += cny;
      }
      return missing ? total : total;
    },

    netWorth() {
      const balances = this.accountBalances();
      let assets = 0, liabilities = 0;
      for (const acc of Store.getAccounts()) {
        const total = this.accountCNYTotal(acc.id, balances);
        if (acc.type === 'liability') liabilities += -total;
        else assets += total;
      }
      return { assets, liabilities, net: assets - liabilities };
    },

    /* ── 月度统计 ── */
    monthStats(ym) { // '2026-08'
      const txs = Store.getTransactions().filter(t => t.date.startsWith(ym));
      let expense = 0, income = 0, count = 0;
      const byCategory = {}; // catId -> cny
      const byDay = {};      // 'DD' -> expense cny
      for (const t of txs) {
        if (t.type === 'transfer') continue;
        count++;
        const cny = t.cny_amount != null ? t.cny_amount
                  : Fx.toCNY(t.amount, t.currency, t.date);
        if (cny == null) continue; // 汇率缺失的暂不计入（界面另行提示）
        if (t.type === 'expense') {
          expense += cny;
          const cat = t.category_id || 'e_other';
          byCategory[cat] = (byCategory[cat] || 0) + cny;
          const day = t.date.slice(8, 10);
          byDay[day] = (byDay[day] || 0) + cny;
        } else if (t.type === 'income') {
          income += cny;
        }
      }
      return { expense, income, net: income - expense, count, byCategory, byDay, txs };
    },

    /* ── 交易校验 ── */
    validate(tx) {
      const errors = [];
      if (!(tx.amount > 0)) errors.push('金额必须大于 0');
      if (!tx.account_id) errors.push('请选择账户');
      if (tx.type === 'transfer') {
        if (!tx.to_account_id) errors.push('请选择转入账户');
        if (tx.account_id === tx.to_account_id) errors.push('转出转入不能是同一账户');
      }
      if ((tx.type === 'expense' || tx.type === 'income') && !tx.category_id) {
        errors.push('请选择分类');
      }
      if (!tx.date) errors.push('请选择日期');
      return errors;
    },

    /* ── 工具 ── */
    fmt,
    fmtCNY(n) {
      if (n == null || isNaN(n)) return '¥—';
      return n < 0 ? '-¥' + fmt(-n) : '¥' + fmt(n);
    },
    fmtCur(n, cur) {
      const c = Store.CURRENCIES.find(x => x.code === cur);
      const sym = c ? c.symbol : '';
      if (n == null || isNaN(n)) return sym + '—';
      return n < 0 ? '-' + sym + fmt(-n) : sym + fmt(n);
    },
    curName(cur) {
      const c = Store.CURRENCIES.find(x => x.code === cur);
      return c ? c.name : cur;
    },
    today() { return new Date().toISOString().slice(0, 10); },
    currentYM() { return new Date().toISOString().slice(0, 7); },
  };
})();
