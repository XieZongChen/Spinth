import { useSpinthStore } from '../store/spinthStore';
import { spinthCommands } from '../store/commands';
import { Icon } from './Icon';

/** 缩放胶囊（docs/12 §4）：右下角悬浮，与工具坞同族表面（白胶囊 + 停靠投影） */
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
        onClick={() => spinthCommands.zoomOut()}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        <Icon name="zoom-out" size={16} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        title="适应屏幕 (F)"
        onClick={() => spinthCommands.zoomToFit()}
        className="h-8 min-w-14 rounded-full text-xs font-bold tabular-nums transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        {percent}%
      </button>
      <button
        type="button"
        title="放大 (Cmd+=)"
        onClick={() => spinthCommands.zoomIn()}
        className="flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
      >
        <Icon name="zoom-in" size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
