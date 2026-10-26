/* ═══════════ fx.js — 汇率：fx-dashboard 数据源 + 手动补录 ═══════════ */
(function () {
  'use strict';

  const FALLBACK_DAYS = 7; // 找不到当日汇率时，向前找最近 N 天

  // 二分/线性查找不早于 date 的最近汇率记录
  function findRateEntry(rates, date) {
    if (!rates || !rates.length) return null;
    // rates 按 date 升序
    let best = null;
    for (let i = rates.length - 1; i >= 0; i--) {
      const r = rates[i];
      if (r.date <= date) { best = r; break; }
      if (!best || r.date > (best.date || '')) best = null; // 保持空
    }
    // 循环出来 best = 不晚于 date 的最近一条；若 date 早于全部，取最早一条
    if (!best) best = rates[0];
    return best;
  }

  window.Fx = {
    // 获取某币种在某日期对 CNY 的汇率（1 外币 = rate CNY）
    getRate(currency, date) {
      if (currency === 'CNY') return 1;
      const fx = Store.data.fx;
      // 手动补录优先
      if (fx.manualRates && fx.manualRates[currency] != null) {
        return fx.manualRates[currency];
      }
      const entry = findRateEntry(fx.rates, date || new Date().toISOString().slice(0, 10));
      if (entry && entry[currency] != null) return entry[currency];
      return null; // 缺失，由调用方处理
    },

    // 外币金额 → 人民币
    toCNY(amount, currency, date) {
      const rate = this.getRate(currency, date);
      if (rate == null) return null;
      return amount * rate;
    },

    // 拉取 fx-dashboard 数据
    async fetchRates(url) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!Array.isArray(json) || !json.length) throw new Error('数据格式不正确');
      // 校验并排序（升序）
      json.sort((a, b) => a.date.localeCompare(b.date));
      Store.setFxRates(json);
      return json.length;
    },

    // 汇率状态摘要
    statusText() {
      const fx = Store.data.fx;
      if (!fx.rates.length && !Object.keys(fx.manualRates || {}).length) return '未加载';
      if (!fx.rates.length) return '仅手动汇率：' + Object.keys(fx.manualRates).join(', ');
      const last = fx.rates[fx.rates.length - 1];
      const when = fx.fetchedAt ? new Date(fx.fetchedAt).toLocaleString('zh-CN') : '未知时间';
      return `已加载 ${fx.rates.length} 天 · 最新 ${last.date} · 更新于 ${when}`;
    },
  };
})();
