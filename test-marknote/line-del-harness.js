// 行删除回归测试：加载真实 marknote.js + mock app。
// 验证"视觉行删除"——自动换行（软换行）时只删光标所在这一视觉行，而非整段；
// 主动换行（块）同理只删当前视觉行；单行内容删后清空。
import { app } from './scripts/app.js';
import './ComfyUI_MarkNote/web/marknote.js';

const out = document.getElementById('out');
const results = [];
function check(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? (' :: ' + extra) : ''));
}

/* 同步化：让模块求值阶段即可跑完（与既有 harness 一致） */
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

function run() {
  const errors = [];
  window.addEventListener('error', e => errors.push('pageerror: ' + (e.message || e)));
  const origErr = console.error.bind(console);
  console.error = (...a) => { errors.push('console.error: ' + a.map(x => (x && x.message) || String(x)).join(' ')); };

  const ext = window.__mnExt;
  check('extension registered', !!ext);
  if (!ext) { finish(); return; }

  class FakeNodeType {}
  FakeNodeType.prototype.onNodeCreated = null;
  ext.beforeRegisterNodeDef(FakeNodeType, { name: 'MarkNote' }, app);
  const node = new FakeNodeType();
  node.properties = {}; node.pos = [40, 40]; node.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node);
  app.graph._nodes.push(node);

  const el = node._mnEl;
  if (el.parentNode !== document.body) document.body.appendChild(el);
  const editor = el.querySelector('.editor');
  check('node DOM created', !!el && !!editor);
  // 强制一个固定宽度，让长内容按视觉行软换行（与生产环境一致，只是宽度受控以便测试）
  el.style.width = '400px';
  editor.style.width = '360px';
  editor.style.maxWidth = '360px';
  editor.style.whiteSpace = 'normal';
  editor.style.wordBreak = 'break-all';
  editor.innerHTML = '';

  /* 在 editor 内放置光标到某文本节点的 offset，并触发 renderLineDelete 显示红叉 */
  function placeCaret(textNode, offset) {
    editor.focus();
    const r = document.createRange();
    r.setStart(textNode, offset);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  }
  /* 找到 .line-del-knob，模拟"按住向左拉满→松手"触发当前视觉行删除 */
  function dragDelete() {
    const knob = el.querySelector('.line-del-knob');
    if (!knob) return false;
    const rect = knob.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    knob.dispatchEvent(new MouseEvent('mousedown', { clientX: cx, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    for (let i = 20; i <= 140; i += 20) {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: cx - i, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    }
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: cx - 140, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    return true;
  }
  function lineCount(textNode) {
    const r = document.createRange();
    r.selectNodeContents(textNode);
    return r.getClientRects().length;
  }

  /* ---- T1：软换行段落，删中间那一行，其余行保留（核心修复） ---- */
  const FILL = 'x'.repeat(30);
  const text = 'AAAA' + FILL + 'BBBB' + FILL + 'CCCC';
  editor.innerHTML = text;
  const tn1 = editor.firstChild;          // 单一文本节点
  check('T1 段落软换行成多行', lineCount(tn1) >= 3, 'rects=' + lineCount(tn1));
  const offB = text.indexOf('BBBB') + 2;
  placeCaret(tn1, offB);
  const hadKnob1 = !!el.querySelector('.line-del-knob');
  check('T1 光标行出现红叉', hadKnob1);
  const ok1 = dragDelete();
  check('T1 触发删除', ok1);
  const t1After = editor.textContent;
  check('T1 中间行(BBBB)被删', t1After.indexOf('BBBB') < 0, t1After.slice(0, 80));
  check('T1 上行(AAAA)保留', t1After.indexOf('AAAA') >= 0, t1After.slice(0, 80));
  check('T1 下行(CCCC)保留', t1After.indexOf('CCCC') >= 0, t1After.slice(0, 80));
  check('T1 未整段清空', t1After.length > 0);

  /* ---- T2：软换行段落，删第一行，其余保留 ---- */
  editor.innerHTML = text;
  const tn2 = editor.firstChild;
  placeCaret(tn2, 2);   // AAAA 所在行
  const ok2 = dragDelete();
  check('T2 触发删除', ok2);
  const t2After = editor.textContent;
  check('T2 首行(AAAA)被删', t2After.indexOf('AAAA') < 0, t2After.slice(0, 80));
  check('T2 中行(BBBB)保留', t2After.indexOf('BBBB') >= 0, t2After.slice(0, 80));
  check('T2 尾行(CCCC)保留', t2After.indexOf('CCCC') >= 0, t2After.slice(0, 80));

  /* ---- T3：主动换行（两个块），删第一个块的当前行，第二个块保留（回归） ---- */
  editor.innerHTML = '<div>块一单行文本</div><div>块二单行文本</div>';
  const div1 = editor.children[0];
  const t3tn = div1.firstChild;
  placeCaret(t3tn, 2);
  const ok3 = dragDelete();
  check('T3 触发删除', ok3);
  const t3After = editor.textContent;
  check('T3 块一被删', t3After.indexOf('块一') < 0, t3After.replace(/\s/g, ''));
  check('T3 块二保留', t3After.indexOf('块二') >= 0, t3After.replace(/\s/g, ''));

  /* ---- T4：单行短内容，删除后清空（回到占位提示） ---- */
  editor.innerHTML = '只剩这一行';
  const t4tn = editor.firstChild;
  placeCaret(t4tn, 3);
  const ok4 = dragDelete();
  check('T4 触发删除', ok4);
  check('T4 删空', !editor.textContent.trim(), '[' + editor.textContent + ']');

  console.error = origErr;
  check('no console/page errors', errors.length === 0, errors.join(' || '));
  finish();
}
function finish() {
  if (out) out.textContent = results.join('\n') + '\n\nDONE';
  document.title = 'TESTS_DONE';
}
run();
