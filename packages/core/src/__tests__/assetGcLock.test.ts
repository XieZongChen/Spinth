// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { withAssetGcLock } from '../platform/dataEngine/assetGc';

/**
 * 资产 GC 单写者锁（docs/19 §5）：Web Locks 的 ifAvailable 在锁被占用时仍会
 * 调用 callback，但传入 null。此前的实现忽略 lock 参数，导致第二个标签也执行
 * GC——这组测试锁死「null = 跳过」的行为。
 */

type LockStub = {
  request(
    name: string,
    opts: unknown,
    cb: (lock: unknown | null) => Promise<void>,
  ): Promise<unknown>;
};

const original = Object.getOwnPropertyDescriptor(navigator, 'locks');

function setLocks(request: LockStub['request']): void {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request },
  });
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'locks', original);
  else Reflect.deleteProperty(navigator, 'locks');
});

describe('withAssetGcLock 单写者语义', () => {
  it('Web Locks 不可用：降级直跑（单标签假设）', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    let runs = 0;
    const ran = await withAssetGcLock(async () => {
      runs++;
    });
    expect(ran).toBe(true);
    expect(runs).toBe(1);
  });

  it('ifAvailable 返回 null：本轮不执行，返回 false', async () => {
    let runs = 0;
    let opts: unknown;
    setLocks(async (_name, o, cb) => {
      opts = o;
      await cb(null);
    });
    const ran = await withAssetGcLock(async () => {
      runs++;
    });
    expect(ran).toBe(false);
    expect(runs).toBe(0);
    expect(opts).toEqual({ ifAvailable: true });
  });

  it('拿到锁：执行一次并返回 true', async () => {
    let runs = 0;
    setLocks(async (_name, _o, cb) => {
      await cb({ name: 'spinth-asset-gc' });
    });
    const ran = await withAssetGcLock(async () => {
      runs++;
    });
    expect(ran).toBe(true);
    expect(runs).toBe(1);
  });

  it('双标签竞争：先持有者执行，后到者拿到 null 跳过', async () => {
    let held = false;
    let runs = 0;
    setLocks(async (_name, _o, cb) => {
      const lock = held ? null : { name: 'spinth-asset-gc' };
      if (lock) held = true;
      await cb(lock);
    });
    const work = async (): Promise<void> => {
      runs++;
    };
    expect(await withAssetGcLock(work)).toBe(true);
    expect(await withAssetGcLock(work)).toBe(false);
    expect(runs).toBe(1);
  });
});
