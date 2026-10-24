import { useEffect, useRef } from 'react';

/**
 * 共享错误态（批次 A · A2/D4-D5）：ErrorBoundary（渲染异常）与 app 壳
 * （初始化失败）此前是两套内联 markup——文案/样式重复且零语义。
 *
 * 契约（docs/12 §6）：
 * - role="alert" 只在容器设一次（不再加 aria-live，避免双重播报）；
 * - 标题 h1 + tabIndex=-1，挂载后 focus({preventScroll})——读屏先读标题；
 * - 详情是 <p>（错误 message，非堆栈），overflow-wrap:anywhere + 内部滚动，
 *   长串（URL/token）在 390px 不撑破布局；
 * - 主按钮是唯一动作，Tab 可达；不做焦点陷阱（终态页，无「返回应用」语义）。
 *
 * 纯展示组件：不读 store、不依赖 Icon、不引路由；父层负责尺寸
 * （h-dvh 或 absolute inset-0）。
 */
export interface IErrorStateProps {
  kind: 'init' | 'render';
  title: string;
  description?: string;
  detail?: string;
  actionLabel: string;
  onAction: () => void;
}

export function ErrorState({
  kind,
  title,
  description,
  detail,
  actionLabel,
  onAction,
}: IErrorStateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      role="alert"
      data-spinth-error-state=""
      data-spinth-error-kind={kind}
      className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-y-auto bg-canvas p-6 text-center"
    >
      <h1
        ref={headingRef}
        tabIndex={-1}
        data-spinth-error-heading=""
        className="text-sm font-semibold text-danger-ink"
      >
        {title}
      </h1>
      {description && <p className="max-w-md text-xs leading-5 text-ink-3">{description}</p>}
      {detail && (
        <p
          data-spinth-error-detail=""
          className="max-h-32 max-w-md overflow-y-auto rounded-md bg-surface px-3 py-2 text-left text-[11px] leading-4 text-ink-3 [overflow-wrap:anywhere]"
        >
          {detail}
        </p>
      )}
      <button
        type="button"
        onClick={onAction}
        className="rounded-md bg-accent-fill px-4 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover"
      >
        {actionLabel}
      </button>
    </section>
  );
}
