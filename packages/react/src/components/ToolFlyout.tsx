import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRovingFocus } from '../a11y/useRovingFocus';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';
import type { IActionBarOption } from '@spinth/core';

/**
 * 工具坞常驻二级菜单（docs/12 §4 Toolbar 行）：工具激活即在其按钮正上方
 * 常驻显示的横向变体面板。可见性是 `cursorMode === mode` 的**纯派生状态**——
 * 无开合状态、无 Esc 独占、切走工具自动隐藏（创建完成回 cursor 亦随之隐藏）。
 * 点选即切默认值且面板保持（工具仍激活，可连续创建）；与 ActionBar 二级面板
 * 同一视觉语言（图标排 + 选中描边圈 + Tooltip 中文）。
 *
 * **多组**（线宽笔宽批升级）：一工具多参数分组渲染（line = 线型+线宽、
 * pen = 颜色+笔宽），组间细分隔线；单组 >8 项转 grid 两行轨道（shape 20 型
 * 2×10——grid 固定轨道不受 absolute 无宽容器 shrink-to-fit 塌缩影响，29 轮
 * 审查口径），多组恒单排（组自身超限目前不存在，出现时再议）。
 */
export interface IToolFlyoutGroup {
  options: IActionBarOption[];
  /** 当前默认值（选项 id）——选中点亮 + aria-checked */
  current: string;
  /** 激活态主题色类（Toolbar 的 TONE_ACTIVE 条目——选中项点亮同工具色） */
  activeClass: string;
  onPick: (id: string) => void;
}

/**
 * 定位（第三轮审查修复）：portal 到 body + fixed——曾 absolute 挂在工具按钮上，
 * 移动端 Toolbar 的 overflow-x-auto 滚动容器把出界的面板整块裁掉（390px 下
 * flyout.x=-114 完全不可点）；fixed 又会被 Toolbar 的 translate 祖先拖累，
 * 唯稳解是脱离原层级。视口 clamp：左右各留 8px、anchor 正上方。
 *
 * 锚点闩锁修复（plan/flyout-culling-linear-edge-scroll 问题 1）：React 挂宿主
 * ref 晚于子树 layout effect，首挂载读锚点可能为 null——place 带 rAF 补帧
 * 重试（最多 3 帧，不无限轮询），锚点经 Toolbar 的 layout effect 受控提供。
 * resize/orientationchange/scroll（capture——工具坞横向滚动）与 visualViewport
 * 变化同帧重算；setPos 同值短路防高频事件重渲染。
 */
export function ToolFlyout({
  groups,
  anchorRect,
}: {
  groups: IToolFlyoutGroup[];
  /** 锚点（激活工具按钮）矩形——惰性求值：place 时才读（滚动中实时） */
  anchorRect: () => DOMRect | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // roving（specs/a11y-closeout §5.7）：常驻面板不抢焦点（autoFocus=false，
  // 焦点仍在工具坞按钮），Tab 进入后方向键在选项间移动；Tooltip 包裹不改
  // DOM 层级，按钮仍是容器直接查询后代
  const { onKeyDown, onFocus } = useRovingFocus({
    containerRef: hostRef,
    orientation: 'both',
    wrap: true,
  });
  useLayoutEffect(() => {
    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const place = (): void => {
      if (cancelled) return;
      raf = 0;
      const el = hostRef.current;
      const rect = anchorRect();
      if (!el) return;
      if (!rect) {
        // 锚点尚未可读（首提交 ref 晚于本 effect）——补帧重试，防闩死 hidden
        if (attempts++ < 3) raf = requestAnimationFrame(place);
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const cx = rect.left + rect.width / 2;
      const left = Math.min(Math.max(8, cx - w / 2), Math.max(8, window.innerWidth - w - 8));
      const top = Math.max(8, rect.top - h - 8);
      setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
    };
    place();
    const invalidate = (): void => {
      attempts = 0;
      // 先取消挂起帧再同步重算，保持单帧调度（place 会按需重新预约）
      if (raf) cancelAnimationFrame(raf);
      place();
    };
    window.addEventListener('resize', invalidate);
    window.addEventListener('orientationchange', invalidate);
    // 工具坞 max-md:overflow-x-auto 可横向滚动：fixed 定位不随滚动容器走，
    // capture 捕获任意祖先滚动并同帧重算
    window.addEventListener('scroll', invalidate, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', invalidate);
    vv?.addEventListener('scroll', invalidate);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('orientationchange', invalidate);
      window.removeEventListener('scroll', invalidate, true);
      vv?.removeEventListener('resize', invalidate);
      vv?.removeEventListener('scroll', invalidate);
    };
  }, [anchorRect, groups]);
  const twoRow = groups.length === 1 && (groups[0]?.options.length ?? 0) > 8;
  return createPortal(
    <div
      ref={hostRef}
      role="menu"
      id="spinth-tool-flyout"
      data-spinth-tool-flyout=""
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden', // 首帧 measure 后落位（防闪跳）
        gridTemplateColumns: twoRow
          ? `repeat(${Math.ceil((groups[0]?.options.length ?? 0) / 2)}, max-content)`
          : undefined,
      }}
      className={`flyout-in z-20 gap-0.5 rounded-xl border border-edge bg-surface p-1.5 shadow-dock ${
        twoRow ? 'grid justify-center' : 'flex items-center justify-center'
      }`}
    >
      {groups.map((grp, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <div className="mx-0.5 h-5 w-px bg-edge" aria-hidden />}
          <div className={twoRow ? 'contents' : 'flex items-center gap-0.5'}>
            {grp.options.map((o) => {
              const checked = o.id === grp.current;
              // 选中态按选项型分流（PopoverControl 三分支先例）：icon/text 点亮工具主题色背景；
              // swatch 不吃 tone 背景（会污染色点观感）——改为色点 ring 描边（ring-current 走文字色）
              const checkedClass = o.swatch ? 'bg-surface-hover text-ink' : grp.activeClass;
              return (
                <Tooltip key={o.id} label={o.label}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    aria-label={o.label}
                    data-roving-item=""
                    tabIndex={-1}
                    onClick={() => grp.onPick(o.id)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-100 ${
                      checked ? checkedClass : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
                    }`}
                  >
                    {o.swatch ? (
                      <span
                        className={`h-4 w-4 rounded-full border border-black/10 ${checked ? 'ring-2 ring-current ring-offset-1' : ''}`}
                        style={{ backgroundColor: o.swatch }}
                      />
                    ) : o.text !== undefined ? (
                      <span className="text-xs font-semibold tabular-nums">{o.text}</span>
                    ) : (
                      <Icon name={(o.icon ?? '') as IconName} size={16} />
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
