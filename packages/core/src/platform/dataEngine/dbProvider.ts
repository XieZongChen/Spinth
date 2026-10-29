import * as Y from 'yjs';
import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import {
  DOC_DB_PREFIX,
  type IAuditEntry,
  openDb,
  reqToPromise,
  STORE_ALL,
  STORE_UPDATES,
} from './dbSchema';
import { DbWriteQueue } from './dbWriteQueue';
import { readLegacyUpdates } from './dbMaintenance';

// 库/存储基建单源在 dbSchema；写聚合队列在 dbWriteQueue；维护函数在
// dbMaintenance（下方 re-export 保持既有 import 路径）
export { DOC_DB_PREFIX } from './dbSchema';
export {
  listPersistedDocIds,
  scanDocAssetRefs,
  DocExistsError,
  createDocFromSnapshot,
} from './dbMaintenance';

/**
 * IndexedDB 持久化（docs/10 §7，Phase 3 双 store 版，自研替换 y-indexeddb）：
 *
 * 每 doc 一个库（spinth-doc:<docId>），两个 store：
 * - updates：增量日志；≥ COMPACT_THRESHOLD 条时 debounce 1s compaction
 *   （单事务内 clear + 写全量快照，恢复路径读到的永远是「快照或增量序列」）。
 * - allupdates：{ u, t } 审计日志，compaction 时以快照为锚点窗口重写——
 *   replay 的数据源（docs/10 §6；可回放深度 = 最近一次 compaction 之后，
 *   docs/16 §6 定案）。
 *
 * 写入守卫（origin 纪律，docs/10 §2）：doc.on('update', u, origin) 中
 * origin !== 本实例才落盘——db 恢复/replay 回流的 update 不重复写。
 * compaction 的 encodeStateAsUpdate 是读操作，不触发 update 事件。
 *
 * 迁移：检测旧版 y-indexeddb 库（库名 = docId，store 'updates'）→ 导入后删旧库。
 * 不做 doc 级 LRU 整库删（docs/02 §6 / docs/16 §6 定案）：单机版本地即唯一副本。
 */

/** 增量日志 compaction 阈值（视觉规格：500 条 op 后快照收敛） */
const COMPACT_THRESHOLD = 500;
/** compaction 防抖（写入风暴时不反复快照） */
const COMPACT_DEBOUNCE_MS = 1000;

export class DbProvider extends Disposable {
  private db: IDBDatabase | null = null;
  private doc: Y.Doc | null = null;
  private pendingCount = 0;
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  /** 写聚合队列（缓冲/timer/退避归队列；flush 成功经 onFlushed 回调本类） */
  private readonly writeQueue: DbWriteQueue;
  /** compaction 防重入（Batch 2）：乐观双事务在途时后续 compact 串行排队 */
  private compacting = false;
  /** 快照计算注入点（Batch 2）：默认惰性 worker 化；无 Worker/失败退主线程同步。
   *  传输语义 = 盘上增量列表 → 全量快照（compactWorker.computeSnapshot 纯函数同款） */
  private snapshotCompute:
    ((updates: Array<Uint8Array | ArrayBuffer>) => Promise<Uint8Array>) | null = null;
  private compactWorkerUsed = false;
  /** 只读标签（docs/21 §4）：拒绝一切文档写入——update 丢弃、flush/compaction/
   *  legacy 迁移写跳过；persistState$ 保持 saved（没有真实未落盘发生） */
  private readOnly = false;
  private readOnlyWarned = false;
  /** origin 标记：本实例触发的 update（恢复/迁移回放）不回流落盘 */
  private readonly self = Symbol('spinth-db');
  /** 落盘状态（Batch 1 · 1.15，2026-10-17 审查 4.3「最危险项」）：saving=缓冲有
   *  未落盘 op；failed=写失败退避重试中（配额满/私密模式——此前静默，用户以为
   *  已保存刷新即丢）。仅写事务 oncomplete 后回 saved */
  readonly persistState$ = new BehaviorSubject<'saved' | 'saving' | 'failed'>('saved');
  /** 写入守卫跳过集（除 self 外可登记 replay 等非用户 origin——docs/10 §2 纪律表） */
  private readonly skipOrigins = new Set<unknown>();

  constructor() {
    super();
    // 写聚合队列（缓冲/timer/退避归队列）：flush 成功回调累加 pendingCount 并
    // 调度 compaction（compaction 状态仍归本类）
    this.writeQueue = new DbWriteQueue(
      {
        getDb: (): IDBDatabase | null => this.db,
        onFlushed: (count: number): void => {
          this.pendingCount += count;
          this.scheduleCompact();
        },
      },
      this.persistState$,
    );
  }

  /** 登记免落盘 origin（DataEngineService 用于 replay 回放，防审计日志重复叠加） */
  ignoreOrigin(origin: unknown): void {
    this.skipOrigins.add(origin);
  }

  /**
   * 恢复 + 挂监听。完成后 yDoc 已含全部本地数据。
   * replay 模式（docs/10 §6）：跳过普通恢复（updates store 不 apply），
   * 供 ReplayProvider 从 allupdates 审计日志逐条回放。
   */
  async attach(
    docId: string,
    yDoc: Y.Doc,
    opts?: { replay?: boolean; readOnly?: boolean },
  ): Promise<void> {
    this.readOnly = opts?.readOnly === true;
    // P0-5（2026-10-17 外部审查）：旧库迁移改为「先读入内存 → 开新库 → 合并态
    // 快照落新库（写事务确认后）→ 删旧库」——原实现读入内存后立即删旧库且不
    // 向新库写任何内容，首次打开看似正常（内存有数据）、二次刷新全丢且旧库
    // 已删不可恢复
    const legacy = await readLegacyUpdates(docId, yDoc, this.self);
    this.db = await openDb(DOC_DB_PREFIX + docId, [STORE_UPDATES, STORE_ALL]);
    this.doc = yDoc;

    // 恢复：逐条 apply（origin=self：写入守卫防回流；非 null origin 不进 undo 栈——docs/10 §2）
    const tx = this.db.transaction(STORE_UPDATES, 'readonly');
    const updates = (await reqToPromise(tx.objectStore(STORE_UPDATES).getAll())) as Array<
      Uint8Array | ArrayBuffer
    >;
    if (!opts?.replay) {
      for (const u of updates) {
        Y.applyUpdate(yDoc, new Uint8Array(u), this.self);
      }
    }
    this.pendingCount = updates.length;

    if (legacy && !this.readOnly) {
      // 合并态（legacy + 既有 updates）快照落新库：clear+add 幂等（迁移中途
      // 崩溃旧库仍在，重迁无害——allupdates 可能多一行快照，replay 幂等）。
      // 只读标签跳过写与删旧库：旧库 update 已在 readLegacyUpdates 应用到内存，
      // 主写者标签会完成迁移（docs/21 §4）
      const snapshot = Y.encodeStateAsUpdate(yDoc);
      const wtx = this.db.transaction([STORE_UPDATES, STORE_ALL], 'readwrite');
      wtx.objectStore(STORE_UPDATES).clear();
      wtx.objectStore(STORE_UPDATES).add(snapshot);
      wtx.objectStore(STORE_ALL).add({ u: snapshot, t: Date.now() } satisfies IAuditEntry);
      await new Promise<void>((resolve, reject) => {
        wtx.oncomplete = (): void => resolve();
        wtx.onerror = (): void => reject(wtx.error);
      });
      this.pendingCount = 1;
      indexedDB.deleteDatabase(docId); // 快照确认落盘后才删旧库
    }

    yDoc.on('update', this.onDocUpdate);
    this.addDisposable(() => yDoc.off('update', this.onDocUpdate));
    this.skipOrigins.add(this.self);
    // 页面隐藏/关闭时冲刷写缓冲（IDB 事务异步，尽力落盘——best effort）：
    // pagehide 兜关页/跳转；visibilitychange(hidden) 兜切后台长挂后直接杀
    // 进程的窗口（Safari 等场景切后台不触发 pagehide——注释曾声称注册而实现
    // 缺失，2026-09-30 nit#1 收口补齐）
    if (typeof globalThis.addEventListener === 'function') {
      const onHide = (): void => {
        void this.flushPendingWrites();
      };
      const onVisibility = (): void => {
        if (
          (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState ===
          'hidden'
        ) {
          void this.flushPendingWrites();
        }
      };
      globalThis.addEventListener('pagehide', onHide);
      globalThis.addEventListener('visibilitychange', onVisibility);
      this.addDisposable(() => {
        globalThis.removeEventListener('pagehide', onHide);
        globalThis.removeEventListener('visibilitychange', onVisibility);
      });
    }
  }

  /** 运行时切换只读（updateEditable → engine.setWriteEnabled 联动，docs/21 §4）：
   *  只读只拒绝**新** update——切换前已进写缓冲的增量必须立即冲落盘
   *  （updateEditable(false) 先 exitActive，可能刚产生一次文本提交），否则
   *  persistState 滞留 saving 且 dispose 也冲不掉；切回可写恢复写入路径 */
  setReadOnly(v: boolean): void {
    this.readOnly = v;
    if (v) void this.flushPendingWrites();
    else this.readOnlyWarned = false;
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.skipOrigins.has(origin)) return; // db 恢复/迁移/replay 回放不落盘
    if (this.readOnly) {
      // 只读标签兜底：UI/命令闸门有十来处，漏一处就是第二个写者（Yjs 会合并，
      // 但 undo 栈与用户预期都会坏）——磁盘层最后防线，首次提示一次
      if (!this.readOnlyWarned) {
        this.readOnlyWarned = true;
        console.warn('[spinth:db] 只读标签拒绝文档写入（另一标签可能是写者）');
      }
      return;
    }
    if (!this.db) return;
    this.writeQueue.enqueue(update);
  };

  /**
   * 把写缓冲单事务批量落盘（顺序保持；写失败时批退回缓冲待下次重试）。
   * pagehide / visibilitychange(hidden) / dispose 均触发——「flush 必须在关库
   * 之前」经验族。pendingCount 按条累加：compaction 阈值语义不变（外部审查 DoD #2）。
   */
  flushPendingWrites(): Promise<void> {
    // 只读不拦 flush：已发生的写必须落盘（切只读前的缓冲 / pagehide / dispose
    // 都走本入口）；只读的拦截在 onDocUpdate——新 update 根本进不了缓冲
    return this.writeQueue.flush();
  }

  private scheduleCompact(): void {
    if (this.pendingCount < COMPACT_THRESHOLD || this.compactTimer) return;
    this.compactTimer = setTimeout(() => {
      this.compactTimer = null;
      void this.compact();
    }, COMPACT_DEBOUNCE_MS);
  }

  /** 测试/运维入口：冲刷写缓冲后立即 compaction */
  async compactNow(): Promise<void> {
    await this.flushPendingWrites();
    await this.compact();
  }

  /**
   * 单事务 clear + 写全量快照（原子：崩溃时要么旧增量在、要么快照在）。
   * 前置冲刷写缓冲（快照必须包含缓冲内的 op——外部审查 DoD #3）。
   * 跨标签合并（P0-4，2026-10-17 外部审查）：同一 docId 的其他标签页会向
   * updates 落盘本实例未见过的增量——快照若只取本实例内存 doc，clear 会把
   * 那些增量永久抹掉（双活标签 A compact → B 已落盘写入消失）。**同一 IDB
   * 写事务内先 getAll 重读**：applyUpdate 幂等（已知增量 no-op、未知增量并入
   * 内存），且同 store 事务串行化——重读到的必是此刻已提交全集，clear 前
   * 其他标签无法插写（读后写在同一事务回调链内发起，活性无争议）。
   * 审计日志治理（docs/16 P2#2；docs/13:206 既有挂账收口）：compaction 时以
   * 全量快照（含合并态）为锚点重写 allupdates——审计体积从「全历史无界」
   * 变为「上次 compaction 以来的窗口」（≤ 阈值条 + 1 快照行）。快照行本身是
   * 合法 update，replay 顺序 apply 幂等、逻辑不变；**语义取舍：可回放深度 =
   * 最近一次 compaction 之后**（冲突复现场景都在近期窗口，docs/10 §6）。
   */
  private compact(): Promise<void> {
    if (this.readOnly) return Promise.resolve(); // 只读不塌缩磁盘（docs/21 §4）
    if (!this.db || !this.doc) return Promise.resolve();
    if (this.compacting) return Promise.resolve(); // 在途：丢弃本次（debounce 会再来）
    this.compacting = true;
    const done = (): void => {
      this.compacting = false;
    };
    return this.flushPendingWrites()
      .then(() => this.compactViaWorker())
      .catch(() => this.compactSynchronous())
      .finally(done);
  }

  /** Worker 可用性探测（惰性一次）：computeSnapshotInWorker 动态 import——
   *  jsdom（无 Worker）import 本身成功但调用抛错，退同步路径（已有回归覆盖） */
  private ensureSnapshotCompute(): Promise<
    (updates: Array<Uint8Array | ArrayBuffer>) => Promise<Uint8Array>
  > {
    if (!this.snapshotCompute) {
      this.snapshotCompute = (updates) =>
        import('./compactWorker').then((m) => m.computeSnapshotInWorker(updates));
    }
    return Promise.resolve(this.snapshotCompute);
  }

  /** 乐观双事务 compaction（Batch 2）：CPU 大头（apply×N + 全量 encode）移 Worker。
   *  IDB 事务不能跨 Worker 往返保活（控制权回事件循环即自动提交）——拆两事务：
   *  Tx A readonly getAll → U；worker 算快照 S（纯盘上状态重建，≡ 内存 doc+盘合并——
   *  compact 前已 flushPendingWrites，磁盘=已提交全集含他标签）；Tx B readwrite 再
   *  getAll → U'，U'≡U（逐字节）才 clear+put——B 内 getAll→clear 同回调链（活性同
   *  P0-4 论证）+ 同 store 串行化 ⇒ 落盘时 S 必为提交全集；U'≠U（他标签间隙写入，
   *  稀有）重试，3 轮后由调用方退同步路径 */
  private async compactViaWorker(): Promise<void> {
    const compute = await this.ensureSnapshotCompute();
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const updates = await this.readAllUpdates();
      const snapshot = await compute(updates); // 失败上抛 → 退同步
      this.compactWorkerUsed = true;
      const ok = await this.writeSnapshotIfUnchanged(updates, snapshot);
      if (ok) {
        this.pendingCount = 1;
        return;
      }
      // U'≠U：间隙有他标签写入——重读重算
    }
    throw new Error('compaction: 乐观并发 3 轮未收敛');
  }

  private readAllUpdates(): Promise<Array<Uint8Array | ArrayBuffer>> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_UPDATES, 'readonly');
      const req = tx.objectStore(STORE_UPDATES).getAll();
      req.onsuccess = (): void => resolve(req.result as Array<Uint8Array | ArrayBuffer>);
      req.onerror = (): void => reject(req.error);
    });
  }

  /** 逐字节等价判定（IDB autoIncrement 键序稳定——顺序即写入序） */
  private static sameUpdates(
    a: Array<Uint8Array | ArrayBuffer>,
    b: Array<Uint8Array | ArrayBuffer>,
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = new Uint8Array(a[i]!);
      const y = new Uint8Array(b[i]!);
      if (x.length !== y.length) return false;
      for (let j = 0; j < x.length; j++) {
        if (x[j] !== y[j]) return false;
      }
    }
    return true;
  }

  /** Tx B：U'≡U 才落盘；返回是否成功（false = 竞态，调用方重试） */
  private writeSnapshotIfUnchanged(
    expected: Array<Uint8Array | ArrayBuffer>,
    snapshot: Uint8Array,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_UPDATES, STORE_ALL], 'readwrite');
      const updatesStore = tx.objectStore(STORE_UPDATES);
      const getAllReq = updatesStore.getAll();
      getAllReq.onsuccess = (): void => {
        if (
          !DbProvider.sameUpdates(expected, getAllReq.result as Array<Uint8Array | ArrayBuffer>)
        ) {
          resolve(false); // 间隙写入——本事务空提交（无写请求），安全
          return;
        }
        updatesStore.clear();
        updatesStore.add(snapshot);
        tx.objectStore(STORE_ALL).clear();
        tx.objectStore(STORE_ALL).add({ u: snapshot, t: Date.now() } satisfies IAuditEntry);
        tx.oncomplete = (): void => resolve(true);
        tx.onerror = (): void => reject(tx.error);
      };
      getAllReq.onerror = (): void => reject(getAllReq.error);
    });
  }

  /** 同步单事务 compaction（原路径，Batch 2 后为 fallback）：Worker 不可用/
   *  失败/乐观并发未收敛时兜底——正确性优先，jank 代价只在异常环境付 */
  private compactSynchronous(): Promise<void> {
    if (!this.db || !this.doc) return Promise.resolve();
    const doc = this.doc;
    return this.flushPendingWrites().then(
      () =>
        new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction([STORE_UPDATES, STORE_ALL], 'readwrite');
          const updatesStore = tx.objectStore(STORE_UPDATES);
          const getAllReq = updatesStore.getAll();
          getAllReq.onsuccess = (): void => {
            for (const u of getAllReq.result as Array<Uint8Array | ArrayBuffer>) {
              Y.applyUpdate(doc, new Uint8Array(u), this.self);
            }
            const snapshot = Y.encodeStateAsUpdate(doc);
            updatesStore.clear();
            updatesStore.add(snapshot);
            tx.objectStore(STORE_ALL).clear();
            tx.objectStore(STORE_ALL).add({ u: snapshot, t: Date.now() } satisfies IAuditEntry);
            tx.oncomplete = (): void => {
              this.pendingCount = 1;
              resolve();
            };
            tx.onerror = (): void => reject(tx.error);
          };
          getAllReq.onerror = (): void => reject(getAllReq.error);
        }),
    );
  }

  /** 审计日志读取（replay 数据源；按写入顺序） */
  async readAuditLog(): Promise<Array<{ u: Uint8Array; t: number }>> {
    if (!this.db) return [];
    const tx = this.db.transaction(STORE_ALL, 'readonly');
    const rows = (await reqToPromise(tx.objectStore(STORE_ALL).getAll())) as IAuditEntry[];
    return rows.map((r) => ({ u: new Uint8Array(r.u), t: r.t }));
  }

  override dispose(): void {
    void import('./compactWorker').then((m) => m.terminateCompactWorker()).catch(() => {});
    if (this.compactTimer) {
      clearTimeout(this.compactTimer);
      this.compactTimer = null;
    }
    // 冲刷写缓冲后关库（IDB 异步——事务先创建、关库延迟到事务完成）；
    // 无缓冲则直接关。pagehide/visibilitychange 的冲刷监听在 attach 注册
    const pending = this.writeQueue.dispose();
    void pending.finally(() => {
      this.db?.close();
      this.db = null;
      this.doc = null;
    });
    super.dispose();
  }
}
