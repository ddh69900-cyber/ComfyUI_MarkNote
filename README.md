# ComfyUI-MarkNote

> ComfyUI 画布上的富文本标注便签节点（**Mark Note**）。
> (这版本只能在comfyui node2.0测试版使用，请在菜单选择开启node2.0测试版后使用）

## 这是什么

<img width="735" height="541" alt="image" src="https://github.com/user-attachments/assets/243ff393-fba8-4250-bbcd-58223e1bafaf" />



在画布上随手贴一张便签：写文字、挑字体配色、插图、划分割线，还能折叠成一块干净的 Mark 标签。

- **纯前端 UI 节点**，不参与数据流（无输入/输出连线），`run()` 返回空元组。
- 所有内容（文字、字体、字号、颜色、背景、图片、Mark 模式）存在 `node.properties.marknote`，**随工作流一起保存**；复制粘贴工作流时会自动带上。
- 为 ComfyUI 新前端（Vue 3）开发，依赖 `node.addDOMWidget()` 与 CSS `:has()` 选择器。已在 ComfyUI 0.37.3 / 前端 1.52.7 上验证；旧版 canvas 前端无法使用。

### 兼容性

| 项目   | 说明                                                           |
| ---- | ------------------------------------------------------------ |
| 前端   | 仅 **ComfyUI 新前端（Vue 3 版）**；旧版 canvas 前端不可用                   |
| 验证版本 | ComfyUI 0.37.3 / 前端 1.52.7                                   |
| 浏览器  | 编辑快捷键依赖 `document.execCommand`，Chrome / Edge 正常，Firefox 部分受限 |

## 功能

| 功能                  | 说明                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| 标注文本                | 节点内直接编辑，支持粘贴富文本                                                                                                 |
| 字体                  | 10 款。系统字体：宋体 / 楷书 / 黑体 / 隶书 / 微软雅黑；**内置离线 webfont**：刘建毛草、马善政楷书、站酷快乐体、思源宋体                                       |
| 字号                  | A⁺ / A⁻ / 默认。**无选区**时整篇统一锚点缩放；**有选区**时只缩放选中部分。放大时节点宽高按同系数同步放大，缩小时绝不裁切内容                                         |
| 粗体 / 斜体 / 下划线 / 删除线 | 无选区时作用于整篇；支持 `Ctrl+B/I/U`                                                                                       |
| 对齐                  | 靠左 / 居中 / 靠右                                                                                                    |
| 文字颜色                | 彩虹 `A` 按钮弹面板（18 色 + 自定义取色器）                                                                                     |
| 自动换行                | 内置开启，无开关                                                                                                        |
| 插入链接                | 🔗 弹窗填网址与文字，新标签页打开                                                                                              |
| 分割线                 | — 按钮插入横线                                                                                                        |
| 插入图片                | 🖼 浏览本地图片。显示尺寸默认长边 200px 等比缩放；图片**绝对定位**，可在文本框任意位置拖拽；**单击图片**后右上角出现红色 ×（删除），右下角出现**缩放手柄**（等比缩放，按住 `Shift` 自由拉伸） |
| 行删除                 | **仅光标所在行**右侧显示红圆叉；**按住红叉展开滑块并向左拖**，**拉满**才删除整行（含该行所有混合格式，不留残字）；未拉满自动弹回；展开后点击任意处收起。防误删                           |
| 背景色                 | 底栏 8 个色块，含**透明**（透出画布后面的节点）；默认黑                                                                                 |
| 折叠                  | 标题栏左侧箭头折叠为只留标题栏                                                                                                 |
| Mark 模式             | 右下角绿色 `M`：节点收缩成只剩文本，超长文本**裁切**（不滚动、不撑高节点）；双击文字返回编辑；Mark 态图片与文本锁定相对位置，只能随节点整体拖拽                                  |
| 复制节点                | 标题栏 📋 复制出一个同设置的新节点（跟随鼠标落位，Esc 取消）                                                                              |
| 复制纯文本 / 清空          | 工具栏右侧 ⧉ / 🗑                                                                                                    |
| Logo                | 左下角纯白大写 `M`                                                                                                     |

### 快捷键

| 快捷键                            | 作用                          |
| ------------------------------ | --------------------------- |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | 加粗 / 斜体 / 下划线               |
| `Ctrl+Z` / `Ctrl+Y`            | 撤销 / 重做**当前便签的文字**（焦点在便签内时） |
| `Ctrl+Shift+D`                 | 显隐调试浮层（需先开启调试，见技术细节）        |
| `Esc`                          | 取消复制节点                      |

> 焦点不在便签内时，`Ctrl+Z` 走 ComfyUI 原生的图级撤销。

## 安装

### 方式一：ComfyUI Manager（推荐）

在 ComfyUI Manager 的 Custom Node Manager 里搜 `Mark Note`，点 Install。

### 方式二：git clone

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ddh69900-cyber/ComfyUI_MarkNote.git
# 重启后端
```

### 方式三：手动

1. 从 [Releases](https://github.com/ddh69900-cyber/ComfyUI_MarkNote/releases) 下载 `ComfyUI_MarkNote-vX.zip` 并解压，或从仓库把 `ComfyUI_MarkNote` 目录拷出来。
2. 放进 ComfyUI 的 `custom_nodes/` 下，**重启后端**，再浏览器 `Ctrl+F5` 强刷：

```
ComfyUI/
└── custom_nodes/
    └── ComfyUI_MarkNote/
        ├── __init__.py
        └── web/
            ├── marknote.js
            └── fonts/       # 4 个中文 webfont + LICENSE.txt
```

> ⚠️ 目录名请用 **`ComfyUI_MarkNote`（下划线）**。用连字符 `ComfyUI-MarkNote` 时，  
> ComfyUI 加载进度里这个节点的归属会显示到错误的包名下。

使用：画布空白处右键 → Add Node → **mark note** → **Mark Note**。

## 字体授权

内置的 4 个中文 webfont 均为 **SIL Open Font License 1.1 (OFL-1.1)** 的未修改原版：

| 字体                    | 版权声明                                             |
| --------------------- | ------------------------------------------------ |
| 刘建毛草 Liu Jian Mao Cao | Copyright 2020 Liu Jian                          |
| 马善政楷书 Ma Shan Zheng   | Copyright 2017 The Ma Shan Zheng Project Authors |
| 站酷快乐体 ZCOOL KuaiLe    | Copyright 2018 The ZCOOL KuaiLe Project Authors  |
| 思源宋体 Noto Serif SC    | Copyright 2012 Google Inc.                       |

**可以**：免费商用、随本扩展打包分发、在节点内 `@font-face` 加载、制作衍生版本。  
**不可以**：单独售卖字体文件本身；用作者名义为衍生版背书；改放到其他许可证下发布。

排版出来的**作品 / 工作流**不受 OFL 约束——分享工作流文件、导出图片，无需额外授权或付费。

合规细节：OFL 第 2 条要求分发时每份拷贝都附带版权声明与许可证全文。原始 woff2 的  
name 表未保留许可证正文，因此该义务由 **`web/fonts/LICENSE.txt`** 履行（含 4 条版权  
声明 + OFL 1.1 全文）；`web/marknote.js` 的 `FONT_FACE_LOCAL` 上方注释同时充当  
OFL 允许的 "human-readable header"。**若要再分发本扩展，请勿删除 LICENSE.txt。**

站酷快乐体的原始版权方为站酷（ZCOOL），站酷官方另有「免费授权全社会使用（包括商用）」  
的声明；Google Fonts 仓库中该字体以 OFL-1.1 发布，两者一致。

本项目代码本身采用 **MIT 许可**（见仓库根目录 `LICENSE`），字体许可与代码许可相互独立。

免责声明：以上为工程实践建议，不构成法律意见。商业分发前请自行核对  
`web/fonts/LICENSE.txt` 全文与 <https://openfontlicense.org>。

## 已知限制

- 节点是纯 UI 标注节点，**不参与数据流**（无输入/输出连线），`run()` 返回空元组。
- 图片以 DataURL 内联在 `node.properties.marknote` 里。插入时会自动重编码  
  （长边压到 1200px 的 JPEG q0.85）并拒绝超过 **4MB** 的原图，  
  以控制工作流 JSON 体积；要彻底解决需改成存到 `input/` 目录引用文件。
- 编辑快捷键依赖 `document.execCommand`（Chrome / Edge 正常，Firefox 部分受限）。
- 内置 4 个中文 webfont 合计约 6.6MB，均为 `font-display: swap`，首次用到才下载，不影响启动速度。

---

## 技术细节（开发者）

### 实现要点

- **挂载方式**：用 ComfyUI 官方的 `node.addDOMWidget()`，由前端把 DOM 定位到节点内  
  （`[data-testid="node-inner-wrapper"]`），随画布移动 / 缩放 / 折叠自动跟随。  
  CSS 依赖 `.lg-node:has(.mn-node)` 这个 descendant 选择器，所以 `.mn-node` 必须在节点根内部。
- 节点拖拽（标题栏）、八方向边缘拉伸、折叠、Mark 模式收缩，最终都写回  
  `node.pos` / `node.size`，与 LiteGraph 保持一致。  
  ⚠️ 新前端必须**整体赋值** `node.pos = [x,y]` / `node.size = [w,h]`，就地改数组下标会绕过 setter 完全无效。

### 与图级撤销（Ctrl+Z）的共存

MarkNote 是纯前端 DOM 节点，与 ComfyUI 的图级 undo/redo（ChangeTracker 整图回退）天然冲突。  
`web/marknote.js` 里为此做了一整套防御，**改动这块代码前请先读下面这段**：

1. **语义约定**：最近一步是文本编辑且焦点在编辑器内 → Ctrl+Z 撤销文字；  
   最近一步是工作流操作（移动 / 新建节点）→ Ctrl+Z 撤销工作流，不碰文字。
2. **快捷键拦截**：在 window / document 捕获阶段拦 Ctrl+Z/Y/B/I/U，转成编辑器文本级 undo。
3. **快照兜底**：patch `graph.beforeChange` / `graph.afterChange` / `LGraph.prototype.serialize`，  
   在任何序列化路径之前把 MarkNote 真实内容写进 `properties`，  
   保证 undo 快照里一定有内容（这是最根本的一层）。
4. **加载兜底**：`beforeConfigureGraph` 备份 → `afterConfigureGraph` 恢复，  
   并强制保留几何（size / pos / collapsed），避免节点被压成默认小尺寸或折叠灰框。
5. **元素重挂（关键）**：图级 undo 会 `clear()` 整个 graph，Vue 卸载节点组件时会把我们的  
   `.mn-node` 元素一起丢弃（变 detached）；随后 `configure()` 复用同一个 node 对象，  
   `onNodeCreated` / `addDOMWidget` 不再执行，Vue 也就不会重新挂载它。  
   `ensureLiveMnEl()` 会主动把元素 `appendChild` 回该节点当前的  
   `[data-testid="node-inner-wrapper"]`，并由 `afterConfigureGraph` 的轮询看门狗持续重试。  
   **如果节点又出现「灰框 / 内容丢失」，第一反应应该是这里，而不是去找"新元素"。**

### 调试

默认**不输出任何日志**。需要排查问题时在浏览器控制台执行：

```js
localStorage.setItem('mnDebug', '1'); location.reload()
```

开启后日志会同时写到 console（`[MN-DBG]` 前缀）和屏幕右上角的绿色浮层  
（桌面版 F12 打不开时用；`Ctrl+Shift+D` 显隐）。关掉：

```js
localStorage.removeItem('mnDebug'); location.reload()
```

### 本地开发与测试

```bash
git clone https://github.com/ddh69900-cyber/ComfyUI_MarkNote.git
cd ComfyUI_MarkNote

# 单元 / 集成测试（无头 Chrome + mock ComfyUI，无需安装 ComfyUI）
node test-marknote/font-license-check.cjs ComfyUI_MarkNote   # 字体授权合规
node test-marknote/font-offline-run.mjs                        # 字体离线可加载
node test-marknote/font-scale-run.mjs                          # 字号缩放
node test-marknote/global-undo-run.mjs                         # Ctrl+Z 语义
# ...其余见 test-marknote/
```

改完 `web/marknote.js` 后：

1. 同步到 `test-marknote/ComfyUI_MarkNote/web/marknote.js`（测试用的是副本，不同步会测到旧代码）；
2. 跑一遍全量回归；
3. 重新打包并部署到 `ComfyUI/custom_nodes/ComfyUI_MarkNote/`。

**增删字体必须三处同步**：`web/fonts/` 下的 woff2 文件、源码 `FONTS` 数组、  
`FONT_FACE_LOCAL` 的 `@font-face`，以及 `web/fonts/LICENSE.txt` 里的版权声明。  
漏改 `FONTS` 会出现「下拉里能选但字形没变」的静默失败（浏览器自动回退系统字体）。
