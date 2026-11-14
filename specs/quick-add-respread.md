# quick-add 点击落定补全量重排（同边槽位即时物化）

## 0. 结论摘要

从同一图形沿同一方向 quick-add 两个流程节点后，删掉其中一个图形，原图形到被删
图形的连线（悬空线）与原图形到另一节点的连线（幸存线）都会扭曲（S 形扭结）。
根因：quick-add 点击路径不触发拉线路径的落定重排，两条同边线的起点都停在连接
点 t=0.5，与 `(nodeId, join)` 派生槽位（0.4/0.6）不一致；删除形状时
`unbindFrom → respreadLines` 才第一次物化分组分配——幸存线起点跳槽并带避障全量
重路由（首尾锚点邻位 jog 不吸收 + R14 圆角 → 扭结），悬空线在下一次任意全量
重排时同样被扭。修复：quick-add 点击落定与拉线落定同源触发
`reattachAll`，槽位在创建时即物化。

## 1. 因果链

1. `quickAddConnectedShape`（connect/create 两分支）只写 `plan.route`（起点 =
   连接点圆点 t=0.5、路由不带避障），不调 `host.settle`/`onSettled`——对比
   拉线落定 `lineDrawSession.settle → onSettled → anchorFollow.reattachAll()`；
2. 两条同边线几何双 0.5、派生口径 n=2（期望 0.4/0.6），处于不一致态；
3. 删除 B：`unbindFrom` 把 A→B 线解绑（patch 不含 points，悬空线原位）但它的
   start 端仍留在 `(A,'right')` 组内计数 → `respreadLines` 重算幸存线 → 起点
   沿边跳 0.1×边长 + 整条 `routeElbow` 重路由（这次带 obstacles）→ 8px 竖向
   jog 不被 `absorbTinyJogs` 吸附（首尾锚点邻位 jog 不动是设计契约）→ 视觉
   S 形；悬空线自身在下一次 reattachAll（移动节点/画线落定/端点拖拽落定）时
   被同样重路由。

## 2. 实施

- `lineQuickAdd.ts`：`ILineQuickAddHost` 新增 `onSettled(): void`（与
  drawSession/endpointDrag 两宿主同命名）；`quickAddConnectedShape` 的 connect
  与 create 两分支在 `line.update(...)` 之后、`history.stopCapturing()` 之前调
  `this.host.onSettled()`——同一捕获窗，仍是单撤销单元；
- `lineService.ts` quick-add host 接线 `onSettled: () => anchorFollow.reattachAll()`；
- 修复后链路：第二条同边 quick-add 线创建时即物化 0.4/0.6（samePoints 守卫下
  单线场景零写）；删除目标形状时幸存线 samePoints 零写、悬空线按「解绑保持
  原位」契约不动——两条线都不再扭曲。ghost 预览与落定结果的细微差（分槽后
  起点挪动）与拉线工具行为一致，属设计语义。
- docs/08 §3 重排触发清单补「quick-add 点击落定」。

## 3. 测试

- 单测 `quickAddSettle.test.ts`（3 例）：create 分支 onSettled 顺序
  （update → onSettled → stopCapturing，n=1 零重排写）；connect 分支同序且
  重排时锚定已写入；真实 LineAnchorFollow 集成——两次同边 quick-add 后起点
  分居 0.4/0.6（132/148），删除目标后幸存线零重排写、悬空线原位；
- E2E `lineQuickAdd.spec.ts` 扇出用例追加：三线起点 y 互异（物化锁）+ 删除
  第一目标后悬空线 points 原位、幸存线起点槽位不跳（B 中心可能被折线穿过，
  选中 B 需扫内部点位）。

## 4. 单撤销单元收口（2026-11 审查返工补）

undo E2E 实测揪出存量缺陷：一次 quick-add 占两个撤销项、第一步 undo 暴露
「终点 [0,0] 草稿中间态」——新建形状首帧几何广播触发挂线 reattach 的滞后写
（vm root 未应用新帧，docs/02 幻影撤销项家族）落在创建事务 stopCapturing
之后成独立栈项；另 LineVm 初始 state 默认 lineType 'STRAIGHT' 与「新线一律
ELBOWED」不符，每条新建 ELBOWED 线首帧产生 lineType diff → 微任务相
rerouteLine 多写一次「spread 起点的怪路由」。修复：

- `lineVm.ts` 初始 state 默认 lineType 对齐 'ELBOWED'（首帧无 diff）；
- `quickAddConnectedShape` 两分支 `stopCapturing` 经 `queueMicrotask` 延后
  一拍（微任务相的滞后写并入同一捕获窗——微任务注册序保证滞后写先执行、
  切窗后执行）→ 一次 quick-add 恒一步 undo、一步 redo 完整恢复。

测试：`quickAddSettle.test.ts` 顺序断言改为「onSettled 同步、stopCapturing
微任务收尾」；E2E 新用例「quick-add 单撤销单元」——第二次 quick-add（建线+
建形+让位）Ctrl+Z 一步全等第一次后快照、redo 完整恢复。

## 5. 边界与挂账

- 悬空线仍占槽（删除 vs 删线的不对称是既有设计：悬空线待一键清理）；清理
  悬空线后组缩小、余线重均分，语义不变；
- 槽位按线 id 字典序分配，quick-add 上下分支与槽位上下可能不一致导致两线
  出边即交叉——与拉线工具同口径（E2E F-2 锁定 id 序），如需按落位方向定向
  分槽属后续独立批次。
