import { Graphics, Point, Text, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { markRender } from '../../common/render';
import { hexToNum } from '../../common/color';
import { rotatedRectBounds } from '../../platform/rectEditor/rotateMath';
import { defaultTextColor, textThemeVersion } from '../../platform/textEngine/theme';
import { type IHostGeom, type IPoint, type IRect, type JoinDir } from '../../common/geometry';
import type { IAxisAnchor, ISequenceLookup, LifelineData, ResizeDir } from '../../types';
import { axisAnchorPoint, axisAnchorWithInset } from '../line/lineAxisAnchor';
import {
  constrainLifelineResize,
  LIFELINE_HEAD_BORDER,
  LIFELINE_HEAD_COLOR,
  LIFELINE_LABEL_FONT_SIZE,
  lifelineAxis,
  lifelineAxisDashSegments,
  lifelineAxisHitHalf,
  lifelineAxisOf,
  lifelineHeadHeight,
  lifelineHitTest,
  lifelineHitTestRect,
  lifelineLabelRect,
  truncateLifelineLabel,
} from './lifelineGeometry';

/**
 * 生命线视图层（specs/sequence-diagram §3.6）：头框（白底 + 1px 深描边）+ 居中
 * 单行标签 + 自头框底边到 bbox 底边的竖直虚线轴（色 = 主题墨色）。head 'actor'
 * 的绘制属批次 4，本批一律画矩形头框（数据字段先落）。
 * 命中 = 头框 ∪ 轴带（§3.3），轴带半宽按屏幕 px 折算（getScale 构造注入，现算不
 * 缓存）。连线落在轴上（§3.2 轴锚点：四个 join 的 t 都是轴上高度比例，横向让出
 * 一个线端留隙），并豁免避障（否则通用折线会绕开每一条生命线）。缩放整形经
 * constrainResize 探针（§3.5）。
 */
export class LifelineVm extends BaseWidgetVm<LifelineData & IRect> {
  /** 头框与轴共用一块 Graphics（全量重绘 = clear + 重画） */
  private readonly g = new Graphics();
  private labelText: Text | null = null;
  /** 编辑态开关（descriptor onEnter/onExit 闭包直调，FRAME 标题同模式）：进编辑
   *  清出画布标签 + 编辑期 render 早退；退出自 refresh 全量恢复 */
  private _labelEditing = false;
  /** 渲染时主题版本（轴色随主题）：setTheme 的 refreshAll 走 render(state,state)，
   *  无守卫会被快速路径吞掉 */
  private renderedThemeVer = 0;

  /** vpScale 注入（widgetRuntime 工厂经 Tokens.ViewportService 解析；缺省 1）；
   *  sequence = 激活条只读查询（锚点让位用，VM 不持服务引用；未注入 = 无条） */
  constructor(
    private readonly getScale: () => number = () => 1,
    private readonly sequence: Pick<ISequenceLookup, 'barsOf'> | null = null,
  ) {
    super({
      id: '',
      type: 'LIFELINE',
      zOrder: '',
      label: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    this.root.addChild(this.g);
  }

  setLabelEditing(editing: boolean): void {
    if (this._labelEditing === editing) return;
    this._labelEditing = editing;
    if (!editing) {
      this.refresh(); // 退出强制全量恢复：refresh = render(state,state) 绕 diff 管线
      return;
    }
    // 进编辑：立即清出画布标签（编辑器 DOM 独占视觉，不双显）
    this.destroyLabel();
    markRender();
  }

  override render(prev: LifelineData & IRect, next: LifelineData & IRect): void {
    // 编辑期早退：编辑器 DOM 独占标签视觉，落库触发的重绘全免（短路只能放 render
    // 内，setState/onStateChanged$ 广播链不受影响）
    if (this._labelEditing) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      return;
    }
    const hasLabel = (next.label ?? '').length > 0;
    // 纯平移快速路径：重绘键（label / head / width / height / 主题版本）全未变只改
    // root 变换；有标签时要求 labelText 存在（编辑退出销毁后强制全量重建）
    if (
      prev.label === next.label &&
      prev.head === next.head &&
      prev.width === next.width &&
      prev.height === next.height &&
      this.renderedThemeVer === textThemeVersion() &&
      (!hasLabel || this.labelText !== null)
    ) {
      this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
      return;
    }
    this.renderedThemeVer = textThemeVersion();
    this.g.clear();
    // 头框：整条宽 × 头区高（高度不足头区高时就是整个 bbox；零尺寸不画）
    const headH = Math.min(lifelineHeadHeight(next.head), Math.max(next.height, 0));
    if (next.width > 0 && headH > 0) {
      this.g.rect(0, 0, next.width, headH).fill({ color: hexToNum(LIFELINE_HEAD_COLOR) });
      this.g.setStrokeStyle({ width: 1, color: hexToNum(LIFELINE_HEAD_BORDER) });
      this.g.rect(0, 0, next.width, headH).stroke();
    }
    // 轴：虚线手工点划（PIXI 8 Graphics 无原生虚线，FRAME 虚线边框同款）；局部系
    // 原点 = 矩形左上，轴在 width / 2
    this.g.setStrokeStyle({ width: 1, color: hexToNum(defaultTextColor()) });
    for (const [y0, y1] of lifelineAxisDashSegments(lifelineAxisOf(next, next.head))) {
      this.g
        .moveTo(next.width / 2, y0 - next.y)
        .lineTo(next.width / 2, y1 - next.y)
        .stroke();
    }
    // 标签：单行居中，超出可用宽截断加省略号（退化尺寸不画不抛错）
    this.destroyLabel();
    const visible = truncateLifelineLabel(next.label ?? '', next.width, next.head);
    if (visible) {
      const area = lifelineLabelRect(next.width, next.head);
      this.labelText = new Text({
        text: visible,
        style: {
          fontFamily: 'sans-serif',
          fontSize: LIFELINE_LABEL_FONT_SIZE,
          fill: hexToNum(LIFELINE_HEAD_BORDER),
        },
      });
      this.labelText.anchor.set(0.5);
      this.labelText.position.set(area.x + area.width / 2, area.y + area.height / 2);
      this.root.addChild(this.labelText);
    }
    this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（「快速路径不碰 scale」）
    this.root.scale.set(1);
  }

  private destroyLabel(): void {
    this.labelText?.destroy();
    this.labelText = null;
  }

  /** 视觉世界矩形（预览感知：root.scale ≠ 1 的缩放过程中同样正确；旋转恒 0） */
  private visualRect(): IRect {
    const b = this.state;
    const w = b.width * this.root.scale.x;
    const h = b.height * this.root.scale.y;
    return { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h };
  }

  // —— 命中：头框 ∪ 轴带（§3.3；轴带半宽每帧现算，缩放随时变） ——

  hitTestPoint(p: Point): boolean {
    return lifelineHitTest(
      { x: p.x, y: p.y },
      this.visualRect(),
      this.state.head,
      lifelineAxisHitHalf(this.getScale()),
    );
  }

  override hitTestRect(r: Rectangle): boolean {
    return lifelineHitTestRect(
      { x: r.x, y: r.y, width: r.width, height: r.height },
      this.visualRect(),
      this.state.head,
      lifelineAxisHitHalf(this.getScale()),
    );
  }

  /** 世界 AABB（空间索引与 culling 用） */
  override getBounds(): IRect {
    return rotatedRectBounds(this.visualRect(), this.root.rotation);
  }

  /** 数据矩形（未旋转局部系——resize/级联展开/微移的输入语义） */
  override getLocalRect(): IRect {
    return { x: this.state.x, y: this.state.y, width: this.state.width, height: this.state.height };
  }

  /** 锚定链宿主几何：视觉矩形 + θ（恒 0） */
  override getHostGeom(): IHostGeom {
    return { rect: this.visualRect(), rotation: this.root.rotation };
  }

  /** 避障豁免（§3.6，无填充 SHAPE 同款）：生命线只有一条轴，没有可遮挡的实体 */
  isRouteObstacle(): boolean {
    return false;
  }

  /** 轴锚定宿主探针（§4.1）：轴 = 头框底边到 bbox 底边；轴长 < 1 的退化件返回
   *  null（连线按普通件处理）。geom 显式传入以该几何为准（急刻重路由） */
  getAxisAnchor(geom?: IHostGeom): IAxisAnchor | null {
    const r = (geom ?? this.getHostGeom()).rect;
    return lifelineAxis(r, this.state.head);
  }

  /** 轴锚点（§3.2）：y = 轴上高度；x = 轴 + sign(join) × (激活条半宽 − 线端留隙)。
   *  旋转恒 0，无 θ 回投；无轴回落基类的 bbox 锚点 */
  override getAnchorPoint(join: JoinDir, t: number, geom?: IHostGeom): IPoint {
    const g = geom ?? this.getHostGeom();
    const axis = this.getAxisAnchor(g);
    if (!axis) return super.getAnchorPoint(join, t, g);
    return axisAnchorWithInset(axis, join, t, this.barHalfAt(axisAnchorPoint(axis, t).y));
  }

  /** 纵向覆盖该高度的激活条的最大半宽（现查——条的位置预览敏感）；无条 = 0 */
  private barHalfAt(y: number): number {
    let half = 0;
    for (const bar of this.sequence?.barsOf(this.id) ?? []) {
      if (y < bar.y || y > bar.y + bar.height) continue;
      half = Math.max(half, bar.width / 2);
    }
    return half;
  }

  /** 缩放整形（§3.5）：宽度以轴对称、下限 60×120——纯函数单源 */
  constrainResize(start: IRect, next: IRect, dir: ResizeDir): IRect {
    return constrainLifelineResize(start, next, dir);
  }
}
