import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { anchorOf } from '../widgets/line/lineMath';
import { setTextTheme } from '../platform/textEngine/theme';
import { ShapeVm } from '../widgets/shape/shapeVm';

/** ShapeVm 渲染行为（docs/17 §6 编辑态 / docs/16 快速路径 / docs/05 §8 旋转） */

const state = {
  id: 's1',
  type: 'SHAPE' as const,
  zOrder: 'a0',
  shapeType: 'rect' as const,
  color: '#e8f0fb',
  borderStyle: 'solid' as const,
  text: '<p>图形文字</p>',
  x: 0,
  y: 0,
  width: 120,
  height: 80,
};
const state2 = { ...state, text: '<p>图形文字加长</p>', x: 10 };
const noTextState = { ...state, text: '' };

/** docDisplay 是 root 上唯一非 Graphics 子节点（shapeGraphics 常驻首位） */
const docOf = (vm: ShapeVm): { visible: boolean } | undefined =>
  vm.root.children.find((c) => !(c instanceof Graphics)) as { visible: boolean } | undefined;

describe('setTextEditing 编辑期节能早退（docs/17 §6——编辑器 DOM 独占视觉）', () => {
  it('进编辑即清出画布文字；编辑期 render（34ms 落库触发）不重建、只挪位置', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    expect(docOf(vm)).toBeDefined();
    vm.setTextEditing(true);
    // 进编辑瞬间 docDisplay 清出场景图（防双显窗口期）
    expect(docOf(vm)).toBeUndefined();
    // 编辑期 text 落库触发的重绘：早退——不重建、不重画 Graphics、只挪位置
    vm.setState({ ...state2 });
    vm.flushUpdate();
    expect(docOf(vm)).toBeUndefined();
    expect(vm.root.x - vm.root.pivot.x).toBe(10);
  });

  it('退出编辑：refresh 强制全量恢复（写前 diff 下 state 无新变化 render 不跑）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.setTextEditing(true);
    vm.setState({ ...state2 }); // 编辑期错过的最新 state（render 早退吞掉）
    vm.flushUpdate();
    vm.setTextEditing(false); // 退出：refresh(state,state) 全量重建
    const doc = docOf(vm);
    expect(doc).toBeDefined();
    expect(doc!.visible).toBe(true);
  });
});

describe('shapeVm 纯平移快速路径（两档守卫，docs/16 同系列）', () => {
  /** 快速/全量区分探针：全量路径尾部 root.scale.set(1)，快速路径不碰——
   *  预置 scale=2 后看平移是否保留（快速）或复位（全量） */
  it('有文字平移：docDisplay 引用不变 + scale 不被复位', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    const doc = docOf(vm);
    vm.root.scale.set(2);
    vm.setState({ x: 55, y: 5 });
    vm.flushUpdate();
    expect(docOf(vm)).toBe(doc);
    expect(vm.root.x - vm.root.pivot.x).toBe(55);
    expect(vm.root.scale.x).toBe(2); // 快速路径未碰 scale
  });

  it('无文字平移：只比图形键，零 Graphics 重画（scale 探针同上）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...noTextState });
    vm.flushUpdate();
    expect(docOf(vm)).toBeUndefined();
    vm.root.scale.set(2);
    vm.setState({ x: 60 });
    vm.flushUpdate();
    expect(docOf(vm)).toBeUndefined();
    expect(vm.root.scale.x).toBe(2);
  });

  it('改色/加文字必走全量（守卫防漏双向锁 + 无文字档的 next 有字边界）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state });
    vm.flushUpdate();
    vm.root.scale.set(2);
    vm.setState({ color: '#c8ecd0' }); // 改填充色
    vm.flushUpdate();
    expect(vm.root.scale.x).toBe(1); // 全量路径复位 scale
    vm.setState({ ...noTextState, text: '<p>新文字</p>' }); // 无文字 → 加字
    vm.flushUpdate();
    expect(docOf(vm)).toBeDefined(); // 文字渲染（漏判即丢字）
  });
});

describe('旋转 pivot 语义（docs/05 §8——applyRootTransform/getBounds AABB/getLocalRect 拆分）', () => {
  const PI = Math.PI;

  it('θ=0：视觉左上 = 数据左上（与旧渲染逐字节等价）+ pivot=中心', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state, x: 100, y: 200 });
    vm.flushUpdate();
    expect(vm.root.pivot.x).toBe(60); // w/2
    expect(vm.root.pivot.y).toBe(40); // h/2
    expect(vm.root.x - vm.root.pivot.x).toBe(100);
    expect(vm.root.y - vm.root.pivot.y).toBe(200);
    expect(vm.root.rotation).toBe(0);
    expect(vm.getBounds()).toEqual({ x: 100, y: 200, width: 120, height: 80 });
    expect(vm.getLocalRect()).toEqual({ x: 100, y: 200, width: 120, height: 80 });
  });

  it('θ=90°：getBounds 宽高互换（世界 AABB）；getLocalRect 恒数据矩形', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state, x: 100, y: 200, rotation: PI / 2 } as typeof state);
    vm.flushUpdate();
    expect(vm.root.rotation).toBeCloseTo(PI / 2, 9);
    const b = vm.getBounds();
    expect(b.x).toBeCloseTo(100 + 60 - 40, 6); // 中心 x − h/2
    expect(b.y).toBeCloseTo(200 + 40 - 60, 6); // 中心 y − w/2
    expect(b.width).toBeCloseTo(80, 6);
    expect(b.height).toBeCloseTo(120, 6);
    expect(vm.getLocalRect()).toEqual({ x: 100, y: 200, width: 120, height: 80 });
  });

  it('θ=90°：hitTestPoint 逆变换——旋转后纵向长条内命中、旧横向范围不命中', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state, x: 100, y: 200, rotation: PI / 2 } as typeof state);
    vm.flushUpdate();
    const cx = 160,
      cy = 240; // 中心 = (100+60, 200+40)
    // θ=90° 后矩形占 [cx−40, cx+40]×[cy−60, cy+60]（40×120 纵条）
    expect(vm.hitTestPoint({ x: cx, y: cy - 55 } as never)).toBe(true);
    expect(vm.hitTestPoint({ x: cx, y: cy - 65 } as never)).toBe(false);
    expect(vm.hitTestPoint({ x: cx + 45, y: cy } as never)).toBe(false); // 旧横向右段
  });

  it('框选走旋转精判：θ=45° AABB 角落空区不命中（AABB 语义下会误选）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state, x: 100, y: 200, rotation: PI / 4 } as typeof state);
    vm.flushUpdate();
    const cx = 160,
      cy = 240;
    const half = (120 + 80) / 2 / Math.SQRT2; // AABB 半宽 = 半高 ≈ 70.71（正方形外接）
    // AABB 左上角空区：旋转实体（斜矩形）不覆盖，精判不选
    const corner = { x: cx - half + 1, y: cy - half + 1, width: 8, height: 8 };
    expect(vm.hitTestRect(corner as never)).toBe(false);
    // 实体中心区：命中
    expect(vm.hitTestRect({ x: cx - 5, y: cy - 5, width: 10, height: 10 } as never)).toBe(true);
  });
});

describe('getHostGeom 放平矩形（docs/05 §8 锚定链——θ≠0 反推曾错，行为锁）', () => {
  const PI = Math.PI;
  it('θ=90°：rect 以视觉中心对齐；anchorOf(rect, right, θ) = 视觉正下（中心 + w/2）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state, x: 100, y: 200, rotation: PI / 2 } as typeof state);
    vm.flushUpdate();
    const g = vm.getHostGeom();
    expect(g.rotation).toBeCloseTo(PI / 2, 9);
    // 中心 (160,240) 恒对齐（放平矩形 = 中心 + 轴对齐尺寸）
    expect(g.rect.x + g.rect.width / 2).toBeCloseTo(160, 6);
    expect(g.rect.y + g.rect.height / 2).toBeCloseTo(240, 6);
    // right 边中点（局部 +x）旋转 90° → 正下方：中心 + (0, w/2) = (160, 300)
    const a = anchorOf(g.rect, 'right', g.rotation);
    expect(a.x).toBeCloseTo(160, 6);
    expect(a.y).toBeCloseTo(300, 6);
  });
});

describe('流程图样式批（specs/flowchart-closeout §4.2：白底黑框/无填充/守卫键）', () => {
  it('改 borderColor/borderWidth/fill 各自触发全量重画（守卫键漏加 = 快速路径吞掉）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...noTextState });
    vm.flushUpdate();
    // 纯平移仍走快速路径（scale 探针不复位）
    vm.root.scale.set(2);
    vm.setState({ x: 30 });
    vm.flushUpdate();
    expect(vm.root.scale.x).toBe(2);
    for (const patch of [
      { borderColor: '#000000' },
      { borderWidth: 2 },
      { fill: 'none' as const },
    ]) {
      vm.root.scale.set(2);
      vm.setState(patch);
      vm.flushUpdate();
      expect(vm.root.scale.x).toBe(1); // 全量路径复位 scale
    }
  });

  it('fill none 后仍可命中/拖拽语义不变（bbox 命中，注释框预期）', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...noTextState, x: 100, y: 200, fill: 'none' });
    vm.flushUpdate();
    expect(vm.hitTestPoint({ x: 160, y: 240 } as never)).toBe(true); // 中心
    expect(vm.hitTestPoint({ x: 400, y: 400 } as never)).toBe(false); // 远处
  });
});

describe('主题版本守卫（specs/flowchart-closeout §16 二轮：无填充字色随主题）', () => {
  it('setTheme 后 render(state,state) 不被快速路径吞掉——docDisplay 重建换新字色', () => {
    const vm = new ShapeVm(null);
    vm.setState({ ...state }); // 有文字（守卫在 hasText 档）
    vm.flushUpdate();
    const doc0 = docOf(vm);
    expect(doc0).toBeDefined();
    // 模拟 setTheme → refreshAll：render(state,state) 同 state
    setTextTheme('dark');
    try {
      vm.refresh();
      const doc1 = docOf(vm);
      expect(doc1).toBeDefined();
      expect(doc1).not.toBe(doc0); // 全量重建（守卫缺失则快速路径早退、引用不变）
    } finally {
      setTextTheme('light'); // 复位保证测试隔离（theme.test 同款）
    }
    // 同主题版本下重复 refresh：同 state 走快速路径（docDisplay 引用不变）
    vm.refresh();
    expect(docOf(vm)).toBe(docOf(vm));
  });
});
