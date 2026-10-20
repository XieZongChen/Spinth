import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { assetSrcOf } from '../platform/dataEngine/assetStore';
import { collectProjectAssetRefs } from '../platform/projectFile/projectAssetRefs';

const id = (n: number): string => n.toString(16).padStart(64, '0') as string;

function docWithImages(srcs: Array<string | undefined>): Y.Array<unknown> {
  const yDoc = new Y.Doc();
  const arr = yDoc.getArray('widgets');
  yDoc.transact(() => {
    for (const [i, src] of srcs.entries()) {
      const m = new Y.Map();
      m.set('id', `img-${i}`);
      m.set('type', 'IMAGE');
      m.set('src', src ?? '');
      arr.push([m]);
    }
  });
  return arr;
}

describe('collectProjectAssetRefs', () => {
  it('只收集 IMAGE 的 spinth-asset: 引用并去重', () => {
    const arr = docWithImages([assetSrcOf(id(1)), assetSrcOf(id(1)), assetSrcOf(id(2))]);
    const scan = collectProjectAssetRefs(arr);
    expect([...scan.assetIds].sort()).toEqual([id(1), id(2)]);
    expect(scan.dataUrlCount).toBe(0);
    expect(scan.externalCount).toBe(0);
  });

  it('data: / http(s): 图片计数；其余 src 形态忽略', () => {
    const arr = docWithImages([
      'data:image/png;base64,AAAA',
      'data:image/jpeg;base64,BBBB',
      'https://example.com/a.png',
      'http://example.com/b.png',
      '',
      'relative/path.png',
      'blob:whatever',
    ]);
    const scan = collectProjectAssetRefs(arr);
    expect(scan.assetIds.size).toBe(0);
    expect(scan.dataUrlCount).toBe(2);
    expect(scan.externalCount).toBe(2);
  });

  it('非 IMAGE widget 一律忽略（含含资产引用字段的 SHAPE）', () => {
    const yDoc = new Y.Doc();
    const arr = yDoc.getArray('widgets');
    const shape = new Y.Map();
    shape.set('type', 'SHAPE');
    shape.set('src', assetSrcOf(id(9))); // 字段同名但不是 IMAGE
    arr.push([shape]);
    const scan = collectProjectAssetRefs(arr);
    expect(scan.assetIds.size).toBe(0);
  });

  it('混合文档：引用 + dataURL + 外链同时统计', () => {
    const yDoc = new Y.Doc();
    const arr = yDoc.getArray('widgets');
    yDoc.transact(() => {
      const img1 = new Y.Map();
      img1.set('type', 'IMAGE');
      img1.set('src', assetSrcOf(id(5)));
      arr.push([img1]);
      const text = new Y.Map();
      text.set('type', 'TEXT');
      arr.push([text]);
      const img2 = new Y.Map();
      img2.set('type', 'IMAGE');
      img2.set('src', 'https://cdn.example.com/x.png');
      arr.push([img2]);
      const img3 = new Y.Map();
      img3.set('type', 'IMAGE');
      img3.set('src', 'data:image/png;base64,CCCC');
      arr.push([img3]);
    });
    const scan = collectProjectAssetRefs(arr);
    expect(scan.assetIds).toEqual(new Set([id(5)]));
    expect(scan.externalCount).toBe(1);
    expect(scan.dataUrlCount).toBe(1);
  });
});
