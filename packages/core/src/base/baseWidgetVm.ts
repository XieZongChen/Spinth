import { Container, Point, Rectangle } from 'pixi.js';
import type * as Y from 'yjs';
import { BehaviorSubject, Subject } from 'rxjs';
import { deepDiff } from '../utils/deepDiff';
import {
  bboxAnchor,
  type IHostGeom,
  type IPoint,
  type IRect,
  type JoinDir,
} from '../common/geometry';
import { markRender } from '../common/render';
import type { IBaseModel, IBaseWidgetVm, IOnStateChangedInfo, IWidgetData } from '../types';
import { BaseVm } from './baseVm';
import { projectIncremental } from './projection';

/**
 * 控件 VM 基类（docs/04 §2/§4）：
 * - setModel 模板方法：订阅 yData.observeDeep → setState → diff → render → 广播
 * - transaction.local 透传到 onStateChanged$（本地/远端来源标记）
 * - 渲染形态 = f(Model 数据, state)；VM 不缓存业务数据
 */
export abstract class BaseWidgetVm<D extends IWidgetData = IWidgetData, S extends D = D>
  extends BaseVm<S>
  implements IBaseWidgetVm<D>
{
  readonly root: Container = new Container();
  readonly onStateChanged$ = new Subject<IOnStateChangedInfo>();
  readonly onSelected$ = new BehaviorSubject(false);
  readonly onRemoved$ = new Subject<void>();

  private _model: IBaseModel<D> | null = null;
  /** 待广播的 diff：渲染微任务完成后由 afterUpdate 发出（保证订阅者读到新几何） */
  private pendingDiff: Record<string, unknown> | null = null;
  private pendingLocal = true;

  protected constructor(initialState: S) {
    super(initialState);
    this.root.eventMode = 'none'; // 控件本身不接收事件，交互走全局分发
  }

  get id(): string {
    return this._model?.id ?? '';
  }

  get type(): D['type'] {
    return (this.state as unknown as D).type;
  }

  get model(): IBaseModel<D> | null {
    return this._model;
  }

  setModel(model: IBaseModel<D>): void {
    if (this._model) {
      throw new Error('[BaseWidgetVm] 不允许重复 setModel');
    }
    this._model = model;
    this.onModelUpdate(model);
    this.setState(model.toJSON() as unknown as Partial<S>);
  }

  protected onModelUpdate(model: IBaseModel<D>): void {
    /* eslint-disable @typescript-eslint/no-explicit-any -- yjs 事件泛型惯例 */
    const handler = (events: Y.YEvent<any>[], tr: Y.Transaction): void => {
      // 增量投影（docs/16 §4）：YEvent path/keys → 顶层键直读构造 partial，
      // 绕过全量 toJSON + 全字段 diff；null = 无法增量兜底全量
      const partial = projectIncremental<D>(model, events as Y.YEvent<never>[]);
      this.setState((partial ?? (model.toJSON() as unknown as Partial<D>)) as Partial<S>, tr.local);
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
    model.yData.observeDeep(handler);
    this.addDisposable(() => model.yData.unobserveDeep(handler));
  }

  /** 子类一般不覆盖：带来源标记的 setState。渲染在微任务中批处理，
   *  广播延迟到渲染完成之后（afterUpdate）——否则订阅者（选区框/编辑器框/
   *  连线跟随）读 root 几何时拿到旧帧（缩放松手后框回弹的根因）。 */
  override setState(next: Partial<S>, local = true): void {
    const diff = deepDiff(this.state as object, next as object);
    if (Object.keys(diff).length === 0) return;
    // undefined 直接并入（键删除的合法投影——undo 删 optional 字段如 rotation：
    // 跳过会让 state/渲染/探针停在旧值）。旧「跳过 undefined」守卫防的毒化
    // 场景在 deepDiff 收敛为 next-only 遍历后已不存在（partial 缺席的键
    // 不会产生 undefined diff）
    for (const [k, v] of Object.entries(diff)) {
      this.pendingDiff = { ...(this.pendingDiff ?? {}), [k]: v };
    }
    this.pendingLocal = local;
    super.setState(next);
  }

  protected override afterUpdate(_prev: S): void {
    if (this.pendingDiff) {
      this.onStateChanged$.next({ diff: this.pendingDiff, local: this.pendingLocal });
      this.pendingDiff = null;
      this.pendingLocal = true;
    }
  }

  /** 主题切换等环境级变化后的强制重画（绕过 diff 管线——textVm 等以内部
   *  守卫（主题版本）自行判定是否全量重建；docs/17 挂账清理 C2） */
  refresh(): void {
    this.render(this.state, this.state);
    markRender();
  }

  abstract hitTestPoint(p: Point): boolean;

  hitTestRect(r: Rectangle): boolean {
    const b = this.root.getLocalBounds();
    const world = { x: this.root.x, y: this.root.y };
    return (
      world.x < r.x + r.width &&
      r.x < world.x + b.width &&
      world.y < r.y + r.height &&
      r.y < world.y + b.height
    );
  }

  /** 当前几何（世界坐标；缩放感知——scale ≠ 1 的视觉过程中同样正确）。
   *  抽象而非默认实现：各控件几何语义不同，且 localBounds 不可靠——
   *  rect 型会被描边外溢 0.5px/边（resize 起点矩形偏大，每次缩放 +1 漂移），
   *  points 型是 points bbox + root 拖拽偏移。子类必须按数据语义实现。
   *  旋转首版起 rect 型返回世界 AABB（docs/05 §8 拆分）。 */
  abstract getBounds(): IRect;

  /** 数据语义几何（docs/05 §8 getBounds 拆分）：rect 四类覆写返回数据矩形
   *  （未旋转局部系——resize/锚定链/微移的输入语义）；points/树型默认 =
   *  getBounds（无旋转概念，两语义等价）。 */
  getLocalRect(): IRect {
    return this.getBounds();
  }

  /** 锚定链视角的宿主几何（docs/05 §8）：默认 = 视觉 AABB + root.rotation
   *  （points/树型 root 恒无旋转——与旧 reattach(getBounds) 语义等价）；
   *  rect 四类覆写为「从 root 变换反推的视觉局部矩形 + θ」（预览感知）。 */
  getHostGeom(): IHostGeom {
    return { rect: this.getBounds(), rotation: this.root.rotation };
  }

  /** 宿主当前旋转角（弧度）：接口面不暴露 state 的惯例下供锚定链读取
   *  （docs/05 §8；points/树型恒 0） */
  getRotation(): number {
    return (this.state as { rotation?: number }).rotation ?? 0;
  }

  /** 锚点世界坐标默认实现（specs/flowchart-closeout §7.1）：bbox 边插值 + θ。
   *  geom 显式传入 = 以该宿主几何为准（急切 reattach 权威几何，防 vm root
   *  渲染滞后产生幻影事务）；缺省 = getHostGeom()（预览敏感）。
   *  ShapeVm 覆写为轮廓交点（非矩形形状锚点贴边，G-04） */
  getAnchorPoint(join: JoinDir, t: number, geom?: IHostGeom): IPoint {
    const g = geom ?? this.getHostGeom();
    return bboxAnchor(g.rect, join, t, g.rotation);
  }

  /* ---- 交互几何默认实现（rect 型语义；points 世界坐标型在 LINE/PEN 覆写） ---- */

  /** pivot 式根变换单源（docs/05 §8 渲染落点）：x/y = 数据左上（未旋转局部
   *  系，数据语义不变），pivot = 中心、position = 中心——θ=0 时视觉左上 =
   *  posX − pivotX = x，与旧「position=左上」渲染逐字节等价。不碰 scale：
   *  「快速路径不碰 scale」是既定语义（也是单测区分快速/全量的探针），
   *  预览残留的 scale 由全量渲染尾部显式复位。 */
  protected applyRootTransform(x: number, y: number, w: number, h: number, rotation: number): void {
    this.root.pivot.set(w / 2, h / 2);
    this.root.position.set(x + w / 2, y + h / 2);
    this.root.rotation = rotation;
  }

  /** 拖拽视觉平移：绝对定位 init + delta（docs/14 规则 1，禁止增量累加）。
   *  pivot 式下 position = 视觉中心（init 语义 = getLocalRect）。 */
  applyDragPreview(initBounds: IRect, dx: number, dy: number): void {
    this.root.position.set(
      initBounds.x + dx + initBounds.width / 2,
      initBounds.y + dy + initBounds.height / 2,
    );
  }

  /** 拖拽落库：rect 型写 x/y */
  commitDrag(initBounds: IRect, dx: number, dy: number): void {
    this._model?.updateRect({ x: initBounds.x + dx, y: initBounds.y + dy });
  }

  /** 缩放视觉预览（松手由 render 重置）：pivot 固定 startRect 半尺寸——
   *  scale 绕中心长，position = nextRect 新视觉中心；rotation 不动（旋转态
   *  缩放自动呈现「沿控件自身轴缩放」，docs/05 §8）。 */
  applyResizePreview(startRect: IRect, nextRect: IRect): void {
    this.root.position.set(nextRect.x + nextRect.width / 2, nextRect.y + nextRect.height / 2);
    this.root.scale.set(
      startRect.width > 0 ? nextRect.width / startRect.width : 1,
      startRect.height > 0 ? nextRect.height / startRect.height : 1,
    );
  }

  /** 缩放落库：直接写 lastNext 目标矩形（禁止从视觉反推，docs/14 规则 4） */
  commitResize(_startRect: IRect, nextRect: IRect): void {
    this._model?.updateRect(nextRect);
  }

  /** 旋转视觉预览（docs/05 §8）：直写 root.rotation（零落库——pivot 式下
   *  其余变换不动）；锚定线实时跟随由手势编排层回调 */
  applyRotatePreview(theta: number): void {
    this.root.rotation = theta;
    markRender();
  }

  /** 旋转落库：写 rotation 字段（schema 属性，单事务 = 一步 undo） */
  commitRotate(theta: number): void {
    this._model?.update({ rotation: theta } as never);
  }

  override dispose(): void {
    this.onRemoved$.next();
    this.onRemoved$.complete();
    this.onStateChanged$.complete();
    this.root.destroy({ children: true });
    super.dispose();
  }
}
