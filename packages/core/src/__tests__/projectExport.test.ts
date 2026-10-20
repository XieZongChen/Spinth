// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AssetStore, assetSrcOf } from '../platform/dataEngine/assetStore';
import { unzipProject } from '../platform/projectFile/projectArchive';
import { exportProject } from '../platform/projectFile/projectExport';
import { ProjectFileError } from '../platform/projectFile/projectFileError';
import { parseProjectManifest } from '../platform/projectFile/projectManifest';
import { DEFAULT_PROJECT_FILE_LIMITS } from '../types/projectFile';

const NOW = new Date('2026-10-21T08:00:00.000Z');
const id = (n: number): string => n.toString(16).padStart(64, '0') as string;

/** 最小 widget Y.Map（导出只关心 type/src；其余字段对快照透明） */
function widget(type: string, extra: Record<string, unknown> = {}): Y.Map<unknown> {
  const m = new Y.Map();
  m.set('id', `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`);
  m.set('type', type);
  for (const [k, v] of Object.entries(extra)) m.set(k, v);
  return m;
}

function makeDoc(
  docId: string,
  items: Y.Map<unknown>[],
): { yDoc: Y.Doc; yWidgets: Y.Array<unknown>; docId: string } {
  const yDoc = new Y.Doc({ guid: docId });
  const yWidgets = yDoc.getArray('widgets');
  if (items.length > 0) yDoc.transact(() => yWidgets.push(items));
  return { yDoc, yWidgets, docId };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<ProjectFileError> {
  try {
    await p;
    expect.unreachable('应当抛错');
    throw new Error('unreachable');
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectFileError);
    expect((err as ProjectFileError).code).toBe(code);
    return err as ProjectFileError;
  }
}

describe('exportProject', () => {
  it('shape/text/image 文档：manifest 正确、资产字节原样入包、stats 一致', async () => {
    const store = new AssetStore();
    const ref = await store.put(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    const doc = makeDoc('a1b2c3d4', [
      widget('SHAPE'),
      widget('TEXT'),
      widget('IMAGE', { src: ref.src }),
    ]);
    const updates: number[] = [];
    doc.yDoc.on('update', () => updates.push(1));

    const result = await exportProject({
      getDoc: () => doc,
      assetStore: store,
      appVersion: '0.3.0',
      now: () => NOW,
    });

    // manifest 可回读且哈希/字节数与文档一致
    const manifest = parseProjectManifest(
      new TextDecoder().decode(
        (
          await unzipProject(new Uint8Array(await result.blob.arrayBuffer()), {
            ...DEFAULT_PROJECT_FILE_LIMITS,
          })
        ).manifestBytes!,
      ),
      { assetCount: 256 },
    );
    expect(manifest.sourceDocId).toBe('a1b2c3d4');
    expect(manifest.document.bytes).toBe(result.stats.documentBytes);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]!.id).toBe(ref.id);
    expect(manifest.assets[0]!.mime).toBe('image/png');
    expect(manifest.assets[0]!.size).toBe(4);

    // 包内资产字节 = 库内原始字节
    const unzipped = await unzipProject(new Uint8Array(await result.blob.arrayBuffer()), {
      ...DEFAULT_PROJECT_FILE_LIMITS,
    });
    expect([...unzipped.assets.get(ref.id)!]).toEqual([1, 2, 3, 4]);

    expect(result.stats.widgets).toBe(3);
    expect(result.stats.assetCount).toBe(1);
    expect(result.stats.assetBytes).toBe(4);
    expect(result.stats.archiveBytes).toBe(result.blob.size);
    expect(result.warnings).toEqual([]);
    expect(result.fileName).toBe('spinth-a1b2c3d4-20261021-080000.spinth.zip');

    // 导出是纯读：不产生任何 Yjs update
    expect(updates).toEqual([]);
    store.close();
  });

  it('空画布可导出：assets=[]，EMPTY_PROJECT warning', async () => {
    const store = new AssetStore();
    const doc = makeDoc('empty-doc', []);
    const result = await exportProject({
      getDoc: () => doc,
      assetStore: store,
      appVersion: '0.3.0',
      now: () => NOW,
    });
    expect(result.manifest.assets).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(['EMPTY_PROJECT']);
    store.close();
  });

  it('data:/http(s): 图片不打包，产生对应 warning', async () => {
    const store = new AssetStore();
    const doc = makeDoc('mixed', [
      widget('IMAGE', { src: 'data:image/png;base64,AAAA' }),
      widget('IMAGE', { src: 'https://example.com/a.png' }),
      widget('IMAGE', { src: 'http://example.com/b.png' }),
    ]);
    const result = await exportProject({
      getDoc: () => doc,
      assetStore: store,
      appVersion: '0.3.0',
      now: () => NOW,
    });
    expect(result.manifest.assets).toEqual([]);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('DATA_URL_IMAGES_INCLUDED');
    expect(codes).toContain('EXTERNAL_IMAGES_SKIPPED');
    expect(codes).not.toContain('EMPTY_PROJECT'); // 有 widget
    store.close();
  });

  it('docId 文件名安全化：非 [A-Za-z0-9_-] 剔除、截断 32、空回退 doc', async () => {
    const store = new AssetStore();
    const weird = '../../中文路径!@#' + 'x'.repeat(40);
    const result = await exportProject({
      getDoc: () => makeDoc(weird, []),
      assetStore: store,
      appVersion: '0.3.0',
      now: () => NOW,
    });
    // manifest 保留原始 sourceDocId（§4.1）
    expect(result.manifest.sourceDocId).toBe(weird);
    expect(result.fileName).toMatch(/^spinth-x{32}-20261021-080000\.spinth\.zip$/);
    const allUnsafe = await exportProject({
      getDoc: () => makeDoc('///***', []),
      assetStore: store,
      appVersion: '0.3.0',
      now: () => NOW,
    });
    expect(allUnsafe.fileName).toMatch(/^spinth-doc-/);
    store.close();
  });

  it('getDoc 为 null → PROJECT_NOT_READY', async () => {
    await expectCode(
      exportProject({ getDoc: () => null, assetStore: new AssetStore(), appVersion: '0.3.0' }),
      'PROJECT_NOT_READY',
    );
  });

  it('被引用资产缺失 → PROJECT_ASSET_MISSING（details 列出 id）', async () => {
    const store = new AssetStore();
    const missingId = id(42);
    const doc = makeDoc('d', [widget('IMAGE', { src: assetSrcOf(missingId) })]);
    const err = await expectCode(
      exportProject({ getDoc: () => doc, assetStore: store, appVersion: '0.3.0' }),
      'PROJECT_ASSET_MISSING',
    );
    expect(err.details?.assets).toEqual([missingId]);
    store.close();
  });

  it('资产内容与 id 哈希不符 → PROJECT_ASSET_INVALID', async () => {
    // 内容寻址正常路径 id 恒等于哈希——用假 store 模拟库内数据损坏
    const lyingStore = {
      get: async () => new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }),
    };
    const doc = makeDoc('d', [widget('IMAGE', { src: assetSrcOf(id(1)) })]);
    const err = await expectCode(
      exportProject({
        getDoc: () => doc,
        assetStore: lyingStore,
        appVersion: '0.3.0',
      }),
      'PROJECT_ASSET_INVALID',
    );
    expect(err.details?.assets).toEqual([id(1)]);
  });

  it('限额注入：单资产/资产总数/资产条目数/文档超限 fail-fast', async () => {
    const store = new AssetStore();
    const ref = await store.put(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
    const doc = makeDoc('d', [widget('IMAGE', { src: ref.src })]);
    const base = { getDoc: () => doc, assetStore: store, appVersion: '0.3.0' };

    await expectCode(exportProject({ ...base, limits: { assetBytes: 2 } }), 'PROJECT_ASSET_LIMIT');
    await expectCode(exportProject({ ...base, limits: { assetCount: 0 } }), 'PROJECT_ASSET_LIMIT');
    await expectCode(
      exportProject({ ...base, limits: { totalAssetBytes: 2 } }),
      'PROJECT_ARCHIVE_LIMIT',
    );
    const bigDoc = makeDoc('big', [widget('SHAPE')]);
    await expectCode(
      exportProject({
        getDoc: () => bigDoc,
        assetStore: store,
        appVersion: '0.3.0',
        limits: { documentBytes: 2 },
      }),
      'PROJECT_DOCUMENT_LIMIT',
    );
    store.close();
  });

  it('abort：开始前与资产循环中都 → PROJECT_ABORTED', async () => {
    const store = new AssetStore();
    const ref1 = await store.put(new Blob([new Uint8Array([1])], { type: 'image/png' }));
    const ref2 = await store.put(new Blob([new Uint8Array([2])], { type: 'image/png' }));
    const doc = makeDoc('d', [
      widget('IMAGE', { src: ref1.src }),
      widget('IMAGE', { src: ref2.src }),
    ]);

    const controller = new AbortController();
    controller.abort();
    await expectCode(
      exportProject(
        { getDoc: () => doc, assetStore: store, appVersion: '0.3.0' },
        { signal: controller.signal },
      ),
      'PROJECT_ABORTED',
    );

    // 首个资产读取完成后中断：第二个循环迭代抛 PROJECT_ABORTED
    const controller2 = new AbortController();
    const slowStore = {
      get: async (aid: string) => {
        const blob = await store.get(aid);
        controller2.abort();
        return blob;
      },
    };
    await expectCode(
      exportProject(
        { getDoc: () => doc, assetStore: slowStore, appVersion: '0.3.0' },
        { signal: controller2.signal },
      ),
      'PROJECT_ABORTED',
    );
    store.close();
  });
});
