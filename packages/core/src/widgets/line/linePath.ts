import type { IRect } from '../../common/geometry';
import type { IPt } from './lineMathTypes';
import { clipSegmentToRect, pathLength, segmentDirection } from './lineGeometry';

/** 连线路径域（docs/08 §4/§6）：视图语义路径（effectivePath）/ 视觉端点收缩 /
 *  曲线线型 / ratio 定位与反算 / 镂空与虚线切分。依赖 lineGeometry 的裁剪、
 *  长度度量与段方向。 */

/**
 * 视图语义路径：STRAIGHT = 首尾两点；CURVE = 贝塞尔 flatten 折线（批次 4）。
 * points 中可能残留 ELBOWED 时代的拐点（切型不重写 points——数据保留让切回
 * ELBOWED 可恢复/重路由），渲染/命中/几何一律按视觉语义取退化路径。曾因虚线
 * 切分沿残留拐点逐段切分，直线切虚线「变回」折线、且切型视觉无差异
 * （2026-09 用户实测揪出）。
 */
export function effectivePath(pts: IPt[], lineType: 'STRAIGHT' | 'ELBOWED' | 'CURVE'): IPt[] {
  if (lineType === 'CURVE') return flattenCurve(curveControlPoints(pts));
  if (lineType === 'STRAIGHT' && pts.length > 2) return [pts[0]!, pts[pts.length - 1]!];
  return pts;
}

/** 视觉端点空隙（世界像素，2026-09-30 用户拍板两轮定稿）：线两端不直接顶到
 *  元素，留出端点圆按钮的半径——R4 + 白描边 1 = 视觉半径 5，线端正好抵着
 *  按钮边缘（首版 12 偏大被用户打回）。与 ELBOW_RADIUS/KNOCKOUT_PADDING
 *  同为先例：lineVm 视觉常量世界固定。 */
export const LINE_END_GAP = 5;

/**
 * 视觉端点收缩：两端各沿首/末段方向缩进 min(gap, 段长/2)——**只作用于渲染
 * 路径**（stroke/箭头/镂空切分的输入），points 数据、命中检测、段滑移、
 * 锚定语义一律不受影响（端点圆按钮画在原端点上，正嵌在空隙里）。
 */
export function insetEnds(pts: readonly IPt[], gap: number): IPt[] {
  const out = pts.map((p) => ({ ...p }));
  const n = out.length;
  if (n < 2) return out;
  const a0 = out[0]!;
  const b0 = out[1]!;
  const len0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  if (len0 > 0) {
    const g = Math.min(gap, len0 / 2);
    out[0] = { x: a0.x + ((b0.x - a0.x) / len0) * g, y: a0.y + ((b0.y - a0.y) / len0) * g };
  }
  const a1 = out[n - 1]!;
  const b1 = out[n - 2]!;
  const len1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  if (len1 > 0) {
    const g = Math.min(gap, len1 / 2);
    out[n - 1] = { x: a1.x + ((b1.x - a1.x) / len1) * g, y: a1.y + ((b1.y - a1.y) / len1) * g };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 曲线线型（docs/08 §4 批次 4，参考图三 S 形）：三次贝塞尔
// ---------------------------------------------------------------------------

/** 控制臂长系数：控制点距端点的距离 = 两端距 × 0.4（视觉拍板：S 弯平滑不过垂） */
const CURVE_ARM = 0.4;

/**
 * 贝塞尔控制点（[p0, c1, c2, p3]）：切向 = pts 相邻点方向——锚定线的走廊点
 * （pts[1]/pts[n-2]）恰好是锚定边法向（routeElbow 沿 join 外扩 30px 生成），
 * 故 ELBOWED 切 CURVE 自然得到 S 形；两点线（无切向信息）退化为直线。
 */
export function curveControlPoints(pts: readonly IPt[]): [IPt, IPt, IPt, IPt] {
  const p0 = pts[0] ?? { x: 0, y: 0 };
  const p3 = pts[pts.length - 1] ?? p0;
  const dir = (a: IPt, b: IPt): IPt => segmentDirection(a, b);
  const d0 = pts.length > 2 ? dir(p0, pts[1]!) : dir(p0, p3);
  const d3 = pts.length > 2 ? dir(p3, pts[pts.length - 2]!) : dir(p3, p0);
  const arm = Math.hypot(p3.x - p0.x, p3.y - p0.y) * CURVE_ARM;
  return [
    { ...p0 },
    { x: p0.x + d0.x * arm, y: p0.y + d0.y * arm },
    { x: p3.x + d3.x * arm, y: p3.y + d3.y * arm },
    { ...p3 },
  ];
}

/** 三次贝塞尔 flatten 采样（渲染/命中/文字度量共用折线管线；24 段弦高
 *  误差 < 0.3% 视觉平滑；短弦被 majorSegments 过滤 → 曲线无段条） */
export function flattenCurve(ctrl: readonly [IPt, IPt, IPt, IPt], samples = 24): IPt[] {
  const [a, b, c, d] = ctrl;
  const out: IPt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({
      x: a.x * w0 + b.x * w1 + c.x * w2 + d.x * w3,
      y: a.y * w0 + b.y * w1 + c.y * w2 + d.y * w3,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 路径度量：ratio 定位 / 反算（线上文字，docs/08 §6）
// ---------------------------------------------------------------------------

/** ratio（0~1）→ 路径上点及其行进方向（文字锚定用） */
export function pointAtRatio(pts: IPt[], ratio: number): { point: IPt; dir: IPt } {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) {
    return { point: { ...(pts[0] ?? { x: 0, y: 0 }) }, dir: { x: 1, y: 0 } };
  }
  let target = Math.max(0, Math.min(1, ratio)) * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= segLen || i + 2 === pts.length) {
      const t = segLen === 0 ? 0 : target / segLen;
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        dir: segmentDirection(a, b),
      };
    }
    target -= segLen;
  }
  return { point: { ...pts[pts.length - 1]! }, dir: { x: 1, y: 0 } };
}

/** 路径上离 p 最近点 → ratio（双击位置反算，docs/08 §6） */
export function ratioAtPoint(pts: IPt[], p: IPt): number {
  const total = pathLength(pts);
  if (total === 0) return 0.5;
  let acc = 0;
  let best = { dist2: Infinity, ratio: 0.5 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t = segLen === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / (segLen * segLen);
    t = Math.max(0, Math.min(1, t));
    const ex = p.x - (a.x + t * dx);
    const ey = p.y - (a.y + t * dy);
    const d2 = ex * ex + ey * ey;
    if (d2 < best.dist2) best = { dist2: d2, ratio: (acc + t * segLen) / total };
    acc += segLen;
  }
  return Math.max(0, Math.min(1, best.ratio));
}

// ---------------------------------------------------------------------------
// 路径切分：镂空（线上文字）与虚线
// ---------------------------------------------------------------------------

/**
 * 挖空切分：路径中与矩形相交的部分剔除（线上文字镂空，docs/08 §6）。
 * 返回若干条连续可见折线（顺序保持；段全在矩形内时整段剔除）。
 */
export function slicePathExcludingRect(pts: IPt[], rect: IRect): IPt[][] {
  const pieces: IPt[][] = [];
  let cur: IPt[] = [];
  const flush = (): void => {
    if (cur.length >= 2) pieces.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const clip = clipSegmentToRect(a, b, rect.x, rect.y, rect.width, rect.height);
    if (!clip) {
      if (cur.length === 0) cur.push({ ...a });
      cur.push({ ...b });
      continue;
    }
    const { t0, t1 } = clip;
    const at = (t: number): IPt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (t0 > 1e-6) {
      cur.push(at(0), at(t0));
      flush();
    }
    if (t1 < 1 - 1e-6) {
      cur = [at(t1), at(1)];
    } else {
      flush(); // 剩余部分到段尾都在矩形内：可见段在 a 处结束
    }
  }
  flush();
  return pieces;
}

/**
 * 虚线切分：按 [dash, gap] 周期把折线切成实线小段（pixi v8 Graphics 无原生 dash）。
 * 周期相位沿整条路径连续（跨拐点不断裂重排）。
 */
export function slicePathByDash(pts: IPt[], dash: number, gap: number): IPt[][] {
  if (pts.length < 2) return [];
  if (dash <= 0) return [pts.map((p) => ({ ...p }))];
  const period = dash + gap;
  const out: IPt[][] = [];
  let cur: IPt[] = [];
  let traveled = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    let head = { ...pts[i]! };
    const b = pts[i + 1]!;
    const dir = segmentDirection(head, b);
    let segLen = Math.hypot(b.x - head.x, b.y - head.y);
    while (segLen > 1e-9) {
      const phase = traveled % period;
      if (phase < dash) {
        const remainDash = dash - phase;
        const take = Math.min(remainDash, segLen);
        const next = { x: head.x + dir.x * take, y: head.y + dir.y * take };
        if (cur.length === 0) cur.push({ ...head });
        cur.push(next);
        head = next;
        segLen -= take;
        traveled += take;
        if (take >= remainDash - 1e-9) {
          // 恰好画满一个 dash 周期：收段进入 gap
          if (cur.length >= 2) out.push(cur);
          cur = [];
        }
      } else {
        const skip = Math.min(period - phase, segLen);
        head = { x: head.x + dir.x * skip, y: head.y + dir.y * skip };
        segLen -= skip;
        traveled += skip;
      }
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}
