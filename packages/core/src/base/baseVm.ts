import { Disposable } from './disposable';
import { markRender } from '../common/render';

/**
 * 迷你 React 渲染管线（docs/04 §4）：
 * setState 合并 batchState → 微任务合批 → forceUpdate 走
 * shouldUpdate → beforeUpdate → render(prev, next) → afterUpdate。
 * 一次 tick 内多次 setState 只触发一次更新。
 */
export abstract class BaseVm<S extends object> extends Disposable {
  state!: S;
  protected batchState: Partial<S> | null = null;
  private updateScheduled = false;
  private _destroyed = false;

  protected constructor(initialState: S) {
    super();
    this.state = initialState;
  }

  get isDestroyed(): boolean {
    return this._destroyed;
  }

  setState(partial: Partial<S>): void {
    if (this._destroyed) return;
    this.batchState = { ...(this.batchState ?? {}), ...partial };
    this.scheduleBatchUpdate();
  }

  private scheduleBatchUpdate(): void {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    queueMicrotask(() => {
      this.updateScheduled = false;
      if (this._destroyed) return;
      const next = this.batchState;
      this.batchState = null;
      if (!next) return;
      this.forceUpdate(next);
    });
  }

  /**
   * 立即应用待合批的更新。编辑入口（enterEdit/enterTextEdit）在 engine.add
   * 后同步读 getBounds——微任务合批尚未跑，root/state 还是旧几何，编辑器会被
   * 定位到 (0,0)+padding（2026-09 像素对齐实测揪出）。已跑过的微任务拿到空
   * batchState 会自然跳过。
   */
  flushUpdate(): void {
    if (!this.batchState || this._destroyed) return;
    const next = this.batchState;
    this.batchState = null;
    this.forceUpdate(next);
  }

  forceUpdate(patch: Partial<S> = {}): void {
    if (this._destroyed) return;
    const next = { ...this.state, ...patch } as S;
    if (!this.shouldUpdate(next)) {
      this.state = next;
      return;
    }
    const prev = this.state;
    this.beforeUpdate(prev, next);
    this.state = next;
    this.render(prev, next);
    markRender();
    this.afterUpdate(prev);
  }

  protected shouldUpdate(_next: S): boolean {
    return true;
  }

  protected beforeUpdate(_prev: S, _next: S): void {}

  abstract render(prev: S, next: S): void;

  protected afterUpdate(_prev: S): void {}

  override dispose(): void {
    this._destroyed = true;
    super.dispose();
  }
}
