// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { writeFileSync } from 'node:fs';
import { AssetStore } from '../platform/dataEngine/assetStore';
import { DbProvider, createDocFromSnapshot } from '../platform/dataEngine/dbProvider';
import { exportProject } from '../platform/projectFile/projectExport';
import { importProject } from '../platform/projectFile/projectImport';
import { ProjectFileService } from '../platform/projectFile/projectFileService';
import { widgetMap } from './helpers/projectFileFixtures';

/**
 * 全链路 round-trip（A3/A4）：
 * 真实 Y.Doc + fake-indexeddb AssetStore —— 导出 → 导入 → attach 恢复，
 * widget 数据与资产字节一致；Yjs 内不出现 base64。
 *
 * 样例文件生成（验收 A18 可复现命令）：
 *   SPINTH_SAMPLE_OUT=./sample.spinth.zip \
 *     pnpm --filter @spinth/core exec vitest run src/__tests__/projectRoundTrip.test.ts
 * 验证：unzip -l 与 manifest 哈希（A18）。
 */

/** 按需把导出产物落盘为验收样例（A18：环境变量驱动，日常测试零副作用） */
function saveSampleIfAsked(blob: Blob, fileName: string): void {
  const out = process.env.SPINTH_SAMPLE_OUT;
  if (!out) return;
  void blob.arrayBuffer().then((buf) => {
    writeFileSync(out, new Uint8Array(buf));
    console.info(`[project-sample] 已写入 ${out}（来自 ${fileName}）`);
  });
}

describe('project round-trip', () => {
  it('SHAPE/TEXT/STICKY/IMAGE/LINE/MIND_MAP 文档：导出→导入→恢复，数据与资产一致', async () => {
    // 1. 源文档：六类 widget + 两张图片资产
    const exportStore = new AssetStore();
    const imgA = await exportStore.put(
      new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }),
    );
    const imgB = await exportStore.put(
      new Blob([new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1])], { type: 'image/jpeg' }),
    );
    const sourceDoc = new Y.Doc({ guid: 'rt-source' });
    const sourceWidgets = sourceDoc.getArray('widgets');
    sourceDoc.transact(() => {
      sourceWidgets.push([
        widgetMap('SHAPE', { shapeType: 'rect' }),
        widgetMap('TEXT', { content: JSON.stringify({ type: 'doc' }) }),
        widgetMap('STICKY', { color: 'yellow' }),
        widgetMap('LINE', { lineType: 'straight' }),
        widgetMap('MIND_MAP', { label: '根节点' }),
        widgetMap('IMAGE', { src: imgA.src }),
        widgetMap('IMAGE', { src: imgB.src }),
      ]);
    });

    // 2. 导出（纯读）
    const exported = await exportProject({
      getDoc: () => ({ yDoc: sourceDoc, yWidgets: sourceWidgets, docId: 'rt-source' }),
      assetStore: exportStore,
      appVersion: '0.3.0',
      now: () => new Date('2026-10-21T08:00:00.000Z'),
    });
    expect(exported.stats.widgets).toBe(7);
    expect(exported.stats.assetCount).toBe(2);
    expect(exported.warnings).toEqual([]);
    saveSampleIfAsked(exported.blob, exported.fileName);

    // 3. 导入为全新环境（干净资产库 + 新文档库）
    const importStore = new AssetStore();
    for (const ref of [imgA, imgB]) await importStore.delete(ref.id);
    let seq = 0;
    const imported = await importProject(
      {
        assetStore: importStore,
        createDoc: createDocFromSnapshot,
        randomDocId: () => `rt${seq++}`,
      },
      exported.blob,
    );
    expect(imported.docId).toBe('rt0');
    expect(imported.stats.widgets).toBe(7);
    expect(imported.stats.assetCount).toBe(2);

    // 4. 启动链路恢复：类型逐件对齐、IMAGE src 均为 spinth-asset: 引用（A4）
    const reopened = new Y.Doc({ guid: imported.docId });
    const provider = new DbProvider();
    await provider.attach(imported.docId, reopened);
    const restored = reopened.getArray('widgets').toArray() as Y.Map<unknown>[];
    expect(restored).toHaveLength(7);
    const typeOf = (m: Y.Map<unknown>): string => m.get('type') as string;
    const expectedTypes = ['SHAPE', 'TEXT', 'STICKY', 'LINE', 'MIND_MAP', 'IMAGE', 'IMAGE'];
    expect(restored.map(typeOf)).toEqual(expectedTypes);
    const srcs = restored
      .filter((m) => m.get('type') === 'IMAGE')
      .map((m) => m.get('src') as string);
    expect(new Set(srcs)).toEqual(new Set([imgA.src, imgB.src]));
    for (const src of srcs) {
      expect(src.startsWith('spinth-asset:')).toBe(true); // 无 base64 回写
      expect(src.startsWith('data:')).toBe(false);
    }
    // 非 IMAGE 字段逐一保留
    expect(restored.find((m) => m.get('type') === 'MIND_MAP')!.get('label')).toBe('根节点');
    expect(restored.find((m) => m.get('type') === 'STICKY')!.get('color')).toBe('yellow');

    // 5. 资产字节与源一致
    const blobA = await importStore.get(imgA.id);
    const blobB = await importStore.get(imgB.id);
    expect([...new Uint8Array(await blobA!.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect([...new Uint8Array(await blobB!.arrayBuffer())]).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);

    provider.dispose();
    importStore.close();
    exportStore.close();
  });

  it('service 视角 round-trip：同 service 连续导出导入互不干扰', async () => {
    const store = new AssetStore();
    const ref = await store.put(new Blob([new Uint8Array([3, 1, 4])], { type: 'image/png' }));
    const doc = new Y.Doc();
    const widgets = doc.getArray('widgets');
    doc.transact(() => widgets.push([widgetMap('IMAGE', { src: ref.src })]));
    const updatesBefore = Y.encodeStateAsUpdate(doc);

    const service = new ProjectFileService({
      getDoc: () => ({ yDoc: doc, yWidgets: widgets, docId: 'rt-svc' }),
      assetStore: store,
      appVersion: '0.3.0',
      createDoc: createDocFromSnapshot,
      randomDocId: () => 'rtsvc1',
    });
    const exported = await service.exportProject();
    const imported = await service.importProject(exported.blob);
    expect(imported.docId).toBe('rtsvc1');

    // 导出/导入全程零 Yjs 写（源文档状态不变）
    expect(Y.encodeStateAsUpdate(doc)).toEqual(updatesBefore);
    service.dispose();
    store.close();
  });
});
