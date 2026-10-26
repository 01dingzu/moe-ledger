/* 回归测试：账户弹层「取消/保存」必须真正关闭弹层
   背景 bug（线上真实发生）：.modal-mask{display:flex} 覆盖了浏览器 UA 样式表
   对 [hidden] 的 display:none —— 真实浏览器里作者样式永远赢过 UA 样式，
   导致点取消/保存/删除弹层都关不掉。

   ⚠️ 为什么不用 getComputedStyle 断言：jsdom 的级联实现和真实浏览器相反
   （jsdom 里 [hidden] 永远赢过作者 display 规则），此 bug 在 jsdom 中无法复现。
   因此本测试 = 交互层断言（hidden 属性切换正确）+ CSS 守卫静态检查
   （[hidden]{display:none!important} 规则必须存在，且优先级压过 .modal-mask 的 flex）。 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, 'css', 'style.css'), 'utf8');

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond) => {
    if (cond) { pass++; console.log('  ok - ' + name); }
    else { fail++; console.error('  FAIL - ' + name); }
  };

  /* ── 第 1 层：CSS 守卫 ── */
  t('CSS 含 [hidden]{display:none!important} 守卫规则',
    /\[hidden\]\s*\{\s*display:\s*none\s*!\s*important\s*;?\s*\}/.test(css));

  /* ── 第 2 层：交互（hidden 属性切换）── */
  const dom = await JSDOM.fromFile(path.join(__dirname, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'https://01dingzu.github.io/moe-ledger/index.html',
    pretendToBeVisual: true,
  });

  await new Promise(r => setTimeout(r, 800));
  const { window } = dom;
  const { document } = window;
  const $ = (s) => document.querySelector(s);

  const modal = $('#account-modal');
  t('初始加载弹层 hidden', modal.hidden);

  window.App.openAccountModal(null);
  t('openAccountModal 后弹层显示', !modal.hidden);

  $('#acc-cancel').click();
  t('点击取消后弹层 hidden', modal.hidden);

  window.App.openAccountModal(null);
  $('#acc-name').value = '测试账户';
  $('#acc-save').click();
  t('点击保存后弹层 hidden', modal.hidden);
  t('保存后账户已入库', window.Store.getAccounts().some(a => a.name === '测试账户'));

  // 打开再点删除按钮路径（新账户无删除按钮，编辑已有账户才有）
  const acc = window.Store.getAccounts().find(a => a.name === '测试账户');
  window.App.openAccountModal(acc.id);
  t('编辑账户时删除按钮可见', !$('#acc-delete').hidden);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})();
