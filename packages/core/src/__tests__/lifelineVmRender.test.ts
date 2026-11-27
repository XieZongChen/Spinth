// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Graphics, Point, Rectangle, Text } from 'pixi.js';
import { LifelineVm } from '../widgets/sequence/lifelineVm';
import {
  constrainLifelineResize,
  lifelineAxisHitHalf,
  LIFELINE_LABEL_PAD_X,
  LIFELINE_HEAD_HEIGHT,
} from '../widgets/sequence/lifelineGeometry';
import { setTextTheme } from '../platform/textEngine/theme';
import { collectRouteObstacles } from '../widgets/line/lineRoute';
import { LINE_END_GAP } from '../widgets/line/linePath';
import type { IRect } from '../common/geometry';

/**
 * LifelineVm 渲染 / 命中 / 探针（specs/sequence-diagram §3.3 / §3.5 / §3.6，批次 1；
 * 轴锚点 §3.2 / §4.1，批次 2）。
 * 世界矩形 (200,100,120,520)：头框 y 100…136，轴 x = 260、y 136…620。
 */

const state = {
  id: 'l1',
  type: 'LIFELINE' as const,
  zOrder: 'a0',
  label: '用户',
  x: 200,
  y: 100,
  width: 120,
  height: 520,
};

/** labelText 是 root 上唯一非 Graphics 子节点（frameVmRender.titleOf 同款口径） */
const labelOf = (vm: LifelineVm): Text | undefined =>
  vm.root.children.find((c) => !(c instanceof Graphics)) as Text | undefined;

function make(
  getScale: () => number = () => 1,
  barsOf: (id: string) => IRect[] = () => [],
): LifelineVm {
  const vm = new LifelineVm(getScale, { barsOf });
  vm.setState({ ...state });
  vm.flushUpdate();
  return vm;
}

describe('渲染（§3.6：头框 + 居中标签 + 竖直虚线轴）', () => {
  it('有标签挂 Text，居中在头框标签区；空标签不挂', () => {
    const vm = make();
    const label = labelOf(vm);
    expect(label?.text).toBe('用户');
    // anchor (0.5, 0.5) 落在标签区中心：x = 8 + 104 / 2，y = 36 / 2
    expect(label?.x).toBe(LIFELINE_LABEL_PAD_X + (120 - LIFELINE_LABEL_PAD_X * 2) / 2);
    expect(label?.y).toBe(LIFELINE_HEAD_HEIGHT / 2);
    vm.setState({ ...state, label: '' });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeUndefined();
  });

  it('超宽标签渲染前截断加省略号（数据恒存完整标签）', () => {
    const vm = make();
    vm.setState({ ...state, label: 'abcdefghijklmnop' });
    vm.flushUpdate();
    expect(labelOf(vm)?.text.endsWith('…')).toBe(true);
    expect(vm.state.label).toBe('abcdefghijklmnop');
  });

  it('纯平移快速路径：只挪 root，不重建标签节点', () => {
    const vm = make();
    const before = labelOf(vm);
    vm.setState({ ...state, x: 260 });
    vm.flushUpdate();
    expect(labelOf(vm)).toBe(before);
    expect(vm.root.x - vm.root.pivot.x).toBe(260);
  });

  it('主题切换走全量重绘（renderedThemeVer 守卫：轴色随主题墨色）', () => {
    const vm = make();
    const before = labelOf(vm);
    setTextTheme('dark');
    try {
      vm.refresh(); // setTheme 的 refreshAll = render(state, state)，无守卫会被快速路径吞掉
      expect(labelOf(vm)).not.toBe(before);
    } finally {
      setTextTheme('light');
    }
  });

  it("head 'actor' 不抛错：本批按头区 72 的框渲染，标签落在小人下方的标签带", () => {
    const vm = new LifelineVm();
    expect(() => {
      vm.setState({ ...state, head: 'actor' });
      vm.flushUpdate();
    }).not.toThrow();
    expect(labelOf(vm)?.y).toBe(36 + 18);
  });

  it('退化尺寸不抛错（宽 < 24 标签为空；高 < 头高无轴）', () => {
    const vm = new LifelineVm();
    expect(() => {
      vm.setState({ ...state, width: 10, height: 520 });
      vm.flushUpdate();
      expect(labelOf(vm)).toBeUndefined();
      vm.setState({ ...state, width: 120, height: 20 });
      vm.flushUpdate();
      vm.setState({ ...state, width: 0, height: 0 });
      vm.flushUpdate();
    }).not.toThrow();
  });
});

describe('setLabelEditing 编辑期节能早退（§3.7，FRAME 标题同模式）', () => {
  it('进编辑清出画布标签；编辑期 render 不重建、只挪位置；退出全量恢复', () => {
    const vm = make();
    expect(labelOf(vm)).toBeDefined();
    vm.setLabelEditing(true);
    expect(labelOf(vm)).toBeUndefined();
    vm.setState({ ...state, x: 210 });
    vm.flushUpdate();
    expect(labelOf(vm)).toBeUndefined();
    expect(vm.root.x - vm.root.pivot.x).toBe(210);
    vm.setLabelEditing(false);
    expect(labelOf(vm)?.text).toBe('用户');
  });
});

describe('点命中 = 头框 ∪ 轴带（§3.3）', () => {
  it('头框整条宽都命中；轴带内命中；轴旁空白与 bbox 外不命中', () => {
    const vm = make();
    expect(vm.hitTestPoint(new Point(215, 118))).toBe(true); // 头框左端（远离轴）
    expect(vm.hitTestPoint(new Point(260, 400))).toBe(true); // 轴
    expect(vm.hitTestPoint(new Point(265.5, 400))).toBe(true); // 半宽 6 内
    expect(vm.hitTestPoint(new Point(267, 400))).toBe(false);
    expect(vm.hitTestPoint(new Point(230, 400))).toBe(false); // bbox 内、轴带外
    expect(vm.hitTestPoint(new Point(260, 630))).toBe(false); // bbox 之下
  });

  it('轴带半宽按屏幕 px 折算、每次现算：放大不无限变细、深缩放有上限', () => {
    let scale = 4;
    const vm = make(() => scale);
    expect(lifelineAxisHitHalf(scale)).toBe(6);
    expect(vm.hitTestPoint(new Point(265, 400))).toBe(true);
    expect(vm.hitTestPoint(new Point(268, 400))).toBe(false);
    scale = 0.25; // 6 / 0.25 = 24 = 上限
    expect(vm.hitTestPoint(new Point(240, 400))).toBe(true); // |240 − 260| = 20 ≤ 24
    expect(vm.hitTestPoint(new Point(230, 400))).toBe(false); // 30 > 24
  });

  it('缩放预览期命中跟随视觉几何（root.scale，旋转恒 0）', () => {
    const vm = make();
    // 预览 ×2：视觉矩形 (300,200,240,1040)，头框 y 200…272，轴移到 x = 420
    vm.applyResizePreview(state, { x: 300, y: 200, width: 240, height: 1040 });
    expect(vm.hitTestPoint(new Point(420, 1200))).toBe(true); // 数据矩形之外的轴段
    expect(vm.hitTestPoint(new Point(530, 230))).toBe(true); // 头框右端
    expect(vm.hitTestPoint(new Point(420, 150))).toBe(false); // 视觉矩形之上
    expect(vm.hitTestPoint(new Point(260, 400))).toBe(false); // 数据矩形的旧轴位
    expect(vm.getBounds()).toEqual({ x: 300, y: 200, width: 240, height: 1040 });
  });
});

describe('框选命中同口径（不用整 bbox）', () => {
  it('碰头旁空白入选、擦过轴带入选、只碰轴旁空白不入选', () => {
    const vm = make();
    const r = (x: number, y: number, w: number, h: number) => new Rectangle(x, y, w, h);
    expect(vm.hitTestRect(r(205, 105, 10, 10))).toBe(true);
    expect(vm.hitTestRect(r(240, 300, 30, 40))).toBe(true);
    expect(vm.hitTestRect(r(210, 300, 30, 40))).toBe(false);
    expect(vm.hitTestRect(r(400, 300, 50, 50))).toBe(false);
  });
});

describe('探针（§3.5 / §3.6）', () => {
  const start: IRect = { x: 200, y: 100, width: 120, height: 520 };

  it('constrainResize 接纯函数 constrainLifelineResize（宽度以轴对称、下限 60×120）', () => {
    const vm = make();
    expect(typeof vm.constrainResize).toBe('function');
    const cases: Array<[IRect, Parameters<NonNullable<LifelineVm['constrainResize']>>[2]]> = [
      [{ x: 200, y: 100, width: 180, height: 520 }, 'e'],
      [{ x: 140, y: 100, width: 180, height: 520 }, 'w'],
      [{ x: 200, y: 100, width: 120, height: 30 }, 's'],
      [{ x: 200, y: 590, width: 120, height: 30 }, 'n'],
      [{ x: 200, y: 60, width: 180, height: 560 }, 'ne'],
    ];
    for (const [next, dir] of cases) {
      expect(vm.constrainResize!(start, next, dir), dir).toEqual(
        constrainLifelineResize(start, next, dir),
      );
    }
    // e 手柄：右边 380 到轴 260 距离 120 → 宽 240、x = 140（轴 x 不动）
    expect(vm.constrainResize!(start, { x: 200, y: 100, width: 180, height: 520 }, 'e')).toEqual({
      x: 140,
      y: 100,
      width: 240,
      height: 520,
    });
  });

  it('isRouteObstacle 恒 false：通用折线不把生命线当障碍', () => {
    const vm = make();
    expect(vm.isRouteObstacle()).toBe(false);
    vm.setState({ ...state, x: 260, y: 0, width: 120, height: 520 });
    vm.flushUpdate(); // bbox (260,0,120,520) 正压在 (200,60)→(300,60) 的通道上
    const plain = {
      id: 'p1',
      type: 'SHAPE',
      getHostGeom: () => ({ rect: { x: 160, y: 0, width: 40, height: 40 }, rotation: 0 }),
    };
    const out = collectRouteObstacles(
      { getVmsInRect: () => [vm, plain] } as never,
      { x: 200, y: 60 },
      { x: 300, y: 60 },
      'v1_1',
      null,
    );
    expect(out).toEqual([{ x: 160, y: 0, width: 40, height: 40 }]);
  });
});

describe('几何（rect 型语义，旋转恒 0）', () => {
  it('getBounds / getLocalRect / getHostGeom = 数据矩形', () => {
    const vm = make();
    expect(vm.getBounds()).toEqual({ x: 200, y: 100, width: 120, height: 520 });
    expect(vm.getLocalRect()).toEqual({ x: 200, y: 100, width: 120, height: 520 });
    expect(vm.getHostGeom()).toEqual({
      rect: { x: 200, y: 100, width: 120, height: 520 },
      rotation: 0,
    });
    expect(vm.getRotation()).toBe(0);
  });

  it('轴锚点（§3.2）：四个 join 的 t 都是轴上高度比例；横向让出一个线端留隙', () => {
    const vm = make();
    // 轴 x = 260、轴段 y 136…620：t=0.5 → 378、t=0.25 → 257
    expect(vm.getAnchorPoint('top', 0.5)).toEqual({ x: 260, y: 378 });
    expect(vm.getAnchorPoint('bottom', 0)).toEqual({ x: 260, y: 136 });
    expect(vm.getAnchorPoint('right', 0.25)).toEqual({ x: 260 - LINE_END_GAP, y: 257 });
    expect(vm.getAnchorPoint('left', 1)).toEqual({ x: 260 + LINE_END_GAP, y: 620 });
  });

  it('getAxisAnchor（§4.1 探针）：轴 = 头框底边到 bbox 底边；显式几何优先', () => {
    const vm = make();
    expect(vm.getAxisAnchor()).toEqual({ x: 260, top: 136, bottom: 620 });
    expect(
      vm.getAxisAnchor({ rect: { x: 0, y: 0, width: 100, height: 200 }, rotation: 0 }),
    ).toEqual({ x: 50, top: 36, bottom: 200 });
    // 轴长 < 1 = 无轴
    expect(
      vm.getAxisAnchor({ rect: { x: 0, y: 0, width: 100, height: 36.5 }, rotation: 0 }),
    ).toBeNull();
  });

  it('退化件（轴长 < 1）回落基类的 bbox 锚点', () => {
    const vm = make();
    vm.setState({ ...state, height: 30 });
    vm.flushUpdate();
    expect(vm.getAxisAnchor()).toBeNull();
    expect(vm.getAnchorPoint('top', 0.5)).toEqual({ x: 260, y: 100 });
    expect(vm.getAnchorPoint('left', 0.5)).toEqual({ x: 200, y: 115 });
  });

  it('激活条让位：纵向覆盖锚点高度的条取最大半宽（本批 barsOf 恒空，查询经构造注入）', () => {
    const vm = make(
      () => 1,
      // 桩环境没有 model（vm.id 为 ''）——查询不按 id 过滤
      () => [
        { x: 255, y: 300, width: 10, height: 100 }, // 覆盖 y 300…400，半宽 5
        { x: 248, y: 600, width: 24, height: 10 }, // 覆盖 y 600…610，半宽 12
      ],
    );
    // y = 378 被第一条覆盖：x = 轴 + (5 − 留隙) = 轴（箭头停在条边）
    expect(vm.getAnchorPoint('right', 0.5)).toEqual({ x: 260, y: 378 });
    // y ≈ 604.6 被第二条覆盖：x = 轴 + (12 − 留隙)
    expect(vm.getAnchorPoint('right', 0.969)).toEqual({ x: 267, y: 136 + 484 * 0.969 });
    // y = 136 不被任何条覆盖：让出一个留隙
    expect(vm.getAnchorPoint('right', 0)).toEqual({ x: 260 - LINE_END_GAP, y: 136 });
  });

  it('dispose 不抛错', () => {
    const vm = make();
    expect(() => vm.dispose()).not.toThrow();
  });
});
