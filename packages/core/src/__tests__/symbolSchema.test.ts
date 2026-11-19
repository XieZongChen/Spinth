import { describe, expect, it } from 'vitest';
import { SymbolSchema, WidgetDataUnion } from '../types/widget';

/**
 * 符号控件 schema 单测（specs/symbol-widget §2）：缺省值、optional 语义、
 * 未知 symbol id 保留（D7 不用 enum——旧客户端导入新文件降级不崩）。
 */

describe('SymbolSchema', () => {
  it('最小输入：symbol/label 落缺省，color/groupId 无字段（不是 undefined 值键）', () => {
    const parsed = SymbolSchema.parse({ id: 'w1', type: 'SYMBOL', zOrder: 'a0' });
    expect(parsed.symbol).toBe('net-server');
    expect(parsed.label).toBe('');
    expect('color' in parsed).toBe(false);
    expect('groupId' in parsed).toBe(false);
  });

  it('未知 symbol id 保留原值（占位渲染在 Vm 层，schema 不拒绝）', () => {
    const parsed = SymbolSchema.parse({
      id: 'w1',
      type: 'SYMBOL',
      zOrder: 'a0',
      symbol: 'net-future-gateway',
    });
    expect(parsed.symbol).toBe('net-future-gateway');
  });

  it('color / groupId / label 显式值透传；label 空串合法（只画图标）', () => {
    const parsed = SymbolSchema.parse({
      id: 'w1',
      type: 'SYMBOL',
      zOrder: 'a0',
      symbol: 'net-router',
      label: '',
      color: '#dc2626',
      groupId: 'g1',
    });
    expect(parsed).toMatchObject({
      symbol: 'net-router',
      label: '',
      color: '#dc2626',
      groupId: 'g1',
    });
  });

  it('判别联合经注册表派生：SYMBOL 可 parse，type 漂移被拒', () => {
    const ok = WidgetDataUnion.safeParse({
      id: 'w1',
      type: 'SYMBOL',
      zOrder: 'a0',
      symbol: 'net-router',
      label: '核心路由',
    });
    expect(ok.success).toBe(true);
    // color 键被 strip（updateSelectedStyle 的 fill:'solid' 特判对 SYMBOL 无害的
    // 同一守卫：schema 不认识的键不落库）
    const stripped = SymbolSchema.parse({
      id: 'w2',
      type: 'SYMBOL',
      zOrder: 'a0',
      fill: 'solid',
    });
    expect('fill' in stripped).toBe(false);
  });

  it('type 字面量锁：SYMBOL schema 不接受其他 type 值', () => {
    expect(SymbolSchema.safeParse({ id: 'w1', type: 'SHAPE', zOrder: 'a0' }).success).toBe(false);
  });
});
