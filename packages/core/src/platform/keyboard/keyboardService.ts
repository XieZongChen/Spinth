import hotkeys from 'hotkeys-js';
import { Disposable } from '../../base/disposable';
import type { IViewportService } from '../../types';
import {
  DEFAULT_SHORTCUTS,
  isEditableTarget,
  isInteractiveUiTarget,
  NATIVE_UI_KEYS,
  type IShortcutDef,
  type IShortcutHandlers,
} from './shortcuts';

/** 微移步长：1px / shift 10px（docs/09 §2） */
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;

/**
 * 快捷键服务（docs/09 §2）：声明式注册表 + hotkeys-js 绑定 + filter 全局闸门。
 * 闸门矩阵：输入态不触发；只读模式仅 allowInReadonly。
 */
export class KeyboardService extends Disposable {
  private defs: IShortcutDef[] = DEFAULT_SHORTCUTS;

  /** 物理断网判定（组合根注入 NetworkService.editBlocked$——两态语义单源，docs/10 §4） */
  isBlocked: () => boolean = () => (typeof navigator !== 'undefined' ? !navigator.onLine : false);

  /** capture 相输入态快照：富文本编辑器的 Esc 处理器在冒泡中途 detach 编辑器
   *  （setEditable(false)+blur），event.target 的 isContentEditable 到 document
   *  层已被现场翻成 false——hotkeys.filter 按 target 过滤会漏判，快捷键穿透
   *  编辑器（实测：线上文字编辑中按 Esc 退出编辑的同时清空选区）。capture 相
   *  先于一切处理器，此刻的 target 可编辑性才是真实输入态。 */
  private editableAtCapture = false;

  private readonly captureKeyDown = (e: KeyboardEvent): void => {
    this.editableAtCapture = isEditableTarget(e.target);
  };

  constructor(
    private viewport: IViewportService,
    private handlers: IShortcutHandlers,
  ) {
    super();
  }

  initialize(): void {
    hotkeys.filter = (event): boolean => {
      if (this.editableAtCapture) return false;
      const target = event.target as EventTarget | null;
      if (isEditableTarget(target)) return false;
      // 修饰键单独按下放行（不干扰组合键判定）
      const key = (event.key ?? '').toLowerCase();
      if (['control', 'meta', 'alt', 'shift'].includes(key)) return true;
      // 只读模式：仅放行声明 allowInReadonly 的快捷键（按 keys 匹配当前事件难以可靠，
      // 简化：只读模式下 handler 内自查——此处统一放行，由 bindAll 的守卫兜底）
      return true;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.captureKeyDown, true);
      this.addDisposable(() => window.removeEventListener('keydown', this.captureKeyDown, true));
    }
    this.bindAll();
    this.addDisposable(() => hotkeys.unbind());
  }

  /** 程序化全量重绑（替换 defs 重挂；无用户改键 UI——docs/09 §2 口径） */
  setShortcuts(defs: IShortcutDef[]): void {
    this.defs = defs;
    hotkeys.unbind();
    this.bindAll();
  }

  private bindAll(): void {
    const bind = (
      keys: string,
      handler: (e: KeyboardEvent) => void,
      allowInReadonly = false,
    ): void => {
      hotkeys(keys, (event) => {
        // 键盘可达性（2026-10-17 外部审查 4.1）：聚焦 UI 控件时 Enter/Space/
        // Tab/方向键是原生行为——放行不吞（tab/enter 绑定的脑图建子/同级只在
        // 画布焦点态生效，与脑图焦点不共存于按钮焦点，零语义损失）
        if (
          isInteractiveUiTarget(event.target) &&
          NATIVE_UI_KEYS.has((event.key ?? '').toLowerCase())
        ) {
          return;
        }
        // 只读/物理断网白名单（docs/09 §2 + docs/10 §4）：非白名单快捷键统一在此闸掉。
        // 只断 ws（editBlocked=false）不拦——离线可编辑是 CRDT 卖点
        if (!allowInReadonly) {
          if (!this.viewport.editable$.value) return;
          if (this.isBlocked()) return;
        }
        event.preventDefault();
        handler(event);
      });
    };

    for (const def of this.defs) {
      switch (def.id) {
        case 'tool.cursor':
          bind(def.keys, () => this.handlers.setCursorMode('cursor'));
          break;
        case 'tool.hand':
          bind(def.keys, () => this.handlers.setCursorMode('hand'));
          break;
        case 'tool.shape':
          bind(def.keys, () => this.handlers.setCursorMode('shape'));
          break;
        case 'tool.text':
          bind(def.keys, () => this.handlers.setCursorMode('text'));
          break;
        case 'tool.line':
          bind(def.keys, () => this.handlers.setCursorMode('line'));
          break;
        case 'tool.pen':
          bind(def.keys, () => this.handlers.setCursorMode('pen'));
          break;
        case 'tool.eraser':
          bind(def.keys, () => this.handlers.setCursorMode('eraser'));
          break;
        case 'tool.eraser.widen':
          bind(def.keys, () => this.handlers.eraserSize(4));
          break;
        case 'tool.eraser.narrow':
          bind(def.keys, () => this.handlers.eraserSize(-4));
          break;
        case 'tool.sticky':
          bind(def.keys, () => this.handlers.setCursorMode('sticky'));
          break;
        case 'tool.mind':
          bind(def.keys, () => this.handlers.setCursorMode('mind'));
          break;
        case 'view.zoomIn':
        case 'view.zoomIn2':
          bind(def.keys, () => this.handlers.zoomIn(), def.allowInReadonly);
          break;
        case 'view.zoomOut':
        case 'view.zoomOut2':
          bind(def.keys, () => this.handlers.zoomOut(), def.allowInReadonly);
          break;
        case 'view.zoom100':
        case 'view.zoom1002':
          bind(def.keys, () => this.handlers.zoomTo100(), def.allowInReadonly);
          break;
        case 'view.zoomFit':
          bind(def.keys, () => this.handlers.zoomToFit(), def.allowInReadonly);
          break;
        case 'edit.undo':
        case 'edit.undo2':
          bind(def.keys, () => this.handlers.undo());
          break;
        case 'edit.redo':
        case 'edit.redo2':
          bind(def.keys, () => this.handlers.redo());
          break;
        case 'edit.delete':
          bind(def.keys, () => this.handlers.removeSelected());
          break;
        case 'edit.escape':
          bind(def.keys, () => this.handlers.clearSelection(), true); // 只读可退出/取消
          break;
        case 'layer.forward':
        case 'layer.forward2':
          bind(def.keys, () => this.handlers.bringForward());
          break;
        case 'layer.backward':
        case 'layer.backward2':
          bind(def.keys, () => this.handlers.sendBackward());
          break;
        case 'layer.front':
        case 'layer.front2':
          bind(def.keys, () => this.handlers.bringToFront());
          break;
        case 'layer.back':
        case 'layer.back2':
          bind(def.keys, () => this.handlers.sendToBack());
          break;
        case 'edit.group':
        case 'edit.group2':
          bind(def.keys, () => this.handlers.groupSelection());
          break;
        case 'edit.ungroup':
        case 'edit.ungroup2':
          bind(def.keys, () => this.handlers.ungroupSelection());
          break;
        case 'mind.addChild':
          bind(def.keys, () => this.handlers.mindAddChild());
          break;
        case 'mind.addSibling':
          bind(def.keys, () => this.handlers.mindAddSibling());
          break;
        case 'move.up':
        case 'move.down':
        case 'move.left':
        case 'move.right':
          bind(def.keys, (e) => {
            // 脑图焦点存在时方向键 = 节点导航（docs/11 §7）：由脑图消费掉，
            // 不做 1px 微移——既有设计在脑图选中态下方向键同样是焦点导航
            if (this.handlers.mindNavigate(e.key)) return;
            const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
            const [dx, dy] =
              def.id === 'move.up'
                ? [0, -step]
                : def.id === 'move.down'
                  ? [0, step]
                  : def.id === 'move.left'
                    ? [-step, 0]
                    : [step, 0];
            this.handlers.nudge(dx, dy, e.shiftKey);
          });
          break;
      }
    }
  }

  override dispose(): void {
    hotkeys.unbind();
    super.dispose();
  }
}
