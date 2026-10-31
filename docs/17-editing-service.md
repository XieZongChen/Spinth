# 17 — 统一编辑会话：EditingService 设计规格

## 0. 背景与现状

文字编辑能力统一到 `platform/textEngine/editingService.ts`：

| 编排层                           | 服务控件      | 内核                 | 行为                                    |
| -------------------------------- | ------------- | -------------------- | --------------------------------------- |
| `widgets/text/textService.ts`    | TEXT + STICKY | TipTap（html）       | enterEdit/34ms 节流/autoHeight/空删控件 |
| `widgets/line/lineTextEditor.ts` | LINE 文字     | TipTap（html）       | ratio 锚定/镂空喂框/空保线              |
| `widgets/mind/mindNodeEditor.ts` | mind 节点     | 裸 textarea（plain） | 树重排落库/Tab 建子/像素级对齐          |
| SHAPE 图形内文字                 | SHAPE         | TipTap（html）       | 内接矩形/autoHeight                     |

抽取动机：34ms 节流器三份重复、跨控件编辑无显式互斥、空文本策略散落、排版常量四散。
内核已经统一参数化——要抽的是编排层，不是重写编辑器。

## 1. 设计目标与落点

- **高可用**：显式全局互斥（单会话状态机）；退出路径统一 `exitActive`；
  空文本策略声明化。
- **高性能**：内核实例收敛；节流器一份；`onFrameChange` 即时量框；
  视口变化重放保留。
- **高扩展**：descriptor 是唯一接入面；新控件 = descriptor 工厂 + profile，
  零改引擎；内核注册制可扩。
- **高稳定**：四个消费方 public 面与流签名不变；每批全量验证；可单批回退。

## 2. descriptor 协议

```ts
export type EditKernelKind = 'html' | 'plain';

export interface IEditSessionDescriptor {
  widgetId: string;
  kernel: EditKernelKind;
  nodeKey?: string; // plain 内核重入判据（mind = nodeId）

  getRect(): { x: number; y: number; width: number; height: number };
  getContent(): string;
  style: IEditorAttachStyle | IPlainEditorStyle;

  onCommit(content: string): void;
  emptyTextPolicy: 'delete-widget' | 'keep';

  onEnter?(): void;
  onExit?(isEmptyText: boolean, meta: { discarded: boolean }): void;
  onFrameChange?(frame: { width: number; height: number } | null): void;

  onPlainKeyDown?(e: KeyboardEvent): boolean;
  plainCursor?: 'end' | 'selectAll' | { replaceWith: string };
}

export interface IEditingService {
  begin(descriptor: IEditSessionDescriptor): void;
  exitActive(opts?: { discard?: boolean }): void;
  readonly editingWidgetId: string | null;
  readonly activeKernel: EditKernelKind | null;
  readonly session$: Subject<void>;
}
```

约束：

- **互斥**：全局单活动会话。`begin` 抢占旧会话时走完整退出序列
  （flush → 空文本策略 → onExit → detach）。
- **退出序列**：`clearTimeout → flushWrite（尾字）→ 空文本策略 →
onExit → 内核 detach`。
- 内核 `onExit`（Esc/点外）改为“请求退出会话”，转发 `exitActive`；
  flush 顺序归服务。

## 3. 双内核

| 维度   | html 内核（TipTap）                    | plain 内核（textarea）                                  |
| ------ | -------------------------------------- | ------------------------------------------------------- |
| 控件   | TEXT / STICKY / LINE / SHAPE           | mind 节点                                               |
| 数据   | TipTap HTML 字符串                     | 纯字符串                                                |
| 落库   | `model.update({ text })`               | `MindNodeModel.setText` → observeSelf → 树重排          |
| 定位   | attachAndRemember + 视口重放           | commit 后重取 getRect 重定位                            |
| 键位   | Esc 退出 / Cmd+Z 转发 Yjs / Enter 换行 | Enter 提交退出 / Shift+Enter 换行 / Tab 建子 / Esc 丢弃 |
| IME    | TipTap 承载；同内容重入不重建          | 同节点重入不重建；首键竞态走“进编辑 + 全选”             |
| 空文本 | emptyTextPolicy 声明                   | keep（删节点走 Delete）                                 |

## 4. profile 与 per-实例排版

- 每个控件类型一个 profile 工厂 `styleOf(model) => style`，收编编辑视觉常量。
- 演进三步：
  1. schema 加可选排版字段（optional 无 default，旧文档零迁移）；
  2. `styleOf` 改为「model override → profile 默认」；
  3. 渲染层消费同源字段 + ActionBar 排版项。
- 已落地：
  - `TypoFields`：TEXT/STICKY 含 fontSize/textColor/align/lineHeight；
    SHAPE 全含（align 默认 center）；LINE 含 fontSize/textColor。
  - `resolveTextStyle / resolveStickyTextStyle / resolveShapeTextStyle /
editStyleOf` 统一解析。
  - 主题默认色：light/dark 两套；per-实例 textColor 优先；STICKY/SHAPE 不主题化。
  - ActionBar 字号六档/对齐三态/文字色板/行高四档 + 改档重排。

### C2 默认文字色主题化

TEXT/LINE 没有 per-实例 `textColor` 时，默认色随主题切换：app 壳 theme state →
`Board` theme prop → 门面 `setTheme`（公共投影）→ `setTextTheme` +
`vmEngine.refreshAll()`。light/dark 两套色值放在
`packages/core/src/platform/textEngine/theme.ts`；per-实例 override 优先。
STICKY/SHAPE 的底色固定，文字默认色不参与主题化。

- marks：span 感知断行、htmlToDoc、DocDisplay span 级 fill/italic/underline。
- SHAPE 图形内文字 + autoHeight（隐式默认开，手动改高即关；只撑不缩；
  空文本不撑高；text + height 一个事务）。

## 5. 迁移与验证

| 批  | 内容                          | 验证锚点                                          |
| --- | ----------------------------- | ------------------------------------------------- |
| 0   | 本篇 + 接口 + tokens          | lint/typecheck                                    |
| 1   | html 内核 + TEXT/STICKY 迁移  | textEditText.spec + 手动                          |
| 2   | LINE 迁移（descriptor 工厂）  | 线上文字组 E2E                                    |
| 3   | mind 并入（plain 内核）       | mindService.test + mindNodeEdit.spec 像素对齐/IME |
| 4   | 交叉互斥桩测试 + 编辑专项 E2E | 全套 E2E + 区分验证                               |

每批一 commit 全量三件套后推送；协议修订回写本篇。

## 6. 扩展点

- 新控件文字：一个 descriptor 工厂 + profile 注册，零改引擎。
- 第三内核（canvas 内联/多行 IME 专用）：按内核注册制扩展；会话状态机/节流/互斥复用。
- 排版扩展：schema 字段 + styleOf override + ActionBar schema 项。
- 图片/节点/线文字的编辑视觉共用 `IEditorAttachStyle`（anchor/widthMode/textAlign/frame）。

## 7. 明确不做

- 不改 IME 候选框跟随方案（docs/07 §8 挂账）。
- 不动 measure / docDisplay / textRenderService 渲染管线。
- 不做跨控件同时编辑；单会话是硬约束。
- 不在编辑器内维护独立 history；undo 统一走 Yjs UndoManager。
