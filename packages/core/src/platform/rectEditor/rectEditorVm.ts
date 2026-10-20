import { Container, Graphics, Rectangle } from 'pixi.js';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';
import type { HandleDir } from './resizeMath';
import { rotatePointAround, rotatedRectCorners } from './rotateMath';

import { SELECTION_COLOR, HANDLE_FILL } from '../../common/selectionStyle';

const BORDER = SELECTION_COLOR;
const HANDLE_COLOR = HANDLE_FILL;
const HANDLE_BORDER = SELECTION_COLOR;
const HANDLE_SIZE = 8; // 屏幕像素
const BORDER_WIDTH = 1.5;

/** 四角可见抓手的方向集（边中点抓手不做——边上 hover 热区即可拉伸，视觉更干净） */
const CORNERS: HandleDir[] = ['nw', 'ne', 'se', 'sw'];
/** 四边不可见热区方向集 */
const EDGES: HandleDir[] = ['n', 'e', 's', 'w'];
/** 边缘热区厚度（屏幕像素）：hover 出 ns/ew-resize 光标，按下走对应边缩放 */
const EDGE_HOT_SIZE = 10;
/** 旋转柄：nw 角外斜向 45° 悬浮距离（屏幕像素，docs/05 §8——2026-10-16
 *  自 n 边中点迁移：与四向连接点 24px 外移位冲突） */
export const ROTATE_HANDLE_OFFSET = 20;
/** 旋转柄圆点半径（屏幕像素） */
const ROTATE_DOT_RADIUS = 5;

/** 旋转光标（2026-10-16 用户反馈）：系统无原生旋转指针——SVG cursor 自绘
 *  环形箭头（lucide rotate-cw 路径，热点 24×24 中心），grab 兜底。双层描边
 *  （白底 4.4 + 深灰 2.4）——暗色主题下纯深灰看不清（用户实测反馈），白外圈
 *  保证任意底色可见（选中语言白心蓝边同思路） */
const ROTATE_CURSOR = (() => {
  const arc = 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8';
  const arrow = 'M21 3v5h-5';
  const path = (d: string, stroke: string, w: number): string =>
    `<path d="${d}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    path(arc, '#ffffff', 4.4) +
    path(arrow, '#ffffff', 4.4) +
    path(arc, '#1f2937', 2.4) +
    path(arrow, '#1f2937', 2.4) +
    '</svg>';
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 12 12, grab`;
})();

const HANDLE_POSITIONS: Record<HandleDir, (r: IRect) => { x: number; y: number }> = {
  nw: (r) => ({ x: r.x, y: r.y }),
  n: (r) => ({ x: r.x + r.width / 2, y: r.y }),
  ne: (r) => ({ x: r.x + r.width, y: r.y }),
  e: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }),
  se: (r) => ({ x: r.x + r.width, y: r.y + r.height }),
  s: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height }),
  sw: (r) => ({ x: r.x, y: r.y + r.height }),
  w: (r) => ({ x: r.x, y: r.y + r.height / 2 }),
};

/** 单选元素的边框 + 四角缩放手柄 + 四边不可见缩放热区 + 旋转柄（docs/05 §2/§8）。
 *  随视口缩放反向补偿；θ≠0 时边框/角柄绕中心随转、边热区隐藏（docs/05 §8）。 */
export class RectEditorVm {
  readonly root = new Container();
  private border = new Graphics();
  private handles = new Map<HandleDir, Graphics>();
  private edgeZones = new Map<HandleDir, Graphics>();
  private rotateDot = new Graphics();

  onHandleDown: ((dir: HandleDir, worldX: number, worldY: number) => void) | null = null;
  onRotateDown: ((worldX: number, worldY: number) => void) | null = null;

  constructor(parent: Container) {
    // passive：root 自身不命中，但子树（热区/手柄）可命中——'none' 会连子元素一起排除
    this.root.eventMode = 'passive';
    this.root.visible = false;
    this.root.addChild(this.border);
    const bind = (dir: HandleDir, g: Graphics): void => {
      g.eventMode = 'static';
      g.cursor = `${dirToCursor(dir)}-resize`;
      g.on('pointerdown', (e) => {
        e.stopPropagation();
        const p = this.root.toLocal(e.global);
        this.onHandleDown?.(dir, p.x, p.y);
      });
    };
    // 热区先加入（层级在下），四角手柄后加入——pixi 命中测试从最上层子元素开始，
    // 角部小方块优先于边缘热区，光标/手势不会在角落被边抢走
    for (const dir of EDGES) {
      const g = new Graphics(); // 空画：纯 hitArea 热区，不渲染任何像素
      bind(dir, g);
      this.edgeZones.set(dir, g);
      this.root.addChild(g);
    }
    for (const dir of CORNERS) {
      const h = new Graphics();
      bind(dir, h);
      this.handles.set(dir, h);
      this.root.addChild(h);
    }
    // 旋转柄最上层（docs/05 §8）：左上角外斜向悬浮圆点（无连线——对角方向
    // 连线会穿过 nw 缩放手柄，2026-10-16 用户拍板）
    this.rotateDot.eventMode = 'static';
    this.rotateDot.cursor = ROTATE_CURSOR;
    this.rotateDot.on('pointerdown', (e) => {
      e.stopPropagation();
      const p = this.root.toLocal(e.global);
      this.onRotateDown?.(p.x, p.y);
    });
    this.root.addChild(this.rotateDot);
    parent.addChild(this.root);
  }

  private rect: IRect | null = null;
  private scale = 1;
  private rotation = 0;

  /** dev 调试：当前编辑框矩形 */
  get debugRect(): IRect | null {
    return this.rect;
  }

  /** dev 调试：旋转柄世界坐标（E2E 定位用） */
  get debugRotateHandle(): { x: number; y: number } | null {
    if (!this.rect) return null;
    return this.rotateHandlePos(this.rect, this.rotation, this.scale);
  }

  /** rect = 视觉局部矩形（getHostGeom 语义）；rotation = 绕中心角（docs/05 §8）；
   *  canRotate = 能力位闸门（LINE/PEN/MIND_MAP 不出旋转柄） */
  show(rect: IRect, vpScale: number, rotation = 0, canRotate = true): void {
    this.rect = rect;
    this.scale = vpScale;
    this.rotation = rotation;
    this.rotateDot.visible = canRotate;
    this.root.visible = true;
    this.redraw();
  }

  hide(): void {
    this.rect = null;
    this.rotation = 0;
    this.root.visible = false;
    markRender();
  }

  /** 旋转柄位置：nw 角外斜向 45°（2026-10-16 用户拍板——原 n 边中点正上方与
   *  四向连接点外移 24px 圆心差 4px 完全重叠，柄被盖死+命中互抢）；θ≠0 时
   *  nw 角与对角方向随旋转（仍在「旋转后的左上角」外法向） */
  private rotateHandlePos(r: IRect, theta: number, s: number): { x: number; y: number } {
    const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const nw =
      theta === 0 ? { x: r.x, y: r.y } : rotatePointAround({ x: r.x, y: r.y }, center, theta);
    const diag = Math.SQRT1_2;
    const dir =
      theta === 0
        ? { x: -diag, y: -diag }
        : rotatePointAround({ x: -diag, y: -diag }, { x: 0, y: 0 }, theta);
    const off = ROTATE_HANDLE_OFFSET / s;
    return { x: nw.x + dir.x * off, y: nw.y + dir.y * off };
  }

  private redraw(): void {
    if (!this.rect) return;
    const r = this.rect;
    const s = this.scale;
    const th = this.rotation;
    const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };

    // 边框：θ≠0 画旋转四边形（docs/05 §8——框随手柄一起转）
    this.border.clear();
    if (th === 0) {
      this.border.rect(r.x, r.y, r.width, r.height);
    } else {
      const [c0, c1, c2, c3] = rotatedRectCorners(r, th);
      this.border
        .moveTo(c0.x, c0.y)
        .lineTo(c1.x, c1.y)
        .lineTo(c2.x, c2.y)
        .lineTo(c3.x, c3.y)
        .closePath();
    }
    this.border.stroke({ width: BORDER_WIDTH / s, color: BORDER });

    const hs = HANDLE_SIZE / s;
    for (const [dir, h] of this.handles) {
      const local = HANDLE_POSITIONS[dir](r);
      const p = th === 0 ? local : rotatePointAround(local, center, th);
      h.clear();
      h.rect(p.x - hs / 2, p.y - hs / 2, hs, hs)
        .fill({ color: HANDLE_COLOR })
        .stroke({ width: 1 / s, color: HANDLE_BORDER });
      // θ≠0 光标量化 8 向（自绘旋转光标不做——量化是零成本近似）
      h.cursor = th === 0 ? `${dirToCursor(dir)}-resize` : `${quantizedDir(dir, th)}-resize`;
    }
    // 边缘热区：hitArea 位于该 Graphics 的本地系（root 无位移 → 即世界系），
    // 沿边居中、随 redraw（选中/缩放视图变化）同步更新；θ≠0 隐藏（docs/05 §8
    // 降级——旋转态只出四角，边缩放开口方向的轴对齐语义已失真）
    const t = EDGE_HOT_SIZE / s;
    const axisAligned = th === 0;
    for (const [dir, z] of this.edgeZones) {
      if (!axisAligned) {
        z.hitArea = null;
        continue;
      }
      if (dir === 'n') z.hitArea = new Rectangle(r.x, r.y - t / 2, r.width, t);
      else if (dir === 's') z.hitArea = new Rectangle(r.x, r.y + r.height - t / 2, r.width, t);
      else if (dir === 'w') z.hitArea = new Rectangle(r.x - t / 2, r.y, t, r.height);
      else z.hitArea = new Rectangle(r.x + r.width - t / 2, r.y, t, r.height);
    }

    if (!this.rotateDot.visible) {
      markRender();
      return;
    }
    // 旋转柄：nw 角外斜向悬浮圆点（无连线，屏幕恒定尺寸/距离）
    const rp = this.rotateHandlePos(r, th, s);
    const rs = ROTATE_DOT_RADIUS / s;
    this.rotateDot.clear();
    this.rotateDot
      .circle(rp.x, rp.y, rs)
      .fill({ color: HANDLE_COLOR })
      .stroke({ width: 1 / s, color: HANDLE_BORDER });
    markRender();
  }
}

function dirToCursor(dir: HandleDir): string {
  switch (dir) {
    case 'n':
    case 's':
      return 'ns';
    case 'e':
    case 'w':
      return 'ew';
    case 'ne':
    case 'sw':
      return 'nesw';
    default:
      return 'nwse';
  }
}

/** 手柄方向向量（世界系 y 向下） */
const DIR_VECS: Record<HandleDir, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
  nw: { x: -1, y: -1 },
};
const CURSOR_DIRS: Array<{ v: { x: number; y: number }; name: string }> = [
  { v: { x: 0, y: -1 }, name: 'ns' },
  { v: { x: 1, y: -1 }, name: 'nesw' },
  { v: { x: 1, y: 0 }, name: 'ew' },
  { v: { x: 1, y: 1 }, name: 'nesw' },
  { v: { x: 0, y: 1 }, name: 'ns' },
  { v: { x: -1, y: 1 }, name: 'nwse' },
  { v: { x: -1, y: 0 }, name: 'ew' },
  { v: { x: -1, y: -1 }, name: 'nwse' },
];

/** θ≠0 时手柄拖拽方向 = 基础方向旋转 θ 后量化到最近 8 向（光标近似） */
function quantizedDir(dir: HandleDir, theta: number): string {
  const rotated = rotatePointAround(DIR_VECS[dir], { x: 0, y: 0 }, theta);
  let best = CURSOR_DIRS[0]!;
  let bestDot = -Infinity;
  for (const c of CURSOR_DIRS) {
    const len = Math.hypot(c.v.x, c.v.y) * Math.hypot(rotated.x, rotated.y) || 1;
    const dot = (c.v.x * rotated.x + c.v.y * rotated.y) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = c;
    }
  }
  return best.name;
}
