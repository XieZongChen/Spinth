import type { Texture } from 'pixi.js';
import { autoRetryDelay } from './imageRetry';

/** 图片加载状态机状态（idle = src 为空；failed/missing 是终态，等手动 retry） */
export type ImageLoadState = 'idle' | 'loading' | 'loaded' | 'failed' | 'missing';
/** 失败分类：decode = 解码/建纹失败（可能可自动重试）；missing = 资产行不存在 */
export type ImageFailureKind = 'decode' | 'missing';

/** 纹理租约：release 幂等；纹理的销毁只由租约归零触发（缓存语义） */
export interface IImageTextureLease {
  readonly texture: Texture;
  release(): void;
}

export type ImageTextureResult =
  | { kind: 'ok'; lease: IImageTextureLease }
  /** 资产行不存在/无解析器——终态（可能他端稍后写入，留手动重试入口） */
  | { kind: 'missing' }
  /** retryable 由失败阶段决定：解码失败 true；建纹/存储层故障 false */
  | { kind: 'error'; error: unknown; retryable: boolean };

/** 纹理获取端口（组合根注入 ImageTextureCache；VM/控制器不持全局依赖） */
export interface IImageTexturePort {
  acquire(src: string): Promise<ImageTextureResult>;
}

/** 宿主回调（ImageVm 实现）：加载中旧 sprite 保持可见——防切图闪烁 */
export interface IImageLoadHost {
  onLoading(src: string): void;
  /** 先换 sprite，控制器随后释放旧租约 */
  onLoaded(src: string, texture: Texture): void;
  /** 先销毁 sprite（新 src + 旧图并存是错误状态），控制器随后释放旧租约 */
  onFailed(src: string, kind: ImageFailureKind): void;
  onEmpty(): void;
}

/** 计时器端口（单测注入假实现，不依赖真实定时器） */
export interface IImageTimerPort {
  /** 返回取消函数 */
  set(fn: () => void, ms: number): () => void;
}

/** 纹理标识探针（E2E 断言「同图同纹理」用）；无 uid 的环境返回 -1 */
export function textureUidOf(t: Texture): number {
  const uid = (t as unknown as { uid?: number }).uid;
  return typeof uid === 'number' ? uid : -1;
}

const defaultTimers: IImageTimerPort = {
  set: (fn, ms): (() => void) => {
    const h = setTimeout(fn, ms);
    return (): void => clearTimeout(h);
  },
};

/** 终态失败日志的 src 截断（data URL 不能整串打印） */
function brief(src: string): string {
  return src.length > 72 ? `${src.slice(0, 72)}…` : src;
}

/**
 * 图片加载会话控制器（L1 竞态修复核心）：一次 src 变化 = 一个 token 化
 * 会话；**每个成功会话恰好持有一个纹理租约**，迟到会话只释放自己拿到的
 * lease、绝不触碰当前租约。旧实现的单一 heldAssetId 槽位会被迟到解码
 * 误释放新会话的持有（objectURL 计数错位甚至被 revoke）——本类用
 * 「token 校验 + 局部租约」根治该类竞态。
 *
 * 不变量：releaseCurrent() 是唯一释放当前租约的地方（commit/fail/empty/
 * dispose 四处调用）；迟到完成只 release 自己的 r.lease，永不调它。
 */
export class ImageLoadController {
  private src = '';
  private state: ImageLoadState = 'idle';
  private token = 0;
  private attempts = 0;
  /** 已发起的 acquire 次数（含自动/手动重试；E2E 探针——双击重试可证伪） */
  private acquires = 0;
  private lease: IImageTextureLease | null = null;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly textures: IImageTexturePort,
    private readonly host: IImageLoadHost,
    private readonly timers: IImageTimerPort = defaultTimers,
  ) {}

  setSrc(next: string): void {
    if (this.disposed || next === this.src) return; // 同 src 不重入（失败后只能 retry()）
    this.src = next;
    const token = ++this.token;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.attempts = 0;
    if (!next) {
      this.state = 'idle';
      this.host.onEmpty(); // 先让 sprite 销毁
      this.releaseCurrent(); // 再释放纹理租约
      return;
    }
    this.state = 'loading';
    this.host.onLoading(next); // 旧 sprite 继续显示
    void this.run(token);
  }

  /** 手动重试（VM 只在 failed/missing 态转发）：attempts 清零，不限次数 */
  retry(): void {
    if (this.disposed) return;
    if (this.state !== 'failed' && this.state !== 'missing') return;
    const token = ++this.token;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.attempts = 0;
    this.state = 'loading';
    this.host.onLoading(this.src);
    void this.run(token);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.token++;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.releaseCurrent();
    this.state = 'idle';
  }

  get debug(): {
    src: string;
    state: ImageLoadState;
    attempts: number;
    acquires: number;
    textureUid: number;
  } {
    return {
      src: this.src,
      state: this.state,
      attempts: this.attempts,
      acquires: this.acquires,
      textureUid: this.lease ? textureUidOf(this.lease.texture) : -1,
    };
  }

  private async run(token: number): Promise<void> {
    let r: ImageTextureResult;
    this.acquires++;
    try {
      r = await this.textures.acquire(this.src); // port 抛错也归入 decode 失败
    } catch (error) {
      r = { kind: 'error', error, retryable: false };
    }
    if (this.disposed || token !== this.token) {
      if (r.kind === 'ok') r.lease.release(); // 迟到结果：只认自己这一份
      return;
    }
    if (r.kind === 'missing') return this.fail('missing', token, false);
    if (r.kind === 'error') return this.fail('decode', token, r.retryable);
    const prev = this.lease;
    this.lease = r.lease;
    this.state = 'loaded';
    this.attempts = 0; // 成功清零（E2E 探针断言）
    this.host.onLoaded(this.src, r.lease.texture);
    prev?.release(); // 新租约提交后再释放旧的
  }

  private fail(kind: ImageFailureKind, token: number, retryable: boolean): void {
    if (this.disposed || token !== this.token) return;
    this.state = kind === 'missing' ? 'missing' : 'failed';
    this.host.onFailed(this.src, kind); // 先销毁 sprite
    this.releaseCurrent(); // 再释放纹理租约
    const delay = autoRetryDelay(this.src, kind, retryable, this.attempts);
    if (delay === null) {
      // 终态才打印（重试中间过程不打印，防噪声；src 截断防 data URL 刷屏）。
      // missing 降 info：资产行缺失可能他端稍后写入，非错误——批量缺资产不刷警告
      const log = kind === 'missing' ? console.info : console.warn;
      log(`[spinth:image] 加载终态（${kind}）：${brief(this.src)}`);
      return;
    }
    this.attempts++;
    this.cancelTimer = this.timers.set(() => {
      if (this.disposed || token !== this.token) return; // 计时器回调双检
      this.state = 'loading';
      this.host.onLoading(this.src);
      void this.run(token);
    }, delay);
  }

  /** 唯一的当前租约释放点（幂等调用安全） */
  private releaseCurrent(): void {
    const lease = this.lease;
    this.lease = null;
    lease?.release();
  }
}
