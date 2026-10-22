import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { spinthCommands, useSpinthStore } from '@spinth/react';
import { StoragePanel } from './StoragePanel';

/**
 * 顶栏保存状态入口（docs/02 §6.1 / docs/12）：已保存/保存中/保存失败三态 +
 * 点击打开本地存储面板。不新增顶栏控件位（D3）——替换原保存状态 span。
 * 面板 fixed 定位 + 视口 clamp（同 ProjectMenu），390px 不挤压顶栏。
 */
export function StorageStatusButton({ onOpenProjectMenu }: { onOpenProjectMenu: () => void }) {
  const persistState = useSpinthStore((s) => s.persistState);
  const storageStatus = useSpinthStore((s) => s.storageStatus);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 面板定位：fixed 右对齐锚点按钮、顶栏下方，钳制视口内；垂直方向 maxHeight 兜底滚动
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 6;
    // 左缘也要钳制（390px：存储按钮在顶栏按钮组中段，只右对齐会让 320px 面板溢出左缘）
    const vw = window.innerWidth;
    const width = Math.min(320, vw - 16);
    const desiredRight = vw - rect.right;
    const maxRight = vw - 8 - width; // 左缘最小留白 8px
    setPanelStyle({
      position: 'fixed',
      top,
      right: Math.max(8, Math.min(desiredRight, maxRight)),
      width: 'min(320px, calc(100vw - 16px))',
      maxHeight: `calc(100dvh - ${Math.round(top) + 8}px)`,
      overflowY: 'auto',
    });
  }, [open]);

  // 统一关闭：收面板 + 焦点回按钮（Escape 与「关闭」按钮同一条路径——复审 #1）
  const closePanel = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  // Escape 关闭回焦（capture 独占——不冒泡到全局清选区，同 ProjectMenu）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // 点击外部关闭（不回焦——外点语义是去别处交互）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  // 打开时焦点移入面板。依赖含 panelStyle：面板「先定位后挂载」，首次打开时
  // 面板在 panelStyle 就绪后才挂载——只依赖 open 会在挂载前跑一次空聚焦（复审 #1）
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, panelStyle]);

  // 刷新时机（D6：不轮询）：面板打开 / 窗口 focus / 页面重新可见 / 写失败
  useEffect(() => {
    if (open) spinthCommands.refreshStorageStatus();
  }, [open]);
  useEffect(() => {
    const onFocus = (): void => spinthCommands.refreshStorageStatus();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') spinthCommands.refreshStorageStatus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  useEffect(() => {
    if (persistState === 'failed') spinthCommands.refreshStorageStatus();
  }, [persistState]);

  const failed = persistState === 'failed';
  const saving = persistState === 'saving';
  const critical = storageStatus.pressure === 'critical';
  const warn = storageStatus.pressure === 'warn';
  const label = failed ? '保存失败' : saving ? '保存中…' : '已保存';
  // 压力态在可读文本中点名（复审低优 #4：warn 不只靠圆点颜色）
  const pressureHint = critical ? '空间不足' : warn ? '空间接近上限' : '';
  const ariaLabel = pressureHint ? `${label} · ${pressureHint}` : `${label} · 本地存储详情`;
  const dotClass =
    failed || critical
      ? 'bg-danger animate-pulse'
      : warn
        ? 'bg-warning'
        : saving
          ? 'bg-tool-shape animate-pulse'
          : 'bg-tool-pen';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={pressureHint ? `本地存储详情（${pressureHint}）` : '本地存储详情'}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'spinth-storage-panel' : undefined}
        aria-live="polite"
        data-spinth-storage-button=""
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold transition-colors duration-100 ${
          failed
            ? 'bg-danger-soft text-danger hover:text-danger'
            : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
        {label}
      </button>

      {/* 先定位后挂载：面板首帧若为 static 会挤歪按钮位置（useLayoutEffect 量到负坐标）；
          panelStyle 就绪后挂载即 fixed，重开时旧样式亦是 fixed 不影响测量 */}
      {open && panelStyle !== null && (
        <StoragePanel
          status={storageStatus}
          persistState={persistState}
          onRetryPersist={() => spinthCommands.retryPersist()}
          onRequestPersist={() => spinthCommands.requestStoragePersist()}
          onOpenProjectMenu={() => {
            setOpen(false);
            onOpenProjectMenu();
          }}
          onClose={closePanel}
          panelRef={panelRef}
          style={panelStyle}
        />
      )}
    </div>
  );
}
