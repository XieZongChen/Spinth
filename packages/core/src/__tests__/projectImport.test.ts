// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AssetStore } from '../platform/dataEngine/assetStore';
import { DbProvider, createDocFromSnapshot } from '../platform/dataEngine/dbProvider';
import { hashProjectBytes } from '../platform/projectFile/projectManifest';
import { importProject } from '../platform/projectFile/projectImport';
import { ProjectFileError } from '../platform/projectFile/projectFileError';
import type { IProjectImportDeps } from '../platform/projectFile/projectImport';
import { buildProject, listDocDbs, rezipFixture, widgetMap } from './helpers/projectFileFixtures';

/** 导入编排（docs/20 §7）：校验全部通过前零写入；失败不触碰当前状态 */

let seq = 0;
const nextDocId = (): string =>
  `imp${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function makeDeps(overrides: Partial<IProjectImportDeps> = {}): IProjectImportDeps {
  return {
    assetStore: new AssetStore(),
    createDoc: createDocFromSnapshot,
    randomDocId: nextDocId,
    ...overrides,
  };
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

describe('importProject', () => {
  it('合法导入：写被引用资产 + 新文档可 attach 恢复；stats/sourceDocId 正确', async () => {
    const built = await buildProject({
      docId: 'src-doc-1',
      widgets: [widgetMap('SHAPE'), widgetMap('TEXT'), widgetMap('STICKY')],
      assetCount: 2,
    });
    const deps = makeDeps();
    // 先把构建期写入的资产清出库，验证导入确实写入
    for (const ref of built.assetRefs) await deps.assetStore.delete(ref.id);
    expect(await deps.assetStore.listIds()).toHaveLength(0);

    const result = await importProject(deps, built.blob);
    expect(result.sourceDocId).toBe('src-doc-1');
    expect(result.stats.widgets).toBe(5); // 3 控件 + 2 图片
    expect(result.stats.assetCount).toBe(2);
    expect(result.warnings).toEqual([]);
    expect((await listDocDbs()).includes(`spinth-doc:${result.docId}`)).toBe(true);

    // 资产可读回且字节一致
    for (const [i, ref] of built.assetRefs.entries()) {
      const blob = await deps.assetStore.get(ref.id);
      expect(blob).not.toBeNull();
      expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([...built.assetBytesList[i]!]);
    }

    // 新文档按启动链路恢复：内容一致、IMAGE src 仍是 spinth-asset: 引用
    const reopened = new Y.Doc({ guid: result.docId });
    const provider = new DbProvider();
    await provider.attach(result.docId, reopened);
    const widgets = reopened.getArray('widgets');
    expect(widgets.length).toBe(5);
    const srcs = widgets
      .toArray()
      .filter((w) => (w as Y.Map<unknown>).get('type') === 'IMAGE')
      .map((w) => (w as Y.Map<unknown>).get('src') as string);
    expect(srcs.every((s) => s.startsWith('spinth-asset:'))).toBe(true);
    provider.dispose();
    built.store.close();
    deps.assetStore.close();
  });

  it('重复导入同一文件：两个不同 docId；资产内容寻址不重复', async () => {
    const built = await buildProject({
      docId: 'src-doc-2',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const deps = makeDeps();
    const r1 = await importProject(deps, built.blob);
    const r2 = await importProject(deps, built.blob);
    expect(r1.docId).not.toBe(r2.docId);
    const ids = await deps.assetStore.listIds();
    expect(ids.filter((x) => x === built.assetRefs[0]!.id)).toHaveLength(1);
    deps.assetStore.close();
    built.store.close();
  });

  it('版本过新 → PROJECT_VERSION_UNSUPPORTED；零写入', async () => {
    const built = await buildProject({ docId: 'v-doc', widgets: [widgetMap('SHAPE')] });
    const tampered = await rezipFixture(built.blob, ({ manifest }) => {
      manifest.version = 2;
    });
    const deps = makeDeps();
    const dbsBefore = await listDocDbs();
    const idsBefore = await deps.assetStore.listIds();
    await expectCode(importProject(deps, tampered), 'PROJECT_VERSION_UNSUPPORTED');
    expect(await listDocDbs()).toEqual(dbsBefore);
    expect(await deps.assetStore.listIds()).toEqual(idsBefore);
    deps.assetStore.close();
    built.store.close();
  });

  it('manifest 声明的资产缺失于压缩包 → PROJECT_ASSET_MISSING；零写入', async () => {
    const built = await buildProject({
      docId: 'miss-doc',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const tampered = await rezipFixture(built.blob, ({ entries }) => {
      delete entries[`assets/${built.assetRefs[0]!.id}`];
    });
    const deps = makeDeps();
    const before = await listDocDbs();
    const err = await expectCode(importProject(deps, tampered), 'PROJECT_ASSET_MISSING');
    expect(err.details?.assets).toEqual([built.assetRefs[0]!.id]);
    expect(await listDocDbs()).toEqual(before); // 零新库
    deps.assetStore.close();
    built.store.close();
  });

  it('资产字节被篡改（哈希不符）→ PROJECT_ASSET_INVALID；零写入', async () => {
    const built = await buildProject({
      docId: 'hash-doc',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const tampered = await rezipFixture(built.blob, ({ entries }) => {
      const bytes = entries[`assets/${built.assetRefs[0]!.id}`]!;
      bytes[0] = bytes[0]! ^ 0xff;
    });
    const deps = makeDeps();
    const before = await listDocDbs();
    await expectCode(importProject(deps, tampered), 'PROJECT_ASSET_INVALID');
    expect(await listDocDbs()).toEqual(before);
    deps.assetStore.close();
    built.store.close();
  });

  it('document.yjs 损坏 → PROJECT_DOCUMENT_INVALID；零写入', async () => {
    const built = await buildProject({ docId: 'bad-doc', widgets: [widgetMap('SHAPE')] });
    const garbage = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3]);
    const garbageSha = await hashProjectBytes(garbage);
    const tampered = await rezipFixture(built.blob, ({ manifest, entries }) => {
      entries['document.yjs'] = garbage;
      const docField = manifest.document as Record<string, unknown>;
      docField.bytes = garbage.length;
      docField.sha256 = garbageSha; // manifest 与包一致——让失败恰好落在 apply 环节
    });
    const deps = makeDeps();
    const before = await listDocDbs();
    await expectCode(importProject(deps, tampered), 'PROJECT_DOCUMENT_INVALID');
    expect(await listDocDbs()).toEqual(before);
    deps.assetStore.close();
    built.store.close();
  });

  it('压缩包超限 → PROJECT_ARCHIVE_LIMIT', async () => {
    const built = await buildProject({ docId: 'limit-doc', widgets: [widgetMap('SHAPE')] });
    const deps = makeDeps({ limits: { archiveBytes: 8 } });
    await expectCode(importProject(deps, built.blob), 'PROJECT_ARCHIVE_LIMIT');
    deps.assetStore.close();
    built.store.close();
  });

  it('文档引用的资产不在 manifest → PROJECT_ASSET_MISSING（引用侧判定）', async () => {
    const built = await buildProject({
      docId: 'ref-doc',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const tampered = await rezipFixture(built.blob, ({ manifest }) => {
      manifest.assets = [];
    });
    const deps = makeDeps();
    const err = await expectCode(importProject(deps, tampered), 'PROJECT_ASSET_MISSING');
    expect(err.details?.assets).toEqual([built.assetRefs[0]!.id]);
    deps.assetStore.close();
    built.store.close();
  });

  it('manifest 中未被引用的资产：warning 且不写入', async () => {
    const built = await buildProject({
      docId: 'unref-doc',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const extraBytes = new Uint8Array([7, 7, 7]);
    const extraHash = await hashProjectBytes(extraBytes);
    const tampered = await rezipFixture(built.blob, ({ manifest, entries }) => {
      entries[`assets/${extraHash}`] = extraBytes;
      (manifest.assets as Array<Record<string, unknown>>).push({
        id: extraHash,
        path: `assets/${extraHash}`,
        mime: 'image/png',
        size: 3,
      });
    });
    const deps = makeDeps();
    await deps.assetStore.delete(built.assetRefs[0]!.id); // 引用资产需重写以验证 selective write
    const result = await importProject(deps, tampered);
    const codes = result.warnings.map((w) => w.code);
    expect(codes).toContain('UNREFERENCED_ASSETS_IGNORED');
    const ids = await deps.assetStore.listIds();
    expect(ids).toContain(built.assetRefs[0]!.id); // 被引用的写入
    expect(ids).not.toContain(extraHash); // 未引用的不写
    deps.assetStore.close();
    built.store.close();
  });

  it('未知 ZIP 条目 → warning 计数', async () => {
    const built = await buildProject({ docId: 'unk-doc', widgets: [widgetMap('SHAPE')] });
    const tampered = await rezipFixture(built.blob, ({ entries }) => {
      entries['readme.txt'] = new TextEncoder().encode('hello');
    });
    const deps = makeDeps();
    const result = await importProject(deps, tampered);
    const warning = result.warnings.find((w) => w.code === 'UNKNOWN_ARCHIVE_ENTRIES_IGNORED');
    expect(warning?.count).toBe(1);
    deps.assetStore.close();
    built.store.close();
  });

  it('DOC_EXISTS 换 id 重试；连续撞 id → PROJECT_DOC_ID_COLLISION', async () => {
    const built = await buildProject({ docId: 'coll-doc', widgets: [widgetMap('SHAPE')] });
    await createDocFromSnapshot('occupied1', Y.encodeStateAsUpdate(new Y.Doc()));

    const ids = ['occupied1', 'free1'];
    let i = 0;
    const deps = makeDeps({ randomDocId: () => ids[i++]! });
    const result = await importProject(deps, built.blob);
    expect(result.docId).toBe('free1');

    const alwaysTaken = makeDeps({ randomDocId: () => 'occupied1' });
    await expectCode(importProject(alwaysTaken, built.blob), 'PROJECT_DOC_ID_COLLISION');
    deps.assetStore.close();
    alwaysTaken.assetStore.close();
    built.store.close();
  });

  it('createDoc 非 DOC_EXISTS 失败 → PROJECT_STORAGE_WRITE_FAILED(phase=document)', async () => {
    const built = await buildProject({ docId: 'wfail-doc', widgets: [widgetMap('SHAPE')] });
    const deps = makeDeps({
      createDoc: async () => {
        throw new Error('QuotaExceeded');
      },
    });
    const err = await expectCode(importProject(deps, built.blob), 'PROJECT_STORAGE_WRITE_FAILED');
    expect(err.details?.phase).toBe('document');
    deps.assetStore.close();
    built.store.close();
  });

  it('资产写入失败 → PROJECT_STORAGE_WRITE_FAILED(phase=assets)', async () => {
    const built = await buildProject({
      docId: 'afail-doc',
      widgets: [widgetMap('SHAPE')],
      assetCount: 1,
    });
    const deps = makeDeps({
      assetStore: {
        put: async () => {
          throw new Error('disk full');
        },
      } as unknown as AssetStore,
    });
    const before = await listDocDbs();
    const err = await expectCode(importProject(deps, built.blob), 'PROJECT_STORAGE_WRITE_FAILED');
    expect(err.details?.phase).toBe('assets');
    expect(await listDocDbs()).toEqual(before); // 文档未写
    built.store.close();
  });

  it('abort → PROJECT_ABORTED', async () => {
    const built = await buildProject({ docId: 'abort-doc', widgets: [widgetMap('SHAPE')] });
    const controller = new AbortController();
    controller.abort();
    const deps = makeDeps();
    await expectCode(
      importProject(deps, built.blob, { signal: controller.signal }),
      'PROJECT_ABORTED',
    );
    deps.assetStore.close();
    built.store.close();
  });
});
