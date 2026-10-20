# platform/ — 平台服务（引擎与横切能力）

按子目录组织，每个子目录 = 一个服务域，通常为 Service（逻辑）+ Vm（PIXI 视图）成对：

- `dataEngine/`：Yjs 数据引擎（文档结构、DataProcessor 统一写入口、db provider、replay、资产库/GC）
- `vmEngine/`：VM 引擎（订阅 onModelCreated$/onModelRemoved$，工厂建 VM，挂载/卸载 PIXI 树）
- `viewport/`：视口（PIXI Application、pixi-viewport、按需渲染）
- `selection/` `selector/`：选中体系（选框、阻尼拖拽、offset 法、对齐/编组）
- `refLine/`：参考线吸附、等间距
- `rectEditor/`：缩放手柄、旋转手柄、resize/rotate 数学
- `clipboard/`：双格式剪贴板
- `keyboard/`：声明式快捷键注册表（hotkeys-js）
- `history/`：撤销重做（Y.UndoManager 封装 + undo 栈治理）
- `textEngine/`：三态文本、测量引擎、纹理服务、统一编辑会话
- `layer/`：zOrder 业务管理（fractional indexing）
- `spatial/`：空间索引与 culling
- `contextMenu/`：右键菜单状态
- `network/`：物理断网守卫
- `awareness/`：未来协同光标（单机不启用）
- `registry/`：ServiceRegistry（轻量 DI）

规格详见 docs/02、03、05、06、09、10、16、17、19 各篇。
