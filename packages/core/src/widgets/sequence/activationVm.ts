import { Graphics, Point, type Rectangle } from 'pixi.js';
import { BaseWidgetVm } from '../../base/baseWidgetVm';
import { hexToNum } from '../../common/color';
import type { IRect } from '../../common/geometry';
import type { ActivationData, ResizeDir } from '../../types';
import {
  ACTIVATION_BORDER,
  ACTIVATION_FILL,
  ACTIVATION_HIT_PAD,
  constrainActivationResize,
} from './sequenceOps';

/**
 * 激活条视图层（specs/sequence-diagram §3.5 / §3.6 / §4.1）：贴在生命线轴上的细条，
 * 白底 + 1px 深描边，绑定与否外观相同。
 *
 * - 不作连线目标、豁免避障：消息只认轴，拉线拾取穿过条取到下层生命线。
 * - 锁宽缩放走 constrainResize 探针（预览 / 编辑框 / 选区框 / 落库同源）；吸附只沿
 *   纵轴（resizeAxis 探针）——条的东西沿距生命线中心参考线恰一个线端留隙。
 * - 世界矩形「状态 + 预览偏移」：首帧渲染前（粘贴收尾事务里）与拖拽 / 缩放预览中
 *   都正确——条边让位经 barsOf 读它，恒读 root 会在首帧前拿到原点。
 * - 绑定读模型（yData）不读 state：state 是微任务合批的投影，而条边让位的宿主探针
 *   要在「刚写完绑定的那条事务」之后立刻被问到。
 */
export class ActivationVm extends BaseWidgetVm<ActivationData & IRect> {
  private readonly g = new Graphics();
  /** 已渲染过：之前 root 还在原点，世界矩形回落数据矩形 */
  private rendered = false;

  constructor() {
    super({ id: '', type: 'ACTIVATION', zOrder: '', x: 0, y: 0, width: 0, height: 0 });
    this.root.addChild(this.g);
  }

  override render(prev: ActivationData & IRect, next: ActivationData & IRect): void {
    // 纯平移快速路径：只有尺寸变了才重画（局部系原点 = 矩形中心）
    if (!this.rendered || prev.width !== next.width || prev.height !== next.height) {
      this.g.clear();
      if (next.width > 0 && next.height > 0) {
        const w = next.width;
        const h = next.height;
        this.g.rect(-w / 2, -h / 2, w, h).fill({ color: hexToNum(ACTIVATION_FILL) });
        this.g.setStrokeStyle({ width: 1, color: hexToNum(ACTIVATION_BORDER) });
        this.g.rect(-w / 2, -h / 2, w, h).stroke();
      }
    }
    this.rendered = true;
    this.applyRootTransform(next.x, next.y, next.width, next.height, 0);
    // 拖拽/缩放反馈用过 root.scale，全量渲染归位时重置（「快速路径不碰 scale」）
    this.root.scale.set(1);
  }

  /** 数据矩形：首帧渲染前读「state + 待合批 partial」（setModel 后 state 要等微任务
   *  才落地，而粘贴收尾事务在这一拍就会问它）；渲染后 state 即当前值 */
  private dataRect(): IRect {
    const s = this.rendered
      ? this.state
      : ({ ...this.state, ...this.batchState } as ActivationData & IRect);
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }

  /** 世界 AABB（数据矩形 + 预览偏移；旋转恒 0） */
  override getBounds(): IRect {
    if (!this.rendered) return this.dataRect();
    const d = this.dataRect();
    const w = d.width * this.root.scale.x;
    const h = d.height * this.root.scale.y;
    return { x: this.root.x - w / 2, y: this.root.y - h / 2, width: w, height: h };
  }

  /** 数据矩形（未旋转局部系——resize/级联展开/微移的输入语义） */
  override getLocalRect(): IRect {
    return this.dataRect();
  }

  /** 条身命中，外扩 ACTIVATION_HIT_PAD */
  hitTestPoint(p: Point): boolean {
    const b = this.getBounds();
    return (
      p.x >= b.x - ACTIVATION_HIT_PAD &&
      p.x <= b.x + b.width + ACTIVATION_HIT_PAD &&
      p.y >= b.y - ACTIVATION_HIT_PAD &&
      p.y <= b.y + b.height + ACTIVATION_HIT_PAD
    );
  }

  /** 框选：相交即入选（§7.2）——按预览感知的世界矩形，不用滞后一帧的局部包围盒 */
  override hitTestRect(r: Rectangle): boolean {
    const b = this.getBounds();
    return (
      b.x < r.x + r.width && r.x < b.x + b.width && b.y < r.y + r.height && r.y < b.y + b.height
    );
  }

  /** 避障豁免（§3.6）：条贴在轴上，没有可遮挡的实体 */
  isRouteObstacle(): boolean {
    return false;
  }

  /** 不作连线目标（§4.1 / §4.8）：拾取跳过它取下层生命线，quick-add 不出连接点 */
  isConnectionTarget(): boolean {
    return false;
  }

  /** 缩放只沿纵轴（§3.5）：吸附只取手柄方向的纵向分量 */
  resizeAxis(): 'v' {
    return 'v';
  }

  /** 条边让位的宿主探针（§4.1 / §9.5）：本件移动 / 缩放 / 新建 / 删除后要重路由的
   *  锚定宿主 = 绑定的生命线；未绑定返回 []。读模型不读 state（见类注释） */
  anchorFollowHosts(): string[] {
    const id = this.boundLifelineId();
    return id ? [id] : [];
  }

  /** 缩放整形（§3.5）：只留高度变化——纯函数单源 */
  constrainResize(start: IRect, next: IRect, dir: ResizeDir): IRect {
    return constrainActivationResize(start, next, dir);
  }

  private boundLifelineId(): string | undefined {
    const raw: unknown = this.model?.yData.get('lifelineId');
    return typeof raw === 'string' ? raw : undefined;
  }
}
