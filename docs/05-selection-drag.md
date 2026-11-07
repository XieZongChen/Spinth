# 05 — 选中体系与拖拽

## 1. 设计目标

- 选中状态只有一个权威来源：`SelectorService.selected$（有序 id 数组）`。
- 拖拽与视口同时移动时坐标零漂移。
- 拖拽期间不产生 Yjs 写，松手一次落库。
- 所有平移/缩放落库走控件的交互几何契约，不在 Service 里直接改模型。

## 2. 四种“框”的职责

| 组件           | 职责                                           | 触发                   |
| -------------- | ---------------------------------------------- | ---------------------- |
| `SelectorVm`   | 空白处拖出的框选橡皮筋（半透明填充）           | cursor 模式空白处 down |
| `SelectionVm`  | 多选/混合选区外框（可拖动）                    | ≥1 选中                |
| `RectEditorVm` | 单选元素的边框 + 四角缩放手柄 + 四边不可见热区 | 单选                   |
| `RangeVm`      | 协同用户选中框（awareness，见 docs/10 §4）     | 多选 / 协同            |

选中态视觉语言：

- 一个元素任何时刻只有一层选中视觉；脑图节点焦点框也走同一 `SelectionVm`。
- 框 = 2px 实线 + 6px 圆角 + 8% 透明填充；线宽屏幕恒定（`/scale` 补偿）。
- 功能蓝 `#2878ff`，与缩放手柄一致；手柄白心蓝边。
- 常量唯一色源：`common/selectionStyle.ts`。

## 3. 选中数据流

```
pointerdown
  ├─ 命中元素 → shift 加/减选；否则单选
  ├─ 命中 rectEditor 手柄 → 进入 resize 流程
  └─ 空白 → 清空选中 + 开启框选

pointermove（框选中）
  └─ selectArea$ 更新 → getVmByRect 实时命中并高亮

pointerup
  ├─ 未拖动 && 命中当前单选元素 → 进入编辑态
  │   （LINE 例外：双击才进文字编辑，docs/08 §10.3）
  └─ shift 切换加选确认
```

- `setSelected(ids)` diff 出 inserted/removed，逐个派发 `vm.onSelected$`，保持选中顺序。
- 编组扩展（docs/18 §4）：点击组员 = 选中整组存活成员；Alt+点击 = 直选单体；
  shift 以组为单位切换；框选整组全入框才选整组。
- 脑图节点级选中：选中集仍是 widget id（MIND_MAP 不拆），节点语义由 MindService
  焦点承载；框选时对命中的 MIND_MAP 委托 `focusFromMarquee`。
- RectEditor 手柄/旋转手势在 down 时置单击激活抑制，清除单源在手势终止
  （window up / cancelGesture）：手柄 down 被 `stopPropagation`，up 仍冒泡到
  stage——该 up 不得当 click，否则缩放/旋转松手会误进编辑（edit 早退还会
  保留 resize 预览 scale，框与图形脱节）。selector 只读判定，不得在
  down/cancel/up 里清除或消费：blur（切窗）、pointercancel、多指第二个
  down 都不是手势终止，中途泄掉会让复窗松手/第二指 up 误进编辑。

## 4. 拖拽状态机

### 4.1 阻尼阈值

- 单一启动阻尼 10px（`DRAG_TRACTION`）：累计位移超过阈值才进入拖拽。
- `DragEvent` 携带 `originX/Y、deltaX/Y、bounds`；`isPrevented` 支持中途取消。
- window mouseup 兜底清理未结束的拖拽流。

### 4.2 offset 法（不是 delta 法）

```
dragStart: offsetX/Y = 鼠标世界坐标 - 选区左上角
dragMove:  选区位置 = 当前鼠标世界坐标 - offset
```

拖拽中视口可能同时移动；delta 法会累计漂移，offset 法天然正确。

### 4.3 拖拽中零 Yjs 写入

- 每帧两层视觉反馈，均不写 Yjs：
  - 元素预览：`vm.applyDragPreview(init, dx, dy)`；
  - 选区框：绝对定位 `moveTo(initUnion + 全量 delta)`，禁止增量累加。
- 参考线吸附（docs/06 §5）作用于期望位移，修正后的 dx/dy 同时用于预览与落库。
- 松手：对每个选中 vm 调 `vm.commitDrag(init, dx, dy)`，包一个
  `engine.transact` = 一次撤销。
- **必须用拖拽状态里最后一帧吸附修正后的位移**（`lastDx/lastDy`），
  禁止从指针原始差值重算，否则「拖拽中对齐、松手跳回」（docs/14 规则 5）。
- 落库后经 `onDragCommitted` 钩子急切重路由锚定线，并入同一撤销项。
- 脑图节点拖拽走独立通道（DropArea + 落点预览，docs/11）。

### 4.4 交互几何 per-type 契约

拖拽/缩放的「视觉预览 + 松手落库」是 `IBaseWidgetVm` 的四个可覆写方法；
selector/rectEditor 禁止直接改 root 或 `updateRect`。

| 方法                              | rect 型（SHAPE/TEXT/STICKY/IMAGE） | points 世界坐标型（LINE/PEN）                           |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `applyDragPreview(init, dx, dy)`  | `root.position = init + delta`     | `root.position = delta`（root 恒在原点）                |
| `commitDrag(init, dx, dy)`        | `updateRect({x, y})`               | `update({points: 平移后的 points})`                     |
| `applyResizePreview(start, next)` | `root.position + root.scale`       | `mapPointsRect(points, start, next)`（禁止 root.scale） |
| `commitResize(start, next)`       | `updateRect(next)`                 | `update({points: 重映射后的 points})`，线宽字段不动     |

- 一切平移落库入口（选区拖拽、键盘微移、UI 命令）一律调 `vm.commitDrag`。
- 缩放松手：`commitResize` 后、`stopCapturing` 前经 `onResizeCommitted`
  急切重路由锚定线。
- **LINE 例外**：线不可整体拖动/缩放，四个覆写为空操作；线只随锚定节点移动或拖端点重锚定。
  自由线在对齐/分布命令中经 points 平移参与，不冲突。
- `getBounds()`：rect 型返回旋转后的世界 AABB；points 型返回 points bbox + root 偏移。
  `getLocalRect()` 返回未旋转数据矩形，供 resize/锚定/微移使用。
- `hitTestPoint`：points 型先减 root 偏移再判定。

### 4.5 边缘自动滚屏

拖拽（元素拖拽、脑图节点拖拽、框选）进入视口边缘热区时按帧自动平移视口，被拖
元素与框选橡皮筋始终跟手。规格与实现细节见 `specs/edge-auto-scroll` 与
`specs/marquee-auto-scroll`；要点契约：

- 作用域：元素拖拽 + 脑图节点拖拽 + 框选；缩放/旋转手柄、创建类手势不滚屏。
- 热区 120 屏幕像素（与缩放无关），两轴独立判定，四角斜向各自到最大速度。
- 速度连续线性斜坡（屏幕 px/s）：`v = 1080 × (1 − d/120)`（d = 到该侧边缘的
  屏幕距离）——热区外沿 0、边缘最大 1080、越界钳到最大；d=100px 处恰为
  180（旧慢档手感锚点），无档位跳变。帧位移 = 速度 × dt，dt 钳制
  [0, 50ms]（后台标签页回前台不瞬移）。
- 方向：右/下边缘 `panBy` 传负值（panBy 正值 = 内容右/下移 = 露出左侧/上方世界）。
- 补偿：每帧 `panBy` 后以最后一次指针**屏幕**坐标重放一次 move
  （`viewport.replayLastPointerMove()`），世界坐标按当前视口现算重走完整闸门；
  不做位置加法补偿——元素屏幕位置天然不变（§1 坐标零漂移的滚屏延续）。
- 启用条件：只在拖拽越过阻尼阈值后（`dragState.moved` / 脑图 `isDragMoved`）；
  按下即滚屏会把世界坐标推过阈值，造成「没动鼠标却开始拖拽」。框选同款：屏幕
  位移 ≥10px（`MARQUEE_TRACTION_SCREEN`，锁存）为起拖判据，只门控滚屏——矩形
  与选中从 pointerdown 起「过程即结果」不受判据影响；选中集按帧与上次写入序列
  去重（滚屏稳态零 `setSelected`）。
- 停止条件：指针离热区 / 未过阻尼 / 松手 / 手势取消（切工具、只读降级、
  blur、pointercancel）/ 指针离开画布容器（pointerleave）/ 输入管线拒发（回滚
  本帧）/ 进入编辑会话 / dispose。（Esc 不在此列：它走清选中路径，
  `setCursorMode` 同模式早退不发手势取消。）
- 落库语义不变：一次拖拽一次 `transact` = 一次撤销；松手用最后一帧
  `lastDx/lastDy`（docs/14 规则 5）。框选全程零 Yjs 写、零撤销项，松手选中集
  即交互最后一帧的命中结果（世界矩形全量命中，不裁剪视口）。
- 实现位置：`platform/viewport/edgeScrollMath.ts`（纯函数）+
  `edgeAutoScrollService.ts`（帧循环，独占 rAF）；`SelectorService` 仅在
  move/up/cancel 处上报指针位置与起停。

## 5. 高频合并策略

| 场景                               | 策略                                        |
| ---------------------------------- | ------------------------------------------- |
| 拖拽中依赖元素状态重算（连线跟随） | promise 合并到事件循环末尾，一帧一次        |
| 操作栏 bounds 跟随                 | 拖拽开始置空隐藏，结束重算；平时 30fps 节流 |
| 多选时依赖订阅                     | diff 增删订阅，不全量重订                   |

## 6. 键盘微移与删除

- 方向键：1px 微移（Shift = 10px）；支持八向组合。
- Delete/Backspace：删除选中；脑图走焦点删除规则。
- Esc：清空选中 / 退出编辑态 / 取消工具。

## 7. 多选几何命令：对齐/分布

- 组参与体折叠（docs/18 §5）：整组在集 = 并为单参与体（union bounds，delta 同值摊回
  每成员）；Alt 部分在集按单体参与。
- 对齐六向：左 / 水平居中 / 右 / 上 / 垂直居中 / 下。
- 分布两向：沿轴排序后等距化相邻间隙；两端不动，中间重排；总宽不足时间隙为负照算。
- 以选中集最小包围盒为基准；对齐后重叠/贴边不做特殊处理。
- rect 型、PEN、MIND_MAP 按刚体参与；自由线走 points 平移；锚定线不直接移动、
  不计入基准，宿主移动时自动重路由。
- 落库：一个 `engine.transact` 完成全部位移；随后对每个移动过的宿主急切 reattach；
  `stopCapturing()` = 一次撤销。
- 算法：`alignOps.ts` 的纯函数 `computeAlignDeltas` /
  `computeDistributeDeltas`；测试见 `alignOps.test.ts` + `e2e/align.spec.ts`。

## 8. 旋转

- 范围：SHAPE/TEXT/STICKY/IMAGE 四类 rect 型；LINE/PEN/MIND_MAP 首版不旋转。
- 只做单选；旋转手柄仅单选出现，多选不出。
- 数据：`rotation: z.number().optional()`（无 default，旧文档零迁移），弧度存储，
  绕中心顺时针；不是 yRect 几何字段。
- 渲染：`root.pivot = (w/2, h/2)`、`root.position = (x+w/2, y+h/2)`、
  `root.rotation = θ`；x/y 数据语义（未旋转局部矩形左上角）不变。
- `getBounds()` = 世界 AABB；`getLocalRect()` = 数据矩形。
- 命中：点逆变换到局部系判定；框选走旋转矩形 vs marquee 精判。
- 旋转手柄：nw 角外斜向 45° 悬浮圆点约 20px；拖拽绕中心，Shift 15° 步进；
  preview 直写 `root.rotation`，松手 `model.update({ rotation })` 单事务。
- 首版降级：旋转件不参与参考线/等间距；多选框/awareness 框恒 AABB；
  ActionBar 按 AABB 定位；对齐/分布按外接矩形。多选整体旋转挂账。
