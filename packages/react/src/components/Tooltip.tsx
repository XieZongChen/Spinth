import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 通用悬停提示（docs/12 §5，2026-10-03 参考视频规格）：深底白字圆角气泡，
 * 悬停目标**正上方**居中、带下指小箭头、纯文字（spinth 文案中文）。
 * - hover ~400ms 延迟出现（扫过不闪）、移开/失焦立即消失；
 * - 键盘可达（focus 同样触发）；
 * - `disabled` 抑制（如 popover 展开时的触发钮不出 tooltip）；
 * - 定位纯算术（CSS absolute + bottom-full），与 ActionBar 决策一致不引 floating-ui。
 */

const SHOW_DELAY_MS = 400;

export function Tooltip({
  label,
  disabled = false,
  children,
}: {
  label: string;
  /** true 时不出现在悬停/聚焦（受控抑制） */
  disabled?: boolean;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enter = (): void => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), SHOW_DELAY_MS);
  };
  const leave = (): void => {
    window.clearTimeout(timer.current);
    setShow(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
      {children}
      {show && !disabled && (
        <span
          role="tooltip"
          data-spinth-tooltip=""
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-2xs font-medium text-surface shadow-dock"
        >
          {label}
          {/* 下指小箭头（参考同款）：四向透明边框拼三角 */}
          <span
            aria-hidden
            className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-ink"
          />
        </span>
      )}
    </span>
  );
}
