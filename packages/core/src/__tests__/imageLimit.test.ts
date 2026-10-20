// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ImageService } from '../widgets/image/imageService';
import { AssetStore } from '../platform/dataEngine/assetStore';

/** Batch 1 · 1.18：图片字节上限——超限 blob 拒绝（data URL 不入 Yjs） */
describe('ImageService 字节上限', () => {
  it('超 5MB 的 blob：pasteImage 零落库（blobToDataUrl 不被调用）', () => {
    const svc = new ImageService(
      {
        editable$: { value: true },
        vpBounds$: { value: { x: 0, y: 0, width: 100, height: 100 } },
      } as never,
      { add: vi.fn() } as never,
      { stopCapturing: vi.fn() } as never,
      { setSelected: vi.fn() } as never,
    );
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = ((...a: unknown[]) =>
      warns.push(a.map(String).join(' '))) as typeof console.warn;
    try {
      svc.pasteImage({ size: 6 * 1024 * 1024, type: 'image/png' } as Blob);
      expect(warns.some((w) => w.includes('上限已拒绝'))).toBe(true);
    } finally {
      console.warn = orig;
    }
  });

  /** P0 修复：协同态贴图退 data URL——资产引用是他端无 blob 的死链。
   *  jsdom 不解码图片（Image onload 永不触发）——stub Image 走 onerror
   *  兜底尺寸，两条分支都能跑完 */
  it('协同态（wsState≠off）走 data URL；单机态走资产引用', async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.({}));
      }
    }
    vi.stubGlobal('Image', FakeImage);
    try {
      const makeSvc = (
        state: 'off' | 'synced',
        store: AssetStore,
      ): { svc: ImageService; added: Array<Record<string, unknown>> } => {
        const added: Array<Record<string, unknown>> = [];
        const svc = new ImageService(
          {
            editable$: { value: true },
            vpBounds$: { value: { x: 0, y: 0, width: 100, height: 100 } },
            container: null,
          } as never,
          {
            add: (d: Record<string, unknown>) => {
              added.push(d);
              return {} as never;
            },
            genInitialOrder: () => 'a0',
            wsState$: new BehaviorSubject<'off' | 'synced'>(state),
          } as never,
          { stopCapturing: vi.fn() } as never,
          { setSelected: vi.fn() } as never,
          store,
        );
        return { svc, added };
      };
      // 协同态：有资产层也走旧路径（他端无 blob，引用是死链）
      const storeSynced = new AssetStore();
      const putSynced = vi.spyOn(storeSynced, 'put');
      const synced = makeSvc('synced', storeSynced);
      await synced.svc['storeAndAdd'](
        new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        {
          x: 0,
          y: 0,
        },
      );
      expect(putSynced).not.toHaveBeenCalled();
      expect(String(synced.added[0]!.src)).toMatch(/^data:image\/png;base64,/);

      // 单机态：资产引用
      const storeOff = new AssetStore();
      const off = makeSvc('off', storeOff);
      await off.svc['storeAndAdd'](new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' }), {
        x: 0,
        y: 0,
      });
      expect(String(off.added[0]!.src)).toMatch(/^spinth-asset:[0-9a-f]{64}$/);
      storeSynced.close();
      storeOff.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
