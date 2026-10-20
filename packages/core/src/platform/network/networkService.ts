import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';

/**
 * 网络状态服务（docs/10 §4，两态拆分）：
 * - editBlocked$ = 物理断网（navigator.onLine）——**协同模式限定**的编辑阻断
 *   （2026-10-17 外部审查 4.7 重评，用户拍板：本地模式恒放行——IndexedDB
 *   离线可用，「op 无法持久化」前提不成立；navigator.onLine 本身不可靠，
 *   VPN/局域网常误判成断网误伤单机用户）；
 * - wsState$ 的 disconnected 仅提示不阻断（CRDT 离线可编辑卖点）。
 * 「离线」一词在 spinth 中禁止再混用两种语义。
 */
export class NetworkService extends Disposable {
  private readonly blockOnOffline: boolean;
  /** 物理断网 = true 时编辑类交互禁用（blockOnOffline 时才有意义） */
  readonly editBlocked$ = new BehaviorSubject(false);

  constructor(opts: { blockOnOffline?: boolean } = {}) {
    super();
    this.blockOnOffline = opts.blockOnOffline ?? false;
    this.editBlocked$.next(this.blockOnOffline && !navigator.onLine);
  }

  initialize(): void {
    const update = (): void => this.editBlocked$.next(this.blockOnOffline && !navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    this.addDisposable(
      () => window.removeEventListener('online', update),
      () => window.removeEventListener('offline', update),
    );
  }
}
