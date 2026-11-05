import { useEffect, useRef } from 'react';
import { UI_CHROME_ATTR, useSpinthStore } from '@spinth/react';
import { usePwaUpdate } from './useServiceWorker';

/**
 * 「新版本可用」横幅（specs/pwa §10）：顶部居中，与 OfflineBar 同锚点；
 * 二者互斥——editBlocked 优先时本横幅不渲染（单机 editBlocked 恒 false，
 * 该分支留给协同宿主）。role=status polite，出现不抢焦点；「稍后」= 本会话
 * 不再提示；关闭后若焦点曾在横幅内，归还触发元素。
 *
 * 根节点打 UI_CHROME_ATTR（specs/a11y-closeout §13.5-10）：横幅常驻（不处理
 * 就一直在），不能用 modal 闸门（会长期吞掉全部热键）——焦点落在横幅内时
 * 热键按铬件作用域静默，Delete 不再泄漏到画布删选中。
 */
export function PwaUpdateBanner() {
  const editBlocked = useSpinthStore((s) => s.editBlocked);
  const pwa = usePwaUpdate();
  // 横幅出现瞬间的焦点元素（触发元素）；undefined = 当前不可见（重出现时重捕获）
  const triggerRef = useRef<HTMLElement | null | undefined>(undefined);
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pwa.visible) {
      if (triggerRef.current === undefined) {
        triggerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
    } else {
      triggerRef.current = undefined;
    }
  }, [pwa.visible]);

  if (editBlocked || !pwa.visible) return null;

  const dismiss = () => {
    if (bannerRef.current?.contains(document.activeElement)) {
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected) trigger.focus();
    }
    pwa.dismiss();
  };

  return (
    <div
      ref={bannerRef}
      role="status"
      data-spinth-pwa-banner=""
      {...{ [UI_CHROME_ATTR]: '' }}
      className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-edge bg-surface py-1 pl-4 pr-1.5 text-[0.75rem] font-bold text-ink shadow-pop max-w-[calc(100vw-16px)]"
    >
      <span className="whitespace-nowrap">{pwa.ready ? '新版本已就绪' : '新版本可用'}</span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={pwa.apply}
          disabled={pwa.applying}
          className="flex min-h-6 items-center justify-center rounded-full bg-accent-fill px-3 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover max-[419px]:min-h-11 max-[419px]:min-w-11"
        >
          刷新
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flex min-h-6 items-center justify-center rounded-full px-3 text-xs font-semibold text-ink-2 transition-colors duration-150 hover:bg-surface-hover hover:text-ink max-[419px]:min-h-11 max-[419px]:min-w-11"
        >
          稍后
        </button>
      </span>
    </div>
  );
}
