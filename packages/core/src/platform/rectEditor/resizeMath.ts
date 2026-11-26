import type { IRect } from '../../common/geometry';
import type { ResizeDir } from '../../types/base';
import { quantizeResizeRect } from '../../common/grid';
import { rotatePointAround } from './rotateMath';

/** 缩放手柄语义（角 = 双轴，边 = 单轴）。联合定义在 types 层——整形探针契约
 *  （`IBaseWidgetVm.constrainResize`）在那里声明，数学层与服务沿用同一别名 */
export type HandleDir = ResizeDir;

/** 单轴手柄方向（比例锁时只让主轴参与吸附，docs/05 §4.4） */
export type AxisDir = 'n' | 'e' | 's' | 'w';

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

/** 比例锁的主轴（docs/05 §4.4）：边柄 = 自身所在轴；角柄 = 自由缩放输出里
 *  相对变化量大的一轴（各轴位移除以起点尺寸，大矩形上的小抖动不压过小轴的
 *  真实拉伸；相等取宽）。返回该轴上被拖的方向 */
export function lockMainDir(
  start: IRect,
  dir: HandleDir,
  free: IRect,
  minSize = RESIZE_MIN_SIZE,
): AxisDir {
  if (dir === 'e' || dir === 'w' || dir === 'n' || dir === 's') return dir;
  const dw = Math.abs(free.width - start.width) / Math.max(start.width, minSize);
  const dh = Math.abs(free.height - start.height) / Math.max(start.height, minSize);
  if (dw >= dh) return dir.includes('e') ? 'e' : 'w';
  return dir.includes('s') ? 's' : 'n';
}

/**
 * 比例锁（图片手柄缩放按住 Shift，docs/05 §4.4）：把缩放输出收敛到起点宽高比
 * `ratio`（= start.width / start.height——按当前比例锁，不纠正已拉歪的图）。
 * - 主轴（lockMainDir）保留输出尺寸，另一轴按 ratio 派生
 * - 角柄：对侧角锚定不动；边柄：对边不动，另一轴保持起点边（上/左）
 * - 派生轴不足最小尺寸时两轴等比放大到都满足（比例优先于指针）
 * - 非正 / 非有限 ratio：原样返回
 */
export function lockAspectRect(
  start: IRect,
  dir: HandleDir,
  next: IRect,
  ratio: number,
  minSize = RESIZE_MIN_SIZE,
): IRect {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return next;
  const mainDir = lockMainDir(start, dir, next, minSize);
  const mainIsWidth = mainDir === 'e' || mainDir === 'w';
  let width = mainIsWidth ? next.width : next.height * ratio;
  let height = mainIsWidth ? width / ratio : next.height;
  if (width < minSize || height < minSize) {
    const k = Math.max(minSize / width, minSize / height);
    width *= k;
    height *= k;
  }
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  return {
    x: dir.includes('w') ? right - width : start.x,
    y: dir.includes('n') ? bottom - height : start.y,
    width,
    height,
  };
}

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
 * @param ratio 比例锁（lockAspectRect）；缺省 = 自由缩放。锁在局部系内完成，
 *  对侧锚定反解落在锁定后的矩形上
 */
export function resizeRotatedRect(
  start: IRect,
  dir: HandleDir,
  world: { x: number; y: number },
  theta: number,
  minSize = RESIZE_MIN_SIZE,
  ratio?: number,
): IRect {
  const free = resizeRect(start, dir, world, minSize);
  const next = ratio === undefined ? free : lockAspectRect(start, dir, free, ratio, minSize);
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

/** 吸附/量化钩子（参考线、网格——服务注入，数学层不依赖服务）。dir = 参与
 *  吸附的方向；start = 手势起点矩形（量化固定边的来源） */
export interface IResizeSnaps {
  apply(start: IRect, rect: IRect, dir: HandleDir): IRect;
}

/** 参考线吸附端口（RefLineService 的结构子集） */
export interface IResizeSnapSource {
  snapForResize(rect: IRect, dir: string): { rect: IRect; matchedV: number[]; matchedH: number[] };
}

/** 组装吸附/量化钩子：参考线先、网格后——参考线命中的轴不量化
 *  （specs/flowchart-closeout §9.2）。依赖经 thunk 取，类字段初始化序不敏感 */
export function createResizeSnaps(
  refLine: () => IResizeSnapSource,
  gridSnapOn: () => boolean,
): IResizeSnaps {
  return {
    apply: (start, rect, dir) => {
      const snapped = refLine().snapForResize(rect, dir);
      if (!gridSnapOn()) return snapped.rect;
      return quantizeResizeRect(
        start,
        dir,
        snapped.rect,
        snapped.matchedV.length === 0,
        snapped.matchedH.length === 0,
      );
    },
  };
}

/** 整形探针（`IBaseWidgetVm.constrainResize`，以方法形式传入）：返回整形后的目标
 *  矩形。数学层不认识控件类型——生命线宽度以轴对称等约束由控件自述 */
export type IResizeConstrain = (start: IRect, next: IRect, dir: HandleDir) => IRect;

/**
 * 单帧缩放目标矩形（缩放数学的唯一出口，服务只接线）：一切从「起点矩形 +
 * 当前指针」推导，无跨帧状态（docs/14 规则 3）。
 * - 旋转态：对侧锚定反解，不吸附、不整形（需要整形的控件都不可旋转）；比例锁在
 *   局部系内完成
 * - θ=0：自由缩放后吸附/量化。锁比例时只有主轴参与吸附——另一轴由比例派生，
 *   吸附它没有意义、命中线也不该画；最后按比例收敛
 * - 整形在吸附之后末位应用一次，拿到吸附后的矩形与手柄方向：预览 / 编辑框 /
 *   选区框 / 落库同源。整形须保持被拖边的位置（吸附落点）——轴对称的控件按
 *   「被拖边到轴的距离」定宽，而不是把 next.x 当成固定的对边
 */
export function planResize(
  start: IRect,
  dir: HandleDir,
  world: { x: number; y: number },
  theta: number,
  ratio: number | undefined,
  snaps: IResizeSnaps,
  constrain?: IResizeConstrain,
): IRect {
  if (theta !== 0) return resizeRotatedRect(start, dir, world, theta, RESIZE_MIN_SIZE, ratio);
  const free = resizeRect(start, dir, world);
  const next =
    ratio === undefined
      ? snaps.apply(start, free, dir)
      : snapAndLock(start, dir, free, ratio, snaps);
  return constrain ? constrain(start, next, dir) : next;
}

/** 比例锁路径：只有主轴参与吸附（另一轴由比例派生），最后按比例收敛 */
function snapAndLock(
  start: IRect,
  dir: HandleDir,
  free: IRect,
  ratio: number,
  snaps: IResizeSnaps,
): IRect {
  const mainDir = lockMainDir(start, dir, free);
  const single =
    mainDir === 'e' || mainDir === 'w'
      ? { ...free, height: start.height }
      : { ...free, width: start.width };
  return lockAspectRect(start, dir, snaps.apply(start, single, mainDir), ratio);
}
