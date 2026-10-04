// 扫描 woff2 里是否嵌了版权/许可证元数据。
// woff2 头 12 字节后是变长 table directory，解析麻烦；
// 这里直接整文件按 latin1 扫字符串——woff2 里的 name 表是未压缩存储的，
// 版权声明和许可证全文如果存在一定能扫到。
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";
for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".woff2")).sort()) {
  const b = fs.readFileSync(path.join(dir, f));
  const s = b.toString("latin1");
  const copyright = /copyright/i.test(s);
  const ofl = /SIL OPEN FONT LICENSE|Open Font License|openfontlicense\.org/i.test(s);
  const licenseWord = /licen[cs]e/i.test(s);
  // 抓一段版权声明原文看看
  const m = s.match(/Copyright[^\x00]{0,120}/i);
  console.log(
    f.padEnd(30),
    "copyright:" + String(copyright).padEnd(5),
    "OFL:" + String(ofl).padEnd(5),
    "license-word:" + String(licenseWord).padEnd(5),
    "size:" + b.length
  );
  if (m) console.log("    -> " + m[0].replace(/[^\x20-\x7E]/g, " ").trim());
}
