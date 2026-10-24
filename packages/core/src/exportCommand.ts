/**
 * PNG 导出命令（specs/api-surface §3.1 Step 4）——exportPNG 自 boardCommands.ts
 * 逐字迁入（纹理上限钳制/culling 挂起/finally 恢复顺序全部保留）。
 * canvasTokenColor 随迁收口为单源（此前 app.ts 侧副本已随迁消失）。
 */
import { Rectangle } from 'pixi.js';
import type { IBoardCommandHost } from './boardHost';
import type { IRect } from './common/geometry';

/** 画布底色 token（导出底色，docs/03 §8）——core 内单源 */
function canvasTokenColor(): string {
  try {
    const v =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement).getPropertyValue('--spinth-canvas').trim()
        : '';
    return v || '#ffffff';
  } catch {
    return '#ffffff';
  }
}

/** 导出 PNG（docs/03 §8）：selection = 选中集包围盒，canvas = 全画布。
 *  纯读零 Yjs 写入；extract.download 内置浏览器下载（恒 PNG）。 */
export function exportPNG(ctx: IBoardCommandHost, mode: 'selection' | 'canvas'): void {
  const renderer = ctx.viewport?.renderer;
  const layer = ctx.viewport?.widgetLayer;
  if (!renderer || !layer) return;
  const PAD = 32;
  let b: IRect | null = null;
  if (mode === 'selection') {
    b = ctx.getSelectionBounds();
  } else {
    const lb = layer.getLocalBounds();
    if (lb.width > 0 && lb.height > 0) b = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
  }
  if (!b || b.width <= 0 || b.height <= 0) return; // 零选/空画布 no-op
  // 纹理上限钳制（Batch 1 · 1.19）：超大画布 @2x 可能超 GPU MAX_TEXTURE——
  // 按最长边降 resolution 至可容纳（最小 0.5，仍超 = no-op + warn，防空白产物）
  const EXPORT_BASE_RESOLUTION = 2;
  const MAX_EXPORT_EDGE = 8192; // 保守上限（多数 GPU 8192/16384，取安全值）
  const longest = Math.max(b.width + PAD * 2, b.height + PAD * 2);
  let resolution = EXPORT_BASE_RESOLUTION;
  if (longest * resolution > MAX_EXPORT_EDGE) {
    resolution = Math.max(0.5, MAX_EXPORT_EDGE / longest);
    if (longest * resolution > MAX_EXPORT_EDGE + 1) {
      console.warn(`[spinth:export] 画布 ${Math.round(longest)}px 超出可导出上限，已跳过`);
      return;
    }
    console.warn(`[spinth:export] 超大画布导出降为 ${resolution.toFixed(2)}x（原 2x）`);
  }
  // culling 挂起（extract 重渲染跳过 renderable=false——不挂起则视窗外控件缺失）
  const restore = ctx.culling?.suspendForExport() ?? (() => {});
  try {
    renderer.extract.download({
      target: layer,
      // widgetLayer 无自身变换——世界坐标即 layer 内坐标（zoomToFit 同源）
      frame: new Rectangle(b.x - PAD, b.y - PAD, b.width + PAD * 2, b.height + PAD * 2),
      resolution,
      clearColor: canvasTokenColor(),
      filename: mode === 'selection' ? 'spinth-selection.png' : 'spinth-board.png',
    });
  } finally {
    restore();
  }
}
