# utils/ — 通用纯函数

与业务无关、可独立单测的纯函数：

- `id.ts`：短 id 生成（控件/节点标识）。
- `deepDiff.ts`：浅层字段 diff（Vm setState 广播用）。

与 common/ 的区别：utils 不知道“白板”是什么；common 知道。
