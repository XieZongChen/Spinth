import type { BehaviorSubject, Subject } from 'rxjs';
import type { Container, Point, Rectangle, Renderer } from 'pixi.js';
import type * as Y from 'yjs';
/** yjs 文档类型别名（契约层不扩散 yjs 命名空间导入） */
export type YDoc = Y.Doc;
import type { IPoint, IRect } from '../common/geometry';
import type { IBaseModel, IBaseWidgetVm } from './base';
import type { IWidgetData } from './widget';
import type { IEditorAttachStyle } from '../platform/textEngine/richTextEditor';

export type CursorMode =
  'cursor' | 'hand' | 'shape' | 'sticky' | 'text' | 'pen' | 'line' | 'eraser' | 'mind';

export type DocState = 'idle' | 'loading' | 'synced';

/** ws 连接态（docs/10 §2 状态语义拆分）：off = 本地模式 */
export type WsState = 'off' | 'connecting' | 'synced' | 'disconnected';

/** 全局指针回调：按 cursorMode 注册，viewport 统一捕获分发（docs/03 §7） */
export interface IPointerHandlers {
  onPointerDown?(world: IPointerEventInfo): void;
  onPointerMove?(world: IPointerEventInfo): void;
  onPointerUp?(world: IPointerEventInfo): void;
  onPointerUpOutside?(world: IPointerEventInfo): void;
  onRightClick?(world: IPointerEventInfo): void;
  /** 手势取消（Batch 1 · 1.9/1.10）：pointercancel（触控/笔被打断——pixi
   *  EventSystem 不转发原生 cancel，此处补挂 canvas 原生监听）、window blur、
   *  切工具/Esc 收口。语义 = 终止手势不落库不点击（各服务按自身 up 路径收尾
   *  或显式复位）。未实现者由派发层降级为 no-op */
  onPointerCancel?(world: IPointerEventInfo): void;
}

export interface IPointerEventInfo {
  /** 世界坐标 */
  world: Point;
  /** 屏幕坐标 */
  screen: Point;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** Alt+点击 = 编组直选单体（docs/18 §4.2 进组） */
  altKey: boolean;
  /** 原始事件（preventDefault 等） */
  raw: { x: number; y: number };
}

export interface IViewportService {
  initialize(container: HTMLElement, opts: { editable: boolean }): Promise<void>;
  dispose(): void;

  addWidget(displayObject: Container, zOrder: string): void;
  removeWidget(...displayObjects: Container[]): void;
  setZOrder(displayObject: Container, zOrder: string): void;
  readonly optionLayer: Container;

  registerGlobalEventListener(mode: CursorMode, handlers: IPointerHandlers): void;
  /** DOM 事件挂载目标（右键菜单等）；initialize 后可用 */
  readonly container: HTMLElement | null;
  /** 控件层（导出 target 等渲染离线消费；渲染排布归本服务） */
  readonly widgetLayer: Container;
  /** 渲染器（纹理生成/屏幕矩形消费；initialize 前为 null） */
  readonly renderer: Renderer | null;

  readonly cursorMode$: BehaviorSubject<CursorMode>;
  /** 指针世界坐标（awareness 采集源；null = 指针离开画布） */
  readonly curPos$: BehaviorSubject<IPoint | null>;
  readonly vpScale$: BehaviorSubject<number>;
  readonly vpBounds$: BehaviorSubject<IRect>;
  readonly editable$: BehaviorSubject<boolean>;

  setCursorMode(mode: CursorMode): void;
  /** 对指定模式的手势发 cancel（哨兵坐标）：切工具/Esc/运行时只读降级共用的
   *  在途手势收口入口——不收口则交互状态机悬挂（拖拽/框选/绘制半路） */
  dispatchGestureCancel(mode: CursorMode): void;
  /** 悬停态临时光标（连线手柄等非命中对象）：null = 恢复当前模式默认光标 */
  setHoverCursor(cursor: string | null): void;
  toWorld(screen: IPoint): Point;
  toScreen(world: IPoint): Point;
  /** 浏览器 client 坐标 → 世界坐标（window 级拖拽监听用） */
  clientToWorld(clientX: number, clientY: number): Point;
  /** 世界坐标 → **页面 client 坐标**（= toScreen + 画布页面偏移）。
   *  DOM 编辑器/浮层若 position:fixed 挂在 body 上，必须用它——直接用 toScreen
   *  （画布局部坐标）会整体偏掉顶栏高度（2026-09 实测：脑图节点编辑器上移 44px） */
  worldToClient(world: IPoint): Point;
  getPageBounds(): IRect;
  /** 画布可视区尺寸（CSS 像素；焦点跟随等屏幕空间计算的边界输入） */
  getClientSize(): { width: number; height: number };
  /** 视口平移（屏幕像素，正 = 内容右/下移 = 露出左侧/上方世界——pixi-viewport
   *  position 直加，注释曾与实现相反，specs/edge-auto-scroll §2.3-① 核实改写） */
  panBy(dx: number, dy: number): void;
  /** @internal 以最后一次已投递 move 的屏幕坐标重放一次 move（边缘自动滚屏
   *  的每帧补偿）：世界坐标按当前视口现算，走完整 dispatch 闸门。
   *  返回 false = 管线拒发（只读/断网/当前模式无 handler） */
  replayLastPointerMove(): boolean;

  /** immediate = 跳过 200ms 动画精确设置（zoom100 专用——AnimatePlugin 收敛式
   *  插值在慢环境停在残差） */
  setPageScale(scale: number, focus?: IPoint, immediate?: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(padding?: number): void;
}

/** @internal 边缘自动滚屏（specs/edge-auto-scroll，docs/05 §4.5）：拖拽进入
 *  视口边缘热区时按帧平移视口并重放最后一次 move 补偿。仅组合根装配，
 *  selector 在拖拽 move/up/cancel 处上报，不进公开 API */
export interface IEdgeAutoScrollService {
  /** 拖拽中指针 move 上报。dragging=false（未过阻尼/非拖拽）→ 立即停止。
   *  幂等：同一 (screen, dragging) 重复调用不改变行为（重放路径会重复调用） */
  update(screen: IPoint, dragging: boolean): void;
  /** 停 rAF、清速度、摘 pointerleave 监听。可重复调用 */
  stop(): void;
  /** 是否在滚屏（单测断言用；E2E 优先看 vpBounds$） */
  readonly scrolling: boolean;
  dispose(): void;
}

export interface IDataEngineService {
  initialize(config: {
    docId: string;
    wsUrl?: string;
    userName?: string;
    /** false = 只读标签：DbProvider 拒绝文档写入（docs/21 §4）。默认可写 */
    writeEnabled?: boolean;
  }): Promise<void>;
  dispose(): void;
  /** 运行时切换写授权（updateEditable 同步调用——只读宿主不落盘，切回不丢写） */
  setWriteEnabled(v: boolean): void;

  add(data: IWidgetData): IBaseModel<IWidgetData>;
  removeByIds(ids: string[]): void;
  genInitialOrder(): string;

  getModelById(id: string): IBaseModel<IWidgetData> | undefined;

  readonly onModelCreated$: Subject<IBaseModel<IWidgetData>>;
  readonly onModelRemoved$: Subject<string[]>;
  /** 文档任意 update（本地写/undo/redo/远端/replay）——几何变化通知面（docs/06 §3 置脏） */
  readonly onModelUpdated$: Subject<void>;
  readonly docState$: BehaviorSubject<DocState>;
  /** ws 连接态（GC 等维护任务的单机态判定：off = 本地模式） */
  readonly wsState$: BehaviorSubject<WsState>;

  /** @internal Batch 2 · SDK 写面收窄：命令层事务入口，宿主勿调；
   *  origin 非 null 不进 undo 栈（维护写，如 dataURL 迁移） */
  transact<T>(fn: () => T, origin?: unknown): T;
  /** @internal 维护写后的立即 compaction（磁盘塌缩） */
  compactNow(): Promise<void>;
  readonly yWidgets: Y.Array<unknown>;
  /** 底层 Y.Doc（HistoryService 事务监听等内部消费） */
  readonly yDoc: YDoc;
}

export interface IVmEngineService {
  initialize(): void;
  dispose(): void;
  /** VM 创建完成（含恢复）事件流 */
  readonly onVmCreated$: Subject<IBaseWidgetVm>;
  getVmById(id: string): IBaseWidgetVm | undefined;
  getAllVms(): IBaseWidgetVm[];
  /** 主题切换等环境级变化的强制重画（docs/17 C2） */
  refreshAll(): void;
  /** 按 zOrder 顶层优先排序 */
  getVmByPoint(p: Point): IBaseWidgetVm[];
  getVmByRect(r: Rectangle): IBaseWidgetVm[];
  /** 矩形内候选（空间索引粗筛 + bounds 相交；吸附参照物收集用，docs/16 §1） */
  getVmsInRect(r: IRect): IBaseWidgetVm[];
}

/** 脑图节点级拖拽代理（docs/11 §6）：cursor 指针序列按下在非根节点上时由 MindService 接管 */
export interface IMindDragDelegate {
  startDrag(mapId: string, nodeId: string, world: IPoint): boolean;
  dragMove(world: IPoint): boolean;
  /** 'moved' 序列化搬移 / 'new-map' 拖出成新图 / 'click' 单击（焦点落节点，不搬移） / null 未构成序列 */
  dragEnd(world: IPoint): 'moved' | 'new-map' | 'click' | null;
  /** 手势取消（Batch 1 · 1.9）：pointercancel/blur/切工具——复位拖拽会话与预览，
   *  不落库不建图；未实现者由 selector 兜底置 mindDragging=false */
  dragCancel?(): void;
  /** 按下根节点（4.9：整图选中 + 焦点重置根；startDrag 对根返回 false 后触发） */
  focusRoot?(mapId: string): void;
  /** 按下子节点即建立节点级选中态（先于 setSelected——选区框同步时已可判定，
   *  整树框不闪现）；4.9 视觉对齐：节点级选中不画整树选区框 */
  focusNode?(mapId: string, nodeId: string): void;
  /** 当前是否处于节点级选中态（选区框隐藏判定） */
  isNodeSelected?(): boolean;
  /** 焦点节点（根或子节点）的选区框矩形——既有设计点 MIND_NODE 都在**节点本体**上
   *  画蓝框（calculateStageBounds 取 getNodeBounds）；无焦点返回 null */
  getFocusFrame?(): IRect | null;
  /** 框选节点级命中（4.9）：框中根本体 = 整图（焦点回根）；框中子节点 bbox =
   *  节点级选中（既有设计 MIND_NODE 参与 hitTestRect）。选中集仍由 selector 管理 */
  focusFromMarquee?(rect: IRect, mapId: string): void;
  /** 节点拖拽是否已越过判拖阈值（边缘自动滚屏的启用条件；缺省视为未拖起，
   *  按下即滚屏会把世界坐标推过阈值造成「没动鼠标却开始拖拽」） */
  readonly isDragMoved?: boolean;
  readonly isDragging: boolean;
}

export interface ISelectorService {
  initialize(): void;
  dispose(): void;
  readonly selected$: BehaviorSubject<string[]>;
  /** 拖拽移动中的每帧通知（跟随框订阅它实时重定位） */
  readonly dragMove$: Subject<void>;
  /** 脑图节点级拖拽代理（组合根晚绑定 MindService——避免 selector↔mind 构造环） */
  mindDragDelegate: IMindDragDelegate | null;
  setSelected(ids: string[], options?: { silent?: boolean }): void;
  removeSelected(): void;
  /** 缩放流程中由 RectEditor 调用：选区框实时跟随被缩放的形状 */
  updateSelectionFrame(rect: IRect): void;
  /** 脑图焦点变化驱动的选区框重画（焦点框 = 节点选中视觉，组合根接 focusChanged$） */
  refreshSelectionFrame(): void;
  /** 单击「已选中」元素的激活回调（编辑入口；由组合根注入；world = 点击世界坐标） */
  onActivate: ((id: string, type: string, world?: IPoint) => void) | null;
  /** 拖拽松手落库后、stopCapturing **前**的钩子（组合根接锚定线急切重路由——
   *  并入同一撤销项，docs/05 §4.3/§7；ids = 本次拖拽选中集，dx/dy = 末帧吸附
   *  修正位移。此时 root 仍携带末帧预览位移 = 提交后位置，getBounds 直接可用） */
  onDragCommitted: ((ids: string[], dx: number, dy: number) => void) | null;
  /** 连线手势下探（docs/08 §10 批次 2，组合根注入 LineService）：单选连线的
   *  端点手柄抓取——消费返回 true 则 selector 跳过本次手势 */
  lineGestureHook: ((world: IPoint) => boolean) | null;
  /** 手势忙态（拖拽/框选/脑图拖拽中——悬停指示器抑制用） */
  readonly isDragging: boolean;
}

export interface IHistoryService {
  initialize(): void;
  dispose(): void;
  undo(): void;
  redo(): void;
  stopCapturing(): void;
  readonly canUndo$: BehaviorSubject<boolean>;
  readonly canRedo$: BehaviorSubject<boolean>;
}

// ---- 统一编辑会话（docs/17：descriptor 协议 + 双内核 + 全局互斥） ----

export type EditKernelKind = 'html' | 'plain';

/**
 * plain 内核（textarea）编辑样式：与 pixi Text 逐像素对齐所需。
 * lineHeightPx 是**像素值**非倍数——pixi Text 未设 lineHeight 时按 fontSize 度量
 * （mind 编辑器「1.3 倍行高编辑瞬间重影」教训，docs/11 §8）
 */
export interface IPlainEditorStyle {
  /** 世界 px（内核内部 ×scale 应用到 DOM） */
  fontSize: number;
  /** 与渲染侧行高一致（缺省 = fontSize） */
  lineHeightPx: number;
  color: string;
  background: string;
  fontWeight?: string;
  borderRadius?: number;
  /** 世界 px（内核内部 ×scale） */
  paddingX: number;
  paddingY: number;
  /** 世界 px 上限（缺省不限） */
  maxWidth?: number;
}

/** 编辑会话描述符（docs/17 §2）：内核无关的会话契约——控件侧声明一次编辑的全部事实 */
export interface IEditSessionDescriptor {
  /** 编辑目标 widget id（mind 节点 = 所属 MIND_MAP widget id） */
  widgetId: string;
  /** 内核：html = TipTap（TEXT/STICKY/LINE/SHAPE）；plain = textarea（mind 节点） */
  kernel: EditKernelKind;
  /** plain 内核重入判据（mind = nodeId；同 widgetId 不同 nodeKey 必须重建——
   *  IME 合成中重进同节点不重建编辑器，合成会话不被撕掉） */
  nodeKey?: string;
  /** 编辑器世界定位。可重复求值：plain 内核每次 commit 后重取（树重排节点会动）；
   *  html 内核进会话取一次 + 视口变化由内核重放 */
  getRect(): { x: number; y: number; width: number; height: number; rotation?: number };
  /** 初始内容（html 内核 = TipTap HTML；plain 内核 = 纯字符串） */
  getContent(): string;
  /** 编辑视觉（html = IEditorAttachStyle；plain = IPlainEditorStyle） */
  style: IEditorAttachStyle | IPlainEditorStyle;
  /** 34ms 节流后落库（服务统一节流；控件尾巴在此：autoHeight / textRatio 合并 /
   *  mind 的 setText→树重排） */
  onCommit(content: string): void;
  /** 空文本退出策略：'delete-widget'（TEXT/STICKY）/ 'keep'（LINE / SHAPE / mind 节点） */
  emptyTextPolicy: 'delete-widget' | 'keep';
  /** 进会话视觉钩子——主要用法：TEXT/STICKY/SHAPE 的 setTextEditing(true)
   *  （画布文字清出 + 编辑期 render 早退，docs/17 §6）；LINE 收手柄 / mind 建焦点态 */
  onEnter?(): void;
  /** 退会话收尾钩子——在 flush 与空文本策略之后调用（TEXT/STICKY/SHAPE 复位
   *  画布文字并 refresh / LINE 清镂空补 tick、恢复手柄 / mind 焦点恢复）。
   *  discarded = Esc 丢弃退出（不落库不恢复焦点） */
  onExit?(isEmptyText: boolean, meta: { discarded: boolean }): void;
  /** 打字即时量框（不等节流）：LINE 喂镂空；TEXT/STICKY 不实现零开销 */
  onFrameChange?(frame: { width: number; height: number } | null): void;
  /** plain 内核键位拦截（返回 true = 已消费）：mind 的 Tab 建子 / Enter 提交 /
   *  Cmd±缩放。Esc 由内核默认处理（discard 退出） */
  onPlainKeyDown?(e: KeyboardEvent): boolean;
  /** plain 内核初始光标语义（mind 三态选区：落尾 / 全选 / 键入替换） */
  plainCursor?: 'end' | 'selectAll' | { replaceWith: string };
}

/** 统一编辑会话服务（docs/17）：跨控件编辑互斥 + 会话生命周期/节流单源 */
export interface IEditingService {
  /** 进入（或切换到）一个编辑会话：已有活动会话先干净退出（flush → 空文本策略 →
   *  onExit → detach），零残留 */
  begin(descriptor: IEditSessionDescriptor): void;
  /** 退出当前活动会话（Esc / 点外 / dispose / 宿主主动——统一出口，flush 尾字保证）；
   *  discard = 丢弃 pending 不落库（mind Esc 语义） */
  exitActive(opts?: { discard?: boolean }): void;
  /** 当前活动会话的 widget id（各 service 的 editingWidgetId 转发源） */
  readonly editingWidgetId: string | null;
  /** 活动内核（无会话 null）——键位分流/手柄守卫用 */
  readonly activeKernel: EditKernelKind | null;
  /** 会话开始/结束广播（手柄守卫/选区框/awareness 跟随的重算触发器） */
  readonly session$: Subject<void>;
}
