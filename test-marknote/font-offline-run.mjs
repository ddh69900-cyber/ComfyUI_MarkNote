// 运行离线字体自检：
// 1) 从 web/marknote.js 真实抽取 FONT_BASE / FONT_FACE_LOCAL，生成 font-face-data.js
//    （测试页跑在浏览器里，不能用 node:fs，所以由这里代抽）
// 2) 起本地 http server，用无头 Chrome 打开 font-offline.html
// 3) 等页面把结果写进 #out 后解析 PASS/FAIL 行
// 关键：必须用 http:// 而非 file://，ES module import 在 file:// 下会被 CORS 拦。
import { createServer } from "node:http";
import { readFile, writeFile, rm } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 8791;
const DATA = join(ROOT, "font-face-data.js");

// ---- 1) 从 marknote.js 抽取真实声明 ----
const src = await readFile(join(ROOT, "ComfyUI_MarkNote", "web", "marknote.js"), "utf8");

const baseMatch = src.match(/const FONT_BASE = \(\(\) => \{[\s\S]*?return new URL\("(\.\/fonts\/)"/);
const faceMatch = src.match(/const FONT_FACE_LOCAL = `([\s\S]*?)`;/);
if (!baseMatch) { console.error("FAIL | 无法从 marknote.js 提取 FONT_BASE"); process.exit(1); }
if (!faceMatch) { console.error("FAIL | 无法从 marknote.js 提取 FONT_FACE_LOCAL"); process.exit(1); }

// 注意：marknote.js 里 FONT_FACE_LOCAL 是模板字符串，${FONT_BASE} 会在运行时被替换。
// 这里手工做同样的插值，并把路径改指向测试目录下的 web/fonts/（测试页在 test-marknote/ 根）。
const FONT_BASE = "./ComfyUI_MarkNote/web/fonts/";
const FONT_FACE_LOCAL = faceMatch[1].replace(/\$\{FONT_BASE\}/g, FONT_BASE);
if (/\$\{/.test(FONT_FACE_LOCAL)) {
  console.error("FAIL | FONT_FACE_LOCAL 仍有未插值的 ${...}：" + FONT_FACE_LOCAL);
  process.exit(1);
}

await writeFile(DATA,
  "// 由 font-offline-run.mjs 自动生成，勿手改。\n"
  + "export const FONT_BASE = " + JSON.stringify(FONT_BASE) + ";\n"
  + "export const FONT_FACE_LOCAL = " + JSON.stringify(FONT_FACE_LOCAL) + ";\n"
);
console.log("[gen] font-face-data.js  FONT_BASE=" + FONT_BASE
  + "  @font-face x" + (FONT_FACE_LOCAL.match(/@font-face/g) || []).length + "\n");

// ---- 2) 本地 server ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".png": "image/png"
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/font-offline.html";
    const abs = join(ROOT, normalize(p).replace(/^([/\\])+/, ""));
    const buf = await readFile(abs);
    res.writeHead(200, { "Content-Type": MIME[extname(abs)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found: " + req.url);
  }
});

await new Promise(r => server.listen(PORT, "127.0.0.1", r));
const url = "http://127.0.0.1:" + PORT + "/font-offline.html";
console.log("[serve] " + url + "\n");

// ---- 3) 无头 Chrome ----
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  "--virtual-time-budget=25000",
  "--dump-dom", url
], { stdio: ["ignore", "pipe", "pipe"] });

let out = "";
chrome.stdout.on("data", d => { out += d; });
await new Promise(r => chrome.on("close", r));
server.close();
await rm(DATA, { force: true });

// 解析 #out 里的 PASS/FAIL 行。
// 注意不能用非贪婪的 /<div id="out">([\s\S]*?)<\/div>/ —— 它会在第一个嵌套
// </div> 处截断。改为先切到 <div id="out" 的位置，再一直读到 <script。
const outStart = out.indexOf('<div id="out"');
const outEnd = out.indexOf("<script", outStart);
if (outStart < 0 || outEnd < 0) {
  console.log("未找到 #out —— 测试页没跑完。");
  console.log("--- dom 片段 ---\n" + out.slice(0, 2500));
  process.exit(1);
}
const body = out.slice(outStart, outEnd);
// 每个结果是一个独立 <div class="pass|fail">…</div>，逐个取出。
// 注意不能按行 split：Chrome 的 --dump-dom 输出会把多个 div 拼在同一行。
const rows = body.match(/<div class="(?:pass|fail)">([\s\S]*?)<\/div>/g) || [];
const lines = rows.map(r =>
  r.replace(/<[^>]+>/g, "")
   .replace(/&quot;/g, '"').replace(/&amp;/g, "&")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .trim()
);
for (const l of lines) console.log(l);

// 失败数以页面自报的 data-fail 为准（比在 Node 侧重数更可靠）。
const failAttr = body.match(/data-fail="(\d+)"/);
const totalAttr = body.match(/data-total="(\d+)"/);

if (!lines.length) {
  console.log("\n#out 里没有 PASS/FAIL 行 —— 脚本可能在 import 阶段就挂了。");
  console.log("--- dom 片段 ---\n" + body.slice(0, 2500));
  process.exit(1);
}
if (!failAttr) {
  console.log("\n#out 缺少 data-fail 属性 —— 测试可能没跑完。");
  process.exit(1);
}

const fail = Number(failAttr[1]);
const total = Number(totalAttr ? totalAttr[1] : lines.length);
console.log("\n总计 " + total + " 项，失败 " + fail + " 项");
console.log("FAIL count: " + fail);
console.log("DONE");
// 行数与自报总数不一致时也判失败，防止"漏统计"假通过
process.exit(fail === 0 && lines.length === total ? 0 : 1);
