import { describe, expect, it } from 'vitest';
import { PROJECT_FORMAT, PROJECT_FORMAT_VERSION, type ProjectManifest } from '../types/projectFile';
import {
  buildProjectManifest,
  hashProjectBytes,
  parseProjectManifest,
  serializeProjectManifest,
} from '../platform/projectFile/projectManifest';
import { ProjectFileError } from '../platform/projectFile/projectFileError';

const NOW = new Date('2026-10-21T08:00:00.000Z');
const LIMITS = { assetCount: 256 };

/** 64 位十六进制填充（合法形状；具体哈希值由 hashProjectBytes 现算） */
const fakeId = (n: number): string => n.toString(16).padStart(64, '0') as string;

async function validManifestText(): Promise<string> {
  const docBytes = new Uint8Array([1, 2, 3, 4]);
  const { manifest } = await buildProjectManifest({
    sourceDocId: 'a1b2c3d4',
    appVersion: '0.3.0',
    now: NOW,
    documentBytes: docBytes,
    assets: [{ id: fakeId(1), mime: 'image/png', size: 4 }],
  });
  return new TextDecoder().decode(serializeProjectManifest(manifest));
}

describe('buildProjectManifest', () => {
  it('document 哈希/字节数由内容计算；createdAt ISO；assets path 拼接', async () => {
    const documentBytes = new Uint8Array([9, 8, 7]);
    const { manifest, jsonBytes } = await buildProjectManifest({
      sourceDocId: 'doc-1',
      appVersion: '0.3.0',
      now: NOW,
      documentBytes,
      assets: [{ id: fakeId(7), mime: '', size: 10 }],
    });
    expect(manifest.format).toBe(PROJECT_FORMAT);
    expect(manifest.version).toBe(PROJECT_FORMAT_VERSION);
    expect(manifest.createdAt).toBe('2026-10-21T08:00:00.000Z');
    expect(manifest.generator).toEqual({ name: 'spinth', version: '0.3.0' });
    expect(manifest.document.bytes).toBe(3);
    expect(manifest.document.sha256).toBe(await hashProjectBytes(documentBytes));
    // 空 MIME 归一 image/png（§4.2）；path = assets/<id>
    expect(manifest.assets[0]).toEqual({
      id: fakeId(7),
      path: `assets/${fakeId(7)}`,
      mime: 'image/png',
      size: 10,
    });
    // 序列化：2 空格缩进 + 尾随换行（§4.2）
    const text = new TextDecoder().decode(jsonBytes);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "format": "spinth-project",');
  });
});

describe('parseProjectManifest', () => {
  it('合法 manifest 解析成功', async () => {
    const manifest = parseProjectManifest(await validManifestText(), LIMITS);
    expect(manifest.sourceDocId).toBe('a1b2c3d4');
    expect(manifest.assets).toHaveLength(1);
  });

  it('容忍 BOM（§4.2：实现可容忍，导出不写）', async () => {
    const text = await validManifestText();
    expect(() => parseProjectManifest(`\uFEFF${text}`, LIMITS)).not.toThrow();
  });

  it('未知字段忽略（§4.2：zod 默认丢弃，不影响解析）', async () => {
    const manifest = parseProjectManifest(await validManifestText(), LIMITS);
    const raw = JSON.parse(new TextDecoder().decode(serializeProjectManifest(manifest))) as Record<
      string,
      unknown
    >;
    raw.futureField = { nested: true };
    const parsed = parseProjectManifest(JSON.stringify(raw), LIMITS);
    expect('futureField' in parsed).toBe(false);
  });

  it('JSON 语法坏 / format 错 / version 错 / 字段缺失 → PROJECT_MANIFEST_INVALID', () => {
    const cases = [
      'not-json{',
      JSON.stringify({ format: 'other', version: 1 }),
      JSON.stringify({ format: PROJECT_FORMAT, version: '1' }),
      JSON.stringify({ format: PROJECT_FORMAT, version: 1, createdAt: 'x' }), // 缺 generator 等
    ];
    for (const text of cases) {
      try {
        parseProjectManifest(text, LIMITS);
        expect.unreachable('应当抛错');
      } catch (err) {
        expect(err).toBeInstanceOf(ProjectFileError);
        expect((err as ProjectFileError).code).toBe('PROJECT_MANIFEST_INVALID');
      }
    }
  });

  it('format 匹配且 version > 1 → PROJECT_VERSION_UNSUPPORTED（先于 schema 误报）', () => {
    try {
      parseProjectManifest(
        JSON.stringify({ format: PROJECT_FORMAT, version: 2, 未来字段: true }),
        LIMITS,
      );
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ProjectFileError).code).toBe('PROJECT_VERSION_UNSUPPORTED');
    }
  });

  it('version 非整数 → PROJECT_MANIFEST_INVALID', () => {
    try {
      parseProjectManifest(JSON.stringify({ format: PROJECT_FORMAT, version: 1.5 }), LIMITS);
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ProjectFileError).code).toBe('PROJECT_MANIFEST_INVALID');
    }
  });

  it('坏 hash 形状 / 坏 path / 非 image MIME / createdAt 非法 → PROJECT_MANIFEST_INVALID', async () => {
    const manifest = parseProjectManifest(await validManifestText(), LIMITS);
    const mutate = (fn: (m: ProjectManifest) => void): string => {
      const copy = structuredClone(manifest);
      fn(copy);
      return JSON.stringify(copy);
    };
    const badCases = [
      mutate((m) => {
        m.document.sha256 = 'ZZZ';
      }),
      mutate((m) => {
        m.assets[0]!.path = 'assets/elsewhere';
      }),
      mutate((m) => {
        m.assets[0]!.mime = 'text/plain';
      }),
      mutate((m) => {
        m.createdAt = 'not-a-date';
      }),
    ];
    for (const text of badCases) {
      try {
        parseProjectManifest(text, LIMITS);
        expect.unreachable('应当抛错');
      } catch (err) {
        expect((err as ProjectFileError).code).toBe('PROJECT_MANIFEST_INVALID');
      }
    }
  });

  it('资产 id / path 重复 → PROJECT_MANIFEST_INVALID', async () => {
    const manifest = parseProjectManifest(await validManifestText(), LIMITS);
    const raw = JSON.parse(JSON.stringify(manifest)) as ProjectManifest;
    raw.assets.push({ ...raw.assets[0]!, id: fakeId(2), path: `assets/${fakeId(2)}` });
    raw.assets.push({ ...raw.assets[0]! }); // 完全重复
    try {
      parseProjectManifest(JSON.stringify(raw), LIMITS);
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ProjectFileError).code).toBe('PROJECT_MANIFEST_INVALID');
      expect((err as ProjectFileError).details?.assets).toEqual([fakeId(1)]);
    }
  });

  it('assets.length 超上限 → PROJECT_MANIFEST_INVALID', async () => {
    const manifest = parseProjectManifest(await validManifestText(), LIMITS);
    const raw = JSON.parse(JSON.stringify(manifest)) as ProjectManifest;
    raw.assets.push({ id: fakeId(9), path: `assets/${fakeId(9)}`, mime: 'image/png', size: 1 });
    try {
      parseProjectManifest(JSON.stringify(raw), { assetCount: 1 });
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ProjectFileError).code).toBe('PROJECT_MANIFEST_INVALID');
    }
  });
});

describe('hashProjectBytes / ensureProjectCrypto', () => {
  it('SHA-256 与 crypto.subtle 参考值一致', async () => {
    // 'abc' 的 SHA-256 标准测试向量
    expect(await hashProjectBytes(new Uint8Array([97, 98, 99]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('crypto.subtle 不可用 → PROJECT_CRYPTO_UNAVAILABLE', async () => {
    const subtle = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await hashProjectBytes(new Uint8Array([1]));
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as ProjectFileError).code).toBe('PROJECT_CRYPTO_UNAVAILABLE');
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
    }
  });
});
