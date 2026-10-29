/** IndexedDB 库/存储层基建：库名前缀、双 store 名、审计条目形状与请求/
 *  开库 promise 化（dbProvider / dbWriteQueue / dbMaintenance 共用单源）。 */

export const DOC_DB_PREFIX = 'spinth-doc:';
export const STORE_UPDATES = 'updates';
export const STORE_ALL = 'allupdates';

export interface IAuditEntry {
  u: Uint8Array;
  t: number;
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

export function openDb(name: string, stores: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = (): void => {
      for (const s of stores) {
        if (!req.result.objectStoreNames.contains(s))
          req.result.createObjectStore(s, { autoIncrement: true });
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}
