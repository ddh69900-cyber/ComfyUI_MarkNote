// Undo / 序列化回归测试：验证 onSerialize 深克隆 properties，
// 使 Ctrl+Z 只回退到上一步快照，不会把所有 MarkNote 节点重置成默认状态。
import { app } from './scripts/app.js';
import './ComfyUI_MarkNote/web/marknote.js';

const out = document.getElementById('out');
const results = [];
function check(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? (' :: ' + extra) : ''));
}

globalThis.requestAnimationFrame = cb => { try { cb(); } catch (e) {} return 0; };
globalThis.Image = class {
  set src(v) { this._src = v; if (this.onload) this.onload(); }
  get src() { return this._src; }
  get naturalWidth() { return 4; }
  get naturalHeight() { return 4; }
};
globalThis.FileReader = class {
  readAsDataURL() {
    this.result = 'data:image/png;base64,iVBORw0KGgoAAAASUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
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
  if (!ext) { finish(errors); return; }

  class FakeNodeType {}
  FakeNodeType.prototype.onNodeCreated = null;
  ext.beforeRegisterNodeDef(FakeNodeType, { name: 'MarkNote' }, app);

  // 源节点：初始内容「第一版」
  // 必须给 node.id：真实 ComfyUI 在 onNodeCreated 前已分配 id，
  // marknote.js 依赖 data-mn-id ↔ node.id 的对应关系做事件归属反查。
  // mock 里省略 id 会让两个节点的 data-mn-id 都是 "undefined"，
  // 导致 nodeOfEl 把 A 的 blur 事件算到 B 头上。
  const node = new FakeNodeType();
  node.id = 3;
  node.properties = {}; node.pos = [100, 80]; node.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node);
  app.graph._nodes.push(node);
  const el = node._mnEl;
  if (el.parentNode !== document.body) document.body.appendChild(el);
  const editor = el.querySelector('.editor');

  editor.innerHTML = '<b>第一版内容</b>';
  // 触发 save，把当前 DOM 写回 node.properties.marknote（真实交互在 editor blur 时保存）
  const saveBtn = () => {
    editor.dispatchEvent(new Event('blur', { bubbles: false }));
  };
  saveBtn();

  // 模拟 ComfyUI 创建 undo 快照：调用 onSerialize
  const snapshot1 = { last_id: 1, type: 'MarkNote', widgets_values: [], flags: {} };
  FakeNodeType.prototype.onSerialize.call(node, snapshot1);
  const mark1 = snapshot1.properties && snapshot1.properties.marknote;
  check('snapshot1 包含 marknote', !!mark1 && typeof mark1 === 'object');
  check('snapshot1 记录第一版 html', !!mark1 && mark1.html.indexOf('第一版内容') >= 0, mark1 && mark1.html);
  check('snapshot1 深克隆（与 node.properties 不是同一对象）', snapshot1.properties !== node.properties);
  check('snapshot1.marknote 深克隆（与 node.properties.marknote 不是同一对象）', mark1 !== node.properties.marknote);

  // 用户编辑为「第二版」
  editor.innerHTML = '<i>第二版内容</i>';
  saveBtn();
  check('node.properties 已更新为第二版', node.properties.marknote && node.properties.marknote.html.indexOf('第二版内容') >= 0);

  // 关键断言：snapshot1 不应因为 node.properties 被修改而跟着变
  check('snapshot1 仍保留第一版（未因共享引用被污染）', mark1 && mark1.html.indexOf('第一版内容') >= 0, mark1 && mark1.html);
  check('snapshot1 不会被第二版覆盖', !(mark1 && mark1.html.indexOf('第二版内容') >= 0), mark1 && mark1.html);

  // 模拟焦点在编辑器内时收到旧 undo 快照（如桌面版 keybinding 未拦截住），
  // 新逻辑应拒绝回退，保持当前编辑状态，避免节点变空/内容丢失。
  editor.focus();
  FakeNodeType.prototype.onConfigure.call(node, snapshot1);
  check('焦点在编辑器内时，旧 undo 快照不 revert', editor.innerHTML.indexOf('第二版内容') >= 0, editor.innerHTML);

  // 模拟焦点移出节点后执行图级 undo：此时应正常回退到第一版。
  // 把“最近编辑”窗口设成 0，模拟“已经过去很久/不是刚才的编辑上下文”。
  const outsideBtn = document.createElement('button');
  outsideBtn.id = 'mn-outside-btn';
  document.body.appendChild(outsideBtn);
  outsideBtn.focus();
  window.MN_RECENT_MS = 0;
  FakeNodeType.prototype.onConfigure.call(node, snapshot1);
  check('焦点在节点外时，onConfigure 回退到第一版', editor.innerHTML.indexOf('第一版内容') >= 0, editor.innerHTML);
  check('回退后没有残留第二版', editor.innerHTML.indexOf('第二版内容') < 0, editor.innerHTML);
  window.MN_RECENT_MS = 3000;

  // 再模拟一次 redo：创建 snapshot2，恢复到第二版
  const snapshot2 = { last_id: 2, type: 'MarkNote', widgets_values: [], flags: {} };
  editor.innerHTML = '<i>第二版内容</i>';
  saveBtn();
  FakeNodeType.prototype.onSerialize.call(node, snapshot2);
  outsideBtn.focus();
  FakeNodeType.prototype.onConfigure.call(node, snapshot1); // undo
  FakeNodeType.prototype.onConfigure.call(node, snapshot2); // redo
  check('redo 后恢复为第二版', editor.innerHTML.indexOf('第二版内容') >= 0, editor.innerHTML);

  // 模拟多个节点互不影响：创建第二个节点，分别序列化
  const node2 = new FakeNodeType();
  node2.id = 4;   // 同上：必须分配 id，否则事件归属反查会串节点
  node2.properties = {}; node2.pos = [200, 180]; node2.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node2);
  app.graph._nodes.push(node2);
  const el2 = node2._mnEl;
  if (el2.parentNode !== document.body) document.body.appendChild(el2);
  const ed2 = el2.querySelector('.editor');
  ed2.innerHTML = '节点B内容';
  ed2.dispatchEvent(new Event('blur', { bubbles: false }));

  const snapA = { last_id: 3, type: 'MarkNote' };
  const snapB = { last_id: 4, type: 'MarkNote' };
  FakeNodeType.prototype.onSerialize.call(node, snapA);
  FakeNodeType.prototype.onSerialize.call(node2, snapB);
  check('多节点快照互不污染：A 是当前 node 内容（第二版）', snapA.properties.marknote.html.indexOf('第二版内容') >= 0, snapA.properties.marknote.html);
  check('多节点快照互不污染：B 是节点B内容', snapB.properties.marknote.html.indexOf('节点B内容') >= 0, snapB.properties.marknote.html);
  check('多节点快照互不污染：A 与 B 内容不同', snapA.properties.marknote.html !== snapB.properties.marknote.html);

  console.error = origErr;
  check('no console/page errors', errors.length === 0, errors.join(' || '));
  finish(errors);
}
function finish() {
  if (out) out.textContent = results.join('\n') + '\n\nDONE';
  document.title = 'TESTS_DONE';
}
run();
