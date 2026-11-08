# 14 — 渲染同步与交互状态原则

> 这组规则来自拖拽/缩放系列 bug 的复盘：单测全绿、逻辑探针全对，但真实鼠标交互下
> 视觉与数据脱节。修改拖拽/缩放/选中框/编辑器框/参考线/连线跟随时必读。

## 0. 总原则：视觉反馈层与数据层必须同构

画布上的每个视觉对象都是同一份数据的投影。任何时刻、任何一帧，它们的几何必须一致。
出现“A 和 B 分家”，意味着某一层用了不同的状态源或更新时机——这是设计错误，不是小 bug。

## 规则 1：跟随框/视觉代理禁止增量累加——一律绝对定位

反模式：在“当前位置”上累加“相对拖拽起点的全量 delta”，每次 pointermove 加一遍，
移动 N 次 = 倍速漂移。

正确：`moveTo(initUnion.x + dx, initUnion.y + dy)`；视觉更新函数是
`f(初始状态, 当前输入) → 状态` 的纯函数，幂等。

## 规则 2：先渲染，后广播

```ts
setState(next)
  → diff 入队 pendingDiff
  → 微任务 flush → render(prev, next)（root 已是新几何）
  → afterUpdate → onStateChanged$.next({ diff, local })
```

订阅者可以无条件信任 `getBounds()` 返回最新几何。任何“先 emit 后改状态/渲染”的代码
都是违约。

## 规则 3：交互数学无状态化

一切从“起点 + 当前输入”推导；同一输入永远得到同一输出。拖拽/缩放/吸附处理函数
禁止读取“上一帧的自己”。屏幕→世界换算必须每帧现读，禁止跨帧缓存世界坐标
（边缘自动滚屏的重放补偿正建立在此之上：同一屏幕坐标重放 move 即补偿，
docs/05 §4.5）。测试必须包含同输入重复调用结果一致的幂等断言。

边界：参考线粘滞的会话状态（上一帧命中线）由 Service 持有，作为显式参数传入
吸附纯函数（docs/06 §3）——纯函数本身仍幂等（同输入同输出），与规则 5 记录
`lastDx/lastNext` 同类，不违反本条。

## 规则 4：几何读取必须缩放感知

```ts
getBounds(): IRect {
  const b = this.root.getLocalBounds();
  return {
    x: this.root.x,
    y: this.root.y,
    width: b.width * this.root.scale.x,
    height: b.height * this.root.scale.y,
  };
}
```

任何读取 PIXI 显示对象几何的封装，必须声明其对 scale 的行为。规则 2 的广播即使发生在
渲染后，若读取不感知 scale，视觉过程中仍然错误。

## 规则 5：松手落库用交互过程的最后一帧输出，不从视觉反推

交互过程记录数学输出的最后一帧（如 `ResizeState.lastNext`），松手直接落库。
视觉只是数学输出的投影，不能反向推导最终数据。

推广：points 世界坐标型（LINE/PEN）的 `getBounds()` = points bbox +
`root.position`（拖拽预览偏移）。漏掉 root 偏移时，拖拽中读取 getBounds 的跟随框
会钉在原地，出现“原地残留一个选中框、松手才消失”。

## 规则 6：交互几何按几何模型分派，统一入口、per-type 实现

- 交互几何的“视觉预览 + 落库”做成 `IBaseWidgetVm` 的四个可覆写方法：
  `applyDragPreview / commitDrag / applyResizePreview / commitResize`。
- 交互服务只调接口，`switch(type)` 的语义差异封装进各控件 Vm。
- points 重映射用无状态纯函数（`translatePoints / mapPointsRect`）。
- 新增控件 = 实现四个方法 + `hitTestPoint/hitTestRect`；禁止在交互服务里加类型分支。
- 拖拽创建类工具首帧创建后必须持续 `updateRect` 跟随光标，否则尺寸停在阈值触发帧。

## 调试方法论

1. **单测全绿 ≠ 架构正确**：装配/同步层 bug 必须真实输入端到端验证。
2. **截图会撒谎**：视觉断言必须配合 `__spinthDebug.__debug` 数据探针双重确认。
3. **合成事件 ≠ 真实输入**：真实鼠标有高频、小幅、来回晃动的 move 流；测试要模拟
   多次小幅 move + 方向反转。
4. **逐事件探针**：down/move/up 每一步快照数据位置与框坐标，对比该帧是否一致。
5. **黑匣子调试**：需要时按“每 150ms 采样状态 + 记录真实指针轨迹 + 捕获
   `[spinth:*]` 日志 + sessionStorage 备份”的方案临时重建，不进入生产。

## 回归测试

| 测试                                                       | 守卫的规则 |
| ---------------------------------------------------------- | ---------- |
| setState 广播发生在 render 之后，且回调内 getBounds 为新值 | 规则 2     |
| 同 tick 多次 setState 合并为一次广播、diff 字段合并        | 规则 2     |
| getBounds 在 scale ≠ 1 时返回缩放后尺寸                    | 规则 4     |
| SelectionVm.moveTo 幂等（重复设置无累加）                  | 规则 1     |
| resizeRect 幂等（同输入重复调用结果一致）+ 各方向语义      | 规则 3     |

相关套件：`renderSync.test.ts / interactionGeometry.test.ts / selectorDrag.test.ts /
rectEditor.test.ts`。
