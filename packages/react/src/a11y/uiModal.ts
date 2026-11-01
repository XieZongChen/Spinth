/**
 * 宿主浮层标记（specs/a11y-closeout §13.5-1）：core 快捷键闸门据此全静默。
 * 面板条件渲染 → 标记存在 ⟺ 打开；不受 state/DOM 同步窗口影响
 */
export const UI_MODAL_ATTR = 'data-spinth-ui-modal';

/** 宿主浮层是否开着（无 DOM 环境 → false） */
export function isHostUiModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(`[${UI_MODAL_ATTR}]`) !== null;
}
