import type { BehaviorSubject, Subject } from 'rxjs';
import type * as Y from 'yjs';
import type { Container, Point, Rectangle } from 'pixi.js';
import type { IHostGeom, IPoint, IRect, JoinDir } from '../common/geometry';
import type { IWidgetData } from './widget';

/** 轴的 world 几何（specs/sequence-diagram §4.1）：x = 轴，top / bottom = 轴段两端。
 *  轴锚定宿主（生命线）经 getAxisAnchor 探针给出；连线落点、消息平移、加长保高度
 *  都以它为坐标系 */
export interface IAxisAnchor {
  x: number;
  top: number;
  bottom: number;
}

/** 状态变化事件：diff 为字段级增量；local 区分本地/远端来源（协同语义的关键透传） */
export interface IOnStateChangedInfo {
  diff: Record<string, unknown>;
  local: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- yjs 生态惯例：Y.Map<any> */
export interface IBaseModel<D extends IWidgetData = IWidgetData> {
  readonly id: string;
  /** @internal Batch 2 · SDK 写面收窄（2026-10-18）：宿主禁止持此引用直写——
   *  绕过 DataProcessor 同值跳过/审计日志；命令面走 update()/updateRect() */
  readonly yData: Y.Map<any>;
  /** 控件能力位（交互层查询：不可缩放的类型不出手柄等；docs/02 §5） */
  readonly capabilities: IWidgetCapabilities;

  /** 本地新建：new Y.Map + 经 DataProcessor 写入，返回后由 DataEngine push 进数组 */
  initialize(data: D): Y.Map<any>;
  /** 远端已存在：修补 → 校验 → 绑定 */
  initializeY(yData: Y.Map<any>): void;

  update(patch: Partial<D>): void;
  updateRect(patch: Partial<IRect>): void;
  toJSON(): D;
}

export interface IBaseWidgetVm<D extends IWidgetData = IWidgetData> {
  readonly id: string;
  readonly type: D['type'];
  /** PIXI 显示对象，挂 widgetLayer */
  readonly root: Container;
  readonly model: IBaseModel<D> | null;

  setModel(model: IBaseModel<D>): void;
  setState(next: Partial<D>, local?: boolean): void;
  /** 立即应用待合批的更新（编辑入口同步读几何前调用） */
  flushUpdate(): void;
  /** 主题切换等环境级变化的强制重画（docs/17 C2——vmEngine.refreshAll 消费） */
  refresh(): void;
  dispose(): void;

  hitTestPoint(p: Point): boolean;
  hitTestRect(r: Rectangle): boolean;
  /** 当前几何（世界坐标；拖拽中反映视觉位置） */
  getBounds(): IRect;
  /** 数据语义几何（docs/05 §8 拆分）：rect 型 = 数据矩形；points/树型 = getBounds */
  getLocalRect(): IRect;
  /** 锚定链宿主几何（docs/05 §8）：视觉局部矩形 + θ */
  getHostGeom(): IHostGeom;
  /** 宿主当前旋转角（弧度，docs/05 §8） */
  getRotation(): number;
  /** 锚点世界坐标（specs/flowchart-closeout §7.1）：join 边 + 沿边参数
   *  t ∈ [0,1]（0.5 = 中点，缺省）。geom 显式传入 = 以该宿主几何为准（急切
   *  reattach 传落库后的权威几何——vm root 尚未重渲染，读 vm 会滞后一拍产生
   *  幻影事务）；缺省 = getHostGeom()（预览敏感，拖拽跟随用） */
  getAnchorPoint(join: JoinDir, t: number, geom?: IHostGeom): IPoint;

  /* ---- 交互几何（docs/05 §4）：视觉反馈例外条款的 per-type 封装 ----
   * rect 型（x/y/w/h 几何）用基类默认实现；points 世界坐标型（LINE/PEN）
   * 必须覆写——root 钉在原点，平移/缩放语义都落在 points 上。 */

  /** 拖拽视觉平移（每帧，绝对定位，禁止增量累加） */
  applyDragPreview(initBounds: IRect, dx: number, dy: number): void;
  /** 拖拽落库（松手一次）：以初始 bounds + 全量 delta 推导 */
  commitDrag(initBounds: IRect, dx: number, dy: number): void;
  /** 缩放视觉预览（每帧）：从 startRect → nextRect 推导视觉形变 */
  applyResizePreview(startRect: IRect, nextRect: IRect): void;
  /** 缩放落库（松手一次）：写 lastNext 目标矩形对应的真实数据 */
  commitResize(startRect: IRect, nextRect: IRect): void;
  /** 旋转视觉预览（docs/05 §8）：直写 root.rotation 零落库 */
  applyRotatePreview(theta: number): void;
  /** 旋转落库（松手一次）：写 rotation 字段 */
  commitRotate(theta: number): void;

  /** 缩放整形（specs/sequence-diagram §3.5）：next = 吸附 / 量化之后的目标矩形，
   *  返回整形后的目标矩形。经 `resizeMath.planResize` 以方法形式调用（this = vm）——
   *  预览 / 编辑框 / 选区框 / 落库同源（VM 层各自整形会让编辑框按未整形的矩形画）。
   *  契约：保持被拖边（dir 所指的边）的位置——那是吸附落点，挪了命中线就对不上。
   *  θ ≠ 0 的旋转态不调用：需要整形的控件都不可旋转。缺省 = 不整形 */
  constrainResize?(start: IRect, next: IRect, dir: ResizeDir): IRect;

  /* ---- 轴锚定探针（specs/sequence-diagram §4.1）：可选成员、以方法形式调用
   * （this = vm）；服务层不按 type 分支（docs/14 规则 6）。缺省 = 不是轴宿主 /
   * 不具备该语义 ---- */

  /** 轴锚定宿主（LifelineVm 实现）；null = 无轴（退化件）或非轴宿主。
   *  geom 显式传入 = 以该宿主几何为准（急刻重路由传落库后的权威几何）；
   *  缺省 = getHostGeom()（预览敏感，拖拽 / 缩放跟随用） */
  getAxisAnchor?(geom?: IHostGeom): IAxisAnchor | null;
  /** false = 不作连线目标：连线拾取跳过它继续取下层（ActivationVm 实现） */
  isConnectionTarget?(): boolean;
  /** 本件移动 / 缩放 / 新建 / 删除后需要重路由的锚定宿主；缺省 = [自身 id]
   *  （ActivationVm 返回 [lifelineId]，未绑定返回 []） */
  anchorFollowHosts?(): string[];
  /** 两端都锚在生命线轴上的直线，可沿轴平移（LineVm 实现；§4.5） */
  isAxisMessage?(): boolean;
  /** 只沿纵轴缩放的件（ActivationVm 实现，specs/sequence-diagram §3.5）：缩放吸附
   *  只取手柄方向的纵向分量（se → s），横向不参与参考线吸附与网格量化 */
  resizeAxis?(): 'v' | null;

  readonly onStateChanged$: Subject<IOnStateChangedInfo>;
  readonly onSelected$: BehaviorSubject<boolean>;
  readonly onRemoved$: Subject<void>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 时序图 VM 只读查询（specs/sequence-diagram §9.4 / §9.5）：LifelineVm / LineVm
 *  经构造注入，组合根晚绑定注册 Tokens.SequenceLookup（门面闭包读服务——直接
 *  注册服务本体会在 registry.dispose 时被二次 dispose）。实现是 SequenceService；
 *  widgets/line 不能反向依赖 widgets/sequence，所以经此接口（分层纪律同
 *  IFrameLookup 先例）。未组装（无时序图的组合）axisOf 返回 null */
export interface ISequenceLookup {
  /** 轴宿主的轴（视觉感知，预览期跟随）；非轴宿主 / vm 缺失返回 null */
  axisOf(id: string): IAxisAnchor | null;
  /** 绑定在某条生命线上的激活条的世界矩形（预览敏感） */
  barsOf(lifelineId: string): IRect[];
}

/** 激活条随生命线的级联钩子（specs/sequence-diagram §5.3 / §9.4）：与 IFrameLookup
 *  同款的分层纪律——平台层不 import widgets/sequence，经 composeCascadeLookup 把它
 *  与容器钩子合成同一个 IFrameLookup 后消费。实现是 SequenceService */
export interface IActivationLookup {
  /** 生命线 → 并入其绑定的激活条（zOrder 升序；非激活条的入参原样由合成方保留） */
  expandActivations(ids: string[]): string[];
  /** 落点绑定判定并落库（§5.1）：条中心线贴合某条轴即绑定并归中，否则解绑。
   *  **只在事务内调用**（S7：绑定写与触发操作同一事务）；rectOf 事务内不许读 vm
   *  （state 是微任务合批旧值）——宿主轴同样由 rectOf 算术推导 */
  reconcileActivations(ids: string[], rectOf: (id: string) => IRect): void;
  /** 粘贴收尾：无绑定的激活条副本落在轴上即绑定并归中（§5.4）。
   *  **只在事务内调用**；矩形直读 model */
  adoptActivationsByLanding(ids: string[]): void;
}

/** 缩放手柄方向（角 = 双轴，边 = 单轴）：整形探针的入参，rectEditor 的 HandleDir 沿用 */
export type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 控件能力位：交互层查询，控件自声明（docs/02 §4 六元；rotatable 2026-10-15 旋转批、groupable 2026-10-17 编组批） */
export interface IWidgetCapabilities {
  resizable: boolean;
  /** 可旋转（docs/05 §8）：rect 四类 true；LINE/PEN/MIND_MAP false */
  rotatable: boolean;
  /** 可编组（docs/18 §2）：自由六类 true；MIND_MAP false（节点级选中走焦点体系）。
   *  LINE 的锚定态排除是运行时判定，不进能力位 */
  groupable: boolean;
  movable: boolean;
  selectable: boolean;
  keepRatio: boolean;
  /** 统一编辑会话三类 TEXT/STICKY/SHAPE（第五刀扩；LINE 线上文字走独立通道） */
  editable: boolean;
  /** 参考线参照物（docs/06 §2 四类） */
  referenceable: boolean;
  /** 分段橡皮目标（仅 PEN 笔迹） */
  erasable: boolean;
}
