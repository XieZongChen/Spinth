import { unionRects, type IRect } from '../../common/geometry';

/**
 * 多选几何命令纯逻辑（docs/05 §7，参考口径 2026-10-10 用户拍板）。
 * 输入是「参与集」各元素的世界包围盒（锚定线已在上游剔除），
 * 输出逐元素位移量——落库由命令层完成（vm.commitDrag / 自由线 points 平移）。
 * 无状态纯函数：同一输入永远同一输出（docs/14 规则 3）。
 */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export type DistributeAxis = 'h' | 'v';

export interface IDelta {
  dx: number;
  dy: number;
}

const ZERO: IDelta = { dx: 0, dy: 0 };

/**
 * 对齐：以参与集最小包围盒为基准（与 getSelectionBounds 同源数学）。
 * 对齐后元素重叠/贴边不做特殊处理（参考同款）。
 */
export function computeAlignDeltas(rects: IRect[], mode: AlignMode): IDelta[] {
  const u = unionRects(rects);
  if (!u) return rects.map(() => ({ ...ZERO }));
  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { dx: u.x - r.x, dy: 0 };
      case 'hcenter':
        return { dx: u.x + u.width / 2 - (r.x + r.width / 2), dy: 0 };
      case 'right':
        return { dx: u.x + u.width - (r.x + r.width), dy: 0 };
      case 'top':
        return { dx: 0, dy: u.y - r.y };
      case 'vcenter':
        return { dx: 0, dy: u.y + u.height / 2 - (r.y + r.height / 2) };
      case 'bottom':
        return { dx: 0, dy: u.y + u.height - (r.y + r.height) };
    }
  });
}

/**
 * 分布：沿轴按位置排序后等距化相邻间隙——两端元素不动，中间元素重排
 * 使相邻间隙相等；总宽不足时间隙为负（更重叠）照算（参考同款）。
 * <3 个元素无意义（两端即全部），返回全零。
 */
export function computeDistributeDeltas(rects: IRect[], axis: DistributeAxis): IDelta[] {
  const n = rects.length;
  if (n < 3) return rects.map(() => ({ ...ZERO }));
  const horizontal = axis === 'h';
  const pos = (r: IRect): number => (horizontal ? r.x : r.y);
  const size = (r: IRect): number => (horizontal ? r.width : r.height);
  // 稳定排序：位置相同保持输入顺序（Array.prototype.sort 规范保证稳定）
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => pos(a.r) - pos(b.r));
  const first = order[0]!;
  const last = order[n - 1]!;
  const span = pos(last.r) + size(last.r) - pos(first.r);
  const totalSize = order.reduce((s, o) => s + size(o.r), 0);
  const gap = (span - totalSize) / (n - 1);
  const deltas: IDelta[] = rects.map(() => ({ ...ZERO }));
  // 游标从首元素左缘出发逐个排布；首元素 target = 自身位置（不动），推到末元素
  // target = pos(last)（数学恒等，见单测「两端不动」），两端天然固定。
  let cursor = pos(first.r);
  for (const o of order) {
    const d = cursor - pos(o.r);
    deltas[o.i] = horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor = cursor + size(o.r) + gap;
  }
  return deltas;
}
