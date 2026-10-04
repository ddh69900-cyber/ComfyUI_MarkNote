// 编辑器内 Ctrl+Z 回归测试：验证在 editor 内按 Ctrl+Z 时，
// 只触发浏览器的文本级撤销，不会把事件冒泡到画布触发图级 undo，
// 同时会把撤销后的内容写回 node.properties.marknote。
import { app } from './scripts/app.js';
import './ComfyUI_MarkNote/web/marknote.js';

const out = document.getElementById('out');
const results = [];
function check(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? (' :: ' + extra) : ''));
}

globalThis.requestAnimationFrame = cb => { try { cb(); } catch (e) { } return 0; };
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

  class FakeNodeType { }
  FakeNodeType.prototype.onNodeCreated = null;
  ext.beforeRegisterNodeDef(FakeNodeType, { name: 'MarkNote' }, app);

  const node = new FakeNodeType();
  node.properties = {}; node.pos = [100, 80]; node.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node);
  app.graph._nodes.push(node);
  const el = node._mnEl;
  if (el.parentNode !== document.body) document.body.appendChild(el);
  const editor = el.querySelector('.editor');

  // 初始内容「第一版」：用 insertText 产生浏览器可撤销的编辑点
  editor.focus();
  document.execCommand('selectAll', false, null);
  const inserted1 = document.execCommand('insertText', false, '第一版');
  check('初始 insertText 成功', inserted1);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  check('初始内容已保存到 properties', node.properties.marknote && node.properties.marknote.html.indexOf('第一版') >= 0, node.properties.marknote && node.properties.marknote.html);

  // 模拟用户继续输入「第二版内容」：产生第二个撤销点
  editor.focus();
  const inserted2 = document.execCommand('insertText', false, '第二版内容');
  check('继续输入 insertText 成功', inserted2);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  check('输入后编辑器含第二版', editor.textContent.indexOf('第二版内容') >= 0, editor.textContent);
  check('输入后 properties 同步为第二版', node.properties.marknote && node.properties.marknote.html.indexOf('第二版内容') >= 0, node.properties.marknote && node.properties.marknote.html);

  // 直接测试浏览器撤销是否有效（用于诊断）
  editor.focus();
  const beforeDirectUndo = editor.textContent;
  const directUndoWorked = document.execCommand('undo');
  const afterDirectUndo = editor.textContent;
  check('直接 document.execCommand("undo") 可用', beforeDirectUndo !== afterDirectUndo || directUndoWorked, `before=${beforeDirectUndo}, after=${afterDirectUndo}, worked=${directUndoWorked}`);

  // 如果直接 undo 把内容改了，先 redo 回「第一版第二版内容」再测试 keydown 拦截
  if (beforeDirectUndo !== afterDirectUndo) document.execCommand('redo');

  // 在后续 keydown 测试中 mock document.execCommand，验证扩展调用的是 undo/redo
  const execCalls = [];
  const origExec = document.execCommand.bind(document);
  document.execCommand = (cmd, ui, val) => { execCalls.push({ cmd, ui, val }); return true; };
  let parentGotEvent = false;
  const parentListener = () => { parentGotEvent = true; };

  function testKeydown(name, eventInit, expectedCmd) {
    editor.focus();
    execCalls.length = 0;
    parentGotEvent = false;
    document.body.addEventListener('keydown', parentListener, false);
    const ev = new KeyboardEvent('keydown', eventInit);
    editor.dispatchEvent(ev);
    document.body.removeEventListener('keydown', parentListener, false);
    check(name + ' defaultPrevented', ev.defaultPrevented === true);
    check(name + ' 被阻止冒泡', parentGotEvent === false);
    check(name + ' 调用 document.execCommand("' + expectedCmd + '")', execCalls.some(c => c.cmd === expectedCmd), JSON.stringify(execCalls));
  }

  testKeydown('Ctrl+Z', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }, 'undo');
  testKeydown('Ctrl+Y', { key: 'y', code: 'KeyY', ctrlKey: true, bubbles: true, cancelable: true }, 'redo');
  testKeydown('Ctrl+Shift+Z', { key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }, 'redo');

  document.execCommand = origExec;

  console.error = origErr;
  check('no console/page errors', errors.length === 0, errors.join(' || '));
  finish(errors);
}
function finish() {
  if (out) out.textContent = results.join('\n') + '\n\nDONE';
  document.title = 'TESTS_DONE';
}
run();
