# base/ — 基类与生命周期

- `Disposable`：统一收集 Subscription / 函数 / Disposable，`dispose()` 一次释放。全部 Service 与 Vm 的内存管理基座。
- `BaseVm`：迷你 React 式渲染管线——`setState()` 合并 batchState → 微任务合批 → `forceUpdate()` 走 `shouldUpdate → beforeUpdate → render(prev, next) → afterUpdate`。
- `BaseWidgetVm`：持有 `model`，`setModel()` 模板方法（自动回调 `onModelUpdate` 钩子订阅 model 事件流），声明 `abstract hitTest`。

规格详见 docs/04-widget-system.md。
