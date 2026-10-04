# GitHub 发布指南

`dist/` 就是准备上传到 GitHub 的**仓库根目录**。本文档说明怎么发。

## 一、产物是什么

```
dist/
├── ComfyUI_MarkNote/            ← 插件本体（ComfyUI Manager 读这个目录）
│   ├── __init__.py
│   └── web/
│       ├── marknote.js
│       └── fonts/  (4 个 woff2 + LICENSE.txt)
├── ComfyUI_MarkNote-v1.0.0.zip  ← 手动安装用的压缩包
├── README.md                    ← 仓库首页（用户看的）
├── LICENSE                      ← MIT（代码）
├── .gitignore
└── test-marknote/               ← 测试套件（135 项断言）
```

总体积 21MB，其中字体 6.6MB。

## 二、关键：目录名必须是下划线

```
ComfyUI_MarkNote/     ✅ 下划线
ComfyUI-MarkNote/     ❌ 连字符 → ComfyUI 加载进度里节点归属会显示错误
```

`ComfyUI Manager` 通过扫描 `custom_nodes/` 下的子目录来发现节点，节点目录名必须以
`ComfyUI_` 开头且用**下划线**分隔。

## 三、上传步骤

### 1. 在 GitHub 建空仓库

打开 <https://github.com/new>：
- Repository name：建议 `ComfyUI_MarkNote`
- **不要**勾选 "Add a README file"（我们已经有了，否则会冲突）
- Public / Private 按需选

### 2. 关联并推送

```bash
cd dist
git init -b main
git add -A
git commit -m "Release v1.0.0"
git remote add origin https://github.com/<你的用户名>/ComfyUI_MarkNote.git
git push -u origin main
```

> 如果 git 提示没配身份：
> ```bash
> git config --global user.name "你的名字"
> git config --global user.email "你的邮箱"
> ```

### 3. 打 tag（让 Manager 能识别版本）

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

### 4. 创建 Release（可选但推荐）

GitHub 网页 → 该仓库 → **Releases** → **Draft a new release**
- Choose a tag：选刚推的 `v1.0.0`
- Release title：`v1.0.0`
- 描述可以从 README 摘一段
- **Attach files**：上传 `dist/ComfyUI_MarkNote-v1.0.0.zip`
- 点 **Publish release**

## 四、用户在 ComfyUI 里怎么装

### 方式一：Manager 一键装（仓库结构正确时可用）

1. ComfyUI 装好 **ComfyUI-Manager**
2. Manager → Custom Node Manager → 搜 `Mark Note` → Install
3. 重启后端，浏览器 `Ctrl+F5`

### 方式二：git clone

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/<你的用户名>/ComfyUI_MarkNote.git
# 重启后端
```

### 方式三：下载 zip 手动装

1. 下 `ComfyUI_MarkNote-v1.0.0.zip`
2. 解压到 `ComfyUI/custom_nodes/`
3. 确认最终路径是 `ComfyUI/custom_nodes/ComfyUI_MarkNote/__init__.py`
   （多套一层目录是最常见的安装失败原因）
4. 重启后端 + `Ctrl+F5`

## 五、发布前检查清单

- [ ] `python pack_release.py v<版本>` 无警告（语法、字体授权、测试配对全过）
- [ ] 在 `dist/` 下跑一遍测试确认包能用：
      ```bash
      cd dist
      node test-marknote/font-license-check.cjs ComfyUI_MarkNote
      node test-marknote/font-offline-run.mjs
      node test-marknote/font-scale-run.mjs
      node test-marknote/undo-run.mjs
      ```
      全部应显示 `FAIL count: 0`
- [ ] `ComfyUI_MarkNote/web/fonts/LICENSE.txt` **存在**（OFL 第 2 条强制要求，
      删掉就是许可证违约）
- [ ] `LICENSE`（MIT）存在
- [ ] README 里的安装路径写的是 `ComfyUI_MarkNote`（下划线）
- [ ] 仓库根没有 `dist/`、`.zip`、`cdpprofile_*` 等垃圾

> ⚠️ **不要在 `dist/` 里跑测试后再直接提交**。测试会生成 `test-marknote/cdpprofile_*`
> Chrome profile（单个 20-60MB）。要么先 `rm -rf dist/test-marknote/cdpprofile_*`，
> 要么在别处验证完再打包。

## 六、版本号约定

用语义化版本：
- `v1.0.0` — 首个正式版
- `v1.0.1` — 只修 bug
- `v1.1.0` — 加新功能

发新版时改两个地方：
1. `pack_release.py` 的调用参数 `python pack_release.py v1.1.0`
2. README 顶部如有版本徽章一并更新

## 七、许可与署名

- **代码**：MIT（`LICENSE`），可自由使用/修改/分发。
- **字体**：4 个中文 webfont 均为 SIL OFL 1.1（`ComfyUI_MarkNote/web/fonts/LICENSE.txt`），
  允许商用与随软件分发，**禁止单独售卖字体文件本身**。
- 排版出的**作品/工作流**不受 OFL 约束——用户分享工作流不需要额外授权。

如果有人在 issue 里问能不能用于商业项目：可以，OFL 明确允许。唯一要提醒的是
**不要单独把字体文件拿出来卖**。

## 八、常见问题

**Q: ComfyUI Manager 搜不到这个节点？**
A: 确认仓库结构是 `<仓库根>/ComfyUI_MarkNote/__init__.py`，
且目录名用下划线。Manager 不支持连字符命名的目录。

**Q: 装完节点不显示 / 点了没反应？**
A: 90% 是没重启后端。前端扩展只在后端启动时加载一次。

**Q: 能放进 ComfyUI-Manager 的官方节点列表吗？**
A: 可以，走 <https://github.com/ltdrdata/ComfyUI-Manager> 的
"Custom nodes list" PR。前提是仓库公开、有 README 和 LICENSE。

**Q: 字体能换成别的吗？**
A: 能。三处必须同步改：`web/fonts/` 文件、`FONTS` 数组、`FONT_FACE_LOCAL` 的
`@font-face`，以及 `web/fonts/LICENSE.txt` 的版权声明。改完跑
`node test-marknote/font-license-check.cjs ComfyUI_MarkNote` 验证。
