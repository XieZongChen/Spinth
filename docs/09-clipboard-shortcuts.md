# 09 — 剪贴板与快捷键

## 1. 剪贴板

写入双格式：

| 格式         | 内容                                                             | 用途                                                      |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `text/html`  | `<span data-spinth="base64(JSON.stringify(IWidgetSnapshot[]))">` | 结构化复制主载体（跨 tab / 跨设备）                       |
| `text/plain` | `JSON.stringify(IWidgetSnapshot[])`（与 HTML 标签同源）          | 粘贴解析的第一优先源；外部编辑器看到的是 JSON，属已知取舍 |

### 粘贴优先级

```
图片文件（png/jpg → imageService 资产入库）
  > 内部缓冲 buffer（同文档刚复制）
  > text/plain 的 JSON 快照
  > text/html（data-spinth 标签）
  > 纯文本建 TEXT
```

- 纯文本粘贴：非 JSON 纯文本 → `textService.pasteText`（经
  `clipboardService.onPastePlainText` 回调，platform 不反向 import widgets）——
  转义 `<>&` + 换行转 `<br>` 包 `<p>`，视口中心落点，默认宽 240 ×
  `measureDoc` 实测高度，单事务 + 选中。
- 粘贴落点 = 视口中心（`vpBounds` 中心）；相对布局保持；换 id；
  修正连线 `startNodeId/endNodeId` 引用（同批 idMap 映射，批外解绑 null）；
  粘贴件 zOrder = `genInitialOrder`（置顶）。
- 落点超出视口 → `zoomFromClipboard` 平移找回。
- 通道：
  - 快捷键：document 原生 copy/paste/cut 事件（可读 Files）；
  - 右键菜单：Async Clipboard API（`navigator.clipboard.write/read`）；
  - 脑图复制：节点按 Y 排序；粘贴 = 作为目标节点的子节点插入。
- 守卫：右键菜单打开 / 断网 / 只读时一票否决。

## 2. 快捷键

声明式注册表：

```ts
interface IShortcutDef {
  id: string; // 'tool.shape' / 'edit.undo'
  keys: string; // 'r' / 'cmd+z' / 'up+right'
  description: string;
  allowInReadonly?: boolean; // 视图类键 + esc
}
```

- `DEFAULT_SHORTCUTS`（shortcuts.ts 唯一权威）+ `KeyboardService.bindAll`
  按 id 分发到 `IShortcutHandlers`（组合根注入）。当前是 switch 分发，
  无用户改键能力。
- 编辑器内外分区：不走 hotkeys-js scope，靠 filter 闸门（`isEditableTarget` +
  capture 相快照）统一裁决。

### 快捷键清单

| 键                 | 动作                                                             |
| ------------------ | ---------------------------------------------------------------- |
| v / h              | 选择 / 抓手                                                      |
| r / t / l / p / s  | 形状 / 文本 / 连线 / 画笔 / 便签（脑图 m；橡皮 e）               |
| ] / [              | 橡皮增大 / 减小（步进 4 屏幕 px，4~40 钳制；仅 eraser 模式）     |
| space（按住）      | 临时抓手                                                         |
| cmd/ctrl+z         | 撤销；shift+cmd/ctrl+z 重做                                      |
| cmd/ctrl+c / v / x | 复制 / 粘贴 / 剪切                                               |
| delete / backspace | 删除选中                                                         |
| 方向键（+shift）   | 1px（10px）微移，支持八向组合                                    |
| cmd/ctrl+= / - / 0 | 放大 / 缩小 / 100% 精确归位                                      |
| f                  | 适应屏幕                                                         |
| cmd/ctrl+] / [     | 上移 / 下移一层（alt = 置顶 / 置底）                             |
| cmd/ctrl+g         | 编组；shift+cmd/ctrl+g 解组                                      |
| tab / enter        | 脑图子节点 / 同级节点                                            |
| esc                | 退出编辑 / 清选 / 取消工具（橡皮拖动中 = undo 本手势且不切模式） |

### filter 闸门

- contentEditable / INPUT / TEXTAREA 内不触发；TipTap `.ProseMirror` 区分编辑/选中态。
- 断网态可用：视图类缩放键 + f + esc；工具键被拦；space 临时抓手指在 hotkeys 体系外。
- 只读态：视图四键 + esc 可用；工具/删除/undo 被拦。

## 3. 验收

- [x] 复制矩形粘贴两次，id/zOrder/位置正确且互不影响。
- [x] 复制含连线的两个矩形，粘贴后连线引用指向新矩形。
- [x] 从外部粘贴纯文本生成 TEXT（转义/换行/落点/单事务）。
- [x] 编辑器内打字不触发全局快捷键；只读/断网闸门生效。
- [ ] 外部编辑器粘贴得到可读纯文本（当前 text/plain 是 JSON 快照）。
