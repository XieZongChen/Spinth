# 边缘自动滚屏 — 技术方案与架构设计

> 范围：[docs/13 §2 阶段 1.3](../docs/13-roadmap.md)（发布前工程债的最后一项交互能力，不阻塞 1.4 运行时收窄）。
> 状态：**已实施**（按 §9 步骤 S0-S6 全量落地，实施记录与骨架修正见 §13）。
> 关联：[docs/05 §4.5](../docs/05-selection-drag.md)、[docs/14](../docs/14-render-sync-principles.md)、[docs/03 §5](../docs/03-render-engine.md)、[docs/16](../docs/16-performance.md)。
> 铁律核对：不新增 Yjs 写路径；不扩大 `BoardPublicApi`；不新增全局单例（服务走组合根显式装配）；非测试源码单文件 < 400 行。

## 0. 结论（拍板表，已按此实施）

| 编号 | 问题     | 结论                                                                                                          |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------- |
| D1   | 作用域   | 画布**元素拖拽** + **脑图节点拖拽**；框选、缩放/旋转手柄、创建类手势（形状/画笔/连线）不在本批                |
| D2   | rAF 归属 | 新建 `EdgeAutoScrollService` 独占 rAF 与热区数学；`SelectorService` 只上报指针位置与起停                      |
| D3   | 坐标补偿 | 输入层重放：`viewport.replayLastPointerMove()` 用最后一次**屏幕**坐标重算世界坐标，重走同一条 `onPointerMove` |
| D4   | 热区速度 | 56 屏幕 px 热区；三档 180 / 480 / 1080 屏幕 px/s；两轴独立；帧间隔钳制 50ms                                   |
| D5   | 方向符号 | 右/下边缘为**负**，左/上边缘为**正**（`panBy` 正值 = 内容右移 = 露出左侧世界；见 §2.3-①）                     |
| D6   | 启用条件 | 只在拖拽越过阻尼阈值之后启用；按下即滚屏会把世界坐标推过阈值，造成「没动鼠标却开始拖拽」                      |
| D7   | 可观测性 | 不新增 `__debug` 字段；E2E 用公开的 `vpBounds$` + `toScreenPoint` 断言                                        |
| D8   | 落库语义 | 不变：一次 `transact` = 一次撤销；松手仍用最后一帧 `lastDx/lastDy`（docs/14 规则 5）                          |

一句话：**滚屏只动视口，元素位置每帧由「当前指针屏幕坐标 → 世界坐标」重算；补偿靠重放同一条 move 路径天然成立，不做任何位置加法补偿。**

## 1. 目标与非目标

### 1.1 目标

| ID  | 目标                                                                             |
| --- | -------------------------------------------------------------------------------- |
| G1  | 拖拽进入任一边缘热区，画布按帧持续平移，被拖元素始终跟手（跟手误差 ≤ 1 屏幕 px） |
| G2  | 平移全程视觉与数据同构：松手落库位置 = 松手瞬间屏幕上看到的落点                  |
| G3  | 一次拖拽仍然只写一次 Yjs，一次撤销可完整回退                                     |
| G4  | 零 rAF 泄漏：任一停止途径后不再发生平移；`dispose` 幂等                          |
| G5  | 速度与刷新率无关：同样按住 300ms，120Hz 屏与 60Hz 屏总位移一致（≤ 5% 差）        |
| G6  | 可整体回退：能力集中在 `edgeAutoScroll*` 两文件 + 4 个集成点，摘掉即回到今日行为 |

### 1.2 非目标

- 不做惯性/缓动（松手不滑行），不做平滑加速曲线（本批是分档，见 D4）。
- 不滚屏框选（`marquee`，挂账到 1.0 发布后，见 §11.1）、不滚屏缩放/旋转手柄、不滚屏创建类手势。
- 不改视口持久化、不引入世界边界 `clamp`、不记忆上次视角。
- 不改阻尼阈值（`DRAG_TRACTION_SCREEN`）、不改吸附算法、不改 undo 粒度。
- 不为移动端单独做手势（`PointerEvent` 已统一，触控拖拽自动复用本机制）。
- 不改 `DragState` 的字段语义，不重写拖拽数学。

## 2. 现状与约束

### 2.1 代码地图

| 文件                                            | 现状                                                                                 | 本项关系                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| `.../platform/selector/selectorService.ts`      | 394 行；`onPointerMove` L238-264、`onPointerCancel` L266-282、`onPointerUp` L284-349 | 集成点（**只剩 6 行余量**）  |
| `.../platform/selector/selectorDragOps.ts`      | `applyDragMove` L84-120：`dx = e.world − startWorld`，绝对量                         | 不改（补偿的正确性来自它）   |
| `.../platform/viewport/viewportService.ts`      | 374 行；`panBy` L202-209、`getClientSize` L195-200                                   | 新增 `replayLastPointerMove` |
| `.../platform/viewport/viewportPointerInput.ts` | 229 行；`dispatch` L65-159 是唯一输入闸门，`info` 构造 L130-138                      | 新增 lastMove 快照 + 重放    |
| `.../widgets/mind/mindDragController.ts`        | 366 行；`dragMove` L174-194、`syncGhost` L149-157（世界坐标绝对定位）                | 只补一个 `moved` 只读访问器  |
| `.../widgets/mind/mindService.ts`               | L262 `get isDragging`；作为 `IMindDragDelegate` 绑定于 `boardAssemblyTools` L132     | 补 `isDragMoved`             |
| `.../boardAssemblyInteraction.ts`               | L37-49 装配 refLine→selector→group；L66 建 `editingService`                          | 建服务 + 接线 + 编辑会话闸门 |
| `.../boardTeardown.ts`                          | L38 `selector.dispose()`                                                             | 在它之前 dispose 新服务      |
| `.../boardPublicApi.ts`                         | `BoardInternalMember` L89-128（编译期分类锁）                                        | 新字段必须归类，否则 tsc 红  |
| `playwright.config.ts`                          | viewport 1440×900；dev server 形态                                                   | E2E 坐标基准                 |

行号以当前主干为准，实施时以符号名为准；表中 `.../` 省略了 `packages/core/src` 前缀。

### 2.2 必须保留的不变量

1. **拖拽中零 Yjs 写**：预览只改 `vm.root` 与选区框；落库只在松手（docs/00 铁律 3）。
2. **一次事务一次撤销**：`commitDrag` 包 `engine.transact`，`stopCapturing` 由 selector 调用。
3. **视觉绝对定位**：选区框 `moveTo(初始包络 + 全量位移)`，禁止增量累加（docs/14 规则 1）。
4. **位移是绝对量**：`applyDragMove` 每帧从「起点世界坐标 + 当前世界坐标」推导，不读上一帧输出（规则 3）。
5. **输入闸门唯一**：只读 / 物理断网 / 活跃指针过滤只在 `ViewportPointerInput.dispatch` 一处判定（L107-138）。
6. **手势取消唯一入口**：`dispatchGestureCancel`（切工具 / Esc / 只读降级 / blur / pointercancel）。
7. **单文件 < 400 行**，测试文件不设上限。

### 2.3 实施前必须知道的四个已核实事实

**① `panBy` 的注释与实现方向相反（本项最高风险）。**

`IViewportService.panBy` 的注释写「正 dx/dy 视口右/下移，内容视觉左/上移」。但 `panBy` 实现是 `viewport.x += dx`，而 pixi-viewport 的 `toScreen(world) = world × scale + position`（dist 中 `toScreen` 即 `toGlobal`，`corner = (-x/scale, -y/scale)`）。因此 **`panBy(+dx)` 让内容在屏幕上右移、露出左侧世界**。旁证：焦点跟随 `mindFocusController.followFocus`（L334）对「右侧越界的节点」传负数，正是靠这个方向把节点拉回可视区。

结论：本文所有方向一律以 §3.3 的表为准，**注释按实现改写**（§8 文档同步包含该条）。

**② 世界坐标每事件重算，视口平移天然反映在 `world` 上。**

`e.world = viewport.toWorld(e.global)`（`viewportPointerInput` L131）。视口平移 Δ 后，同一屏幕点的世界坐标变化 `−Δ / scale`。于是 `dx = world − startWorld` 自动扣掉平移量——**「用当前屏幕坐标重放 move」就是补偿本身**，不需要也不允许再把平移量加进 `lastDx`。

**③ 拖拽位移本来就是绝对量。**

`applyDragMove` 的 dx/dy 由起点与当前世界坐标推导，N 次重放同输入结果一致（幂等）。因此 rAF 每帧重放不会累积漂移；这是本方案能成立的前提。

**④ `SelectorService` 只有 6 行余量。**

394 行 + 本项 5 行 ≈ 399。任何「在 selector 里加一个有方法体的 replay」都会破 400 行铁律——这是 D3（补偿放在输入层）的直接理由之一。

## 3. 目标行为

### 3.1 触发几何

```text
┌────────────────────── 画布可视区 (clientWidth × clientHeight) ──────────────────────┐
│ ←56→                                                                        ←56→    │
│  ┌────┐                                                                     ┌────┐   │
│  │ 左 │          两轴独立判定，互不影响                                        │ 右 │   │
│  └────┘                                                                     └────┘   │
│       四角：两轴同时命中 = 斜向滚屏（分量各自取档，不做矢量归一化）                    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- 距离按**屏幕像素**算，与缩放无关（4× 放大时手感一致，世界位移变为 1/4）。
- 单轴：`d = min(到左边缘, 到右边缘)`，`d < 56` 才滚动；两轴各算各的。
- 指针移出可视区时坐标按边界钳制（`d = 0`，最高档）：拖到窗口外沿仍应持续滚屏，直到 `pointerleave` 停止（§3.5）。
- 容器尺寸为 0（未布局）时一律不滚（防御）。

### 3.2 速度分档

以深度 `t = 1 − d / 56 ∈ (0, 1]` 分为三档：

| 档位 | 深度区间        | 速度（屏幕 px/s） | 60Hz 单帧位移 |
| ---- | --------------- | ----------------- | ------------- |
| 慢   | `t ≤ 1/3`       | 180               | 3.0 px        |
| 中   | `1/3 < t ≤ 2/3` | 480               | 8.0 px        |
| 快   | `t > 2/3`       | 1080              | 18.0 px       |

- 数值是手感常数，集中定义在 `edgeScrollMath.ts`，按 §11 已拍板值落地；**分档语义与测试断言不随数值改动**（单调性、边界、档位归属）。
- 帧位移 = `速度 × dt`，`dt = clamp(now − lastFrameAt, 0, 50ms)`：后台标签页 rAF 暂停，回前台首帧的真实间隔可能是数秒，不钳制会瞬移。
- 不做归一化：直角区两轴各自满速（合矢量 1.41 档）。这是常见手感，也避免「斜向比直向慢」。

### 3.3 方向符号（实现前必须对齐）

| 指针位置 | 目的         | `panBy` 传值 | 屏幕上内容移动 |
| -------- | ------------ | ------------ | -------------- |
| 右边缘   | 露出右侧世界 | `x = −v·dt`  | 左移           |
| 左边缘   | 露出左侧世界 | `x = +v·dt`  | 右移           |
| 下边缘   | 露出下方世界 | `y = −v·dt`  | 上移           |
| 上边缘   | 露出上方世界 | `y = +v·dt`  | 下移           |

记忆法：`panBy` = 「抓住画布拖」，正值把画布往右下拖，所以往右下看要传负值。**写反的话四边全反，而单看画面「确实在滚」不易发现**——必须有单测钉死符号（§7.1 T2/T3）。

### 3.4 每帧时序

```text
rAF tick
  ├─ dt = clamp(now − lastFrameAt, 0, 50ms)；lastFrameAt = now
  ├─ dx = vx·dt/1000, dy = vy·dt/1000；两者皆 0 → stop
  ├─ viewport.panBy(dx, dy)                  // markRender + vpBounds$ 同步派发
  ├─ ok = viewport.replayLastPointerMove()    // 屏幕坐标重放 → toWorld 重算 → 同一 onPointerMove
  │    ├─ true ：预约下一帧
  │    └─ false：管线拒发 → panBy(−dx, −dy) 回滚本帧 → stop（E4）
  └─ requestFrame(tick)
```

`replayLastPointerMove` 走完整 `dispatch('move')` 路径，因此每帧还会顺带完成：世界坐标重算、awareness 光标节流更新、`applyDragMove`（吸附 → per-type 预览 → 选区框绝对定位 → `dragMove$` 广播 → `markRender`）。

### 3.5 状态机与停止条件

```text
       update(screen, dragging=true) 且进热区
[idle] ───────────────────────────────────► [scrolling]
  ▲   ◄───────────────────────────────────      │
  │        离开热区 / 任一停止条件                │ 每帧 panBy + replay
  └──────────────────────────────────────────────┘
```

| #   | 停止条件                  | 入口                                                                      | 是否结束拖拽     |
| --- | ------------------------- | ------------------------------------------------------------------------- | ---------------- |
| S1  | 指针移出热区              | `update()` 内判定                                                         | 否               |
| S2  | 拖拽未过阻尼              | `update(screen, false)`                                                   | 否               |
| S3  | 松手 / `pointerupoutside` | `SelectorService.onPointerUp` 首行 `stop()`                               | 是（正常落库）   |
| S4  | 手势取消                  | `onPointerCancel` 首行 `stop()`（Esc/切工具/只读降级/blur/pointercancel） | 是（不落库）     |
| S5  | 指针离开画布容器          | 服务内监听 `viewport.container` 的 `pointerleave`                         | 否               |
| S6  | 管线拒发                  | `replay` 返回 false（§5.3）                                               | 否               |
| S7  | 进入编辑会话              | 组合根订阅 `editingService.session$` → `stop()`                           | 否（本不会并发） |
| S8  | `dispose()`               | `boardTeardown`                                                           | 是               |

S1/S2/S5 只停滚屏不碰拖拽；S3/S4 由拖拽自身收尾（落库或回弹）。

### 3.6 为什么「重放」严格等价于「补偿」

设起拖时指针世界坐标 `w0`，当前屏幕坐标 `s` 固定，视口平移量 `Δ`（屏幕 px）：

```text
world(s)     = (s − x) / scale
x' = x + Δ   ⇒ world'(s) = world(s) − Δ/scale
dx' = world'(s) − w0 = dx − Δ/scale
元素屏幕位置 = toScreen(w0 + dx') = (w0 + dx − Δ/scale)·scale + (x + Δ) = 原屏幕位置
```

即**元素屏幕位置不变**——它始终钉在手指/鼠标下，这就是「拖拽与视口同时移动时坐标零漂移」（docs/05 §1）在滚屏场景的延续。反过来，只 `panBy` 不重放会让元素随画布滑走，出现「鼠标不动、元素逃跑」。

## 4. 关键决策与否定方案

### 4.1 D2：独立服务，而不是让 selector 内建循环

职责单一（热区/速度/帧循环是纯几何 + 调度，与选中语义无关）；行数（§2.3-④）；可测（热区是纯函数，帧循环用注入时钟确定性驱动，不依赖全局 fake timers）。

### 4.2 D3：补偿放在输入层，而不是 selector 内部

复用全部闸门（只读/断网/指针过滤），不可能出现「滚屏还在跑、输入已被吞」的分叉（E4）；一个入口同时覆盖元素拖拽与脑图节点拖拽，未来新增 stage 手势也自动获得补偿；selector 只加 1 行上报，不碰拖拽数学。

### 4.3 D6：只在越阈值后启用

若按下即启用：指针停在边缘不动，视口平移会把同一屏幕点的世界坐标推走，`applyDragMove` 的 `hypot(dx,dy)` 迟早越过 10px 阻尼——**用户没动鼠标，元素却开始被拖拽**。这是「阈值判定读世界坐标」与「视口会自动动」叠加出的新 bug 形态，必须用 D6 堵住。

### 4.4 被否方案

| 编号 | 方案                                           | 否决理由                                                                              |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| R1   | 在 `ViewportPointerInput` 里对所有手势自动滚屏 | 画笔/连线/形状创建会在指针不动时持续注入点或尺寸，语义错误；同样踩 4.3 的阈值陷阱     |
| R2   | `SelectorService` 内建 rAF 与 replay           | 破 400 行铁律（§2.3-④）；选中语义与相机数学混住，回滚成本高                           |
| R3   | 只平移视口、不重放                             | 元素随画布滑走，违反「视觉=数据」总原则（docs/14 §0）                                 |
| R4   | 不重放，改为把 `Δ/scale` 加进 `lastDx/lastDy`  | 把增量混进绝对量，正是规则 1 禁止的形态；且要改 `DragState` 契约与全部吸附/落库断言   |
| R5   | 连续速度曲线（`v = f(d)` 线性/缓动）           | 测试要断连续函数、调参无锚点；docs 既有口径是「分档」，先按分档落地，留调参入口       |
| R6   | 用 CSS/`scrollTop` 滚动容器                    | 画布是 PIXI stage + DOM 背景合成层，没有滚动容器；视口状态流 `vpBounds$` 是唯一真相源 |

## 5. 设计

### 5.1 文件与职责

| 文件                                                                     | 类型 | 职责                                                                                 | 预估 |
| ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------ | ---- |
| `.../platform/viewport/edgeScrollMath.ts`                                | 新增 | 纯函数：热区判定、分档速度、符号、dt 钳制、常量                                      | ~70  |
| `.../platform/viewport/edgeAutoScrollService.ts`                         | 新增 | 帧循环、状态机、`pointerleave` 监听、时钟注入、Disposable                            | ~150 |
| `.../platform/viewport/viewportPointerInput.ts`                          | 改   | lastMove 快照；`replayLastMove(): boolean`；dispatch 返回投递结果                    | +20  |
| `.../platform/viewport/viewportService.ts`                               | 改   | 暴露 `replayLastPointerMove()`（初始化前返回 false）                                 | +5   |
| `.../types/services.ts`                                                  | 改   | `IEdgeAutoScrollService`、`IViewportService` 新成员、`IMindDragDelegate.isDragMoved` | +20  |
| `.../platform/selector/selectorService.ts`                               | 改   | 5 行集成（§5.4）                                                                     | +5   |
| `.../widgets/mind/mindDragController.ts`                                 | 改   | `get moved()`                                                                        | +4   |
| `.../widgets/mind/mindService.ts`                                        | 改   | `get isDragMoved()`                                                                  | +4   |
| `.../boardAssemblyInteraction.ts`                                        | 改   | 构造 + 注入 + 编辑会话闸门                                                           | +6   |
| `.../boardHost.ts` / `app.ts` / `boardPublicApi.ts` / `boardTeardown.ts` | 改   | 宿主字段、SDK 字段、internal 归类、销毁                                              | +5   |
| `.../__tests__/edgeScrollMath.test.ts`                                   | 新增 | 纯数学                                                                               | ~120 |
| `.../__tests__/edgeAutoScroll.test.ts`                                   | 新增 | 帧循环/状态机/回滚                                                                   | ~150 |
| `.../__tests__/pointerReplay.test.ts`                                    | 新增 | 输入层重放与拒发                                                                     | ~90  |
| `.../__tests__/selectorEdgeScroll.test.ts`                               | 新增 | selector 集成（编排层）                                                              | ~100 |
| `packages/app/e2e/edgeAutoScroll.spec.ts`                                | 新增 | 真浏览器端到端                                                                       | ~120 |

### 5.2 契约（先写接口，后写实现）

```ts
// types/services.ts —— @internal（不进 BoardPublicApi；viewport 本身也不在公共名单）
export interface IEdgeAutoScrollService {
  /** 拖拽中指针 move 上报。dragging=false（未过阻尼/非拖拽）→ 立即停止。
   *  幂等：同一 (screen, dragging) 重复调用不改变行为（重放路径会重复调用它）。 */
  update(screen: IPoint, dragging: boolean): void;
  /** 停 rAF、清速度、摘 pointerleave 监听。可重复调用。 */
  stop(): void;
  /** 是否在滚屏（单测断言用；E2E 优先看 vpBounds$） */
  readonly scrolling: boolean;
  dispose(): void;
}

// IViewportService 新增（@internal）
/** 以最后一次记录的屏幕坐标重放一次 move：世界坐标按当前视口重算，走完整 dispatch 闸门。
 *  返回 false = 管线拒发（只读/断网/当前模式无 handler）。 */
replayLastPointerMove(): boolean;

// IMindDragDelegate 新增（接口上可选以兼容旧桩，本批 MindService 必须实现）
/** 节点拖拽是否已越过判拖阈值（自动滚屏的启用条件；缺省视为未拖起） */
readonly isDragMoved?: boolean;
```

```ts
// platform/viewport/edgeScrollMath.ts
export const EDGE_SCROLL_ZONE_PX = 56;
export const EDGE_SCROLL_TIERS_PX_PER_S = [180, 480, 1080] as const;
export const EDGE_SCROLL_DT_CLAMP_MS = 50;

export interface IEdgeScrollVelocity {
  x: number;
  y: number;
}

/** 单轴：距边距离（屏幕 px）→ 带符号速度（px/s，符号见 §3.3，0 = 不进热区） */
export function edgeScrollAxisVelocity(position: number, extent: number, zone?: number): number;

/** 指针屏幕坐标 + 视口尺寸 → 两轴速度（px/s） */
export function resolveEdgeScroll(
  screen: { x: number; y: number },
  size: { width: number; height: number },
  zone?: number,
): IEdgeScrollVelocity;

/** 帧间隔钳制到 [0, 50] */
export function clampFrameDt(dtMs: number): number;
```

```ts
// platform/viewport/edgeAutoScrollService.ts
export interface IEdgeScrollClock {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}
/** 生产默认：rAF + performance.now；node（无 rAF）降级 setTimeout(16) */
export const EDGE_SCROLL_CLOCK: IEdgeScrollClock;

export class EdgeAutoScrollService extends Disposable implements IEdgeAutoScrollService {
  constructor(viewport: IViewportService, clock?: IEdgeScrollClock);
}
```

### 5.3 算法

```ts
// 纯函数：单轴
function edgeScrollAxisVelocity(position, extent, zone = EDGE_SCROLL_ZONE_PX): number {
  if (!(extent > 0)) return 0; // 未布局（E6）
  const left = position; // 超出左侧为负 → 钳到最高档
  const right = extent - position;
  if (left <= right && left < zone) return +speed(left); // 露出左侧 = 内容右移
  if (right < left && right < zone) return -speed(right); // 露出右侧 = 内容左移
  return 0;
}

function speed(distance) {
  const t = 1 - Math.max(0, distance) / EDGE_SCROLL_ZONE_PX; // (0, 1]
  const tier = t <= 1 / 3 ? 0 : t <= 2 / 3 ? 1 : 2;
  return EDGE_SCROLL_TIERS_PX_PER_S[tier];
}
```

```ts
// 服务骨架（落地时按 400 行与可读性调整）
class EdgeAutoScrollService {
  update(screen: IPoint, dragging: boolean): void {
    if (!dragging) return this.stop(); // S2
    const v = resolveEdgeScroll(screen, this.viewport.getClientSize());
    if (!v.x && !v.y) return this.stop(); // S1
    this.velocity = v;
    if (this.frameId === null) this.start();
  }

  private start(): void {
    this.lastFrameAt = this.clock.now(); // 首帧 dt 从 0 起算
    this.onLeave = (): void => this.stop(); // S5
    this.viewport.container?.addEventListener('pointerleave', this.onLeave);
    this.frameId = this.clock.requestFrame(this.tick);
  }

  private tick = (): void => {
    this.frameId = null;
    const now = this.clock.now();
    const dt = clampFrameDt(now - this.lastFrameAt);
    this.lastFrameAt = now;
    const dx = (this.velocity.x * dt) / 1000;
    const dy = (this.velocity.y * dt) / 1000;
    if (!dx && !dy) return this.stop();
    this.viewport.panBy(dx, dy);
    if (!this.viewport.replayLastPointerMove()) {
      // S6 管线拒发：回滚本帧，避免画布空转（E4）
      this.viewport.panBy(-dx, -dy);
      return this.stop();
    }
    this.frameId = this.clock.requestFrame(this.tick);
  };

  stop(): void {
    // cancelFrame(frameId)；frameId = null；velocity = {0,0}；摘 pointerleave
  }
}
```

```ts
// viewportPointerInput.ts
type IMoveSnapshot = {
  x: number;
  y: number;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pointerId?: number;
};

class ViewportPointerInput {
  /** 记录最近一次**已投递**的 move（被闸门拦下的不记录） */
  private lastMove: IMoveSnapshot | null = null;

  replayLastMove(): boolean {
    const m = this.lastMove;
    if (!m) return false;
    return this.dispatch('move', { global: new Point(m.x, m.y), ...m }); // dispatch 改为返回 boolean
  }
}
```

`dispatch` 的每个早退点返回 `false`，投递完成返回 `true`；`lastMove` 在闸门之后写入。

### 5.4 接线

```ts
// boardAssemblyInteraction.ts（在选择器之前构造；惰性 getter 模式同 refLine）
sdk.edgeScroll = new EdgeAutoScrollService(sdk.viewport!);
sdk.selector = new SelectorService(
  sdk.viewport!,
  sdk.vmEngine!,
  sdk.engine!,
  sdk.history!,
  () => sdk.refLine!,
  () => sdk.group!,
  sdk.edgeScroll, // 第 7 个构造参数，缺省 null（旧桩零改动）
);
// 编辑会话闸门（S7）：editingService 在 selector 之后构造，就地订阅
// （订阅随页面生命周期；若要求严格，保存句柄并在 boardTeardown 退订）
sdk.editingService!.session$.subscribe(() => sdk.edgeScroll?.stop());
```

`selectorService.ts` 的 5 行集成（**不得再多**）：

| 位置                     | 追加                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 构造函数                 | `private edgeScroll: IEdgeAutoScrollService \| null = null`                                                   |
| `onPointerMove` 元素分支 | `applyDragMove(...)` 之后：`this.edgeScroll?.update(e.screen, this.dragState.moved)`                          |
| `onPointerMove` 脑图分支 | `this.dragMove$.next()` 之后：`this.edgeScroll?.update(e.screen, this.mindDragDelegate.isDragMoved ?? false)` |
| `onPointerUp` 首行       | `this.edgeScroll?.stop()`                                                                                     |
| `onPointerCancel` 首行   | `this.edgeScroll?.stop()`                                                                                     |

销毁：`boardTeardown` 在 `host.selector?.dispose()` **之前**插入 `host.edgeScroll?.dispose()`。
公共面：`app.ts` 加字段 `edgeScroll: EdgeAutoScrollService | null = null`，并把 `'edgeScroll'` 加入 `BoardInternalMember`——否则 `_BoardKeysClassified` 编译失败（设计好的护栏，不是意外）。

### 5.5 为什么不再提供 selector 级 replay

见 §2.3-④ 与 D3。补充：若把 replay 放 selector，脑图路径要再实现一份（`dragMove` 需要 `world`），两份重放迟早分叉；放输入层则两种拖拽共用一条路径，未来新增 stage 手势自动获得补偿。

## 6. 边界与竞态

| 编号 | 场景                                | 行为                                                                                         |
| ---- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| E1   | 拖拽中切工具 / Esc                  | `dispatchGestureCancel` → `onPointerCancel` 首行 `stop()`，先停滚屏再回弹预览                |
| E2   | 拖拽中转只读 / 断网                 | 同上（`updateEditable` 降级序列）；即使漏了，E4 的回滚也兜得住                               |
| E3   | 窗口失焦 / `pointercancel`          | 输入层的 blur/cancel watchdog → S4                                                           |
| E4   | 滚屏中管线开始拒发                  | `replay` 返回 false → 回滚本帧 → stop；避免「画布空转、元素脱手」                            |
| E5   | 后台标签页 → 回前台                 | rAF 暂停期间无帧；回前台首帧 dt 钳到 50ms，不瞬移                                            |
| E6   | 容器 0×0                            | `resolveEdgeScroll` 返回 0 → 不起帧                                                          |
| E7   | 指针离开画布容器                    | `pointerleave` → S5；回来后新的 move 会重新进热区                                            |
| E8   | 滚屏中缩放（Cmd+滚轮）              | 速度是屏幕 px/s，与 scale 无关；`toWorld` 每帧现算，补偿依旧成立                             |
| E9   | 滚屏中另一端 undo / 远端改几何      | 预览由 `initial` 快照与 `lastDx` 驱动，不受影响                                              |
| E10  | `pointerup` 落在 rAF 与 commit 之间 | `onPointerUp` 首行 `stop()`，不会「先落库后平移」；commit 用 `lastDx/lastDy`，与末次重放一致 |

## 7. 测试方案

### 7.1 单测：`edgeScrollMath.test.ts`

| #   | 用例                                                                          |
| --- | ----------------------------------------------------------------------------- |
| T1  | 中心区域 → `{0,0}`                                                            |
| T2  | 右边缘 → `x < 0`；左边缘 → `x > 0`（**符号钉死**，防 §2.3-① 反着实现）        |
| T3  | 下边缘 → `y < 0`；上边缘 → `y > 0`                                            |
| T4  | 分档归属：`d = 55.9 / 37.4 / 18.7 / 0` 分别落慢/慢/中/快档，边界值不漏判      |
| T5  | 单调性：`d` 递减时速度绝对值不减（同档内相等、跨档跳变）                      |
| T6  | 直角区两轴同时非 0                                                            |
| T7  | 指针越过边界（`x = −30`、`x = width + 30`）→ 钳到最高档且符号正确             |
| T8  | `extent ≤ 0` → `{0,0}`                                                        |
| T9  | `clampFrameDt(-5) = 0`、`clampFrameDt(500) = 50`、`clampFrameDt(16.7) = 16.7` |
| T10 | 60Hz / 120Hz 等价：同样 300ms，总位移差 < 5%（G5）                            |

### 7.2 单测：`edgeAutoScroll.test.ts`（注入假时钟）

| #   | 用例                                                                             |
| --- | -------------------------------------------------------------------------------- |
| T11 | `update(中心, true)` → 不起帧、不调 `panBy`                                      |
| T12 | `update(右热区, true)` → 起帧；推一帧 → `panBy` 一次且 `dx = v·dt/1000`（负值）  |
| T13 | 连推 3 帧 → `panBy` 三次，累计位移 ≈ v × 总时长                                  |
| T14 | `update(中心, true)` → 停帧；再推帧无 `panBy`                                    |
| T15 | `update(热区, false)`（未过阻尼）→ 不起帧（D6 的回归）                           |
| T16 | 重复 `update` 同参数 → 不重复起帧（幂等）                                        |
| T17 | `replayLastPointerMove` 返回 false → `panBy(dx)` 后紧跟 `panBy(−dx)` 并自动 stop |
| T18 | `stop()` 取消已预约帧（假时钟断言 pending 为 0）；重复 `stop()` 幂等             |
| T19 | `dispose()` 后 `update` 无效、无监听残留                                         |
| T20 | `pointerleave` → 停帧                                                            |

### 7.3 单测：`pointerReplay.test.ts`

| #   | 用例                                                                   |
| --- | ---------------------------------------------------------------------- |
| T21 | 一次 move 后重放 → handler 再收到同一 `screen`，`world` 按当前视口重算 |
| T22 | 视口平移后重放 → `world` 位移 = `−Δ/scale`（§3.6 的等式）              |
| T23 | 无 move 记录 → 返回 false，不调 handler                                |
| T24 | `editable$ = false` → 返回 false（闸门生效）                           |
| T25 | 当前模式未注册 handler → 返回 false                                    |
| T26 | 被闸门拦下的 move 不进入 lastMove 快照                                 |

### 7.4 单测：`selectorEdgeScroll.test.ts`（编排层，沿用 `selectorDrag.test.ts` 的桩）

| #   | 用例                                                                                |
| --- | ----------------------------------------------------------------------------------- |
| T27 | down → move 过阻尼 → `update` 收到 `dragging=true`                                  |
| T28 | down → move 未过阻尼 → `update` 收到 `dragging=false`                               |
| T29 | up → `stop()`；cancel → `stop()`（两分支各一次）                                    |
| T30 | 脑图分支：`isDragMoved=false` 时 `dragging=false`；为 true 时 `true`                |
| T31 | 重放同屏幕坐标两次 → `applyDragPreview` 收到相同 `(init, dx, dy)`（幂等，规则 1/3） |

### 7.5 E2E：`packages/app/e2e/edgeAutoScroll.spec.ts`

坐标一律用 `canvas.boundingBox()` + `toScreenPoint` 换算，禁止裸写页面坐标（顶栏高度会变）。

```ts
// 1) 建一个矩形，按住中心拖到右热区并停住
const box = await page.locator('canvas').boundingBox();
const p = await page.evaluate(
  ([x, y]) => (window as any).__spinth.toScreenPoint({ x, y }),
  [rect.x + rect.width / 2, rect.y + rect.height / 2],
);
const before = await page.evaluate(() => (window as any).__spinth.vpBounds$.getValue());

await page.mouse.move(box.x + p.x, box.y + p.y);
await page.mouse.down();
await page.mouse.move(box.x + p.x + 24, box.y + p.y, { steps: 4 }); // 过阻尼
await page.mouse.move(box.x + box.width - 12, box.y + p.y, { steps: 8 }); // 进右热区

// 2) 视口确实在滚（只查公开流）
await page.waitForFunction(
  (x0) => (window as any).__spinth.vpBounds$.getValue().x > x0 + 80,
  before.x,
  { timeout: 5_000 },
);

// 3) 元素仍然跟手（G1/G2 的核心断言）
//    vm = 拖拽中该件的 __debug.vmStates 数据左上；grabOffset = 按下时指针屏幕坐标 − 元素屏幕左上
const screen = await page.evaluate(
  ([x, y]) => (window as any).__spinth.toScreenPoint({ x, y }),
  [vm.x, vm.y],
);
expect(Math.abs(screen.x - (pointerScreenX - grabOffset.x))).toBeLessThan(2);
```

| #   | 用例                                                                                              |
| --- | ------------------------------------------------------------------------------------------------- |
| E-1 | 右侧热区：`vpBounds$.x` 增长 ≥ 80，元素屏幕位置与指针偏移保持 ≈ `grabOffset`（±2px）              |
| E-2 | 松手后数据位置 = 起点 + 指针位移 + 滚屏位移；`Cmd+Z` 一次回到原位（G3）                           |
| E-3 | 反向：指针回到中心 → `vpBounds$` 停止变化（连续两次采样相等）                                     |
| E-4 | 反例：在边缘按下但不移动 → 300ms 内 `vpBounds$` 不变（D6 回归）                                   |
| E-5 | 脑图节点拖到边缘 → 视口滚动、`__debug.mindNodes` 落点仍在指针附近、松手落点正确（§11 已拍板纳入） |

### 7.6 手工验证（写入 specs，不写 docs）

1. 1440×900：单矩形、多选、编组分别贴四边与四角，观察跟手与松手落点。
2. 0.05x / 4x 各做一次：手感一致，落点正确。
3. 拖到边缘时分别按 Esc、切工具、切只读（另一标签接管）：立即停滚且预览回弹。
4. 脑图大树跨屏拖节点：拖影跟手、落点预览不抖。
5. 390px 窄屏触摸拖拽：边缘滚屏生效（触控无 hover，靠 move 驱动）。

### 7.7 验收

- `pnpm verify` 全绿（prettier、hygiene、typecheck、单测、build 全含）。
- 新增单测全部通过；`pnpm test:coverage` 不跌破阈值。
- `pnpm test:e2e` 全量绿（新增 spec + 既有 44 spec）。
- 无 rAF 泄漏：T18/T19 覆盖；E2E E-3 覆盖「停手后不再动」。
- 一次拖拽一次撤销：E-2 覆盖。
- 非测试源码无 > 400 行文件（`selectorService.ts` 必须仍在 400 行内）。

## 8. 文档同步清单（实现同批完成，不另开 PR）

| 文件                                                  | 改动                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docs/05-selection-drag.md` §4.5                      | 「当前未实现」改写为 §3 的契约：作用域、热区 56px、三档速度、符号表、帧时序、停止条件、落库语义 |
| `docs/03-render-engine.md` §5                         | 补一句：程序化平移入口是 `panBy`，边缘自动滚屏按帧走同一条路径；`vpBounds$` 每帧派发一次        |
| `docs/14-render-sync-principles.md` 规则 3            | 补一句：屏幕→世界换算必须每帧现读，禁止跨帧缓存世界坐标（重放补偿的根据）                       |
| `packages/core/src/types/services.ts` `panBy` 注释    | 按 §2.3-① 改写为「正值 = 内容右/下移 = 露出左侧/上方世界」                                      |
| `docs/13-roadmap.md` §1.3 与阶段 1                    | 勾选完成，并从「未开始」列表移除                                                                |
| `docs/13-roadmap.md` §1 基线、`docs/15-testing.md` §2 | 更新单测/E2E 计数                                                                               |
| `docs/13-roadmap.md` §3 决策与挂账                    | 已写入「框选路径 1.0 后立项」条目；实施时核对文案与代码范围一致                                 |
| `AGENTS.md` 当前状态与下一阶段顺序                    | 工程债余项只剩运行时收窄                                                                        |

## 9. 实施步骤（每步独立可回退）

| 步  | 内容                                                                                            | 验收                                   |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| S0  | 写 `edgeScrollMath.ts` + T1-T10；`types/services.ts` 加三个契约（先接口后实现）                 | `pnpm -F @spinth/core test edgeScroll` |
| S1  | 输入层：dispatch 返回 boolean、lastMove 快照、`replayLastMove`、`ViewportService` 转发；T21-T26 | 单测 + 既有 E2E 全绿（行为零变化）     |
| S2  | `edgeAutoScrollService.ts` + T11-T20（clock 注入）                                              | 单测                                   |
| S3  | selector/脑图 5 行集成 + 组装 + 销毁 + `BoardInternalMember`；T27-T31                           | `pnpm typecheck` + 单测                |
| S4  | E2E `edgeAutoScroll.spec.ts`（E-1..E-4）                                                        | 定向 + 全量 `pnpm test:e2e`            |
| S5  | 文档同步（§8）与计数更新                                                                        | `pnpm verify`                          |
| S6  | E2E E-5（脑图）+ §7.6 手工验证五项 + 脑图大树跨屏实测                                           | 同上                                   |

S1 单独可回退：重放能力不接线时零行为变化。

## 10. 风险与回滚

| 风险                                | 概率 | 影响                           | 处置                                                                              |
| ----------------------------------- | ---- | ------------------------------ | --------------------------------------------------------------------------------- |
| 方向实现反了（§2.3-①）              | 中   | 四边全反，肉眼「在滚」不易发现 | T2/T3 先写；E2E E-1 断言方向（`vpBounds$.x` 变大）                                |
| 阈值陷阱（未拖拽就开始拖）          | 中   | 单击边缘元素被意外移动         | D6 + T15 + E-4                                                                    |
| 只读/断网时画布空转                 | 低   | 元素脱手、松手跳位             | E4 回滚 + S6 兜底                                                                 |
| 每帧成本（culling/吸附/React 镜像） | 中   | 大画布掉帧                     | 与手工拖拽平移同量级；实测后再决定是否给 culling 加节流（不在本批）               |
| selector 破 400 行                  | 中   | 铁律违规                       | 集成严格 5 行；超限先把 marquee 三分支抽到 `selectorMarquee.ts`（只移动不改行为） |
| E2E 抖动                            | 中   | CI 偶发红                      | 只断言方向与下限，不断言精确像素；用 `waitForFunction` 而非定长等待               |

回滚：删除 `edgeAutoScroll*` 两文件 + 撤掉 5 行集成 + 两个契约，即回到今日行为（S1 的重放能力可保留，未被调用即无副作用）。

## 11. 已拍板

| #   | 议题         | 结论                                                                  | 落地位置   |
| --- | ------------ | --------------------------------------------------------------------- | ---------- |
| 1   | 速度三档数值 | 按 180 / 480 / 1080 屏幕 px/s 落地，本批不再调参                      | D4、T4/T5  |
| 2   | 脑图节点拖拽 | **本批纳入**：`isDragMoved` + T30 + E-5 为必做项，不是可选步骤        | D1、S3、S6 |
| 3   | 框选         | **本批不做**，挂账到 1.0 发布后（docs/13 决策台账）；机制复用同一服务 | §11.1      |

### 11.1 框选挂账（1.0 后立项）

机制不用重做——同一 `EdgeAutoScrollService` 与输入层重放，届时只需在 marquee 分支加上报。三个前置：

1. **起拖判据**：marquee 没有阻尼阈值，从 pointerdown 就存在；直接启用会让「停在边缘按住不动」自动扩选（R2 的同类问题）。需要给 marquee 自己的「已起拖」判据。
2. **行数**：~~本批落地后 `SelectorService` ≈ 399 行，框选再入必过 400~~ → 复审返工 R4（8af0638）已提前抽取 `selectorMarquee.ts`（会话对象 + ctx 注入，只移动不改行为）：selectorService 386 行，本前置已完成，框选滚屏届时直接在 `MarqueeSession` 加上报。
3. **选区语义**：起点滚出视口后矩形怎么算、反向扫过是否取消选中、是否随视口收窄，需产品拍板。

性能另需实测：框选重放会走 `setSelected`（O(全部 vm) + 选中重订阅），持续 60Hz 与元素拖拽的 O(k) 不同量级。

## 12. 设计自查（本次审查发现）

| #   | 级别 | 发现                                                                                          | 处置                                              |
| --- | ---- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| R1  | P0   | `panBy` 注释与实现方向相反；照注释实现会把四边方向全写反（§2.3-①）                            | D5 符号表 + T2/T3 + 同步改注释                    |
| R2  | P0   | 「按下即滚屏」会让视口平移把世界坐标推过 10px 阻尼，产生「没动鼠标却开始拖拽」                | D6 越阈值后才启用 + T15 + E-4                     |
| R3  | P1   | 在 selector 内建 rAF/replay 会破 400 行（当前 394 行）                                        | D3 补偿放输入层；selector 仅 5 行                 |
| R4  | P1   | 只读/断网时输入层吞 move，但 rAF 独立运行 → 画布空转、元素脱手                                | `replay` 返回投递结果 + 本帧回滚 + stop（E4/T17） |
| R5  | P1   | 后台标签页恢复后首帧 dt 可能数秒，导致一次瞬移                                                | `clampFrameDt` 50ms（T9）                         |
| R6  | P2   | 指针离开画布后不再有 move，热区档位会按旧坐标无限滚下去                                       | `pointerleave` 停止（S5/T20）                     |
| R7  | P2   | 新服务字段不进 `BoardInternalMember` 会让分类锁 tsc 红——这是护栏不是意外                      | 写入 S3 与 §5.4                                   |
| R8  | P2   | 若用「每帧固定像素」，120Hz 屏速度翻倍                                                        | dt 化 + T10（60/120Hz 等价）                      |
| R9  | P3   | 脑图 `moved` 不在 `IMindDragDelegate` 上，只能用「会话已建立」当条件 → 复现 R2                | 本批实装可选 `isDragMoved`（§5.2、T30、E-5）      |
| R10 | P3   | 重放会让 `dragMove$` 每帧多发一次；当前订阅方（ActionBar 隐藏）无副作用，未来重活订阅者需注意 | 记为观察项，不额外优化                            |

另：`update()` 在重放路径上会被再次调用（重放 → `onPointerMove` → `update`）。这是设计内行为（同参数幂等），T16 钉死；实现时**不要**为此加「重放中」标志——多一个状态就多一条分叉路径。

## 13. 实施记录

落地于 2026-10-31；复审返工批次见 §13.6。

### 13.1 提交序列（对应 §9）

| 步  | 提交     | 内容                                                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0   | 98c98dc  | 本方案入库 + docs/13 决策台账框选挂账条目                                                                                       |
| S0  | 67c1f11  | `edgeScrollMath.ts` + `IEdgeAutoScrollService`/`isDragMoved` 契约 + T1-T10                                                      |
| S1  | 28cb9a0  | 输入层：dispatch 重构为类方法并返回 boolean、lastMove 快照、`replayLastMove`、`ViewportService.replayLastPointerMove` + T21-T26 |
| S2  | 2a23425  | `EdgeAutoScrollService`（时钟注入）+ T11-T20                                                                                    |
| S3  | 9605941  | selector 5 行集成、mind `moved`/`isDragMoved` 访问器、组装/销毁/internal 归类 + T27-T31                                         |
| S4  | 5f3d4a4  | E2E E-1..E-4                                                                                                                    |
| S4' | 9852290  | bench 选靶避开边缘热区（见 13.3）                                                                                               |
| S6a | 739bd1f  | E2E E-5（脑图）                                                                                                                 |
| S5  | ed90064  | 文档同步（docs/03/05/13/14/15 + AGENTS.md）与 §13 初版                                                                          |
| S6b | cc7c8f6  | E-5 停滚后松手（后由复审返工 R3 改为相对断言）+ 全量收口                                                                        |
| R1  | 5193efa  | 复审返工：T12b/T16b 骨架修正回归测试（见 13.6）                                                                                 |
| R2  | c73dfdb  | 复审返工：帧循环异常兜底 + T20b                                                                                                 |
| R3  | e2cebd3  | 复审返工：E-5 相对断言恢复「边滚边松手」覆盖 + E2E 画布盒相对坐标                                                               |
| R4  | 8af0638  | 复审返工：抽 `selectorMarquee.ts`（selectorService 386 行，§11.1-2 前置完成）                                                   |
| R5  | （本笔） | 复审返工文档收口与手工验收待办                                                                                                  |

实测基线：`pnpm verify` 通过；单测 1036（core 947 = 913 + T1-T31 + T12b/T16b/T20b）；
E2E 45 spec / 218 例（edgeAutoScroll 5 例多轮连跑稳定）。

### 13.2 对 §5.3 骨架的两处实施修正（不改变设计意图；已由 T12b/T16b 回归钉死）

1. **起帧守卫用 `scrolling` 状态而非 `frameId === null`**：`tick` 执行期
   `frameId` 为 null，重放路径重入 `update()`（§12 末注的设计内行为）会再次
   `start()` —— rAF 指数双调度 + pointerleave 重复挂载。改用契约自带的
   `scrolling` 状态守卫（非「重放中」标志，符合 §12 末注约束）。
   回归测试 **T16b**（replay 桩内同步重入 update：一帧后 pending=1、监听器
   1 份、后续帧 panBy 线性）——把守卫改回 frameId 判定即红。
2. **停止判据用速度全零而非 `dx/dy` 全零**：`start()` 置 `lastFrameAt = now`，
   首帧 dt 可能为 0（同毫秒帧），按位移判停会在起帧瞬间自杀；dt=0 时跳过
   panBy 但继续预约下一帧。另在重放后补 `if (!scrolling) return`（重放途中
   被 stop 则不再预约）。回归测试 **T12b**（`runFrameWithoutAdvancing` 构造
   dt=0 首帧：scrolling 保持、panBy 0 次、预约仍在）。

### 13.3 实施中发现并处理的交互面外溢

**bench E2E 选靶落点上热区**：`bench.spec` 拖拽靶原取网格首个 shape（世界
(0,0) → 屏幕 y≈30，在上热区内），接线后拖拽真实触发向上滚屏 → 视口被平移 →
「滚回原位 culled 数对比」断言差 64 失败（3/3 复现；pre-S3 3/3 通过——非巧合）。
处置：bench 选靶改为网格中部（列 5 行 3，全程离四边 >100px），保持「测拖拽
性能而非滚屏」的测试意图（9852290）。这同时验证了 D6/热区几何在真实浏览器
里的行为正确性。

### 13.4 E2E 实现注记

- E-1 跟手断言：`selectionFrame`（世界）与 `toScreenPoint` 必须在**同一次**
  `page.evaluate` 内原子读取——滚屏每帧都在动，分两次读取会跨帧撕裂
  （±18px 假红；首轮运行实锤后修复）。
- E-5 落点断言：`nodesDebug` 只遍历**焦点**脑图，松手后焦点已切到新图，
  「原图仍在」改由 `modelCount`/MIND_MAP 计数断言。
- E-5 落点用**相对断言**（复审 R3 定稿）：热区内直接松手（保留「边滚边
  落库」路径覆盖），松手后单次 evaluate 比较 `toScreenPoint(新图根中心)` 与
  松手时指针屏幕位 `holdScreen`（已知常量）——up 首行停滚后视口不再平移，
  该量对时间不变，无采样竞态。此前的绝对期望值方案（先采 `vpBounds` 再
  `mouse.up`）在负载下假红：两次 evaluate 往返可达百 ms，期间滚屏仍在平移
  （最高 1080px/s）。
- E2E 中跟手探针用既有 `__debug.selectionFrame`（选区框每帧 moveTo = 预览
  世界位），未新增 debug 字段（D7）。
- 坐标纪律（复审 R3 收口）：页面坐标一律 canvas boundingBox 盒相对，无
  `+44` 顶栏硬编码；世界 ↔ 屏幕断言走公开 `toScreenPoint`。

### 13.5 手工验证清单（§7.6，specs 不入 docs）

| #   | 项                                              | 状态                                                   |
| --- | ----------------------------------------------- | ------------------------------------------------------ |
| 1   | 1440×900 单矩形/多选/编组贴四边四角，跟手与落点 | 待人工（E-1/E-2 覆盖单矩形右缘；四角与编组需手感确认） |
| 2   | 0.05x / 4x 手感一致、落点正确                   | 待人工（热区屏幕 px 语义已由单测钉死）                 |
| 3   | 边缘拖拽中 Esc/切工具/切只读 → 立即停滚回弹     | 待人工（停滚路径 E-3/单测 T14/T17-T20 覆盖机制）       |
| 4   | 脑图大树跨屏拖节点：拖影跟手、落点预览不抖      | 待人工（E-5 覆盖滚屏+落点）                            |
| 5   | 390px 窄屏触摸拖拽边缘滚屏生效（触控无 hover）  | 待人工（真机/触摸模拟）                                |

### 13.6 复审返工记录（外部审查后，5193efa..R5）

独立复审结论「方案与实现对得上，可留下」，返工逐条落地：

| 级别 | 发现                                                | 处置                                                                              |
| ---- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| P1   | §13.2 两处修正无回归测试（改回旧实现 944 例仍全绿） | T12b（dt=0 首帧）+ T16b（replay 重入 update）；临时还原旧语义验证两例必红         |
| P2   | selectorService 恰 400 行，缓冲归零                 | 抽 `selectorMarquee.ts`（用户拍板）：386 行 + 会话对象，§11.1-2 前置完成          |
| P2   | E-5「边滚边松手」路径被停滚方案绕开                 | 改相对断言（`toScreenPoint(新图根)` vs `holdScreen`，时间不变量），热区内直接松手 |
| P3   | panBy/replay 抛错会卡死 scrolling（一次手势内失效） | tick 内 try/catch → 兜底 stop，update 可重启（T20b）                              |
| P3   | E2E 文件头「禁裸写页面坐标」与 `sy = y+44` 打架     | 全部改 canvas boundingBox 盒相对坐标，删除 44px 硬编码                            |
| P3   | §13.1 追溯链断（S5 记 `—`）；§13 标题带日期         | 补 ed90064/cc7c8f6 与返工批次哈希；标题去日期                                     |
| 流程 | docs/13 已勾完成但 §13.5 五项手工验证未执行         | docs/13 §1.3 增显式手工验收待办（未勾选），口径对齐                               |
