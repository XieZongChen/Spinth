import type { IRect } from '../../common/geometry';
import { rotatePointAround } from './rotateMath';

/** 缩放手柄语义（角 = 双轴，边 = 单轴） */
export type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 最小尺寸钳制（世界单位） */
export const RESIZE_MIN_SIZE = 8;

/**
 * 缩放数学（docs/14 规则 3）：无状态纯函数——一切从「起点矩形 + 当前光标」推导。
 * 禁止读取每帧被自身改写的实时视觉状态（复合漂移的根因）。
 * 幂等：同一输入永远得到同一输出。
 */
export function resizeRect(
  start: IRect,
  dir: HandleDir,
  world: { x: number; y: number },
  minSize = RESIZE_MIN_SIZE,
): IRect {
  let { x, y, width, height } = start;
  if (dir.includes('e')) width = Math.max(minSize, world.x - x);
  if (dir.includes('s')) height = Math.max(minSize, world.y - y);
  if (dir.includes('w')) {
    const right = x + width;
    width = Math.max(minSize, right - world.x);
    x = right - width;
  }
  if (dir.includes('n')) {
    const bottom = y + height;
    height = Math.max(minSize, bottom - world.y);
    y = bottom - height;
  }
  return { x, y, width, height };
}

/** 方向 → 对侧（锚定端）方向（Batch 1 · 1.6） */
const OPPOSITE: Record<HandleDir, HandleDir> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

/**
 * 旋转态缩放（Batch 1 · 1.6，2026-10-17 审查）：resizeRect 之上补**对侧锚定**。
 *
 * 旧实现的漂移：逆旋转绕起点中心 C0、resizeRect 只改 w/h（局部 x/y 锚在起点），
 * 而渲染 pivot 是**新矩形自己的中心 C1**——中心随尺寸移动，全体角点平移
 * (I − R(θ))·(Δ/2)：对侧角漂移、被拖角也偏离指针。
 *
 * 修法：以「start 的对侧锚点（角柄=对侧角；边柄=对侧边中点）世界位不变」反解
 * 新中心，回写 next.x/y。θ=0 时锚点即起点对侧角，输出与 resizeRect 全等（等价锁）。
 *
 * @param world 已逆旋转到局部系的指针坐标（与旧路径同输入）
 */
export function resizeRotatedRect(
  start: IRect,
  dir: HandleDir,
  world: { x: number; y: number },
  theta: number,
  minSize = RESIZE_MIN_SIZE,
): IRect {
  const next = resizeRect(start, dir, world, minSize);
  if (theta === 0) return next;
  // 对侧锚点（start 局部系）：角柄 = 对侧角；边柄 = 对侧边中点
  const opp = OPPOSITE[dir];
  const ax = opp.includes('w')
    ? start.x
    : opp.includes('e')
      ? start.x + start.width
      : start.x + start.width / 2;
  const ay = opp.includes('n')
    ? start.y
    : opp.includes('s')
      ? start.y + start.height
      : start.y + start.height / 2;
  const c0 = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const anchorWorld = rotatePointAround({ x: ax, y: ay }, c0, theta);
  // 锚点在新矩形中的同一相对位（局部向量随尺寸缩放）→ 反解新中心世界位
  const sx = next.width / start.width;
  const sy = next.height / start.height;
  const relRotated = rotatePointAround(
    { x: (ax - c0.x) * sx, y: (ay - c0.y) * sy },
    { x: 0, y: 0 },
    theta,
  );
  const newCenter = { x: anchorWorld.x - relRotated.x, y: anchorWorld.y - relRotated.y };
  return {
    x: newCenter.x - next.width / 2,
    y: newCenter.y - next.height / 2,
    width: next.width,
    height: next.height,
  };
}
