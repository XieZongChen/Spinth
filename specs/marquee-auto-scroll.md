# 框选边缘自动滚屏（marquee auto-scroll）技术方案

> 状态：已实施（提交序列与实测数字见 §13.4，复审返工见 §13.5）。前置挂账
> `specs/edge-auto-scroll` §11.1、`docs/13` §3 已同步收口。

## 0. 结论摘要

| #   | 议题       | 结论                                                                                                                                           | 依据  |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | 机制       | 复用 `EdgeAutoScrollService`，不新建服务、不加速度参数；热区/速度由 `edgeScrollMath` 单源（已随 specs/edge-auto-scroll §14 改 120px 连续线性） | D1    |
| 2   | 起拖判据   | 屏幕位移 ≥ 10px（复用 `DRAG_TRACTION_SCREEN`），**只门控滚屏**，不门控矩形/选中                                                                | D2    |
| 3   | 选区语义   | 世界矩形 + 严格相交命中；滚屏不引入新语义，反向扫回即取消                                                                                      | D3    |
| 4   | 选中集去重 | 会话内比较上次写入的 id 序列，稳态每帧零 `setSelected`                                                                                         | D4    |
| 5   | 上报点     | `SelectorService` 的 marquee 分支（与元素/脑图两条拖拽分支同构）                                                                               | D5    |
| 6   | 松手       | 首行 `stop()` + 用最后一帧选中集 `finish`，不从 up 坐标重算                                                                                    | D6    |
| 7   | 数据面     | 零 Yjs 写、零 undo 项、零新增调试探针、零公开 API 变更                                                                                         | D7/D8 |

## 1. 目标与非目标

### 1.1 目标

- 框选拖到视口边缘热区时，视口按帧自动平移，橡皮筋继续生长、命中范围持续扩大，指针
  始终「粘」在热区内不动。
- 与元素拖拽、脑图节点拖拽共用同一套热区几何、线性速度、dt 钳制、停止条件与回滚语义，
  手感零分叉。
- 松手后的选中集与不滚屏的框选完全同义：**世界矩形内的全部命中项**，不多不少。
- 不改框选既有行为：从 pointerdown 起「过程即结果」、组索引快照、脑图 `focusFromMarquee`
  委托全部保持。

### 1.2 非目标

- 不做惯性/缓动滚动，不做「松手后继续滑行」，不做滚到内容尽头吸附。
- 不改热区/速度/dt 钳制/`pointerleave` 停滚（edgeScrollMath 单源；初稿时为 56px 三档，后随 specs/edge-auto-scroll §14 改 120px 连续线性斜坡）。
- 不改元素拖拽、脑图节点拖拽的任何代码路径（零回归面）。
- 不新增滚动时可调参数（阈值只有起拖判据一个，且是屏幕常量）。
- 不新增调试探针；E2E 沿用 `vpBounds$` / `selected$` 与 dev 的 `__debug.engine`。

## 2. 现状与约束

### 2.1 代码地图

| 文件                                                   | 现状（实施前）                                             | 本方案改动                                 |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| `platform/selector/selectorMarquee.ts`（71 行）        | 会话对象：down 建 / move 逐帧 / up·cancel 收；只持世界坐标 | + 屏幕起点、`moved`、选中去重（约 +30 行） |
| `platform/selector/selectorService.ts`（386 行）       | 指针分支：拖拽 / 脑图 / 框选三路；up·cancel 已统一停滚     | marquee 分支 +1 行                         |
| `platform/selector/selectorVm.ts`（52 行）             | `marqueeRectOf` 纯函数 + 蓝框 Graphics                     | 不动                                       |
| `platform/viewport/edgeAutoScrollService.ts`（135 行） | rAF 帧循环、热区速度、`pointerleave` 停滚、回滚            | 不动                                       |
| `platform/viewport/edgeScrollMath.ts`                  | 热区/线性速度/方向/dt 纯函数（§14 修订后 62 行）           | 不动                                       |
| `platform/viewport/viewportPointerInput.ts`（275 行）  | `lastMove` 快照 + `replayLastMove`（走完整派发闸门）       | 不动                                       |
| `types/services.ts`                                    | `IEdgeAutoScrollService.update(screen, dragging)` 注释     | 一句话补充框选口径                         |
| `__tests__/selectorMarquee.test.ts`                    | 不存在                                                     | 新增（会话单测）                           |
| `__tests__/selectorEdgeScroll.test.ts`（169 行）       | 元素/脑图拖拽的编排桩                                      | 追加框选用例                               |
| `packages/app/e2e/edgeAutoScroll.spec.ts`（332 行）    | E-1..E-5（元素 + 脑图）                                    | 追加 M-1..M-4                              |

### 2.2 必须保留的不变量

1. **数据流铁律**：框选全程零 Yjs 写；滚动只 `panBy` 视口。一次框选 = 0 个 undo 项。
2. **渲染同步规则 1**：矩形由 `start + cur` 绝对导出，禁止「在上次矩形上累加」。
3. **渲染同步规则 3**：世界坐标每帧现算，禁止跨帧缓存世界坐标（重放补偿正建立在此）。
4. **渲染同步规则 5**：松手用交互过程的最后一帧输出，不从视觉/up 坐标反推。
5. 组口径（整组全入框才入选）与脑图节点级委托的时序不变。
6. `selectorService` 保持 < 400 行；框选会话状态继续封装在 `MarqueeSession` 内。

### 2.3 实施前已核实的六个事实

1. **重放的是屏幕坐标，不是世界坐标**：`replayLastMove()` 存的是最后一条**已通过闸门**
   的 move 的屏幕坐标与修饰键，重放时 `toWorld` 现算（`viewportPointerInput.ts:22-32,
85-99, 166-177`）。这条决定了「框选补偿天然成立」。
2. **矩形在世界系**：`marqueeRectOf(start, cur)` 纯函数导出，蓝框 Graphics 挂在
   `viewport.optionLayer`（viewport 子节点）上，视口平移后自动跟随，无需额外换算
   （`selectorVm.ts:12-19`、`viewportService.ts:92`）。
3. **框选分支当前不上报**：`onPointerMove` 的 marquee 分支只调 `marquee.move(e.world)`，
   没有 `edgeScroll.update`（`selectorService.ts:259-261`）；而 up/cancel 首行已统一
   `edgeScroll?.stop()`（`:265, :283`）。
4. **`setSelected` 是 O(全部 vm)**：每次调用遍历 `getAllVms()` 派发 `onSelected$`，随后
   `selected$` 订阅再重建 k 个 vm 订阅（`selectorService.ts:145-157, 134-143`）。稳态每帧
   调用会产生与命中集变化无关的固定开销——这是框选滚屏区别于元素拖拽的最大成本项。
5. **命中口径 = 严格相交**：`getVmByRect` 空间索引粗筛 + per-type `hitTestRect` 精判 +
   zOrder 降序（`vmEngineService.ts:162-170`）；基类口径是严格相交、边相接不算
   （`baseWidgetVm.ts:104-113`）。
6. **主 E2E 跑 dev server**：`playwright.config.ts:82` 起的是 `pnpm dev`，因此
   `__spinthDebug.__debug.engine` 可用（bench 同款）；pwa 配置才是 `SPINTH_E2E=1` 的
   preview 构建，不可用。E2E 造屏外 fixture 必须走主配置。

## 3. 目标行为

### 3.1 触发与速度

完全复用现有数学，不新增参数：

- 热区与速度完全同源 `edgeScrollAxisVelocity`：120 屏幕 px 热区、连续线性
  `v = 1080 × (1 − d/120)` 屏幕 px/s（外沿 0、边缘最大；specs/edge-auto-scroll
  §14 修订，框选批落地时为 56px 三档）。两轴独立，四角斜向各自到最大速度。
- 帧位移 = 速度 × dt，dt 钳制 `[0, 50]` ms。
- 方向：右/下边缘 `panBy` 传负值（正值 = 内容右/下移 = 露出左侧/上方世界）。
- 指针坐标用 `IPointerEventInfo.screen`（画布局部 CSS px），与 `getClientSize()` 同空间。

### 3.2 起拖判据

- 定义：`hypot(screen − startScreen) ≥ 10`（**屏幕 px**，与缩放无关）。
- 只在 `move` 时评估，**锁存**：一旦越过保持到会话结束，不因指针回移而复位。
- 阈值只决定「是否允许滚屏」；矩形与选中集从 pointerdown 起照常逐帧更新（现状不变）。
- 推论：热区内按住不动 / 亚阈值抖动 → 永不滚；越过阈值后进入热区 → 当帧起滚。

### 3.3 每帧时序（与元素拖拽完全一致）

```text
rAF tick(dt 钳 50ms)
 → viewport.panBy(dx, dy)
 → viewport.replayLastPointerMove()
     → dispatch('move', { screen: lastScreen })        // 只读 / 断网 / 模式 handler 闸门
     → world = toWorld(lastScreen)                     // 每帧现算，不缓存
     → SelectorService.onPointerMove
         → marquee.move(world, lastScreen)             // 矩形 → 命中 → 组口径 → 选中
         → edgeScroll.update(lastScreen, marquee.moved) // 幂等重入，不双启帧
 → 若重放被拒：panBy(−dx, −dy) 回滚本帧 + stop
```

### 3.4 停止条件全集

| 条件                                           | 路径                             | 现状     |
| ---------------------------------------------- | -------------------------------- | -------- |
| 指针离开热区                                   | `update` 解析出全零速度 → `stop` | 服务内   |
| 未过起拖判据                                   | `update(screen, false)` → `stop` | 新增语义 |
| 松手 / pointerupoutside                        | `onPointerUp` 首行 `stop`        | 已接     |
| 手势取消（切工具/只读降级/blur/pointercancel） | `onPointerCancel` 首行 `stop`    | 已接     |
| 指针离开画布容器                               | 服务内 `pointerleave` 监听       | 已接     |
| 重放被拒（只读/断网/无 handler）               | 回滚本帧 + `stop`                | 已接     |
| `dispose`                                      | `stop` + dead 标记               | 已接     |

### 3.5 选区语义

**结论：与不滚屏的框选同义，不引入新语义。** 因为矩形本来就定义在世界系里，滚屏只改变
`cur` 的来源（由重放产生），不改变「矩形由 start/cur 两点导出」这一事实。

时间线示例（视口 1440×856，右缘热区 x ≥ 1320（120px 热区），起点世界 `(200, 300)`）：

| 时刻      | 指针屏幕   | 视口 x | `cur` 世界  | 矩形世界 x 区间 | 选中      |
| --------- | ---------- | ------ | ----------- | --------------- | --------- |
| t0 down   | (200, 300) | 0      | (200, 300)  | 200..200        | 空        |
| t1 到右缘 | (1428,300) | 0      | (1428, 300) | 200..1428       | 框内项    |
| t2 滚 1s  | (1428,300) | ~970   | (2400, 300) | 200..2400       | 扩大      |
| t3 回移   | (720, 300) | ~970   | (1690, 300) | 200..1690       | 收缩/取消 |

- 「起点滚出视口」不是新问题：起点只是矩形的一个角，锚在世界里。
- 反向扫回 = 矩形收缩 = 取消选中（既有行为，无需代码）。
- 松手时矩形可能远超视口：选中集仍按世界矩形全量命中（不是只选可见项）。

## 4. 关键决策

### D1 复用 `EdgeAutoScrollService`，不新建服务

同一条 rAF、同一套热区/线性速度/dt 钳制、同一个 `pointerleave` 守卫、同一套「回滚本帧 + 停」
的失败兜底。新建一套会出现两个 rAF 同时 `panBy`、两套停止判据互相覆盖。

### D2 起拖判据 = 屏幕位移 ≥ 10px，且只门控滚屏

- **为什么需要**：框选从 pointerdown 就存在（没有元素拖拽的阻尼态）。不加判据时，在热区
  边缘按下不动就会持续扩选——这正是 `specs/edge-auto-scroll` R2 的同类问题。
- **为什么用屏幕距离**：滚屏本身会持续改变指针的世界坐标（指针没动）。用世界距离做阈值，
  首帧 pan 之后就会「自己把自己推过阈值」，判据失效。屏幕距离是唯一不受 pan 影响的度量，
  也与 `DRAG_TRACTION_SCREEN`（10 屏幕 px）同口径。
- **为什么只门控滚屏**：矩形/选中从 down 起就是「过程即结果」，加阈值会改变既有手感与语义；
  而需要防的误触发只有滚动本身。
- 常量单一来源：`MARQUEE_TRACTION_SCREEN = DRAG_TRACTION_SCREEN`。

### D3 选区语义 = 世界矩形 + 严格相交（维持现状）

否定方案：

- **视口裁剪**（只选可见部分）：视口随滚动移动，矩形尾部每帧被裁掉，滚动永远无法累积选中
  ——与「拖到边缘继续扩选」的目标相反。
- **累积命中**（扫过的都选，反向不取消）：与既有框选语义冲突（缩小矩形应当取消选中），
  且松手结果依赖历史路径，不可复现。

### D4 选中集去重：稳态每帧零 `setSelected`

`setSelected` 是 O(全部 vm) + 重建选中项订阅。滚屏稳态命中集不变，若每帧照调，60Hz 全程
在做与用户输入无关的工作。去重口径：与**上次写入的 id 序列**逐项比较（`getVmByRect` 已按
zOrder 稳定排序），相同则跳过 `setSelected`，但**矩形照常重绘**。

哨兵初值必须是 `null` 而不是 `[]`：首帧命中为空时要照常写入一次 `setSelected([])`，
否则 shift+框选 / 点击后首帧的「清空既有选中」会丢失（行为漂移，见 R3）。

### D5 上报点在 `SelectorService`，不在会话内

与 `dragState` / `mindDragging` 两条分支同构：

```ts
// selectorService.onPointerMove（marquee 分支）
this.marquee.move(e.world, e.screen);
this.edgeScroll?.update(e.screen, this.marquee.moved);
```

会话只负责「我是否已起拖」，滚动服务生命周期仍由 selector 统一管（up/cancel 已 stop）。
会话内直连滚动服务会让单测必须造时钟桩，且 `stop` 出现两处归属。

### D6 松手以最后一帧过程结果为准

`onPointerUp` 首行 `stop()`（此后不再有新帧），随后 `m.finish(this.selected$.value)`。
不从 up 事件的坐标补算一帧：`up` 与最后一条 move 可能差一帧，补写会引入「停滚之后仍改
选中」的分叉，也违反规则 5（用过程最后一帧，不从视觉/终点反推）。既有元素拖拽同款。

### D7 零数据面副作用

框选不写 Yjs、不开 transact；滚动只 `panBy`（不改 `vpBounds` 持久化、不改文档）。
因此本方案不产生 undo/history/持久化相关测试，也不需要新的撤销语义。

### D8 零新增公开面与调试面

- `createBoard()` 冻结投影不变；`BoardInternalMember` 不加字段（分类编译锁无需改动）。
- 不新增 `__debug` 字段：E2E 断言用公开 `vpBounds$` / `selected$`；屏外 fixture 用 dev
  的 `__spinthDebug.__debug.engine`（runtime-narrowing 既有逃生口，bench 先例）。

### 被否方案一览

| 方案                             | 否决理由                                             |
| -------------------------------- | ---------------------------------------------------- |
| 新建 `MarqueeScrollService`      | 两套 rAF/热区/停止判据互相打架                       |
| 会话内自起 rAF + 自行 replay     | 重复 dt 钳制/pointerleave/回滚，且会话行数与职责膨胀 |
| 起拖阈值门控矩形更新             | 改变既有框选手感，对防误滚无必要                     |
| 世界距离阈值                     | 滚屏自身把世界坐标推过阈值，判据自激（D2）           |
| 视口裁剪命中                     | 滚动无法累积选中（D3）                               |
| 累积命中                         | 反向不取消，结果依赖历史路径（D3）                   |
| 松手补一帧 move                  | 停滚后仍写选中，多一条分叉（D6）                     |
| 每帧无条件 `setSelected`         | 稳态 60Hz O(全部 vm) + 订阅抖动（D4）                |
| 用 pixi-viewport `drag` 插件代替 | 只在 hand 模式启用，与 cursor 模式框选互斥           |

## 5. 设计

### 5.1 文件与职责

| 文件                                      | 职责变更                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `platform/selector/selectorMarquee.ts`    | 新增 `startScreen`、`moved` 锁存、`sameIds` 去重；`move` 增加 screen 入参 |
| `platform/selector/selectorService.ts`    | 构造会话时传 `e.screen`；marquee 分支上报 `update(e.screen, moved)`       |
| `types/services.ts`                       | `IEdgeAutoScrollService.update` 注释补「框选以起拖判据为 dragging 口径」  |
| `__tests__/selectorMarquee.test.ts`       | 新增：阈值/锁存/去重/幂等/矩形导出/finish/cancel/组过滤（T1–T8）          |
| `__tests__/selectorEdgeScroll.test.ts`    | 追加 P1–P4（框选上报语义与停滚顺序）                                      |
| `packages/app/e2e/edgeAutoScroll.spec.ts` | 追加 M-1–M-4                                                              |

### 5.2 契约

**公开/内部契约零变更**（不新增 types 文件、不加 zod schema、不改 `BoardPublicApi`）。
仅模块内部签名调整：

```ts
// platform/selector/selectorMarquee.ts
import type { IPoint } from '../../common/geometry';
import { DRAG_TRACTION_SCREEN } from './selectorDragOps';

/** 起拖判据（屏幕 px）：与元素拖拽同口径，单一来源避免漂移 */
export const MARQUEE_TRACTION_SCREEN = DRAG_TRACTION_SCREEN;

export class MarqueeSession {
  constructor(
    private readonly ctx: IMarqueeContext,
    start: Point,
    startScreen: IPoint,           // 新增：按下时的屏幕坐标（判据基准，永不更新）
    groups: GroupService | null,
  );

  /** 是否已越过起拖判据（锁存；滚屏唯一开关） */
  get moved(): boolean;

  /** 逐帧：更新矩形 + 命中 + 组口径 + 选中（去重） */
  move(world: Point, screen: IPoint): void;

  finish(selectedIds: string[]): void;  // 不变
  cancel(): void;                       // 不变
}
```

`IMarqueeContext` 不变（会话仍不感知 viewport / 滚动服务）。

### 5.3 算法（实现骨架）

```ts
export class MarqueeSession {
  private readonly ctx: IMarqueeContext;
  private readonly state: MarqueeState;
  private readonly groupFilter: ((hitIds: string[], rect: IRect) => string[]) | null;
  private readonly startScreen: IPoint;
  private movedFlag = false;
  /** null = 尚未写过选中（首帧必须写一次，见 R3） */
  private lastIds: string[] | null = null;

  constructor(
    ctx: IMarqueeContext,
    start: Point,
    startScreen: IPoint,
    groups: GroupService | null,
  ) {
    this.ctx = ctx;
    this.startScreen = { x: startScreen.x, y: startScreen.y };
    this.state = { start: start.clone(), cur: start.clone() };
    this.groupFilter = groups?.createMarqueeFilter() ?? null;
    ctx.selectorVm.show(marqueeRectOf(this.state));
  }

  get moved(): boolean {
    return this.movedFlag;
  }

  move(world: Point, screen: IPoint): void {
    if (
      !this.movedFlag &&
      Math.hypot(screen.x - this.startScreen.x, screen.y - this.startScreen.y) >=
        MARQUEE_TRACTION_SCREEN
    ) {
      this.movedFlag = true; // 锁存：回移不复位
    }
    this.state.cur = world.clone();
    const rect = marqueeRectOf(this.state);
    this.ctx.selectorVm.update(rect); // 矩形每帧重绘，不受去重影响

    const hits = this.ctx.vmEngine.getVmByRect(
      new Rectangle(rect.x, rect.y, rect.width, rect.height),
    );
    let hitIds = hits.map((vm) => vm.id);
    if (this.groupFilter) hitIds = this.groupFilter(hitIds, rect);

    if (this.lastIds && sameIds(this.lastIds, hitIds)) return; // 稳态零 fan-out
    this.lastIds = hitIds;
    this.ctx.setSelected(hitIds);
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

### 5.4 接线（`selectorService.ts` 两处，共 +1 行）

```ts
// 1) onPointerDown 末行（原 :241）
this.marquee = new MarqueeSession(this.marqueeCtx, e.world, e.screen, this.getGroups());

// 2) onPointerMove marquee 分支（原 :259-261）
if (this.marquee) {
  this.marquee.move(e.world, e.screen);
  this.edgeScroll?.update(e.screen, this.marquee.moved);
}
```

行数：386 → 387（< 400，净增一行 `update` 上报）。`onPointerUp` / `onPointerCancel` 的首行 `stop()` 已有，不动。

### 5.5 时序示例（右热区，60fps）

```text
down  (screen 200,300)  → marquee.show(零矩形)，起点世界 (200,300)
move  (screen 1428,300) → moved? 1228 ≥ 10 → true；rect 200..1428
                          update(1428,300,true) → 距右缘 12px → 972px/s（线性斜坡）→ start()
tick1 dt 16.7ms          → panBy(-16.2,0) → replay(1428,300)
                          → world.x += 16.2 → cur (1444.2,300) → rect 200..1444.2
                          → update 幂等（scrolling 已 true，不双起帧）
tickN …                  → 矩形每帧 +16.2px，命中集变化时才 setSelected
up                       → stop()（首行）→ finish(lastSelected)
```

## 6. 边界与竞态

| #   | 场景                                  | 期望                                                             | 机制                |
| --- | ------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| 1   | 热区内按下不动                        | 不滚、不扩选                                                     | D2 阈值             |
| 2   | 亚阈值抖动（<10px）后停住             | 不滚                                                             | D2                  |
| 3   | 先拖 20px 再进热区                    | 立即滚                                                           | 已过阈值            |
| 4   | 滚动中把指针移回画布中心              | 停滚；矩形收缩、取消选中                                         | 离热区 → stop       |
| 5   | 滚动中松手                            | 首行停滚；选中以最后一帧定稿；零 Yjs 写                          | D6                  |
| 6   | 滚动中切工具（R/V/空格抓手）          | `setCursorMode` → 对旧模式发 cancel → 停滚 + 蓝框隐藏 + 选中保持 | 既有                |
| 7   | 滚动中只读降级（多标签接管）          | `updateEditable(false)` 先 cancel → 停滚；重放被拒有回滚兜底     | 既有                |
| 8   | 滚动中断网（`isEditBlocked`）         | 重放被拒 → 回滚本帧 + stop；矩形冻结到 up                        | 既有                |
| 9   | 指针移出画布容器（含移到工具坞/浮层） | 停滚；框选冻结；回容器后下一次 move 续滚                         | 服务内 pointerleave |
| 10  | 后台标签页                            | rAF 暂停；回前台首帧 dt 钳 50ms，不瞬移                          | 既有                |
| 11  | 触控拖到屏幕边缘                      | 同指针路径；热区是屏幕 px，与缩放无关                            | 既有管线            |
| 12  | 多指                                  | 第二指不参与（活跃指针过滤）                                     | 既有                |
| 13  | 滚动中缩放（Cmd+滚轮）                | 矩形世界系不变；阈值仍是屏幕口径                                 | D2                  |
| 14  | 框内元素被外部删除（undo 等）         | `onModelRemoved$` 剔除选中；去重缓存下一帧自愈                   | 既有 + D4           |
| 15  | 脑图框选后松手                        | `finish` 仍逐个 `focusFromMarquee`（矩形可能是超大世界矩形）     | 既有                |

## 7. 性能

### 7.1 每帧成本

| 项                                  | 复杂度            | 触发频率           |
| ----------------------------------- | ----------------- | ------------------ |
| `getVmByRect`（索引粗筛 + 精判）    | O(候选)           | 每帧               |
| 蓝框重绘（`selectorVm.update`）     | O(1)              | 每帧               |
| `setSelected`（全量 diff + 重订阅） | O(全部 vm) + O(k) | 仅命中集变化（D4） |
| 选区框 `syncSelectionVm`            | O(k log k)        | 仅命中集变化       |

滚屏稳态（指针不动、命中集不变）只剩前两项——与不滚屏的框选同量级。

### 7.2 长滚动的退化

持续按住会把矩形拉得很大，索引粗筛候选趋近全量。1000 控件规模下每帧一次全量
`hitTestRect` 约千次 AABB 比较，量级上仍在预算内；上万控件且矩形覆盖全图时会成为
长任务来源（实施时按 §7.3 实测确认，不靠估算拍板）。

**可选优化（默认不做，实测触发才做）**：

1. `setSelected` 改 O(prev ∪ next) 差分（遍历 prev/next 集合而不是 `getAllVms()`）——
   独立可验证的小改，收益在密集内容快速扫过时。
2. 矩形按「新增条带」增量查询并缓存命中集——复杂度显著上升，只有实测超预算才考虑。

### 7.3 实测口径

- dev 下用 bench 同款 fixture（1000 控件，见 `packages/app/e2e/bench.spec.ts`），框选扫过
  2s：Performance 面板无 > 16ms 的 long task，滚动平滑。
- 不新增 CI 性能门禁（共享 runner 帧成本不可控，docs/16 §7 既有口径）。
- 本批未实测，挂 §8.4 第 5 项手工执行；实测超预算才触发 §7.2 可选优化。

## 8. 测试方案

### 8.1 单测：`__tests__/selectorMarquee.test.ts`（新增，T1–T8）

| #   | 用例                 | 断言                                                                |
| --- | -------------------- | ------------------------------------------------------------------- |
| T1  | 阈值屏幕口径         | world 差 1000 / screen 差 9 → `moved=false`；screen 差 10 → `true`  |
| T2  | 锁存                 | 越过阈值后把指针移回起点 2px → `moved` 仍为 `true`                  |
| T3  | 幂等                 | 同一 (world, screen) 重复 move → 矩形与选中不变、`setSelected` 一次 |
| T4  | 去重                 | 命中集不变连发 5 帧 → `setSelected` 一次；命中集变化 → 第二次       |
| T5  | 首帧空命中必须写一次 | 首帧 `[]` → `setSelected([])` 被调用（哨兵 `null`）                 |
| T6  | 矩形无增量           | 任意 move 序列，矩形恒等于 `f(start, cur)`；同输入重复得到同矩形    |
| T7  | finish               | 隐藏蓝框 + 选中 MIND_MAP 时触发 `focusFromMarquee`（既有语义）      |
| T8  | cancel / 组过滤      | cancel 只隐藏、选中集不变；组 filter 仍被调用并生效                 |

### 8.2 编排：`__tests__/selectorEdgeScroll.test.ts` 追加（P1–P4）

沿用既有桩（`edgeScroll.update/stop` 的 `vi.fn()` + 指针流桩）：

| #   | 用例            | 断言                                            |
| --- | --------------- | ----------------------------------------------- |
| P1  | 亚阈值框选 move | `update(screen, false)`                         |
| P2  | 越过阈值        | `update(screen, true)`                          |
| P3  | 松手顺序        | `stop` 在 `finish` 之前（蓝框隐藏前已停滚）     |
| P4  | 切工具取消      | cancel 路径调用 `stop`；后续 move 不再 `update` |

### 8.3 E2E：`packages/app/e2e/edgeAutoScroll.spec.ts` 追加（M-1–M-4）

断言纪律沿用该文件头：坐标一律 canvas 盒相对；只断言方向与下限；世界↔屏幕走公开
`toScreenPoint`；视口走公开 `vpBounds$`；选中走公开 `selected$`。

| #   | 场景                   | 步骤与断言                                                                                                                                                                              |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1 | 右热区框选扩选屏外内容 | dev `engine` 建 B 于世界 `(1900, 320)`（初始屏外）；从空白 `(200, 300)` 拖到右缘并按住；`waitForFunction`：`vpBounds.x` 增长 > 400 且 `selected$` 含 B；松手后仍含 B；`modelCount` 不变 |
| M-2 | 反例：未过阈值不滚     | 在右热区空白按下 + 3px 抖动，等 300ms：`vpBounds` 与按下前相等                                                                                                                          |
| M-3 | 回移停滚 + 矩形收缩    | M-1 起滚后把指针移回画布中心：两次采样 `vpBounds` 相等；`selected$` 不再含 B                                                                                                            |
| M-4 | 切工具中止             | 滚动中按 `r`：停滚（两次采样相等）；随后移动指针，`selected$` 不再变化（会话已取消）。断言完成后先松手再按 `v` 回 cursor，避免在 shape 模式下继续按住                                   |

实现注记：

- 屏外 fixture 用 `__spinthDebug.__debug.engine.transact/add`（bench 先例）；该文件属于主
  Playwright 配置（dev server），探针可用。不要放进 pwa 配置。
- 不要断言蓝框矩形本身（无探针，D8）：用「选中集包含屏外元素」作为「矩形确实长过去了」的
  语义证据。
- 框选起点必须避开元素（`getVmByPoint` 命中会走拖拽而不是框选）。

### 8.4 手工验证（写入本文件，不写 docs）

1. 四边四角各拖一次：跟手、无抖动、无「框先到、选中后到」的撕裂感。
2. 0.05x / 1x / 4x 三档缩放：起拖阈值手感一致，滚动速度与缩放无关。
3. 0.05x 慢慢拖到边缘：确认不是「一进热区就猛滚」，而是越靠近边缘越快（线性）。
4. 触摸板/触控真机：拖到屏幕边缘仍可滚（`pointerleave` 不在容器内触发）。
5. dev 1000 控件（bench fixture）框选扫 2s：Performance 面板无 >16ms long task
   （§7.3 实测口径，复审补挂）。

### 8.5 验收命令

```bash
pnpm --filter @spinth/core test -- selectorMarquee selectorEdgeScroll
pnpm verify
npx playwright test packages/app/e2e/edgeAutoScroll.spec.ts
```

## 9. 实施步骤（每步独立可回退）

| 步  | 内容                                                   | 验证          |
| --- | ------------------------------------------------------ | ------------- |
| S1  | `MarqueeSession` 加 `startScreen`/`moved`/去重 + T1–T8 | core 单测     |
| S2  | `SelectorService` 接线 + P1–P4 + types 注释            | core 单测     |
| S3  | E2E M-1–M-4                                            | 该 spec       |
| S4  | 文档同步 §10 + 本文件 §13 回填                         | `pnpm verify` |

- S1 是纯增量：`moved` 尚无消费者，行为零变化，可单独合入。
- S2 是唯一改变运行时行为的提交（净 +1 行）；出问题单笔回退即可。
- 提交信息按仓库约定：`feat(selector): …` / `test(e2e): …` / `docs: …`。

## 10. 文档同步清单（S4 一次做完）

| 位置                           | 改动                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `docs/05` §4.5                 | 作用域加「框选」；启用条件补「框选以屏幕位移 ≥10px 为起拖判据」     |
| `docs/13` §3                   | 删掉「框选挂账 1.0 后」的决策句，改写为当前事实（三路拖拽同属滚屏） |
| `docs/13` §1.3                 | 手工验收清单若仍列「框选挂账」，同步删改                            |
| `specs/edge-auto-scroll` §11.1 | 标注已落地并指向本文件                                              |
| `AGENTS.md`                    | 「当前状态」补一句；单测/E2E 数字回填（以实测为准）                 |
| `types/services.ts`            | `update` 注释补框选口径（S2 顺手）                                  |

## 11. 风险与回滚

| 风险                                 | 影响           | 处置                                                  |
| ------------------------------------ | -------------- | ----------------------------------------------------- |
| 10px 阈值偏大，热区内轻拖不滚        | 手感问题       | 可调 6px（单测常量一处改）；默认 10，与元素拖拽同口径 |
| 长滚动矩形过大，命中开销上升         | 帧率           | §7.2 两条可选优化，实测触发                           |
| `pointerleave` 停滚（移出容器/浮层） | 拖出窗口不能滚 | 既有服务语义，元素拖拽同款；记录为已知限制，本批不改  |
| 选中集频繁变化导致 ActionBar 重渲染  | 帧率           | D4 去重已覆盖稳态；密集扫过与现有快速框选同量级       |
| 阈值被误用来门控矩形                 | 手感回归       | 单测 T1/T2 只测 `moved`，T6 锁定矩形随时可更新        |

回滚：S2 单笔回退即恢复原状；S1/S3/S4 均可独立保留（`moved` 无消费者、E2E 可先 skip）。

## 12. 拍板记录（实施按默认值落地，复审收口）

1. **选区语义**：按默认 A 落地——世界矩形全量相交，维持现状。「只选可见内容」需改成
   每帧矩形 ∩ 视口，那会让滚动无法累积选中（§4 D3），不取。
2. **阈值取值**：按默认 10px 落地（复用 `DRAG_TRACTION_SCREEN`，单测 T1 钉住
   屏幕口径与边界值）。
3. **`setSelected` 差分优化**：不做；§7.3 实测挂 §8.4 第 5 项手工执行，超预算才触发。

## 13. 设计审查

### 13.1 自审发现

| #   | 级别 | 发现                                                                                                       | 处置                                                  |
| --- | ---- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| R1  | P0   | 挂账句「届时只需在 marquee 分支加上报」不成立：还缺起拖判据与选中集去重，否则热区按住即滚 + 稳态 60Hz 空转 | D2/D4，新增 T1/T4                                     |
| R2  | P0   | 阈值若用世界距离，滚屏自身会把世界坐标推过阈值（自激）                                                     | D2 明确屏幕口径，T1 同时钉 world 远/screen 近         |
| R3  | P0   | 去重哨兵若用 `[]`，shift+框选首帧空命中不再清空既有选中（行为漂移）                                        | 哨兵 `null` + T5                                      |
| R4  | P1   | 阈值若被实现成门控矩形/选中，会改变既有手感                                                                | D2 写明「只门控滚屏」，T6 锁矩形                      |
| R5  | P1   | `setSelected` O(全部 vm)，去重只消稳态                                                                     | §7 记录口径，可选优化不进本批                         |
| R6  | P1   | 重放会重入 `update`，若加「重放中」标志会多一条状态分叉                                                    | 依赖服务 `scrolling` 幂等（既有 T16），不新增标志     |
| R7  | P2   | `selectorService` 386 行，再加 1 行接近上限                                                                | 387 < 400；若后续再涨，先抽分支不加豁免               |
| R8  | P2   | E2E 无法断言蓝框（无探针）                                                                                 | 用 `selected$` 语义断言 + dev `engine` 造屏外 fixture |
| R9  | P2   | 松手补一帧会「停滚后仍改选中」                                                                             | D6 不补，规则 5 一致                                  |
| R10 | P3   | `pointerleave` 停滚会被画布上的 DOM 浮层触发                                                               | 既有行为，元素拖拽同款；记录不修                      |
| R11 | P3   | 触控拖到屏幕边缘可能与浏览器手势（下拉刷新）冲突                                                           | 非本批；真机验收记录                                  |

### 13.2 与仓库铁律对齐

| 约定                 | 结论                                                   |
| -------------------- | ------------------------------------------------------ |
| 数据流（写只经 Yjs） | 框选零写；滚动只 `panBy`，不碰文档                     |
| 接口先行             | 无新契约类型；仅内部签名调整，`types/` 只改注释        |
| 显式依赖             | 滚动服务仍经构造注入 `SelectorService`，会话不感知服务 |
| 单文件单职责         | 会话 +30 行、selector +1 行，均 < 400                  |
| 测试护栏             | 单测（会话）+ 桩测试（编排）+ E2E（整机）三层齐        |
| 渲染同步六条         | 规则 1（绝对导出）、3（每帧现算）、5（最后一帧）均满足 |
| 单机优先             | 不涉及网络/服务端/协同路径                             |

### 13.3 与既有规格的一致性

| 规格                           | 结论                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `docs/05` §4.5                 | 作用域与启用条件需改写（§10），其余条款完全沿用                                              |
| `docs/14` 规则 1/3/5           | 满足（矩形绝对导出、世界坐标现算、松手用最后一帧）                                           |
| `specs/edge-auto-scroll` §11.1 | 三个前置：起拖判据（D2）、行数（已由 R4 返工完成）、选区语义（D3 按默认 A 落地，§12 已拍板） |
| `docs/16` 性能                 | 不新增 CI 门禁，按 §7.3 本地实测                                                             |
| `specs/runtime-narrowing`      | 不加 debug 字段、不加公开成员（D8）                                                          |

### 13.4 实施回填

提交序列（每步独立可回退，均含 pre-push `pnpm verify` 全绿后推送）：

| 步  | 提交      | 内容                                                           |
| --- | --------- | -------------------------------------------------------------- |
| S1  | `3c9c75e` | MarqueeSession 判据/去重 + T1–T8（调用点随签名机械更新）       |
| S2  | `23986f0` | marquee 分支 +1 行上报 + P1–P4 + `types/services.ts` 注释      |
| S3  | `1446b01` | E2E M-1–M-4 + 本规格入库（含 prettier 修正 amend）             |
| S4  | 见本笔    | docs/05 §4.5、docs/13 §3、specs/edge-auto-scroll §11.1、AGENTS |

实测数字：

- 单测：core 976 → **988**（新增 `selectorMarquee.test.ts` T1–T8 8 例 +
  `selectorEdgeScroll.test.ts` P1–P4 4 例，共 12 例；后者 5 → 9 例）。
  react 65 / app 38 不变，合计 **1091**（复审返工后实跑复核）。
- E2E：`edgeAutoScroll.spec.ts` 5 → **9** 用例（E-1..E-5 无回归 + M-1..M-4 新增）；
  全量 47 spec / **232** 用例绿（视觉 4/4 双平台不变）。
- `selectorService.ts` 386 → **387** 行（< 400，R7 预期一致）；
  `selectorMarquee.ts` 71 → 108 行。
- 实施期发现：E2E 恒 y 拖动会得到零高度矩形——严格相交口径下永不命中屏外件，
  M-1/M-3 的 hold 点取 y=340（与起点差 40）保证矩形有高度；另 waitForFunction
  predicate 的自由变量不随参传入浏览器上下文，阈值 + 选中条件须打包成数组传参。
- 手工验收五项（§8.4）待人工执行：四边四角、三档缩放手感、0.05x 线性加速、
  触摸真机边缘拖拽、1000 控件长滚动 long task 实测（复审补挂）。

### 13.5 复审返工（实施后独立复审，全部收口）

- **P1 基线数字**：§13.4 首版按 S1 后计数回填（core 984 / 合计 1087），漏算 S2
  的 P1–P4 四例，且漏改 docs/13 §1 基线行——三处已统一为 core 988 / 1091 /
  232 用例并实跑复核。教训：基线数字必须在最后一笔代码提交后重测，不取中间
  步骤计数。
- **P2 E2E 假绿 ×2**：M-3/M-4 首版只等 `vpBounds` 位移（+100px）就断言「B
  不再/仍在选中」——B 入选需滚 ≳472px，此前从未入选，排除断言恒真、冻结断言
  空==空。已改为复合等待「`selected$` 含 B」先建立非空选中再断言。M-4 复审
  建议的「cancel 后 B 仍在选中」前提不成立：`setCursorMode` 换工具**先清选区**
  再发 cancel（boardCommands.ts:47-49），已按真实语义改为「非空 → 清空」转换
  断言，另加泄漏探针（回 cursor 后先移画布中心再回右热区：命中集变化绕开选中
  去重，会话若泄漏则 B 重新入选、且 `moved` 锁存会把滚屏重新拉起——`selected$`
  与 `vpBounds` 两条同时断言；会话已取消则两条恒真）。
- **P3 文档偏差（Esc 停滚）**：docs/05 §4.5 停止条件原列「Esc」——实测 Esc 走
  `clearSelection`（清选中 + `setCursorMode('cursor')`），cursor 模式下同模式
  早退不发 `dispatchGestureCancel`（viewportService.ts:307），滚屏不停；已删
  该条，「Esc 接入手势取消」如需做另案。附带已知边况：滚屏中按 Esc 只清
  选中，会话去重缓存 `lastIds` 与外清后的 selected$ 短暂不一致，下一次命中集
  变化即自愈（滚动中矩形逐帧生长，命中集高频变化）。
- §12 三条待拍板按默认值收口为拍板记录；§7.3 实测挂 §8.4 第 5 项；§2.1 行数
  表头注明「实施前」。
- **复审二轮（探针强度）**：M-4 首版泄漏探针在「同一屏幕位 → 同一命中集」下被
  选中去重跳过（`sameIds` 直接返回、选中保持空），探针恒过；`4d6aba0` 改为先回
  中心再回热区的两段移动并追加 `vpBounds` 断言。负向注入（cancel 不清理会话）
  实测探针变红，撤销后复绿。
- 返工提交：`a4f25bb`（E2E 补强）、`33cd97a`（文档收口）、`4d6aba0`（探针强度）。
