// CSP 兼容（Batch 2 安全头，2026-10-18）：PIXI shader 编译默认走 new Function
// （eval）——生产 CSP script-src 不含 'unsafe-eval'，官方 unsafe-eval 子包
// 提供免 eval 的 polyfill（selfInstall 覆写检查 + 同步函数）。必须在任何
// pixi import 之前加载；pixi.js 是 core 的直接依赖（app 层不可解析）
import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';
import { getRenderId } from '../../common/render';
import { Disposable } from '../../base/disposable';

/**
 * PIXI 8 Application 封装：异步 init + 按需渲染循环（docs/03 §2/§3）。
 *
 * v8 关键差异：`await app.init()`；ticker 默认自启——我们 stop 后改用自己的 rAF 循环，
 * 每帧比对全局 renderId，变了才 app.render()，静止时零 GPU 消耗。
 */
export class BoardApplication extends Disposable {
  readonly app: Application;
  readonly stage: Container;
  private rafId = 0;
  private lastRenderedId = -1;
  private destroyed = false;

  private constructor(app: Application) {
    super();
    this.app = app;
    this.stage = app.stage;
    // 按需渲染：停用常驻 ticker
    app.ticker.stop();
  }

  static async create(container: HTMLElement): Promise<BoardApplication> {
    const app = new Application();
    await app.init({
      // 透明底：画布底色与点阵背景由 DOM 层承载（DotGrid/CSS，docs/03 §6）
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      width: container.clientWidth,
      height: container.clientHeight,
      // WebGL 优先（Phase 1 不启用 WebGPU，减少变量）
      preference: 'webgl',
      // preserveDrawingBuffer 已随调试黑匣子一并移除（保留绘图缓冲有固定清屏/
      // 内存开销，docs/03 §10；需要读帧调试时临时加回）
    });
    container.appendChild(app.canvas);
    const board = new BoardApplication(app);
    board.startLoop();
    return board;
  }

  /** dev 调试：实际渲染执行次数 */
  static renderCount = 0;

  private startLoop(): void {
    const loop = (): void => {
      if (this.destroyed) return;
      const id = getRenderId();
      if (id !== this.lastRenderedId) {
        this.lastRenderedId = id;
        this.app.render();
        BoardApplication.renderCount++;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  resize(width: number, height: number): void {
    if (width > 0 && height > 0) {
      this.app.renderer.resize(width, height);
    }
  }

  override dispose(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.rafId);
    this.app.destroy(true, { children: true });
    super.dispose();
  }
}
