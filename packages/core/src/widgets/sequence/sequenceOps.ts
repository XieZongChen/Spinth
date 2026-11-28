/**
 * 激活条几何与绑定判定（specs/sequence-diagram §3.4 / §3.5 / §5.1 / §7.1）：常量、
 * 落点绑定判定、创建落点、锁宽缩放整形——全部纯函数，单测直测。纯模块（无 PIXI）：
 * 创建手势 / VM / SequenceService 的绑定写入共用。
 */
import type { IRect } from '../../common/geometry';
import type { IAxisAnchor, ResizeDir } from '../../types/base';

// —— 常量（§3.4） ——

/** 恒定宽度（世界 px）：任何缩放路径落库不变（S6） */
export const ACTIVATION_WIDTH = 10;
/** 高度下限 */
export const ACTIVATION_MIN_HEIGHT = 16;
/** 单击创建时向下延伸的长度 */
export const ACTIVATION_DEFAULT_DROP = 80;
/** 绑定判定的中心线容差（世界 px） */
export const ACTIVATION_BIND_TOL = 6;
/** 条身点击判定外扩（世界 px）：恒宽 10 的细条在低缩放下难点中 */
export const ACTIVATION_HIT_PAD = 2;
/** 填充 / 描边（写死配色，不随主题；#333333 对 #ffffff ≈ 12.6:1） */
export const ACTIVATION_FILL = '#ffffff';
export const ACTIVATION_BORDER = '#333333';

/** 落点绑定判定（§5.1）：条中心线在容差内贴合某条生命线的轴，且与轴段有纵向
 *  重叠。hosts 由调用方按命中优先级排好（zOrder 降序）——多条命中取首个；无命中
 *  返回 undefined。纵向重叠按闭合区间判（端点相接算重叠，与条边让位的覆盖口径一致） */
export function resolveActivationHost(
  bar: IRect,
  hosts: ReadonlyArray<{ id: string; axis: IAxisAnchor }>,
): string | undefined {
  const cx = bar.x + bar.width / 2;
  for (const { id, axis } of hosts) {
    if (Math.abs(cx - axis.x) > ACTIVATION_BIND_TOL) continue;
    if (bar.y + bar.height < axis.top || bar.y > axis.bottom) continue;
    return id;
  }
  return undefined;
}

/** 创建落点（§7.1）：x 归中到轴、顶 = 按下高度、高度 = drop 钳到
 *  [下限, 轴底 − 按下高度]（向下拖出 80 / 向上拖钳到下限 / 底不出轴底）。
 *  按下点距轴底不足下限时两条钳制不可同时满足——返回 null = 不建 */
export function activationDropRect(axis: IAxisAnchor, pressY: number, drop: number): IRect | null {
  const room = axis.bottom - pressY;
  if (room < ACTIVATION_MIN_HEIGHT) return null;
  return {
    x: axis.x - ACTIVATION_WIDTH / 2,
    y: pressY,
    width: ACTIVATION_WIDTH,
    height: Math.min(Math.max(drop, ACTIVATION_MIN_HEIGHT), room),
  };
}

/** 缩放整形（§3.5）：只保留高度变化——被拖的横边跟手（n 锚底边、s 锚顶边）并钳
 *  下限；横向手柄分量丢弃，宽恒 ACTIVATION_WIDTH、x = 起点中心 − 半宽（吸附 /
 *  量化把 next 拉偏也不动）。起点宽度异常的条按其中心归中并归一到恒宽 */
export function constrainActivationResize(start: IRect, next: IRect, dir: ResizeDir): IRect {
  const bottom = start.y + start.height;
  const topMoved = dir.includes('n');
  const height = topMoved
    ? Math.max(bottom - next.y, ACTIVATION_MIN_HEIGHT)
    : dir.includes('s')
      ? Math.max(next.y + next.height - start.y, ACTIVATION_MIN_HEIGHT)
      : start.height;
  const cx = start.x + start.width / 2;
  return {
    x: cx - ACTIVATION_WIDTH / 2,
    y: topMoved ? bottom - height : start.y,
    width: ACTIVATION_WIDTH,
    height,
  };
}
