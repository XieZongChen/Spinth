import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  isEditableTarget,
  shortcutGateAllows,
  UI_CHROME_ATTR,
} from '../platform/keyboard/shortcuts';

/** 铬件目标桩（specs/a11y-closeout §13.5-10）：closest 必须收到与常量一致的
 *  精确选择器——用 includes 会放过「常量改名但判定没跟上」的回归 */
const CHROME_SELECTOR = '[' + UI_CHROME_ATTR + ']';
const chromeTarget = (hit: boolean) =>
  ({
    closest: (sel: string) => (hit && sel === CHROME_SELECTOR ? {} : null),
  }) as unknown as EventTarget;

/**
 * 快捷键注册表结构守卫（2026-10-10 审计补测——b6980b9 产品级修复的回归窗）：
 * - cmd 系必有 ctrl 系孪生：hotkeys-js 的 cmd = metaKey 位专指（3.13.15 映射表
 *   核实、无 mod 平台自适应键名），单注册 cmd 时 Linux/Windows 真实用户按
 *   平台标准 Ctrl+Z 静默失效——E2E 用 ControlOrMeta 掩盖了「ctrl 条目缺失」
 * - id 唯一（重名互相覆盖绑定）
 * - isEditableTarget 输入态判定（hotkeys.filter 闸门的地基）
 */

describe('DEFAULT_SHORTCUTS cmd/ctrl 双注册结构', () => {
  it('每条 cmd 系键位都有 ctrl 系孪生（11 对），反向无孤儿 ctrl 项', () => {
    const keys = new Set(DEFAULT_SHORTCUTS.map((d) => d.keys));
    const cmdEntries = DEFAULT_SHORTCUTS.filter((d) => d.keys.startsWith('cmd+'));
    const ctrlEntries = DEFAULT_SHORTCUTS.filter((d) => d.keys.startsWith('ctrl+'));
    // 11 对 = 缩放 3 + 撤销重做 2 + 层级 4 + 编组解组 2（docs/18，2026-10-17）
    expect(cmdEntries).toHaveLength(11);
    expect(ctrlEntries).toHaveLength(11);
    for (const d of cmdEntries) {
      expect(keys.has(d.keys.replace('cmd+', 'ctrl+'))).toBe(true);
    }
    for (const d of ctrlEntries) {
      expect(keys.has(d.keys.replace('ctrl+', 'cmd+'))).toBe(true);
    }
  });

  it('id 唯一', () => {
    const ids = DEFAULT_SHORTCUTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // esc 的只读豁免不在注册表 allowInReadonly 字段——bind 层硬编码第三参
  // （keyboardService bind 'esc' 传 true），本断言只覆盖注册表白名单面
  it('视图类（断网白名单）恰为 cmd/ctrl 缩放 6 键 + f', () => {
    const readonlyIds = DEFAULT_SHORTCUTS.filter((d) => d.allowInReadonly).map((d) => d.id);
    expect(readonlyIds.sort()).toEqual(
      [
        'view.zoom100',
        'view.zoom1002',
        'view.zoomFit',
        'view.zoomIn',
        'view.zoomIn2',
        'view.zoomOut',
        'view.zoomOut2',
      ].sort(),
    );
  });
});

describe('isEditableTarget（filter 闸门地基）', () => {
  const el = (tagName: string, isContentEditable = false): EventTarget =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  it('INPUT / TEXTAREA / SELECT / contentEditable 判输入态', () => {
    expect(isEditableTarget(el('INPUT'))).toBe(true);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
    expect(isEditableTarget(el('DIV', true))).toBe(true);
  });

  it('普通元素与空 target 不是输入态', () => {
    expect(isEditableTarget(el('DIV'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('shortcutGateAllows 真值表（specs/a11y-closeout §5.5，优先级即顺序）', () => {
  const inputTarget = { tagName: 'INPUT' } as unknown as EventTarget;
  const plainTarget = {} as EventTarget;

  it('capture 输入态快照 → false（优先于一切）', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: true,
        uiModalOpen: false,
        target: plainTarget,
        key: 'z',
      }),
    ).toBe(false);
  });

  it('target 是输入元素 → false', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: inputTarget,
        key: 'z',
      }),
    ).toBe(false);
  });

  it('UI 模态浮层开着 → 全静默（含修饰组合，D3）', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: true,
        target: plainTarget,
        key: 'z',
      }),
    ).toBe(false);
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: true,
        target: plainTarget,
        key: 'meta',
      }),
    ).toBe(false);
  });

  it('单独修饰键 → true（不干扰组合键判定）', () => {
    for (const key of ['control', 'meta', 'alt', 'shift']) {
      expect(
        shortcutGateAllows({
          editableAtCapture: false,
          uiModalOpen: false,
          target: plainTarget,
          key,
        }),
      ).toBe(true);
    }
  });

  it('其余普通键 → true（只读白名单由 bindAll 守卫兜底）', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: plainTarget,
        key: 'v',
      }),
    ).toBe(true);
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: null,
        key: 'delete',
      }),
    ).toBe(true);
  });

  // 宿主铬件焦点作用域（specs/a11y-closeout §13.5-10）：焦点落在 data-spinth-ui
  // 子树内（如 PWA 更新横幅按钮）时全静默——铬件内按键是控件语义，不得落到画布
  it('铬件焦点 + delete → false（横幅内 Delete 不删画布选中）', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: chromeTarget(true),
        key: 'delete',
      }),
    ).toBe(false);
  });

  it('铬件焦点 + 单独修饰键 → false（全静默不设例外）', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: chromeTarget(true),
        key: 'meta',
      }),
    ).toBe(false);
  });

  it('closest 未命中铬件（普通画布目标）→ true', () => {
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: chromeTarget(false),
        key: 'delete',
      }),
    ).toBe(true);
  });

  it('target 为 null / 无 closest → 不抛错且 true', () => {
    expect(
      shortcutGateAllows({ editableAtCapture: false, uiModalOpen: false, target: null, key: 'v' }),
    ).toBe(true);
    // plainTarget 无 closest 方法（document 等非 Element 目标同形态）
    expect(
      shortcutGateAllows({
        editableAtCapture: false,
        uiModalOpen: false,
        target: {} as EventTarget,
        key: 'v',
      }),
    ).toBe(true);
  });
});
