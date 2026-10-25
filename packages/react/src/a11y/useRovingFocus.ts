/**
 * Roving focus DOM 契约 hook（specs/a11y-closeout §5.2）。
 *
 * DOM 契约（消费者必须遵守）：
 * 1. 每个可聚焦项加 `data-roving-item`，JSX 初始 `tabIndex={-1}`；
 * 2. hook 挂载后把唯一活动项设为 `tabIndex=0`（单 Tab 停靠——WCAG 2.4.3）；
 * 3. keydown 只处理本方向键 + Home/End，命中即 preventDefault() 并 focus；
 * 4. focusin 冒泡到容器时更新活动项（鼠标点选后 Tab 停靠跟随）；
 * 5. 容器内没有任何可用项时不做任何事（不抢焦点、不抛错）。
 *
 * effect 无依赖数组（每次渲染后同步 tabIndex）：菜单内容是动态的（禁用态/
 * 分支切换），逐渲染对齐比订阅 DOM 变更简单可靠，且只是属性写，代价可忽略。
 */
import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';
import {
  edgeEnabledIndex,
  nextEnabledIndex,
  stepForKey,
  type RovingOrientation,
} from './rovingFocus';

export interface IUseRovingFocusOptions {
  containerRef: RefObject<HTMLElement | null>;
  orientation: RovingOrientation;
  /** 首尾循环；默认 true（Toolbar 传 false——工具序两端即语义尽头） */
  wrap?: boolean;
  /** 挂载即聚焦首/尾可用项（ContextMenu/ProjectMenu 菜单打开语义）；默认 false */
  autoFocus?: 'first' | 'last' | false;
  /** 参与遍历的项；默认全部 data-roving-item（含禁用——跳过逻辑读 disabled） */
  itemSelector?: string;
}

function isItemDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
}

export function useRovingFocus(o: IUseRovingFocusOptions): {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
} {
  const {
    containerRef,
    orientation,
    wrap = true,
    autoFocus = false,
    itemSelector = '[data-roving-item]',
  } = o;

  const itemsOf = (): HTMLElement[] =>
    containerRef.current
      ? Array.from(containerRef.current.querySelectorAll<HTMLElement>(itemSelector))
      : [];

  const setActive = (items: HTMLElement[], idx: number, focus: boolean): void => {
    items.forEach((el, i) => {
      el.tabIndex = i === idx ? 0 : -1;
    });
    if (focus) items[idx]?.focus();
  };

  // 每次渲染后：保证恰好一个 tabIndex=0（挂载/动态内容/卸载残留兜底）。
  // autoFocus 只在挂载（含 StrictMode 双跑的首个真实挂载沿）聚焦一次——重渲染
  // 不再抢焦点（复审 P2：ProjectMenu busy/warning 重渲染曾把焦点从「打开新
  // 画布/稍后」等非 roving 按钮拉回菜单项）；后续焦点跟随全靠 focusin
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    const items = itemsOf();
    if (items.length === 0) {
      // 容器清空（面板条件卸载，如 ProjectMenu open=false）→ 重置一次性标记：
      // 内容重新出现视为一次新的「挂载」，autoFocus 再次生效（否则第二次打开
      // 菜单不聚焦首项）。常驻容器（Toolbar）不为空，标记不会被重置
      autoFocusedRef.current = false;
      return;
    }
    const disabled = items.map(isItemDisabled);
    const marked = items.findIndex((el) => el.tabIndex === 0 && !isItemDisabled(el));
    const active =
      marked >= 0
        ? marked
        : autoFocus === 'last'
          ? edgeEnabledIndex(disabled, 'last')
          : edgeEnabledIndex(disabled, 'first');
    if (active < 0) return;
    const shouldFocus = autoFocus !== false && !autoFocusedRef.current;
    // 标记放在 focus 前：StrictMode 双跑的第二沿是「重挂载」，焦点已在容器内
    // （onFocus 已同步停靠位）——再聚焦是幂等的；标记保证它不发生在之后的
    // 普通重渲染
    if (shouldFocus) autoFocusedRef.current = true;
    setActive(items, active, shouldFocus);
  });

  const onFocus = (e: FocusEvent<HTMLElement>): void => {
    const items = itemsOf();
    const idx = items.indexOf(e.target as HTMLElement);
    if (idx >= 0) setActive(items, idx, false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const items = itemsOf();
    if (items.length === 0) return;
    const disabled = items.map(isItemDisabled);
    if (e.key === 'Home' || e.key === 'End') {
      const target = edgeEnabledIndex(disabled, e.key === 'Home' ? 'first' : 'last');
      if (target >= 0) {
        e.preventDefault();
        setActive(items, target, true);
      }
      return;
    }
    const step = stepForKey(e.key, orientation);
    if (step === 0) return; // 非本方向键：不拦截（Enter/Space 走原生 click）
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const from = current >= 0 ? current : step > 0 ? -1 : disabled.length; // 无焦点时按方向从边界进
    const next = nextEnabledIndex(disabled, from, step, wrap);
    if (next >= 0) setActive(items, next, true);
  };

  return { onKeyDown, onFocus };
}
