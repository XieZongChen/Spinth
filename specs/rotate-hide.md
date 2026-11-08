# 旋转入口暂时隐藏（rotate hide）

## 0. 结论摘要

用户反馈图形旋转手感未达预期，拍板「先隐藏入口」。旋转的**唯一用户入口**是
画布上的旋转手柄（单选 SHAPE/TEXT/STICKY/IMAGE 时 rectEditor 绘制的圆点）；没有
ActionBar 按钮、右键菜单项、快捷键或公开 API 命令。隐藏方式：`WIDGET_REGISTRY`
四类 `rotatable: true → false`。rotation 数据能力全部保留，已旋转的旧文档与导入
的项目文件照常工作。

## 1. 入口分析

- **画布旋转手柄**（唯一入口）：`rectEditorVm.ts` rotateDot 绘制与命中，
  `rectEditorService.ts` startRotate/onRotateMove/onRotateUp 手势；闸门
  `rectEditorService.reposition()` 读 `capabilities.rotatable !== false`。
- **能力位来源**：各 Model 的 `capabilities` 是实例字段、从 `WIDGET_REGISTRY` 现取
  （不持久化进 Yjs 文档）——改注册表对新旧文档一律生效。`rotatable` 唯一消费点
  就是上述闸门（`TYPES_WHERE('rotatable')` 无调用方）。
- **不存在的入口**：ActionBar（仅对齐/分布/编组/导出/删除/样式）、ContextMenu、
  快捷键表、`BoardPublicApi` 65 成员——均无旋转入口。
- **保留不动的数据链路**：`rotation` 字段与四类 schema；pivot 渲染
  （`applyRootTransform`）；点选/SAT 框选命中；拖拽；旋转态缩放数学（逆旋转进局部、
  吸附跳过）；文字编辑框随 θ；连线 θ 感知重路由；参考线/等间距/连线四点的旋转件
  排除；undo/剪贴板（rotation 是普通模型字段）。

## 2. 拍板记录

- 隐藏入口、保留数据能力（不删代码、不迁移数据）。
- 已旋转的件在入口隐藏期间无法继续旋转或转回 0°（可 undo）。
- 「暂时」状态由 E2E 隐藏锁守护，恢复时需显式翻转（§5）。

## 3. 实施

- `types/widget.ts`：SHAPE/TEXT/STICKY/IMAGE `rotatable: false`，能力位注释写明
  入口暂隐藏与恢复方式。
- 调试面：`rectEditorVm.debugRotateHandle`（经 `rectEditorService.__rotateHandle`、
  `__spinthDebug.__debug.rotateHandle`）补 `visible`——坐标照算，柄是否渲染/命中
  由 visible 区分，E2E 用它锁隐藏态。
- 单测零改动：旋转单测直调内部接口（`vm.onRotateDown`）或纯函数，不经手柄闸门。

## 4. 测试处置

见 §6 映射表（E2E 适配完成后回填）。

## 5. 恢复步骤

1. `types/widget.ts` 四类 `rotatable` 改回 `true`（删除「入口暂隐藏」注释）。
2. E2E 去掉手柄用例的 `test.skip`；删除隐藏锁用例。
3. 视觉基线 rotate-45：维持数据注入版即可（与入口无关），或恢复手柄拖拽版并重做
   双平台基线。
4. 同步 docs/05 §8、docs/04 §4 能力表、AGENTS 当前状态、README 特性清单。
