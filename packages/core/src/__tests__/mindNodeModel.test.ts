import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MindNodeModel } from '../widgets/mind/mindNodeModel';

/** 构造带 children 的 yNode 并把根挂入 doc 顶级（游离 Y.Map 事务后会被 yjs 丢弃；
 *  仅根挂载——子树重复挂载会触发二次 integrate 崩溃） */
interface ITreeSpec {
  id: string;
  kids?: ITreeSpec[];
}

function makeYTree(doc: Y.Doc, spec: ITreeSpec, isRoot = true): Y.Map<unknown> {
  const holder = 'treeHolder_' + spec.id;
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    m.set('id', spec.id);
    m.set('text', `t-${spec.id}`);
    const arr = new Y.Array<Y.Map<unknown>>();
    for (const k of spec.kids ?? []) arr.push([makeYTree(doc, k, false)]);
    m.set('children', arr);
  });
  if (isRoot) {
    doc.getMap<Y.Map<unknown>>(holder).set('root', m);
    return m;
  }
  return m;
}

describe('MindNodeModel 增量树同步（docs/11 §3）', () => {
  it('初始化递归建子 Model（双向引用）', () => {
    const doc = new Y.Doc();
    const rootY = makeYTree(doc, { id: 'root', kids: [{ id: 'a' }, { id: 'b' }] });
    const root = new MindNodeModel(rootY);
    expect(root.children.map((c) => c.id)).toEqual(['a', 'b']);
    expect(root.children[0]!.getParent()).toBe(root);
    root.dispose();
  });

  it('远端插入/删除 → delta → 内存数组 splice', () => {
    const doc = new Y.Doc();
    const rootY = makeYTree(doc, { id: 'root', kids: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const root = new MindNodeModel(rootY);
    const events: unknown[] = [];
    root.childrenChange$.subscribe((d) => events.push(d));

    const yKids = rootY.get('children') as Y.Array<Y.Map<unknown>>;
    const d = new Y.Map<unknown>();
    doc.transact(() => {
      d.set('id', 'x');
      d.set('text', 'tx');
      d.set('children', new Y.Array<Y.Map<unknown>>());
      yKids.insert(1, [d]);
    });
    expect(root.children.map((c) => c.id)).toEqual(['a', 'x', 'b', 'c']);
    doc.transact(() => yKids.delete(0, 1)); // 删 a
    expect(root.children.map((c) => c.id)).toEqual(['x', 'b', 'c']);
    expect(events.length).toBe(2);
    expect((events[0] as Array<{ kind: string; index: number }>)[0]).toMatchObject({
      kind: 'insert',
      index: 1,
    });
    root.dispose();
  });

  it('【硬规定】toJSON 剥离 children——state 不含子树', () => {
    const doc = new Y.Doc();
    const rootY = makeYTree(doc, { id: 'root', kids: [{ id: 'deep1', kids: [{ id: 'deep2' }] }] });
    const root = new MindNodeModel(rootY);
    const json = root.toJSON();
    expect(json).toEqual({ id: 'root', text: 't-root' });
    expect(JSON.stringify(json)).not.toContain('deep1');
    root.dispose();
  });

  it('分支色沿父链继承；自身值覆盖', () => {
    const doc = new Y.Doc();
    const rootY = makeYTree(doc, { id: 'root', kids: [{ id: 'a' }] });
    const root = new MindNodeModel(rootY);
    doc.transact(() => rootY.set('lineColor', '#f00'));
    const a = root.children[0]!;
    expect(a.getLineColor('#000')).toBe('#f00'); // 继承根
    doc.transact(() =>
      (rootY.get('children') as Y.Array<Y.Map<unknown>>).get(0)!.set('lineColor', '#0f0'),
    );
    expect(a.getLineColor('#000')).toBe('#0f0'); // 自身覆盖
    root.dispose();
  });
});
