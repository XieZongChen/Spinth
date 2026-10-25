import { useState } from 'react';

/**
 * 只读提示条（docs/21 §4）：仅多标签 follower 角色渲染。说明本页只读与接管
 * 行为；「知道了」仅本次会话关闭（不持久化——接管是自动的，提示无需跨会话）。
 * 390px：顶部居中 + max-w 视口钳制，不与底部工具坞重叠。
 */
export function ReadOnlyNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    // role=region（specs/a11y-closeout §8.3，W4/D9）：live region 内不放交互
    // 控件——只读切换由 Announcer 播报（editable 跃迁），本条只做可见呈现；
    // aria-label 让 region 在 landmarks 巡航时可命名到达
    <div
      role="region"
      aria-label="只读提示"
      data-spinth-readonly-notice=""
      className="absolute left-1/2 top-[calc(0.75rem+var(--spinth-safe-top))] z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-2.5 shadow-pop"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">另一标签正在编辑此画布，本页只读。</p>
        <p className="text-xs leading-5 text-ink-3">关闭那个标签后本页会自动接管并刷新。</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-accent-fill px-3 py-1 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover"
        >
          刷新
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-md px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
