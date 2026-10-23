import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { ISelectorService, IViewportService, IVmEngineService, CursorMode } from '../../types';
/** 右键菜单状态（docs/09 §2 由 contextMenu 服务驱动 UI） */
export interface IContextMenuState {
  show: boolean;
  /** 屏幕坐标 */
  x: number;
  y: number;
  /** 有选中 = 元素菜单；无 = 画布菜单 */
  onWidget: boolean;
  canPaste: boolean;
}

/**
 * 右键菜单服务：contextmenu 事件 → 状态流（React 层渲染）。
 * 命令走 BoardSDK 公开方法（copySelected/pasteAt/...）。
 */
export class ContextMenuService extends Disposable {
  readonly options$ = new BehaviorSubject<IContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    onWidget: false,
    canPaste: false,
  });

  constructor(
    private viewport: IViewportService,
    private selector: ISelectorService,
    private vmEngine: IVmEngineService,
    private hasClipboard: () => boolean,
    private modeGuard: () => CursorMode,
  ) {
    super();
  }

  initialize(): void {
    const target: HTMLElement | Document = this.viewport.container ?? document;
    const onCtx = (e: Event): void => {
      const me = e as MouseEvent;
      // 编辑器内右键不拦截（TipTap 原生菜单）
      const t = me.target as HTMLElement;
      if (t?.isContentEditable) return;
      me.preventDefault();
      if (this.modeGuard() !== 'cursor') return;
      // 只读降级（docs/21 §4）：右键是 DOM 事件，不经 viewport 指针闸门——
      // 此处必须自守：不建选区（选区会把 ActionBar 整条带进只读画布）、
      // 不出元素菜单、粘贴恒不可用；菜单仍打开，只留读操作（导出/适应屏幕）
      if (!this.viewport.editable$.value) {
        this.options$.next({
          show: true,
          x: me.clientX,
          y: me.clientY,
          onWidget: false,
          canPaste: false,
        });
        return;
      }
      // clientX/Y - canvas 页偏移（offsetX 隐含 target=canvas 的假设，
      // 落在其他 DOM 子元素上时坐标错误——外部审查提示）
      const canvas = this.viewport.container?.querySelector('canvas');
      const cr = canvas?.getBoundingClientRect();
      const local = cr
        ? { x: me.clientX - cr.left, y: me.clientY - cr.top }
        : { x: me.offsetX, y: me.offsetY };
      const world = this.viewport.toWorld(local);
      const hits = this.vmEngine.getVmByPoint(world);
      const hit = hits.length > 0;
      // 右键未命中已选元素 → 就地选中该元素（设计工具惯例）
      if (hit) {
        const top = hits[0]!;
        if (!this.selector.selected$.value.includes(top.id)) {
          this.selector.setSelected([top.id]);
        }
      } else {
        this.selector.setSelected([]);
      }
      this.options$.next({
        show: true,
        x: me.clientX,
        y: me.clientY,
        onWidget: hit,
        canPaste: this.hasClipboard(),
      });
    };
    const onClose = (e: PointerEvent): void => {
      // 菜单项自身的按下不关菜单——否则组件在 down/up 之间被卸载，
      // 浏览器不再派发 click，菜单项点击全部失效（外部审查实测实锤）
      const el = e.target as Element | null;
      if (el?.closest?.('[data-spinth-context-menu]')) return;
      this.close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.close();
    };
    target.addEventListener('contextmenu', onCtx);
    window.addEventListener('pointerdown', onClose, { capture: true });
    window.addEventListener('keydown', onKey);
    this.addDisposable(
      () => target.removeEventListener('contextmenu', onCtx),
      () =>
        window.removeEventListener('pointerdown', onClose, {
          capture: true,
        } as AddEventListenerOptions),
      () => window.removeEventListener('keydown', onKey),
    );
  }

  close(): void {
    if (this.options$.value.show) {
      this.options$.next({ ...this.options$.value, show: false });
    }
  }
}
