import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { anchorOf } from '../widgets/line/lineMath';
import {
  insetRectOf,
  resolveShapeTextStyle,
  shapeHeightFromTextHeight,
  ShapeVm,
  SHAPE_TEXT_FONT_SIZE,
  SHAPE_LINE_HEIGHT,
  SHAPE_TEXT_COLOR,
  SHAPE_TEXT_PADDING,
} from '../widgets/shape/shapeVm';

/** 图形内文字（docs/17 §6）：内接矩形数学 + 排版解析 + 编辑态消双显（纯逻辑） */

describe('insetRectOf 文字内接矩形（四型数学，既有设计 shapeTextCompute 行为）', () => {
  it('rect/round-rect：四边 padding', () => {
    expect(insetRectOf('rect', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 50 });
    expect(insetRectOf('round-rect', 120, 80)).toEqual(insetRectOf('rect', 120, 80));
  });

  it('ellipse：内接矩形 w/√2 × h/√2 居中', () => {
    const r = insetRectOf('ellipse', 100, 100);
    expect(r.width).toBeCloseTo(100 / Math.SQRT2, 6);
    expect(r.height).toBeCloseTo(100 / Math.SQRT2, 6);
    // 居中：x = (w - iw)/2
    expect(r.x).toBeCloseTo((100 - 100 / Math.SQRT2) / 2, 6);
  });

  it('diamond：半宽高中心箱', () => {
    expect(insetRectOf('diamond', 120, 80)).toEqual({ x: 30, y: 20, width: 60, height: 40 });
  });

  it('窄形状下限保护：maxWidth 至少 1（不产生非正宽）', () => {
    expect(insetRectOf('rect', 20, 80).width).toBeGreaterThanOrEqual(1);
  });
});

describe('triangle-up（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：下半中心箱 {w/4, h/2, w/2, h/2}', () => {
    expect(insetRectOf('triangle-up', 120, 80)).toEqual({ x: 30, y: 40, width: 60, height: 40 });
  });

  it('撑高公式 = textH×2（下半箱 h/2 ≥ textH 反解）', () => {
    expect(shapeHeightFromTextHeight('triangle-up', 60)).toBe(120);
  });
});

describe('triangle-down（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：上半中心箱 {w/4, 0, w/2, h/2}；撑高 textH×2', () => {
    expect(insetRectOf('triangle-down', 120, 80)).toEqual({ x: 30, y: 0, width: 60, height: 40 });
    expect(shapeHeightFromTextHeight('triangle-down', 60)).toBe(120);
  });
});

describe('parallelogram-right（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：{0.21w, 0.1h, 0.6w, 0.8h}；撑高 textH×1.25', () => {
    const r = insetRectOf('parallelogram-right', 200, 100);
    expect(r.x).toBeCloseTo(42, 6);
    expect(r.y).toBeCloseTo(10, 6);
    expect(r.width).toBeCloseTo(120, 6);
    expect(r.height).toBeCloseTo(80, 6);
    expect(shapeHeightFromTextHeight('parallelogram-right', 80)).toBe(100);
  });
});

describe('parallelogram-left（12 型扩展 docs/04 §8.2）', () => {
  it('内接与公式与 right 同款（镜像只影响绘制，内接箱对称）', () => {
    expect(insetRectOf('parallelogram-left', 200, 100)).toEqual(
      insetRectOf('parallelogram-right', 200, 100),
    );
    expect(shapeHeightFromTextHeight('parallelogram-left', 80)).toBe(100);
  });
});

describe('eng-database 圆柱（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：两椭圆头之间（大形状 e=54 饱和；小形状 h×0.3 钳制）', () => {
    const big = insetRectOf('eng-database', 200, 300); // 300×0.3=90 > 54 → e=54
    expect(big).toEqual({ x: 15, y: 69, width: 170, height: 162 });
    const small = insetRectOf('eng-database', 120, 80); // 80×0.3=24 → e=24
    expect(small).toEqual({ x: 15, y: 39, width: 90, height: 2 });
  });

  it('撑高公式 = textH+108+30（两头 54 + 上下 padding）', () => {
    expect(shapeHeightFromTextHeight('eng-database', 60)).toBe(198);
  });
});

describe('eng-queue 滚筒（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：两端之间矩形身（端宽钳制同步；y=20 视觉边距）', () => {
    const r = insetRectOf('eng-queue', 200, 100); // 200×0.3=60 > 54 → e=54
    expect(r).toEqual({ x: 69, y: 20, width: 62, height: 60 });
    const small = insetRectOf('eng-queue', 120, 80); // 120×0.3=36 → e=36
    expect(small).toEqual({ x: 51, y: 20, width: 18, height: 40 });
  });

  it('撑高公式 = textH+40（纵向只有视觉边距）', () => {
    expect(shapeHeightFromTextHeight('eng-queue', 60)).toBe(100);
  });
});

describe('stadium 起止胶囊（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让半端帽；撑高 textH+30', () => {
    expect(insetRectOf('stadium', 120, 80)).toEqual({ x: 20, y: 15, width: 80, height: 50 });
    expect(shapeHeightFromTextHeight('stadium', 60)).toBe(90);
  });
});

describe('document 文档（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：底部让波浪 c；撑高 textH+48（波 18 + padding 30）', () => {
    expect(insetRectOf('document', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 38 }); // c=min(18,12)=12 → 80-30-12
    expect(shapeHeightFromTextHeight('document', 60)).toBe(108);
  });
});

describe('hexagon 六边形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让斜宽 c；撑高 textH+30', () => {
    expect(insetRectOf('hexagon', 120, 80)).toEqual({ x: 30, y: 15, width: 60, height: 50 }); // c=min(30,40)=30
    expect(shapeHeightFromTextHeight('hexagon', 60)).toBe(90);
  });
});

describe('predefined-process 子过程（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让双竖线带 d；撑高 textH+30', () => {
    expect(insetRectOf('predefined-process', 120, 80)).toEqual({
      x: 27,
      y: 15,
      width: 66,
      height: 50,
    }); // d=min(12,12)=12
    expect(shapeHeightFromTextHeight('predefined-process', 60)).toBe(90);
  });
});

describe('trapezoid-down 下梯形（流程图八型 docs/04 §8.2）', () => {
  it('内接与公式与上梯形同款（镜像只影响绘制）；撑高 textH+30', () => {
    expect(insetRectOf('trapezoid-down', 120, 80)).toEqual(insetRectOf('trapezoid-up', 120, 80));
    expect(shapeHeightFromTextHeight('trapezoid-down', 60)).toBe(90);
  });
});

describe('delay 延迟 D 形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：右侧让弧侵食 h/4；撑高 textH+30', () => {
    expect(insetRectOf('delay', 120, 80)).toEqual({ x: 15, y: 15, width: 70, height: 50 }); // 120-30-80/4
    expect(shapeHeightFromTextHeight('delay', 60)).toBe(90);
  });

  it('侵蚀钳半宽：极端扁高下 inset 收敛不再无界收窄（32 轮 🟠-1）', () => {
    // 无钳制时 h=500 → 侵食 125 → 宽 120-30-125=-35（钳 1px 细条，正反馈发散）
    const half = (120 - 30) / 2; // 45
    expect(insetRectOf('delay', 120, 500).width).toBeCloseTo(half, 6);
    expect(insetRectOf('delay', 120, 1000).width).toBeCloseTo(half, 6); // 两轮 reflow 后稳定
    expect(insetRectOf('delay', 60, 240).width).toBeCloseTo(15, 6); // 小形状：min(60,15)=15
  });
});

describe('off-page 页连接（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：底部让尖区 c；撑高 textH+65（35+30）', () => {
    expect(insetRectOf('off-page', 120, 80)).toEqual({ x: 15, y: 15, width: 90, height: 22 }); // c=min(28,35)=28 → 80-30-28
    expect(shapeHeightFromTextHeight('off-page', 60)).toBe(125);
  });
});

describe('trapezoid-up 上梯形（流程图八型 docs/04 §8.2）', () => {
  it('insetRectOf：左右各让半腰 c/2；撑高 textH+30', () => {
    expect(insetRectOf('trapezoid-up', 120, 80)).toEqual({ x: 27, y: 15, width: 66, height: 50 }); // c=min(24,40)=24 → x=15+12
    expect(shapeHeightFromTextHeight('trapezoid-up', 60)).toBe(90);
  });
});

describe('eng-file 缺角页（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：折角下方矩形（f 钳制同步）；撑高 textH+50+30', () => {
    const r = insetRectOf('eng-file', 200, 150); // 200×0.3=60 > 50 → f=50
    expect(r).toEqual({ x: 15, y: 65, width: 170, height: 70 });
    const small = insetRectOf('eng-file', 120, 80); // 120×0.3=36 → f=36
    expect(small).toEqual({ x: 15, y: 51, width: 90, height: 14 });
    expect(shapeHeightFromTextHeight('eng-file', 60)).toBe(140);
  });
});

describe('eng-folder 文件夹（12 型扩展 docs/04 §8.2）', () => {
  it('insetRectOf：标签页下方矩形（t 钳制同步）；撑高 textH+40+30', () => {
    const r = insetRectOf('eng-folder', 200, 160); // 160×0.25=40 → t=40（恰饱和）
    expect(r).toEqual({ x: 15, y: 55, width: 170, height: 90 });
    const small = insetRectOf('eng-folder', 120, 80); // 80×0.25=20 → t=20
    expect(small).toEqual({ x: 15, y: 35, width: 90, height: 30 });
    expect(shapeHeightFromTextHeight('eng-folder', 60)).toBe(130);
  });
});

describe('shapeHeightFromTextHeight 撑高公式（docs/17 §6 autoHeight，2026-10-10 四点拍板）', () => {
  it('rect/round-rect = textH + 2×padding（textH 60 → 90）', () => {
    expect(shapeHeightFromTextHeight('rect', 60)).toBe(90);
    expect(shapeHeightFromTextHeight('round-rect', 60)).toBe(90);
  });

  it('ellipse = textH×√2（与 insetRectOf 的 h/√2 内接反解单源；弃既有设计保守 ×2）', () => {
    expect(shapeHeightFromTextHeight('ellipse', 60)).toBeCloseTo(60 * Math.SQRT2, 2);
    expect(shapeHeightFromTextHeight('ellipse', 60)).toBeLessThan(120); // ×2 口径会到 120
  });

  it('diamond = textH×2（半高箱 h/2 ≥ textH 反解，两口径等价）', () => {
    expect(shapeHeightFromTextHeight('diamond', 60)).toBe(120);
  });

  it('公式自洽：撑出的高度其内接高恰好容纳文字（四型逐型验证）', () => {
    const textH = 60;
    for (const t of [
      'rect',
      'round-rect',
      'ellipse',
      'diamond',
      'triangle-up',
      'triangle-down',
      'parallelogram-right',
      'parallelogram-left',
      'eng-database',
      'eng-queue',
      'eng-file',
      'eng-folder',
      'stadium',
      'document',
      'hexagon',
      'predefined-process',
      'trapezoid-up',
      'trapezoid-down',
      'delay',
      'off-page',
    ] as const) {
      const h = shapeHeightFromTextHeight(t, textH);
      expect(insetRectOf(t, 200, h).height).toBeGreaterThanOrEqual(textH - 0.01);
    }
  });
});

describe('resolveShapeTextStyle（override → 图形常量默认）', () => {
  it('无 override 全默认（16/1.5/#333，不主题化）', () => {
    expect(resolveShapeTextStyle({})).toEqual({
      fontFamily: 'sans-serif',
      fontSize: SHAPE_TEXT_FONT_SIZE,
      lineHeight: SHAPE_LINE_HEIGHT,
      color: SHAPE_TEXT_COLOR,
    });
  });

  it('override 优先', () => {
    expect(resolveShapeTextStyle({ fontSize: 24, textColor: '#fff', lineHeight: 2 })).toMatchObject(
      {
        fontSize: 24,
        color: '#fff',
        lineHeight: 2,
      },
    );
  });

  it('padding 常量语义：rect 内缩 = w - 2×15', () => {
    const r = insetRectOf('rect', 100, 100);
    expect(r.width).toBe(100 - SHAPE_TEXT_PADDING * 2);
  });
});

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
