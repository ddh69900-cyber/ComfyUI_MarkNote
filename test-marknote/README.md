# 测试套件

跑法（在仓库根目录 `dist/` 下）：

```bash
node test-marknote/font-license-check.cjs ComfyUI_MarkNote   # 字体授权合规
node test-marknote/font-offline-run.mjs                       # 字体离线可加载
node test-marknote/font-scale-run.mjs                         # 字号缩放
node test-marknote/editor-undo-run.mjs                        # 文本级撤销
node test-marknote/line-del-run.mjs                           # 行删除
node test-marknote/copy-node-run.mjs                          # 复制节点
node test-marknote/undo-run.mjs                               # 快照深拷贝
```

依赖：Node 18+、本机装有 Chrome（脚本里写死了常见安装路径）。
不需要安装 ComfyUI——`scripts/app.js` 是 mock 的最小 `app` / `LiteGraph` 实现。

`global-undo-run.mjs` / `check.mjs` 属于早期基于 CDP 的实验性测试，
依赖 9224/8128 固定端口与 Chrome profile 目录，未随包分发，请勿依赖。

**改了 `../ComfyUI_MarkNote/web/marknote.js` 后，务必先同步再跑测试**：

```bash
cp ComfyUI_MarkNote/web/marknote.js test-marknote/ComfyUI_MarkNote/web/marknote.js
```

> 注意：`test-marknote/ComfyUI_MarkNote/web/` 只能是**唯一**一份 marknote.js 副本。
> 出现第二份（如 `test-marknote/web/`）时，浏览器会把两者当独立 ES module，
> 各自持有独立的 mock app 状态，导致多节点隔离类断言失败。
