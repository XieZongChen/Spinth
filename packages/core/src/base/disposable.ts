import type { Subscription } from 'rxjs';

/** 可统一释放的资源：函数 / { dispose } / rxjs Subscription */
export type Teardown = (() => void) | { dispose(): void } | Subscription;

export interface IDisposable {
  dispose(): void;
}

/**
 * 统一收集 rxjs Subscription / 函数 / Disposable，dispose() 一次释放。
 * 全部 Service 与 Vm 的内存管理基座（规格见 docs/04 §4）。
 */
export class Disposable implements IDisposable {
  protected _disposables: Teardown[] = [];

  protected addDisposable(...items: Teardown[]): void {
    this._disposables.push(...items);
  }

  dispose(): void {
    for (const d of this._disposables) {
      if (typeof d === 'function') {
        d();
      } else if ('dispose' in d) {
        d.dispose();
      } else {
        d.unsubscribe();
      }
    }
    this._disposables = [];
  }
}
