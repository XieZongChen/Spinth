import { Graphics, Point } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';

/** 框选手势状态（start 按下点 / cur 当前点，世界坐标） */
export interface MarqueeState {
  start: Point;
  cur: Point;
}

/** 框选矩形（start/cur → 正向矩形）：SelectorVm.show/update 的输入几何 */
export function marqueeRectOf(m: MarqueeState): IRect {
  return {
    x: Math.min(m.start.x, m.cur.x),
    y: Math.min(m.start.y, m.cur.y),
    width: Math.abs(m.cur.x - m.start.x),
    height: Math.abs(m.cur.y - m.start.y),
  };
}

/**
 * 选区框同步（自 selectorService.syncSelectionVm 拆出——审查返工 400 行拆分，
 * 逻辑逐字搬移）：空选区/拖拽中隐藏；单选树焦点画节点框；单选连线不画 bbox
 * （U 形线补第四边）；其余画选中集 union 框。
 */
export function syncSelectionFrame(args: {
  selectionVm: { hide(): void; showBounds(b: IRect[]): void };
  ids: string[];
  getVmById: (id: string) => { type: string; getBounds(): IRect } | undefined;
  getFocusFrame: () => IRect | null | undefined;
  dragMoved: boolean;
}): void {
  const { selectionVm, ids, getVmById, getFocusFrame, dragMoved } = args;
  if (ids.length === 0 || dragMoved) {
    selectionVm.hide();
    return;
  }
  // 脑图焦点节点（根或子节点）：选区框画在**节点本体**上——既有设计点任意
  // MIND_NODE 都是这个视觉（框整棵树是 spinth 早期形态；只给根画框则子节点
  // 看起来「没有选中态」）
  if (ids.length === 1) {
    const focusFrame = getFocusFrame();
    if (focusFrame) {
      selectionVm.showBounds([focusFrame]);
      return;
    }
    // 单选连线不画 bbox 框（批次 3.6）：points bbox 对 U 形线会补出第四边。
    // 线选中态 = 线本体 + 端点圆/段条手柄（refreshHandles）；ActionBar 定位
    // 走独立 getSelectionBounds。多选含线仍画 union 框（组语义）。
    const only = getVmById(ids[0]!);
    if (only?.type === 'LINE') {
      selectionVm.hide();
      return;
    }
  }
  const bounds = ids.map((id) => getVmById(id)?.getBounds()).filter((b): b is IRect => !!b);
  selectionVm.showBounds(bounds);
}

/** 框选橡皮筋（docs/05 §2）：只在空白处按下拖动时出现 */
export class SelectorVm {
  readonly graphics = new Graphics();

  constructor(parent: { addChild(c: Graphics): void }) {
    this.graphics.eventMode = 'none';
    this.graphics.visible = false;
    parent.addChild(this.graphics);
  }

  show(rect: IRect): void {
    this.graphics.visible = true;
    this.draw(rect);
  }

  update(rect: IRect): void {
    this.draw(rect);
  }

  hide(): void {
    this.graphics.visible = false;
    markRender();
  }

  private draw(r: IRect): void {
    this.graphics.clear();
    this.graphics.rect(r.x, r.y, r.width, r.height);
    this.graphics.fill({ color: 0x2878ff, alpha: 0.08 });
    this.graphics.stroke({ width: 1, color: 0x2878ff, alpha: 0.6 });
    markRender();
  }
}
