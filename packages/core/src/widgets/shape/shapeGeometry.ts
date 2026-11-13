/**
 * 形状内接矩形与撑高公式（docs/04 §8.2 / docs/17 §6）——从 shapeVm 抽离的
 * 纯几何单源（32 轮审查 🟡-3：shapeVm 544 行破 <400 铁律恶化最重的一刀；
 * textService 测高消费、零 VM 依赖）。
 */
import type { ShapeType } from '../../types';
import type { IRect } from '../../common/geometry';
import {
  CYLINDER_HEAD_FULL,
  DOCUMENT_WAVE_MAX,
  FILE_FOLD_MAX,
  FOLDER_TAB_MAX,
  OFFPAGE_TIP_MAX,
  documentWave,
  fileFold,
  folderTab,
  hexagonSlant,
  offPageTip,
  predefinedBand,
  trapezoidWaist,
} from './shapeMetrics';

/** rect/round 文字内边距（ellipse/diamond 走 insetRectOf 专式内接） */
export const SHAPE_TEXT_PADDING = 15;

/** 文字区域内接矩形（渲染 maxWidth 与编辑框 getRect 两处同源；既有设计
 *  shapeTextCompute 行为：rect/round 四边 padding、ellipse 内接矩形
 *  （1/√2 比例推导）、diamond 半宽高中心箱） */
export function insetRectOf(shapeType: ShapeType, w: number, h: number): IRect {
  if (shapeType === 'ellipse') {
    // 椭圆内接矩形：边长 w/√2 × h/√2，居中
    const iw = w / Math.SQRT2;
    const ih = h / Math.SQRT2;
    return { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih };
  }
  if (shapeType === 'diamond') {
    // 菱形中心可用箱：半宽 × 半高（四边中点连线内）
    return { x: w / 4, y: h / 4, width: w / 2, height: h / 2 };
  }
  if (shapeType === 'triangle-up') {
    // 上三角：下半中心箱（顶点在上，下方宽——既有设计 shapeTextCompute 同款）
    return { x: w / 4, y: h / 2, width: w / 2, height: h / 2 };
  }
  if (shapeType === 'triangle-down') {
    // 下三角：上半中心箱（镜像）
    return { x: w / 4, y: 0, width: w / 2, height: h / 2 };
  }
  if (shapeType === 'parallelogram-right' || shapeType === 'parallelogram-left') {
    // 平行四边形（既有设计 shapeTextCompute 同款）：0.6w × 0.8h 居中偏移箱
    return { x: w * 0.21, y: h * 0.1, width: w * 0.6, height: h * 0.8 };
  }
  if (shapeType === 'eng-database') {
    // 圆柱：两椭圆头之间的矩形身（头高钳制与绘制同步）
    const e = Math.min(CYLINDER_HEAD_FULL, h * 0.3);
    return {
      x: SHAPE_TEXT_PADDING,
      y: e + SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - e * 2 - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'eng-queue') {
    // 滚筒：两端椭圆之间的矩形身（端宽钳制同步；纵向 20 视觉边距——端椭圆弧不顶边）
    const e = Math.min(CYLINDER_HEAD_FULL, w * 0.3);
    return {
      x: e + SHAPE_TEXT_PADDING,
      y: 20,
      width: Math.max(w - e * 2 - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - 40, 1),
    };
  }
  if (shapeType === 'eng-file') {
    // 缺角页：折角下方矩形（既有设计 y=55 起——即 f+5；spinth 取 f+padding 对称）
    const f = fileFold(w);
    return {
      x: SHAPE_TEXT_PADDING,
      y: f + SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - f - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'stadium') {
    // 胶囊：左右各让半端帽（capR/2 = min(w,h)/4——弧中段近似），上下 padding
    const capR = Math.min(w, h) / 2;
    return {
      x: capR / 2,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - capR, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'off-page') {
    // 页连接：底部让尖区 c（与绘制同步钳制，上限 35 单源于撑高公式）
    const c = offPageTip(h);
    return {
      x: SHAPE_TEXT_PADDING,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2 - c, 1),
    };
  }
  if (shapeType === 'delay') {
    // D 形：右侧让弧侵食（h/4 近似）。**侵蚀钳半宽**（32 轮审查 🟠：无界侵蚀 ×
    // autoHeight 只撑不缩 → 正反馈发散——120 宽 50 字撑到 h=1230、inset 压到 1px）
    const erode = Math.min(h / 4, (w - SHAPE_TEXT_PADDING * 2) / 2);
    return {
      x: SHAPE_TEXT_PADDING,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2 - erode, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'trapezoid-down') {
    // 下梯形：与上梯形同款内接（镜像只影响绘制）
    const c = trapezoidWaist(w);
    return {
      x: SHAPE_TEXT_PADDING + c / 2,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2 - c, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'trapezoid-up') {
    // 上梯形：顶边窄——左右各让半腰（c/2 均值近似）
    const c = trapezoidWaist(w);
    return {
      x: SHAPE_TEXT_PADDING + c / 2,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2 - c, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'predefined-process') {
    // 子过程：左右各让双竖线带 d（与绘制同步钳制）
    const d = predefinedBand(w);
    return {
      x: SHAPE_TEXT_PADDING + d,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2 - d * 2, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'hexagon') {
    // 六边形：左右各让斜宽 c（中部最宽——保守内接）
    const c = hexagonSlant(w, h);
    return {
      x: c,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - c * 2, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  if (shapeType === 'document') {
    // 文档：底部让波浪 c（与绘制同步钳制）
    const c = documentWave(h);
    return {
      x: SHAPE_TEXT_PADDING,
      y: SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - SHAPE_TEXT_PADDING * 2 - c, 1),
    };
  }
  if (shapeType === 'eng-folder') {
    // 文件夹：标签页下方矩形（t 钳制同步）
    const t = folderTab(h);
    return {
      x: SHAPE_TEXT_PADDING,
      y: t + SHAPE_TEXT_PADDING,
      width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
      height: Math.max(h - t - SHAPE_TEXT_PADDING * 2, 1),
    };
  }
  return {
    x: SHAPE_TEXT_PADDING,
    y: SHAPE_TEXT_PADDING,
    width: Math.max(w - SHAPE_TEXT_PADDING * 2, 1),
    height: Math.max(h - SHAPE_TEXT_PADDING * 2, 1),
  };
}

/** autoHeight 撑高公式（docs/17 §6，2026-10-10 四点拍板；与 insetRectOf 单源同
 *  居——公式保证「该文字高度在内接几何下放得下」）：rect/round = textH+2×padding；
 *  ellipse = textH×√2（insetRectOf 的 h/√2 内接反解，弃既有设计保守值 ×2）；
 *  diamond = textH×2（半高箱 h/2 ≥ textH 反解，两口径等价）。消费侧只撑不缩。 */
export function shapeHeightFromTextHeight(shapeType: ShapeType, textH: number): number {
  if (shapeType === 'ellipse') return Math.round(textH * Math.SQRT2 * 100) / 100;
  if (shapeType === 'diamond') return Math.round(textH * 2 * 100) / 100;
  if (shapeType === 'triangle-up' || shapeType === 'triangle-down')
    return Math.round(textH * 2 * 100) / 100; // 半高箱 h/2 ≥ textH 反解
  if (shapeType === 'parallelogram-right' || shapeType === 'parallelogram-left')
    return Math.round(textH * 1.25 * 100) / 100; // 0.8h ≥ textH 反解（既有设计 /0.8 同值）
  if (shapeType === 'eng-database')
    return Math.round((textH + CYLINDER_HEAD_FULL * 2 + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 两头 54×2 + 上下 padding
  if (shapeType === 'eng-queue') return Math.round((textH + 40) * 100) / 100; // 纵向只有 20×2 视觉边距
  if (shapeType === 'eng-file')
    return Math.round((textH + FILE_FOLD_MAX + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 折角 50 + 上下 padding
  if (shapeType === 'eng-folder')
    return Math.round((textH + FOLDER_TAB_MAX + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 标签页 40 + 上下 padding
  if (shapeType === 'stadium') return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 上下 padding（端帽只吃水平）
  if (shapeType === 'document')
    return Math.round((textH + DOCUMENT_WAVE_MAX + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 波浪 18 + 上下 padding
  if (shapeType === 'hexagon') return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 斜宽只吃水平
  if (shapeType === 'predefined-process')
    return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 竖线带只吃水平
  if (shapeType === 'trapezoid-up' || shapeType === 'trapezoid-down')
    return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 腰斜只吃水平
  if (shapeType === 'delay') return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 半圆只吃水平
  if (shapeType === 'off-page')
    return Math.round((textH + OFFPAGE_TIP_MAX + SHAPE_TEXT_PADDING * 2) * 100) / 100; // 尖区 35（未钳制口径）+ 上下 padding
  return Math.round((textH + SHAPE_TEXT_PADDING * 2) * 100) / 100;
}
