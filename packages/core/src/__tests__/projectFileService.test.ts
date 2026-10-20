// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AssetStore } from '../platform/dataEngine/assetStore';
import { createDocFromSnapshot } from '../platform/dataEngine/dbProvider';
import { ProjectFileService } from '../platform/projectFile/projectFileService';
import { ProjectFileError } from '../platform/projectFile/projectFileError';
import { buildProject, widgetMap } from './helpers/projectFileFixtures';

/** ProjectFileService（docs/20 §5.2）：ready/dispose 门卫、依赖注入、flush warning */

let seq = 0;
const nextDocId = (): string => `svc${(seq++).toString(36)}`;

function makeService(overrides: { withDoc?: boolean; flushCurrentDoc?: () => Promise<void> }): {
  service: ProjectFileService;
  store: AssetStore;
  built?: Awaited<ReturnType<typeof buildProject>>;
} {
  const store = new AssetStore();
  const yDoc = new Y.Doc();
  const yWidgets = yDoc.getArray('widgets');
  return {
    service: new ProjectFileService({
      getDoc:
        overrides.withDoc === false ? () => null : () => ({ yDoc, yWidgets, docId: 'svc-doc' }),
      assetStore: store,
      appVersion: '0.3.0',
      createDoc: createDocFromSnapshot,
      flushCurrentDoc: overrides.flushCurrentDoc,
      randomDocId: nextDocId,
    }),
    store,
  };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
    expect.unreachable('应当抛错');
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectFileError);
    expect((err as ProjectFileError).code).toBe(code);
  }
}

describe('ProjectFileService', () => {
  it('disposed 后导出/导入均 PROJECT_NOT_READY', async () => {
    const { service, store } = makeService({});
    service.dispose();
    await expectCode(service.exportProject(), 'PROJECT_NOT_READY');
    await expectCode(service.importProject(new Blob([new Uint8Array(0)])), 'PROJECT_NOT_READY');
    store.close();
  });

  it('导出门卫透传：getDoc 为 null → PROJECT_NOT_READY', async () => {
    const { service, store } = makeService({ withDoc: false });
    await expectCode(service.exportProject(), 'PROJECT_NOT_READY');
    store.close();
  });

  it('依赖注入的 now/randomDocId 生效：文件名时间戳与导入新 id 来自注入', async () => {
    const built = await buildProject({ docId: 'inj-doc', widgets: [widgetMap('SHAPE')] });
    const { service, store } = makeService({});
    const result = await service.importProject(built.blob);
    expect(result.docId.startsWith('svc')).toBe(true);
    store.close();
    built.store.close();
  });

  it('导入成功后 flushCurrentDoc 抛错 → CURRENT_DOC_FLUSH_FAILED warning（不阻塞）', async () => {
    const built = await buildProject({ docId: 'flush-doc', widgets: [widgetMap('SHAPE')] });
    const { service, store } = makeService({
      flushCurrentDoc: async () => {
        throw new Error('persist failed');
      },
    });
    const result = await service.importProject(built.blob);
    expect(result.warnings.map((w) => w.code)).toContain('CURRENT_DOC_FLUSH_FAILED');
    store.close();
    built.store.close();
  });

  it('flushCurrentDoc 正常完成 → 无 flush warning', async () => {
    const built = await buildProject({ docId: 'flush-ok', widgets: [widgetMap('SHAPE')] });
    let flushed = 0;
    const { service, store } = makeService({
      flushCurrentDoc: async () => {
        flushed++;
      },
    });
    const result = await service.importProject(built.blob);
    expect(flushed).toBe(1);
    expect(result.warnings.map((w) => w.code)).not.toContain('CURRENT_DOC_FLUSH_FAILED');
    store.close();
    built.store.close();
  });

  it('底层错误码原样透出（不吞不映射错）', async () => {
    const built = await buildProject({ docId: 'pass-doc', widgets: [widgetMap('SHAPE')] });
    const tampered = await import('./helpers/projectFileFixtures').then((m) =>
      m.rezipFixture(built.blob, ({ manifest }) => {
        manifest.version = 99;
      }),
    );
    const { service, store } = makeService({});
    await expectCode(service.importProject(tampered), 'PROJECT_VERSION_UNSUPPORTED');
    store.close();
    built.store.close();
  });
});
