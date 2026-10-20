import * as Y from 'yjs';

/**
 * compaction worker（Batch 2，2026-10-18）：把 compact() 的 CPU 大头
 * （applyUpdate ×N + encodeStateAsUpdate 全量快照编码——大文档含 data URL
 * 图片可达数 MB）移出主线程。IDB 事务不能跨 Worker 往返保活，主侧改乐观
 * 双事务（dbProvider.compact 的 U'≡U 校验），本文件只做纯计算。
 *
 * computeSnapshot 独立导出为纯函数——jsdom（无 Worker）单测可直接调用比对。
 */

/** 纯计算：盘上增量列表 → 全量快照（fresh doc，不触碰任何共享状态） */
export function computeSnapshot(updates: Array<Uint8Array | ArrayBuffer>): Uint8Array {
  const doc = new Y.Doc();
  for (const u of updates) {
    Y.applyUpdate(doc, new Uint8Array(u));
  }
  return Y.encodeStateAsUpdate(doc);
}

// ---------------------------------------------------------------------------
// Worker 协议（同源 module worker——CSP 由 script-src 'self' 覆盖，CSP3
// worker-src 回退规则；无 Worker 环境（jsdom/SSR）主侧不 import 本段胶水）
// -----------------------------------------------------------------------------

export interface ICompactRequest {
  id: number;
  updates: Array<Uint8Array | ArrayBuffer>;
}

export interface ICompactReply {
  id: number;
  snapshot?: Uint8Array;
  error?: string;
}

let nextReqId = 1;
let worker: Worker | null = null;
const pendingReplies = new Map<
  number,
  { resolve: (s: Uint8Array) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./compactWorker', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<ICompactReply>) => {
      const reply = ev.data;
      const p = pendingReplies.get(reply.id);
      if (!p) return;
      pendingReplies.delete(reply.id);
      if (reply.error) p.reject(new Error(reply.error));
      else if (reply.snapshot) p.resolve(reply.snapshot);
      else p.reject(new Error('compactWorker: 空回复'));
    };
    worker.onerror = (ev) => {
      // worker 崩溃（第三轮审查修复）：在途全拒 + terminate 坏实例置 null——
      // 曾留着崩溃实例，后续 postMessage 无回复且无超时 → compacting 永久卡死
      const err = new Error(
        `compactWorker: ${String((ev as ErrorEvent).message ?? 'worker error')}`,
      );
      for (const [, p] of pendingReplies) p.reject(err);
      pendingReplies.clear();
      worker?.terminate();
      worker = null; // 下次 ensureWorker 重建新实例
    };
  }
  return worker;
}

/** 请求 id 单调配对（测试可复位） */
export function __resetReqIdForTest(): void {
  nextReqId = 1;
}

/** worker 计算入口（无 Worker 环境抛错——主侧捕获后退同步路径）。
 *  30s 超时（第三轮审查修复）：worker 无响应（崩溃后复用坏实例等场景）不再
 *  永挂——超时拒 → 主侧退同步路径，compacting 锁可释放 */
const COMPUTE_TIMEOUT_MS = 30_000;

export async function computeSnapshotInWorker(
  updates: Array<Uint8Array | ArrayBuffer>,
): Promise<Uint8Array> {
  const w = ensureWorker();
  const id = nextReqId++;
  return new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReplies.delete(id);
      reject(new Error('compactWorker: 计算超时（30s）'));
    }, COMPUTE_TIMEOUT_MS);
    pendingReplies.set(id, {
      resolve: (s) => {
        clearTimeout(timer);
        resolve(s);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    try {
      const req: ICompactRequest = { id, updates: updates.map((u) => new Uint8Array(u)) };
      w.postMessage(
        req,
        req.updates.map((u) => (u as Uint8Array).buffer as ArrayBuffer),
      );
    } catch (err) {
      clearTimeout(timer);
      pendingReplies.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 进程内测试注入用：终止 worker（dispose 路径同用）。在途请求显式拒绝
 *  （曾只 clear 不 reject——等待方永挂） */
export function terminateCompactWorker(): void {
  worker?.terminate();
  worker = null;
  for (const [, p] of pendingReplies) p.reject(new Error('compactWorker: terminated'));
  pendingReplies.clear();
}

// worker 侧入口（真 Worker 环境执行；主线程 import 本模块时 self 不是 WorkerGlobalScope，
// 需守卫——用 typeof 判定 DedicatedWorkerGlobalScope 特征 message 监听）
declare const self: {
  onmessage: ((ev: MessageEvent<ICompactRequest>) => void) | null;
  postMessage(msg: ICompactReply, transfer?: Transferable[]): void;
  addEventListener?: (t: 'message', cb: (ev: MessageEvent<ICompactRequest>) => void) => void;
};

const isWorkerContext =
  typeof (globalThis as { postMessage?: unknown }).postMessage === 'function' &&
  typeof (globalThis as { importScripts?: unknown }).importScripts === 'function';

if (isWorkerContext) {
  self.onmessage = (ev: MessageEvent<ICompactRequest>) => {
    const { id, updates } = ev.data;
    try {
      const snapshot = computeSnapshot(updates);
      const reply: ICompactReply = { id, snapshot };
      self.postMessage(reply, [snapshot.buffer as ArrayBuffer]);
    } catch (err) {
      const reply: ICompactReply = { id, error: String(err) };
      self.postMessage(reply);
    }
  };
}
