// 复制节点回归测试：加载真实 marknote.js + mock app，断言
// 点击「复制节点」后生成的副本：
// 1) 尺寸与源节点当前拉伸大小一致（而非默认 760x520）
// 2) 内容与源节点一致（标题 / 正文 / 彩色标记）
// 3) 节点外观配色随源节点复制
// 4) 落位前副本出现在源节点旁(+30,+30)
import { app } from './scripts/app.js';
import './ComfyUI_MarkNote/web/marknote.js';

const out = document.getElementById('out');
const results = [];
function check(name, cond, extra) {
  results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? (' :: ' + extra) : ''));
}

/* 同步化：与既有 harness 一致 */
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
  if (!ext) { finish(errors); return; }

  class FakeNodeType {}
  FakeNodeType.prototype.onNodeCreated = null;
  ext.beforeRegisterNodeDef(FakeNodeType, { name: 'MarkNote' }, app);

  // 覆盖 mock createNode：构建出真正带 _mnEl 的副本节点（跑 onNodeCreated）
  window.LiteGraph.createNode = (name) => {
    const n = new FakeNodeType();
    n.properties = {}; n.pos = [0, 0]; n.size = [760, 520];
    FakeNodeType.prototype.onNodeCreated.call(n);
    return n;
  };

  // 源节点
  const node = new FakeNodeType();
  node.properties = {}; node.pos = [100, 80]; node.size = [760, 520];
  FakeNodeType.prototype.onNodeCreated.call(node);
  app.graph._nodes.push(node);
  const el = node._mnEl;
  if (el.parentNode !== document.body) document.body.appendChild(el);
  const editor = el.querySelector('.editor');

  // 模拟用户把节点拉伸到 420x300，并设置配色与内容
  node.size = [420, 300];
  node.color = '#abcdef';
  node.bgcolor = '#123456';
  editor.innerHTML = '<b>标题</b> 正文内容 <span style="color:red">红色标记</span>';

  const copyBtn = el.querySelector('[data-act="copy"]');
  check('copy button found', !!copyBtn);

  const beforeCount = app.graph._nodes.length;
  copyBtn.click();   // 同步执行复制逻辑
  const afterCount = app.graph._nodes.length;
  check('复制后多出一个节点', afterCount === beforeCount + 1, beforeCount + '->' + afterCount);

  const copy = app.graph._nodes[app.graph._nodes.length - 1];
  check('副本 node.size 等于源节点(420x300)', copy.size[0] === 420 && copy.size[1] === 300, JSON.stringify(copy.size));
  check('副本 pos 在源节点旁(+30,+30)', copy.pos[0] === 130 && copy.pos[1] === 110, JSON.stringify(copy.pos));
  check('副本 color 复制', copy.color === '#abcdef', String(copy.color));
  check('副本 bgcolor 复制', copy.bgcolor === '#123456', String(copy.bgcolor));
  check('副本 properties.marknote 存在', !!(copy.properties && copy.properties.marknote), copy.properties ? JSON.stringify(Object.keys(copy.properties)) : 'no props');
  check('副本 marknote.html 含「标题」', copy.properties.marknote && copy.properties.marknote.html.indexOf('标题') >= 0);
  check('副本 marknote.html 含「红色标记」', copy.properties.marknote && copy.properties.marknote.html.indexOf('红色标记') >= 0);
  check('副本 marknote 记录了源节点尺寸形态(transparent/font等)', copy.properties.marknote && typeof copy.properties.marknote === 'object');

  if (copy._mnEl) {
    const ce = copy._mnEl.querySelector('.editor');
    check('副本 DOM 编辑器内容含「正文内容」', ce && ce.textContent.indexOf('正文内容') >= 0, ce ? ce.textContent.slice(0, 40) : 'no el');
    check('副本 DOM 编辑器含「红色标记」', ce && ce.textContent.indexOf('红色标记') >= 0);
  } else {
    check('副本 DOM 已构建(_mnEl 存在)', false, 'createNode mock 未构建 _mnEl');
  }

  console.error = origErr;
  check('no console/page errors', errors.length === 0, errors.join(' || '));
  finish(errors);
}
function finish() {
  if (out) out.textContent = results.join('\n') + '\n\nDONE';
  document.title = 'TESTS_DONE';
}
run();
