import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { IRestoredWidget } from '../platform/history/historyService';

/**
 * undo 防护三路验证 + restoredWidgets$（docs/10 §5，2026-09 决策：
 * spinth 架构下假 op 被 origin 纪律 / remote 事务过滤 / 写前 diff 三层静态消解）。
 */

describe('HistoryService undo 防护（docs/10 §5 三路消解）', () => {
  it('路 1：origin 纪律——非 null origin 的本地事务不入栈', () => {
    const doc = new Y.Doc();
    const widgets = doc.getArray('widgets');
    const um = new Y.UndoManager(widgets);
    const external = new WebsocketProviderLike();

    // 模拟 ws/db 来源：origin = provider 实例
    doc.transact(() => widgets.push([new Y.Map([['id', 'remote-1']])]), external);
    expect(um.undoStack.length).toBe(0);

    // 用户写（origin=null）入栈
    doc.transact(() => widgets.push([new Y.Map([['id', 'user-1']])]));
    expect(um.undoStack.length).toBe(1);
    um.destroy();
    doc.destroy();
  });

  it('路 2（动态兜底）：remote 且 origin=null 的事务入栈被一步截除（真实注册顺序）', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const w1 = doc1.getArray('widgets');
    const w2 = doc2.getArray('widgets');
    w1.push([new Y.Map([['id', 'base']])]);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1), 'seed');

    // 先挂服务（截断监听先于 UndoManager——与 HistoryService.initialize 同序），
    // 再注入污染（外部审查揪出旧测试空转：污染先注入后挂服务是平凡真）
    const svc = attachHistoryService(doc2, w2);
    doc1.transact(() => w1.push([new Y.Map([['id', 'poison']])]));
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1)); // 不传 origin = null 入栈
    await new Promise((r) => setTimeout(r, 20)); // 截断在微任务

    expect(svc.um.undoStack.length).toBe(0); // 污染被截除
    svc.um.undo(); // 无可撤销——数据不变
    expect((w2.toArray() as Y.Map<unknown>[]).map((m) => m.get('id'))).toContain('poison');
    svc.um.destroy();
    doc1.destroy();
    doc2.destroy();
  });

  it('restoredWidgets$：undo 删除时收集被恢复的 widget', async () => {
    const doc = new Y.Doc();
    const widgets = doc.getArray('widgets');
    const um = new Y.UndoManager(widgets);
    const restored: IRestoredWidget[][] = [];
    // 与 HistoryService 相同的快照差集逻辑
    const snapshotIds = (): Set<string> =>
      new Set((widgets.toArray() as Y.Map<unknown>[]).map((m) => String(m.get('id'))));

    // 创建 → 删除 → undo（恢复）
    doc.transact(() =>
      widgets.push([
        new Y.Map([
          ['id', 'w-undo'],
          ['type', 'SHAPE'],
        ]),
      ]),
    );
    um.stopCapturing(); // 创建与删除是两个撤销单元（captureTimeout 默认 500ms 会合并）
    doc.transact(() => widgets.delete(0, 1));
    const before = snapshotIds();
    um.undo();
    const out: IRestoredWidget[] = (widgets.toArray() as Y.Map<unknown>[])
      .filter((m) => !before.has(String(m.get('id'))))
      .map((m) => ({ id: String(m.get('id')), type: String(m.get('type')) }));
    restored.push(out);

    expect(restored.length).toBeGreaterThan(0);
    expect(restored[0]).toContainEqual({ id: 'w-undo', type: 'SHAPE' });
    um.destroy();
    doc.destroy();
  });
});

/** 测试用 origin 标记（模拟 wsProvider/dbProvider 实例） */
class WebsocketProviderLike {
  readonly tag = 'origin-like';
}

describe('HistoryService redo 面（docs/10 §5——盘点补齐：canRedo$/redo 栈互转）', () => {
  it('undo → redo 往返：数据与栈互转（redoStack 消费后可再 undo）', () => {
    const doc = new Y.Doc();
    const w = doc.getArray('widgets');
    // captureTimeout=0：离散撤销单元（默认 500ms 会把测试里的快速连续事务合一项）
    const um = new Y.UndoManager(w, { captureTimeout: 0 });
    doc.transact(() => w.push([new Y.Map([['id', 'a']])]));
    doc.transact(() => w.push([new Y.Map([['id', 'b']])]));
    expect(w.length).toBe(2);

    um.undo();
    expect(w.length).toBe(1);
    expect(um.redoStack.length).toBe(1);

    um.redo();
    expect(w.length).toBe(2);
    expect((w.toArray() as Y.Map<unknown>[]).map((m) => m.get('id'))).toEqual(['a', 'b']);

    // redo 消费后 undo 栈仍有第一步——可继续往返
    um.undo();
    expect(w.length).toBe(1);
    um.destroy();
    doc.destroy();
  });

  it('redo 后新写截断 redoStack（分支丢弃——业界标准语义）', () => {
    const doc = new Y.Doc();
    const w = doc.getArray('widgets');
    const um = new Y.UndoManager(w, { captureTimeout: 0 });
    doc.transact(() => w.push([new Y.Map([['id', 'a']])]));
    doc.transact(() => w.push([new Y.Map([['id', 'b']])]));
    um.undo();
    expect(um.redoStack.length).toBe(1);
    doc.transact(() => w.push([new Y.Map([['id', 'c']])])); // 分支
    expect(um.redoStack.length).toBe(0); // 旧分支被截断
    um.redo();
    expect(w.length).toBe(2); // redo 无操作
    expect((w.toArray() as Y.Map<unknown>[]).map((m) => m.get('id'))).toEqual(['a', 'c']);
    um.destroy();
    doc.destroy();
  });
});

/** 在裸 doc 上复刻 HistoryService 的兜底（监听先于 UndoManager 注册——与真实服务同序，
 *  该顺序正是外部审查实证的死代码根因：UM 的 handler 同步入栈，晚注册的监听器
 *  看到的 before 已含污染项） */
function attachHistoryService(doc: Y.Doc, widgets: Y.Array<unknown>): { um: Y.UndoManager } {
  const holder: { um?: Y.UndoManager } = {};
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    const um = holder.um;
    if (!um) return;
    if (!tr.local && tr.origin === null) {
      const before = um.undoStack.length;
      queueMicrotask(() => {
        if (um.undoStack.length > before) {
          um.undoStack.length = before;
        }
      });
    }
  });
  holder.um = new Y.UndoManager(widgets, { ignoreRemoteMapChanges: true });
  return { um: holder.um };
}
