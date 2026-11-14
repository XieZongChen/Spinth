import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { IActionBarItem } from '@spinth/core';
import { useRovingFocus } from '../a11y/useRovingFocus';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Tooltip } from './Tooltip';

/**
 * ActionBar 多级控件（docs/12 §5，2026-10-03 参考视频规格）：一级只占
 * 「当前值图标/色点 + ▾」单按钮位；点击展开二级面板（横向一排图标/色块，
 * 选中项描边圈），点选即应用并收起；Esc / 点击外部收起。
 * 开合受控（open/onOpenChange）：单源在 ActionBar 的 openPopoverId——
 * 多个 popover 天然互斥（Toolbar cursorMode 同款单源模式），本组件不持状态。
 * 面板仅展开时渲染 DOM（零闲置成本）；x 跟随触发钮居中并视口钳制
 * （useLayoutEffect 实测校正，绘制前完成——与 ActionBar 宽度实测同款手法）。
 */

function iconNameOf(raw: string | undefined): IconName {
  return (raw ?? '') as IconName; // Icon 内有 FALLBACK 占位（schema 配错不破布局）
}

export function PopoverControl({
  item,
  onPick,
  open,
  onOpenChange,
}: {
  item: IActionBarItem;
  onPick: (id: string, value: string) => void;
  /** 开合单源在 ActionBar（互斥）；false 时不渲染面板 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [panelLeft, setPanelLeft] = useState<number | null>(null); // 相对 root 的中心 x（null = 未校正，用 CSS 居中）
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const current = typeof item.value === 'string' ? item.value : '';
  const curOpt = item.options?.find((o) => o.id === current);

  // 关闭即回焦触发钮（specs/a11y-closeout §5.7：选项/外点/Esc 三路一致——
  // 面板收起即卸载，焦点不落地会掉到 body）；useCallback 稳定引用供两个
  // window 监听 effect 依赖
  const closeAndRefocus = useCallback((): void => {
    onOpenChange(false);
    triggerRef.current?.focus();
  }, [onOpenChange]);

  // roving（specs/a11y-closeout §5.7）：面板 both 方向 + wrap；面板仅在 open
  // 时挂载，收起时容器为 null——hook 对空容器不做任何事
  const { onKeyDown, onFocus } = useRovingFocus({
    containerRef: panelRef,
    orientation: 'both',
    wrap: true,
  });

  // Esc 收起（capture 相 + stopPropagation 独占：面板开着时 Esc 只收面板、
  // 不再触发全局「Esc 清选区」——参考同款层级语义；hotkeys-js 挂 document
  // bubble 相，window capture 先于它）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAndRefocus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, closeAndRefocus]);

  // 点击外部收起（面板与触发钮之外）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) closeAndRefocus();
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, closeAndRefocus]);

  // 面板 x 视口钳制：跟随触发钮居中，出界时夹回（两侧留 8px）。
  // useLayoutEffect 在绘制前完成校正（与 ActionBar 宽度实测同款手法）。
  // 先 min 上界再 max 下界：面板比视口-16 还宽时（390 色板），上界为负、
  // 旧顺序的 min(desired, 负) 会取到负坐标（实测 -272）——夹到下限 8，
  // 超宽由面板自身 max-w + flex-wrap 消化
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const rb = root.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const cxViewport = rb.left + rb.width / 2;
    const clamped = Math.max(8, Math.min(cxViewport - pw / 2, window.innerWidth - pw - 8));
    setPanelLeft(clamped + pw / 2 - rb.left); // 面板中心相对 root 的 x
  }, [open, item.id]);
  // 收起时复位（下次展开先用 CSS 居中初值，避免闪旧位移）
  useEffect(() => {
    if (!open) setPanelLeft(null);
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-spinth-popover={item.id}>
      <Tooltip label={item.label} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={item.label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={item.disabled === true}
          disabled={item.disabled === true}
          onClick={() => onOpenChange(!open)}
          className={`flex h-7 items-center gap-0.5 rounded-md px-1 transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
            open
              ? 'bg-surface-hover text-ink'
              : 'text-ink-2 hover:bg-surface-hover/60 hover:text-ink'
          }`}
        >
          {(curOpt?.swatch ?? item.displaySwatch) ? (
            <span
              className="h-3.5 w-3.5 rounded-full border border-black/10"
              style={{ backgroundColor: curOpt?.swatch ?? item.displaySwatch }}
            />
          ) : curOpt?.text !== undefined ? (
            <span className="min-w-5 text-center text-xs font-semibold tabular-nums">
              {curOpt.text}
            </span>
          ) : (
            <Icon name={iconNameOf(curOpt?.icon)} size={15} strokeWidth={2} />
          )}
          <Icon
            name="chevron-down"
            size={12}
            strokeWidth={2}
            className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </Tooltip>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={item.label}
          data-spinth-popover-panel=""
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          className="absolute left-1/2 top-full z-50 mt-2 flex w-max max-w-[calc(100vw-16px)] flex-wrap items-center justify-center gap-1 rounded-xl border border-edge bg-surface px-2 py-1.5 shadow-pop -translate-x-1/2"
          style={panelLeft === null ? undefined : { left: panelLeft }}
        >
          {item.options?.map((opt) => {
            const active = opt.id === current;
            return (
              <Tooltip key={opt.id} label={opt.label}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  aria-label={opt.label}
                  data-roving-item=""
                  tabIndex={-1}
                  onClick={() => {
                    onPick(item.id, opt.id);
                    closeAndRefocus();
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-100 ${
                    active
                      ? 'bg-surface-hover text-ink'
                      : 'text-ink-2 hover:bg-surface-hover/60 hover:text-ink'
                  }`}
                >
                  {opt.swatch ? (
                    <span
                      className="h-4 w-4 rounded-full border border-black/10"
                      style={{ backgroundColor: opt.swatch }}
                    />
                  ) : opt.text !== undefined ? (
                    <span className="text-xs font-semibold tabular-nums">{opt.text}</span>
                  ) : (
                    <Icon name={iconNameOf(opt.icon)} size={16} strokeWidth={2} />
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
