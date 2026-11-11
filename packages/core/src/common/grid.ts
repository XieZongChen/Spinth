/**
 * 网格量化（specs/flowchart-closeout §9.2，G-08）：与点阵背景同相位——
 * `GRID_SPACING = 16` 与 dotGridMath.BASE_WORLD_SPACING 同值（react 侧
 * re-export 本常量消双源），点中心恒在 `x ≡ 0 (mod 16)`，量化落点压在点上。
 * 只作用于「松手落库/同源预览」两处（渲染同步铁律 5），手势期零 Yjs 写；
 * 与参考线的优先级固定为「参考线先、网格后」（docs/05 §4.4）。
 */

export const GRID_SPACING = 16;

/** 单值量化：最近格点 */
export function quantizeGrid(v: number): number {
  // +0 归一化 -0（Math.round(-0.1/16) = -0）：落点取模断言不受负零干扰
  return Math.round(v / GRID_SPACING) * GRID_SPACING + 0;
}

/** 矩形量化：左上角取整到格点（宽高不变——多元素左对齐才整齐） */
export function quantizeGridRect(r: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: quantizeGrid(r.x), y: quantizeGrid(r.y), width: r.width, height: r.height };
}

/** 八向手柄（与 rectEditor/resizeMath.HandleDir 同联合；common 层不复用 platform） */
type ResizeHandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/**
 * 缩放量化：按被抓手柄的**对侧固定角**对齐——start 为手势起点矩形（固定角
 * 来源），next 为当前目标矩形；quantX/quantY = 该轴是否量化（参考线命中的
 * 轴不量化，specs/flowchart-closeout §9.2）。移动边量化到格点后反推宽高
 * （下限 1，防倒退成负尺寸）。
 */
export function quantizeResizeRect(
  start: { x: number; y: number; width: number; height: number },
  dir: ResizeHandleDir,
  next: { x: number; y: number; width: number; height: number },
  quantX: boolean,
  quantY: boolean,
): { x: number; y: number; width: number; height: number } {
  // 固定参考：抓手柄对侧的边/角坐标（手势起点——全程不动）
  const fixedL = start.x;
  const fixedT = start.y;
  const fixedR = start.x + start.width;
  const fixedB = start.y + start.height;
  let { x, y, width, height } = next;
  if (quantX) {
    // 移动的竖边（左/右）量化到格点，固定竖边不动
    const leftMoves = dir.includes('w');
    const rightMoves = dir.includes('e');
    if (leftMoves) {
      const nx = quantizeGrid(next.x);
      x = Math.min(nx, fixedR - 1);
      width = fixedR - x;
    } else if (rightMoves) {
      const nr = quantizeGrid(next.x + next.width);
      width = Math.max(1, nr - fixedL);
      x = fixedL;
    }
  }
  if (quantY) {
    const topMoves = dir === 'n' || dir === 'nw' || dir === 'ne';
    const bottomMoves = dir === 's' || dir === 'sw' || dir === 'se';
    if (topMoves) {
      const ny = quantizeGrid(next.y);
      y = Math.min(ny, fixedB - 1);
      height = fixedB - y;
    } else if (bottomMoves) {
      const nb = quantizeGrid(next.y + next.height);
      height = Math.max(1, nb - fixedT);
      y = fixedT;
    }
  }
  return { x, y, width, height };
}
