import * as Y from 'yjs';
import { BehaviorSubject, Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { IDataEngineService, IHistoryService } from '../../types';

/** undo/redo 恢复的 widget（上层恢复 UI 用，如重新选中） */
export interface IRestoredWidget {
  id: string;
  type: string;
}

/** 撤销栈深度告警阈值（步）：超过即 console.warn 提示刷新可释放内存 */
const UNDO_STACK_WARN_DEPTH = 1000;
/** 告警节流（步）：超阈值后每新增 N 步提醒一次，不刷屏 */
const UNDO_STACK_WARN_INTERVAL = 500;

/**
 * 撤销重做（docs/10 §5）。
 *
 * 假 op 防护（2026-09 Phase 3，实测修正后的双层）：
 * 1. origin 纪律（静态）：ws/db/replay 的 update 均携带非 null origin，
 *    UndoManager 默认 trackedOrigins=Set([null]) 不入栈。
 * 2. 污染截断（动态兜底，fixRect 语义通用化）：yjs **不过滤 remote 事务**
 *    （实测：applyUpdate 不传 origin 的远端更新会以 origin=null 入栈）——
 *    监听 afterTransaction 标记「remote 且 origin=null」的异常事务，
 *    若其紧随 stack-item-added 入栈则截掉该 item。
 *    （原方案的 rect observe 收窄为通用事务判定：污染不限于 rect 写法。）
 * 另：DataProcessor/yRectSet 的写前 diff 消除本地同值假 op（docs/02 §4）。
 */
export class HistoryService extends Disposable implements IHistoryService {
  private um: Y.UndoManager | null = null;
  /** 污染事务标记：下一个 stack-item-added 若由它触发则截断 */
  private poisonedDepth = 0;

  readonly canUndo$ = new BehaviorSubject(false);
  readonly canRedo$ = new BehaviorSubject(false);
  /** undo/redo 涉及恢复的 widget */
  readonly restoredWidgets$ = new Subject<IRestoredWidget[]>();

  constructor(private engine: IDataEngineService) {
    super();
  }

  initialize(): void {
    // 动态兜底的监听必须先于 UndoManager 注册（外部审查实证的死代码缺陷）：
    // UndoManager 的 afterTransaction handler 同步入栈污染项，若本监听器
    // 注册在后，其运行时 before 已含污染项，截断永不触发。
    this.engine.yDoc.on('afterTransaction', this.onAfterTransaction);
    this.addDisposable(() => this.engine.yDoc.off('afterTransaction', this.onAfterTransaction));

    this.um = new Y.UndoManager(this.engine.yWidgets as Y.Array<unknown>, {
      ignoreRemoteMapChanges: true,
    });
    this.um.on('stack-item-added', this.onStackChanged);
    this.um.on('stack-item-popped', this.onStackChanged);
    this.um.on('stack-cleared', this.onStackChanged);
  }

  private onAfterTransaction = (tr: Y.Transaction): void => {
    if (!tr.local && tr.origin === null) {
      // 先切断 captureTimeout 合并窗口（外部审查揪出的漏洞：远端污染若落在本地
      // 两次编辑的 500ms 窗口内会并入现有栈项，栈长不变、截断不可见），
      // 再保留栈增长截断兜底（防并入发生在 stopCapturing 之前）
      this.um?.stopCapturing();
      const before = this.um?.undoStack.length ?? 0;
      queueMicrotask(() => {
        const after = this.um?.undoStack.length ?? 0;
        if (after > before) {
          this.um!.undoStack.length = before;
          this.syncFlags();
        }
      });
    }
  };

  /** 长会话监控计数（docs/16 P3#3）：自上次达到阈值以来新增的栈项数 */
  private stackItemsSinceWarn = 0;

  private onStackChanged = (): void => {
    this.syncFlags();
    this.warnIfStackDeep();
  };

  /**
   * 长会话内存监控（docs/16 P3#3，2026-09-28）：Y.UndoManager 无外部修剪 API
   * （仅 clear() = 丢全部撤销，不可用）——撤销栈随会话单调增长，内存有界性
   * 依赖「会话结束即重建」。行业参照：部分桌面编辑器会话内不限步数、仅受内存
   * 约束；部分默认 50、上限 1000；办公软件硬上限 100 级。spinth 采用会话内
   * 不限步 + 刷新重建，超阈值仅告警提示。
   */
  private warnIfStackDeep(): void {
    const depth = this.um?.undoStack.length ?? 0;
    if (depth < UNDO_STACK_WARN_DEPTH) {
      this.stackItemsSinceWarn = 0;
      return;
    }
    this.stackItemsSinceWarn += 1;
    if (this.stackItemsSinceWarn >= UNDO_STACK_WARN_INTERVAL) {
      this.stackItemsSinceWarn = 0;
      console.warn(
        `[spinth:history] 撤销栈深度 ${depth}（会话内持续增长，刷新即重建）。` +
          '如遇内存压力，保存后刷新页面可释放。',
      );
    }
  }

  /** undo/redo 前后 widgets 差集（恢复 = 之前不在、之后出现）。
   *  比 StackItem.insertions（不可迭代的 ID 二进制集合）简单且语义精确。 */
  private collectRestored(before: Set<string>): IRestoredWidget[] {
    const restored: IRestoredWidget[] = [];
    for (const m of this.engine.yWidgets.toArray() as Y.Map<unknown>[]) {
      const id = m.get('id');
      const type = m.get('type');
      if (typeof id === 'string' && typeof type === 'string' && !before.has(id)) {
        restored.push({ id, type });
      }
    }
    return restored;
  }

  private widgetIds(): Set<string> {
    const ids = new Set<string>();
    for (const m of this.engine.yWidgets.toArray() as Y.Map<unknown>[]) {
      const id = m.get('id');
      if (typeof id === 'string') ids.add(id);
    }
    return ids;
  }

  private syncFlags(): void {
    this.canUndo$.next((this.um?.undoStack.length ?? 0) > 0);
    this.canRedo$.next((this.um?.redoStack.length ?? 0) > 0);
  }

  undo(): void {
    if (!this.um) return;
    const before = this.widgetIds();
    this.um.undo();
    const restored = this.collectRestored(before);
    if (restored.length > 0) this.restoredWidgets$.next(restored);
  }

  redo(): void {
    if (!this.um) return;
    const before = this.widgetIds();
    this.um.redo();
    const restored = this.collectRestored(before);
    if (restored.length > 0) this.restoredWidgets$.next(restored);
  }

  stopCapturing(): void {
    this.um?.stopCapturing();
  }

  override dispose(): void {
    this.um?.destroy();
    this.um = null;
    super.dispose();
  }
}
