import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type { ISelectorService, IViewportService, IVmEngineService, CursorMode } from '../../types';
import type { IRect } from '../../common/geometry';
import { unionRects } from '../../common/geometry';
import { isEditableTarget } from '../keyboard/shortcuts';
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
    /** 收口内联编辑会话（组合根注入 editingService.exitActive；specs/a11y-closeout
     *  §5.3——画布右键会命中「点已选中件进编辑」路径异步开出编辑器，其挂载
     *  焦点会抢走菜单首项聚焦；开菜单 = 语境切换，先 flush 尾字收口） */
    private exitEdit: () => void = () => {},
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
      // 画布右键 = 语境切换：先收口可能因命中已选中件而开启的内联编辑（§5.3）
      this.exitEdit();
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
    // 键盘打开（specs/a11y-closeout §5.6）：Shift+F10 / Menu 键走原生 capture
    // 监听，不塞进 hotkeys——ContextMenu 键名在 hotkeys-js 的映射不可靠，且
    // capture 相先于菜单自身的 keydown（菜单打开后的方向键不经过这里）
    const onKeyOpen = (e: KeyboardEvent): void => {
      if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
      if (isEditableTarget(e.target)) return; // 编辑器内是原生菜单语境
      e.preventDefault();
      this.openFromKeyboard();
    };
    target.addEventListener('contextmenu', onCtx);
    window.addEventListener('pointerdown', onClose, { capture: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onKeyOpen, { capture: true });
    this.addDisposable(
      () => target.removeEventListener('contextmenu', onCtx),
      () =>
        window.removeEventListener('pointerdown', onClose, {
          capture: true,
        } as AddEventListenerOptions),
      () => window.removeEventListener('keydown', onKey),
      () => window.removeEventListener('keydown', onKeyOpen, { capture: true }),
    );
  }

  /**
   * 键盘打开（specs/a11y-closeout §5.6）：锚点推导而非指针位置——
   * 1. 只读 → 页面包络中心的屏幕坐标，画布菜单（onWidget=false、canPaste 恒
   *    false，与右键只读分支同语义 docs/21 §4）；
   * 2. 可写有选中 → 选中外接矩形中心（worldToClient——DOM 浮层坐标语义），
   *    元素菜单、canPaste 同源 hasClipboard；
   * 3. 可写无选中 → 页面包络中心，画布菜单。
   * 不改 contextMenuOptions$ 形状（show/x/y/onWidget/canPaste）——桥零改动。
   */
  openFromKeyboard(): void {
    this.exitEdit(); // 同右键：开菜单即收口编辑会话
    const page = this.viewport.getPageBounds();
    const center = { x: page.x + page.width / 2, y: page.y + page.height / 2 };
    if (!this.viewport.editable$.value) {
      const p = this.viewport.worldToClient(center);
      this.options$.next({ show: true, x: p.x, y: p.y, onWidget: false, canPaste: false });
      return;
    }
    const selected = this.selector.selected$.value;
    if (selected.length > 0) {
      const bounds = selected
        .map((id) => this.vmEngine.getVmById(id)?.getBounds())
        .filter((b): b is IRect => !!b);
      const union = unionRects(bounds);
      if (union) {
        const p = this.viewport.worldToClient({
          x: union.x + union.width / 2,
          y: union.y + union.height / 2,
        });
        this.options$.next({
          show: true,
          x: p.x,
          y: p.y,
          onWidget: true,
          canPaste: this.hasClipboard(),
        });
        return;
      }
    }
    const p = this.viewport.worldToClient(center);
    this.options$.next({
      show: true,
      x: p.x,
      y: p.y,
      onWidget: false,
      canPaste: this.hasClipboard(),
    });
  }

  close(): void {
    if (this.options$.value.show) {
      this.options$.next({ ...this.options$.value, show: false });
    }
  }
}
