/** 图片资产引用前缀（Batch 2 资产服务首版）：
 *  `src = 'spinth-asset:<sha256-hex>'` 指向本地 AssetStore（IndexedDB 独立库），
 *  区别于 data:/http(s):/blob: 前缀——渲染层（imageVm）按此前缀分流解析。
 *  schema 不动（src 仍是 string）：旧文档 data URL 照常渲染，零迁移 */
export const ASSET_SRC_PREFIX = 'spinth-asset:';

export function isAssetSrc(src: string): boolean {
  return src.startsWith(ASSET_SRC_PREFIX);
}

export function assetIdOf(src: string): string {
  return src.slice(ASSET_SRC_PREFIX.length);
}

export function assetSrcOf(id: string): string {
  return ASSET_SRC_PREFIX + id;
}

/** 存 ArrayBuffer + mime 而非 Blob——fake-indexeddb/jsdom 的结构化克隆不保
 *  Blob 身份（实测读回是 plain object）；读侧重建 Blob（构造是幂等廉价包装） */
interface IAssetRow {
  buf: ArrayBuffer;
  mime: string;
  size: number;
  t: number;
}

export interface IAssetRef {
  id: string;
  src: string;
  mime: string;
  size: number;
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('spinth-assets', 1);
    req.onupgradeneeded = (): void => {
      if (!req.result.objectStoreNames.contains('assets')) {
        req.result.createObjectStore('assets'); // key = sha256 hex
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

/** SHA-256 十六进制（内容寻址与项目文件哈希共用；§11.3 由 crypto.subtle 提供） */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 图片资产层（Batch 2 资产服务首版，2026-10-18）：IndexedDB 独立库
 * `spinth-assets` 存 Blob，key = 内容 sha256——**文档只存 `spinth-asset:<hash>`
 * 引用**，data URL 不再进 Yjs（同步帧/compaction 快照/持久化体积从 MB 级塌缩
 * 到几十字节）；同图贴 N 次盘上一份（内容寻址去重）。
 *
 * 单机模式闭环：贴图端 put 落库，渲染端 get + objectURL。
 * 协同同设备多标签：写入端 put 时双端 IndexedDB 同库（同源）——引用天然命中。
 * 挂账二期：server HTTP 资产端点（跨设备）、资产 GC（按 widgets 引用计数）。
 */
export class AssetStore {
  private db: IDBDatabase | null = null;
  private objectUrls = new Map<string, string>();
  private objectUrlRefs = new Map<string, number>();
  /** 首载在途 Promise（并发 objectURL 去重） */
  private inflightUrls = new Map<string, Promise<string | null>>();

  async open(): Promise<void> {
    if (!this.db) this.db = await openAssetDb();
  }

  /** 入库（内容寻址去重）：返回引用（id/src 用于入 Yjs 的 src 字段）。
   *  单次 arrayBuffer（第三轮审查：digest 与存行曾各读一次——5MB 图双拷贝） */
  async put(blob: Blob): Promise<IAssetRef> {
    await this.open();
    const buf = await blob.arrayBuffer();
    const id = await sha256Hex(buf);
    const db = this.db!;
    const existing = await new Promise<IAssetRow | undefined>((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').get(id);
      req.onsuccess = (): void => resolve(req.result as IAssetRow | undefined);
      req.onerror = (): void => reject(req.error);
    });
    if (!existing) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite');
        const row: IAssetRow = { buf, mime: blob.type, size: blob.size, t: Date.now() };
        tx.objectStore('assets').put(row, id);
        tx.oncomplete = (): void => resolve();
        tx.onerror = (): void => reject(tx.error);
      });
    }
    return { id, src: assetSrcOf(id), mime: blob.type, size: blob.size };
  }

  /** 取 blob（miss = null——调用方占位兜底，同 data URL 加载失败路径） */
  async get(id: string): Promise<Blob | null> {
    await this.open();
    const db = this.db!;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').get(id);
      // result 读取必须在 onsuccess 回调内（结构化克隆完成点）
      req.onsuccess = (): void => {
        const row = req.result as IAssetRow | undefined;
        resolve(row ? new Blob([row.buf], { type: row.mime || 'image/png' }) : null);
      };
      req.onerror = (): void => reject(req.error);
    });
  }

  /** blob → objectURL（引用计数，release 归零 revoke）——ImageVm 解码用；
   *  in-flight 去重（P0 修复）：并发首载共用同一取 URL Promise——否则各建
   *  各的 URL 而 Map 只留一个，泄漏的 URL 永不 revoke 且计数错位 */
  async objectURL(id: string): Promise<string | null> {
    const cached = this.objectUrls.get(id);
    if (cached) {
      this.objectUrlRefs.set(id, (this.objectUrlRefs.get(id) ?? 0) + 1);
      return cached;
    }
    const inflight = this.inflightUrls.get(id);
    if (inflight) {
      const url = await inflight;
      if (url) this.objectUrlRefs.set(id, (this.objectUrlRefs.get(id) ?? 0) + 1);
      return url;
    }
    const p = (async (): Promise<string | null> => {
      const blob = await this.get(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      this.objectUrls.set(id, url);
      return url;
    })();
    this.inflightUrls.set(id, p);
    try {
      const url = await p;
      if (url) this.objectUrlRefs.set(id, (this.objectUrlRefs.get(id) ?? 0) + 1);
      return url;
    } finally {
      this.inflightUrls.delete(id);
    }
  }

  releaseObjectURL(id: string): void {
    const refs = this.objectUrlRefs.get(id) ?? 0;
    if (refs <= 1) {
      const url = this.objectUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.objectUrls.delete(id);
      this.objectUrlRefs.delete(id);
    } else {
      this.objectUrlRefs.set(id, refs - 1);
    }
  }

  /** 全量 id 清单（GC 差集的「全量」侧） */
  async listIds(): Promise<string[]> {
    await this.open();
    const db = this.db!;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').getAllKeys();
      req.onsuccess = (): void => resolve(req.result as string[]);
      req.onerror = (): void => reject(req.error);
    });
  }

  /** 行数（调试/E2E 探针） */
  async count(): Promise<number> {
    const ids = await this.listIds();
    return ids.length;
  }

  /** 删除单行。objectURL 引用计数 >0（正在渲染）时跳过返回 false——GC 的
   *  防误删活引用闸：调用方下轮 GC 会再见到它 */
  async delete(id: string): Promise<boolean> {
    await this.open();
    if ((this.objectUrlRefs.get(id) ?? 0) > 0) return false;
    const db = this.db!;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').delete(id);
      tx.oncomplete = (): void => resolve();
      tx.onerror = (): void => reject(tx.error);
    });
    return true;
  }

  /** 孤儿宽限删除（GC 专用）：只删 t < beforeEpoch 的行——「本会话/其他标签
   *  刚 put、文档引用尚未落盘」的统一兜底窗口（第三轮审查：跨标签误删）。
   *  行不存在视为已删返回 true（幂等） */
  async deleteIfOlderThan(id: string, beforeEpoch: number): Promise<boolean> {
    await this.open();
    const db = this.db!;
    const row = await new Promise<IAssetRow | undefined>((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const req = tx.objectStore('assets').get(id);
      req.onsuccess = (): void => resolve(req.result as IAssetRow | undefined);
      req.onerror = (): void => reject(req.error);
    });
    if (!row) return true;
    if (row.t >= beforeEpoch) return false; // 基线之后新 put——下轮再看
    return this.delete(id);
  }

  close(): void {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.objectUrlRefs.clear();
    this.inflightUrls.clear();
    this.db?.close();
    this.db = null;
  }
}
