import { Container, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IViewportService } from '../../types';
import { buildTextTree, type DocDisplay, type ITextRenderService } from './docDisplay';
import type { IDocView, ITextStyleProps } from './measure';

/**
 * 文本渲染纹理服务（docs/07 §6）：快照纹理生成（renderer.generateTexture）+
 * 视口变化 → rAF 批量通知所有 DocDisplay 升级/降级（精确到 per-display 可视性）。
 *
 * renderer 在 viewport.initialize 之后才存在（BoardSDK 装配顺序），此前
 * snapshot() 返回 null、DocDisplay 降级高清 Text；attachRenderer 后全量重评。
 */

/** WebGL 单纹理最大边长兜底（标准浏览器 16384 / Firefox 8192；运行时从 gl 参数查询覆盖） */
const DEFAULT_MAX_TEXTURE_SIZE = 8192;

/** node 单测环境无 rAF，退化为 setTimeout（下一宏任务批处理，语义等价） */
const scheduleFrame: (cb: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => {
        setTimeout(cb, 0);
      };

/**
 * 超大文本二分切块（docs/07 §6）：chunk 任一边长 > maxSize 则等分两块递归
 * （恰等于上限不再切，避免过度切分）。纯函数，独立单测（textRenderService.test.ts）。
 */
export function splitChunk(chunk: Rectangle, maxSize: number): Rectangle[] {
  const hChunks: Rectangle[] = [chunk];
  const vChunks: Rectangle[] = [];
  const pieces: Rectangle[] = [];

  // 切割横边
  while (hChunks.length > 0) {
    const c = hChunks.shift()!;
    if (c.width > maxSize) {
      const left = c.clone();
      const right = c.clone();
      left.width /= 2;
      right.x += c.width / 2;
      right.width /= 2;
      hChunks.push(left, right);
    } else {
      vChunks.push(c);
    }
  }

  // 切割纵边
  while (vChunks.length > 0) {
    const c = vChunks.shift()!;
    if (c.height > maxSize) {
      const top = c.clone();
      const bottom = c.clone();
      top.height /= 2;
      bottom.y += c.height / 2;
      bottom.height /= 2;
      vChunks.push(top, bottom);
    } else {
      pieces.push(c);
    }
  }

  return pieces;
}

/** 运行时查询 WebGL 单纹理上限（WebGLRenderer.gl；非 WebGL 后端退回默认值） */
function queryMaxTextureSize(renderer: Renderer): number {
  try {
    const gl = (renderer as Renderer & { gl?: WebGLRenderingContext | null }).gl;
    return gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : DEFAULT_MAX_TEXTURE_SIZE;
  } catch {
    return DEFAULT_MAX_TEXTURE_SIZE;
  }
}

export class TextRenderService extends Disposable implements ITextRenderService {
  private displays = new Set<DocDisplay>();
  private scheduled = false;
  private rendererAttached = false;
  private disposed = false;
  private renderer: Renderer | null = null;
  private maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE;

  constructor(private viewport: IViewportService) {
    super();
  }

  get dpr(): number {
    return this.renderer?.resolution ?? 1;
  }

  /** renderer 就位（viewport.initialize 后由组合根调用）：查询纹理上限并全量重评 */
  attachRenderer(renderer: Renderer): void {
    this.renderer = renderer;
    this.rendererAttached = true;
    this.maxTextureSize = queryMaxTextureSize(renderer);
    this.scheduleUpdate();
  }

  initialize(): void {
    this.addDisposable(
      this.viewport.vpScale$.subscribe(() => this.scheduleUpdate()),
      this.viewport.vpBounds$.subscribe(() => this.scheduleUpdate()),
    );
  }

  register(display: DocDisplay): void {
    this.displays.add(display);
    display.updateForViewport(true, this.viewport.vpScale$.value);
  }

  unregister(display: DocDisplay): void {
    this.displays.delete(display);
  }

  /** 控件几何变化后请求重评（拖拽松手落库等；帧合批，O(displays) 相交判定） */
  markDirty(): void {
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    scheduleFrame(() => {
      this.scheduled = false;
      if (this.disposed) return;
      const scale = this.viewport.vpScale$.value;
      const screen = this.rendererAttached ? this.renderer!.screen : null;
      for (const d of this.displays) {
        // 精确可视性：display 世界包围盒（stage 坐标 = 屏幕像素）与屏幕矩形相交
        const visible = !screen || screen.intersects(d.getBounds().rectangle);
        d.updateForViewport(visible, scale);
      }
      markRender();
    });
  }

  snapshot(view: IDocView, style: ITextStyleProps, resolution: number): Container | null {
    const renderer = this.renderer;
    if (!renderer || !this.rendererAttached || view.width <= 0 || view.height <= 0) return null;

    const tree = buildTextTree(view, style, resolution);
    try {
      const bounds = new Rectangle(0, 0, view.width, view.height);
      // 任一边物理像素超上限 → 二分切块，多 Sprite 拼回（坐标不变，视觉等价）
      const limit = Math.floor(this.maxTextureSize / resolution);
      const chunks =
        bounds.width >= limit || bounds.height >= limit ? splitChunk(bounds, limit) : [bounds];

      const container = new Container();
      for (const piece of chunks) {
        const texture = renderer.generateTexture({
          target: tree,
          frame: piece.copyTo(new Rectangle()),
          resolution,
          antialias: true,
        }) as Texture;
        const sprite = new Sprite(texture);
        sprite.position.set(piece.x, piece.y);
        // 显式钉住逻辑尺寸：与 resolution 解耦（不依赖 Texture.width 的分辨率语义）
        sprite.width = piece.width;
        sprite.height = piece.height;
        container.addChild(sprite);
      }
      return container;
    } finally {
      tree.destroy({ children: true });
    }
  }

  /** dev 调试（__debug）：两级渲染分布 */
  get stats(): { registered: number; snapshot: number; text: number } {
    let snapshot = 0;
    let text = 0;
    for (const d of this.displays) {
      if (d.renderMode === 'snapshot') snapshot++;
      else text++;
    }
    return { registered: this.displays.size, snapshot, text };
  }

  override dispose(): void {
    this.disposed = true;
    this.displays.clear();
    super.dispose();
  }
}
