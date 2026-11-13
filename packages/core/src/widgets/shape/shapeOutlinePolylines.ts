import type { IPoint } from '../../common/geometry';
import type { ShapeType } from '../../types';
import {
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_RATIO,
  PARALLELOGRAM_SKEW_RATIO,
  cylinderSemiAxis,
  documentWave,
  fileFold,
  folderTab,
  hexagonSlant,
  offPageTip,
  queueSemiAxis,
  trapezoidWaist,
} from './shapeMetrics';
import { ELLIPSE_SAMPLES, quadChain, roundedOutline } from './shapeOutlineCurves';

/**
 * 20 型闭合轮廓折线数据表（specs/flowchart-closeout §7.2 / §23 拆分）：
 * 局部系（原点 = bbox 左上）、与 drawShapePath 同参数单源（shapeMetrics）；
 * 曲线型经 shapeOutlineCurves 采样折线化；锚点求交在 shapeOutline.ts。
 */

/** 闭合轮廓折线（局部系，原点 = bbox 左上）。与 drawShapePath 同参数单源。 */
export function outlinePolyline(shapeType: ShapeType, w: number, h: number): IPoint[] {
  switch (shapeType) {
    case 'rect':
    case 'predefined-process':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'round-rect':
      return roundedOutline(
        w,
        h,
        Math.min(Math.min(w, h) * CORNER_RADIUS_RATIO, CORNER_RADIUS_MAX),
      );
    case 'stadium':
      return roundedOutline(w, h, Math.min(w, h) / 2);
    case 'ellipse': {
      const pts: IPoint[] = [];
      for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
        const a = (i / ELLIPSE_SAMPLES) * Math.PI * 2;
        pts.push({ x: w / 2 + (w / 2) * Math.cos(a), y: h / 2 + (h / 2) * Math.sin(a) });
      }
      return pts;
    }
    case 'diamond':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ];
    case 'triangle-up':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'triangle-down':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w / 2, y: h },
      ];
    case 'parallelogram-right': {
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      return [
        { x: sk, y: 0 },
        { x: w, y: 0 },
        { x: w - sk, y: h },
        { x: 0, y: h },
      ];
    }
    case 'parallelogram-left': {
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      return [
        { x: 0, y: 0 },
        { x: w - sk, y: 0 },
        { x: w, y: h },
        { x: sk, y: h },
      ];
    }
    case 'eng-database': {
      const s = cylinderSemiAxis(h);
      // 与绘制同序：左身下行 → 底碗（凸向下）→ 右身上行 → 顶外弧（凸向上）
      return [
        { x: 0, y: s },
        { x: 0, y: h - s },
        ...quadChain({ x: 0, y: h - s }, { x: w / 2, y: h + s }, { x: w, y: h - s }),
        { x: w, y: s },
        ...quadChain({ x: w, y: s }, { x: w / 2, y: -s }, { x: 0, y: s }),
      ];
    }
    case 'eng-queue': {
      const s = queueSemiAxis(w);
      return [
        { x: s, y: 0 },
        { x: w - s, y: 0 },
        ...quadChain({ x: w - s, y: 0 }, { x: w + s, y: h / 2 }, { x: w - s, y: h }),
        { x: s, y: h },
        ...quadChain({ x: s, y: h }, { x: -s, y: h / 2 }, { x: s, y: 0 }),
      ];
    }
    case 'eng-file': {
      const f = fileFold(w);
      return [
        { x: 0, y: 0 },
        { x: w - f, y: 0 },
        { x: w, y: f },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'off-page': {
      const c = offPageTip(h);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h - c },
        { x: w / 2, y: h },
        { x: 0, y: h - c },
      ];
    }
    case 'trapezoid-down': {
      const c = trapezoidWaist(w);
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w - c, y: h },
        { x: c, y: h },
      ];
    }
    case 'trapezoid-up': {
      const c = trapezoidWaist(w);
      return [
        { x: c, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'delay': {
      const r = Math.min(h / 2, w);
      const a = w - r;
      return [
        { x: 0, y: 0 },
        { x: a, y: 0 },
        ...quadChain({ x: a, y: 0 }, { x: a + 2 * r, y: h / 2 }, { x: a, y: h }),
        { x: 0, y: h },
      ];
    }
    case 'eng-folder': {
      const t = folderTab(h);
      const tabR = w / 8;
      return [
        { x: 0, y: t },
        { x: w / 2 - tabR, y: t },
        { x: w / 2, y: 0 },
        { x: w / 2 + tabR, y: t },
        { x: w, y: t },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    }
    case 'document': {
      const c = documentWave(h);
      const base = h - c;
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: base },
        ...quadChain({ x: w, y: base }, { x: w * 0.8, y: h }, { x: w * 0.45, y: h }),
        ...quadChain({ x: w * 0.45, y: h }, { x: w * 0.15, y: base - c * 0.6 }, { x: 0, y: base }),
      ];
    }
    case 'hexagon': {
      const c = hexagonSlant(w, h);
      return [
        { x: c, y: 0 },
        { x: w - c, y: 0 },
        { x: w, y: h / 2 },
        { x: w - c, y: h },
        { x: c, y: h },
        { x: 0, y: h / 2 },
      ];
    }
    default:
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
  }
}
