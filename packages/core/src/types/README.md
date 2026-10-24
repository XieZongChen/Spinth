# types/ — 契约层（接口先行）

所有 Service / Vm / Model 的 TS 接口与 zod schema 在此声明，实现类只 import 类型。

- `widget.ts`：IWidgetData 判别联合 + 各控件 zod schema + 能力位注册表
  （WIDGET_REGISTRY——schema 域单源；运行时域的 token/工厂在 src/widgetRuntime.ts）。
- `services.ts`：各 I*Service 接口。
- `base.ts`：IBaseModel / IBaseWidgetVm / IWidgetCapabilities / IOnStateChangedInfo。
- `index.ts`：统一导出。

约定：改实现前先改这里的契约；契约变更必须同步 docs 对应篇目（docs/02、docs/04）。
