// 字体缩放回归测试：加载真实 marknote.js + mock app，断言
// 1) 全选/整篇放大：保留各文本的字号差异，颜色/字体不动
// 2) 单独选取文字放大：可无限次（单调增大，不回落）
// 3) 继承文本放大：不丢失基准
// 4) 缩小：同样保留差异
import { app } from './scripts/app.js';
import './ComfyUI_MarkNote/web/marknote.js';

const out = document.getElementById('out');
const results = [];
function check(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? (' :: ' + extra) : ''));
}

/* 同步化：让 #out 在模块求值阶段就填满（与既有 harness 一致） */
globalThis.requestAnimationFrame = cb => { try { cb(); } catch (e) {} return 0; };
globalThis.Image = class {
  set src(v) { this._src = v; if (this.onload) this.onload(); }
  get src() { return this._src; }
  get naturalWidth() { return 4; }
  get naturalHeight() { return 4; }
};
globalThis.FileReader = class {
  readAsDataURL() {
    this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
    if (this.onload) this.onload();
  }
};

function setSel(node, start, endNode, end) {
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(endNode || node, end != null ? end : start);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}
function spanSizes(editor) {
  return Array.from(editor.querySelectorAll('span[style*="font-size"]'))
    .map(s => parseFloat(s.style.fontSize)).filter(n => !isNaN(n)).sort((a, b) => a - b);
}
function firstTextWith(editor, key) {
  const tw = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
  let n; while ((n = tw.nextNode())) { if (n.textContent.indexOf(key) >= 0) return n; }
  return null;
}

function run() {
  const errors = [];
  window.addEventListener('error', e => errors.push('pageerror: ' + (e.message || e)));
  const origErr = console.error.bind(console);
  console.error = (...a) => { errors.push('console.error: ' + a.map(x => (x && x.message) || String(x)).join(' ')); };

  const ext = window.__mnExt;
  check('extension registered', !!ext);
  if (!ext) { finish(errors); return; }

  class FakeNodeType {}
  FakeNodeType.prototype.onNodeCreated = null;
  ext.beforeRegisterNodeDef(FakeNodeType, { name: 'MarkNote' }, app);
  const node = new FakeNodeType();
  node.properties = {}; node.pos = [40, 40]; node.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node);
  app.graph._nodes.push(node);

  const el = node._mnEl;
  // mock app 没有 addDOMWidget，手动把节点 DOM 挂到文档，才能复现真实的 CSS 级联 / getComputedStyle
  if (el.parentNode !== document.body) document.body.appendChild(el);
  const editor = el.querySelector('.editor');
  const bigger = el.querySelector('[data-act="bigger"]');
  const smaller = el.querySelector('[data-act="smaller"]');
  const reset = el.querySelector('[data-act="resetSize"]');
  check('node DOM created', !!el);

  const UP3 = Math.pow(1.05, 3), DOWN2 = Math.pow(1 / 1.05, 2);   // 每档 5%

  /* --- A: 全选放大，保留字号差异 + 颜色/字体 --- */
  editor.innerHTML = '基础 <span style="font-size:40px;color:red">红大40</span> ' +
    '<span style="font-size:18px;color:blue;font-family:KaiTi,serif">蓝小18楷</span> 末尾';
  setSel(editor, 0, editor, editor.childNodes.length);
  const baseA0 = parseFloat(getComputedStyle(editor).fontSize);
  const spanA0 = spanSizes(editor);
  bigger.click(); bigger.click(); bigger.click();
  const baseA1 = parseFloat(getComputedStyle(editor).fontSize);
  const spanA1 = spanSizes(editor);
  check('A 基准按 1.1^3 放大', Math.abs(baseA1 - baseA0 * UP3) < 0.6, baseA0 + '->' + baseA1);
  const expA = spanA0.map(x => x * UP3);
  check('A 各 span 按同系数放大', spanA1.length === expA.length &&
    spanA1.every((v, i) => Math.abs(v - expA[i]) < 0.6), JSON.stringify(spanA0) + '->' + JSON.stringify(spanA1));
  check('A 两 span 大小仍不同', spanA1.length === 2 && (spanA1[1] - spanA1[0]) > 5, JSON.stringify(spanA1));
  check('A 颜色保留(red/blue)', /color:\s*red/.test(editor.innerHTML) && /color:\s*blue/.test(editor.innerHTML));
  check('A 字体保留(KaiTi)', /KaiTi/.test(editor.innerHTML));

  /* --- B: 单独选取文字，无限次放大（单调增大，不回落） --- */
  reset.click();
  editor.innerHTML = '前缀 <span style="font-size:40px;color:red">红大40目标</span> 后缀';
  const KEY = '红大40目标';
  const seq = [];
  let tn = firstTextWith(editor, KEY);
  check('B 初始文本节点找到', !!tn);
  for (let i = 0; i < 6; i++) {
    const cur = firstTextWith(editor, KEY);   // 点击前查找（模拟用户重新选中）
    if (!cur) { seq.push(NaN); continue; }
    setSel(cur, 0, cur, cur.textContent.length);
    bigger.click();
    const after = firstTextWith(editor, KEY);  // 点击后重新查找（extractContents 会替换文本节点对象）
    const sz = after && after.parentElement ? parseFloat(getComputedStyle(after.parentElement).fontSize) : NaN;
    seq.push(Math.round(sz * 100) / 100);
  }
  let mono = true;
  for (let i = 1; i < seq.length; i++) if (!(seq[i] > seq[i - 1])) mono = false;
  check('B 连续放大单调增大(可无限)', mono, JSON.stringify(seq));
  check('B 6 次后明显大于 40（×1.05^6≈53.6）', seq[seq.length - 1] > 40 * 1.3, JSON.stringify(seq));
  check('B 颜色保留(red)', /color:\s*red/.test(editor.innerHTML));

  /* --- C: 继承文本（无显式字号）放大，不丢失基准 --- */
  reset.click();
  editor.innerHTML = '普通文本需要放大';
  const nodeOf = () => { const tw = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null); let n; while ((n = tw.nextNode())) return n; return null; };
  const t0 = nodeOf();
  const c0 = t0 && t0.parentElement ? parseFloat(getComputedStyle(t0.parentElement).fontSize) : NaN;
  for (let i = 0; i < 2; i++) {
    const t = nodeOf();
    if (t) setSel(t, 0, t, t.textContent.length);
    bigger.click();
  }
  const t1 = nodeOf();
  const c1 = t1 && t1.parentElement ? parseFloat(getComputedStyle(t1.parentElement).fontSize) : NaN;
  check('C 继承文本放大 2 次 ≈ ×1.1025', Math.abs(c1 - c0 * (1.05 * 1.05)) < 0.8, c0 + '->' + c1);

  /* --- D: 缩小同样保留差异 --- */
  reset.click();
  editor.innerHTML = 'A <span style="font-size:50px;color:green">大50</span> B <span style="font-size:20px">小20</span>';
  setSel(editor, 0, editor, editor.childNodes.length);
  smaller.click(); smaller.click();
  const ds = spanSizes(editor);
  check('D 缩小后两 span 仍不同且各×0.907', ds.length === 2 &&
    Math.abs(ds[0] - 20 * DOWN2) < 0.5 && Math.abs(ds[1] - 50 * DOWN2) < 0.5 && ds[1] > ds[0] + 20,
    JSON.stringify(ds));

  /* --- F: UI（标题栏/工具栏/logo/色块/M 按钮）随整篇缩放联动 --- */
  reset.click();
  editor.innerHTML = 'UI 联动测试';
  const header = el.querySelector('.node-header');
  const tbBtn = el.querySelector('[data-cmd="bold"]') || el.querySelector('.tb-btn');
  const logo = el.querySelector('.logo-m');
  const swatch = el.querySelector('.swatch');
  const markBox = el.querySelector('.mark-box');
  const collapse = el.querySelector('.collapse');
  const hb = el.querySelector('.hb');
  const titleEl = el.querySelector('.node-title');
  const px = (elem, prop) => parseFloat(getComputedStyle(elem)[prop]);
  const UP = Math.pow(1.05, 3);

  const ui0 = {
    headerH: px(header, 'height'), tbH: px(tbBtn, 'height'), tbFs: px(tbBtn, 'fontSize'),
    logoFs: px(logo, 'fontSize'), swW: px(swatch, 'width'), markH: px(markBox, 'height')
  };
  check('F 基准：标题栏 68px（原 34 的 2 倍）', Math.abs(ui0.headerH - 68) < 1.5, String(ui0.headerH));
  check('F 基准：logo 24px / 色块 18px / M 按钮 50px',
    Math.abs(ui0.logoFs - 24) < 1.5 && Math.abs(ui0.swW - 18) < 1.5 && Math.abs(ui0.markH - 50) < 1.5,
    JSON.stringify(ui0));
  check('F 基准：标题栏内控件同步放大（折叠 48 / 头按钮 44 / 标题 22）',
    Math.abs(px(collapse, 'width') - 48) < 1.5 && Math.abs(px(hb, 'height') - 44) < 1.5 &&
    Math.abs(px(titleEl, 'fontSize') - 22) < 1.5,
    [px(collapse, 'width'), px(hb, 'height'), px(titleEl, 'fontSize')].join(' / '));
  check('F 基准：折叠箭头 svg 24px',
    Math.abs(px(collapse.querySelector('svg'), 'width') - 24) < 1.5,
    String(px(collapse.querySelector('svg'), 'width')));

  setSel(editor, 0, editor, editor.childNodes.length);
  bigger.click(); bigger.click(); bigger.click();
  // 栏体高度固定不变（否则工具栏下移，A⁺/A⁻ 就跟着漂），变化的是栏内控件尺寸
  check('F 放大后标题栏高度仍为 68px（栏体固定）', Math.abs(px(header, 'height') - 68) < 0.6,
    ui0.headerH + '->' + px(header, 'height'));
  check('F 放大后头按钮不超出栏高（min() 封顶）', px(hb, 'height') <= 52.5, String(px(hb, 'height')));
  check('F 放大后工具栏按钮 ×1.05^3',
    Math.abs(px(tbBtn, 'height') - 26 * UP) < 2 && Math.abs(px(tbBtn, 'fontSize') - 13 * UP) < 1.5,
    ui0.tbH + '->' + px(tbBtn, 'height'));
  check('F 放大后 logo ×1.05^3', Math.abs(px(logo, 'fontSize') - 24 * UP) < 2,
    ui0.logoFs + '->' + px(logo, 'fontSize'));
  check('F 放大后色块 ×1.05^3', Math.abs(px(swatch, 'width') - 18 * UP) < 2,
    ui0.swW + '->' + px(swatch, 'width'));
  check('F 放大后 M 按钮 ×1.05^3', Math.abs(px(markBox, 'height') - 50 * UP) < 2.5,
    ui0.markH + '->' + px(markBox, 'height'));

  setSel(editor, 0, editor, editor.childNodes.length);
  smaller.click(); smaller.click(); smaller.click();
  check('F 缩小后标题栏回到基准 68', Math.abs(px(header, 'height') - 68) < 1.5, String(px(header, 'height')));
  check('F 缩小后 M 按钮回到基准', Math.abs(px(markBox, 'height') - 50) < 1.5, String(px(markBox, 'height')));
  check('F 缩小后 logo 回到基准', Math.abs(px(logo, 'fontSize') - 24) < 1.5, String(px(logo, 'fontSize')));

  setSel(editor, 0, editor, editor.childNodes.length);
  bigger.click(); bigger.click(); bigger.click(); bigger.click();
  const beforeReset = px(tbBtn, 'height');
  reset.click();
  check('F 点"默认"后 UI 复位到基准', Math.abs(px(tbBtn, 'height') - 26) < 1.5,
    beforeReset + '->' + px(tbBtn, 'height'));

  setSel(editor, 0, editor, editor.childNodes.length);
  bigger.click();
  const uiSerialized = node.properties.marknote.uiScale;
  check('F uiScale 写入 properties', typeof uiSerialized === 'number' && uiSerialized > 1, String(uiSerialized));
  reset.click();

  /* --- E: 放大上限封顶（600px） --- */
  reset.click();
  editor.innerHTML = '放大上限测试';
  for (let i = 0; i < 160; i++) bigger.click();
  const capped = parseFloat(editor.style.fontSize);
  check('E 连续放大 160 次后封顶在 600px', !isNaN(capped) && Math.abs(capped - 600) < 0.001, String(capped));
  check('E 不会超过 600px', !(capped > 600), String(capped));
  // 从 26px 起步，放大到上限前的最后一步应接近上限而非突变
  const stepsToCap = Math.ceil(Math.log(600 / 26) / Math.log(1.05));
  check('E 封顶步数合理（约 65 步）', stepsToCap >= 62 && stepsToCap <= 68, String(stepsToCap));
  reset.click();

  /* --- G: A⁺/A⁻/默认 位置与尺寸恒定，缩放时鼠标不用移动 --- */
  editor.innerHTML = '位置固定测试';
  const groupScale = el.querySelector('.tb-scale');
  const btnUp = el.querySelector('[data-act="bigger"]');
  const UP12 = Math.pow(1.05, 12);
  check('G A⁺ 所在组已置顶（工具栏第一个元素）',
    !!groupScale && el.querySelector('.toolbar').firstElementChild === groupScale);
  const rectUp0 = btnUp.getBoundingClientRect();
  for (let i = 0; i < 12; i++) { setSel(editor, 0, editor, editor.childNodes.length); bigger.click(); }
  const rectUp1 = btnUp.getBoundingClientRect();
  check('G 放大 12 次后 A⁺ 左上角位置不变',
    Math.abs(rectUp1.left - rectUp0.left) < 1.5 && Math.abs(rectUp1.top - rectUp0.top) < 1.5,
    '(' + Math.round(rectUp0.left) + ',' + Math.round(rectUp0.top) + ')->(' +
    Math.round(rectUp1.left) + ',' + Math.round(rectUp1.top) + ')');
  check('G 放大后 A⁺ 按钮随同行按钮一起放大（×1.05^12）',
    Math.abs(px(btnUp, 'height') - 26 * UP12) < 2.5, String(px(btnUp, 'height')));
  check('G A⁺ 与其它工具栏按钮同步缩放', Math.abs(px(btnUp, 'height') - px(tbBtn, 'height')) < 1.5,
    px(btnUp, 'height') + ' vs ' + px(tbBtn, 'height'));
  reset.click();
  const rectUp2 = btnUp.getBoundingClientRect();
  check('G 复位后 A⁺ 位置仍不变', Math.abs(rectUp2.left - rectUp0.left) < 1.5,
    Math.round(rectUp0.left) + '->' + Math.round(rectUp2.left));
  check('G 复位后 A⁺ 尺寸回到 26px', Math.abs(px(btnUp, 'height') - 26) < 1.5, String(px(btnUp, 'height')));

  /* --- H: 行删除红叉随缩放变化 --- */
  editor.innerHTML = '行删除缩放测试';
  const wrapH = el.querySelector('.editor-wrap');
  const ctl = document.createElement('div');
  ctl.className = 'line-del-ctl';
  ctl.innerHTML = '<div class="line-del-track"><div class="fill"></div><div class="hint">删除</div></div>' +
                  '<div class="line-del-knob"><span>×</span></div>';
  wrapH.appendChild(ctl);
  const knob = ctl.querySelector('.line-del-knob');
  const knob0 = px(knob, 'width');
  check('H 行删除叉基准 18px', Math.abs(knob0 - 18) < 1.5, String(knob0));
  setSel(editor, 0, editor, editor.childNodes.length);
  bigger.click(); bigger.click(); bigger.click();
  check('H 放大后行删除叉 ×1.05^3', Math.abs(px(knob, 'width') - 18 * UP) < 2,
    knob0 + '->' + px(knob, 'width'));
  reset.click();
  check('H 复位后行删除叉回到 18px', Math.abs(px(knob, 'width') - 18) < 1.5, String(px(knob, 'width')));
  ctl.remove();

  /* --- I: 缩放后节点高度自动撑开以容纳全部内容 --- */
  editor.innerHTML = '自适应高度测试<br>第二行文本<br>第三行文本<br>第四行文本<br>第五行文本';
  setSel(editor, 0, editor, editor.childNodes.length);
  const hBefore = node.size[1];
  let grew = true, prevH = hBefore;
  for (let i = 0; i < 10; i++) {
    setSel(editor, 0, editor, editor.childNodes.length);
    bigger.click();
    if (!(node.size[1] >= prevH)) grew = false;
    prevH = node.size[1];
  }
  check('I 放大后节点高度被自动撑开', node.size[1] > hBefore, hBefore + '->' + node.size[1]);
  check('I 高度随每次放大单调不减', grew, String(node.size[1]));
  const hBig = node.size[1];
  for (let i = 0; i < 25; i++) { setSel(editor, 0, editor, editor.childNodes.length); smaller.click(); }
  check('I 缩小后节点高度回落（不残留空白）', node.size[1] < hBig, hBig + '->' + node.size[1]);
  check('I 高度不低于最小高度 150', node.size[1] >= 150, String(node.size[1]));
  reset.click();

  /* --- J: 点「默认」后节点宽、高都回到默认尺寸 --- */
  const wDefault = 760, hDefault = 520;
  node.size = [node.size[0] + 400, node.size[1] + 300];
  const wWide = node.size[0], hTall = node.size[1];
  check('J 手动拉宽后宽度大于默认', wWide > wDefault, String(wWide));
  reset.click();
  check('J 点默认后宽度回到默认 760', Math.abs(node.size[0] - wDefault) < 1.5,
    wWide + '->' + node.size[0]);
  check('J 点默认后高度回到默认 520', Math.abs(node.size[1] - hDefault) < 1.5,
    hTall + '->' + node.size[1]);
  node.size = [420, 200];
  reset.click();
  check('J 小于默认时点默认也回到 760×520',
    Math.abs(node.size[0] - wDefault) < 1.5 && Math.abs(node.size[1] - hDefault) < 1.5,
    '420x200->' + node.size[0] + 'x' + node.size[1]);

  /* --- K: A⁺ / A⁻ 时宽、高等比例一起变化 --- */
  editor.innerHTML = '等比缩放测试<br>第二行<br>第三行<br>第四行<br>第五行<br>第六行';
  setSel(editor, 0, editor, editor.childNodes.length);
  const k0 = [node.size[0], node.size[1]];
  const ratio0 = k0[0] / k0[1];
  // 先放大到装不下：宽、高应同步变大
  let kGrew = false;
  for (let i = 0; i < 12; i++) { setSel(editor, 0, editor, editor.childNodes.length); bigger.click(); }
  const k1 = [node.size[0], node.size[1]];
  if (k1[0] > k0[0] && k1[1] > k0[1]) kGrew = true;
  check('K 放大后宽、高同时变大', kGrew, k0.join('x') + '->' + k1.join('x'));
  check('K 放大后宽高比保持不变', Math.abs(k1[0] / k1[1] - ratio0) < 0.02,
    ratio0.toFixed(3) + '->' + (k1[0] / k1[1]).toFixed(3));
  // 再缩小：宽、高应同步变小
  for (let i = 0; i < 12; i++) { setSel(editor, 0, editor, editor.childNodes.length); smaller.click(); }
  const k2 = [node.size[0], node.size[1]];
  check('K 缩小后宽、高同时变小', k2[0] < k1[0] && k2[1] < k1[1], k1.join('x') + '->' + k2.join('x'));
  check('K 缩小后宽高比仍保持不变', Math.abs(k2[0] / k2[1] - ratio0) < 0.02,
    ratio0.toFixed(3) + '->' + (k2[0] / k2[1]).toFixed(3));
  reset.click();

  console.error = origErr;
  check('no console/page errors', errors.length === 0, errors.join(' || '));
  finish(errors);
}
function finish() {
  if (out) out.textContent = results.join('\n') + '\n\nDONE';
  document.title = 'TESTS_DONE';
}
run();
