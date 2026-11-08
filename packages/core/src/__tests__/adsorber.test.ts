import { describe, expect, it } from 'vitest';
import {
  buildRefLines,
  snapRect,
  snapResize,
  type IStickyRefLines,
} from '../platform/refLine/adsorber';

describe('buildRefLines（docs/06 §2）', () => {
  it('每矩形生成 6 条线且按 3 位小数去重', () => {
    const refs = buildRefLines([
      { x: 100, y: 50, width: 200, height: 100 },
      { x: 100, y: 50, width: 200, height: 100 }, // 完全重叠 → 去重
    ]);
    expect(refs.v).toHaveLength(3); // left/center/right
    expect(refs.h).toHaveLength(3);
    expect(refs.v.map((l) => l.pos).sort((a, b) => a - b)).toEqual([100, 200, 300]);
  });

  it('kind 标记：边线 edge、中线 center', () => {
    const refs = buildRefLines([{ x: 0, y: 0, width: 100, height: 100 }]);
    expect(refs.v.find((l) => l.pos === 0)?.kind).toBe('edge');
    expect(refs.v.find((l) => l.pos === 50)?.kind).toBe('center');
  });
});

describe('snapRect 拖拽吸附（docs/06 §3）', () => {
  const refs = buildRefLines([{ x: 300, y: 300, width: 100, height: 50 }]);

  it('阈值内吸附：左边贴上参照左边（阈值 6）', () => {
    // 拖拽矩形左边 296 → 参照边 300，dist=4 在阈值内
    const r = snapRect({ x: 296, y: 0, width: 50, height: 50 }, 0, 0, refs, 6);
    expect(r.dx).toBe(4);
    expect(r.matchedV).toEqual([300]);
  });

  it('阈值外不吸附', () => {
    const r = snapRect({ x: 290, y: 0, width: 50, height: 50 }, 0, 0, refs, 6);
    expect(r.dx).toBe(0);
    expect(r.matchedV).toHaveLength(0);
  });

  it('边↔中心互吸：被拖中心可吸参照边，被拖边可吸参照中心', () => {
    // 同 kind 对齐照常：中心 352 距参照中心 350 为 2 → 整条对齐
    const r1 = snapRect({ x: 302, y: 0, width: 100, height: 50 }, 0, 0, refs, 6);
    expect(r1.dx).toBe(-2);
    expect(r1.matchedV).toHaveLength(1);
    // 被拖中心 301 吸参照边 300（旧 kind 隔离不允许）
    const centerToEdge = snapRect({ x: 251, y: 0, width: 100, height: 50 }, 0, 0, refs, 6);
    expect(centerToEdge.dx).toBe(-1);
    expect(centerToEdge.matchedV).toEqual([300]);
    // 被拖左边 348 吸参照中心 350
    const edgeToCenter = snapRect({ x: 348, y: 0, width: 40, height: 50 }, 0, 0, refs, 6);
    expect(edgeToCenter.dx).toBe(2);
    expect(edgeToCenter.matchedV).toEqual([350]);
  });

  it('完全贴合：修正为 0 但参考线仍命中（对准瞬间反馈不消失）', () => {
    const r = snapRect({ x: 300, y: 0, width: 100, height: 50 }, 0, 0, refs, 6);
    expect(r.dx).toBe(0);
    expect(r.matchedV).toEqual([300]);
  });

  it('亚像素缝隙（<0.5 屏幕 px）照常贴合修正', () => {
    // 旧口径 epsilon 跳过会让 0.3 缝隙不修正——阈值内一律修正，贴合反馈不消失
    const r = snapRect({ x: 300.3, y: 0, width: 50, height: 50 }, 0, 0, refs, 6);
    expect(r.dx).toBeCloseTo(-0.3, 6);
    expect(r.matchedV).toEqual([300]);
  });

  it('修正作用于位移而非原地：dx 传入后期望位参与比较', () => {
    // 初始 x=0，dx=296 → 期望左边 296 → 吸附到 300，修正 dx=300
    const r = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 296, 0, refs, 6);
    expect(r.dx).toBe(300);
  });

  it('方向感知（A3）：向右拖不被身后的线回拽；反向拖该线在前方可吸附', () => {
    // 矩形 x=302，线在 300（身后 4px，阈值内）
    // 向右拖 dx=+2 → 期望位 304，旧口径双侧取最近会回拽到 300（dx=-2）；
    // 新口径只取前方线 → 不吸附
    const right = snapRect({ x: 302, y: 0, width: 50, height: 50 }, 2, 0, refs, 6);
    expect(right.dx).toBe(2);
    expect(right.matchedV).toHaveLength(0);
    // 向左拖 dx=-8（x=410 → 期望位 402）：线 400 在移动方向前方（dist -2）→ 吸附
    const left = snapRect({ x: 410, y: 0, width: 50, height: 50 }, -8, 0, refs, 6);
    expect(left.dx).toBe(-10);
    expect(left.matchedV).toEqual([400]);
  });

  it('方向死区：净位移 1px（< threshold/3）时身后的线也可吸附', () => {
    // 拖拽初段/纯垂直拖的水平抖动 |dx|=1：死区内双侧候选 → 身后 3px 的线拉回
    const r = snapRect({ x: 302, y: 0, width: 50, height: 50 }, 1, 0, refs, 6);
    expect(r.dx).toBe(-2);
    expect(r.matchedV).toEqual([300]);
  });

  it('方向死区外：身后的线仍被过滤（A3 保持）', () => {
    const r = snapRect({ x: 302, y: 0, width: 50, height: 50 }, 4, 0, refs, 6);
    expect(r.dx).toBe(4);
    expect(r.matchedV).toHaveLength(0);
  });

  it('粘滞语义行为锁（A4 勘误）：已吸附反向轻移不脱离，退过阈值才释放', () => {
    // docs/06 原「粘滞暂未实现」断言基于单侧匹配的错误假设——实际阈值内双侧
    // 匹配天然提供 approach 侧 glue（反向轻移 dist 仍在阈值内 → 保持吸附）；
    // A3 方向感知补上越过侧的平滑释放。钉死两段语义防回归：
    const engage = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 296, 0, refs, 6);
    expect(engage.dx).toBe(300); // 296 吸合到 300
    const retreat = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 297, 0, refs, 6);
    expect(retreat.dx).toBe(300); // 反向轻移 3px：仍钉在线上（glue）
    expect(retreat.matchedV).toEqual([300]);
    const escape = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 293, 0, refs, 6);
    expect(escape.dx).toBe(293); // 退过阈值（dist 7 > 6）→ 释放跟手
    expect(escape.matchedV).toHaveLength(0);
  });

  it('粘滞：过线 2px 上一帧命中线绕过方向过滤被拉回', () => {
    // frame1 已吸上 300（接近侧），frame2 指针过线 2px：dist=-4 原被 A3 过滤脱钩；
    // sticky 入参让上一帧命中线双向保持 → 拉回线上
    const sticky: IStickyRefLines = { v: [{ pos: 300, kind: 'edge' }], h: [] };
    const r = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 302, 0, refs, 6, sticky);
    expect(r.dx).toBe(300);
    expect(r.matchedV).toEqual([300]);
    expect(r.matchedVDefs).toEqual([{ pos: 300, kind: 'edge' }]);
  });

  it('粘滞：过线 5px 仍保持，越阈 7px 平滑释放', () => {
    const sticky: IStickyRefLines = { v: [{ pos: 300, kind: 'edge' }], h: [] };
    const hold = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 305, 0, refs, 6, sticky);
    expect(hold.dx).toBe(300);
    expect(hold.matchedV).toEqual([300]);
    const escape = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 307, 0, refs, 6, sticky);
    expect(escape.dx).toBe(307);
    expect(escape.matchedV).toHaveLength(0);
  });

  it('粘滞仅在传入 sticky 时生效：无入参过线不回吸（A3 保持）', () => {
    const r = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 302, 0, refs, 6);
    expect(r.dx).toBe(302);
    expect(r.matchedV).toHaveLength(0);
  });

  it('粘滞不排斥更近的新线：|dist| 小者胜', () => {
    // 线 300（sticky）与线 306 并存：指针 304 → 306 更近（2 < 4）→ 切换
    const two = buildRefLines([
      { x: 300, y: 300, width: 50, height: 50 },
      { x: 306, y: 300, width: 50, height: 50 },
    ]);
    const sticky: IStickyRefLines = { v: [{ pos: 300, kind: 'edge' }], h: [] };
    const r = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 304, 0, two, 6, sticky);
    expect(r.dx).toBe(306);
    expect(r.matchedV).toEqual([306]);
  });

  it('中心线粘滞同样生效（kind 随线保持）', () => {
    // 被拖中心 356 过参照中心 350 为 dist=-6（阈值边界）：center 线 sticky 拉回
    const sticky: IStickyRefLines = { v: [{ pos: 350, kind: 'center' }], h: [] };
    const r = snapRect({ x: 302, y: 0, width: 100, height: 50 }, 4, 0, refs, 6, sticky);
    expect(r.dx).toBe(-2);
    expect(r.matchedV).toEqual([350]);
  });

  it('幂等（docs/14 规则 3）：同输入（含 sticky）重复调用结果一致', () => {
    const sticky: IStickyRefLines = { v: [{ pos: 300, kind: 'edge' }], h: [] };
    const a = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 302, 0, refs, 6, sticky);
    const b = snapRect({ x: 0, y: 0, width: 50, height: 50 }, 302, 0, refs, 6, sticky);
    expect(b).toEqual(a);
  });

  it('反抖动阈值屏幕化（A2）：zoom 4x 下 0.4 世界缝隙（1.6 屏幕 px）仍被贴合', () => {
    // threshold = 6/4 = 1.5；旧口径 epsilon=0.5 世界 → 0.4 判「已对齐」不修正
    // （zoom 4x 下 = 1.6 屏幕 px 可见缝隙——「对齐有误差」主诉）；新口径
    // epsilon = 1.5/12 = 0.125 → 0.4 > 0.125 照常吸附
    const r = snapRect({ x: 299.6, y: 0, width: 50, height: 50 }, 0, 0, refs, 1.5);
    expect(r.dx).toBeCloseTo(0.4, 6);
    expect(r.matchedV).toEqual([300]);
  });
});

describe('snapResize 缩放吸附（docs/06 §3）', () => {
  const refs = buildRefLines([{ x: 300, y: 300, width: 100, height: 50 }]);

  it('拖东边（e）：右边贴参照边', () => {
    const out = snapResize({ x: 0, y: 0, width: 297, height: 50 }, 'e', refs, 6);
    expect(out.rect.width).toBe(300);
    expect(out.matchedV).toEqual([300]);
  });

  it('拖西边（w）：左边贴参照边且宽度联动', () => {
    const out = snapResize({ x: 303, y: 0, width: 100, height: 50 }, 'w', refs, 6);
    expect(out.rect.x).toBe(300);
    expect(out.rect.width).toBe(103);
  });

  it('未拖动的边不参与（n/s 拖动不影响垂直线）', () => {
    const out = snapResize({ x: 296, y: 0, width: 50, height: 50 }, 's', refs, 6);
    expect(out.rect.x).toBe(296);
    expect(out.matchedV).toHaveLength(0);
  });

  it('吸附不小于最小尺寸', () => {
    // 宽 5 的矩形拖 w 边吸附到 300 会得到负宽 → 拒绝
    const out = snapResize({ x: 302, y: 0, width: 5, height: 50 }, 'w', refs, 6);
    expect(out.rect.x).toBe(302);
    expect(out.matchedV).toHaveLength(0);
  });

  it('缩放边可吸参照中心线（边↔中心互吸同口径）', () => {
    // 右边 347 → 参照中心 350（dist 3）
    const out = snapResize({ x: 0, y: 0, width: 347, height: 50 }, 'e', refs, 6);
    expect(out.rect.width).toBe(350);
    expect(out.matchedV).toEqual([350]);
  });

  it('精确贴合（dist 0）仍命中并画线', () => {
    const out = snapResize({ x: 0, y: 0, width: 300, height: 50 }, 'e', refs, 6);
    expect(out.rect.width).toBe(300);
    expect(out.matchedV).toEqual([300]);
  });

  it('最近线越 minSize 时回退到次近有效线', () => {
    // 参照 x300 宽 12：线 300(边)/306(中)/312(边)。拖 w 边于 304：中心 306 最近（2）
    // 但吸后宽 7 < 8 无效 → 回退到更远的有效边线 300（4），宽 13
    const narrow = buildRefLines([{ x: 300, y: 300, width: 12, height: 50 }]);
    const out = snapResize({ x: 304, y: 0, width: 9, height: 50 }, 'w', narrow, 6, 8);
    expect(out.rect.x).toBe(300);
    expect(out.rect.width).toBe(13);
    expect(out.matchedV).toEqual([300]);
  });
});
