import { expect, type Page } from '@playwright/test';

/** 图片/资产 E2E 公共探针 helper（specs/split-large-files §5.3） */

/** 1×1 PNG（长边 1 ≤ 480 钳制上限自然满足；断言用 natural 尺寸） */
export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export interface ImageLoadProbe {
  src: string;
  state: string;
  attempts: number;
  acquires: number;
  textureUid: number;
}

export async function imageState(
  page: Page,
): Promise<{ count: number; img: { width?: number; height?: number; srcLen?: number } | null }> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: { __debug: { modelCount: number; vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinth.__debug;
    const s = d.vmStates.find((v) => v.type === 'IMAGE');
    return {
      count: d.modelCount,
      img:
        s === undefined
          ? null
          : {
              width: s.width as number,
              height: s.height as number,
              srcLen: String(s.src ?? '').length,
            },
    };
  });
}

export async function persisted(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as unknown as {
              __spinth: { engine: { persistState$: { getValue(): string } } };
            }
          ).__spinth.engine.persistState$.getValue(),
        ),
      { timeout: 5_000 },
    )
    .toBe('saved');
}

/** 纹理缓存/租约/加载会话探针（docs/19 §3-§4） */
export function textureProbes(page: Page): Promise<{
  entries: Array<{ key: string; refs: number; uid: number }>;
  pending: number;
  leases: Record<string, number>;
  loads: ImageLoadProbe[];
}> {
  return page.evaluate(() => {
    const d = (
      window as unknown as {
        __spinth: {
          __debug: {
            imageTextures: {
              entries: Array<{ key: string; refs: number; uid: number }>;
              pending: number;
            };
            assetLeases: Record<string, number>;
            vmStates: Array<Record<string, unknown>>;
          };
        };
      }
    ).__spinth.__debug;
    return {
      entries: d.imageTextures.entries,
      pending: d.imageTextures.pending,
      leases: d.assetLeases,
      loads: d.vmStates.filter((v) => v.type === 'IMAGE').map((v) => v.imageLoad as ImageLoadProbe),
    };
  });
}

/** 尾部盐唯一 PNG（共用 base64 会内容寻址跨 doc 去重，计数判读须唯一化） */
export function saltedPngB64(page: Page): Promise<string> {
  return page.evaluate((b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length + 4);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new DataView(bytes.buffer).setUint32(bin.length, Date.now() % 0xffffffff);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }, PNG_B64);
}

export function pasteB64(page: Page, b64: string): Promise<void> {
  return page.evaluate((data) => {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'e2e.png', { type: 'image/png' }));
    document.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, b64);
}

export function removeFirstImage(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = (
      window as unknown as {
        __spinth: {
          __debug: { vmStates: Array<Record<string, unknown>> };
          engine: { removeByIds(ids: string[]): void };
        };
      }
    ).__spinth;
    const img = w.__debug.vmStates.find((v) => v.type === 'IMAGE');
    if (img) w.engine.removeByIds([String(img.id)]);
  });
}
