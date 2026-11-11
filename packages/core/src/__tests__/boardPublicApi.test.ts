import { describe, expect, expectTypeOf, it } from 'vitest';
import { BoardSDK } from '../app';
import {
  BOARD_PUBLIC_MEMBERS,
  projectBoardPublicApi,
  type BoardPublicApi,
  type BoardPublicMember,
} from '../boardPublicApi';

/**
 * 公共面 allowlist 护栏（specs/api-surface §6.2）：运行时成员在位（继承成员
 * 也在原型链上，`in` 成立）+ 类型面等价 + 反向抽样（服务字段不进公开面）。
 * 分类完整性（未归类/重叠/幽灵键）由 boardPublicApi.ts 的三条编译锁承担。
 */
describe('BOARD_PUBLIC_MEMBERS allowlist', () => {
  it('每一项都在 BoardSDK 实例上（含基类继承成员）', () => {
    const sdk = new BoardSDK();
    for (const m of BOARD_PUBLIC_MEMBERS) {
      expect(m in sdk, `成员 ${m} 不在 BoardSDK 实例上`).toBe(true);
    }
  });

  it('类型面：keyof BoardPublicApi ≡ BoardPublicMember', () => {
    expectTypeOf<keyof BoardPublicApi>().toEqualTypeOf<BoardPublicMember>();
  });

  it('反向抽样：服务字段/调试探针不在公开面', () => {
    expect(BOARD_PUBLIC_MEMBERS).not.toContain('viewport');
    expect(BOARD_PUBLIC_MEMBERS).not.toContain('engine');
    expect(BOARD_PUBLIC_MEMBERS).not.toContain('__debug');
    expect(BOARD_PUBLIC_MEMBERS).not.toContain('syncToolOption');
  });
});

/**
 * 运行时投影护栏（specs/runtime-narrowing §6.1）：键集 = allowlist、内部字段
 * 不可枚举/不可读/不可调用、冻结、方法绑定与身份缓存、活 getter、缺成员报错。
 */
describe('projectBoardPublicApi 运行时投影', () => {
  /** 全成员桩源：方法记录调用时的 this，非函数成员可后续替换（活 getter 用） */
  function makeStub(): Record<string, unknown> {
    const stub: Record<string, unknown> = {};
    for (const m of BOARD_PUBLIC_MEMBERS) stub[m] = null;
    return stub;
  }

  it('投影键集 = allowlist（67 项，排序全等）', () => {
    const api = projectBoardPublicApi(new BoardSDK());
    expect(Object.keys(api)).toHaveLength(67);
    expect(Object.keys(api).sort()).toEqual([...BOARD_PUBLIC_MEMBERS].sort());
    expect(
      Reflect.ownKeys(api)
        .filter((k): k is string => typeof k === 'string')
        .sort(),
    ).toEqual([...BOARD_PUBLIC_MEMBERS].sort());
  });

  it('内部字段不可枚举、不可读（in/descriptor 均 false）', () => {
    const api = projectBoardPublicApi(new BoardSDK());
    const view = api as unknown as Record<string, unknown>;
    for (const key of [
      'viewport',
      'engine',
      '__debug',
      'initialized',
      'registry',
      'syncToolOption',
      'disposed',
    ]) {
      expect(Object.keys(api)).not.toContain(key);
      expect(key in api).toBe(false);
      expect(view[key]).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(api, key)).toBeUndefined();
    }
  });

  it('投影已冻结：赋值/删除抛 TypeError', () => {
    const api = projectBoardPublicApi(new BoardSDK());
    expect(Object.isFrozen(api)).toBe(true);
    expect(() => {
      (api as unknown as Record<string, unknown>).viewport = null;
    }).toThrow(TypeError);
    expect(() => {
      delete (api as unknown as Record<string, unknown>).undo;
    }).toThrow(TypeError);
  });

  it('方法 this 绑定到源实例且函数身份稳定（缓存）', () => {
    const holder: { self: unknown } = { self: null };
    const stub = makeStub();
    stub.undo = function (this: unknown) {
      holder.self = this;
    };
    const api = projectBoardPublicApi(stub as unknown as BoardPublicApi);
    expect(api.undo).toBe(api.undo); // 首次读取 bind 后缓存身份
    (api.undo as () => void)();
    expect(holder.self).toBe(stub);
  });

  it('非函数成员每次读取都委托源（活 getter，非构造时快照）', () => {
    const streamA = { tag: 'a' };
    const streamB = { tag: 'b' };
    const stub = makeStub();
    stub.vpScale$ = streamA;
    const api = projectBoardPublicApi(stub as unknown as BoardPublicApi);
    expect(api.vpScale$).toBe(streamA);
    stub.vpScale$ = streamB;
    expect(api.vpScale$).toBe(streamB);
  });

  it('真实实例：查询 getter 组装后读到新值（fallback → service）', () => {
    const sdk = new BoardSDK();
    const api = projectBoardPublicApi(sdk);
    expect(api.modelCount).toBe(0); // engine 未组装：fallback 0
    (sdk as unknown as Record<string, unknown>).engine = { modelCount: 7 };
    expect(api.modelCount).toBe(7); // 投影不缓存，读到注入后的值
  });

  it('投影方法委托真实实例（dispose 幂等语义不变）', () => {
    const sdk = new BoardSDK();
    const api = projectBoardPublicApi(sdk);
    expect(() => api.dispose()).not.toThrow();
    expect(sdk.disposed).toBe(true);
    expect(() => api.dispose()).not.toThrow();
  });

  it('源缺成员抛 BOARD_PUBLIC_MEMBER_MISSING', () => {
    expect(() => projectBoardPublicApi({} as unknown as BoardPublicApi)).toThrow(
      'BOARD_PUBLIC_MEMBER_MISSING: initialize',
    );
  });
});
