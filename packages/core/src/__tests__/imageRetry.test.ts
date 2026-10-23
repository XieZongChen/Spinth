import { describe, expect, it } from 'vitest';
import { autoRetryDelay, isHttpSrc } from '../widgets/image/imageRetry';

describe('imageRetry 纯函数', () => {
  it('isHttpSrc：http/https（大小写不敏感）为真；data/blob/spinth-asset 为假', () => {
    expect(isHttpSrc('https://a.test/x.png')).toBe(true);
    expect(isHttpSrc('http://a.test/x.png')).toBe(true);
    expect(isHttpSrc('HTTPS://a.test/x.png')).toBe(true);
    expect(isHttpSrc('data:image/png;base64,xxx')).toBe(false);
    expect(isHttpSrc('blob:https://a.test/uuid')).toBe(false);
    expect(isHttpSrc('spinth-asset:' + 'a'.repeat(64))).toBe(false);
    expect(isHttpSrc('')).toBe(false);
  });

  it('http(s) 解码失败：attempts 0/1 → 600/1800；2 → null（上限两次）', () => {
    const src = 'https://a.test/x.png';
    expect(autoRetryDelay(src, 'decode', true, 0)).toBe(600);
    expect(autoRetryDelay(src, 'decode', true, 1)).toBe(1800);
    expect(autoRetryDelay(src, 'decode', true, 2)).toBeNull();
    expect(autoRetryDelay(src, 'decode', true, 99)).toBeNull();
  });

  it('非 http(s) 解码失败：data/blob/spinth-asset 一律 null（内容本地确定）', () => {
    expect(autoRetryDelay('data:image/png;base64,xxx', 'decode', true, 0)).toBeNull();
    expect(autoRetryDelay('blob:https://a.test/u', 'decode', true, 0)).toBeNull();
    expect(autoRetryDelay('spinth-asset:' + 'a'.repeat(64), 'decode', true, 0)).toBeNull();
  });

  it('retryable=false（建纹/存储层故障）与 missing（资产行缺）：不自动重试', () => {
    expect(autoRetryDelay('https://a.test/x.png', 'decode', false, 0)).toBeNull();
    expect(autoRetryDelay('spinth-asset:' + 'a'.repeat(64), 'missing', true, 0)).toBeNull();
    expect(autoRetryDelay('https://a.test/x.png', 'missing', true, 0)).toBeNull();
  });
});
