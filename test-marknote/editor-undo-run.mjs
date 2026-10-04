import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8127;

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const rawPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  const safe = normalize(join(ROOT, rawPath === '/' ? 'editor-undo.html' : rawPath));
  if (!safe.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const data = await readFile(safe);
    res.writeHead(200, { 'Content-Type': mime[extname(safe).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) { res.writeHead(404); res.end('Not found'); }
});
server.listen(PORT);
await new Promise(r => setTimeout(r, 100));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = `C:/Users/ADMIN/WorkBuddy/mark note/test-marknote/cdpprofile_eu`;
const proc = spawn(CHROME, [`--headless=new`, `--disable-gpu`, `--no-sandbox`, `--remote-debugging-port=9223`, `--user-data-dir=${profile}`, `http://localhost:${PORT}`], { detached: true });

await new Promise(r => setTimeout(r, 1200));
let ws = null;
for (let i = 0; i < 30; i++) {
  try {
    const resp = await fetch('http://127.0.0.1:9223/json/list');
    const list = await resp.json();
    const page = list.find(x => x.url.includes(`localhost:${PORT}`));
    if (page && page.webSocketDebuggerUrl) { ws = page.webSocketDebuggerUrl; break; }
  } catch { }
  await new Promise(r => setTimeout(r, 200));
}
if (!ws) { console.error('Chrome not ready'); proc.kill(); server.close(); process.exit(1); }

const socket = new WebSocket(ws);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, { resolve, reject });
  socket.send(JSON.stringify({ id: i, method, params }));
});
socket.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
});
await new Promise(r => socket.addEventListener('open', r, { once: true }));

await send('Page.enable'); await send('Runtime.enable');

const waitFor = async (fn, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  return false;
};

const ready = await waitFor(async () => {
  const r = await send('Runtime.evaluate', { expression: '!!(window.__mnExt && document.title === "TESTS_DONE")' });
  return r.result && r.result.result && r.result.result.value === true;
}, 30000);

let out = 'not ready';
if (ready) {
  const r = await send('Runtime.evaluate', { expression: 'document.getElementById("out")?.textContent || "no out"' });
  out = r.result && r.result.result && r.result.result.value || 'empty';
} else {
  const r = await send('Runtime.evaluate', { expression: '(function(){ const o=document.getElementById("out"); return o ? o.textContent : "no out"; })()' });
  out = r.result && r.result.result && r.result.result.value || 'empty';
}
console.log(out);

socket.close();
proc.kill();
server.close();
process.exit(out.includes('FAIL') ? 1 : 0);
