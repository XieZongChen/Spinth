import { Disposable } from '../../base/disposable';
import type { IPoint } from '../../common/geometry';
import type { IEdgeAutoScrollService, IViewportService } from '../../types';
import { clampFrameDt, resolveEdgeScroll, type IEdgeScrollVelocity } from './edgeScrollMath';

/**
 * 边缘自动滚屏服务（specs/edge-auto-scroll §5，docs/05 §4.5）：拖拽进入视口
 * 边缘热区时按帧 panBy + 重放最后一次 move。滚屏只动视口，元素位置每帧由
 * 「当前指针屏幕坐标 → 世界坐标」经重放重算，补偿天然成立（§3.6）——不做
 * 任何位置加法补偿。独占 rAF 与热区数学；SelectorService 只上报指针与起停。
 */

/** 可注入时钟（specs §5.2）：单测注入假时钟确定性驱动帧循环 */
export interface IEdgeScrollClock {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
}

/** node（无 rAF）降级 setTimeout(16)——同 textRenderService 环境探测先例 */
const HAS_RAF = typeof requestAnimationFrame === 'function';

/** 生产默认时钟：rAF + performance.now（node 的 setTimeout 返回 Timeout，须收窄） */
function makeClock(): IEdgeScrollClock {
  if (HAS_RAF) {
    return {
      now: () => performance.now(),
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
    };
  }
  return {
    now: () => performance.now(),
    requestFrame: (cb) => setTimeout(cb, 16) as unknown as number,
    cancelFrame: (id) => clearTimeout(id),
  };
}

export const EDGE_SCROLL_CLOCK: IEdgeScrollClock = makeClock();

export class EdgeAutoScrollService extends Disposable implements IEdgeAutoScrollService {
  private readonly clock: IEdgeScrollClock;
  private velocity: IEdgeScrollVelocity = { x: 0, y: 0 };
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private isScrolling = false;
  private dead = false;
  private onLeave: (() => void) | null = null;

  constructor(
    private readonly viewport: IViewportService,
    clock: IEdgeScrollClock = EDGE_SCROLL_CLOCK,
  ) {
    super();
    this.clock = clock;
  }

  get scrolling(): boolean {
    return this.isScrolling;
  }

  update(screen: IPoint, dragging: boolean): void {
    if (this.dead) return;
    if (!dragging) return this.stop(); // S2/D6：未过阻尼不滚（按下即滚会把世界坐标推过阈值）
    const v = resolveEdgeScroll(screen, this.viewport.getClientSize());
    if (!v.x && !v.y) return this.stop(); // S1：离热区
    this.velocity = v;
    // 起帧守卫用 scrolling 状态而非 frameId：重放路径会重入本方法（同参数幂等），
    // 而 frameId 在 tick 执行期为 null，按它判会双调度 rAF + 重复挂监听
    // （specs §12 末注：不为此加「重放中」标志——scrolling 即状态机本体）
    if (!this.isScrolling) this.start();
  }

  private start(): void {
    this.isScrolling = true;
    this.lastFrameAt = this.clock.now(); // 首帧 dt 从 0 起算
    // S5：指针离容器后不再有 move，旧档位会无限滚下去（specs §12-R6）
    this.onLeave = (): void => this.stop();
    this.viewport.container?.addEventListener('pointerleave', this.onLeave);
    this.frameId = this.clock.requestFrame(this.tick);
  }

  private tick = (): void => {
    this.frameId = null;
    if (!this.isScrolling) return; // 预约帧与 stop 的竞态窗口（cancel 后仍触发的兜底）
    const now = this.clock.now();
    const dt = clampFrameDt(now - this.lastFrameAt);
    this.lastFrameAt = now;
    // 停止判据 = 速度全零，不是 dx/dy 全零：dt=0（同毫秒帧）位移为零但循环必须继续，
    // 按 §3.4 骨架的字面判停会在起帧瞬间自杀
    if (!this.velocity.x && !this.velocity.y) return this.stop();
    const dx = (this.velocity.x * dt) / 1000;
    const dy = (this.velocity.y * dt) / 1000;
    if (dx || dy) {
      try {
        this.viewport.panBy(dx, dy);
        if (!this.viewport.replayLastPointerMove()) {
          // S6 管线拒发（滚屏中途转只读/断网）：回滚本帧，避免画布空转、元素脱手
          this.viewport.panBy(-dx, -dy);
          return this.stop();
        }
      } catch {
        // rAF 回调抛错会跳过帧尾预约：frameId 停在 null 而 scrolling 卡 true，
        // 守卫将拒绝再次 start（一次手势内滚屏失效）——兜底停滚，update 可重启
        this.stop();
        return;
      }
    }
    // 重放路径内 update 可能已 stop（指针回中心/拖拽终止）——不再预约下一帧
    if (!this.isScrolling) return;
    this.frameId = this.clock.requestFrame(this.tick);
  };

  stop(): void {
    if (!this.isScrolling) {
      this.velocity = { x: 0, y: 0 };
      return;
    }
    if (this.frameId !== null) this.clock.cancelFrame(this.frameId);
    this.frameId = null;
    this.velocity = { x: 0, y: 0 };
    if (this.onLeave) {
      this.viewport.container?.removeEventListener('pointerleave', this.onLeave);
      this.onLeave = null;
    }
    this.isScrolling = false;
  }

  override dispose(): void {
    this.stop();
    this.dead = true; // 此后 update 永久无效（T19）
    super.dispose();
  }
}
