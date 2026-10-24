import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 渲染期异常兜底（Batch 1 · 1.14，2026-10-17 审查 4.2）：此前运行期渲染异常
 * 直接白屏无提示。class 组件是 React 唯一的 error boundary 形态（官方口径）。
 * 摘要只展示 message（不含堆栈——终端用户无益）；重试 = 整页重载。
 */
interface IErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, IErrorBoundaryState> {
  override state: IErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): IErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[spinth] 渲染异常（ErrorBoundary 捕获）', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
          <p className="text-sm font-semibold text-danger-ink">页面出现异常</p>
          <p className="max-w-md text-xs text-ink-3">
            {String(this.state.error.message ?? this.state.error)}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-accent-fill px-4 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover"
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
