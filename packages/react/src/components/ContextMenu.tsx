import { spinthCommands, useSpinthStore } from '../index';
import { readSafeInsets } from '../a11y/safeArea';
import { Icon, type IconName } from './Icon';

const MENU_W = 216;
const ITEM_H = 34;
/** 分隔线占高（my-1 + 1px） */
const DIVIDER_H = 9;

/** 右键菜单（docs/12 §4）：contextMenuOptions$ 驱动，边缘翻转防溢出。
 *  翻转用常量尺寸同步计算——state + effect 量宽会跨菜单打开残留旧翻转
 *  （右缘开过菜单后到中央再开，先按左侧渲染再闪回右侧，实测揪出）且
 *  修正延迟一帧造成闪烁。 */
export function ContextMenu() {
  const options = useSpinthStore((s) => s.contextMenu);

  if (!options.show) return null;

  const close = () => spinthCommands.closeContextMenu();
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
    // 不设 role="menu"/"menuitem"：菜单键盘协议（方向键/roving focus）未实现，
    // 设了反而抬高达不到的可达性预期；按钮本身可达，Esc/点外关闭由服务层处理；
    // data-spinth-context-menu：服务层外点关闭判定豁免菜单自身按下（防 click 丢失）
    <div
      data-spinth-context-menu
      style={style}
      className="max-h-[calc(100dvh-16px)] w-[216px] overflow-y-auto rounded-xl border border-edge bg-surface py-1.5 shadow-pop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={i} className="my-1 h-px bg-edge" aria-hidden />
        ) : (
          <button
            key={i}
            type="button"
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
