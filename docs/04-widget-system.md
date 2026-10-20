# 04 — 控件体系

## 1. 三件套

每个控件由以下部分组成：

- `xxxModel.ts`：Yjs 数据投影、schema 校验、写操作。
- `xxxVm.ts`：PIXI 视图、命中、几何、视觉预览。
- `xxxService.ts`：交互编排、工具状态、创建/编辑命令。

## 2. 注册表

- `WIDGET_REGISTRY`：type → schema + capabilities。
- `WIDGET_TOKENS` / `WIDGET_FACTORIES`：组合根装配 Model/Vm。
- 新增控件不修改 dataEngine/vmEngine；只扩展注册表和控件三件套。

## 3. 能力位

`rotatable` / `groupable` / `resizable` / `movable` / `selectable` /
`keepRatio` / `editable` / `referenceable` / `erasable`。

交互层通过 `TYPES_WHERE(cap)` 派生类型集合，避免散落硬编码。

## 4. 层级

`zOrder` 是 fractional indexing key，字典序即层级。新增控件默认追加到最上层；
图层操作只改 `zOrder`，不直接改 PIXI children 顺序。

## 5. 控件范围

当前支持 SHAPE / TEXT / STICKY / LINE / PEN / IMAGE / MIND_MAP。
MIND_MAP 的节点选中走焦点体系，不进入普通多选编组。
