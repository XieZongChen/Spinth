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

describe('MindDragger 拖到自身后代（docs/11 §6 合法性）', () => {
  it('拖起节点的后代不产生 drop 命中（松手不吞子树）', () => {
    // 根 → A → B；拖 A 到 B 上方 —— B 是 A 的后代，必须拒绝
    const { svc, model, rects } = makeService(spec('根', [spec('A', [spec('B')])]));
    const a = model.root.children[0]!;
    const b = a.children[0]!;
    // 热区：A 大矩形，B 在 A 内（命中 walk 会先到 A 自身——排除，再到 B）
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    rects.set(b.id, { x: 240, y: 108, width: 60, height: 24 });

    expect(svc.startDrag('mm-1', a.id, { x: 0, y: 0 })).toBe(true);
    const hit = svc.dragMove({ x: 250, y: 115 }); // B 的热区内
    expect(hit).toBe(false); // 后代必须被拒——曾命中 asChild(b)
    svc.dispose();
  });

  it('非后代节点正常命中（合法性修复不误伤正常路径）', () => {
    // 根 → A、C（兄弟）；拖 A 到 C 上 → asChild 命中
    const { svc, model, rects } = makeService(spec('根', [spec('A'), spec('C')]));
    const a = model.root.children[0]!;
    const c = model.root.children[1]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    rects.set(c.id, { x: 400, y: 100, width: 60, height: 24 });

    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    expect(svc.dragMove({ x: 410, y: 108 })).toBe(true);
    svc.dispose();
  });

  it('dragEnd 在「命中后代被拒」场景不静默丢子树（未命中 → 成新图，A 的子树随 spec 进新图）', () => {
    const { svc, model, rects, engine } = makeService(spec('根', [spec('A', [spec('B')])]));
    const adds: Array<Record<string, unknown>> = [];
    (engine as { add: (d: Record<string, unknown>) => string }).add = (d) => {
      adds.push(d);
      return 'mm-2';
    };
    const a = model.root.children[0]!;
    rects.set(model.root.id, { x: 0, y: 0, width: 50, height: 20 });
    rects.set(a.id, { x: 200, y: 100, width: 60, height: 24 });
    rects.set(a.children[0]!.id, { x: 240, y: 108, width: 60, height: 24 });

    svc.startDrag('mm-1', a.id, { x: 0, y: 0 });
    svc.dragMove({ x: 250, y: 115 }); // 后代位置（被拒 → lastTarget null）
    const result = svc.dragEnd({ x: 250, y: 115 });
    // 未命中 → 成新图；A 从源树搬走、其子树（B）完整进新图 spec——
    // 曾经：命中后代 → move 分支删除 A 后对游离 dest 插入丢失，两头全空
    expect(result).toBe('new-map');
    expect(model.root.children.length).toBe(0); // A 已搬离源树
    expect(adds.length).toBe(1);
    const rootSpec = adds[0]!.root as { text: string; children?: Array<{ text: string }> };
    expect(rootSpec.text).toBe('A');
    expect(rootSpec.children?.[0]?.text).toBe('B'); // 子树完整保留
    svc.dispose();
  });
});
