# 07 — 富文本：三态模型、测量引擎与两级渲染

## 1. 设计目标

Canvas 无法原生承载富文本编辑（IME、选区、光标），DOM 编辑器又无法随画布无限缩放。
方案：**编辑时用 DOM（TipTap 富文本 / textarea 纯文本双内核），非编辑时用 PIXI
纹理，两者逐像素对齐**。跨控件编辑会话编排见 docs/17；本篇管内核与渲染。

## 2. 三态模型

| 模式      | DOM                           | PIXI     | 用途                                                    |
| --------- | ----------------------------- | -------- | ------------------------------------------------------- |
| `preview` | 销毁                          | 纹理渲染 | 未选中                                                  |
| `select`  | 存在但 opacity:0 / 不接收指针 | 纹理渲染 | 预留规格，当前无调用方                                  |
| `edit`    | 可见可编辑                    | 纹理隐藏 | 进入编辑（TEXT/STICKY/SHAPE 单击已选中；LINE 双击线身） |

## 3. DOM-画布对齐

```
DOM 位置  = viewport.worldToClient(世界矩形)   // 页面坐标，fixed 容器挂 body
DOM 缩放  = transform: scale(vpScale), transformOrigin: 0 0
宽度      = fixed：控件宽 × scale；content：max-content（60~240 钳定）
锚点      = topleft / center
```

- DOM 容器全局唯一：`#spinth-text-layer`，fixed 定位，zIndex 1
  （画布之上、UI 层之下）。
- 视口平移/缩放（`vpScale$ / vpBounds$`）→ attach 参数缓存后重放。
- undo 统一走 Yjs UndoManager：编辑器内 Cmd/Ctrl+Z 不用 TipTap history，
  经回调转发到数据引擎。

### IME

- html 内核由 TipTap contenteditable 原生承载；同节点重入不重建，保住合成会话。
- plain 内核为 textarea 原生 + `isComposing` 保护（Tab/Enter 合成中不抢键）。
- IME 候选框跟随光标当前未实现（挂账）。

## 4. 内容模型（TipTap HTML 字符串）

- `text` 字段存 TipTap HTML 字符串（TEXT/STICKY/LINE/SHAPE 同语义；SHAPE 空文本归一空串）。
- 编辑器扩展集：`StarterKit(undoRedo: false) + TextStyle + Color`。
- 支持的 marks：粗体 `<strong>`、斜体 `<em>` / `<i>`、下划线 `<u>`、
  颜色 `<span style="color:…">`。
- 字号/对齐是控件级字段，不走 marks（§7.5）。
- 解析层：`htmlToDoc(html)` → 段落/strong/em/u/span[color]/br；LRU(500) 缓存。
  判空与纯文本降级走 `htmlToPlainText`。

## 5. 测量引擎

```
measureDoc(input: IDocInput, options): IDocView
IDocInput = { paragraphs, maxWidth, style }
IDocView  = Doc → Paragraph → Line → Span（带 rect 坐标的视图模型树）
```

- span 感知断行：字素流携带 bold/italic/underline/color；粗体/斜体宽度参与断行；
  行成后相邻同样式归并回 span。
- 断行策略：
  - `break-all`：`Intl.Segmenter` 字素迭代（中文/长串）；
  - `break-word`（默认）：空白分词整词放置 + 词内超宽按字素拆。
- 段落对齐在 measure 内烘进 span.rect.x，渲染层零对齐逻辑。
- 底层 Canvas `measureText`，`LruMeasureCache` 上限 2000，>128 字符不缓存；
  缓存键含 bold/italic/字号/字族，不含 color/underline。
- 输出由 `DocDisplay` 消费产出 PIXI 显示树（每 span 一个 Text）。
- 未实现：`overflow: hidden` / ellipsis（STICKY 纵向溢出靠换行约束）。

## 6. 两级文字渲染

```
默认：低清快照纹理
  resolution = max(1, MIN_TEXT_LINE_HEIGHT / lineHeight) × dpr

升级：视口相交 && lineHeight × scale > 10px
  → 真实文本渲染树（buildTextTree，每 span 一个 Text，resolution = scale × dpr）
     span 级 fill；italic → fontStyle；下划线手绘 Graphics 细线

已屏内后：分辨率漂移 > 10% 才原地调整（不重建树）
```

- 变换监听：`vpScale$ / vpBounds$` + `markDirty()`；rAF 帧合批。
- 超大文本按 WebGL `MAX_TEXTURE_SIZE` 二分切块生成纹理再拼回。
- 快照/内容切换时连同 `textureSource` 销毁，防 GPU 泄漏。
- STICKY/SHAPE 与 TEXT 共享本管线（常量/内接矩形不同）。

## 7. 编辑完成落库流程

```
descriptor（控件侧声明）→ EditingService.begin → 内核 attach
内核 onUpdate → 34ms 节流 → descriptor.onCommit(html)
  → model.update({ text }) → Vm observeDeep 重渲染
  → commitEdit 内 measureDoc 重测高度 → updateRect（autoHeight，drift > 0.5px 才写）
退出（Esc / 点外 / 抢占 / dispose）
  → flush 尾字 → 空文本策略 → onExit → detach
```

- 打字变宽不等节流：`onFrameChange` 同步量框（LINE 喂镂空）。
- 详细会话契约（互斥/重入/discard）见 docs/17 §2。

### 7.5 per-实例排版与主题化

- schema `TypoFields`（optional 无 default，旧文档零迁移）：TEXT/STICKY 含
  `fontSize/textColor/align/lineHeight`，SHAPE 全含（文字对齐默认 center），
  LINE 含 `fontSize/textColor`（align 恒 center；lineHeight 不 per-实例）。
- 解析同源：`resolveTextStyle / resolveStickyTextStyle / resolveShapeTextStyle /
editStyleOf` 统一「model override → 控件常量默认」。
- 主题化默认色：`platform/textEngine/theme.ts`（light/dark 两套）；per-实例
  `textColor` 优先；STICKY/SHAPE 文字不主题化（底色固定）。
  切换经 `BoardSDK.setTheme` → `vmEngine.refreshAll()`。
- ActionBar 排版项（字号/对齐/文字色/行高）与改档高度重排见 docs/17 §4。

## 8. 实现边界

- IME 候选框跟随光标未实现。
- 编辑期间 60fps 仍需真实设备持续验证。

## 9. 实现状态与已知边界

- 快照纹理 LOD、测量缓存、视口联动重评已落地。
- 低缩放下编辑文本会按节流频率重复生成快照（画布不可辨读，浪费可容忍）。
- 超大文本切块、STICKY 溢出裁剪、IME 候选框仍是挂账。
- 文本测量是纯逻辑，断行/对齐/缓存均有单测护栏。
