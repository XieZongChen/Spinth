import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod';
import { WIDGET_REGISTRY, WidgetDataUnion, type IWidgetData, ShapeSchema } from '../types/widget';
import { WIDGET_RUNTIME } from '../widgetRuntime';
import type { IRect } from '../common/geometry';

/**
 * 类型注册表（Batch 2 第一刀）：schema 域单源。核心护栏是**编译期等价锁**——
 * 注册表派生联合 z.infer<WidgetDataUnion> 必须与手写 IWidgetData 逐成员等价，
 * 任一侧加字段/加类型未同步即此处编译红/测红（防两套真相漂移）。
 */
describe('WIDGET_REGISTRY + WidgetDataUnion', () => {
  it('注册表覆盖全部七类型', () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual([
      'IMAGE',
      'LINE',
      'MIND_MAP',
      'PEN',
      'SHAPE',
      'STICKY',
      'TEXT',
    ]);
    for (const entry of Object.values(WIDGET_REGISTRY)) {
      // 六元能力位全填（运行时面：Boolean 全真值键）
      expect(Object.keys(entry.capabilities).sort()).toEqual([
        'editable',
        'erasable',
        'groupable',
        'keepRatio',
        'movable',
        'referenceable',
        'resizable',
        'rotatable',
        'selectable',
      ]);
    }
  });

  it('TYPES_WHERE 派生集（第五刀）：编辑三类/参照四类/可擦一类', async () => {
    const { TYPES_WHERE } = await import('../types/widget');
    expect(TYPES_WHERE('editable').sort()).toEqual(['SHAPE', 'STICKY', 'TEXT']);
    expect(TYPES_WHERE('referenceable').sort()).toEqual(['IMAGE', 'SHAPE', 'STICKY', 'TEXT']);
    expect(TYPES_WHERE('erasable')).toEqual(['PEN']);
  });

  it('能力位单源断言：IMAGE keepRatio / MIND_MAP 全 false（除 movable/selectable）', () => {
    expect(WIDGET_REGISTRY.IMAGE.capabilities.keepRatio).toBe(true);
    expect(WIDGET_REGISTRY.MIND_MAP.capabilities.groupable).toBe(false);
    expect(WIDGET_REGISTRY.LINE.capabilities.resizable).toBe(false);
    expect(WIDGET_REGISTRY.PEN.capabilities.resizable).toBe(true);
  });

  it('discriminatedUnion 按 type 分派 parse（抽样 SHAPE/未知拒绝）', () => {
    const ok = WidgetDataUnion.safeParse({
      id: 'a',
      type: 'SHAPE',
      zOrder: 'a0',
      shapeType: 'rect',
      color: '#fff',
      borderStyle: 'solid',
      text: '',
    });
    expect(ok.success).toBe(true);
    expect(WidgetDataUnion.safeParse({ id: 'x', type: 'FUTURE' }).success).toBe(false);
    void ShapeSchema;
  });

  // 编译期等价锁（第三刀后两侧同源）：IWidgetData 现在就是
  // z.infer<WidgetDataUnion> & IRect——精确断言；双向 toExtend 保留为
  // 未来手写回归的兜底（有人改回手写 union 时仍能拦漂移）
  it('编译期等价锁（类型级，同源精确 + 双向兜底）', () => {
    type Derived = z.infer<typeof WidgetDataUnion> & IRect;
    expectTypeOf<IWidgetData>().toEqualTypeOf<Derived>();
    expectTypeOf<Derived>().toExtend<IWidgetData>();
    expectTypeOf<IWidgetData>().toExtend<Derived>();
  });
});

describe('WIDGET_RUNTIME 单源（三表合一护栏，specs/api-surface Step 7）', () => {
  // 静态 import（P0 修复：测试体内动态 import 在并发/coverage 下拉全 widget/
  // PIXI 链路曾超默认 5s 超时——单测门禁可复现红）
  it('运行时表键集 ≡ 注册表；token 唯一；工厂可调用', () => {
    const reg = Object.keys(WIDGET_REGISTRY).sort();
    expect(Object.keys(WIDGET_RUNTIME).sort()).toEqual(reg);
    const modelKeys = Object.values(WIDGET_RUNTIME).map((e) => e.modelToken.key);
    const vmKeys = Object.values(WIDGET_RUNTIME).map((e) => e.vmToken.key);
    expect(new Set(modelKeys).size).toBe(modelKeys.length); // model token 互异
    expect(new Set(vmKeys).size).toBe(vmKeys.length); // vm token 互异
    expect(new Set([...modelKeys, ...vmKeys]).size).toBe(modelKeys.length + vmKeys.length);
    for (const e of Object.values(WIDGET_RUNTIME)) {
      expect(typeof e.createModel).toBe('function');
      expect(typeof e.createVm).toBe('function');
    }
  });

  it('union 键锁（类型级）：WidgetDataUnion 判别键 ≡ 注册表键集', () => {
    expectTypeOf<z.infer<typeof WidgetDataUnion>['type']>().toEqualTypeOf<
      keyof typeof WIDGET_REGISTRY
    >();
  });
});
