import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Disposable } from '../../base/disposable';
import type { IViewportService } from '../../types';
import { defaultTextColor } from './theme';

/**
 * 三态文本编辑器（docs/07 §2/§3）：preview / select / edit。
 *
 * preview：销毁 DOM，纯 PIXI（DocDisplay）渲染——本类不参与，由 TextVm 编排。
 * select/edit：全局唯一 DOM 容器承载 TipTap，CSS transform 复刻视口矩阵与
 * 控件位置对齐（docs/07 §3 坐标同步公式）；select 态 DOM 透明只承接键盘。
 *
 * 撤销统一走 Yjs：编辑器内 Cmd+Z 交由外部 history（onKeyDown 转发）。
 */

const CONTAINER_ID = 'spinth-text-layer';

export type TextEditMode = 'select' | 'edit';

/** 编辑器可视框（透明底 + 描边圆角——LINE 文字编辑态，参考同款选框语言） */
export interface IEditorFrameStyle {
  borderColor: string;
  borderWidth?: number;
  radius: number;
  padding: string;
}

/** attach 样式：前三项为必填基线，其余可选——不传 = TEXT/STICKY 现状（裸透明无框） */
export interface IEditorAttachStyle {
  fontSize: number;
  color: string;
  lineHeight: number;
  /** 定位锚点：topleft（默认）= worldRect 左上；center = 元素中心对准 worldRect.x/y（LINE 文字） */
  anchor?: 'topleft' | 'center';
  /** 宽度：fixed（默认）= worldRect.width×scale；content = max-content 随内容长宽（min 60/max 240 钳定） */
  widthMode?: 'fixed' | 'content';
  /** 段落对齐（跟随渲染的 per-实例 align；'right' 随 SHAPE 接入补齐——
   *  TypoFields/ALIGN_OPTIONS 本就有三态，类型此前窄了） */
  textAlign?: 'left' | 'center' | 'right';
  /** edit 态 focus 落点：keep（默认）= 恢复上一会话的选区；end = 内容末尾。
   *  TipTap 单例跨会话不清 selection——二次进入同内容时 setContent 被守卫
   *  跳过、focus() 会恢复旧选区（LINE 二次编辑「蓝色选区块残留」根因） */
  cursor?: 'keep' | 'end';
  frame?: IEditorFrameStyle;
  /** 控件旋转角（弧度，docs/05 §8）：编辑框随旋转——定位点转世界、transform
   *  加 rotate；缺省 0（未旋转零变化） */
  rotation?: number;
  /** 高度：content（默认）= 内容撑起；fixed = worldRect.height×scale 显式
   *  定高（STICKY 编辑框盖满整张便签，2026-10-16 用户实测揪出只盖一行） */
  heightMode?: 'fixed' | 'content';
  /** 独立内边距（无 frame 时生效——STICKY 全盖框的文字内缩） */
  padding?: string;
}

export interface IRichTextEditorCallbacks {
  /** 内容变更（throttle 由上层负责） */
  onUpdate(html: string): void;
  /** Cmd/Ctrl+Z / Shift+Cmd+Z（转发给 Yjs UndoManager，不走 TipTap history） */
  onUndo(): void;
  onRedo(): void;
  /** Esc / 点击外部退出编辑 */
  onExit(): void;
}

export class RichTextEditor extends Disposable {
  readonly editor: Editor;
  private dom: HTMLDivElement;

  constructor(
    private viewport: IViewportService,
    private callbacks: IRichTextEditorCallbacks,
  ) {
    super();
    // 全局唯一容器（docs/07 §3）
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.style.cssText =
        'position:fixed;left:0;top:0;z-index:1;pointer-events:none;transform-origin:0 0;';
      document.body.appendChild(container);
    }
    this.dom = document.createElement('div');
    // position:absolute + transform-origin:0 0：left/top 与 scale 定位生效的前提——
    // 静态定位下 left/top 被忽略，编辑器恒在屏幕左上角（2026-09 像素对齐实测揪出）
    this.dom.style.cssText =
      'position:absolute;transform-origin:0 0;outline:none;white-space:pre-wrap;word-break:break-word;min-width:1px;min-height:1em;cursor:text;';
    this.dom.addEventListener('keydown', (e) => this.onKeyDown(e));
    container.appendChild(this.dom);

    this.editor = new Editor({
      element: this.dom,
      // TipTap v3：history 独立为 @tiptap/extension-history；此处不装 =
      // 撤销走外部 Yjs UndoManager（docs/07 §3 契约）
      extensions: [StarterKit.configure({ undoRedo: false }), TextStyle, Color],
      content: '',
      editable: false,
      editorProps: {
        attributes: { style: 'outline:none;' },
      },
      onUpdate: ({ editor: ed }) => this.callbacks.onUpdate(ed.getHTML()),
    });

    this.addDisposable(
      this.viewport.vpScale$.subscribe(() => this.syncTransform()),
      this.viewport.vpBounds$.subscribe(() => this.syncTransform()),
    );

    // 点击编辑器外部 = 退出编辑（docs/07 §2 三态契约；捕获阶段先于画布交互）
    const onDocPointerDown = (e: PointerEvent): void => {
      if (this.lastMode !== 'edit') return;
      if (e.target instanceof Node && this.dom.contains(e.target)) return;
      this.callbacks.onExit();
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    this.addDisposable(() => document.removeEventListener('pointerdown', onDocPointerDown, true));
  }

  private onKeyDown(e: KeyboardEvent): void {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.callbacks.onRedo();
      } else {
        this.callbacks.onUndo();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      this.callbacks.onExit();
    }
  }

  /** 进入 select/edit 态：定位到控件世界矩形（CSS transform 复刻视口矩阵）。
   *  opts.contentReplay=false：只重放几何/样式、不回灌内容（syncTransform 用） */
  attach(
    worldRect: { x: number; y: number; width: number; height: number },
    html: string,
    mode: TextEditMode,
    style: IEditorAttachStyle,
    opts?: { contentReplay?: boolean },
  ): void {
    const scale = this.viewport.vpScale$.value;
    // fixed 容器挂在 body 上 → 必须换算到页面坐标（toScreen 是画布局部坐标）。
    // 旋转件（docs/05 §8）：topleft 定位点 = 局部左上绕中心旋转 θ 的世界位
    // （transform origin 0 0，元素绕该点随转）；center 锚定中心即旋转中心不动
    const theta = style.rotation ?? 0;
    let anchorWorld = { x: worldRect.x, y: worldRect.y };
    if (theta !== 0 && style.anchor !== 'center') {
      const center = {
        x: worldRect.x + worldRect.width / 2,
        y: worldRect.y + worldRect.height / 2,
      };
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const dx = worldRect.x - center.x;
      const dy = worldRect.y - center.y;
      anchorWorld = { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
    }
    const screen = this.viewport.worldToClient(anchorWorld);
    this.dom.style.left = `${screen.x}px`;
    this.dom.style.top = `${screen.y}px`;
    // center 锚定：translate 在 scale 内层（先平移自身半宽再缩放）——中心恒停
    // 在 left/top 上，与内容宽高无关；topleft 维持原矩阵；rotate 追加在
    // scale 之后（先转再缩放——origin 0 0 即定位点）
    const rotateCss = theta !== 0 ? ` rotate(${theta}rad)` : '';
    this.dom.style.transform =
      style.anchor === 'center'
        ? `scale(${scale})${rotateCss} translate(-50%, -50%) translateZ(0)`
        : `scale(${scale})${rotateCss} translateZ(0)`;
    if (style.widthMode === 'content') {
      this.dom.style.width = 'max-content';
      this.dom.style.minWidth = '60px';
      this.dom.style.maxWidth = '240px';
    } else {
      this.dom.style.width = `${worldRect.width * scale}px`;
      this.dom.style.minWidth = '1px';
      this.dom.style.maxWidth = 'none';
    }
    // 高度双向重置（宽度同款纪律）：fixed 显式定高（STICKY 全盖），缺省内容撑
    if (style.heightMode === 'fixed') {
      this.dom.style.height = `${worldRect.height * scale}px`;
    } else {
      this.dom.style.height = '';
    }
    this.dom.style.fontSize = `${style.fontSize}px`;
    this.dom.style.lineHeight = String(style.lineHeight);
    this.dom.style.color = style.color;
    this.dom.style.textAlign = style.textAlign ?? 'left';
    // 可视框显式双向重置：LINE 编辑框不留残到 TEXT/STICKY，反之亦然
    if (style.frame) {
      this.dom.style.border = `${style.frame.borderWidth ?? 1.5}px solid ${style.frame.borderColor}`;
      this.dom.style.borderRadius = `${style.frame.radius}px`;
      this.dom.style.padding = style.frame.padding;
    } else {
      this.dom.style.border = '';
      this.dom.style.borderRadius = '';
      this.dom.style.padding = '';
    }
    // STICKY 全盖编辑框（2026-10-16）：无 frame 时 padding 仍可独立生效
    // （文字内缩移交编辑器 CSS，getRect 不再内缩）；双向重置
    if (!style.frame && style.padding !== undefined) {
      this.dom.style.padding = style.padding;
    }
    this.dom.style.pointerEvents = mode === 'edit' ? 'auto' : 'none';
    this.dom.style.opacity = mode === 'edit' ? '1' : '0'; // select 态只承接键盘
    const current = this.editor.getHTML();
    if (opts?.contentReplay !== false && current !== html) {
      this.editor.commands.setContent(html, { emitUpdate: false });
    }
    this.editor.setEditable(mode === 'edit');
    if (mode === 'edit') {
      this.editor.commands.focus(style.cursor === 'end' ? 'end' : undefined);
    }
  }

  /** 视口变化 → 重新对齐（attach 的数据缓存后重放） */
  private lastRect: { x: number; y: number; width: number; height: number } | null = null;
  private lastHtml = '';
  private lastMode: TextEditMode | null = null;
  private lastStyle: IEditorAttachStyle = {
    fontSize: 14,
    color: defaultTextColor(),
    lineHeight: 1.5,
  };

  attachAndRemember(
    worldRect: { x: number; y: number; width: number; height: number },
    html: string,
    mode: TextEditMode,
    style: IEditorAttachStyle,
  ): void {
    this.lastRect = worldRect;
    this.lastHtml = html;
    this.lastMode = mode;
    this.lastStyle = style;
    this.attach(worldRect, html, mode, style);
  }

  private syncTransform(): void {
    if (this.lastRect && this.lastMode) {
      // P0-2（2026-10-17 外部审查）：视口变化只重放几何/样式——**不回灌内容**。
      // lastHtml 是进编辑时的快照（attachAndRemember 唯一赋值点），编辑中
      // 滚轮缩放/平移会走到这里，用它 setContent 会把已输入文字回退到快照
      // （emitUpdate:false 使回退静默、模型与 DOM 分叉，退出落库即丢字）
      this.attach(this.lastRect, this.lastHtml, this.lastMode, this.lastStyle, {
        contentReplay: false,
      });
    }
  }

  /** 回到 preview：DOM 隐藏并失焦 */
  detach(): void {
    this.lastRect = null;
    this.lastMode = null;
    this.dom.style.opacity = '0';
    this.dom.style.pointerEvents = 'none';
    this.editor.setEditable(false);
    (this.dom.parentElement ?? document.body).blur?.();
    if (
      document.activeElement instanceof HTMLElement &&
      this.dom.contains(document.activeElement)
    ) {
      document.activeElement.blur();
    }
  }

  getHTML(): string {
    return this.editor.getHTML();
  }

  /**
   * 编辑态编辑框的 CSS 布局尺寸（含 border/padding）。世界宽高与 offsetWidth/
   * Height 数值直等：布局宽 W_css 经 scale(s) 放大成视觉宽 W_css×s，而视觉宽
   * = 世界宽×同一个 s——CENTER 锚定下框的世界矩形恒定，zoom 不漂移。
   * 非编辑态返回 null。
   */
  get layoutSize(): { width: number; height: number } | null {
    if (this.lastMode !== 'edit') return null;
    return { width: this.dom.offsetWidth, height: this.dom.offsetHeight };
  }

  override dispose(): void {
    this.editor.destroy();
    this.dom.remove();
    super.dispose();
  }
}
