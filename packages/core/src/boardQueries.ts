/**
 * BoardSDK 拉取式查询（specs/api-surface §3.6）——getSelectionBounds /
 * toScreenPoint / getMindAddButtons 自 app.ts 逐字迁入（脑图焦点分支与四个
 * 早退逐字保留）。对 app.ts 只允许 import type；BoardSDK 同名方法一行委托。
 */
import type { IRect } from './common/geometry';
import { unionRects } from './common/geometry';
import type { IMindAddButtonsState, ITreeAddButtonsState } from './types';
import type { IBoardQueryHost } from './boardHost';
import { isTreeWidgetType } from './types';
import { TREE_KINDS } from './widgets/tree/registry';

/** 选中元素世界坐标外接矩形（无选中返回 null） */
export function getSelectionBounds(host: IBoardQueryHost): IRect | null {
  const ids = host.selector?.selected$.value ?? [];
  // 4.9 节点级选中：ActionBar（含删除按钮）定位到**焦点节点本体**；根焦点同样如此
  // ——既有设计 actionBar 跟的是 selectedBounds，而点根选中的是那个 MIND_NODE。
  // 挂整树 bbox 会让根焦点时的浮动栏飘到整棵树上方（用户实测：删除按钮位置异常）
  if (ids.length === 1) {
    const vm = host.vmEngine?.getVmById(ids[0]!);
    if (vm && isTreeWidgetType(vm.type)) {
      const st = host.treeService?.getFocusedState();
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
  if (!host.treeService) return null;
  if (host.treeService.isDragging) return null; // 拖拽重排中隐藏
  if (host.viewport!.cursorMode$.value !== 'cursor') return null;
  const f = host.treeService.getFocusedState();
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

/** 树形图族 + 按钮槽位（specs/tree-diagrams §8.5/§11.3，Phase 2）：四个早退
 *  与旧查询同源；槽位按 kind/orientation 计算（屏幕坐标、未钳制——react 钳制）。
 *  child 槽带逻辑侧：mind horizontal 左/右；mind vertical 上/下（left=上）；
 *  org（Phase 3）恒下。按钮几何常量与 react treeAddLayout 单源语义（BTN 28/GAP 8）。 */
const TREE_ADD_BTN = 28;
const TREE_ADD_GAP = 8;

export function getTreeAddButtons(host: IBoardQueryHost): ITreeAddButtonsState | null {
  if (!host.treeService) return null;
  if (host.treeService.isDragging) return null;
  if (host.viewport!.cursorMode$.value !== 'cursor') return null;
  const f = host.treeService.getFocusedState();
  if (!f) return null;
  // 焦点图 kind/orientation：经选区定位 vm（orientation 是图字段）
  const mapId = f.mapId;
  const vm = host.vmEngine?.getVmById(mapId);
  if (!vm) return null;
  const kind = vm.type as ITreeAddButtonsState['kind'];
  const treeKind = TREE_KINDS[kind as keyof typeof TREE_KINDS];
  if (!treeKind) return null;
  const orientation =
    (vm as unknown as { orientation: ITreeAddButtonsState['orientation'] }).orientation ??
    treeKind.defaultOrientation;

  const a = host.viewport!.toScreen({ x: f.worldRect.x, y: f.worldRect.y });
  const c = host.viewport!.toScreen({
    x: f.worldRect.x + f.worldRect.width,
    y: f.worldRect.y + f.worldRect.height,
  });
  const bounds = { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y };
  const midX = bounds.x + bounds.width / 2 - TREE_ADD_BTN / 2;
  const midY = bounds.y + bounds.height / 2 - TREE_ADD_BTN / 2;

  const slots: ITreeAddButtonsState['slots'] = [];
  const child = (side: 'left' | 'right' | undefined, left: number, top: number): void => {
    slots.push({ key: 'child', side, left, top });
  };
  if (kind === 'ORG_CHART' || orientation === 'top-down') {
    // org（审查返工 P0-3）：child 恒卡片正下方（无侧——specs §8.5 下+右），
    // sibling 右。此前 top-down 落入横向分支出左右槽，属 bug
    child(undefined, midX, bounds.y + bounds.height + TREE_ADD_GAP);
    if (!f.isRoot)
      slots.push({
        key: 'sibling',
        left: bounds.x + bounds.width + TREE_ADD_GAP,
        top: midY,
      });
  } else if (orientation === 'vertical') {
    // mind vertical：上（left）/下（right）建子、右建同级（spec §8.5 表）
    if (f.isRoot || f.direction === 'left')
      child('left', midX, bounds.y - TREE_ADD_BTN - TREE_ADD_GAP);
    if (f.isRoot || f.direction === 'right')
      child('right', midX, bounds.y + bounds.height + TREE_ADD_GAP);
    if (!f.isRoot)
      slots.push({
        key: 'sibling',
        left: bounds.x + bounds.width + TREE_ADD_GAP,
        top: midY,
      });
  } else {
    // mind horizontal（与旧 mindAddLayout 几何一致：侧向中点外 GAP）
    if (f.isRoot || f.direction === 'left')
      child('left', bounds.x - TREE_ADD_BTN - TREE_ADD_GAP, midY);
    if (f.isRoot || f.direction === 'right')
      child('right', bounds.x + bounds.width + TREE_ADD_GAP, midY);
    if (!f.isRoot)
      slots.push({ key: 'sibling', left: midX, top: bounds.y + bounds.height + TREE_ADD_GAP });
  }
  return { kind, orientation, isRoot: f.isRoot, bounds, slots };
}
