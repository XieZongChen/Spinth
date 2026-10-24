import { describe, expect, expectTypeOf, it } from 'vitest';
import { BoardSDK } from '../app';
import {
  BOARD_PUBLIC_MEMBERS,
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
