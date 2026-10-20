import { Container, type ContainerChild, type Rectangle, type Renderer } from 'pixi.js';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { AwarenessService, IAwarenessState } from './awarenessService';
import { PeerRenderer } from './peerRenderer';

/** rxjs Subscription / 最小接口 → Disposable Teardown 适配 */
function wrapSub(sub: { unsubscribe(): void }): () => void {
  return () => sub.unsubscribe();
}

/**
 * awareness 渲染编排（docs/10 §3）：peers$ diff → PeerRenderer 实例池。
 * 挂 optionLayer（世界坐标锚定）；仅渲染，不参与本地命中/zOrder。
 */
export class AwarenessVm extends Disposable {
  private renderers = new Map<number, PeerRenderer>();
  /** 最近一次 peers 快照（视口缩放时重放——光标反向补偿需按新 scale 重算） */
  private lastPeers = new Map<number, IAwarenessState>();
  /** 缩放重排标记（sync 内传 keepIdle——不复活闲置 peer） */
  private rescaling = false;

  constructor(
    private readonly layer: Container,
    private renderer: Renderer,
    service: AwarenessService,
    private viewport: {
      vpScale$: { getValue(): number; subscribe(fn: (v: number) => void): { unsubscribe(): void } };
    },
    private boundsOf: (id: string) => Rectangle | null,
  ) {
    super();
    this.addDisposable(
      service.peers$.subscribe((peers) => {
        this.lastPeers = peers;
        this.sync(peers);
      }),
      wrapSub(
        viewport.vpScale$.subscribe(() => {
          this.rescaling = true;
          this.sync(this.lastPeers);
          this.rescaling = false;
        }),
      ),
    );

    // 活跃检测（5s 粒度足够 60s 阈值）
    const timer = setInterval(() => this.tickIdle(), 5000);
    this.addDisposable(() => clearInterval(timer));
  }

  private sync(peers: Map<number, IAwarenessState>): void {
    for (const [id, r] of this.renderers) {
      if (!peers.has(id)) {
        this.layer.removeChild(r as unknown as ContainerChild);
        r.destroy({ children: true });
        this.renderers.delete(id);
      }
    }
    const scale = this.viewport.vpScale$.getValue();
    const now = performance.now();
    for (const [id, state] of peers) {
      let r = this.renderers.get(id);
      if (!r) {
        r = new PeerRenderer(this.renderer, this.boundsOf);
        this.renderers.set(id, r);
        this.layer.addChild(r as unknown as ContainerChild);
      }
      r.update(state, scale, now, this.rescaling);
    }
    markRender();
  }

  tickIdle(): void {
    const now = performance.now();
    for (const r of this.renderers.values()) r.tick(now);
  }

  get peerCount(): number {
    return this.renderers.size;
  }
}
