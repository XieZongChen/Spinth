// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isHostUiModalOpen, UI_MODAL_ATTR } from './uiModal';

/** 宿主浮层标记真值表（specs/a11y-closeout §13.5-1）：标记存在 ⟺ 面板打开 */
describe('isHostUiModalOpen（宿主浮层标记查询）', () => {
  afterEach(() => {
    for (const el of document.querySelectorAll(`[${UI_MODAL_ATTR}]`)) el.remove();
  });

  it('无标记 → false（面板全关）', () => {
    expect(isHostUiModalOpen(), '无 data-spinth-ui-modal 时应判定无浮层').toBe(false);
  });

  it('打了一个标记 → true', () => {
    const el = document.createElement('div');
    el.setAttribute(UI_MODAL_ATTR, '');
    document.body.appendChild(el);
    expect(isHostUiModalOpen(), '存在标记时应判定浮层开着').toBe(true);
  });

  it('移除标记 → false（面板条件卸载即失效）', () => {
    const el = document.createElement('div');
    el.setAttribute(UI_MODAL_ATTR, '');
    document.body.appendChild(el);
    el.remove();
    expect(isHostUiModalOpen(), '标记移除后应立即回到 false').toBe(false);
  });

  it('多个标记同时存在 → 仍 true（任一浮层开着即闸门生效）', () => {
    for (let i = 0; i < 2; i++) {
      const el = document.createElement('div');
      el.setAttribute(UI_MODAL_ATTR, '');
      document.body.appendChild(el);
    }
    const count = document.querySelectorAll(`[${UI_MODAL_ATTR}]`).length;
    expect(count, '夹具应有 2 个标记').toBe(2);
    expect(isHostUiModalOpen(), '多浮层并存时仍应判定 true').toBe(true);
  });
});
