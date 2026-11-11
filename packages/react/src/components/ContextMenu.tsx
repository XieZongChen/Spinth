import { useLayoutEffect, useRef, useState } from 'react';
import { spinthCommands, useSpinthStore } from '../index';
import { readSafeInsets } from '../a11y/safeArea';
import { useRovingFocus } from '../a11y/useRovingFocus';
import { Icon, type IconName } from './Icon';
import { estimateMenuSize, placeMenu } from './menuPlacement';

/** store.contextMenu 镜像形状（core 的 IContextMenuState 未进公共面） */
interface IMenuPanelOptions {
  show: boolean;
  x: number;
  y: number;
  onWidget: boolean;
  canPaste: boolean;
  /** 「清理悬空连线」可用（specs/flowchart-closeout §7.6） */
  canPrune: boolean;
}

/** 右键菜单（docs/12 §4）：contextMenuOptions$ 驱动，翻转 + 四面夹取防溢出。
 *  定位跟随实测尺寸（specs/rem-typography §4.6）：面板宽与行高是 rem，随根字号
 *  缩放、文本还可能折行，常量只做首帧估算——首帧按估算同步定位（夹取保证落在
 *  视口内，键盘打开聚焦首项不会触发滚屏），useLayoutEffect 实测与估算不同才
 *  setState，React 在绘制前同步重渲染，用户看不到中间帧。
 *  曾经的 state + useEffect 量宽被回滚有两宗罪：跨菜单打开残留旧翻转（右缘开过
 *  菜单后到中央再开，先按左侧渲染再闪回右侧，实测揪出）、修正晚一帧造成闪烁。
 *  现方案用 layout effect 消除晚一帧，用打开签名（x/y/onWidget）隔离实测值消除
 *  残留——菜单开着时再按 Shift+F10 不会重挂载面板，签名变了即回落估算。
 *  键盘协议（specs/a11y-closeout §5.3，批次 B W1）：外层只判空（hooks 顺序
 *  稳定），Panel 承担 role=menu/roving/焦点记录与归还——四条关闭路径统一走
 *  closeAndRestore()，不在各路径散写归还逻辑。 */
export function ContextMenu() {
  const options = useSpinthStore((s) => s.contextMenu);
  const gridSnap = useSpinthStore((s) => s.gridSnap);
  if (!options.show) return null;
  return <ContextMenuPanel options={options} gridSnap={gridSnap} />;
}

function ContextMenuPanel({
  options,
  gridSnap,
}: {
  options: IMenuPanelOptions;
  gridSnap: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  /** 归还目标：面板挂载瞬间（首项聚焦前——layout effect 先于 hook 的被动
   *  effect）记录 activeElement，见 §5.4 焦点归还矩阵 */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** 实测面板尺寸，带打开签名：签名不符（同一面板被重开到别处）即视为未测 */
  const [measured, setMeasured] = useState<{ sig: string; width: number; height: number } | null>(
    null,
  );

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
      // 网格吸附（specs/flowchart-closeout §9.2）：勾选态经 label 表达（MenuItem
      // 无 toggle 语义，值在菜单打开时定格）；视图偏好——只读态可用
      label: gridSnap ? '网格吸附 ✓' : '网格吸附',
      icon: 'select-all',
      action: () => {
        spinthCommands.setGridSnap(!gridSnap);
        close();
      },
    },
    {
      // 清理悬空连线（specs/flowchart-closeout §7.6）：删锚定节点遗留的断头线；
      // 无匹配禁用；只读态禁用（canPrune 恒 false，命令层另有一层守卫）
      label: '清理悬空连线',
      icon: 'link',
      disabled: !options.canPrune,
      action: () => {
        spinthCommands.pruneDanglingLines();
        close();
      },
    },
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

  // 定位（specs/rem-typography §4.6）：实测优先、估算兜底；翻转 + 四面夹取在
  // menuPlacement 纯函数（批次 B W3 §7.5 的 Z1 高 / R1 宽两类越界收口）
  const sig = `${options.x},${options.y},${options.onWidget}`;
  const dividerCount = items.filter((i) => i === 'divider').length;
  const size =
    measured?.sig === sig ? measured : estimateMenuSize(items.length - dividerCount, dividerCount);
  useLayoutEffect(() => {
    // 无依赖数组：每次渲染后对齐（禁用态/折行变化都可能改尺寸），相等短路保证
    // 不循环；jsdom 无布局读到 0 → 保持估算
    const el = menuRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width === 0 || height === 0) return;
    if (Math.abs(width - size.width) < 0.5 && Math.abs(height - size.height) < 0.5) return;
    setMeasured({ sig, width, height });
  });
  const { left, top } = placeMenu({
    anchor: { x: options.x, y: options.y },
    size,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    safe: readSafeInsets(),
  });

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
      className="max-h-[calc(100dvh-16px)] w-[13.5rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-edge bg-surface py-1.5 shadow-pop"
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
            className={`group flex min-h-[2.125rem] w-full items-center gap-2.5 px-2.5 text-md font-semibold transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
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
              <kbd className="rounded-md bg-surface-hover px-1.5 py-0.5 font-ui text-3xs font-bold text-ink-3 tabular-nums">
                {item.hint}
              </kbd>
            )}
          </button>
        ),
      )}
    </div>
  );
}
