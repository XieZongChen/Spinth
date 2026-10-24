import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState';

/**
 * 渲染期异常兜底（Batch 1 · 1.14）：此前运行期渲染异常直接白屏无提示。
 * class 组件是 React 唯一的 error boundary 形态（官方口径）。
 * 呈现收敛到共享 ErrorState（批次 A · A2）；摘要只展示 message（不含堆栈
 * ——终端用户无益）；重试 = 整页重载。
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
      // h-dvh：移动端 100vh 会被浏览器栏裁切，dvh 随动态视口收缩
      return (
        <div className="h-dvh w-full bg-canvas">
          <ErrorState
            kind="render"
            title="页面出现异常"
            detail={String(this.state.error.message ?? this.state.error)}
            actionLabel="重新加载"
            onAction={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
