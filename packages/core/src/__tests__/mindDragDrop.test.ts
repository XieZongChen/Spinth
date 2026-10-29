// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it } from 'vitest';
import { makeService, spec } from './helpers/mindDragFixture';

/**
 * 拖拽重排合法性回归（docs/11 §6：「目标是选中节点后代 → 拒绝」）：
 * hitDropOnTree 曾只排除拖起节点自身、不排其后代——拖到自己后代上松手，
 * move() 的「删除→插入游离对象」两步里插入随游离 Y 对象丢失（事务不序列化），
 * 整棵子树静默消失（数据丢失级，2026-09 Phase 4 复审揪出）。
 */

describe('拖拽落点热区（docs/11 §6，对齐既有设计 DropArea 三层 + 距离择优）', () => {
  it('兄弟缝隙（节点上下 80px 内）→ 命中兄弟位，不再判空白拆图', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('B')]));
    const root = model.root;
    const [a, b] = [root.children[0]!, root.children[1]!];
    rects.set(root.id, { x: 0, y: 0, width: 100, height: 30 });
    rects.set(a.id, { x: 200, y: -100, width: 60, height: 24 });
    rects.set(b.id, { x: 200, y: 100, width: 60, height: 24 });
    const text = b.toJSON().text;
    // 拖 B 到 A 下方的缝隙（A 本体 200..260 × -100..-76，下方 10px 处）
    svc.startDrag('mm-1', b.id, { x: 230, y: 110 });
    const hit = svc.dragMove({ x: 230, y: -70 });
    expect(hit).toBe(true);
    const r = svc.dragEnd({ x: 230, y: -70 });
    expect(r).toBe('moved'); // 关键：不是 'new-map'
    // move 走序列化重建（节点 id 全新生成），因此按文案断言：B 作为 A 的兄弟留在同一张树里
    const texts = model.root.children.map((c) => c.toJSON().text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain(text);
    expect(texts[texts.indexOf('A') + 1]).toBe(text); // 插到 A 之后（缝隙在 A 下方）
    svc.dispose();
  });

  it('asChild 按下标插入（拖到某节点子区第 0 位 → 成为其首个子节点）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('B')]));
    const root = model.root;
    const [a, b] = [root.children[0]!, root.children[1]!];
    rects.set(root.id, { x: 0, y: 0, width: 100, height: 30 });
    rects.set(a.id, { x: 200, y: -100, width: 60, height: 24 });
    rects.set(b.id, { x: 200, y: 100, width: 60, height: 24 });
    // 拖 B 到 A 的子区（A 右侧扩区内、A 上方）→ A 的首个子
    const text = b.toJSON().text;
    svc.startDrag('mm-1', b.id, { x: 230, y: 110 });
    expect(svc.dragMove({ x: 300, y: -140 })).toBe(true);
    expect(svc.dragEnd({ x: 300, y: -140 })).toBe('moved');
    expect(a.children.length).toBe(1);
    expect(a.children[0]!.toJSON().text).toBe(text);
    svc.dispose();
  });
});

describe('拖拽拖影（docs/11 §6：本体半透明 + 快照跟随光标，2026-09-21 补缺）', () => {
  it('拖影惰性：按下无视觉；超阈值后半透明+快照；dragEnd 恢复', () => {
    const { svc, model, rects, layerChildren, alphaCalls } = makeService(spec('根', [spec('A')]));
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });

    const before = layerChildren.length;
    svc.startDrag('mm-1', a.id, { x: 230, y: 112 }); // 抓取点在节点内
    // 惰性：按下无视觉（单击不闪现）
    expect(alphaCalls).toEqual([]);
    expect(layerChildren.length).toBe(before);

    svc.dragMove({ x: 242, y: 112 }); // 单轴 12px > 阈值 10px → 拖动成立
    expect(alphaCalls).toContainEqual({ id: a.id, alpha: 0.8 }); // 本体半透明
    expect(layerChildren.length).toBe(before + 1); // 快照入层
    const ghost = layerChildren[layerChildren.length - 1] as {
      x: number;
      y: number;
      destroyed: boolean;
    };

    svc.dragMove({ x: 330, y: 212 }); // 继续位移 (+100, +100)
    expect(ghost.x).toBeCloseTo(300); // 200 + 100（快照 = 起始 rect + 指针位移）
    expect(ghost.y).toBeCloseTo(200);

    svc.dragMove({ x: 900, y: 900 });
    svc.dragEnd({ x: 900, y: 900 }); // 拖出成新图
    expect(alphaCalls).toContainEqual({ id: a.id, alpha: 1 }); // 本体恢复
    expect(ghost.destroyed).toBe(true); // 快照销毁
    svc.dispose();
  });
});

describe('拖拽重排后重选被拖节点（docs/11 §6「move → 重选中」，2026-09-22 用户实测揪出）', () => {
  it('同图搬移：焦点 = 重建后的新节点（曾回退根节点）', () => {
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('B')]));
    const a = model.root.children[0]!;
    const b = model.root.children[1]!;
    // 根 + A(右) + B(右下)，把 A 拖到 B 下方缝隙（asSibling after B）
    rects.set(model.root.id, { x: 0, y: 0, width: 60, height: 26 });
    rects.set(a.id, { x: 200, y: 60, width: 60, height: 24 });
    rects.set(b.id, { x: 200, y: 160, width: 60, height: 24 });

    svc.startDrag('mm-1', a.id, { x: 210, y: 70 });
    svc.dragMove({ x: 210, y: 200 }); // B 下方（asSibling）
    const result = svc.dragEnd({ x: 210, y: 200 });
    expect(result).toBe('moved');
    const moved = model.root.children.find((n) => n.toJSON().text === 'A')!;
    expect(svc.focusedNodeId).toBe(moved.id); // 重选新节点（曾 null → 回退根）
    expect(svc.focusedNodeId).not.toBe(model.root.id);
    svc.dispose();
  });
});
