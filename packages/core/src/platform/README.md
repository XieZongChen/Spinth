# platform/ — 平台服务（引擎与横切能力)

按子目录组织，每个子目录 = 一个服务域，通常为 Service（逻辑）+ Vm（PIXI 视图）成对：

- `dataEngine/`：Yjs 数据引擎（文档结构、DataProcessor 统一写入口、ws/db provider、replay）
- `vmEngine/`：VM 引擎（订阅 onModelCreated$/onModelRemoved$，工厂建 VM，挂载/卸载 PIXI 树）
- `viewport/`：视口（PIXI Application、pixi-viewport、按需渲染、点阵背景、缩略图导出）
- `selection/` `selector/`：选中体系（四种选框、阻尼拖拽、offset 法、边缘滚屏）
- `refLine/`：参考线吸附
- `clipboard/`：三格式剪贴板
- `keyboard/`：声明式快捷键注册表（hotkeys-js）
- `history/`：撤销重做（Y.UndoManager 封装 + undo 栈截断保护）
- `textEngine/`：富文本三态、测量引擎、纹理服务
- `layer/`：zOrder 业务管理（fractional indexing）
- `awareness/`：协同光标
- `registry/`：ServiceRegistry（轻量 DI）
- `tools/`：鼠标速度监控等辅助工具

规格详见 docs/02、03、05、06、09、10 各篇。
