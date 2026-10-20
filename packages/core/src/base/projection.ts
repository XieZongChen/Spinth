import type * as Y from 'yjs';
import { Array as YArray } from 'yjs';
import { yRectToRect, type IYRectEntry } from '../platform/dataEngine/yRect';
import type { IBaseModel, IWidgetData } from '../types';

/**
 * observe→toJSON 增量投影（docs/16 §4，4.8 P2）：
 * BaseWidgetVm.onModelUpdate 消费 YEvent path/keys——顶层键直接 yData.get
 * 读值构造 partial，绕过全量 toJSON + 全字段 deepDiff。
 *
 * - rect（YKeyValue 数组）→ 展开四键（yRectToRect）
 * - points（pen Y.Array）→ toArray()（消费方是普通数组语义）
 * - MIND_MAP root（树子树）→ **丢弃**：Vm 不读 state.root，树渲染走
 *   MindNodeModel.childrenChange$/observeSelf——投影 partial 为空 =
 *   该次变化不触发整图重渲染（docs/11 §0 硬规定的投影层配套）
 * - null = 无法增量（路径非字符串等异常形态），调用方兜底全量 toJSON
 */
export function projectIncremental<D extends IWidgetData = IWidgetData>(
  model: IBaseModel<D>,
  events: Y.YEvent<never>[],
): Partial<D> | null {
  // 防御：非数组事件形态（测试桩等）→ 兜底全量
  if (!Array.isArray(events)) return null;
  const yData = model.yData as Y.Map<unknown>;
  const keys = new Set<string>();
  for (const ev of events) {
    if (ev.path.length === 0) {
      // yData 自身 Map 键变化
      if (!ev.keys) continue;
      for (const k of ev.keys.keys()) keys.add(k);
    } else {
      const top = ev.path[0];
      if (typeof top !== 'string') return null;
      keys.add(top);
    }
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k === 'root') continue; // MIND_MAP 树（Vm 不消费；树内增量走专用流）
    if (k === 'rect') {
      const r = yRectToRect(yData.get('rect') as Y.Array<IYRectEntry>);
      if (!r) return null;
      Object.assign(out, r);
      continue;
    }
    const v = yData.get(k);
    out[k] = v instanceof YArray ? v.toArray() : v;
  }
  return out as Partial<D>;
}
