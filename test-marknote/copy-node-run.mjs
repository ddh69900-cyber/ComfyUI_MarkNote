// 离线跑 copy-node-harness（CDP 方式）：
// 本地静态服务器 + headless Chrome + Runtime.evaluate 读取 #out
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8132;
const DP = 9229;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL0 = `http://127.0.0.1:${PORT}/copy-node.html`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/copy-node.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(normalize(ROOT))) { res.writeHead(403); res.end(); return; }
    const buf = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(PORT, r));

// 启动前自测：确认 harness 及其依赖能被服务器以正确 MIME 返回
for (const u of ['/copy-node.html', '/copy-node-harness.js', '/scripts/app.js', '/ComfyUI_MarkNote/web/marknote.js']) {
  try {
    const r = await fetch(URL0.replace('/copy-node.html', '') + u);
    console.error(`[serve] ${u} -> ${r.status} ${r.headers.get('content-type')}`);
  } catch (e) { console.error(`[serve] ${u} -> ERROR ${e.message}`); }
}

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${DP}`, `--user-data-dir=${ROOT}cdpprofile_copy`, '--window-size=1200,800'
], { stdio: 'ignore' });

let ws;
try {
  const WSk = globalThis.WebSocket;
  await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${DP}/json`); return r.ok; } catch (e) { return false; } }, 15000);
  const targets = await (await fetch(`http://127.0.0.1:${DP}/json`)).json();
  const pageT = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || targets.find(t => t.webSocketDebuggerUrl);
  ws = new WSk(pageT.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const cb = pending.get(m.id); pending.delete(m.id); cb(m); }
    if (m.method === 'Runtime.exceptionThrown') console.error('PAGE EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails).slice(0, 500));
    if (m.method === 'Runtime.consoleAPICalled') console.error('PAGE ' + m.params.type + ': ' + JSON.stringify(m.params.args.map(a => a.value || a.description)));
    if (m.method === 'Network.loadingFailed') console.error('NET FAIL: ' + JSON.stringify(m.params).slice(0, 200));
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, m => m.error ? rej(m.error) : res(m)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.navigate', { url: URL0 });

  const ready = await waitFor(async () => {
    const r = await send('Runtime.evaluate', { expression: '!!(window.__mnExt && document.getElementById("out"))' });
    return r.result && r.result.result && r.result.result.value === true;
  }, 30000);
  if (!ready) {
    const dbg = await send('Runtime.evaluate', { expression: 'JSON.stringify({ ext: !!window.__mnExt, out: (document.getElementById("out")||{}).textContent })' });
    console.error('extension/page not ready :: ' + ((dbg.result && dbg.result.result && dbg.result.result.value) || '?'));
  } else {
    await waitFor(async () => {
      const r = await send('Runtime.evaluate', { expression: 'document.getElementById("out").textContent' });
      const v = r.result && r.result.result && r.result.result.value || '';
      return /DONE/.test(v);
    }, 20000);
  }

  const r = await send('Runtime.evaluate', { expression: 'document.getElementById("out").textContent', returnByValue: true });
  const text = (r.result && r.result.result && r.result.result.value) || '(no #out)';
  console.log(text);
  const fails = (text.match(/^FAIL/gm) || []).length;
  console.log('\nFAIL count: ' + fails);
} catch (e) {
  console.error('runner error: ' + (e && e.message ? e.message : e));
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill('SIGKILL'); } catch (e) {}
  try { server.close(); } catch (e) {}
}

async function waitFor(fn, timeout = 20000, interval = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await fn()) return true; } catch (e) {} await sleep(interval); }
  return false;
}
