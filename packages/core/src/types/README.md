# types/ — 契约层（接口先行）

所有 Service / Vm / Model 的 TS 接口与 zod schema 在此声明，实现类只 import 类型。

- `widget.ts`：IWidgetData 判别联合 + 各控件 zod schema（z.infer 出类型）
- `services.ts`：各 I*Service 接口
- `vms.ts`：各 I*Vm 接口、IOnStateChangedInfo = { diff, local }
- `events.ts`：全局事件流契约

约定：改实现前先改这里的契约；契约变更必须同步 docs 对应篇目。
