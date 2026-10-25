import { useLayoutEffect, useRef } from 'react';
import { spinthCommands, useSpinthStore } from '../index';
import { readSafeInsets } from '../a11y/safeArea';
import { useRovingFocus } from '../a11y/useRovingFocus';
import { Icon, type IconName } from './Icon';

/** store.contextMenu 镜像形状（core 的 IContextMenuState 未进公共面） */
interface IMenuPanelOptions {
  show: boolean;
  x: number;
  y: number;
  onWidget: boolean;
  canPaste: boolean;
}

const MENU_W = 216;
const ITEM_H = 34;
/** 分隔线占高（my-1 + 1px） */
const DIVIDER_H = 9;

/** 右键菜单（docs/12 §4）：contextMenuOptions$ 驱动，翻转 + 四面夹取防溢出。
 *  翻转/夹取用常量尺寸同步计算——state + effect 量宽会跨菜单打开残留旧翻转
 *  （右缘开过菜单后到中央再开，先按左侧渲染再闪回右侧，实测揪出）且
 *  修正延迟一帧造成闪烁。
 *  键盘协议（specs/a11y-closeout §5.3，批次 B W1）：外层只判空（hooks 顺序
 *  稳定），Panel 承担 role=menu/roving/焦点记录与归还——四条关闭路径统一走
 *  closeAndRestore()，不在各路径散写归还逻辑。 */
export function ContextMenu() {
  const options = useSpinthStore((s) => s.contextMenu);
  if (!options.show) return null;
  return <ContextMenuPanel options={options} />;
}

function ContextMenuPanel({ options }: { options: IMenuPanelOptions }) {
  const menuRef = useRef<HTMLDivElement>(null);
  /** 归还目标：面板挂载瞬间（首项聚焦前——layout effect 先于 hook 的被动
   *  effect）记录 activeElement，见 §5.4 焦点归还矩阵 */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeAndRestore = (): void => {
    spinthCommands.closeContextMenu();
    const el = returnFocusRef.current;
    // 归还目标须仍连接且非 body（指针右键时常为 body——退化到 stage）；
    // stage 不存在（W4 前/测试桩）则静默跳过
    const target =
      el && el.isConnected && el !== document.body
        ? el
        : document.getElementById('stage-container');
    target?.focus?.();
  };

  const { onKeyDown: rovingKeyDown, onFocus } = useRovingFocus({
    containerRef: menuRef,
    orientation: 'vertical',
    wrap: true,
    autoFocus: 'first',
  });

  useLayoutEffect(() => {
    // StrictMode 双跑防御：第二遍 effect 时 autoFocus（首遍 passive effect）已把
    // 焦点放进菜单——菜单自身永远不是合法归还目标，contained 一律不记录
    const active = document.activeElement as HTMLElement | null;
    if (active && !menuRef.current?.contains(active)) {
      returnFocusRef.current = active;
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      // 菜单自己的 Esc：关闭 + 归还 + 不再触发全局「Esc 清选区」（§5.3；
      // 服务层 window 兜底关闭幂等——焦点意外在外时仍能关）
      e.preventDefault();
      e.stopPropagation();
      closeAndRestore();
      return;
    }
    if (e.key === 'Tab') {
      // 关闭 + 归还（非模态不做焦点陷阱）：React 卸载时机 vs 浏览器默认 Tab
      // 有竞态，显式归还是确定性的（D2）；归还后再 Tab 从目标自然继续
      e.preventDefault();
      closeAndRestore();
      return;
    }
    rovingKeyDown(e); // 方向键/Home/End（Enter/Space 走原生 click）
  };

  const close = closeAndRestore;
  type MenuItem =
    | {
        label: string;
        icon?: IconName;
        hint?: string;
        disabled?: boolean;
        danger?: boolean;
        action: () => void;
      }
    | 'divider';
  const widgetItems: MenuItem[] = [
    {
      label: '复制',
      icon: 'copy',
      hint: '⌘C',
      action: () => void spinthCommands.copySelected().then(close),
    },
    {
      label: '剪切',
      icon: 'cut',
      hint: '⌘X',
      action: () => void spinthCommands.cutSelected().then(close),
    },
    {
      label: '粘贴',
      icon: 'paste',
      hint: '⌘V',
      disabled: !options.canPaste,
      action: () => {
        spinthCommands.pasteAtCenter();
        close();
      },
    },
    'divider',
    {
      label: '置顶',
      icon: 'bring-front',
      hint: '⌘⌥]',
      action: () => {
        spinthCommands.bringToFront();
        close();
      },
    },
    {
      label: '置底',
      icon: 'send-back',
      hint: '⌘⌥[',
      action: () => {
        spinthCommands.sendToBack();
        close();
      },
    },
    'divider',
    {
      label: '删除',
      icon: 'trash',
      hint: 'Del',
      danger: true,
      action: () => {
        spinthCommands.removeSelected();
        close();
      },
    },
  ];
  const stageItems: MenuItem[] = [
    {
      label: '粘贴',
      icon: 'paste',
      hint: '⌘V',
      disabled: !options.canPaste,
      action: () => {
        spinthCommands.pasteAtCenter();
        close();
      },
    },
    { label: '全选', icon: 'select-all', hint: '⌘A', disabled: true, action: close },
    {
      label: '导出画布 PNG',
      icon: 'image-down',
      action: () => {
        spinthCommands.exportPNG('canvas');
        close();
      },
    },
    'divider',
    {
      label: '适应屏幕',
      icon: 'zoom-fit',
      hint: 'F',
      action: () => {
        spinthCommands.zoomToFit();
        close();
      },
    },
  ];
  const items = options.onWidget ? widgetItems : stageItems;

  // 四面夹取（批次 B W3 §7.5）：先按常量尺寸同步翻转（跨菜单残留旧翻转实测
  // 揪出，见顶部注释），再 clamp 进含安全区的可视矩形——同时收口 450px 高
  // （Z1）与 320px 宽（R1）两类越界；菜单比可视区高时贴 minY + 自身滚动兜底。
  // 高度含上下边框各 1px（R1-c 实测：漏算 2px 会底边越界 2px）
  const menuH = items.reduce((h, i) => h + (i === 'divider' ? DIVIDER_H : ITEM_H), 12) + 2; // + py-1.5 上下 12px + 边框 2px
  const flipX = options.x + MENU_W > window.innerWidth;
  const flipY = options.y + menuH > window.innerHeight;
  const inset = readSafeInsets();
  const minX = inset.left + 8;
  const maxX = Math.max(minX, window.innerWidth - inset.right - 8 - MENU_W);
  const minY = inset.top + 8;
  const maxY = Math.max(minY, window.innerHeight - inset.bottom - 8 - menuH);
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  const left = clamp(flipX ? options.x - MENU_W : options.x, minX, maxX);
  const top = clamp(flipY ? options.y - menuH : options.y, minY, maxY);

  const style: React.CSSProperties = {
    position: 'fixed',
    left,
    top,
    zIndex: 500,
  };

  return (
    <div
      data-spinth-context-menu
      role="menu"
      aria-label={options.onWidget ? '元素操作' : '画布操作'}
      aria-orientation="vertical"
      ref={menuRef}
      style={style}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className="max-h-[calc(100dvh-16px)] w-[216px] overflow-y-auto rounded-xl border border-edge bg-surface py-1.5 shadow-pop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={i} role="separator" className="my-1 h-px bg-edge" aria-hidden />
        ) : (
          <button
            key={i}
            type="button"
            data-roving-item=""
            tabIndex={-1}
            role="menuitem"
            disabled={item.disabled}
            onClick={item.action}
            className={`group flex h-[34px] w-full items-center gap-2.5 px-2.5 text-[13px] font-semibold transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
              item.danger
                ? 'text-danger-ink hover:bg-danger-soft'
                : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center ${
                item.danger ? 'text-danger-ink' : 'text-ink-3 group-hover:text-ink-2'
              }`}
            >
              {item.icon && <Icon name={item.icon} size={15} strokeWidth={1.9} />}
            </span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.hint && (
              <kbd className="rounded-md bg-surface-hover px-1.5 py-0.5 font-ui text-[10px] font-bold text-ink-3 tabular-nums">
                {item.hint}
              </kbd>
            )}
          </button>
        ),
      )}
    </div>
  );
}
