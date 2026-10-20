import { Disposable } from '../../base/disposable';
import type { IRect } from '../../common/geometry';

/**
 * 世界坐标网格索引（docs/16 §1，4.8 P0）：固定格宽，Map<cellKey, Set<id>>，
 * 服务命中/框选/吸附候选与视口 culling——O(全量遍历) → O(涉及格)。
 *
 * 一项可跨多格（跨界 widget 在所有覆盖格注册，查询自然去重）；
 * itemCells 反查表支撑移动时清理旧格。
 */

export const SPATIAL_CELL_SIZE = 512;

export class SpatialIndex extends Disposable {
  private readonly cells = new Map<string, Set<string>>();
  /** id → 当前占据格（update 时 diff 清旧格） */
  private readonly itemCells = new Map<string, string[]>();

  constructor(private readonly cellSize: number = SPATIAL_CELL_SIZE) {
    super();
  }

  /** 插入或移动（bounds 变化时清旧格入新格；格集合不变则零写） */
  update(id: string, bounds: IRect): void {
    const next = this.cellKeys(bounds);
    const prev = this.itemCells.get(id);
    if (prev && sameKeys(prev, next)) return;
    if (prev) {
      for (const k of prev) this.removeFromCell(k, id);
    }
    for (const k of next) {
      let set = this.cells.get(k);
      if (!set) {
        set = new Set();
        this.cells.set(k, set);
      }
      set.add(id);
    }
    this.itemCells.set(id, next);
  }

  remove(id: string): void {
    const prev = this.itemCells.get(id);
    if (!prev) return;
    for (const k of prev) this.removeFromCell(k, id);
    this.itemCells.delete(id);
  }

  /** 与矩形相交的格内候选 id 集（查询侧仍需精确 bounds 判定） */
  queryIds(r: IRect): Set<string> {
    const out = new Set<string>();
    const [x0, y0, x1, y1] = this.cellRange(r);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(`${cx},${cy}`);
        if (set) for (const id of set) out.add(id);
      }
    }
    return out;
  }

  get size(): number {
    return this.itemCells.size;
  }

  private removeFromCell(key: string, id: string): void {
    const set = this.cells.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) this.cells.delete(key);
  }

  private cellRange(r: IRect): [number, number, number, number] {
    return [
      Math.floor(r.x / this.cellSize),
      Math.floor(r.y / this.cellSize),
      Math.floor((r.x + r.width) / this.cellSize),
      Math.floor((r.y + r.height) / this.cellSize),
    ];
  }

  private cellKeys(r: IRect): string[] {
    const [x0, y0, x1, y1] = this.cellRange(r);
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(`${cx},${cy}`);
    }
    return keys;
  }
}

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
