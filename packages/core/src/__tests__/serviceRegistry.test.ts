import { describe, expect, it } from 'vitest';
import { ServiceRegistry, token } from '../platform/registry/serviceRegistry';
import { unionRects, rectsIntersect, rectContainsPoint } from '../common/geometry';

interface Dep {
  name: string;
}

describe('ServiceRegistry', () => {
  it('transient 每次新建实例', () => {
    const r = new ServiceRegistry();
    const T = token<Dep>('Dep');
    r.register(T, () => ({ name: 'a' }));
    expect(r.resolve(T)).not.toBe(r.resolve(T));
  });

  it('singleton 缓存且可互相 resolve', () => {
    const r = new ServiceRegistry();
    const TDep = token<Dep>('Dep');
    const TUser = token<{ dep: Dep }>('User');
    r.registerSingleton(TDep, () => ({ name: 'dep' }));
    r.registerSingleton(TUser, (reg) => ({ dep: reg.resolve(TDep) }));
    const u1 = r.resolve(TUser);
    const u2 = r.resolve(TUser);
    expect(u1).toBe(u2);
    expect(u1.dep.name).toBe('dep');
  });

  it('factory 返回可重复调用的工厂', () => {
    const r = new ServiceRegistry();
    const T = token<number>('n');
    let n = 0;
    r.register(T, () => ++n);
    const f = r.factory(T);
    expect(f()).toBe(1);
    expect(f()).toBe(2);
  });

  it('未注册 token 抛错', () => {
    const r = new ServiceRegistry();
    expect(() => r.resolve(token('missing'))).toThrow();
  });
});

describe('geometry', () => {
  it('unionRects 求包络', () => {
    expect(unionRects([])).toBeNull();
    const u = unionRects([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 20 },
    ]);
    expect(u).toEqual({ x: 0, y: 0, width: 30, height: 25 });
  });

  it('相交与包含', () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 5, height: 5 }, { x: 4, y: 4, width: 5, height: 5 }),
    ).toBe(true);
    expect(
      rectsIntersect({ x: 0, y: 0, width: 5, height: 5 }, { x: 6, y: 6, width: 5, height: 5 }),
    ).toBe(false);
    expect(rectContainsPoint({ x: 0, y: 0, width: 5, height: 5 }, { x: 3, y: 3 })).toBe(true);
  });
});
