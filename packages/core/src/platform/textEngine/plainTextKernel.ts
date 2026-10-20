import { Disposable } from '../../base/disposable';
import type { IEditSessionDescriptor, IPlainEditorStyle, IViewportService } from '../../types';

/**
 * plain 编辑内核（docs/17 §3，批 3）：裸 textarea 的生命周期泛化——自
 * MindNodeEditor 上收（创建/定位缩放/34ms 节流/flush/销毁/blur 落库）。
 * 键位先经 descriptor.onPlainKeyDown 裁决（mind 的 Tab 建子/Enter 提交/Cmd±），
 * 未消费的 Esc 由内核默认 discard 退出。与 pixi Text 逐像素对齐：
 * lineHeight 用像素值（IPlainEditorStyle.lineHeightPx——pixi Text 未设
 * lineHeight 时按 fontSize 度量，倍数行高会在编辑瞬间重影，docs/11 §8）。
 */

/** 输入即落库节流（docs/07 §7：34ms——与 html 内核同款，EditingService 单源） */
const PLAIN_WRITE_THROTTLE_MS = 34;

export class PlainTextKernel extends Disposable {
  private ta: HTMLTextAreaElement | null = null;
  private unbinds: Array<() => void> = [];
  private writeTimer = 0;
  private dirty = false;
  private session: IEditSessionDescriptor | null = null;

  constructor(
    private readonly viewport: IViewportService,
    /** 请求退出会话（blur / Esc——flush 与收尾顺序归 EditingService） */
    private readonly requestExit: (opts?: { discard?: boolean }) => void,
  ) {
    super();
  }

  get currentValue(): string {
    return this.ta?.value ?? '';
  }

  begin(descriptor: IEditSessionDescriptor): void {
    const style = descriptor.style as IPlainEditorStyle;
    // 同节点重入（IME：合成首键先进编辑、compositionstart 随后到达）：不重建
    // 编辑器——销毁重建会把正在合成的 IME 会话连根撕掉；只按需重设光标
    if (
      this.session &&
      this.ta &&
      this.session.widgetId === descriptor.widgetId &&
      this.session.nodeKey === descriptor.nodeKey
    ) {
      this.session = descriptor;
      this.applyCursor(descriptor.plainCursor);
      return;
    }
    this.destroyDom();
    this.session = descriptor;
    this.buildDom(style, descriptor.getContent());
    this.syncPos();
    this.applyCursor(descriptor.plainCursor);
  }

  /** 会话结束：非丢弃时以 textarea 现值为准落库（**无条件**——程序赋值不经
   *  input 事件也生效，判重在消费方 onCommit；原 MindNodeEditor 同语义） */
  end(discard: boolean): void {
    if (this.writeTimer) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = 0;
    }
    if (!discard && this.session && this.ta) {
      this.session.onCommit(this.ta.value);
    }
    this.destroyDom();
    this.session = null;
    this.dirty = false;
  }

  private buildDom(style: IPlainEditorStyle, content: string): void {
    const ta = document.createElement('textarea');
    ta.value = content;
    ta.spellcheck = false;
    const s = ta.style;
    s.position = 'fixed';
    s.zIndex = '5';
    s.boxSizing = 'border-box';
    s.border = 'none';
    s.outline = 'none';
    s.resize = 'none';
    s.fontFamily = 'sans-serif';
    s.fontWeight = style.fontWeight ?? '500';
    s.background = style.background;
    s.color = style.color;
    s.borderRadius = `${style.borderRadius ?? 0}px`;
    ta.addEventListener('pointerdown', (e) => e.stopPropagation()); // 事件不透画布
    const onKey = (e: KeyboardEvent): void => {
      if (this.session?.onPlainKeyDown?.(e)) return; // 控件语义键位（Tab/Enter/Cmd±）
      if (e.key === 'Escape') {
        e.preventDefault();
        this.requestExit({ discard: true });
      }
    };
    const onBlur = (): void => this.requestExit(); // 点外部/切窗落库退出
    const onInput = (): void => this.scheduleWrite();
    ta.addEventListener('keydown', onKey);
    ta.addEventListener('blur', onBlur);
    ta.addEventListener('input', onInput);
    const s1 = this.viewport.vpScale$.subscribe(() => this.syncPos());
    const s2 = this.viewport.vpBounds$.subscribe(() => this.syncPos());
    this.unbinds = [
      () => ta.removeEventListener('keydown', onKey),
      () => ta.removeEventListener('blur', onBlur),
      () => ta.removeEventListener('input', onInput),
      () => s1.unsubscribe(),
      () => s2.unsubscribe(),
    ];
    document.body.appendChild(ta);
    this.ta = ta;
  }

  /** 初始/重入光标语义（mind 三态：键入替换全量 / 合成全选 / 点进落尾） */
  private applyCursor(cursor: IEditSessionDescriptor['plainCursor']): void {
    const ta = this.ta;
    if (!ta) return;
    if (cursor && typeof cursor === 'object') {
      ta.value = cursor.replaceWith;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } else if (cursor === 'selectAll') {
      ta.focus();
      ta.select();
    } else {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  /** 视口跟随（pan/zoom 重定位 + 字号/内边距缩放）；commit 后由 EditingService
   *  再触发（文本变长节点尺寸变——树重排，编辑器要跟着走） */
  syncPos(): void {
    const ta = this.ta;
    const session = this.session;
    if (!ta || !session) return;
    const style = session.style as IPlainEditorStyle;
    const scale = this.viewport.vpScale$.value || 1;
    const rect = session.getRect();
    // fixed 定位挂在 body 上 → 用页面坐标（toScreen 是画布局部坐标，会整体
    // 上移顶栏高度）
    const screen = this.viewport.worldToClient({ x: rect.x, y: rect.y });
    const s = ta.style;
    s.left = `${screen.x}px`;
    s.top = `${screen.y}px`;
    s.width = `${rect.width * scale}px`;
    s.height = `${rect.height * scale}px`;
    s.fontSize = `${style.fontSize * scale}px`;
    // 行高对齐 PIXI 文本：PIXI 未设 lineHeight 时用 fontSize（CanvasTextMetrics），
    // 编辑器若用 1.3 倍会在编辑瞬间让文字整体下移、与画布文字重影
    s.lineHeight = `${style.lineHeightPx * scale}px`;
    s.padding = `${style.paddingY * scale}px ${style.paddingX * scale}px`;
    s.maxWidth = style.maxWidth !== undefined ? `${style.maxWidth * scale}px` : '';
  }

  private scheduleWrite(): void {
    this.dirty = true;
    if (this.writeTimer) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = 0;
      this.flushWrite();
    }, PLAIN_WRITE_THROTTLE_MS);
  }

  /** 输入即落库（节流 34ms）。落库后重新同步编辑器位置：文本变长会改变节点
   *  尺寸（树自动重排），编辑器要跟着走——getRect 可重复求值（docs/17 §2） */
  private flushWrite(): void {
    const session = this.session;
    if (!session || !this.dirty) return;
    session.onCommit(this.currentValue);
    this.dirty = false;
    this.syncPos();
  }

  private destroyDom(): void {
    for (const u of this.unbinds) u();
    this.unbinds = [];
    this.ta?.remove();
    this.ta = null;
  }

  override dispose(): void {
    if (this.writeTimer) window.clearTimeout(this.writeTimer);
    this.destroyDom();
    super.dispose();
  }
}
