import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';

/** 缩放胶囊（docs/12 §4）：右下角悬浮，与工具坞同族表面（白胶囊 + 停靠投影）。
 *  三钮均带 aria-label（specs/a11y-closeout §8.4——title 回退的 AT 兼容面窄；
 *  适应屏幕钮的名称带当前百分比 = Name,Role,Value 的 value 面） */
export function ZoomControl() {
  const pageScale = useSpinthStore((s) => s.pageScale);
  const percent = Math.round(pageScale * 100);

  return (
    <div
      role="group"
      aria-label="缩放"
      data-spinth-zoom=""
      className="absolute bottom-[calc(1.25rem+var(--spinth-safe-bottom))] right-[calc(1.25rem+var(--spinth-safe-right))] z-10 flex items-center gap-0.5 rounded-full border border-edge bg-surface p-1 shadow-dock text-ink-2"
    >
      <button
        type="button"
        title="缩小 (Cmd+-)"
        aria-label="缩小"
        onClick={() => spinthCommands.zoomOut()}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        <Icon name="zoom-out" size={16} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        title="适应屏幕 (F)"
        aria-label={`适应屏幕（当前 ${percent}%）`}
        onClick={() => spinthCommands.zoomToFit()}
        className="h-8 min-w-14 rounded-full text-xs font-bold tabular-nums transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        {percent}%
      </button>
      <button
        type="button"
        title="放大 (Cmd+=)"
        aria-label="放大"
        onClick={() => spinthCommands.zoomIn()}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        <Icon name="zoom-in" size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
