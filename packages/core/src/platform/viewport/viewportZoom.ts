import { Container, Point } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { markRender } from '../../common/render';

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;

/** 缩放宿主：ViewportService 实现——viewport/widgetLayer 于 initialize 后就绪 */
export interface IViewportZoomHost {
  readonly viewport: Viewport;
  readonly widgetLayer: Container;
  getRendererSize(): { width: number; height: number };
  /** 立即路径的手动同步（非立即路径经 viewport 'moved' 事件走 service 统一同步） */
  onMoved(): void;
}

/** 视口相机缩放（docs/03 §5）：setPageScale 两条路径（animate / immediate 精确
 *  归位）、zoomIn/Out、zoomToFit。无自有监听——副作用经 viewport 本体。 */
export class ViewportZoom {
  constructor(private readonly host: IViewportZoomHost) {}

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate = false): void {
    const viewport = this.host.viewport;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    // P0-7（2026-10-17 外部审查）三处数学修正：
    // ① focus 缺省直用 viewport.center——pixi-viewport v6 的 center 本就是世界
    //    坐标（屏幕中心的 toWorld 值），再过一次 toWorld 是二次换算（纯缩放
    //    轨道上恰好幂等掩盖了漂移，平移后 focus 即错位）；
    // ② 比例项 old/new：保持 focus 世界点停在同一屏幕位置的正确目标是
    //    P = f + (c_w − f)·(s/s′)——原写成 new/old；
    // ③ immediate 分支改 moveCenter：animate({ position }) 的 position 是
    //    moveCenter 的世界中心目标（AnimatePlugin 源码语义），而
    //    viewport.position 是平移量——同数异义，cmd+0 曾半屏级跳动。
    // 不能省略 position：pixi-viewport AnimatePlugin 在 keepCenter=true 时不 emit
    // 'moved'，vpScale$/vpBounds$ 将永远滞后（setPageScale(1) 后 HUD 显示与 LOD
    // 联动全部失真，2026-09 浏览器实测揪出）。
    const f = focus ?? viewport.center;
    const ratio = viewport.scale.x / clamped;
    const target = new Point(
      f.x + (viewport.center.x - f.x) * ratio,
      f.y + (viewport.center.y - f.y) * ratio,
    );
    if (immediate) {
      // 立即精确路径（zoom100 专用）：AnimatePlugin 是收敛式插值（每帧
      // scale += (target-scale)*ease），慢环境帧少时停在离目标 1.6%~2.9% 的
      // 残差（CI 两次红实证）——「回 100%」语义要求精确归位。手动设置不
      // emit 'moved'，须自触发 vp 同步 + markRender（onMoved 同款）。
      // 须先取消在飞 Animate：animate() 重入自带替换（add 先 destroy 同名），
      // 本路径绕过了它——残留 Animate 每帧仍按其目标继续插值，把刚设的
      // scale 拉走（CI 实证：cmd+= 动画在飞时 cmd+0，最终停在 1.18）。
      viewport.plugins.remove('animate');
      viewport.scale.set(clamped);
      viewport.moveCenter(target);
      markRender();
      this.host.onMoved();
      return;
    }
    viewport.animate({
      time: 200,
      scale: clamped,
      position: target,
    });
  }

  zoomIn(): void {
    this.setPageScale(this.host.viewport.scale.x * ZOOM_STEP);
  }

  zoomOut(): void {
    this.setPageScale(this.host.viewport.scale.x / ZOOM_STEP);
  }

  zoomToFit(padding = 100): void {
    if (this.host.widgetLayer.children.length === 0) {
      this.setPageScale(1);
      return;
    }
    const b = this.host.widgetLayer.getLocalBounds();
    const size = this.host.getRendererSize();
    const scale = Math.min(
      Math.max((size.width - padding * 2) / b.width, (size.height - padding * 2) / b.height),
      1,
    );
    this.host.viewport.animate({
      time: 200,
      scale,
      position: new Point(b.x + b.width / 2, b.y + b.height / 2),
    });
  }
}
