/**
 * ComfyUI-MarkNote — 前端扩展
 *
 * 把 HTML 原型 (m-sticky-note.html) 的整套标注界面搬进 ComfyUI 节点：
 * 字体 / 字号 / 颜色 / 粗斜体 / 对齐 / 链接 / 分割线 / 图片 / 行删除 / Mark 定格模式 / 折叠 / 复制。
 *
 * 实现要点：
 *  - 挂载走 ComfyUI 官方 node.addDOMWidget()，由前端把 DOM 定位到节点内的
 *    [data-testid="node-inner-wrapper"]，随画布移动/缩放/折叠自动跟随。
 *    CSS 依赖 `.lg-node:has(.mn-node)` 这个 descendant 选择器，因此 .mn-node
 *    必须留在 .lg-node 内部，不能搬到画布覆盖层。
 *  - 节点拖拽/缩放最终写回 node.pos / node.size。注意新前端必须**整体赋值**
 *    （node.pos = [x,y]），就地改下标会绕过 setter 完全无效。
 *  - 所有状态存进 node.properties.marknote，随工作流保存；ComfyUI 自身的
 *    节点复制粘贴会自动带上。
 *
 * ⚠️ 改动「图级撤销（Ctrl+Z）共存」相关代码前，先读 README 里同名章节：
 *    那里的五层防御 + 元素重挂逻辑互相咬合，改一处容易连带塌灰。
 */

import { app } from "../../scripts/app.js";

const NODE_NAME = "MarkNote";

const MIN_W = 320, MIN_H = 150;
const DEFAULT_W = 760, DEFAULT_H = 520;   // 「默认」按钮把节点恢复到的尺寸
const IMG_LONG_EDGE = 200;   // 插入图片默认长边像素
const MAX_IMG_BYTES = 4 * 1024 * 1024;   // 单张图片上限 4MB（DataURL 会内联进工作流 JSON）
const BASE_SIZE = 26;
const MAX_SIZE = 600;   // 字号放大上限（px）

const FONTS = [
  ['"SimSun","宋体",serif', '宋体'],
  ['"KaiTi","楷体",serif', '楷书'],
  ['"Liu Jian Mao Cao","Ma Shan Zheng","STXingkai","KaiTi",cursive', '草书'],
  ['"SimHei","黑体",sans-serif', '黑体'],
  ['"LiSu","隶书",serif', '隶书'],
  ['"Microsoft YaHei","微软雅黑",sans-serif', '微软雅黑'],
  /* —— 内置本地 webfont（离线可用）——
     只保留 4 款最常用的，合计约 6.7MB；其余中文 webfont 已移除，
     需要的字体会回退到系统字体。删除字体时务必同步删掉这里的条目
     和下方 @font-face，否则下拉里会选出没装到的字体。 */
  ['"Liu Jian Mao Cao",cursive', '刘建毛草'],
  ['"Ma Shan Zheng",cursive', '马善政楷书'],
  ['"ZCOOL KuaiLe",sans-serif', '站酷快乐体'],
  ['"Noto Serif SC",serif', '思源宋体']
];
const SWATCHES = [
  ['#000000', '黑色（默认）'], ['#2d2d2d', '深灰'], ['#5b4fc4', '紫色'],
  ['#2f6fd0', '蓝色'], ['#1f9d6b', '绿色'], ['#c44569', '玫红'], ['#8a5a2b', '棕色'],
  ['transparent', '透明']
];

/* ============================ 样式 ============================ */
const CSS_ID = "marknote-style";
const CSS = `
.mn-node {
  width: 100%; height: 100%; position: relative;
  display: flex; flex-direction: column; overflow: hidden;
  background: #1e1e1e; border-radius: 8px;
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
}
/* 标题栏（原型样式） */
.mn-node .node-header {
  /* 栏体高度固定（68px = 原 34px 的 2 倍，便于拖拽）：随缩放变化的是栏内控件尺寸，
     栏本身不变高，否则工具栏会下移、A⁺/A⁻ 的位置会跟着漂，鼠标就得追着点。 */
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  height: 68px; padding: 0 14px; cursor: grab;
  background: #2a2a2a; border-bottom: 1px solid #3a3a3a; user-select: none;
}
.mn-node .node-header:active { cursor: grabbing; }
.mn-node .collapse {
  width: min(calc(48px * var(--mn-ui, 1)), 56px); height: min(calc(48px * var(--mn-ui, 1)), 56px);
  display: flex; align-items: center; justify-content: center;
  border-radius: calc(4px * var(--mn-ui, 1)); color: #ccc; cursor: pointer;
  visibility: visible !important;   /* ComfyUI 全局样式对 .collapse 设了 visibility:collapse，会藏掉箭头 */
}
.mn-node .collapse svg {
  display: block; transition: transform 0.15s ease;
  width: min(calc(24px * var(--mn-ui, 1)), 30px); height: min(calc(24px * var(--mn-ui, 1)), 30px);
}
.mn-node .collapse.is-collapsed svg { transform: rotate(-90deg); }
.mn-node .collapse:hover { background: #3a3a3a; }
.mn-node .node-title {
  font-size: min(calc(22px * var(--mn-ui, 1)), 28px); color: #e6e6e6; font-weight: 600;
}
.mn-node .header-actions { margin-left: auto; display: flex; gap: calc(8px * var(--mn-ui, 1)); }
.mn-node .hb {
  width: min(calc(44px * var(--mn-ui, 1)), 52px); height: min(calc(44px * var(--mn-ui, 1)), 52px);
  border: none; background: transparent; color: #bbb;
  border-radius: calc(4px * var(--mn-ui, 1)); cursor: pointer;
  font-size: min(calc(24px * var(--mn-ui, 1)), 28px); line-height: 1;
}
.mn-node .hb:hover { background: #3d3d3d; color: #fff; }
/* 右下角拉伸手柄 */
.mn-node .rz-se {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  cursor: nwse-resize; z-index: 30;
}
.mn-node .rz-se::after {
  content: ""; position: absolute; right: 3px; bottom: 3px;
  width: 8px; height: 8px;
  border-right: 2px solid #666; border-bottom: 2px solid #666;
  border-radius: 0 0 3px 0;
}
.mn-node .rz-se:hover::after { border-color: #aaa; }
/* 节点边缘拉伸条：白边框任意位置按住即可拉伸节点 */
.mn-node .mn-rz { position: absolute; z-index: 40; }
.mn-node .mn-rz[data-dir="n"]  { top: 0; left: 10px; right: 10px; height: 7px; cursor: ns-resize; }
.mn-node .mn-rz[data-dir="s"]  { bottom: 0; left: 10px; right: 10px; height: 7px; cursor: ns-resize; }
.mn-node .mn-rz[data-dir="e"]  { right: 0; top: 10px; bottom: 10px; width: 7px; cursor: ew-resize; }
.mn-node .mn-rz[data-dir="w"]  { left: 0; top: 10px; bottom: 10px; width: 7px; cursor: ew-resize; }
.mn-node .mn-rz[data-dir="ne"] { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.mn-node .mn-rz[data-dir="nw"] { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.mn-node .mn-rz[data-dir="se"] { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.mn-node .mn-rz[data-dir="sw"] { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.mn-node .toolbar {
  display: flex; align-items: center; gap: calc(6px * var(--mn-ui, 1)); flex-wrap: wrap; flex-shrink: 0;
  padding: 6px 10px;
  background: #232323; border-bottom: 1px solid #333;
}
.mn-node .tb-group { display: flex; gap: calc(4px * var(--mn-ui, 1)); align-items: center; }
/* A⁺/A⁻/默认：永远排在最左 —— 缩放时鼠标不需要跟着移动。
   order:-1 使其始终位于工具栏首位；align-self:flex-start 使其贴顶，
   这样工具栏因其它（或本组）按钮变大而增高时，本组左上角位置仍保持不动。
   尺寸与同行其它按钮一致地随 --mn-ui 缩放（继承 .tb-btn 的 calc 规则）。 */
.mn-node .toolbar .tb-scale { order: -1; align-self: flex-start; }
.mn-node .tb-sep { width: 1px; height: calc(20px * var(--mn-ui, 1)); background: #444; margin: 0 calc(2px * var(--mn-ui, 1)); }
.mn-node .tb-btn {
  min-width: calc(28px * var(--mn-ui, 1)); height: calc(26px * var(--mn-ui, 1));
  padding: 0 calc(6px * var(--mn-ui, 1)); border: 1px solid #444;
  border-radius: calc(5px * var(--mn-ui, 1));
  background: #2e2e2e; color: #ddd; font-size: calc(13px * var(--mn-ui, 1)); cursor: pointer; line-height: 1;
}
.mn-node .tb-btn:hover { background: #3a3a3a; color: #fff; }
.mn-node .tb-btn.active { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
.mn-node .font-select {
  height: calc(26px * var(--mn-ui, 1)); border: 1px solid #444;
  border-radius: calc(5px * var(--mn-ui, 1));
  background: #2e2e2e; color: #ddd; font-size: calc(12px * var(--mn-ui, 1));
  padding: 0 calc(4px * var(--mn-ui, 1)); cursor: pointer;
}
.mn-node .color-a {
  background: linear-gradient(135deg,#ff5f6d,#ffc371,#7bed9f,#70a1ff);
  color: #111; font-weight: 800;
}
/* 编辑区 */
.mn-node .editor-wrap { position: relative; flex: 1; overflow-y: auto; background: #000; min-height: 0; }
.mn-node .editor {
  padding: 22px 26px; min-height: 100%; outline: none;
  font-family: "SimSun","宋体",serif; font-size: 26px; line-height: 1.7;
  color: #fff; word-break: break-word; white-space: pre-wrap; caret-color: #fff;
}
.mn-node .editor[data-empty="true"]::before {
  content: attr(data-placeholder); color: rgba(255,255,255,0.35); pointer-events: none;
}
.mn-node .editor a { color: #6fb7ff; text-decoration: underline; cursor: pointer; }
.mn-node .editor hr { border: none; border-top: 2px solid rgba(255,255,255,0.45); margin: 14px 0; }
.mn-node .note-img {
  position: absolute; max-width: 80%; height: auto; margin: 0;
  border-radius: 6px; cursor: grab; z-index: 2;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
}
.mn-node .note-img.dragging { opacity: 0.7; }
/* 行删除：光标所在行只显示一个红圆叉；按住即可展开并同时拖动，拉满才删除整行 */
.mn-node .line-del-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.mn-node .line-del-ctl {
  position: absolute; right: calc(12px * var(--mn-ui, 1));
  width: calc(22px * var(--mn-ui, 1)); height: calc(22px * var(--mn-ui, 1));
  pointer-events: auto; user-select: none;
}
.mn-node .line-del-ctl .line-del-track {
  position: absolute; right: calc(2px * var(--mn-ui, 1)); top: calc(2px * var(--mn-ui, 1));
  width: calc(18px * var(--mn-ui, 1)); height: calc(18px * var(--mn-ui, 1));
  border-radius: calc(9px * var(--mn-ui, 1)); background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,90,90,0.45); overflow: hidden;
  opacity: 0;
  transition: width 0.22s cubic-bezier(0.22,1.12,0.36,1), opacity 0.16s ease,
              background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.mn-node .line-del-ctl.open { width: calc(98px * var(--mn-ui, 1)); }
.mn-node .line-del-ctl.open .line-del-track { width: calc(96px * var(--mn-ui, 1)); opacity: 1; }
.mn-node .line-del-ctl.armed .line-del-track {
  border-color: #ff1744; background: rgba(72,4,12,0.62);
  box-shadow: 0 0 10px rgba(255,23,68,0.55), inset 0 0 8px rgba(255,23,68,0.35);
}
.mn-node .line-del-ctl .fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: calc(94px * var(--mn-ui, 1));
  transform-origin: left center; transform: scaleX(0);
  background: linear-gradient(90deg, #ff5252, #ff8a80); pointer-events: none;
}
.mn-node .line-del-ctl.armed .fill { background: linear-gradient(90deg, #ff1744, #ff5252); }
.mn-node .line-del-ctl .hint {
  position: absolute; left: calc(10px * var(--mn-ui, 1)); top: 0;
  height: calc(18px * var(--mn-ui, 1)); line-height: calc(18px * var(--mn-ui, 1));
  font-size: calc(11px * var(--mn-ui, 1)); color: rgba(255,255,255,0.75); letter-spacing: 1px;
  white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity 0.18s ease;
}
.mn-node .line-del-ctl.open .hint { opacity: 1; }
.mn-node .line-del-ctl.armed .hint { left: auto; right: calc(8px * var(--mn-ui, 1)); color: #fff; font-weight: 700; }
.mn-node .line-del-knob {
  position: absolute; top: calc(2px * var(--mn-ui, 1)); right: calc(2px * var(--mn-ui, 1));
  width: calc(18px * var(--mn-ui, 1)); height: calc(18px * var(--mn-ui, 1));
  border-radius: 50%; background: #e53935; color: #fff;
  font-size: calc(13px * var(--mn-ui, 1)); cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  will-change: transform; display: flex; align-items: center; justify-content: center; line-height: 1;
  transition: transform 0.24s cubic-bezier(0.22,1.12,0.36,1),
              background 0.18s ease, box-shadow 0.18s ease;
}
.mn-node .line-del-knob > span { display: block; transform: translateY(-1px); }
.mn-node .line-del-ctl.open .line-del-knob { cursor: grab; }
.mn-node .line-del-knob:active { cursor: grabbing; }
.mn-node .line-del-ctl.armed .line-del-knob {
  background: #ff1744; animation: ldPulse 0.9s ease-in-out infinite;
}
@keyframes ldPulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(255,23,68,0.30), 0 2px 8px rgba(0,0,0,0.5); }
  50%      { box-shadow: 0 0 0 9px rgba(255,23,68,0.06), 0 2px 8px rgba(0,0,0,0.5); }
}
.mn-node .line-del-track.snap { animation: ldSnap 0.3s ease-out; }
@keyframes ldSnap {
  0% { transform: translateX(0); } 35% { transform: translateX(-3px); }
  70% { transform: translateX(2px); } 100% { transform: translateX(0); }
}
.mn-node.mark-mode .line-del-layer { display: none; }
/* 图片删除红叉：点击图片后出现在其右上角 */
.mn-node .img-del-x {
  position: absolute; width: 20px; height: 20px; border-radius: 50%;
  background: #e53935; color: #fff; font-size: 14px;
  cursor: pointer; z-index: 50; border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,0.5); user-select: none; transition: transform 0.12s;
  display: flex; align-items: center; justify-content: center; line-height: 1;
}
.mn-node .img-del-x > span { display: block; transform: translateY(-1px); }
.mn-node .img-del-x:hover { background: #ff1744; transform: scale(1.12); }
/* 新前端 (Vue 节点组件) 专用清理：
   - .bg-component-node-widget-background：Vue 渲染的节点徽章行（左下角 "#id MarkNote"）底色，整行隐藏
   - .border-component-node-border：Vue 渲染的节点根边框叠层（透明模式白边来源）
   - div[role="button"]：Vue 原生四角缩放手柄（与我们的边缘拉伸条冲突，隐藏）
   - .lg-node-header：Vue 原生标题栏（"⌄ Mark Note"，透明模式下会透出来）——
     我们有自己的 DOM 标题栏，非折叠态一律隐藏；折叠态（data-collapsed）保留原生折叠条 */
.lg-node:has(.mn-node) .bg-component-node-widget-background { display: none !important; }
.lg-node:has(.mn-node) > .border-component-node-border { display: none !important; }
.lg-node:has(.mn-node) > div[role="button"] { display: none !important; }
.lg-node:not([data-collapsed]):has(.mn-node) .lg-node-header { display: none !important; }
/* 让我们的 DOM 精确铺满整个节点矩形（含原标题区），选中白边框才能与内框贴合：
   inner-wrapper 设为定位基准，.mn-node 绝对定位 inset:0 盖满全节点 */
.lg-node:has(.mn-node) [data-testid="node-inner-wrapper"] { position: relative; }
.lg-node:has(.mn-node) .mn-node { position: absolute; inset: 0; margin: 0 !important; }
/* 选中态：蓝色描边 + 右下角缩放手柄 */
.mn-node .note-img.selected { outline: 2px solid #6fb7ff; outline-offset: 1px; }
.mn-node .img-resize {
  position: absolute; box-sizing: border-box; width: 14px; height: 14px;
  background: #fff; border: 2px solid #6fb7ff; border-radius: 3px;
  cursor: nwse-resize; z-index: 50; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  transition: background 0.12s;
}
.mn-node .img-resize:hover { background: #6fb7ff; }
.mn-node.mark-mode .note-img { cursor: default; }
.mn-node.mark-mode .note-img.selected { outline: none; }
/* 底栏 */
.mn-node .node-footer {
  position: relative; flex-shrink: 0; display: flex; align-items: center; gap: calc(10px * var(--mn-ui, 1));
  padding: 6px 10px;
  background: #232323; border-top: 1px solid #333;
}
.mn-node .logo-m {
  color: #fff; font-size: calc(24px * var(--mn-ui, 1)); font-weight: 800;
  font-family: Georgia, serif; line-height: 1;
}
.mn-node .color-row { display: flex; gap: calc(5px * var(--mn-ui, 1)); }
.mn-node .swatch {
  width: calc(18px * var(--mn-ui, 1)); height: calc(18px * var(--mn-ui, 1));
  border-radius: calc(4px * var(--mn-ui, 1)); border: 1px solid #555; cursor: pointer;
}
.mn-node .swatch.active { outline: 2px solid #fff; outline-offset: 1px; }
.mn-node .swatch.transparent {
  background:
    linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),
    linear-gradient(45deg,#888 25%,#555 25%,#555 75%,#888 75%);
  background-size: calc(8px * var(--mn-ui, 1)) calc(8px * var(--mn-ui, 1));
  background-position: 0 0, calc(4px * var(--mn-ui, 1)) calc(4px * var(--mn-ui, 1));
}
.mn-node .footer-right { margin-left: auto; display: flex; }
.mn-node .mark-box {
  min-width: calc(66px * var(--mn-ui, 1)); height: calc(50px * var(--mn-ui, 1));
  padding: 0 calc(16px * var(--mn-ui, 1)); line-height: 1;
  font-size: calc(30px * var(--mn-ui, 1)); font-weight: 800;
  font-family: Georgia, serif; color: #37e07a; border: calc(2px * var(--mn-ui, 1)) solid #37e07a;
  border-radius: calc(10px * var(--mn-ui, 1));
  background: transparent; cursor: pointer;
}
.mn-node .mark-box.active { background: #37e07a; color: #06210f; }
/* 折叠：只剩标题栏 */
.mn-node.collapsed .toolbar,
.mn-node.collapsed .editor-wrap,
.mn-node.collapsed .node-footer,
.mn-node.collapsed .rz-se,
.mn-node.collapsed .mn-rz { display: none; }
/* Mark 模式：只留文本 */
.mn-node.mark-mode .node-header,
.mn-node.mark-mode .toolbar,
.mn-node.mark-mode .node-footer,
.mn-node.mark-mode .rz-se,
.mn-node.mark-mode .line-del-layer { display: none; }
/* Mark 模式不显示滚动条：锁定节点高度后（见 pinMarkHeightForNode），
   超长文本直接裁切，不出滚动条。 */
.mn-node.mark-mode .editor-wrap { overflow: hidden; }
.mn-node.mark-mode .editor { overflow: hidden; cursor: default; }
.mn-node.mn-transparent { background: transparent; border-color: transparent; box-shadow: none; }
/* 复制落位：半透明副本跟随鼠标 */
.mn-node.mn-ghost { opacity: 0.25; cursor: crosshair; pointer-events: none; }
/* 共用弹窗 */
#mnColorPop {
  position: fixed; z-index: 2000; display: none; width: 176px; padding: 8px;
  background: #262626; border: 1px solid #4a4a4a; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.6);
}
#mnColorPop.show { display: block; }
#mnColorPop .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
#mnColorPop .c { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #555; cursor: pointer; }
#mnColorPop .custom { margin-top: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #bbb; }
#mnColorPop .custom input { width: 46px; height: 24px; border: 1px solid #555; background: #1e1e1e; border-radius: 4px; }
#mnLinkMask {
  position: fixed; inset: 0; z-index: 2100; display: none;
  background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
}
#mnLinkMask.show { display: flex; }
#mnLinkMask .box {
  width: 340px; padding: 16px; background: #262626; border: 1px solid #4a4a4a;
  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
}
#mnLinkMask h4 { margin: 0 0 10px; font-size: 14px; color: #eee; }
#mnLinkMask input {
  width: 100%; height: 32px; margin-bottom: 8px; padding: 0 8px; box-sizing: border-box;
  background: #1a1a1a; border: 1px solid #4a4a4a; color: #eee; border-radius: 5px;
}
#mnLinkMask .row { display: flex; gap: 8px; justify-content: flex-end; }
#mnLinkMask button {
  height: 30px; padding: 0 14px; border-radius: 5px; border: 1px solid #555;
  background: #333; color: #eee; cursor: pointer;
}
#mnLinkMask button.ok { background: #6c5ce7; border-color: #6c5ce7; color: #fff; }
`;

/* 本地内置字体目录（随扩展一起分发，离线可用）。
   用 import.meta.url 推导，避免硬编码扩展名（用户可任意重命名 custom_nodes 下的目录）。 */
const FONT_BASE = (() => {
  try { return new URL("./fonts/", import.meta.url).href; } catch (e) { return "./fonts/"; }
})();
/* 离线字体：随扩展分发到 web/fonts/，断网也能用。
   每个字体一个完整中文 woff2（内含拉丁字形），不依赖网络字体。
   ⚠️ 这里声明的字体必须与 web/fonts/ 下实际存在的文件一一对应，
      也必须与上方 FONTS 里的条目一致；删字体时三处要同步改，
      否则下拉里会选出没装到的字体（浏览器静默回退，用户看不出异常）。

   ── 授权（重要）────────────────────────────────────────────────
   下面 4 个字体均为 SIL Open Font License 1.1 (OFL-1.1) 授权的未修改原版：
     Liu Jian Mao Cao   Copyright 2020 Liu Jian
     Ma Shan Zheng      Copyright 2017 The Ma Shan Zheng Project Authors
     ZCOOL KuaiLe       Copyright 2018 The ZCOOL KuaiLe Project Authors (站酷)
     Noto Serif SC      Copyright 2012 Google Inc.
   OFL 允许商用、嵌入、随软件打包分发，但要求分发时附带版权声明与许可证
   全文。原始 woff2 的 name 表不含许可证正文，所以该义务由
   web/fonts/LICENSE.txt 履行（内含上述版权声明 + OFL 1.1 全文）。
   本注释同时充当 OFL 第 2 条允许的 "human-readable header"。
   完整条款见 web/fonts/LICENSE.txt 与 https://openfontlicense.org
   ─────────────────────────────────────────────────────────────── */
const FONT_FACE_LOCAL = `
@font-face { font-family: "Liu Jian Mao Cao"; font-style: normal; font-weight: 400; font-display: swap; src: url("${FONT_BASE}liu-jian-mao-cao.woff2") format("woff2"); }
@font-face { font-family: "Ma Shan Zheng"; font-style: normal; font-weight: 400; font-display: swap; src: url("${FONT_BASE}ma-shan-zheng.woff2") format("woff2"); }
@font-face { font-family: "ZCOOL KuaiLe"; font-style: normal; font-weight: 400; font-display: swap; src: url("${FONT_BASE}zcool-kuaile.woff2") format("woff2"); }
@font-face { font-family: "Noto Serif SC"; font-style: normal; font-weight: 400; font-display: swap; src: url("${FONT_BASE}noto-serif-sc.woff2") format("woff2"); }
`;

/* ============================ 全局：样式 / 弹窗 / 文件选择 ============================ */
function ensureGlobalDom() {
  if (!document.getElementById(CSS_ID)) {
    const st = document.createElement("style");
    st.id = CSS_ID;
    /* 先声明本地内置字体（离线秒开），再放通用样式 */
    st.textContent = FONT_FACE_LOCAL + CSS;
    document.head.appendChild(st);
  }
  /* 内置中文 webfont 见上方 FONT_FACE_LOCAL，完全离线，不请求任何网络字体。 */
  if (!document.getElementById("mnColorPop")) {
    const pop = document.createElement("div");
    pop.id = "mnColorPop";
    pop.innerHTML =
      '<div class="grid">' +
      ['#ffffff', '#ff5f6d', '#ffc371', '#7bed9f', '#70a1ff', '#c56cf0',
        '#2d2d2d', '#ff3b3b', '#ffa502', '#1f9d6b', '#2f6fd0', '#5b4fc4',
        '#000000', '#c44569', '#8a5a2b', '#a4b0be', '#57606f', '#e2b8a2']
        .map(c => `<div class="c" data-color="${c}" style="background:${c}"></div>`).join('') +
      '</div>' +
      '<div class="custom"><span>自定义</span><input type="color" id="mnCustomColor" value="#ffffff"></div>';
    document.body.appendChild(pop);
    pop.querySelectorAll(".c").forEach(c => c.addEventListener("mousedown", e => e.preventDefault()));
  }
  if (!document.getElementById("mnLinkMask")) {
    const mask = document.createElement("div");
    mask.id = "mnLinkMask";
    mask.innerHTML =
      '<div class="box">' +
      "<h4>插入链接</h4>" +
      '<input id="mnLinkUrl" placeholder="网址，如 https://example.com">' +
      '<input id="mnLinkText" placeholder="显示文字">' +
      '<div class="row"><button data-act="cancel">取消</button><button class="ok" data-act="ok">插入</button></div>' +
      "</div>";
    document.body.appendChild(mask);
  }
  if (!document.getElementById("mnImgFile")) {
    const f = document.createElement("input");
    f.type = "file";
    f.id = "mnImgFile";
    f.accept = "image/*";
    f.style.display = "none";
    document.body.appendChild(f);
  }
}

const scaleOf = () => (app && app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1;
function nodeOfEl(el) {
  if (!el || !app.graph || !app.graph._nodes) return null;
  const hit = app.graph._nodes.find(n => n._mnEl === el);
  if (hit) return hit;
  /* 回退：_mnEl 可能因 Vue 重建而失配（此时 ensureLiveMnEl / observer
     还没来得及纠正），用 DOM 上的 data-mn-id 反查所属节点。
     没有这一步，nodeOfEl 返回 null 会让 blur/save 静默丢弃内容。
     ⚠️ 必须要求 id 唯一匹配：节点 id 未分配时 data-mn-id 会是 "undefined"，
     多节点会一起命中，此时不能回退，否则会把 A 的事件算到 B 头上。 */
  const id = el.dataset && el.dataset.mnId;
  if (id != null && id !== "undefined") {
    const byId = app.graph._nodes.find(n => n.type === NODE_NAME && String(n.id) === id);
    if (byId) {
      byId._mnEl = el;
      return byId;
    }
  }
  return null;
}

/* ============================ 节点 DOM 模板 ============================ */
function nodeMarkup() {
  const sw = SWATCHES
    .map(s => `<div class="swatch${s[0] === "transparent" ? " transparent" : ""}" data-color="${s[0]}" style="${s[0] === "transparent" ? "" : "background:" + s[0] + ";"}" title="${s[1]}"></div>`)
    .join("");
  const fo = FONTS.map(f => `<option value="${f[0].replace(/"/g, "&quot;")}">${f[1]}</option>`).join("");
  const rz = `<div class="rz rz-se" title="拉伸大小"></div>` +
    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(d => `<div class="mn-rz" data-dir="${d}"></div>`).join("");
  return `
    <div class="node-header">
      <span class="collapse" title="折叠/展开"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      <span class="node-title">Mark Note</span>
      <span class="header-actions">
        <button class="hb" data-act="copy" title="复制节点">📋</button>
        <button class="hb" data-act="del" title="删除节点">✕</button>
      </span>
    </div>
    <div class="toolbar">
      <div class="tb-group tb-scale">
        <button class="tb-btn" data-act="bigger" title="放大">A⁺</button>
        <button class="tb-btn" data-act="smaller" title="缩小">A⁻</button>
        <button class="tb-btn" data-act="resetSize" title="默认字号">默认</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group"><select class="font-select" data-role="font">${fo}</select></div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="tb-btn" data-cmd="bold" title="加粗"><b>B</b></button>
        <button class="tb-btn" data-cmd="italic" title="斜体"><i>I</i></button>
        <button class="tb-btn" data-cmd="underline" title="下划线"><u>U</u></button>
        <button class="tb-btn" data-cmd="strikeThrough" title="删除线"><s>S</s></button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="tb-btn" data-cmd="justifyLeft" title="靠左">⇤</button>
        <button class="tb-btn" data-cmd="justifyCenter" title="居中">↔</button>
        <button class="tb-btn" data-cmd="justifyRight" title="靠右">⇥</button>
      </div>
      <div class="tb-sep"></div>
      <div class="tb-group">
        <button class="tb-btn color-a" data-act="textcolor" title="文字颜色">A</button>
        <button class="tb-btn" data-act="link" title="插入链接">🔗</button>
        <button class="tb-btn" data-act="hr" title="分割线">—</button>
        <button class="tb-btn" data-act="image" title="插入图片">🖼</button>
      </div>
      <div class="tb-group" style="margin-left:auto;">
        <button class="tb-btn" data-act="copytext" title="复制纯文本">⧉</button>
        <button class="tb-btn" data-act="clear" title="清空内容">🗑</button>
      </div>
    </div>
    <div class="editor-wrap">
      <div class="editor" contenteditable="true" spellcheck="false" data-empty="true" data-placeholder="在此输入标注内容…"></div>
    </div>
    <div class="node-footer">
      <div class="logo-m" title="Mark Note">M</div>
      <div class="color-row" title="背景颜色（默认黑）">${sw}</div>
      <div class="footer-right">
        <button class="mark-box" data-act="preview" title="Mark 模式：仅显示文本，双击文字返回编辑">M</button>
      </div>
    </div>
    ${rz}
  `;
}

/* ============================ 默认状态 / 序列化 ============================ */
function defaultState() {
  return {
    html: '欢迎使用<span style="font-family:&quot;Liu Jian Mao Cao&quot;,&quot;Ma Shan Zheng&quot;,&quot;STXingkai&quot;,&quot;KaiTi&quot;,cursive;">Mark Note</span>！',
    fontFamily: '"SimSun","宋体",serif',
    fontSize: "26px",
    textColor: "#ffffff",
    bg: "#000000",
    transparent: false,
    markMode: false,
    markFullH: null,
    uiScale: 1,
    seq: 0
  };
}

/* UI（标题栏 / 工具栏 / 左下 logo / 背景色块 / 右下 M 按钮）随字号同步缩放。
   通过 CSS 变量 --mn-ui 驱动，所有相关尺寸写成 calc(基准px * var(--mn-ui))。 */
/* 栏体高度固定，控件最大放到 2.5 倍即可（再大就会溢出栏体） */
const MIN_UI = 0.6, MAX_UI = 2.5;
function getUiScale(el) {
  const v = parseFloat(el.style.getPropertyValue("--mn-ui"));
  return isNaN(v) ? 1 : v;
}
function setUiScale(el, v) {
  el.style.setProperty("--mn-ui", String(Math.max(MIN_UI, Math.min(MAX_UI, v))));
}

function serializeState(el, node) {
  node = node || nodeOfEl(el);
  const editor = el.querySelector(".editor");
  const wrap = el.querySelector(".editor-wrap");
  let bg = wrap.style.background || "#000000";
  if (/^rgba/.test(bg)) bg = "#000000";
  const markMode = el.classList.contains("mark-mode");
  return {
    html: editor.innerHTML,
    fontFamily: editor.style.fontFamily || "",
    fontSize: editor.style.fontSize || "",
    textColor: editor.style.color || "#ffffff",
    bg: bg,
    transparent: el.classList.contains("mn-transparent"),
    markMode: markMode,
    markFullH: markMode ? ((node && node._mnMark && node._mnMark.h) || null) : null,
    uiScale: getUiScale(el),
    seq: (node && typeof node._mnSeq === "number") ? node._mnSeq : 0
  };
}

/* 从 _mnState 恢复当前状态（仅内容与 UI/Mark 模式），
   用于图级 undo/redo 试图回退 MarkNote 节点时，强制保持当前编辑状态。
   几何（大小/位置）与折叠状态保持当前，让图级 undo 仍能回退节点的
   移动/缩放，但不会再把内容/折叠/Mark 模式回退到旧快照。 */
function restoreCurrentState(node) {
  if (!node || !node._mnEl || !node._mnState) return;
  const s = node._mnState;
  // 记录当前几何与折叠状态：图级 undo 的移动/缩放/折叠应被保留
  const curSize = [node.size[0], node.size[1]];
  const curPos = [node.pos[0], node.pos[1]];
  const curCollapsed = !!(node.flags && node.flags.collapsed);
  // 恢复内容、UI 缩放与 Mark 模式
  applyState(node._mnEl, s, node);
  // 恢复当前几何与折叠状态，避免被旧快照覆盖
  node.size = curSize;
  node.pos = curPos;
  if (node.flags) node.flags.collapsed = curCollapsed;
  node._mnEl.style.display = curCollapsed ? "none" : "";
}

function applyState(el, s, node) {
  s = s || defaultState();
  const editor = el.querySelector(".editor");
  const wrap = el.querySelector(".editor-wrap");
  const fontSel = el.querySelector('[data-role="font"]');
  const previewBtn = el.querySelector('[data-act="preview"]');
  editor.innerHTML = s.html || "";
  editor.style.fontFamily = s.fontFamily || "";
  editor.style.fontSize = s.fontSize || "";
  editor.style.color = s.textColor || "#ffffff";
  editor.style.caretColor = s.textColor || "#ffffff";
  if (s.transparent) {
    el.classList.add("mn-transparent");
    wrap.style.background = "transparent";
  } else {
    el.classList.remove("mn-transparent");
    wrap.style.background = s.bg || "#000000";
  }
  // 同步 LiteGraph 节点本体背景：透明时让画布网格透出来
  if (node) {
    const LGc = window.LiteGraph || window.litegraph || {};
    if (s.transparent) {
      node.bgcolor = "rgba(0,0,0,0)";
      node.color = "rgba(0,0,0,0)";
    } else {
      node.bgcolor = LGc.NODE_DEFAULT_BGCOLOR || "#333333";
      node.color = LGc.NODE_DEFAULT_COLOR || "#3f3f3f";
    }
  }
  // 恢复 UI 缩放（标题栏/工具栏/logo/色块/M 按钮随字号联动）
  setUiScale(el, (typeof s.uiScale === "number" && s.uiScale > 0) ? s.uiScale : 1);
  // 恢复 Mark 模式状态（图级 undo/redo 重建 DOM 后不能丢失）
  if (s.markMode) {
    el.classList.add("mark-mode");
    if (node) node._mnMark = { h: s.markFullH || node.size[1] };
    if (previewBtn) previewBtn.classList.add("active");
    editor.contentEditable = "false";
    editor.style.cursor = "default";
    pinMarkHeightForNode(node, true);   // 重建 DOM 后重新锁定高度，使文本裁切而非滚动/撑高
  } else {
    el.classList.remove("mark-mode");
    if (node) node._mnMark = null;
    if (previewBtn) previewBtn.classList.remove("active");
    editor.contentEditable = "true";
    editor.style.cursor = "text";
    pinMarkHeightForNode(node, false);
  }
  el.querySelectorAll(".color-row .swatch").forEach(sw => {
    sw.classList.toggle("active", sw.dataset.color.toLowerCase() === (s.transparent ? "transparent" : (s.bg || "#000000").toLowerCase()));
  });
  if (fontSel) {
    fontSel.value = s.fontFamily || FONTS[0][0];        // 默认显示宋体
    if (fontSel.selectedIndex < 0) fontSel.value = FONTS[0][0];   // 旧存档字体串失配时回退宋体
  }
  editor.querySelectorAll("img.note-img").forEach(enableImgDrag);
  updateEmpty(editor);
  renderLineDelete(el);
}

/* ============================ 空占位 ============================ */
function updateEmpty(editor) {
  const has = editor.textContent.trim().length > 0 || editor.querySelector("img,hr,a,ul,ol");
  editor.dataset.empty = has ? "false" : "true";
}

/* ============================ 行删除：仅光标所在行显示红圆叉，长按左键拉满才删除整行 ============================ */
let ldDragging = false;          // 滑块拖拽中，暂停重渲染

// 删除光标所在的"视觉行"：按浏览器实际换行布局判定，而非按逻辑块。
// 自动换行（软换行）会把一段文字拆成多行，删除时只移除光标所在的这一视觉行，
// 其余软换行部分保留；主动换行（块/br）同理，只删光标所在的视觉行。
// 这样无论一行里混了多少种格式，一次删除只会清掉"当前这行"，绝不多删。
function charOnLine(tn, i, lineTop, lineBottom) {
  const len = tn.textContent.length;
  const r = document.createRange();
  r.setStart(tn, i);
  r.setEnd(tn, Math.min(i + 1, len));
  const rc = r.getBoundingClientRect();
  return rc.top < lineBottom + 2 && rc.bottom > lineTop - 2;
}
// 在某个（可能跨多视觉行的）文本节点中，找出落在目标视觉行 [lineTop,lineBottom] 的连续字符区间 [start,end)
function findLineRange(tn, lineTop, lineBottom) {
  const len = tn.textContent.length;
  if (len === 0) return null;
  const full = document.createRange();
  full.selectNodeContents(tn);
  const rects = full.getClientRects();
  if (!rects.length) return null;
  const overall = Array.prototype.some.call(rects, r => r.top < lineBottom + 2 && r.bottom > lineTop - 2);
  if (!overall) return null;
  if (rects.length === 1) return [0, len];                 // 整节点就在这行内，整段删
  // 逐字判定落在目标行的连续区间（首尾）。文本节点内字符按阅读顺序连续落在各视觉行，
  // 目标行对应的字符是一段连续区间；线性扫描简单可靠，避免边界处二分方向误判。
  let s = -1, e = -1;
  for (let i = 0; i < len; i++) {
    if (charOnLine(tn, i, lineTop, lineBottom)) {
      if (s < 0) s = i;
      e = i;
    }
  }
  if (s < 0) return null;
  return [s, e + 1];
}
function deleteVisualLineAt(editor) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const cr = sel.getRangeAt(0).cloneRange();
  cr.collapse(false);
  if (!editor.contains(cr.startContainer)) return;
  const caretRect = cr.getBoundingClientRect();
  if (!caretRect || (!caretRect.width && !caretRect.height)) return;
  const caretCenterY = caretRect.top + caretRect.height / 2;
  // 定位光标所在"视觉行"的行盒：直接扫描所有文本节点的逐行 rect（与下方 findLineRange 用同一套几何），
  // 取包含光标中心 Y 的行盒作为删除带，避免编辑区顶层空行盒导致行带整体错位、只删到半行。
  let band = null, best = Infinity;
  {
    const tw = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        let p = n.parentNode;
        while (p && p !== editor) {
          if (p.nodeType === 1 && window.getComputedStyle(p).position === "absolute") return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = tw.nextNode())) {
      const rr = document.createRange();
      rr.selectNodeContents(node);
      const rects = rr.getClientRects();
      for (const r of rects) {
        if (caretCenterY >= r.top - 1 && caretCenterY <= r.bottom + 1) { band = r; break; }
        const d = Math.min(Math.abs(caretCenterY - r.top), Math.abs(caretCenterY - r.bottom));
        if (d < best) { best = d; band = r; }
      }
      if (band) break;
    }
  }
  if (!band) return;
  const lineTop = band.top, lineBottom = band.bottom;
  if (lineBottom - lineTop < 1) return;

  const edits = [];   // {node, start, end}
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {                                   // 跳过绝对定位容器内的文本（图片标注等，不属于文字流）
      let p = n.parentNode;
      while (p && p !== editor) {
        if (p.nodeType === 1 && window.getComputedStyle(p).position === "absolute") return NodeFilter.FILTER_REJECT;
        p = p.parentNode;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let tn;
  while ((tn = walker.nextNode())) {
    const rng = findLineRange(tn, lineTop, lineBottom);
    if (rng) edits.push({ node: tn, start: rng[0], end: rng[1] });
  }
  if (!edits.length) return;

  // 记录文档顺序中第一个编辑的起点，删除后把光标放回此处
  edits.sort((a, b) => {
    const c = a.node.compareDocumentPosition(b.node);
    if (c & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (c & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return a.start - b.start;
  });
  const firstNode = edits[0].node, firstStart = edits[0].start;

  // 同节点可能有多段（理论不会，保险起见按 start 降序删除，避免偏移错乱）
  const byNode = new Map();
  for (const ed of edits) { if (!byNode.has(ed.node)) byNode.set(ed.node, []); byNode.get(ed.node).push(ed); }
  for (const [node, list] of byNode) {
    list.sort((a, b) => b.start - a.start);
    for (const ed of list) node.deleteData(ed.start, ed.end - ed.start);
  }

  // 清理：合并文本、移除空元素（无文本且无图片）
  editor.normalize();
  const ew = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT);
  const emptyEls = [];
  let en;
  while ((en = ew.nextNode())) {
    if ((!en.textContent || !en.textContent.trim()) && !en.querySelector("img")) emptyEls.push(en);
  }
  emptyEls.forEach(e => e.remove());

  // 删空后清空残留结构，回到占位提示
  if (!editor.textContent.trim() && !editor.querySelector("img,hr,a,ul,ol")) {
    editor.innerHTML = "";
  }
  // 把光标放回第一个删除起点；若节点已被清空则落到编辑区开头
  editor.focus();
  try {
    const r = document.createRange();
    if (firstNode.parentNode) {
      const off = Math.min(firstStart, firstNode.textContent.length);
      r.setStart(firstNode, off);
    } else {
      r.selectNodeContents(editor);
    }
    r.collapse(true);
    const s2 = window.getSelection();
    s2.removeAllRanges();
    s2.addRange(r);
  } catch (e) { /* ignore */ }
  updateEmpty(editor);
  const nd = nodeOfEl(editor.closest(".mn-node"));
  if (nd) { nd.properties = nd.properties || {}; nd.properties.marknote = serializeState(editor.closest(".mn-node")); }
}

function renderLineDelete(el) {
  if (ldDragging) return;
  const wrap = el.querySelector(".editor-wrap");
  const editor = el.querySelector(".editor");
  let layer = wrap.querySelector(".line-del-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "line-del-layer";
    wrap.appendChild(layer);
  }
  layer.innerHTML = "";
  if (el.classList.contains("mark-mode") || el.classList.contains("collapsed")) return;

  // 仅当输入光标位于本编辑区内才显示
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const cr = sel.getRangeAt(0).cloneRange();
  cr.collapse(false);
  if (!editor.contains(cr.startContainer)) return;
  const caretRect = cr.getBoundingClientRect();
  if (!caretRect || (!caretRect.width && !caretRect.height)) return;
  const caretMidY = caretRect.top + caretRect.height / 2;

  const range = document.createRange();
  range.selectNodeContents(editor);
  const rects = range.getClientRects();
  const wrapRect = wrap.getBoundingClientRect();
  const s = scaleOf();
  const edW = editor.getBoundingClientRect().width;   // 用于过滤"元素整宽 rect"

  if (!(editor.textContent.trim().length > 0 || editor.querySelector("img,hr,a,ul,ol"))) return;

  for (const r of rects) {
    if (r.width < 4) continue;                       // 跳过零宽行
    if (r.width >= edW - 8) continue;                // 跳过块元素整宽框（div/hr 的 rect），只认文字行
    if (caretMidY < r.top || caretMidY > r.bottom) continue;   // 仅光标所在视觉行
    const relY = (r.top - wrapRect.top) / s + wrap.scrollTop;   // 相对 wrap 内容坐标（未缩放）
    buildLineDelCtl(el, layer, relY, r.height / s);
    break;                                           // 只渲染光标行这一条
  }
}

// 行删除控件：默认只显示一个红圆叉；按住红叉即展开滑块并可直接向左拖，拉满才删当前视觉行
function buildLineDelCtl(el, layer, relY, lineH) {
  const editor = el.querySelector(".editor");
  const TRACK = 96, KNOB = 18, TRAVEL = TRACK - KNOB - 4;   // 可拖行程（未缩放局部像素）
  const ARM_TOL = 8;                                        // 距满位 8px 内即吸附拉满
  const s = scaleOf();                                      // 画布缩放，跟手位移需换算
  const ctl = document.createElement("div");
  ctl.className = "line-del-ctl";
  ctl.style.top = (relY + lineH / 2 - 11) + "px";
  ctl.innerHTML =
    '<div class="line-del-track"><div class="fill"></div><div class="hint">← 拉满删除</div></div>' +
    '<div class="line-del-knob" title="按住向左拉满删除该行"><span>✕</span></div>';
  const track = ctl.querySelector(".line-del-track");
  const knob = ctl.querySelector(".line-del-knob");
  const fill = ctl.querySelector(".fill");
  const hint = ctl.querySelector(".hint");
  let armed = false;
  let onDocDown = null;                                 // 展开期间：点外部任意位置即收起
  function detachDoc() {
    if (onDocDown) { document.removeEventListener("mousedown", onDocDown, true); onDocDown = null; }
  }

  // 收起：回到只剩一个红圆叉的状态
  function collapse() {
    detachDoc();
    ctl.classList.remove("open", "armed");
    armed = false;
    knob.innerHTML = "<span>✕</span>";
    hint.textContent = "← 拉满删除";
    knob.style.transition = "transform 0.2s cubic-bezier(0.22,1.12,0.36,1)";
    fill.style.transition = "transform 0.2s cubic-bezier(0.22,1.12,0.36,1)";
    knob.style.transform = "translateX(0px) scale(1)";
    fill.style.transform = "scaleX(0)";
    hint.style.opacity = "";                          // 交回 CSS（未展开时隐藏）
  }
  // 点击轨道（滑块空白处）也收起
  track.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); });
  track.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); collapse(); });

  knob.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();          // 防误失焦/防选中文字
    const wasOpen = ctl.classList.contains("open");
    ctl.classList.add("open");                        // 按下即展开，无需先点一次
    // 展开期间点击本控件以外（含文本区、其他节点、画布）→ 立即收起
    detachDoc();
    onDocDown = ev => { if (!ctl.contains(ev.target)) collapse(); };
    document.addEventListener("mousedown", onDocDown, true);
    ldDragging = true;                                // 拖拽期间冻结重渲染
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    knob.style.transition = "none";                   // 拖动时跟手，去掉过渡
    fill.style.transition = "none";
    function move(ev) {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
      const dx = Math.max(0, (sx - ev.clientX) / s);  // 只统计向左的位移（换算为局部像素）
      const raw = Math.min(TRAVEL, dx);
      const nowArmed = raw >= TRAVEL - ARM_TOL;       // 接近满位即武装
      const cur = nowArmed ? TRAVEL : raw;            // 拉满时吸附到底，视觉填满
      knob.style.transform = "translateX(" + (-cur) + "px) scale(" + (nowArmed ? 1.18 : 1) + ")";
      fill.style.transform = "scaleX(" + (cur / TRAVEL) + ")";
      if (nowArmed !== armed) {                       // 状态切换时更新外观
        armed = nowArmed;
        ctl.classList.toggle("armed", armed);
        knob.innerHTML = armed ? "<span>✓</span>" : "<span>✕</span>";
        hint.textContent = armed ? "松手即删除" : "← 拉满删除";
        if (armed) {                                  // 拉满瞬间轨道回弹一下
          track.classList.remove("snap"); void track.offsetWidth;
          track.classList.add("snap");
          setTimeout(() => track.classList.remove("snap"), 320);
        }
      }
      hint.style.opacity = (armed || raw <= 6) ? "1" : "0";
    }
    function up() {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      ldDragging = false;
      if (armed) {
        detachDoc();
        ctl.remove();
        // 仅删除光标所在的"视觉行"（支持软换行逐行删除，不误删整段）
        deleteVisualLineAt(editor);
        renderLineDelete(el);
      } else if (!moved && wasOpen) {                 // 已展开时再点一下红叉 → 收起回原样
        collapse();
      } else {                                        // 未拉满：弹回原位，滑块保持展开
        knob.style.transition = "transform 0.26s cubic-bezier(0.22,1.12,0.36,1)";
        fill.style.transition = "transform 0.26s cubic-bezier(0.22,1.12,0.36,1)";
        knob.style.transform = "translateX(0px) scale(1)";
        fill.style.transform = "scaleX(0)";
        hint.style.opacity = "1";
      }
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
  // 双击展开态的红叉不触发其他行为
  knob.addEventListener("dblclick", e => { e.preventDefault(); e.stopPropagation(); });
  layer.appendChild(ctl);
}

/* ============================ 图片：绝对定位自由拖拽 + 点击删除 + 缩放 ============================ */
/* 图片删除红叉：点击图片（未拖动）后出现在其右上角，点击红叉删除图片 */
let imgDelBtn = null, imgResizeBtn = null, imgDelTarget = null;
function hideImgDel() {
  if (imgDelBtn) { imgDelBtn.remove(); imgDelBtn = null; }
  if (imgResizeBtn) { imgResizeBtn.remove(); imgResizeBtn = null; }
  if (imgDelTarget) imgDelTarget.classList.remove("selected");
  imgDelTarget = null;
}
// 让删除叉与缩放手柄跟随图片位置/尺寸（缩放时实时调用）
function syncImgSel(img) {
  if (!imgDelTarget || imgDelTarget !== img) return;
  if (imgDelBtn) {
    imgDelBtn.style.left = (img.offsetLeft + img.offsetWidth - 10) + "px";
    imgDelBtn.style.top = (img.offsetTop - 10) + "px";
  }
  if (imgResizeBtn) {
    imgResizeBtn.style.left = (img.offsetLeft + img.offsetWidth - 7) + "px";
    imgResizeBtn.style.top = (img.offsetTop + img.offsetHeight - 7) + "px";
  }
}
function showImgDel(img) {
  const el = img.closest(".mn-node");
  if (!el || el.classList.contains("mark-mode") || el.classList.contains("collapsed")) return;
  hideImgDel();
  imgDelTarget = img;
  img.classList.add("selected");
  const wrap = img.closest(".editor-wrap");

  /* 右上角删除红叉 */
  imgDelBtn = document.createElement("div");
  imgDelBtn.className = "img-del-x";
  /* 删除动作放在 mousedown 立即执行：
     全局 mousedown（见下方 document 监听）是捕获阶段，会先于本元素触发，
     若仅绑定 click，一旦元素在此之前被隐藏就再也收不到 click（表现为"点了没反应"）。 */
  imgDelBtn.innerHTML = "<span>✕</span>";
  imgDelBtn.title = "删除图片";
  function doDelete(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const tgt = imgDelTarget;
    if (!tgt) return;
    const ed = tgt.closest(".editor");
    tgt.remove();
    hideImgDel();
    if (ed) updateEmpty(ed);
    const nd = nodeOfEl(el);                      // 写回节点属性，随工作流保存
    if (nd) { nd.properties = nd.properties || {}; nd.properties.marknote = serializeState(el); }
  }
  imgDelBtn.addEventListener("mousedown", e => { if (e.button === 0) doDelete(e); });
  imgDelBtn.addEventListener("click", e => doDelete(e));
  wrap.appendChild(imgDelBtn);

  /* 右下角缩放手柄 */
  imgResizeBtn = document.createElement("div");
  imgResizeBtn.className = "img-resize";
  imgResizeBtn.title = "拖动缩放（按住 Shift 自由拉伸）";
  imgResizeBtn.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const s = scaleOf();
    const wr = wrap.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const w0 = img.offsetWidth, h0 = img.offsetHeight;
    const l0 = parseFloat(img.style.left) || 0;
    const t0 = parseFloat(img.style.top) || 0;
    img.style.cursor = "nwse-resize";
    function move(ev) {
      const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
      let nw, nh;
      if (ev.shiftKey) {                    // Shift：宽高独立自由拉伸
        nw = w0 + dx; nh = h0 + dy;
      } else {                              // 默认等比，取位移较大的轴
        const k = Math.max((w0 + dx) / w0, (h0 + dy) / h0);
        nw = w0 * k; nh = h0 * k;
      }
      nw = Math.max(24, Math.round(nw));    // 最小 24px
      nh = Math.max(24, Math.round(nh));
      nw = Math.min(nw, Math.max(24, wr.width / s - l0 - 2));   // 不超出编辑区
      nh = Math.min(nh, Math.max(24, wr.height / s - t0 - 2));
      img.style.width = nw + "px";
      img.style.height = nh + "px";
      syncImgSel(img);                      // 手柄跟着图片右下角走
    }
    function up() {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      img.style.cursor = "grab";
      const nd = nodeOfEl(el);              // 缩放结果写回节点属性
      if (nd) { nd.properties = nd.properties || {}; nd.properties.marknote = serializeState(el); }
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
  wrap.appendChild(imgResizeBtn);
  syncImgSel(img);
}
// 点击图片以外区域时收起红叉与手柄
/* 注意：本监听是捕获阶段（true），会先于目标元素自身的处理器执行；
   因此必须用 closest 判断，不能只比较 e.target（红叉内部还有 <span>✕</span>，
   点在 span 上时 e.target !== imgDelBtn，会把红叉提前隐藏导致删除失效）。 */
document.addEventListener("mousedown", e => {
  if (!imgDelBtn) return;
  const t = e.target;
  if (t && t.closest) {
    if (t.closest(".img-del-x") || t.closest(".img-resize")) return;
    if (t.closest(".note-img")) return;
  }
  hideImgDel();
}, true);

function enableImgDrag(img) {
  img.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    // Mark 模式 / 折叠态：图片与文本的相对位置锁定，不允许单独拖动，
    // 直接放行事件（不 preventDefault、不 stopPropagation），让节点整体长按拖拽生效
    if (img.closest(".mn-node").classList.contains("mark-mode") ||
        img.closest(".mn-node").classList.contains("collapsed")) return;
    e.preventDefault(); e.stopPropagation();
    const wrap = img.closest(".editor-wrap");
    const s = scaleOf();
    const sx = e.clientX, sy = e.clientY;
    const startL = parseFloat(img.style.left) || 0;
    const startT = parseFloat(img.style.top) || 0;
    const iw = img.offsetWidth, ih = img.offsetHeight;
    let moved = false;               // 区分"点击"与"拖拽"
    img.style.cursor = "grabbing";
    img.classList.add("dragging");
    function move(ev) {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) {
        moved = true;
        hideImgDel();                // 一旦开始拖拽就收起红叉
      }
      if (!moved) return;
      let nl = startL + (ev.clientX - sx) / s;
      let nt = startT + (ev.clientY - sy) / s;
      nl = Math.min(Math.max(0, nl), Math.max(0, wrap.clientWidth - iw - 2));
      nt = Math.min(Math.max(0, nt), Math.max(0, wrap.clientHeight - ih - 2));
      img.style.left = nl + "px";
      img.style.top = nt + "px";
    }
    function up() {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
      img.style.cursor = "grab";
      img.classList.remove("dragging");
      if (!moved) showImgDel(img);   // 原地点击 → 显示删除红叉（及缩放手柄）
      else {                         // 拖拽结束也写回节点属性
        const el = img.closest(".mn-node");
        const nd = nodeOfEl(el);
        if (nd) { nd.properties = nd.properties || {}; nd.properties.marknote = serializeState(el); }
      }
    }
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
  // 阻止双击进入编辑/选中图片内部；Mark 模式下放行，让双击退出 Mark 模式
  img.addEventListener("dblclick", e => {
    if (img.closest(".mn-node").classList.contains("mark-mode")) return;
    e.preventDefault(); e.stopPropagation();
  });
}

/* 插入图片：显示尺寸压到 IMG_LONG_EDGE，同时把位图重编码为
   最多 IMG_STORE_EDGE 的 JPEG。原因是图片以 DataURL 内联进工作流 JSON，
   而 DataURL 用的是**原图**字节 —— 一张 4000×3000 的照片即使只显示 200px，
   也会往工作流里塞几 MB base64，导致保存/撤销/加载全都变慢。
   重编码后通常能压到几十 KB，视觉上因为显示尺寸本就有限，几乎无损。 */
const IMG_STORE_EDGE = 1200;

function insertImage(editor, dataUrl) {
  const pre = new Image();
  pre.onload = () => {
    const ow = pre.naturalWidth || pre.width, oh = pre.naturalHeight || pre.height;
    // 位图重编码：长边压到 IMG_STORE_EDGE，输出 JPEG q0.85
    let src = dataUrl;
    const storeLong = Math.max(ow, oh);
    try {
      if (storeLong > IMG_STORE_EDGE && /^data:image\//.test(dataUrl)) {
        const k = IMG_STORE_EDGE / storeLong;
        const cw = Math.max(1, Math.round(ow * k));
        const chh = Math.max(1, Math.round(oh * k));
        const cv = document.createElement("canvas");
        cv.width = cw; cv.height = chh;
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(pre, 0, 0, cw, chh);
        const out = cv.toDataURL("image/jpeg", 0.85);
        // 只有确实更小才采用（个别图 jpeg 反而变大）
        if (out.length < dataUrl.length) {
          src = out;
          mnDbg("insertImage recompressed", dataUrl.length, "->", out.length);
        }
      }
    } catch (e) { mnDbg("insertImage recompress failed", e); }

    let w = ow, h = oh;
    const long = Math.max(w, h);
    if (long > IMG_LONG_EDGE) {
      const k = IMG_LONG_EDGE / long;
      w = Math.round(w * k); h = Math.round(h * k);
    }
    const img = document.createElement("img");
    img.src = src;
    img.className = "note-img";
    img.setAttribute("contenteditable", "false");
    img.draggable = false;
    img.style.width = w + "px";
    img.style.height = h + "px";
    img.style.margin = "0";
    img.style.position = "absolute";
    const cnt = editor.querySelectorAll("img.note-img").length;
    img.style.left = 26 + cnt * 20 + "px";
    img.style.top = 22 + cnt * 20 + "px";
    editor.appendChild(img);
    enableImgDrag(img);
    updateEmpty(editor);
    renderLineDelete(editor.closest(".mn-node"));
    showImgDel(img);                // 插入后即进入选中态，可直接缩放或删除
  };
  pre.onerror = () => { alert("图片解码失败，请换一张试试。"); };
  pre.src = dataUrl;
}

/* ============================ 共用弹窗控制器 ============================ */
let activeEditor = null;
let pendingColorRange = null;
let pendingRange = null;

function bindGlobalPopups() {
  // 幂等保护：beforeRegisterNodeDef 在某些加载路径下可能被调用多次，
  // 无保护会给同一批弹窗重复叠加事件监听（点一下触发 N 次）。
  if (window._mnPopupsBound) return;
  const pop = document.getElementById("mnColorPop");
  const custom = document.getElementById("mnCustomColor");
  if (!pop || !custom) return;      // ensureGlobalDom 尚未建好 DOM
  window._mnPopupsBound = true;
  pop.querySelectorAll(".c").forEach(c => c.addEventListener("click", () => applyColor(c.dataset.color)));
  custom.addEventListener("input", () => applyColor(custom.value));

  const mask = document.getElementById("mnLinkMask");
  const url = document.getElementById("mnLinkUrl");
  const txt = document.getElementById("mnLinkText");
  mask.querySelector('[data-act="cancel"]').addEventListener("click", () => mask.classList.remove("show"));
  mask.querySelector('[data-act="ok"]').addEventListener("click", () => {
    const editor = activeEditor;
    if (!editor) return;
    let href = (url.value || "").trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) href = "https://" + href;
    const label = (txt.value || "").trim() || href;
    editor.focus();
    const sel = window.getSelection();
    if (pendingRange) { sel.removeAllRanges(); sel.addRange(pendingRange); pendingRange = null; }
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("contenteditable", "false");
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (r) { r.deleteContents(); r.insertNode(a); }
    else { editor.appendChild(a); }
    updateEmpty(editor);
    renderLineDelete(editor.closest(".mn-node"));
    mask.classList.remove("show");
  });

  document.getElementById("mnImgFile").addEventListener("change", function () {
    const file = this.files && this.files[0];
    if (!file || !activeEditor) return;
    // 图片以 DataURL 内联进工作流 JSON，原图动辄几 MB 会把工作流撑爆，
    // 且每次 undo 都要重新解析这么长的字符串。这里给出明确上限。
    if (file.size > MAX_IMG_BYTES) {
      alert(`图片过大（${(file.size / 1048576).toFixed(1)} MB）。\n`
          + `请压缩到 ${(MAX_IMG_BYTES / 1048576).toFixed(0)} MB 以内再插入，`
          + `否则会显著拖慢工作流的保存与撤销。`);
      this.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => insertImage(activeEditor, reader.result);
    reader.readAsDataURL(file);
    this.value = "";
  });
}

function applyColor(color) {
  const editor = activeEditor;
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  if (pendingColorRange) {
    sel.removeAllRanges(); sel.addRange(pendingColorRange); pendingColorRange = null;
    document.execCommand("foreColor", false, color);
  } else if (sel && sel.rangeCount && !sel.isCollapsed) {
    document.execCommand("foreColor", false, color);
  } else {
    editor.style.color = color;
    editor.style.caretColor = color;
    editor.querySelectorAll('font[color],span[style*="color"]').forEach(n => {
      if (n.tagName === "FONT") n.removeAttribute("color");
      else { n.style.color = ""; if (!n.getAttribute("style")) n.removeAttribute("style"); }
    });
  }
  document.getElementById("mnColorPop").classList.remove("show");
  renderLineDelete(editor.closest(".mn-node"));
}

/* 轻量：把当前 DOM 状态捕获到内存 _mnState，并同步更新"最后已知非空状态"表。
   用于 input/focus 等高频事件，让 onConfigure 的 seq 比较能识别出"当前更新"；
   同步写 _mnLastKnownState 可在 loadGraphData/clean 之前把内容暂存到内存，
   避免后续只能读到已被清空的 DOM。 */
function captureMnState(node) {
  if (!node) return;
  ensureLiveMnEl(node);
  if (!node._mnEl) return;
  const s = serializeState(node._mnEl, node);
  s.width = node.size[0];
  s.height = node.size[1];
  s.posX = node.pos[0];
  s.posY = node.pos[1];
  s.collapsed = !!(node.flags && node.flags.collapsed);
  node._mnState = JSON.parse(JSON.stringify(s));
  if (node.id != null) {
    const isEmpty = !s.html || s.html === defaultState().html;
    if (!isEmpty) {
      window._mnLastKnownState = window._mnLastKnownState || new Map();
      window._mnLastKnownState.set(node.id, JSON.parse(JSON.stringify(s)));
    }
  }
}

/* 递增 seq，用于 input/focus/blur 等即时事件，确保图级 undo 快照到来时
   内存中的 currentSeq 一定大于旧快照的 incomingSeq。 */
function bumpMnSeq(node) {
  if (!node) return;
  node._mnSeq = (typeof node._mnSeq === "number" ? node._mnSeq : 0) + 1;
}

/* 修剪全局状态缓存：只保留「当前 graph 里真实存在的 MarkNote 节点」的条目。
   为什么需要：window._mnLastKnownState 以 node.id 为键，节点被用户删除后条目
   不会自动消失；而每条记录里含 editor.innerHTML（插了图就是一大段 base64），
   长时间使用会让内存持续增长。加载工作流时顺带清一次最省事、也最安全。 */
function pruneMnStateCache() {
  try {
    const keep = new Set();
    const nodes = (app.graph && app.graph._nodes) ||
                  (app.canvas && app.canvas.graph && app.canvas.graph._nodes) || [];
    for (const n of nodes) if (n.type === NODE_NAME) keep.add(String(n.id));
    for (const key of ["_mnLastKnownState", "_mnRemovedBackup"]) {
      const m = window[key];
      if (!(m instanceof Map)) continue;
      for (const id of Array.from(m.keys())) {
        if (!keep.has(String(id))) m.delete(id);
      }
    }
  } catch (e) { /* ignore */ }
}

/* ============================ 全局状态保存 ============================ */
function save(node) {
  if (!node) return;
  node.properties = node.properties || {};
  node._mnSeq = (typeof node._mnSeq === "number" ? node._mnSeq : 0) + 1;

  // 优先从仍然挂载的 DOM 序列化；如果 _mnEl 已 detached（Vue/LiteGraph 替换元素），
  // 退而使用内存 _mnState / _mnLastKnownState，避免 ChangeTracker 抓到空快照。
  let s = null;
  const liveConnected = node._mnEl && node._mnEl.isConnected;
  if (liveConnected) {
    s = serializeState(node._mnEl, node);
  } else if (node._mnState && node._mnState.html && node._mnState.html !== defaultState().html) {
    s = JSON.parse(JSON.stringify(node._mnState));
  } else if (node.id != null) {
    const known = window._mnLastKnownState && window._mnLastKnownState.get(node.id);
    if (known && known.html && known.html !== defaultState().html) {
      s = JSON.parse(JSON.stringify(known));
    }
  }

  // 兜底：尝试找回当前挂载元素再序列化一次。
  if (!s || !s.html || s.html === defaultState().html) {
    ensureLiveMnEl(node);
    if (node._mnEl) {
      s = serializeState(node._mnEl, node);
    }
  }

  if (!s) return;

  // 同时保存几何状态，便于图级 undo/redo 回退时恢复当前大小/位置/折叠
  s.width = node.size[0];
  s.height = node.size[1];
  s.posX = node.pos[0];
  s.posY = node.pos[1];
  s.collapsed = !!(node.flags && node.flags.collapsed);
  node._mnState = JSON.parse(JSON.stringify(s));
  node.properties.marknote = JSON.parse(JSON.stringify(s));
  // 全局“最后已知内容”表：只记录非空/非默认的真实内容，避免被空快照覆盖。
  if (node.id != null) {
    const isEmpty = !s.html || s.html === defaultState().html;
    if (!isEmpty) {
      window._mnLastKnownState = window._mnLastKnownState || new Map();
      window._mnLastKnownState.set(node.id, JSON.parse(JSON.stringify(s)));
    }
  }
}

/* 从多个可能来源挑选 MarkNote 节点当前最佳非空状态。
   优先级：内存 _mnState > 全局 _mnLastKnownState > 当前 DOM > properties.marknote。
   这是为了应对 clean()/rootGraph.clear() 把 DOM 移除后，仍能取到真实内容。 */
function pickBestMnState(node) {
  if (!node) return null;
  const isEmpty = (s) => !s || !s.html || s.html === defaultState().html;
  const sources = [
    node._mnState,
    window._mnLastKnownState && window._mnLastKnownState.get(node.id),
    node._mnEl ? (() => {
      try {
        const s = serializeState(node._mnEl, node);
        s.width = node.size[0]; s.height = node.size[1];
        s.posX = node.pos[0]; s.posY = node.pos[1];
        s.collapsed = !!(node.flags && node.flags.collapsed);
        return s;
      } catch (e) { return null; }
    })() : null,
    node.properties && node.properties.marknote
  ];
  for (const s of sources) {
    if (!isEmpty(s)) return JSON.parse(JSON.stringify(s));
  }
  // 兜底：返回 _mnState（即使是空），让调用方知道节点存在过
  return node._mnState ? JSON.parse(JSON.stringify(node._mnState)) : null;
}

/* 在 loadGraphData/clean 之前立刻备份所有 MarkNote 当前最佳状态。
   clean() 会触发 rootGraph.clear() 并移除 DOM，所以必须在 loadGraphData
   入口就完成备份，不能等到 beforeConfigureGraph。 */
function backupAllMarkNotesForLoad() {
  const backup = new Map();
  let cnt = 0;
  try {
    const nodes = (app.graph && app.graph._nodes) || (app.canvas && app.canvas.graph && app.canvas.graph._nodes) || [];
    for (const n of nodes) {
      if (n.type !== NODE_NAME) continue;
      const s = pickBestMnState(n);
      if (s) {
        s._mnBackupSeq = n._mnSeq || s.seq || 0;
        s._mnBackupSize = [n.size[0], n.size[1]];
        s._mnBackupPos = [n.pos[0], n.pos[1]];
        s._mnBackupCollapsed = !!(n.flags && n.flags.collapsed);
        backup.set(n.id, s);
        cnt++;
      }
    }
  } catch (e) { mnDbg("backupAllMarkNotesForLoad error", e); }
  window._mnLoadBackup = backup;
  mnDbg("loadGraphData pre-backup count=", cnt);
  return backup;
}

/* ComfyUI/LiteGraph 在图级加载（configure）时可能保留节点对象，但把
   DOM widget 替换为新挂载的元素，导致 node._mnEl 指向已 detached 的旧元素。
   此函数尝试找回当前真正连接在 DOM 树里的 .mn-node 元素，并更新引用。 */
/* 锁定/解除节点根 (.lg-node) 的精确高度：
   ComfyUI 的节点根用 min-height 且会把 --node-height 重算为“内容高度”，
   导致节点随文本无限撑高。在 Mark 模式锁定为 node.size 高度，
   使节点保持紧凑、超长文本由 .editor-wrap 裁切（overflow:hidden，不滚动）。 */
function pinMarkHeightForNode(node, on) {
  const el = node && node._mnEl;
  if (!el) return;
  const root = el.closest(".lg-node");
  if (!root) return;
  if (on) {
    const titleH = (window.LiteGraph && LiteGraph.NODE_TITLE_HEIGHT) || 0;
    const fullH = Math.max(MIN_H, node.size[1]) + titleH;
    root.style.height = fullH + "px";
    root.style.minHeight = fullH + "px";
  } else {
    root.style.height = "";
    root.style.minHeight = "";
  }
}

function ensureLiveMnEl(node) {
  if (!node) return null;
  const oldEl = node._mnEl;

  // 1) 当前引用仍连接在 DOM 上 —— 最理想
  if (oldEl && oldEl.isConnected) return oldEl;

  // 辅助：判断一个 element 是不是本节点的 mn-node 候选
  const isMnCandidate = (we) => we && we.classList && we.classList.contains("mn-node");
  // 辅助：把旧元素内容迁移到新元素（新元素为空时）
  const migrateContent = (from, to) => {
    if (!from || !to || from === to) return false;
    const fromEditor = from.querySelector(".editor");
    const toEditor = to.querySelector(".editor");
    if (!fromEditor || !toEditor) return false;
    const fromHtml = fromEditor.innerHTML || "";
    const toHtml = toEditor.innerHTML || "";
    const hasReal = (h) => h && h !== defaultState().html;
    if (hasReal(fromHtml) && !hasReal(toHtml)) {
      toEditor.innerHTML = fromHtml;
      mnDbg("ensureLiveMnEl MIGRATE content node=", node.id);
      return true;
    }
    return false;
  };

  let newEl = null;

  // 2) 从已保存的 widget 对象取最新 element（Vue 可能已创建新 element 但尚未插入 DOM）
  if (node._mnWidget) {
    const we = node._mnWidget.element || node._mnWidget.value || node._mnWidget.el;
    if (isMnCandidate(we) && we !== oldEl) newEl = we;
  }

  // 3) 遍历 node.widgets 找 DOM widget 的 element
  if (!newEl) {
    try {
      if (node.widgets) {
        for (const w of node.widgets) {
          if (!w) continue;
          if (w.name !== "marknote" && w.type !== "marknote" && w.type !== "DOM") continue;
          const we = w.element || w.value || w.el;
          if (isMnCandidate(we) && we !== oldEl) { newEl = we; break; }
        }
      }
    } catch (e) { mnDbg("ensureLiveMnEl widgets error", e); }
  }

  // 4) 全局搜索已挂载的 .mn-node
  // 4a) 按我们自定义的 data-mn-id 查找
  if (!newEl) {
    try {
      if (typeof document !== "undefined") {
        if (oldEl && !oldEl.dataset.mnId) oldEl.dataset.mnId = String(node.id);
        const el = document.querySelector(`.mn-node[data-mn-id="${node.id}"]`);
        if (el && el !== oldEl) newEl = el;
      }
    } catch (e) { mnDbg("ensureLiveMnEl query error", e); }
  }
  // 4b) 按 ComfyUI 节点根的 data-node-id 精确查找（Vue 重建后最可靠）
  if (!newEl && typeof document !== "undefined") {
    try {
      const root = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
      const el = root && root.querySelector(".mn-node");
      if (el && el !== oldEl) newEl = el;
    } catch (e) { mnDbg("ensureLiveMnEl data-node-id error", e); }
  }

  if (newEl) {
    node._mnEl = newEl;
    if (node.id != null) newEl.dataset.mnId = String(node.id);
    migrateContent(oldEl, newEl);
    if (!newEl._mnBound) bindNode(node, newEl);
    mnDbg("ensureLiveMnEl REPLACED node=", node.id,
          "isConnected=", newEl.isConnected,
          "source=", node._mnWidget && node._mnWidget.element === newEl ? "_mnWidget" :
                    "widget-list");
    return newEl;
  }

  /* 5) 最后的兜底：把元素强制重新挂到该节点当前真实的 DOM 容器里。

     根因（从 comfyui_frontend_package 源码实锤，勿再走弯路）：
       ComfyUI 新前端有两套 DOM widget 渲染路径：
       (A) canvas 覆盖层：DomWidgets.vue → DomWidget.vue，按 useDomWidgetStore()
           渲染，mountElementIfVisible() 把 widget.element append 进自己的容器；
       (B) Vue 节点内：NodeItem → WidgetDOM.vue，
           mountWidgetElement() = domEl.value.replaceChildren(widget.element)，
           其中 widget 由 resolveWidgetFromHostNode(canvas.graph.getNodeById(nodeId), name)
           现场解析。
       我们走的是 (B)（CSS 依赖 `.lg-node:has(.mn-node)`  descendant 选择器）。

       图级 undo/redo 时：clean() → graph.clear() → node.onRemoved →
       Vue 整个节点组件卸载 → 我们的 .mn-node 随容器一起被移除（变 detached）；
       随后 configure 复用同一个 node 对象并重新渲染节点组件，但 WidgetDOM 的
       onMounted 只会跑一次 —— 若那一刻 canvas.graph 还是旧 graph /
       getNodeById 拿不到节点，findDOMWidget() 返回 undefined，
       mountWidgetElement() 直接 return，我们的元素就永远不会被重新挂载。
       这就是「内容已恢复但 isConnected 永远 false、节点塌灰」的真正原因。

       对策：不等 Vue，直接把元素 append 回该节点当前的
       [data-testid="node-inner-wrapper"]（position:relative，.mn-node 是
       position:absolute; inset:0，视觉与原先完全一致）。 */
  if (oldEl && typeof document !== "undefined") {
    let host = null;
    try {
      const root = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
      if (root) host = root.querySelector('[data-testid="node-inner-wrapper"]') || root;
    } catch (e) { mnDbg("ensureLiveMnEl host query error", e); }
    if (host && !host.contains(oldEl)) {
      try {
        host.appendChild(oldEl);
        if (!oldEl._mnBound) bindNode(node, oldEl);
        mnDbg("ensureLiveMnEl FORCE REATTACH node=", node.id,
              "host=", host.getAttribute("data-testid") || ".lg-node",
              "isConnected=", oldEl.isConnected);
      } catch (e) { mnDbg("ensureLiveMnEl reattach error", e); }
    }
  }

  // 6) 兜底：返回旧元素（即使 detached），让调用方至少不会崩溃。
  return oldEl || null;
}

/* ============================ 图级 undo/redo 兜底拦截 ============================
   ComfyUI 的 keydown 监听可能比本扩展早注册在 window 捕获阶段，导致
   window 守卫未能先拦截。此处 patch graph/app 级别的 undo/redo：
   只要焦点在 MarkNote 节点内，就把图级 undo/redo 转成编辑器文本级
   undo/redo，从根本上避免节点被回退成空/折叠。 */

/* 调试日志开关：默认关闭。需要排查问题时在控制台执行
     localStorage.setItem('mnDebug','1'); location.reload()
   开启后日志会同时输出到 console（带 [MN-DBG] 前缀）和屏幕右上角浮层，
   方便 F12 打不开的桌面版环境；浮层可用 Ctrl+Shift+D 显隐。 */
const MN_DEBUG = (() => {
  try { return localStorage.getItem("mnDebug") === "1"; } catch (e) { return false; }
})();
let _mnOv = null;
let _mnOvHidden = false;
function safeStr(x) {
  try {
    const s = JSON.stringify(x);
    return (s && s.length < 400) ? s : String(x).slice(0, 200);
  } catch (e) { return String(x); }
}
function ensureMnOv() {
  if (_mnOv) return;
  _mnOv = document.createElement('div');
  _mnOv.setAttribute('data-mndbg', '1');
  _mnOv.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147483647;'
    + 'max-width:46vw;max-height:46vh;overflow:auto;'
    + 'background:rgba(0,0,0,.82);color:#7CFC00;font:11px/1.45 ui-monospace,monospace;'
    + 'padding:6px 8px;border:1px solid #2a2;border-radius:6px;'
    + 'white-space:pre-wrap;pointer-events:none;'
    + (_mnOvHidden ? 'display:none;' : '');
  (document.body || document.documentElement).appendChild(_mnOv);
}
function mnDbg(...a) {
  if (!MN_DEBUG) return;
  const msg = a.map(x => (typeof x === 'object' ? safeStr(x) : String(x))).join(' ');
  try { console.log('[MN-DBG]', ...a); } catch (e) {}
  if (typeof document === 'undefined') return;
  try {
    if (!_mnOv) {
      if (!document.body) document.addEventListener('DOMContentLoaded', ensureMnOv);
      else ensureMnOv();
    }
    if (_mnOv) {
      const line = document.createElement('div');
      line.textContent = msg;
      _mnOv.appendChild(line);
      while (_mnOv.childNodes.length > 50) _mnOv.removeChild(_mnOv.firstChild);
      _mnOv.scrollTop = _mnOv.scrollHeight;
    }
  } catch (e) {}
}
// 切换浮层显隐：Ctrl+Shift+D（仅调试模式下生效）
window.addEventListener('keydown', function (e) {
  if (!MN_DEBUG) return;
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    _mnOvHidden = !_mnOvHidden;
    if (_mnOv) _mnOv.style.display = _mnOvHidden ? 'none' : '';
  }
});
function describeEl(e) {
  if (!e) return String(e);
  const cls = (e.className && typeof e.className === 'string') ? e.className.split(' ').slice(0, 2).join('.') : '';
  return (e.tagName || '?') + (cls ? ('.' + cls) : '');
}

/* 操作意图判断：按"最近一次操作"决定 Ctrl+Z 走文本撤销还是图级撤销。
   - 最近一次是 MarkNote 文本编辑（input/focus） → _mnLastEdit 更大，
     焦点在编辑器内时走浏览器文本级 undo。
   - 最近一次是 ComfyUI 工作流变化（移动/新建节点等） → _mnLastWorkflowChange 更大，
     即使焦点在编辑器内也放行图级 undo，撤销工作流操作。
   这比固定 N 秒 recent 窗口更符合“撤销上一步操作”的直觉。 */
window._mnLastEdit = 0;
window._mnLastWorkflowChange = 0;
window._mnSelfAfterChange = false;
window._mnLoadingGraph = false;

function activeMnEl() {
  const active = document.activeElement;
  return active && active.closest ? active.closest(".mn-node") : null;
}
function mnUndoTarget() {
  const el = activeMnEl();
  return el ? { el, source: 'active' } : null;
}
// 最近一次操作若是文本编辑，且焦点仍在 MarkNote 编辑器内，才在编辑器内拦截 Ctrl+Z/Y。
// 离开编辑器后按 Ctrl+Z 应走 ComfyUI 工作流撤销，由 post-loadGraphData 兜底恢复 MarkNote 内容。
function shouldInterceptMnUndo() {
  if (!activeMnEl()) return false;
  return (window._mnLastEdit || 0) > (window._mnLastWorkflowChange || 0);
}

function interceptGraphUndo() {
  const execEditorUndo = (t, docCmd) => {
    if (!t || !t.el) return false;
    const editor = t.el.querySelector(".editor");
    if (!editor) return false;
    // 只有最近的操作是文本编辑，才把 Ctrl+Z/Y 转成编辑器文本级 undo
    if (!shouldInterceptMnUndo()) return false;
    mnDbg("graph-undo BLOCKED via", t.source, "-> editor text", docCmd,
          "lastEdit=", window._mnLastEdit, "lastWorkflow=", window._mnLastWorkflowChange);
    editor.focus();
    try { document.execCommand(docCmd); } catch (e) {}
    updateEmpty(editor);
    window._mnLastEdit = Date.now();
    save(nodeOfEl(t.el));
    return true;
  };

  const g = app.canvas && app.canvas.graph;
  if (g && !g._mnUndoPatched) {
    g._mnUndoPatched = true;
    const patch = (obj, name, docCmd) => {
      const orig = obj[name];
      if (typeof orig !== "function") return;
      obj[name] = function(...args) {
        if (execEditorUndo(mnUndoTarget(), docCmd)) return;
        return orig.apply(this, args);
      };
    };
    patch(g, "undo", "undo");
    patch(g, "redo", "redo");
  }

  /* 更彻底：直接 patch LiteGraph.LGraph 原型，这样任何 graph 实例都生效，
     也能拦截 ComfyUI 通过其他路径触发的图级 undo/redo。 */
  const LG = window.LiteGraph || window.litegraph;
  if (LG && LG.LGraph && LG.LGraph.prototype && !LG.LGraph.prototype._mnUndoPatched) {
    LG.LGraph.prototype._mnUndoPatched = true;
    const patchProto = (name, docCmd) => {
      const orig = LG.LGraph.prototype[name];
      if (typeof orig !== "function") return;
      LG.LGraph.prototype[name] = function(...args) {
        if (execEditorUndo(mnUndoTarget(), docCmd)) return;
        return orig.apply(this, args);
      };
    };
    patchProto("undo", "undo");
    patchProto("redo", "redo");
  }

  const wrapApp = (key, docCmd) => {
    if (!app[key] || typeof app[key] !== "function" || app[key]._mnPatched) return;
    app[key]._mnPatched = true;
    const orig = app[key];
    app[key] = function(...args) {
      if (execEditorUndo(mnUndoTarget(), docCmd)) return;
      return orig.apply(this, args);
    };
  };
  wrapApp("undo", "undo");
  wrapApp("redo", "redo");

  /* 关键补充：桌面版 ChangeTracker 在 window 捕获阶段直接调用
     app.loadGraphData(prevState) 做整图回退，上面 patch 的 graph/app/LiteGraph
     undo/redo 都拦不到它。这里直接拦截 loadGraphData：只有当前焦点在
     MarkNote 内且最近的操作是文本编辑时，才把图级回退转成编辑器文本级
     undo；否则放行，让 ComfyUI 撤销最近的工作流操作。
     真实状态的备份/恢复已经放到 beforeConfigureGraph / afterConfigureGraph
     扩展事件里（在 graph 被清空之前触发，能抓到完整内容），这里只负责
     放行并更新工作流操作时间戳。 */
  if (app.loadGraphData && typeof app.loadGraphData === "function" && !app._mnLoadPatched) {
    app._mnLoadPatched = true;
    const orig = app.loadGraphData;
    app.loadGraphData = function(...args) {
      // 关键：在 loadGraphData 做任何事（包括 clean() 清空 graph）之前，
      // 立即把所有 MarkNote 当前最佳状态备份到内存。clean() 会移除 DOM，
      // 因此这个备份是本扩展最后能抓到真实内容的机会。
      backupAllMarkNotesForLoad();

      const t = mnUndoTarget();
      const intercept = t && shouldInterceptMnUndo();
      const stack = (new Error().stack || "").split("\n").slice(1, 6).join(" <- ");
      mnDbg("loadGraphData called; activeInMn=", !!t,
            "willIntercept=", intercept,
            "active=", describeEl(document.activeElement),
            "lastEdit=", window._mnLastEdit, "lastWorkflow=", window._mnLastWorkflowChange,
            "caller=", stack);
      if (intercept) {
        const editor = t.el.querySelector(".editor");
        if (editor) {
          mnDbg("loadGraphData BLOCKED -> editor text undo");
          editor.focus();
          try { document.execCommand("undo"); } catch (e) {}
          updateEmpty(editor);
          save(nodeOfEl(t.el));
          return; // 阻断整图回退
        }
      }

      // 放行：这是工作流级 undo/redo / 工作流切换。
      window._mnLastWorkflowChange = Date.now();
      return orig.apply(this, args);
    };
  }

  if (app.command && typeof app.command.execute === "function" && !app.command._mnPatched) {
    app.command._mnPatched = true;
    const orig = app.command.execute;
    app.command.execute = function(...args) {
      const id = args[0];
      if (!(typeof id === "string" && /undo|redo/i.test(id))) return orig.apply(this, args);
      const t = mnUndoTarget();
      if (!t || !shouldInterceptMnUndo()) return orig.apply(this, args);
      const editor = t.el.querySelector(".editor");
      if (!editor) return orig.apply(this, args);
      const cmd = /redo/i.test(id) ? "redo" : "undo";
      mnDbg("app.command BLOCKED via", t.source, "-> editor text", cmd);
      editor.focus();
      try { document.execCommand(cmd); } catch (e) {}
      updateEmpty(editor);
      save(nodeOfEl(t.el));
      return;
    };
  }

  /* 核心补丁：在 ComfyUI 序列化 graph 之前，先把所有 MarkNote 当前真实内容
     写进 properties。这样 ChangeTracker.captureCanvasState()、Pixorama 工作流
     切换、手动保存等任何序列化路径生成的快照都会包含最新文字。
     注意：这里只负责“序列化前保存”，不修改序列化结果本身。 */
  const patchGraphSerialize = () => {
    const doSave = (nodes) => {
      try {
        for (const n of nodes) {
          if (n.type === NODE_NAME && n._mnEl) save(n);
        }
      } catch (e) { mnDbg("serialize pre-save error", e); }
    };
    const patchProto = () => {
      const LG = window.LiteGraph || window.litegraph;
      if (!LG || !LG.LGraph || !LG.LGraph.prototype || LG.LGraph.prototype._mnSerializePatched) return;
      const orig = LG.LGraph.prototype.serialize;
      if (typeof orig !== "function") return;
      LG.LGraph.prototype._mnSerializePatched = true;
      LG.LGraph.prototype.serialize = function(...args) {
        if (this._nodes) doSave(this._nodes);
        return orig.apply(this, args);
      };
      mnDbg("patchGraphSerialize: LiteGraph.LGraph.prototype.serialize patched");
    };
    const patchInstance = () => {
      const g = app.rootGraph || (app.canvas && app.canvas.graph);
      if (!g || g._mnSerializePatched) return;
      const orig = g.serialize;
      if (typeof orig !== "function") return;
      g._mnSerializePatched = true;
      g.serialize = function(...args) {
        if (this._nodes) doSave(this._nodes);
        return orig.apply(this, args);
      };
      mnDbg("patchGraphSerialize: app.rootGraph.serialize patched");
    };
    patchProto();
    patchInstance();
    if (!app.rootGraph) {
      // 轮询等待 app.rootGraph 出现；设上限避免极端情况下（rootGraph 始终不出现）
      // 留下永久运行的定时器。
      let tries = 0;
      const iv = setInterval(() => {
        patchProto();
        patchInstance();
        if (app.rootGraph || ++tries > 100) clearInterval(iv);
      }, 300);
    }
  };
  patchGraphSerialize();

  /* Patch graph.beforeChange：在工作流变化被 ComfyUI 捕获成 undo 快照之前，
     先把所有 MarkNote 当前真实内容写进 properties。这样后续 afterChange 调用
     captureCanvasState() 时，序列化出来的 graph 状态已经包含最新文本。
     这是解决“移动/新建节点后 Ctrl+Z 塌灰”的根本：快照里必须有内容。 */
  const patchGraphBeforeChange = () => {
    const graph = app.canvas && app.canvas.graph;
    if (!graph || graph._mnBeforeChangePatched) return;
    const orig = graph.beforeChange;
    if (typeof orig !== "function") return;
    graph._mnBeforeChangePatched = true;
    graph.beforeChange = function(...args) {
      if (!window._mnLoadingGraph) {
        try {
          let cnt = 0;
          if (app.graph && app.graph._nodes) {
            for (const n of app.graph._nodes) {
              if (n.type === NODE_NAME && n._mnEl) { save(n); cnt++; }
            }
          }
          mnDbg("graph.beforeChange saved MarkNotes count=", cnt);
        } catch (e) { mnDbg("beforeChange save error", e); }
      }
      return orig.apply(this, args);
    };
  };
  patchGraphBeforeChange();

  /* Patch graph.afterChange：兜底保存，确保在 ChangeTracker 完成 captureCanvasState()
     之前 properties 是最新的。同时记录工作流变化时间。 */
  const patchGraphAfterChange = () => {
    const graph = app.canvas && app.canvas.graph;
    if (!graph || graph._mnAfterChangePatched) return;
    const orig = graph.afterChange;
    if (typeof orig !== "function") return;
    graph._mnAfterChangePatched = true;
    graph.afterChange = function(...args) {
      // 自我触发（文本编辑遗留调用）或图级加载期间，不再重复保存。
      if (!window._mnSelfAfterChange && !window._mnLoadingGraph) {
        try {
          if (app.graph && app.graph._nodes) {
            for (const n of app.graph._nodes) {
              if (n.type === NODE_NAME && n._mnEl) save(n);
            }
          }
        } catch (e) { mnDbg("afterChange save error", e); }
      }
      return orig.apply(this, args);
    };
  };

  const patchAllGraphCallbacks = () => {
    patchGraphBeforeChange();
    patchGraphAfterChange();
  };
  patchAllGraphCallbacks();
  if (!app.canvas || !app.canvas.graph) {
    let tries = 0;
    const iv = setInterval(() => {
      patchAllGraphCallbacks();
      if ((app.canvas && app.canvas.graph) || ++tries > 40) clearInterval(iv);
    }, 500);
  }

  /* 记录“工作流变化”时间：ComfyUI Desktop 的 ChangeTracker 在鼠标释放、
     processMouseUp、promptQueued、graphCleared 等时机捕获状态。我们 patch
     LGraphCanvas.prototype.processMouseUp 并监听 window mouseup，在任意
     画布操作完成后刷新 _mnLastWorkflowChange，使“最近操作是工作流操作”
     的判定可靠。 */
  if (LG && LG.LGraphCanvas && LG.LGraphCanvas.prototype && !LG.LGraphCanvas.prototype._mnMouseUpPatched) {
    LG.LGraphCanvas.prototype._mnMouseUpPatched = true;
    const orig = LG.LGraphCanvas.prototype.processMouseUp;
    if (typeof orig === "function") {
      LG.LGraphCanvas.prototype.processMouseUp = function(...args) {
        const v = orig.apply(this, args);
        window._mnLastWorkflowChange = Date.now();
        mnDbg("LGraphCanvas.processMouseUp -> lastWorkflow=", window._mnLastWorkflowChange);
        return v;
      };
    }
  }
  if (!window._mnMouseUpListening) {
    window._mnMouseUpListening = true;
    window.addEventListener("mouseup", () => {
      window._mnLastWorkflowChange = Date.now();
      mnDbg("window mouseup -> lastWorkflow=", window._mnLastWorkflowChange);
    });
  }
}
interceptGraphUndo();

/* ============================ 文本输入判定修正 ============================
   这是 Ctrl+Z 被误当成「图级撤销」的根因之一：

   ComfyUI 的 keybindingService 在处理快捷键时会先判断：
       keyCombo.isReservedByTextInput && (target.tagName === 'TEXTAREA'
         || target.tagName === 'INPUT'
         || target.contentEditable === 'true' ...)
   命中就直接 return，不触发图级命令。而 'Ctrl + z' / 'Ctrl + y' 都在
   RESERVED_BY_TEXT_INPUT 白名单里 —— 只要判定通过，ComfyUI 自己就会放行。

   问题在于：contenteditable 容器内部的子元素（<span>/<b>/<i>，默认欢迎文本
   本身就带 span，加粗后还会产生 b）的 contentEditable 属性返回的是
   'inherit' 或空字符串 ''，而不是 'true'。于是当光标停在这些子元素里时
   判定失败，Ctrl+Z 就被当作图级 undo，把整个节点回退到旧快照。

   这里只修正 JS 读取该属性的结果（不改 DOM、不改浏览器编辑行为），
   让 MarkNote 节点内的所有元素对 ComfyUI 呈现为 'true'，
   从而让官方白名单机制正常生效。 */
(function patchContentEditableForEditor() {
  function patchProto(proto) {
    if (!proto || proto.__mnCePatched) return false;
    const desc = Object.getOwnPropertyDescriptor(proto, "contentEditable");
    if (!desc || !desc.get) return false;
    Object.defineProperty(proto, "contentEditable", {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        const v = desc.get.call(this);
        // 子元素常返回 "inherit" 或 ""; 在 MarkNote 节点内一律视为 true
        if ((v === "inherit" || v === "") && this.closest) {
          try {
            if (this.closest(".mn-node")) return "true";
          } catch (err) { }
        }
        return v;
      },
      set(val) { desc.set.call(this, val); }
    });
    proto.__mnCePatched = true;
    return true;
  }
  try {
    // 某些浏览器/框架把 contentEditable 定义在 Element.prototype 上
    patchProto(window.Element && Element.prototype);
    patchProto(window.HTMLElement && HTMLElement.prototype);
  } catch (err) { }
})();

/* ============================ 全局快捷键守卫 ============================
   ComfyUI 新前端在 document/window 捕获阶段监听 Ctrl+Z 等快捷键，会把
   整个图 undo/redo 到旧快照；而 contenteditable <div> 不在其白名单里。
   我们在 window/document 捕获阶段拦截所有落在 MarkNote 节点内的
   Ctrl+Z/Y/B/I/U，使其在节点内部消化，不再触发图级 undo/redo。

   桌面版（Electron/ComfyUI Desktop）中，ChangeTracker 在 window 捕获阶段
   监听 keydown 并直接触发图级 undo。由于扩展脚本在 ChangeTracker 之后加载，
   无法排在它前面，因此仅靠事件拦截不够；还需要 onConfigure / afterConfigureGraph
   兜底，以及直接拦截 app.loadGraphData 来阻断 undo/redo 路径。 */
function mnKeydownGuard(e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k !== "z" && k !== "y" && k !== "b" && k !== "i" && k !== "u") return;

  // 只有当前焦点在 MarkNote 节点内，且最近的操作是文本编辑时，才在节点内消化快捷键。
  // 如果用户刚做了工作流操作（移动/新建节点），即使焦点在编辑器内也放行给 ComfyUI。
  const t = mnUndoTarget();
  const el = t ? t.el : null;
  const willIntercept = !!el && shouldInterceptMnUndo();
  if (MN_DEBUG) {
    const tgt = e.target;
    const tDesc = tgt && tgt.tagName
      ? (tgt.tagName + (tgt.className && typeof tgt.className === "string" ? "." + tgt.className.split(" ").slice(0, 2).join(".") : ""))
      : String(tgt);
    mnDbg("keydown", JSON.stringify(e.key), "ctrl/meta=", !!(e.ctrlKey || e.metaKey),
          "target=", tDesc, "active=", describeEl(document.activeElement),
          "insideMn=", !!t, "willIntercept=", willIntercept,
          "lastEdit=", window._mnLastEdit, "lastWorkflow=", window._mnLastWorkflowChange);
  }
  if (!willIntercept) return;

  e.preventDefault();
  e.stopImmediatePropagation();
  const editor = el.querySelector(".editor");
  if (k === "z" || k === "y") {
    const cmd = k === "y" || e.shiftKey ? "redo" : "undo";
    if (editor) {
      editor.focus();
      try { document.execCommand(cmd); } catch (err) { }
      updateEmpty(editor);
      const nd = nodeOfEl(el);
      if (nd) {
        nd._mnLastActive = Date.now();
        window._mnLastEdit = Date.now();
        save(nd);
      }
    }
  } else if (editor) {
    editor.focus();
    document.execCommand(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
    // MutationObserver 会自动把变化 schedule 回 properties
  }
}
window.addEventListener("keydown", mnKeydownGuard, true);
document.addEventListener("keydown", mnKeydownGuard, true);

// 额外阻止 Electron / 浏览器原生 contenteditable historyUndo/historyRedo 冒泡到图级
window.addEventListener("beforeinput", e => {
  const t = e.inputType;
  if (t !== "historyUndo" && t !== "historyRedo") return;
  const active = document.activeElement;
  const el = active && typeof active.closest === "function" && active.closest(".mn-node");
  if (!el) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const editor = el.querySelector(".editor");
  if (!editor) return;
  try { document.execCommand(t === "historyRedo" ? "redo" : "undo"); } catch (err) { }
  updateEmpty(editor);
  save(nodeOfEl(el));
}, true);

/* 全局 DOM 监听：Vue/LiteGraph 在图级 undo/redo 或某些扩展触发时会重新创建
   DOM widget 并插入新元素，而 node._mnEl 仍指向旧的 detached 元素。
   这里监听整个 document 的 .mn-node 插入事件，按 data-mn-id 把 node._mnEl
   切到最新挂载的元素，并把旧元素内容迁移过去。 */
function startMnNodeObserver() {
  if (window._mnNodeObserver) return;
  const findNodeById = (id) => {
    if (!app.graph || !app.graph._nodes) return null;
    for (const n of app.graph._nodes) {
      if (n.type === NODE_NAME && String(n.id) === String(id)) return n;
    }
    return null;
  };
  const migrateContent = (from, to) => {
    if (!from || !to || from === to) return false;
    const fromEditor = from.querySelector(".editor");
    const toEditor = to.querySelector(".editor");
    if (!fromEditor || !toEditor) return false;
    const fromHtml = fromEditor.innerHTML || "";
    const toHtml = toEditor.innerHTML || "";
    const hasReal = (h) => h && h !== defaultState().html;
    if (hasReal(fromHtml) && !hasReal(toHtml)) {
      toEditor.innerHTML = fromHtml;
      return true;
    }
    return false;
  };
  const onAdded = (el) => {
    if (!el || !el.classList || !el.classList.contains("mn-node")) return;
    let id = el.dataset.mnId;
    // 如果 .mn-node 自身没有 id，尝试从 ComfyUI 节点根 data-node-id 推导
    if (!id && typeof el.closest === "function") {
      try {
        const root = el.closest(".lg-node[data-node-id]");
        if (root) id = root.dataset.nodeId;
      } catch (e) {}
    }
    if (!id) {
      /* 仍无 id：只能靠 DOM 位置反查归属。
         ⚠️ 绝不能"抓第一个 _mnEl 不连接的节点"——多节点场景会绑错，
           把 A 节点的元素塞给 B，导致 nodeOfEl() 失配、内容互相覆盖。
         可靠判据：新插入的 .mn-node 必然位于某个 .lg-node[data-node-id] 容器内；
         上面的 el.closest 已尝试过，这里再退一步用祖先节点 id 兜底。 */
      return;
    }
    const node = findNodeById(id);
    if (!node) return;
    if (node._mnEl === el) {
      if (!el._mnBound) bindNode(node, el);
      return;
    }
    const hadContent = migrateContent(node._mnEl, el);
    if (!el._mnBound) bindNode(node, el);
    node._mnEl = el;
    if (node.id != null) el.dataset.mnId = String(node.id);
    mnDbg("DOM observer ATTACHED node=", id, "migrated=", hadContent, "isConnected=", el.isConnected);
  };
  window._mnNodeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added.nodeType !== 1) continue;
        if (added.matches && added.matches(".mn-node")) {
          onAdded(added);
        } else if (added.querySelector) {
          const inner = added.querySelector(".mn-node");
          if (inner) onAdded(inner);
        }
      }
    }
  });
  window._mnNodeObserver.observe(document.body, { childList: true, subtree: true });
  mnDbg("DOM observer started");
}

/* ============================ 主扩展 ============================ */
app.registerExtension({
  name: "Comfy.MarkNote",

  // 双保险：ComfyUI 在 loadGraphData 前后会触发这两个扩展事件。
  // beforeConfigureGraph 在 graph 被清空/configure 之前触发，是备份 MarkNote
  // 真实状态的最佳时机；afterConfigureGraph 在 configure 完成后触发，用于恢复
  // 被工作流 undo/redo 清空的节点内容。使用计数器防止并发/嵌套 loadGraphData
  // 导致 _mnLoadingGraph stuck。
  async beforeConfigureGraph() {
    window._mnLoadingGraphCount = (window._mnLoadingGraphCount || 0) + 1;
    window._mnLoadingGraph = true;

    // 关键：Pixorama 等扩展会 clean=true 先清空 graph 再 configure，
    // loadGraphData 入口已经预先备份到 window._mnLoadBackup。这里把预备份、
    // 当前 DOM、_mnLastKnownState 合并成一份最终加载前备份；DOM 可能已被移除，
    // 因此优先使用 loadGraphData 入口的内存备份，而非重新读 DOM。
    const backup = new Map();
    const isEmpty = (s) => !s || !s.html || s.html === defaultState().html;

    // 1) loadGraphData 入口预备份（最可靠，在 clean 前完成）
    if (window._mnLoadBackup) {
      for (const [id, s] of window._mnLoadBackup.entries()) {
        if (!isEmpty(s)) backup.set(id, JSON.parse(JSON.stringify(s)));
      }
    }

    // 2) 当前 DOM（若节点仍在 graph 中且 DOM 仍连接）
    if (app.graph && app.graph._nodes) {
      for (const n of app.graph._nodes) {
        if (n.type !== NODE_NAME || !n._mnEl) continue;
        if (backup.has(n.id)) continue;
        try {
          const s = serializeState(n._mnEl, n);
          if (!isEmpty(s)) {
            s._mnBackupSeq = n._mnSeq || 0;
            s._mnBackupSize = [n.size[0], n.size[1]];
            s._mnBackupPos = [n.pos[0], n.pos[1]];
            s._mnBackupCollapsed = !!(n.flags && n.flags.collapsed);
            backup.set(n.id, s);
          }
        } catch (e) { mnDbg("beforeConfigureGraph DOM backup error", e); }
      }
    }

    // 3) 全局“最后已知非空状态”，作为最终兜底。
    if (window._mnLastKnownState) {
      for (const [id, s] of window._mnLastKnownState.entries()) {
        if (backup.has(id) || isEmpty(s)) continue;
        const sc = JSON.parse(JSON.stringify(s));
        sc._mnBackupSeq = sc.seq || 0;
        backup.set(id, sc);
      }
    }
    window._mnPreLoadBackup = backup;
    pruneMnStateCache();
    mnDbg("extension beforeConfigureGraph -> loadingGraph=true count=", window._mnLoadingGraphCount, "backup=", backup.size);
  },
  async afterConfigureGraph() {
    // configure 完成后，把被清空的 MarkNote 节点从备份恢复，并强制恢复
    // 当前几何 / 展开状态，避免工作流 undo/redo 把节点压成灰框。
    try {
      if (app.graph && app.graph._nodes && window._mnPreLoadBackup) {
        for (const n of app.graph._nodes) {
          if (n.type !== NODE_NAME || !n._mnEl) continue;
          const preEl = n._mnEl;
          ensureLiveMnEl(n);
          const replaced = n._mnEl && n._mnEl !== preEl;
          if (!n._mnEl) continue;
          const s = window._mnPreLoadBackup.get(n.id);
          if (!s) continue;
          const editor = n._mnEl.querySelector(".editor");
          if (!editor) continue;

          // 先记下当前几何，后面统一恢复。
          const curSize = [n.size[0], n.size[1]];
          const curPos = [n.pos[0], n.pos[1]];
          const curCollapsed = !!(n.flags && n.flags.collapsed);

          const currentHtml = editor.innerHTML || "";
          const currentEmpty = !currentHtml || currentHtml === defaultState().html;
          const backupEmpty = !s.html || s.html === defaultState().html;
          mnDbg("afterConfigureGraph check node=", n.id,
                "currentEmpty=", currentEmpty, "backupEmpty=", backupEmpty,
                "backupSeq=", s._mnBackupSeq, "currentSeq=", n._mnSeq,
                "size=", curSize, "collapsed=", curCollapsed,
                "isConnected=", n._mnEl.isConnected, "replaced=", replaced);
          if ((currentEmpty && !backupEmpty) || (replaced && !backupEmpty)) {
            mnDbg("afterConfigureGraph RESTORE node=", n.id, "replaced=", replaced);
            applyState(n._mnEl, s, n);
            save(n);
            n._mnSeq = Math.max(n._mnSeq || 0, s._mnBackupSeq || 0) + 1;
            captureMnState(n);
          }

          // 统一恢复几何并强制展开：工作流 undo/redo 不应让 MarkNote 折叠或变小。
          // 优先使用加载前备份里的几何（configure 可能已经把尺寸压成默认）。
          const targetSize = s._mnBackupSize || curSize;
          const targetPos = s._mnBackupPos || curPos;
          const targetCollapsed = typeof s._mnBackupCollapsed === "boolean" ? s._mnBackupCollapsed : curCollapsed;
          n.size = targetSize;
          n.pos = targetPos;
          if (n.flags) n.flags.collapsed = targetCollapsed;
          n._mnEl.classList.remove("collapsed");
          n._mnEl.style.display = targetCollapsed ? "none" : "";
          const collapseBtn = n._mnEl.querySelector(".collapse");
          if (collapseBtn) collapseBtn.classList.toggle("is-collapsed", targetCollapsed);
          if (app.canvas) app.canvas.setDirty(true, true);
        }
      }
    } catch (err) { mnDbg("afterConfigureGraph restore error", err); }

    window._mnLoadingGraphCount = Math.max(0, (window._mnLoadingGraphCount || 0) - 1);
    window._mnLoadingGraph = window._mnLoadingGraphCount > 0;
    const stillLoading = window._mnLoadingGraph;
    // 备份不在此处清空，留给延迟 restore 用到最后一轮（700ms）后再清。
    mnDbg("extension afterConfigureGraph -> loadingGraph=", window._mnLoadingGraph, "count=", window._mnLoadingGraphCount);

    // 延迟再检查：Vue/LiteGraph 可能在 configure 后异步重建/挂载 DOM widget，
    // 此时 _mnEl 可能尚未连接或刚被替换。延迟恢复能把内容写进最终挂载的元素。
    const attemptDelayedRestore = (round) => {
      try {
        if (!app.graph || !app.graph._nodes) return;
        for (const n of app.graph._nodes) {
          if (n.type !== NODE_NAME || !n._mnEl) continue;
          ensureLiveMnEl(n);
          if (!n._mnEl) continue;
          const editor = n._mnEl.querySelector(".editor");
          if (!editor) continue;
          const currentHtml = editor.innerHTML || "";
          const currentEmpty = !currentHtml || currentHtml === defaultState().html;
          const notConnected = !n._mnEl.isConnected;
          if (!currentEmpty && !notConnected) continue;
          const s = window._mnPreLoadBackup && window._mnPreLoadBackup.get(n.id);
          const known = window._mnLastKnownState && window._mnLastKnownState.get(n.id);
          const src = s || known;
          const srcEmpty = !src || !src.html || src.html === defaultState().html;
          if (srcEmpty) continue;
          mnDbg("afterConfigureGraph delayed RESTORE round=", round, "node=", n.id,
                "currentEmpty=", currentEmpty, "notConnected=", notConnected,
                "isConnected=", n._mnEl.isConnected);
          applyState(n._mnEl, src, n);
          save(n);
          n._mnSeq = Math.max(n._mnSeq || 0, src._mnBackupSeq || src.seq || 0) + 1;
          captureMnState(n);
          // 同样强制恢复几何/展开
          if (src._mnBackupSize) n.size = src._mnBackupSize;
          if (src._mnBackupPos) n.pos = src._mnBackupPos;
          if (n.flags && typeof src._mnBackupCollapsed === "boolean") n.flags.collapsed = src._mnBackupCollapsed;
          n._mnEl.classList.remove("collapsed");
          n._mnEl.style.display = src._mnBackupCollapsed ? "none" : "";
          const collapseBtn = n._mnEl.querySelector(".collapse");
          if (collapseBtn) collapseBtn.classList.toggle("is-collapsed", !!src._mnBackupCollapsed);
          if (app.canvas) app.canvas.setDirty(true, true);
        }
      } catch (e) { mnDbg("afterConfigureGraph delayed restore error", e); }
      // 最后一轮（700ms）结束后才清空备份
      if (round === 700) {
        if (!window._mnLoadingGraph) {
          window._mnPreLoadBackup = null;
          window._mnLoadBackup = null;
        }
        mnDbg("afterConfigureGraph delayed restore DONE -> cleared backups");
      }
    };
    // Vue/LiteGraph 异步挂载 DOM widget 的时间不确定，多轮延迟检查：
    // rAF、120ms、300ms、700ms，确保内容最终写进真正挂载的元素。
    requestAnimationFrame(() => {
      attemptDelayedRestore("rAF");
      setTimeout(() => attemptDelayedRestore(120), 120);
      setTimeout(() => attemptDelayedRestore(300), 300);
      setTimeout(() => attemptDelayedRestore(700), 700);
      // 追加一个短时轮询看门狗：Vue 节点组件可能在 1s 之后才重新渲染，
      // 期间 .mn-node 会一直是 detached。持续尝试 ensureLiveMnEl 重新挂载，
      // 直到所有 MarkNote 节点都 connected 或超时（2.5s）。
      const deadline = Date.now() + 2500;
      const tick = () => {
        let pending = false;
        try {
          if (app.graph && app.graph._nodes) {
            for (const n of app.graph._nodes) {
              if (n.type !== NODE_NAME || !n._mnEl) continue;
              if (n._mnEl.isConnected) continue;
              pending = true;
              ensureLiveMnEl(n);   // 内部会 FORCE REATTACH
              if (n._mnEl.isConnected) mnDbg("watchdog REATTACHED node=", n.id);
            }
          }
        } catch (e) { mnDbg("watchdog error", e); }
        if (pending && Date.now() < deadline) setTimeout(tick, 150);
        else if (pending) mnDbg("watchdog give up (still detached)");
      };
      setTimeout(tick, 900);
    });
  },

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== NODE_NAME) return;

    interceptGraphUndo();   // app.canvas.graph 此时应已可用，再 patch 一次兜底
    ensureGlobalDom();
    bindGlobalPopups();
    startMnNodeObserver();  // 监听 DOM widget 重新挂载，自动把 _mnEl 切到最新元素

    /* ---- 挂载：用 ComfyUI 官方 DOM widget ----
       由 ComfyUI/LiteGraph 负责把 DOM 定位到节点 body 并随画布移动/缩放/折叠，
       彻底替代旧的 #mnLayer 覆盖层 + onDrawForeground 手动对齐方案。 ---- */
    function attachWidget(node, el) {
      if (typeof node.addDOMWidget !== "function") return null;
      const w = node.addDOMWidget("marknote", "marknote", el, { serialize: false });
      w.computeSize = () => [node.size[0], node.size[1]];
      /* 定位不再靠 marginTop 负边距：CSS 里 .mn-node 以 absolute inset:0
         相对 [data-testid="node-inner-wrapper"] 铺满整个节点矩形 */
      return w;
    }

    /* ---- 创建 ---- */
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      const node = this;
      node.title = "Mark Note";
      node.size = [node.size && node.size[0] > 200 ? node.size[0] : DEFAULT_W,
      node.size && node.size[1] > 120 ? node.size[1] : DEFAULT_H];
      node.properties = node.properties || {};

      /* ---- 抹掉 LiteGraph 在 canvas 上画的标题/折叠箭头/包名徽章 ----
         新前端 litegraph 0.4 由节点实例方法绘制，实例级覆盖即可，不影响其它节点。
         折叠态恢复默认绘制（折叠条仍显示标题文字）。 ---- */
      const proto = Object.getPrototypeOf(node);
      const canvasPassThrough = (name) => {
        if (typeof proto[name] !== "function") return;
        node[name] = function () {
          if (this.flags && this.flags.collapsed) return proto[name].apply(this, arguments);
        };
      };
      ["drawTitleText", "drawTitleBox", "drawTitleBarBackground", "drawBadges", "drawProgressBar"].forEach(canvasPassThrough);

      const el = document.createElement("div");
      el.className = "mn-node";
      el.innerHTML = nodeMarkup();
      // 注意：LiteGraph 在 onNodeCreated 阶段 id 可能是 undefined，
      // 此时不写 data-mn-id，避免多个未分配 id 的节点都带上 "undefined"
      // 而在按 id 反查时被误判为同一个节点。
      if (node.id != null) el.dataset.mnId = String(node.id);
      node._mnEl = el;
      node._mnSeq = 0;
      node._mnState = null;
      node._mnLastActive = 0;
      node._mnWidget = attachWidget(node, el);
      bindNode(node, el);
      applyState(el, node.properties.marknote || defaultState(), node);

      // 兜底：如果 properties 为空/默认，但加载前备份或全局“最后已知非空状态”有内容，
      // 说明该节点刚被工作流 undo/redo 或某些扩展重建且快照丢了内容，
      // 直接从内存状态恢复，避免节点显示空/灰框。
      const propsEmpty = !node.properties.marknote ||
                         !node.properties.marknote.html ||
                         node.properties.marknote.html === defaultState().html;
      if (propsEmpty && node.id != null) {
        const src = (window._mnLoadBackup && window._mnLoadBackup.get(node.id)) ||
                    (window._mnLastKnownState && window._mnLastKnownState.get(node.id));
        const srcEmpty = !src || !src.html || src.html === defaultState().html;
        if (!srcEmpty) {
          mnDbg("onNodeCreated RESTORE from memory node=", node.id);
          applyState(el, src, node);
        }
      }
      save(node);
      return r;
    };

    /* ---- 折叠：用 LiteGraph 原生 collapse，同步隐藏 DOM ---- */
    const collapseOrig = nodeType.prototype.collapse;
    nodeType.prototype.collapse = function () {
      const r = collapseOrig ? collapseOrig.apply(this, arguments) : undefined;
      if (this._mnEl) this._mnEl.style.display = (this.flags && this.flags.collapsed) ? "none" : "";
      if (app.canvas) app.canvas.setDirty(true, true);
      return r;
    };

    /* ---- 保存 / 恢复 ---- */
    const onSerialize = nodeType.prototype.onSerialize;
    nodeType.prototype.onSerialize = function (o) {
      this.properties = this.properties || {};
      save(this);                                                   // 先把当前 DOM 写回 properties
      const r = onSerialize ? onSerialize.apply(this, arguments) : undefined;
      o.properties = JSON.parse(JSON.stringify(this.properties));   // 深克隆：undo/redo 快照不能共享引用
      return r;
    };
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      const st = (info && info.properties && info.properties.marknote != null) ? info.properties.marknote : defaultState();
      // 图级加载时 Vue 可能已替换 DOM widget 元素，确保 _mnEl 指向当前挂载的元素
      ensureLiveMnEl(this);
      if (!this._mnEl) return r;
      const incomingSeq = (typeof st.seq === "number") ? st.seq : 0;
      const currentSeq = (typeof this._mnSeq === "number") ? this._mnSeq : 0;
      const incomingHtml = st.html || "";
      const currentHtml = (this._mnState && this._mnState.html) || "";
      const incomingEmpty = !incomingHtml || incomingHtml === defaultState().html;
      const currentEmpty = !currentHtml || currentHtml === defaultState().html;
      const sameContent = incomingHtml === currentHtml;
      const active = document.activeElement;
      const focusInside = active && typeof active.closest === "function" && !!active.closest(".mn-node");
      const editor = this._mnEl.querySelector(".editor");
      const domHtml = editor ? editor.innerHTML : "";
      const domEmpty = !domHtml || domHtml === defaultState().html;

      mnDbg("onConfigure node=", this.id,
            "incomingSeq=", incomingSeq, "currentSeq=", currentSeq,
            "sameContent=", sameContent,
            "incomingEmpty=", incomingEmpty, "currentEmpty=", currentEmpty,
            "domEmpty=", domEmpty,
            "focusInside=", focusInside, "loadingGraph=", !!window._mnLoadingGraph);

      // 修复：_mnState 被异常清空但 DOM 仍有真实内容时，从 DOM 重建 _mnState。
      if (this._mnState && currentEmpty && !domEmpty) {
        mnDbg("onConfigure REPAIR _mnState from current DOM");
        captureMnState(this);
        this._mnSeq = Math.max(currentSeq, incomingSeq, this._mnSeq || 0) + 1;
        this._mnEl.style.display = (this.flags && this.flags.collapsed) ? "none" : "";
        return r;
      }

      // 图级加载期间（undo/redo / 工作流切换）：优先保留当前真实内容。
      // 几何（位置/大小/折叠）也强制保留当前值，避免工作流 undo/redo 把节点
      // 压成默认小尺寸或折叠灰框。
      if (window._mnLoadingGraph) {
        mnDbg("onConfigure PROTECT during graph load",
              "size=", [this.size[0], this.size[1]], "pos=", [this.pos[0], this.pos[1]],
              "collapsed=", !!(this.flags && this.flags.collapsed),
              "isConnected=", this._mnEl.isConnected);
        // 图级加载期间优先从“加载前备份”恢复；来源优先级：
        // loadGraphData 入口预备份 > beforeConfigureGraph 备份 > _mnLastKnownState。
        const backup = (window._mnLoadBackup && window._mnLoadBackup.get(this.id)) ||
                       (window._mnPreLoadBackup && window._mnPreLoadBackup.get(this.id)) ||
                       (window._mnLastKnownState && window._mnLastKnownState.get(this.id));
        const backupEmpty = !backup || !backup.html || backup.html === defaultState().html;
        const needBackupFallback = (domEmpty || currentEmpty) && !backupEmpty;

        // 先记下当前几何，再被旧快照覆盖前用它；但优先使用 loadGraphData 入口
        // 预备份里的几何（因为当前几何可能已经被 configure 压成默认尺寸）。
        const curSize = backup && Array.isArray(backup._mnBackupSize) ? backup._mnBackupSize : [this.size[0], this.size[1]];
        const curPos = backup && Array.isArray(backup._mnBackupPos) ? backup._mnBackupPos : [this.pos[0], this.pos[1]];
        const curCollapsed = (backup && typeof backup._mnBackupCollapsed === "boolean")
                               ? backup._mnBackupCollapsed
                               : !!(this.flags && this.flags.collapsed);

        if (!this._mnState) {
          // _mnState 缺失：若当前 DOM 已有真实内容且 incoming 为空/默认，直接保留 DOM；
          // 否则尝试从加载前备份恢复；再没有才应用 incoming。
          if (!domEmpty && incomingEmpty) {
            mnDbg("onConfigure PROTECT keep current DOM (no _mnState)");
          } else if (needBackupFallback) {
            mnDbg("onConfigure PROTECT restore from backup (no _mnState)");
            applyState(this._mnEl, backup, this);
          } else if (incomingEmpty) {
            mnDbg("onConfigure PROTECT keep current DOM (no _mnState, incoming empty)");
          } else {
            applyState(this._mnEl, st, this);
          }
        } else if (!currentEmpty) {
          // _mnState 存在且非空：先应用 incoming，再恢复当前内容/UI。
          applyState(this._mnEl, st, this);
          restoreCurrentState(this);
        } else if (needBackupFallback) {
          mnDbg("onConfigure PROTECT restore from backup (currentEmpty)");
          applyState(this._mnEl, backup, this);
        } else {
          applyState(this._mnEl, st, this);
        }

        // 恢复当前几何与折叠状态，避免被旧快照压成小尺寸/折叠灰框。
        this.size = curSize;
        this.pos = curPos;
        if (this.flags) this.flags.collapsed = curCollapsed;
        this._mnEl.classList.remove("collapsed");
        this._mnEl.style.display = "";
        // 同步折叠按钮的图标方向
        const collapseBtn = this._mnEl.querySelector(".collapse");
        if (collapseBtn) collapseBtn.classList.remove("is-collapsed");
        if (app.canvas) app.canvas.setDirty(true, true);
        captureMnState(this);
        this._mnSeq = Math.max((typeof this._mnSeq === "number" ? this._mnSeq : 0), incomingSeq) + 1;
        return r;
      }

      // 焦点在编辑器内，incoming seq 更小 -> 拒绝图级 undo 穿透
      if (focusInside && currentSeq > 0 && incomingSeq < currentSeq) {
        mnDbg("onConfigure REJECT focusInside old seq -> restoreCurrentState");
        restoreCurrentState(this);
        return r;
      }

      // 当前有内容，incoming 要清空/回退默认 -> 拒绝
      if (!sameContent && !currentEmpty && incomingEmpty) {
        mnDbg("onConfigure REJECT empty/default over content -> restoreCurrentState");
        restoreCurrentState(this);
        return r;
      }

      // 兜底：incoming 和当前都为空/默认，但加载前备份/全局最后已知状态有内容 -> 恢复
      if (currentEmpty && incomingEmpty && !focusInside) {
        const backup = (window._mnPreLoadBackup && window._mnPreLoadBackup.get(this.id)) ||
                       (window._mnLastKnownState && window._mnLastKnownState.get(this.id));
        const backupEmpty = !backup || !backup.html || backup.html === defaultState().html;
        if (!backupEmpty) {
          mnDbg("onConfigure RESTORE from backup (non-loading)");
          const curSize = [this.size[0], this.size[1]];
          const curPos = [this.pos[0], this.pos[1]];
          const curCollapsed = !!(this.flags && this.flags.collapsed);
          applyState(this._mnEl, backup, this);
          this._mnSeq = Math.max(currentSeq, incomingSeq, backup.seq || 0) + 1;
          // 恢复当前几何并强制展开，避免节点卡在折叠灰框。
          this.size = curSize;
          this.pos = curPos;
          if (this.flags) this.flags.collapsed = curCollapsed;
          this._mnEl.classList.remove("collapsed");
          this._mnEl.style.display = "";
          const collapseBtn = this._mnEl.querySelector(".collapse");
          if (collapseBtn) collapseBtn.classList.remove("is-collapsed");
          if (app.canvas) app.canvas.setDirty(true, true);
          captureMnState(this);
          return r;
        }
      }

      applyState(this._mnEl, st, this);
      this._mnSeq = Math.max(currentSeq, incomingSeq) + 1;
      this._mnEl.style.display = (this.flags && this.flags.collapsed) ? "none" : "";
      captureMnState(this);
      return r;
    };

    /* ---- 移除 ---- */
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      // 备份当前真实内容，防止某些扩展在 undo/redo/切换时先 clear 再重建节点导致内容丢失。
      if (this.id != null) {
        try {
          const live = this._mnEl ? serializeState(this._mnEl, this) : null;
          const liveEmpty = !live || !live.html || live.html === defaultState().html;
          const known = window._mnLastKnownState && window._mnLastKnownState.get(this.id);
          const knownEmpty = !known || !known.html || known.html === defaultState().html;
          const state = this._mnState;
          const stateEmpty = !state || !state.html || state.html === defaultState().html;
          const s = (!stateEmpty && state) ||
                    (!liveEmpty && live) ||
                    (!knownEmpty && JSON.parse(JSON.stringify(known))) ||
                    live || known || state;
          if (s) {
            const sc = JSON.parse(JSON.stringify(s));
            sc._mnBackupSeq = this._mnSeq || sc.seq || 0;
            sc._mnBackupSize = [this.size[0], this.size[1]];
            sc._mnBackupPos = [this.pos[0], this.pos[1]];
            sc._mnBackupCollapsed = !!(this.flags && this.flags.collapsed);
            // 只写 _mnLastKnownState（供 onNodeCreated / 加载前备份兜底恢复）。
            // 同步写 _mnLoadBackup 会在 clear() 之后残留已删除节点的条目，长期使用
            // 会让这些 Map 无限增长（且每条都含 base64 图片，内存开销很大）。
            window._mnLastKnownState = window._mnLastKnownState || new Map();
            window._mnLastKnownState.set(this.id, JSON.parse(JSON.stringify(sc)));
            mnDbg("onRemoved backed up node=", this.id);
          }
        } catch (e) { mnDbg("onRemoved backup error", e); }
      }
      if (this._mnEl) { this._mnEl.remove(); this._mnEl = null; }
      return onRemoved ? onRemoved.apply(this, arguments) : undefined;
    };

    /* ============================ 节点内交互 ============================ */
    /* ---- 拖拽 / 缩放节点（新前端兼容） ----
       新前端的 DOM widget 容器带 @pointerdown.stop，事件永远到不了节点根元素的
       原生拖拽处理器；转发给 canvas 又因命中测试不中而变成平移画布。
       正确做法：node.pos / node.size 的 setter（LGraphNode 内部会调用
       layoutMutations.moveNode / resizeNode）驱动 Vue 布局 —— 必须"整体赋值"，
       就地改 node.pos[0] / node.size[1] 会绕过 setter，完全无效。 */
    function startNodeDrag(targetNode, e) {
      const node = targetNode;
      const sx = e.clientX, sy = e.clientY;
      const startPos = [node.pos[0], node.pos[1]];
      function move(ev) {
        const s = scaleOf();
        node.pos = [
          startPos[0] + (ev.clientX - sx) / s,
          startPos[1] + (ev.clientY - sy) / s
        ];
      }
      /* 捕获阶段监听：WidgetDOM 容器带 @pointermove/@pointerup.stop，
         冒泡阶段的 document 监听收不到真实拖拽事件，必须在捕获阶段截获 */
      function up() {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
      }
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
    }
    function startNodeResize(targetNode, e) {
      const node = targetNode;
      const sx = e.clientX, sy = e.clientY;
      const w0 = node.size[0], h0 = node.size[1];
      function move(ev) {
        const s = scaleOf();
        node.size = [
          Math.max(MIN_W, w0 + (ev.clientX - sx) / s),
          Math.max(MIN_H, h0 + (ev.clientY - sy) / s)
        ];
      }
      /* 捕获阶段监听：WidgetDOM 容器带 @pointermove/@pointerup.stop，
         冒泡阶段的 document 监听收不到真实拖拽事件，必须在捕获阶段截获 */
      function up() {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
      }
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
    }
    /* ---- 边缘拉伸：按住白边框（节点任意边缘/角落）拖动缩放，对侧/对边锚定 ---- */
    function startEdgeResize(targetNode, dir, e) {
      const node = targetNode;
      const sx = e.clientX, sy = e.clientY;
      const p0 = [node.pos[0], node.pos[1]];
      const s0 = [node.size[0], node.size[1]];
      function move(ev) {
        const s = scaleOf();
        const dx = (ev.clientX - sx) / s, dy = (ev.clientY - sy) / s;
        let x = p0[0], y = p0[1], w = s0[0], h = s0[1];
        if (dir.indexOf("e") >= 0) w = Math.max(MIN_W, s0[0] + dx);
        if (dir.indexOf("s") >= 0) h = Math.max(MIN_H, s0[1] + dy);
        if (dir.indexOf("w") >= 0) { w = Math.max(MIN_W, s0[0] - dx); x = p0[0] + (s0[0] - w); }
        if (dir.indexOf("n") >= 0) { h = Math.max(MIN_H, s0[1] - dy); y = p0[1] + (s0[1] - h); }
        node.pos = [x, y];
        node.size = [w, h];
        // Mark 模式下节点根高度被锁定（pinMarkHeightForNode）；拉伸后同步刷新锁定高度，
        // 否则固定高度会让新尺寸失效、文本仍按旧高度裁切。
        if (node._mnEl && node._mnEl.classList.contains("mark-mode")) {
          pinMarkHeightForNode(node, true);
        }
      }
      function up() {
        document.removeEventListener("pointermove", move, true);
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
      }
      document.addEventListener("pointermove", move, true);
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
    }

    function bindNode(node, el) {
      if (el._mnBound) return;
      el._mnBound = true;
      const editor = el.querySelector(".editor");
      const wrap = el.querySelector(".editor-wrap");
      const header = el.querySelector(".node-header");
      const toolbar = el.querySelector(".toolbar");
      const footer = el.querySelector(".node-footer");
      const fontSel = el.querySelector('[data-role="font"]');

      /* 选中节点 */
      el.addEventListener("mousedown", () => {
        try { app.canvas.selectNode(node); } catch (e) { }
      });

      /* 编辑即保存 */
      let inputTimer = null;
      editor.addEventListener("mousedown", () => { activeEditor = editor; });
      editor.addEventListener("input", () => {
        updateEmpty(editor);
        schedule();
        // 每次输入都刷新“最近一次文本编辑”时间，并立即推进 seq、捕获当前状态到内存。
        // 这样工作流 undo 加载旧快照时，onConfigure 能识别出当前内容比 incoming 新。
        node._mnLastActive = Date.now();
        window._mnLastEdit = Date.now();
        bumpMnSeq(node);
        captureMnState(node);
        // 每次输入都立即把当前文本状态持久化到 properties（不触发图级 afterChange）。
        // 这样任何工作流快照/Pixorama 切换在调用前都能读到最新内容。
        // 用 0ms 定时器把多次连续按键合并成一次序列化，减少开销。
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => { save(node); }, 0);
      });
      editor.addEventListener("focus", () => {
        activeEditor = editor;
        node._mnLastActive = Date.now();
        // 不再把 focus 本身算作“文本编辑”，避免用户点击进编辑器后按 Ctrl+Z
        // 被误判为要撤销文字；真正的文本编辑时间由 input 事件/文本 undo 刷新。
        bumpMnSeq(node);
        captureMnState(node);
        renderLineDelete(el);
      });
      editor.addEventListener("blur", () => {
        node._mnLastActive = Date.now();
        window._mnLastEdit = Date.now();
        renderLineDelete(el);
        // save + graph.change 统一在下面的 blur 监听器里处理，避免重复递增 seq。
      });

      // 节点内任何点击都视为“仍在编辑上下文”
      el.addEventListener("pointerdown", () => { node._mnLastActive = Date.now(); });

      /* ---- 标题栏拖拽移动节点：手动拖拽，经 node.pos setter 驱动 Vue 布局 ---- */
      header.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        if (e.target.closest(".hb, .collapse")) return;
        e.preventDefault();
        e.stopPropagation();
        startNodeDrag(node, e);
      });

      /* ---- 折叠：走 LiteGraph 原生 collapse（新前端由 Vue 布局响应尺寸变化） ---- */
      const collapseBtn = el.querySelector(".collapse");
      collapseBtn.addEventListener("click", e => {
        e.stopPropagation();
        try { node.collapse(!node.flags.collapsed); } catch (err) {
          const on = el.classList.toggle("collapsed");
          collapseBtn.classList.toggle("is-collapsed", on);
          if (app.canvas) app.canvas.setDirty(true, true);
        }
        save(node);
      });

      /* ---- 右下角拉伸手柄：手动缩放，经 node.size setter 驱动 Vue 布局 ---- */
      el.querySelector(".rz-se").addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        startNodeResize(node, e);
      });

      /* ---- 白边框任意位置拉伸：四边 + 四角拉伸条 ---- */
      el.querySelectorAll(".mn-rz").forEach(h => {
        h.addEventListener("mousedown", e => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          startEdgeResize(node, h.dataset.dir, e);
        });
      });

      /* ---- 复制 / 删除节点 ---- */
      el.querySelector('[data-act="copy"]').addEventListener("click", e => {
        e.stopPropagation();
        const st = serializeState(el);
        const LG = window.LiteGraph || (window.litegraph && window.litegraph.LiteGraph);
        if (!LG) return;
        const n = LG.createNode(NODE_NAME);
        if (!n) return;
        app.graph.add(n);
        n.pos = [node.pos[0] + 30, node.pos[1] + 30];   // 落位前先显示在源节点旁
        n.properties = n.properties || {};
        n.properties.marknote = JSON.parse(JSON.stringify(st));
        if (n._mnEl) {
          applyState(n._mnEl, st, n);
          n._mnEl.classList.add("mn-ghost");   // 半透明副本，pointer-events:none
        }
        // applyState 会按状态重置节点外观，故在其后还原源节点的尺寸与配色，保证副本完全一致
        n.size = [node.size[0], node.size[1]];
        if (node.color !== undefined) n.color = node.color;
        if (node.bgcolor !== undefined) n.bgcolor = node.bgcolor;

        /* ---- 副本跟随鼠标，左键落位，Esc 取消（移植原型交互） ---- */
        const cv = (app.canvas && app.canvas.canvas) || document.querySelector("canvas.graph-canvas, #graph-canvas");
        const finish = (place) => {
          document.removeEventListener("mousemove", move, true);
          document.removeEventListener("mousedown", down, true);
          document.removeEventListener("keydown", onKey, true);
          if (n._mnEl) n._mnEl.classList.remove("mn-ghost");
          if (place) {
            save(n);
            try { app.canvas.selectNode(n); } catch (err) { }
          } else {
            app.graph.remove(n);   // Esc 取消
          }
          if (app.canvas) app.canvas.setDirty(true, true);
        };
        function toGraphPos(ev) {
          const r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
          const ds = app.canvas.ds || {};
          const s = ds.scale || 1, off = ds.offset || [0, 0];
          return [(ev.clientX - r.left) / s - off[0], (ev.clientY - r.top) / s - off[1]];
        }
        function move(ev) {
          const p = toGraphPos(ev);
          n.pos = [p[0], p[1]];                 // 副本左上角锚定到光标（与原型一致）
          if (app.canvas) app.canvas.setDirty(true, true);
        }
        function down(ev) {
          if (ev.button !== 0) return;
          ev.preventDefault(); ev.stopPropagation();   // 落位这一次点击不穿透
          finish(true);
        }
        function onKey(ev) {
          if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false); }
        }
        document.addEventListener("mousemove", move, true);
        document.addEventListener("mousedown", down, true);
        document.addEventListener("keydown", onKey, true);
        if (app.canvas) app.canvas.setDirty(true, true);
      });
      el.querySelector('[data-act="del"]').addEventListener("click", e => {
        e.stopPropagation();
        app.graph.remove(node);
      });

      /* ---- 字号：按比例（相对）缩放，保留每个文本自己的大小/颜色/字体 ---- */
      const clampPx = v => Math.max(10, Math.min(MAX_SIZE, v));
      const SCALE_UP = 1.05, SCALE_DOWN = 1 / 1.05;   // 每档 5%，缩放更细腻

      /* 整篇按比例缩放：编辑器基准 + 所有显式字号各自乘系数，保留各文本的字号差异；
         同时把 UI（标题栏/工具栏/logo/色块/M 按钮）按同一系数缩放 */
      function scaleAll(factor) {
        const base = parseFloat(getComputedStyle(editor).fontSize);
        if (!isNaN(base)) editor.style.fontSize = clampPx(base * factor) + "px";
        editor.querySelectorAll('span[style*="font-size"]').forEach(s => {
          const cur = parseFloat(s.style.fontSize);
          if (!isNaN(cur)) s.style.fontSize = clampPx(cur * factor) + "px";
        });
        setUiScale(el, getUiScale(el) * factor);
      }

      /* 选区缩放：保留选区文本现有的大小/颜色/字体，整体按比例放大/缩小，可无限次触发。
         关键：先在原位记录每个文本叶的"当前计算字号"，再提取内容并各自显式化，
         从而不丢失选区文本原本的大小（旧实现会把已放大的内容重新套回基准而失效）。 */
      function scaleSelection(factor) {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.getRangeAt(0).startContainer)) {
          scaleAll(factor); return;
        }
        const range = sel.getRangeAt(0);
        // 选中整篇 → 整篇缩放（避免把全部内容再包一层 span）
        let allSelected = false;
        try {
          const tr = document.createRange(); tr.selectNodeContents(editor);
          allSelected = range.compareBoundaryPoints(Range.START_TO_START, tr) === 0 &&
                        range.compareBoundaryPoints(Range.END_TO_END, tr) === 0;
        } catch (e) { }
        if (allSelected) { scaleAll(factor); return; }

        // 1) 在原位记录每个文本叶的当前计算字号（上下文尚未改变，取值准确）。
        //    根必须是 editor 而非 range.commonAncestorContainer：当选区落在单个文本节点上时，
        //    后者就是该文本节点自身，以它为根的 TreeWalker 不会遍历到自身，导致字号记录丢失。
        const tw = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
          acceptNode(n) { return range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
        });
        const textSizes = new Map();
        let t; while ((t = tw.nextNode())) textSizes.set(t, parseFloat(getComputedStyle(t.parentElement).fontSize));

        // 2) 提取选区内容到 wrapper（先挂回文档，保证后续计算样式正确）
        const frag = range.extractContents();
        const wrapper = document.createElement("span");
        range.insertNode(wrapper);
        wrapper.appendChild(frag);

        // 3) 选区内的显式 font-size 元素：直接乘系数
        wrapper.querySelectorAll('span[style*="font-size"]').forEach(s => {
          const cur = parseFloat(s.style.fontSize);
          if (!isNaN(cur)) s.style.fontSize = clampPx(cur * factor) + "px";
        });

        // 4) 文本叶：若其祖先（在 wrapper 内）没有显式 font-size，则按记录的当前字号×factor 显式化；
        //    若祖先已显式（第 3 步已乘系数），文本随其缩放，跳过以避免重复计算。
        const tw2 = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, null);
        const tnodes = []; let t2; while ((t2 = tw2.nextNode())) tnodes.push(t2);
        tnodes.forEach(tn => {
          let anc = tn.parentElement;
          while (anc && anc !== wrapper && anc !== editor) {
            if (anc.style && anc.style.fontSize) return;   // 祖先已乘系数 → 跳过
            anc = anc.parentElement;
          }
          const cur = textSizes.get(tn);
          const val = (cur != null && !isNaN(cur)) ? cur : parseFloat(getComputedStyle(tn.parentElement).fontSize);
          if (isNaN(val)) return;
          const sp = document.createElement("span");
          sp.style.fontSize = clampPx(val * factor) + "px";
          tn.parentNode.insertBefore(sp, tn);
          sp.appendChild(tn);
        });

        editor.normalize();
        // 还原选区到缩放后的内容，便于连续多次缩放
        const nr = document.createRange();
        nr.selectNodeContents(wrapper);
        sel.removeAllRanges(); sel.addRange(nr);
      }

      /* 量出「完整显示所有文本+图片」所需的节点总高（含可见栏体） */
      function measureNeed() {
        let chrome = 0;
        [".node-header", ".toolbar", ".node-footer"].forEach(sel => {
          const p = el.querySelector(sel);
          if (p) chrome += p.offsetHeight;      // 隐藏的元素（折叠/Mark 模式）自然为 0
        });
        let contentH = editor.scrollHeight;
        // 图片是绝对定位，不计入 scrollHeight：单独取最低图片的下边缘
        editor.querySelectorAll("img.note-img").forEach(img => {
          const bottom = img.offsetTop + img.offsetHeight;
          if (bottom > contentH) contentH = bottom;
        });
        return chrome + contentH + 8;            // 8px 余量，避免底边贴住滚动区
      }

      /* 只调整高度（growOnly=true 时只撑大、不回缩）。
         节点尺寸必须整体赋值 node.size=[w,h]，才能触发新前端的布局 setter。 */
      function autoFitHeight(growOnly) {
        if (!node || !node.size || !el.isConnected) return;
        const need = measureNeed();
        if (!need || !isFinite(need)) return;
        const h = Math.max(MIN_H, Math.ceil(need));
        if (growOnly ? h > node.size[1] + 1 : Math.abs(h - node.size[1]) > 1) {
          node.size = [node.size[0], h];
          if (app.canvas) app.canvas.setDirty(true, true);
        }
      }

      /* 量出「在给定节点宽度 Wt 下，完整显示所有文本+图片」所需的节点内容高度。
         探针直接模拟节点宽度为 Wt：探针带 .mn-node 类（自带节点内边距 P1），内部 .editor-wrap
         克隆体自带其内边距 P2，二者相减即文本区宽度 = Wt - P1 - P2，与真实节点宽度 Wt 的文本区
         完全一致。旧实现错误地再减去 padNode(=nodeW0-edW0)，导致双重扣边距、文本区被算窄、
         测高虚高，need 永远 > 高度，循环一路放到 MAXF=12 → 框被撑爆（测试环境 padNode≈0 故不显）。
         修正：探针宽度直接用 Wt，不再减 padNode。 */
      function contentHeightAtNodeWidth(Wt) {
        const edWrap = el.querySelector(".editor-wrap");
        if (!edWrap) return 0;
        const W = Math.max(60, Wt);
        const probe = document.createElement("div");
        probe.className = "mn-node";
        probe.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden;" +
          "display:block;width:" + W + "px;box-sizing:border-box;";
        const clone = edWrap.cloneNode(true);
        clone.style.height = "auto"; clone.style.maxHeight = "none";
        probe.appendChild(clone);
        document.body.appendChild(probe);
        let h = clone.scrollHeight;
        // 图片是绝对定位，不计入 scrollHeight：单独取最低图片的下边缘
        clone.querySelectorAll("img.note-img").forEach(img => {
          const b = img.offsetTop + img.offsetHeight;
          if (b > h) h = b;
        });
        document.body.removeChild(probe);
        return h;
      }
      function chromeHeight() {
        let c = 0;
        [".node-header", ".toolbar", ".node-footer"].forEach(sel => {
          const p = el.querySelector(sel); if (p) c += p.offsetHeight;
        });
        return c;
      }

      /* 缩放时宽高等比例变化（字体放大已在外部 scaleSelection 完成）：
         - 先检测：当前框是否已完整显示全部文本/图片；已装下则尺寸不动；
         - 放大：宽、高按同一系数 f 同步放大，f 从 1 起每次 ×SCALE_UP，用离屏克隆精确测量，
                 直到“在该宽度下内容所需高度 ≤ 该高度”为止（刚好装下即停，不溢出、不留空白）；
         - 缩小：宽、高按同一系数同步缩小一步，若缩小后装得下才提交，否则保持原尺寸（绝不裁切内容）。 */
      function fitSizeProportional(factor) {
        if (!node || !node.size || !el.isConnected) return;
        const chrome = chromeHeight();
        const w0 = node.size[0], h0 = node.size[1];
        const pad = 8;
        if (factor > 1) {
          const need0 = chrome + contentHeightAtNodeWidth(w0) + pad;
          if (!isFinite(need0) || need0 <= h0) {      // 当前已完整显示 → 不放大尺寸
            if (app.canvas) app.canvas.setDirty(true, true);
            return;
          }
          let f = 1, guard = 0; const MAXF = 12;
          while (guard++ < 100) {
            f *= factor;
            const Wt = w0 * f, Ht = h0 * f;
            const need = chrome + contentHeightAtNodeWidth(Wt) + pad;
            if (!isFinite(need)) break;
            if (need <= Ht + 1 || f >= MAXF) { node.size = [Math.round(Wt), Math.round(Ht)]; break; }
          }
        } else {
          const Wt = w0 * factor, Ht = h0 * factor;
          if (Wt >= MIN_W && Ht >= MIN_H) {
            const need = chrome + contentHeightAtNodeWidth(Wt) + pad;
            if (isFinite(need) && need <= Ht + 1) node.size = [Math.round(Wt), Math.round(Ht)];
          }
        }
        if (app.canvas) app.canvas.setDirty(true, true);
      }

      el.querySelector('[data-act="bigger"]').addEventListener("click", () => {
        scaleSelection(SCALE_UP); fitSizeProportional(SCALE_UP); schedule();
      });
      el.querySelector('[data-act="smaller"]').addEventListener("click", () => {
        scaleSelection(SCALE_DOWN); fitSizeProportional(SCALE_DOWN); schedule();
      });
      el.querySelector('[data-act="resetSize"]').addEventListener("click", () => {
        editor.style.fontSize = "";
        editor.querySelectorAll('span[style*="font-size"]').forEach(s => {
          s.style.fontSize = "";
          if (!s.getAttribute("style")) s.removeAttribute("style");
        });
        setUiScale(el, 1);
        // 节点宽、高一起回到默认尺寸（node.size 必须整体赋值才会触发布局）
        if (node && node.size) node.size = [DEFAULT_W, DEFAULT_H];
        autoFitHeight(true);    // 只撑大：内容超出默认框时继续加高，绝不缩到比默认更小
        schedule();
      });

      /* ---- 字体：无选区时整篇统一 ---- */
      fontSel.addEventListener("change", function () {
        const v = this.value;
        const sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed && editor.contains(sel.getRangeAt(0).startContainer)) {
          document.execCommand("fontName", false, v);
        } else {
          editor.style.fontFamily = v;
          editor.querySelectorAll('span[style*="font-family"],font[face]').forEach(n => {
            if (n.tagName === "FONT") n.removeAttribute("face");
            else { n.style.fontFamily = ""; if (!n.getAttribute("style")) n.removeAttribute("style"); }
          });
        }
        schedule();
      });

      /* ---- 指令按钮：无选区时全选后作用整篇 ---- */
      function selectAllEditor() {
        const r = document.createRange();
        r.selectNodeContents(editor);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
      }
      function refreshCmd() {
        const cmds = { bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strikeThrough" };
        Object.keys(cmds).forEach(c => {
          let on = false;
          try { on = document.queryCommandState(c); } catch (e) { }
          const b = el.querySelector('[data-cmd="' + c + '"]');
          if (b) b.classList.toggle("active", on);
        });
      }
      el.querySelectorAll(".tb-btn[data-cmd]").forEach(btn => {
        btn.addEventListener("mousedown", e => e.preventDefault());
        btn.addEventListener("click", () => {
          editor.focus();
          const sel = window.getSelection();
          if (!sel.rangeCount || sel.isCollapsed || !editor.contains(sel.getRangeAt(0).startContainer)) selectAllEditor();
          document.execCommand(btn.dataset.cmd, false, null);
          refreshCmd(); schedule();
        });
      });

      /* ---- 文字颜色 ---- */
      el.querySelector('[data-act="textcolor"]').addEventListener("click", e => {
        e.stopPropagation();
        activeEditor = editor;
        const sel = window.getSelection();
        pendingColorRange = (sel.rangeCount && !sel.isCollapsed && editor.contains(sel.getRangeAt(0).startContainer))
          ? sel.getRangeAt(0).cloneRange() : null;
        const pop = document.getElementById("mnColorPop");
        const r = e.currentTarget.getBoundingClientRect();
        pop.style.left = Math.min(r.left, window.innerWidth - 190) + "px";
        pop.style.top = r.bottom + 6 + "px";
        pop.classList.add("show");
      });

      /* ---- 链接 / 分割线 / 图片 ---- */
      el.querySelector('[data-act="link"]').addEventListener("click", e => {
        e.stopPropagation();
        activeEditor = editor;
        const sel = window.getSelection();
        pendingRange = (sel.rangeCount && editor.contains(sel.getRangeAt(0).startContainer))
          ? sel.getRangeAt(0).cloneRange() : null;
        const mask = document.getElementById("mnLinkMask");
        document.getElementById("mnLinkText").value = (sel && sel.toString()) || "";
        mask.classList.add("show");
        document.getElementById("mnLinkUrl").focus();
      });
      el.querySelector('[data-act="hr"]').addEventListener("click", () => {
        editor.focus();
        document.execCommand("insertHorizontalRule", false, null);
        updateEmpty(editor); schedule();
      });
      el.querySelector('[data-act="image"]').addEventListener("click", e => {
        e.stopPropagation();
        activeEditor = editor;
        document.getElementById("mnImgFile").click();
      });
      el.querySelector('[data-act="copytext"]').addEventListener("click", () => {
        fallbackCopy(editor.innerText);
      });
      el.querySelector('[data-act="clear"]').addEventListener("click", () => {
        editor.innerHTML = "";
        updateEmpty(editor); renderLineDelete(el); schedule();
      });

      /* ---- 背景色 ---- */
      el.querySelectorAll(".color-row .swatch").forEach(sw => {
        sw.addEventListener("click", e => {
          e.stopPropagation();
          const c = sw.dataset.color;
          el.querySelectorAll(".color-row .swatch").forEach(x => x.classList.remove("active"));
          sw.classList.add("active");
          if (c === "transparent") {
            el.classList.add("mn-transparent");
            wrap.style.background = "transparent";
            node.bgcolor = "rgba(0,0,0,0)";   // 让 LiteGraph 节点本体也透明，露出画布
            node.color = "rgba(0,0,0,0)";     // 边框同样透明
            editor.style.color = "#ffffff";
            editor.style.caretColor = "#ffffff";
          } else {
            el.classList.remove("mn-transparent");
            wrap.style.background = c;
            const LGc = window.LiteGraph || window.litegraph || {};
            node.bgcolor = LGc.NODE_DEFAULT_BGCOLOR || "#333333";
            node.color = LGc.NODE_DEFAULT_COLOR || "#3f3f3f";
            const m = c.match(/\w\w/g).map(h => parseInt(h, 16));
            const lum = 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
            if (editor.dataset.autoColor !== "false") {
              editor.style.color = lum > 150 ? "#1a1a1a" : "#fff";
              editor.style.caretColor = lum > 150 ? "#1a1a1a" : "#fff";
            }
          }
          schedule();
        });
      });

      /* ---- Mark 模式：隐藏工具栏/底栏，节点收缩到只剩文本框 ---- */
      const previewBtn = el.querySelector('[data-act="preview"]');
      function setMarkMode(on) {
        if (on) {
          const hH = header.offsetHeight, tH = toolbar.offsetHeight, fH = footer.offsetHeight;
          node._mnMark = { h: node.size[1] };
          el.classList.add("mark-mode");
          hideImgDel();                   // 收起图片删除叉/缩放手柄，Mark 模式下不可单独编辑图片
          node.size = [node.size[0], Math.max(MIN_H, node.size[1] - (hH + tH + fH))];   // setter 整体赋值
          pinMarkHeightForNode(node, true);   // 锁定高度，使文本裁切而非滚动/撑高
          const sel = window.getSelection();
          if (sel) sel.removeAllRanges();
        } else {
          const rest = node._mnMark;
          el.classList.remove("mark-mode");
          if (rest) { node.size = [node.size[0], rest.h]; node._mnMark = null; }   // setter 整体赋值
          pinMarkHeightForNode(node, false);   // 解除锁定，交还 ComfyUI 自适应高度
        }
        previewBtn.classList.toggle("active", on);
        editor.contentEditable = on ? "false" : "true";
        editor.style.cursor = on ? "default" : "text";
        if (app.canvas) app.canvas.setDirty(true, true);
        renderLineDelete(el); save(node);
      }
      previewBtn.addEventListener("click", e => {
        e.stopPropagation();
        setMarkMode(!el.classList.contains("mark-mode"));
      });
      editor.addEventListener("dblclick", () => {
        if (el.classList.contains("mark-mode")) setMarkMode(false);
      });

      /* ---- Mark 模式：按住文本区即拖动节点；双击文本退出 Mark 模式 ---- */
      editor.addEventListener("mousedown", e => {
        if (!el.classList.contains("mark-mode") || e.button !== 0) return;
        if (e.detail > 1) return;   // 双击的第二次按下：不拖拽，交给 dblclick 退出 Mark 模式
        e.preventDefault();
        e.stopPropagation();
        startNodeDrag(node, e);
      });

      /* ---- 行删除刷新 ---- */
      let raf = null;
      const schedule = () => {
        save(node);
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => renderLineDelete(el));
      };
      new MutationObserver(schedule).observe(editor, { childList: true, subtree: true, characterData: true });
      document.addEventListener("selectionchange", () => renderLineDelete(el));   // 光标移行时滑块跟随
      wrap.addEventListener("scroll", () => { hideImgDel(); renderLineDelete(el); });
      window.addEventListener("resize", () => renderLineDelete(el));

      /* ---- 快捷键 ---- */
      editor.addEventListener("keydown", e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        // 格式快捷键：在编辑器内消费，避免冒泡到 ComfyUI 画布被解释成全局快捷键
        if (k === "b" || k === "i" || k === "u") {
          e.preventDefault();
          e.stopPropagation();
          document.execCommand(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
          schedule();
          return;
        }
        // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y：只有最近的操作是文本编辑时，
        // 才在编辑器内做文本级撤销/重做；否则放行给 ComfyUI，让它撤销工作流操作。
        if (k === "z" || k === "y") {
          if (!shouldInterceptMnUndo()) return;
          e.preventDefault();
          e.stopPropagation();
          const cmd = k === "y" || e.shiftKey ? "redo" : "undo";
          try { document.execCommand(cmd); } catch (err) { }
          updateEmpty(editor);
          window._mnLastEdit = Date.now();
          save(node);
          return;
        }
      });

      /* ---- 失焦时把文本状态持久化到 properties（不触发图级 afterChange）。
         文本编辑本身不生成工作流 undo 快照；工作流操作触发 afterChange 时，
         interceptGraphUndo 里 patch 的 graph.afterChange 会先保存所有 MarkNote。 ---- */
      editor.addEventListener("blur", () => { save(node); });
    }
  }
});

/* 复制纯文本兜底 */
function fallbackCopy(text) {
  const done = () => { };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => legacy());
  } else { legacy(); }
  function legacy() {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { }
    ta.remove();
  }
}
