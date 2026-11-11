import { Graphics } from 'pixi.js';
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
  predefinedBand,
  queueSemiAxis,
  trapezoidWaist,
} from './shapeMetrics';

/**
 * 形状路径绘制（docs/04 §8.2）——从 shapeVm 抽离的纯路径生成（33 轮审查 🟡-2
 * 处置：437 行再砍一刀清零 <400 铁律；输入 Graphics + 型 + 宽高，无 VM/状态依赖）。
 * 描边/填充由调用方（shapeVm render）统一施加；细节线（内弧/双竖线）单独出口。
 * 几何常量单源在 shapeMetrics（specs/flowchart-closeout §7.2——与锚点轮廓同参，
 * 防路径与锚点漂移）；描边宽缺省单源在 shapeStyle。
 */

/** 主体路径：20 型逐型生成（default = rect——混版未知值优雅降级） */
export function drawShapePath(g: Graphics, shapeType: ShapeType, w: number, h: number): void {
  switch (shapeType) {
    case 'ellipse':
      g.ellipse(w / 2, h / 2, w / 2, h / 2);
      break;
    case 'diamond': {
      const hw = w / 2;
      const hh = h / 2;
      g.moveTo(hw, 0).lineTo(w, hh).lineTo(hw, h).lineTo(0, hh).closePath();
      break;
    }
    case 'triangle-up':
      g.moveTo(w / 2, 0)
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath();
      break;
    case 'triangle-down':
      g.moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w / 2, h)
        .closePath();
      break;
    case 'parallelogram-right': {
      // 斜边比例 0.18（既有设计 drawParallelR）：顶边右移、底边左移 = 右倾
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      g.moveTo(sk, 0)
        .lineTo(w, 0)
        .lineTo(w - sk, h)
        .lineTo(0, h)
        .closePath();
      break;
    }
    case 'parallelogram-left': {
      // 0.18 镜像：顶边左起、底边右移 = 左倾
      const sk = w * PARALLELOGRAM_SKEW_RATIO;
      g.moveTo(0, 0)
        .lineTo(w - sk, 0)
        .lineTo(w, h)
        .lineTo(sk, h)
        .closePath();
      break;
    }
    case 'eng-database': {
      // 圆柱（既有设计 drawEngDatabase）：椭圆头全高 2s（54，小形状钳 h×0.15）夹矩形身。
      // s = 半轴 27（弧深口径，非全高）——顶全椭圆的下弧内沿线在 switch 后单独描边。
      // pixi v8 ellipse 无角度弧——半椭圆用二次贝塞尔近似（中点精确，最大侧偏 <3% 半轴）
      const s = cylinderSemiAxis(h);
      g.moveTo(0, s)
        .lineTo(0, h - s)
        .quadraticCurveTo(w / 2, h + s, w, h - s) // 底开放碗（凸向下）
        .lineTo(w, s)
        .quadraticCurveTo(w / 2, -s, 0, s); // 顶外弧（凸向上）
      break;
    }
    case 'eng-queue': {
      // 横向滚筒（既有设计 drawEnqueue）：两端椭圆全宽 2s（54，小形状钳 w×0.15）+ 矩形身。
      // s = 半轴 27 口径同 database；右端全椭圆的内弧线在 switch 后单独描边（左端开放）
      const s = queueSemiAxis(w);
      g.moveTo(s, 0)
        .lineTo(w - s, 0)
        .quadraticCurveTo(w + s, h / 2, w - s, h) // 右端外弧（凸向右）
        .lineTo(s, h)
        .quadraticCurveTo(-s, h / 2, s, 0); // 左端开放碗（凸向左）
      break;
    }
    case 'eng-file': {
      // 缺角页（既有设计 drawEngFile）：右上折角 f（50 固定、小形状钳 w×0.3），
      // 底两角 8px 圆角——polyline 主体（圆角以小弧近似：省略视觉差异 <2px）
      const f = fileFold(w);
      g.moveTo(0, 0)
        .lineTo(w - f, 0)
        .lineTo(w, f) // 折角斜边
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath();
      break;
    }
    case 'off-page': {
      // 五边形下尖（流程图 Off-page Connector 页间连接）：底部收拢到下尖。
      // 钳制上限 35 = 撑高公式常量（两口径单源——自洽循环用例验算约束）
      const c = offPageTip(h);
      g.moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w, h - c)
        .lineTo(w / 2, h)
        .lineTo(0, h - c)
        .closePath();
      break;
    }
    case 'trapezoid-down': {
      // 下梯形（流程图 Manual Operation 手动操作）：trapezoid-up 垂直镜像
      const c = trapezoidWaist(w);
      g.moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w - c, h)
        .lineTo(c, h)
        .closePath();
      break;
    }
    case 'delay': {
      // D 形（流程图 Delay 延迟）：左侧直边 + 右半圆——quadratic 近似（控制点
      // 在圆心外 2r 处，中点精确，同端帽口径）。**r 下钳 w**（32 轮审查 🟠：扁高
      // 形状 w < h/2 时 a 为负、路径越出 bbox 左侧——退化时收为窄月牙仍守界）
      const r = Math.min(h / 2, w);
      const a = w - r; // 直边区右界（r 钳后 a ≥ 0 恒成立）
      g.moveTo(0, 0)
        .lineTo(a, 0)
        .quadraticCurveTo(a + 2 * r, h / 2, a, h)
        .lineTo(0, h)
        .closePath();
      break;
    }
    case 'eng-folder': {
      // 文件夹（既有设计 drawEngFolder）：主体 + 顶部标签页（高 t=40 钳 h×0.25、
      // 右缘 w/2+w/8）。标签页折线与主体合为单路径
      const t = folderTab(h);
      const tabR = w / 8; // 标签页斜宽
      g.moveTo(0, t)
        .lineTo(w / 2 - tabR, t)
        .lineTo(w / 2, 0) // 标签页左斜边
        .lineTo(w / 2 + tabR, t)
        .lineTo(w, t)
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath();
      break;
    }
    case 'round-rect':
      g.roundRect(0, 0, w, h, Math.min(Math.min(w, h) * CORNER_RADIUS_RATIO, CORNER_RADIUS_MAX));
      break;
    case 'stadium':
      // 起止胶囊（流程图 Terminator）：半径 = 短边一半——全圆端帽
      g.roundRect(0, 0, w, h, Math.min(w, h) / 2);
      break;
    case 'document': {
      // 文档（流程图 Document）：矩形 + 底边 S 波（谷点偏左 0.45w、右端回收——
      // 常见的非对称两段 quadratic；首版对称双垂控制点实为单谷 U 形，
      // 32 轮审查勘误。小形状钳 h×0.15 防波深吃满）
      const c = documentWave(h);
      const base = h - c;
      g.moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w, base)
        .quadraticCurveTo(w * 0.8, h, w * 0.45, h)
        .quadraticCurveTo(w * 0.15, base - c * 0.6, 0, base)
        .closePath();
      break;
    }
    case 'hexagon': {
      // 六边形（流程图 Preparation 准备）：平顶 + 左右尖，斜宽 c（0.25w、
      // 钳 h/2 防细高六边形崩）
      const c = hexagonSlant(w, h);
      g.moveTo(c, 0)
        .lineTo(w - c, 0)
        .lineTo(w, h / 2)
        .lineTo(w - c, h)
        .lineTo(c, h)
        .lineTo(0, h / 2)
        .closePath();
      break;
    }
    case 'trapezoid-up': {
      // 上梯形（流程图 Manual Input 手动输入）：顶短底长，两腰内斜 c
      const c = trapezoidWaist(w);
      g.moveTo(c, 0)
        .lineTo(w - c, 0)
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath();
      break;
    }
    default:
      g.rect(0, 0, w, h);
  }
}

/** 细节线（仅实线风格——虚线轮廓本就是外框四边近似）：端头全椭圆内弧
 *  （经典 3D 圆柱感）与子过程双竖线，与外框同规格单独描边 */
export function drawShapeDetails(
  g: Graphics,
  shapeType: ShapeType,
  w: number,
  h: number,
  stroke: number,
  width: number,
): void {
  if (shapeType === 'predefined-process') {
    // 子过程双竖线（流程图 Predefined Process）：左右内缩 d 的两条竖线
    const d = predefinedBand(w);
    g.moveTo(d, 0).lineTo(d, h);
    g.moveTo(w - d, 0).lineTo(w - d, h);
    g.stroke({ width, color: stroke });
  }
  if (shapeType === 'eng-database') {
    const s = cylinderSemiAxis(h);
    g.moveTo(0, s).quadraticCurveTo(w / 2, s * 3, w, s); // 顶盖下弧（垂到 2s）
    g.stroke({ width, color: stroke });
  } else if (shapeType === 'eng-queue') {
    const s = queueSemiAxis(w);
    g.moveTo(w - s, 0).quadraticCurveTo(w - 3 * s, h / 2, w - s, h); // 右端内弧（凹到 w-2s）
    g.stroke({ width, color: stroke });
  }
}
