import type { BehaviorSubject, Subject } from 'rxjs';
import type * as Y from 'yjs';
import type { Container, Point, Rectangle } from 'pixi.js';
import type { IHostGeom, IPoint, IRect, JoinDir } from '../common/geometry';
import type { IWidgetData } from './widget';

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

  readonly onStateChanged$: Subject<IOnStateChangedInfo>;
  readonly onSelected$: BehaviorSubject<boolean>;
  readonly onRemoved$: Subject<void>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
