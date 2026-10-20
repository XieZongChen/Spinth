/**
 * 项目文件测试夹具（docs/20 §13）：构建合法/篡改的 .spinth.zip。
 * 测试文件自行负责 `import 'fake-indexeddb/auto'`（本助手不开环境）。
 */

import * as Y from 'yjs';
import { zipSync } from 'fflate';
import { AssetStore, type IAssetRef } from '../../platform/dataEngine/assetStore';
import { exportProject } from '../../platform/projectFile/projectExport';
import { DEFAULT_PROJECT_FILE_LIMITS } from '../../types/projectFile';

const id64 = (n: number): string => n.toString(16).padStart(64, '0') as string;

export function widgetMap(type: string, extra: Record<string, unknown> = {}): Y.Map<unknown> {
  const m = new Y.Map();
  m.set('id', `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 10)}`);
  m.set('type', type);
  m.set('zOrder', Math.random().toString(36).slice(2, 8));
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
}

export interface IBuiltProject {
  blob: Blob;
  docId: string;
  assetRefs: IAssetRef[];
  assetBytesList: Uint8Array[];
  store: AssetStore;
}

/** 真实链路构建合法项目文件：Y.Doc + AssetStore + exportProject */
export async function buildProject(opts: {
  docId: string;
  widgets: Y.Map<unknown>[];
  assetCount?: number;
}): Promise<IBuiltProject> {
  const store = new AssetStore();
  const assetRefs: IAssetRef[] = [];
  const assetBytesList: Uint8Array[] = [];
  for (let i = 0; i < (opts.assetCount ?? 0); i++) {
    const bytes = new Uint8Array(8 + i * 3).fill(0x40 + i);
    const ref = await store.put(new Blob([bytes], { type: 'image/png' }));
    assetRefs.push(ref);
    assetBytesList.push(bytes);
    const img = widgetMap('IMAGE', { src: ref.src });
    opts.widgets.push(img);
  }
  const yDoc = new Y.Doc({ guid: opts.docId });
  const yWidgets = yDoc.getArray('widgets');
  if (opts.widgets.length > 0) yDoc.transact(() => yWidgets.push(opts.widgets));
  const result = await exportProject({
    getDoc: () => ({ yDoc, yWidgets, docId: opts.docId }),
    assetStore: store,
    appVersion: '0.3.0',
    now: () => new Date('2026-10-21T08:00:00.000Z'),
  });
  return { blob: result.blob, docId: opts.docId, assetRefs, assetBytesList, store };
}

export interface IZipContents {
  manifestJson: string;
  documentBytes: Uint8Array;
  assets: Map<string, Uint8Array>;
}

/** 解开项目 blob（测试视角：manifest 可读、条目全量） */
export async function unzipFixture(blob: Blob): Promise<IZipContents> {
  const { unzip } = await import('fflate');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err || !data) {
        reject(err ?? new Error('unzip failed'));
        return;
      }
      const assets = new Map<string, Uint8Array>();
      for (const [name, content] of Object.entries(data)) {
        if (name.startsWith('assets/')) assets.set(name.slice('assets/'.length), content);
      }
      resolve({
        manifestJson: new TextDecoder().decode(data['manifest.json']!),
        documentBytes: data['document.yjs']!,
        assets,
      });
    });
  });
}

/** 以 fixture 为底改包重制（篡改 manifest / 换资产字节 / 增删条目） */
export async function rezipFixture(
  blob: Blob,
  mutate: (contents: {
    manifest: Record<string, unknown>;
    entries: Record<string, Uint8Array>;
  }) => void,
): Promise<Blob> {
  const contents = await unzipFixture(blob);
  const manifest = JSON.parse(contents.manifestJson) as Record<string, unknown>;
  const entries: Record<string, Uint8Array> = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'),
    'document.yjs': contents.documentBytes,
  };
  for (const [id, bytes] of contents.assets) entries[`assets/${id}`] = bytes;
  mutate({ manifest, entries });
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

/** 当前已存在的 spinth-doc:* 库名（fake-indexeddb 支持 databases()） */
export async function listDocDbs(): Promise<string[]> {
  const factory = (indexedDB as unknown as { databases?: () => Promise<Array<{ name?: string }>> })
    .databases;
  if (typeof factory !== 'function') return [];
  const list = await factory.call(indexedDB);
  return list.map((d) => d.name ?? '').filter((n) => n.startsWith('spinth-doc:'));
}

export { id64, DEFAULT_PROJECT_FILE_LIMITS };
