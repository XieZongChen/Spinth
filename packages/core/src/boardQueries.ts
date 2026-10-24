/**
 * BoardSDK 拉取式查询（specs/api-surface §3.6）——getSelectionBounds /
 * toScreenPoint / getMindAddButtons 自 app.ts 逐字迁入（脑图焦点分支与四个
 * 早退逐字保留）。对 app.ts 只允许 import type；BoardSDK 同名方法一行委托。
 */
import type { IRect } from './common/geometry';
import { unionRects } from './common/geometry';
import type { IMindAddButtonsState } from './types';
import type { IBoardQueryHost } from './boardHost';

/** 选中元素世界坐标外接矩形（无选中返回 null） */
export function getSelectionBounds(host: IBoardQueryHost): IRect | null {
  const ids = host.selector?.selected$.value ?? [];
  // 4.9 节点级选中：ActionBar（含删除按钮）定位到**焦点节点本体**；根焦点同样如此
  // ——既有设计 actionBar 跟的是 selectedBounds，而点根选中的是那个 MIND_NODE。
  // 挂整树 bbox 会让根焦点时的浮动栏飘到整棵树上方（用户实测：删除按钮位置异常）
  if (ids.length === 1) {
    const vm = host.vmEngine?.getVmById(ids[0]!);
    if (vm?.type === 'MIND_MAP') {
      const st = host.mindService?.getFocusedState();
      if (st) return st.worldRect;
    }
  }
  const bounds = ids
    .map((id) => host.vmEngine?.getVmById(id)?.getBounds())
    .filter((b): b is IRect => !!b);
  return unionRects(bounds);
}

/** 世界 → 屏幕（canvas 内局部坐标；UI 定位再补画布偏移）。未组装即抛错（维持现状） */
export function toScreenPoint(
  host: IBoardQueryHost,
  p: { x: number; y: number },
): {
  x: number;
  y: number;
} {
  return host.viewport!.toScreen(p);
}

/**
 * 脑图焦点节点 +/- 按钮定位源（docs/12 §4）：焦点节点屏幕外接矩形 + 侧向标志。
 * 拉取式（同 getActionBarSchema 模式）——bridge 在焦点/树/视口变化时重算。
 */
export function getMindAddButtons(host: IBoardQueryHost): IMindAddButtonsState | null {
  if (!host.mindService) return null;
  if (host.mindService.isDragging) return null; // 拖拽重排中隐藏
  if (host.viewport!.cursorMode$.value !== 'cursor') return null;
  const f = host.mindService.getFocusedState();
  if (!f) return null;
  const a = host.viewport!.toScreen({ x: f.worldRect.x, y: f.worldRect.y });
  const c = host.viewport!.toScreen({
    x: f.worldRect.x + f.worldRect.width,
    y: f.worldRect.y + f.worldRect.height,
  });
  const sl = host.viewport!.toScreen({ x: f.slotLeft, y: 0 });
  const sr = host.viewport!.toScreen({ x: f.slotRight, y: 0 });
  return {
    bounds: { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y },
    isRoot: f.isRoot,
    direction: f.direction,
    slotLeft: sl.x,
    slotRight: sr.x,
  };
}
