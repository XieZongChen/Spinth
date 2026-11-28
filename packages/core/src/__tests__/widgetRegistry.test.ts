import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod';
import {
  WIDGET_REGISTRY,
  WidgetDataUnion,
  isTreeWidgetType,
  type IWidgetData,
  type TreeWidgetType,
  ShapeSchema,
} from '../types/widget';
import { WIDGET_RUNTIME } from '../widgetRuntime';
import type { IRect } from '../common/geometry';

/**
 * 类型注册表（Batch 2 第一刀）：schema 域单源。核心护栏是**编译期等价锁**——
 * 注册表派生联合 z.infer<WidgetDataUnion> 必须与手写 IWidgetData 逐成员等价，
 * 任一侧加字段/加类型未同步即此处编译红/测红（防两套真相漂移）。
 */
describe('WIDGET_REGISTRY + WidgetDataUnion', () => {
  it('注册表覆盖全部十二类型', () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual([
      'ACTIVATION',
      'FRAME',
      'IMAGE',
      'LIFELINE',
      'LINE',
      'MIND_MAP',
      'ORG_CHART',
      'PEN',
      'SHAPE',
      'STICKY',
      'SYMBOL',
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

  it('TYPES_WHERE 派生集（第五刀）：编辑四类/参照八类（含 FRAME、LIFELINE、ACTIVATION）/可擦一类', async () => {
    const { TYPES_WHERE } = await import('../types/widget');
    expect(TYPES_WHERE('editable').sort()).toEqual(['SHAPE', 'STICKY', 'SYMBOL', 'TEXT']);
    expect(TYPES_WHERE('referenceable').sort()).toEqual([
      'ACTIVATION',
      'FRAME',
      'IMAGE',
      'LIFELINE',
      'SHAPE',
      'STICKY',
      'SYMBOL',
      'TEXT',
    ]);
    expect(TYPES_WHERE('erasable')).toEqual(['PEN']);
  });

  it('family 字段单源（specs/tree-diagrams D1）：仅树类型（MIND_MAP/ORG_CHART）属 tree', () => {
    for (const [type, entry] of Object.entries(WIDGET_REGISTRY)) {
      expect(['widget', 'tree']).toContain(entry.family);
      expect(entry.family).toBe(['MIND_MAP', 'ORG_CHART'].includes(type) ? 'tree' : 'widget');
    }
    // 运行时判定与注册表一致
    expect(isTreeWidgetType('MIND_MAP')).toBe(true);
    expect(isTreeWidgetType('ORG_CHART')).toBe(true);
    expect(isTreeWidgetType('SHAPE')).toBe(false);
    expect(isTreeWidgetType('UNKNOWN')).toBe(false);
    // 编译期派生：TreeWidgetType 当前就是 'MIND_MAP'
    expectTypeOf<TreeWidgetType>().toEqualTypeOf<'MIND_MAP' | 'ORG_CHART'>();
  });

  it('能力位单源断言：IMAGE keepRatio / MIND_MAP 全 false（除 movable/selectable）', () => {
    expect(WIDGET_REGISTRY.IMAGE.capabilities.keepRatio).toBe(true);
    expect(WIDGET_REGISTRY.MIND_MAP.capabilities.groupable).toBe(false);
    expect(WIDGET_REGISTRY.LINE.capabilities.resizable).toBe(false);
    expect(WIDGET_REGISTRY.PEN.capabilities.resizable).toBe(true);
    // FRAME（specs/container-frame §2.6）：不旋转、不编组、标题不走富文本通道、
    // 参考线可吸附（泳道对齐刚需）
    expect(WIDGET_REGISTRY.FRAME.capabilities).toMatchObject({
      rotatable: false,
      groupable: false,
      resizable: true,
      editable: false,
      referenceable: true,
      erasable: false,
    });
    // LIFELINE（specs/sequence-diagram §2.4）：不旋转（轴恒竖直）、可编组、可缩放
    // （宽度以轴对称经 constrainResize 整形）、标签走自有 plain 会话、参考线可吸附
    expect(WIDGET_REGISTRY.LIFELINE.capabilities).toMatchObject({
      rotatable: false,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: false,
      referenceable: true,
      erasable: false,
    });
    // ACTIVATION（specs/sequence-diagram §2.4）：能力位与生命线一致——可缩放
    // （只改高度，经 constrainResize 锁宽）、中心线吸生命线中心参考线
    expect(WIDGET_REGISTRY.ACTIVATION.capabilities).toEqual(WIDGET_REGISTRY.LIFELINE.capabilities);
  });

  it('ACTIVATION：lifelineId 可缺省（未绑定）；groupId 保留；parentId 被 schema 剥离（不进容器，S5）', () => {
    const bare = WidgetDataUnion.safeParse({ id: 'a1', type: 'ACTIVATION', zOrder: 'a0' });
    expect(bare.success).toBe(true);
    if (bare.success) expect(bare.data).toEqual({ id: 'a1', type: 'ACTIVATION', zOrder: 'a0' });
    const bound = WidgetDataUnion.safeParse({
      id: 'a2',
      type: 'ACTIVATION',
      zOrder: 'a1',
      lifelineId: 'l1',
      groupId: 'g1',
      parentId: 'f1',
    });
    if (bound.success) {
      expect(bound.data).toMatchObject({ lifelineId: 'l1', groupId: 'g1' });
      expect(bound.data).not.toHaveProperty('parentId');
    }
    expect(
      WidgetDataUnion.safeParse({ id: 'a3', type: 'ACTIVATION', zOrder: 'a2', lifelineId: 7 })
        .success,
    ).toBe(false);
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

  it('LIFELINE：label 缺省空串、head 可缺省；parentId 被 schema 剥离（不进容器，S5）', () => {
    const parsed = WidgetDataUnion.safeParse({ id: 'l1', type: 'LIFELINE', zOrder: 'a0' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ id: 'l1', type: 'LIFELINE', zOrder: 'a0', label: '' });
    }
    const full = WidgetDataUnion.safeParse({
      id: 'l2',
      type: 'LIFELINE',
      zOrder: 'a1',
      label: '用户',
      head: 'actor',
      groupId: 'g1',
    });
    expect(full.success).toBe(true);
    if (full.success) {
      expect(full.data).toMatchObject({ label: '用户', head: 'actor', groupId: 'g1' });
    }
    const stripped = WidgetDataUnion.safeParse({
      id: 'l3',
      type: 'LIFELINE',
      zOrder: 'a2',
      parentId: 'f1',
    });
    if (stripped.success) expect(stripped.data).not.toHaveProperty('parentId');
    expect(
      WidgetDataUnion.safeParse({ id: 'l4', type: 'LIFELINE', zOrder: 'a3', head: 'robot' })
        .success,
    ).toBe(false);
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
