// 字体授权合规自检。
// OFL-1.1 第 2 条要求：随软件分发字体时，每份拷贝必须包含版权声明 + 许可证全文。
// 本脚本检查 3 件事：
//   1) web/fonts/LICENSE.txt 存在，且包含全部字体的版权声明与 OFL 全文关键段落
//   2) marknote.js 的 FONT_FACE_LOCAL 上方有人类可读的版权注释（OFL 允许的 header 形式）
//   3) 每个 @font-face 声明都能在 LICENSE.txt 里找到对应的版权条目（没有"漏声明的字体"）
// 用法：node test-marknote/font-license-check.cjs [包根目录]
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || path.join(__dirname, "..", "ComfyUI-MarkNote");
const FONT_DIR = path.join(ROOT, "web", "fonts");
const JS = path.join(ROOT, "web", "marknote.js");
const LICENSE = path.join(FONT_DIR, "LICENSE.txt");

let fail = 0;
function check(name, ok, detail) {
  if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + " | " + name + " :: " + detail);
}

// ---- 1) LICENSE.txt 存在且内容完整 ----
if (!fs.existsSync(LICENSE)) {
  check("LICENSE.txt 存在", false, "缺失：" + LICENSE + "（OFL 第 2 条要求必须随字体分发）");
  console.log("\nFAIL count: " + fail);
  process.exit(1);
}
const lic = fs.readFileSync(LICENSE, "utf8");
check("LICENSE.txt 存在", true, path.relative(ROOT, LICENSE) + " (" + lic.length + " 字节)");

// 每个字体的版权声明都要在
const COPYHOLDERS = [
  ["Liu Jian Mao Cao", /Copyright\s*2020\s*Liu Jian/i],
  ["Ma Shan Zheng", /Copyright\s*2017\s*The Ma Shan Zheng Project Authors/i],
  ["ZCOOL KuaiLe", /Copyright\s*2018\s*The ZCOOL KuaiLe Project Authors/i],
  ["Noto Serif SC", /Copyright\s*2012\s*Google Inc/i]
];
for (const [fam, re] of COPYHOLDERS) {
  check("LICENSE 含 " + fam + " 版权声明", re.test(lic),
    re.test(lic) ? "已声明" : "未找到版权声明");
}

// OFL 全文关键段落
const OFL_SECTIONS = [
  "SIL OPEN FONT LICENSE Version 1.1",
  "PREAMBLE",
  "DEFINITIONS",
  "PERMISSION & CONDITIONS",
  "TERMINATION",
  "DISCLAIMER"
];
for (const sec of OFL_SECTIONS) {
  check("LICENSE 含 OFL 段落「" + sec + "」", lic.indexOf(sec) >= 0,
    lic.indexOf(sec) >= 0 ? "有" : "缺");
}
// OFL 第 1、2 条的关键限制不能被删掉
check("LICENSE 保留 OFL 第1条（禁止单独售卖）", /may be sold by itself/i.test(lic), "");
check("LICENSE 保留 OFL 第2条（分发须附版权声明与许可）",
  /contains the above copyright notice and this license/i.test(lic), "");

// ---- 2) marknote.js 有人类可读的版权注释 ----
const js = fs.existsSync(JS) ? fs.readFileSync(JS, "utf8") : "";
if (!js) {
  check("marknote.js 存在", false, JS);
} else {
  check("marknote.js 存在", true, path.relative(ROOT, JS));
  const anchor = js.indexOf("const FONT_FACE_LOCAL");
  // 往前回看 2500 字符，注释块就在上方
  const header = anchor >= 0 ? js.slice(Math.max(0, anchor - 2500), anchor) : "";
  check("marknote.js 在 FONT_FACE_LOCAL 上方有版权注释（OFL human-readable header）",
    /Copyright\s*(2020|2017|2018|2012)/i.test(header),
    /Copyright\s*(2020|2017|2018|2012)/i.test(header) ? "已声明" : "缺少版权声明注释");
  check("marknote.js 注释提及 OFL", /OFL|Open Font License/i.test(header), "");
}

// ---- 3) 每个 @font-face 都有对应的版权条目（防止加了字体却忘写声明）----
const faces = Array.from(js.matchAll(/@font-face\s*\{[^}]*font-family:\s*"([^"]+)"/g)).map(m => m[1]);
check("marknote.js 声明了 4 个 @font-face", faces.length === 4, "-> " + faces.join(", "));
for (const fam of faces) {
  // 该字体的版权声明必须在 LICENSE.txt 里（用关键词匹配，宁可宽松也别漏）
  const key = fam.replace(/^Noto Serif SC$/, "Noto Serif SC");
  const inLic = lic.indexOf(key) >= 0 ||
    (key === "Noto Serif SC" && /Noto Serif SC/.test(lic)) ||
    (key === "Liu Jian Mao Cao" && /Liu Jian/i.test(lic)) ||
    (key === "Ma Shan Zheng" && /Ma Shan Zheng/i.test(lic)) ||
    (key === "ZCOOL KuaiLe" && /ZCOOL/i.test(lic));
  check("字体 " + fam + " 在 LICENSE 中有对应条目", inLic, inLic ? "有" : "缺失 —— 加了字体要同步补 LICENSE.txt");
}

// ---- 4) 反向检查：LICENSE 里提到但磁盘上没有的字体（残留）----
const onDisk = fs.readdirSync(FONT_DIR).filter(f => f.endsWith(".woff2")).sort();
check("磁盘上有 4 个 woff2", onDisk.length === 4, "-> " + onDisk.join(", "));
for (const [fam] of COPYHOLDERS) {
  const file = fam.toLowerCase().replace(/\s+/g, "-") + ".woff2";
  // zcool-kuaile / noto-serif-sc / ma-shan-zheng / liu-jian-mao-cao
  check("LICENSE 声明的 " + fam + " 文件存在", onDisk.indexOf(file) >= 0,
    onDisk.indexOf(file) >= 0 ? file : "期望 " + file);
}

console.log("\nFAIL count: " + fail);
console.log("DONE");
process.exit(fail === 0 ? 0 : 1);
