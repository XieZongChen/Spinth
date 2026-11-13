import { BehaviorSubject } from 'rxjs';
import { TYPES_WHERE } from '../../types';
import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  IPointerEventInfo,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import {
  TEXT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_DEFAULT_WIDTH,
  TEXT_PADDING,
  TEXT_FONT_SIZE_STEPS,
} from './textVm';
import { insetRectOf } from '../shape/shapeVm';
import type { ShapeType } from '../../types';
import { createCanvasMeasurer, measureDoc } from '../../platform/textEngine/measure';
import { htmlToDoc } from '../../platform/textEngine/htmlDoc';
import { editStyleOf } from './textEditStyle';
import { commitTextEdit } from './textCommit';

/**
 * 文本控件交互层（docs/07 §2 + docs/17）：text 工具落点创建 + 编辑会话 descriptor
 * 工厂——三类可编辑控件（TEXT/STICKY/SHAPE，EDITABLE_TYPES）：三态编排/34ms 节流/
 * flush/空文本策略已上收 EditingService（批 1），本服务只声明各类型的编辑事实
 * （几何/内容/样式/落库尾巴）；SHAPE 的差异见 docs/17 §6（keep 空文本/内接矩形/
 * 不 autoHeight）。
 */
export class TextService extends Disposable {
  /** 工具默认字号（会话级，docs/04 §2——创建时显式落 fontSize（TypoFields per-实例
   *  字段现成），编辑会话 editStyleOf 读 data.fontSize ?? 常量默认自动跟随） */
  private defaultFontSize = TEXT_FONT_SIZE;
  readonly defaultFontSize$ = new BehaviorSubject<number>(TEXT_FONT_SIZE);

  get defaultTextFontSize(): number {
    return this.defaultFontSize;
  }

  /** 工具坞二级菜单写通道（档位表内取值；非手势无编辑冲突面） */
  setDefaultFontSize(n: number): void {
    if (!TEXT_FONT_SIZE_STEPS.includes(n as (typeof TEXT_FONT_SIZE_STEPS)[number])) return;
    if (n === this.defaultFontSize) return;
    this.defaultFontSize = n;
    this.defaultFontSize$.next(n);
  }
  /** 本服务发起的会话 id（begin 后赋值——抢占旧会话的 onExit 不误清新值；
   *  语义 = 本服务管理的三类可编辑控件在编辑，与全局会话 id 区分） */
  private myEditingId: string | null = null;
  /** 会话期排版订阅退订器（编辑中远端/程序化改排版 → 编辑器实时跟随，docs/17 C3） */
  private styleWatch: (() => void) | null = null;
  /** 当前会话已生效的排版（防回环：onCommit 的 model.update 也触发 observeDeep） */
  private lastSessionStyle: { fontSize: number; lineHeight: number; color: string } | null = null;

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private history: IHistoryService,
    private readonly editing: IEditingService,
  ) {
    super();
  }

  initialize(): void {
    this.viewport.registerGlobalEventListener('text', {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerUp: (e) => this.onPointerUp(e),
      onPointerUpOutside: (e) => this.onPointerUp(e),
    });
  }

  /** down 空占位：TEXT 是点击语义（无拖拽画框），up 才创建 */
  private onPointerDown(e: IPointerEventInfo): void {
    void e;
  }

  /** text 工具：点击落点创建并直接进入编辑 */
  private onPointerUp(e: IPointerEventInfo): void {
    const id = genId();
    // 创建几何随会话字号（y 偏移与 height 初值同公式——漏改则首行基线错位）；
    // fontSize 仅在非默认档时显式落库——保持「默认档无字段、回落常量」的
    // 数据语义（undo 回 undefined 的既有断言/老文档语义不变）
    const fs = this.defaultFontSize;
    this.engine.add({
      id,
      type: 'TEXT',
      zOrder: this.engine.genInitialOrder(),
      text: '<p></p>',
      ...(fs !== TEXT_FONT_SIZE ? { fontSize: fs } : {}),
      x: e.world.x - TEXT_PADDING,
      y: e.world.y - (fs * TEXT_LINE_HEIGHT) / 2,
      width: TEXT_DEFAULT_WIDTH,
      height: fs * TEXT_LINE_HEIGHT + TEXT_PADDING * 2,
    } as never);
    this.history.stopCapturing();
    this.selector.setSelected([id]);
    this.enterEdit(id);
    this.viewport.setCursorMode('cursor');
  }

  /** 外部触发进入编辑（双击/单击已选中，由 selector 或 UI 调用；
   *  STICKY/SHAPE 共用本编辑会话——组合根 onActivate 漏接 STICKY 分支曾致
   *  便签双击无反应，2026-09-20 补；SHAPE 接入 2026-10-07 docs/17 §6） */
  enterEdit(id: string): void {
    const vm = this.vmEngine.getVmById(id);
    const model = this.engine.getModelById(id);
    if (!vm || !model || !TextService.EDITABLE_TYPES.has(vm.type)) return;
    this.beginSession(id);
  }

  /** 编辑三类从注册表派生（第五刀：能力位 editable 单源） */
  private static readonly EDITABLE_TYPES = new Set(TYPES_WHERE('editable'));

  /** 会话启动/样式跟随重入（同 target 的 begin 走 EditingService 的
   *  sameTarget 短路——不重建编辑器，attach 以新 style 重放，docs/17 C3） */
  private beginSession(id: string): void {
    const vm = this.vmEngine.getVmById(id);
    const model = this.engine.getModelById(id);
    if (!vm || !model || !TextService.EDITABLE_TYPES.has(vm.type)) return;
    const data = model.toJSON() as {
      fontSize?: number;
      textColor?: string;
      lineHeight?: number;
      align?: 'left' | 'center' | 'right';
      shapeType?: ShapeType;
      fill?: 'solid' | 'none';
      color?: string;
    };
    const st = editStyleOf(vm.type, data);
    const shapeType = data.shapeType ?? 'rect';
    const isShape = vm.type === 'SHAPE';
    this.lastSessionStyle = { fontSize: st.fontSize, lineHeight: st.lineHeight, color: st.color };
    this.editing.begin({
      widgetId: id,
      kernel: 'html',
      getRect: () => {
        vm.flushUpdate(); // 同步读几何前先应用合批（创建后立即进入编辑的场景）
        // 局部矩形（docs/05 §8：getBounds 已改世界 AABB——编辑框/inset 是
        // 局部系语义；旋转经 style.rotation 由编辑器 transform 承载）
        const b = vm.getHostGeom().rect;
        const theta = vm.getRotation();
        // SHAPE 编辑框 anchor center：x/y = 图形中心（richTextEditor
        // translate(-50%,-50%) 中心恒钉，内容上下对称生长 = 打字中途也实时
        // 垂直居中，与渲染的居中语义一致）；宽 = insetRectOf 内接宽（与画布
        // 换行 maxWidth 同源）。TEXT/STICKY = bounds 内缩 padding（topleft）
        if (isShape) {
          const inset = insetRectOf(shapeType, b.width, b.height);
          return {
            x: b.x + b.width / 2,
            y: b.y + b.height / 2,
            width: Math.max(inset.width, st.minWidth),
            height: 0,
          };
        }
        // STICKY：编辑框盖满整张便签（2026-10-16 用户实测揪出「只盖一角」——
        // 高度此前由内容撑、空便签 ≈ 一行高）；文字内缩 14px 移交编辑器 padding
        if (vm.type === 'STICKY') {
          return { x: b.x, y: b.y, width: b.width, height: b.height, rotation: theta };
        }
        return {
          x: b.x + st.padding,
          y: b.y + st.padding,
          width: Math.max(b.width - st.padding * 2, st.minWidth),
          height: b.height,
          rotation: theta,
        };
      },
      getContent: () => String((model.toJSON() as unknown as { text: string }).text ?? '<p></p>'),
      style: {
        fontSize: st.fontSize,
        color: st.color,
        lineHeight: st.lineHeight,
        textAlign: st.align,
        // SHAPE 编辑框中心锚定（LINE 同款 anchor 选项）
        anchor: isShape ? 'center' : undefined,
        // 旋转跟随（docs/05 §8）：编辑框随控件 θ（SHAPE center 锚定下中心即
        // 旋转中心，rotate 由 transform 承载）
        rotation: vm.getRotation() || undefined,
        // STICKY 全盖编辑框：定高 + 蓝描边（选中语言同源）+ 独立 padding（文字
        // 内缩 14 与画布渲染同位；getRect 已不内缩）
        ...(vm.type === 'STICKY'
          ? {
              heightMode: 'fixed' as const,
              frame: { borderColor: '#2878ff', radius: 6, padding: `${st.padding}px` },
            }
          : {}),
      },
      onCommit: (html) =>
        commitTextEdit({ engine: this.engine, vmEngine: this.vmEngine }, id, html, st),
      // 空文本策略分流：TEXT 删除控件（docs/07 §7 空删语义）；SHAPE/STICKY
      // keep——形状与便签是色块图形类不随文字删除（STICKY 2026-10-16 用户
      // 拍板改 keep——「进编辑不输入退出即蒸发」违背便签直觉；LINE 同语义）
      emptyTextPolicy: isShape || vm.type === 'STICKY' ? 'keep' : 'delete-widget',
      // 编辑期画布文字节能隐藏（消双显 + 跳过重建，LINE 模式——descriptor 闭包
      // 直改 vm；三类全接：SHAPE→STICKY→TEXT（本笔收官，编辑体系统一））
      onEnter: () => (vm as unknown as { setTextEditing(b: boolean): void }).setTextEditing(true),
      onExit: () => {
        (vm as unknown as { setTextEditing(b: boolean): void }).setTextEditing(false);
        this.myEditingId = null;
        this.stopStyleWatch();
        this.lastSessionStyle = null;
      },
    });
    this.myEditingId = id;
    this.startStyleWatch(id, model);
  }

  /**
   * 编辑会话期的排版跟随（docs/17 C3）：真实场景是协同远端/程序化改排版
   * （ActionBar 点击本身会触发编辑器「点外退出」——不适用本路径）。排版字段
   * 变化 → 重算 style → 同 target 重 begin（编辑器不重建、新 style 重放）。
   * 防回环：onCommit 落库的 text 变更也触发 observeDeep——排版未变零操作。
   */
  private startStyleWatch(
    id: string,
    model: { yData: { observeDeep(h: () => void): void; unobserveDeep(h: () => void): void } },
  ): void {
    this.stopStyleWatch();
    const handler = (): void => {
      if (this.myEditingId !== id) return;
      const vm = this.vmEngine.getVmById(id);
      const m = this.engine.getModelById(id);
      if (!vm || !m) return;
      const st = editStyleOf(
        vm.type,
        m.toJSON() as {
          fontSize?: number;
          textColor?: string;
          lineHeight?: number;
          align?: 'left' | 'center' | 'right';
          shapeType?: ShapeType;
          fill?: 'solid' | 'none';
          color?: string;
        },
      );
      if (
        this.lastSessionStyle &&
        this.lastSessionStyle.fontSize === st.fontSize &&
        this.lastSessionStyle.lineHeight === st.lineHeight &&
        this.lastSessionStyle.color === st.color
      ) {
        return;
      }
      this.beginSession(id);
    };
    model.yData.observeDeep(handler);
    this.styleWatch = () => model.yData.unobserveDeep(handler);
  }

  private stopStyleWatch(): void {
    this.styleWatch?.();
    this.styleWatch = null;
  }

  /** 外部改排版后的高度重排（docs/17 §4 打磨批 B：ActionBar 改字号/切图形类型时
   *  调用——autoHeight 只在编辑提交路径触发，外部改排版需显式重测。SHAPE 闸门
   *  读模型事实：autoHeight 开（默认）才重排，关着的形状高度恒用户控制） */
  reflowHeight(id: string): void {
    const vm = this.vmEngine.getVmById(id);
    const model = this.engine.getModelById(id);
    if (!vm || !model) return;
    if (vm.type !== 'TEXT' && vm.type !== 'STICKY') {
      if (vm.type !== 'SHAPE') return;
      const d = model.toJSON() as unknown as { autoHeight?: boolean };
      if (!(d.autoHeight ?? true)) return;
    }
    const data = model.toJSON() as unknown as {
      text: string;
      fontSize?: number;
      textColor?: string;
      lineHeight?: number;
    };
    commitTextEdit(
      { engine: this.engine, vmEngine: this.vmEngine },
      id,
      data.text,
      editStyleOf(vm.type, data),
    );
  }

  /** 纯文本粘贴建 TEXT（clipboardService.onPastePlainText 回调，docs/09 留白
   *  销账）：转义 + \n→<br> 包 <p>（htmlToDoc 解析链现成）；落点视口中心；
   *  高度 measureDoc 实测（行数估高漏折行——首行超宽折两行时溢出选中框，
   *  十九轮图形化实机发现 P3，2026-10-09 修） */
  pasteText(plain: string): void {
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = plain.replace(/\r\n?/g, '\n').split('\n');
    const html = `<p>${lines.map(esc).join('<br>')}</p>`;
    const st = editStyleOf('TEXT', {});
    const m = measureDoc(
      { paragraphs: htmlToDoc(html), maxWidth: TEXT_DEFAULT_WIDTH - TEXT_PADDING * 2, style: st },
      { measurer: createCanvasMeasurer() },
    );
    const height = m.height + TEXT_PADDING * 2;
    const b = this.viewport.vpBounds$.value;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const id = genId();
    this.engine.add({
      id,
      type: 'TEXT',
      zOrder: this.engine.genInitialOrder(),
      text: html,
      x: cx - TEXT_DEFAULT_WIDTH / 2,
      y: cy - height / 2,
      width: TEXT_DEFAULT_WIDTH,
      height,
    } as never);
    this.history.stopCapturing();
    this.selector.setSelected([id]);
  }

  exitEdit(): void {
    this.editing.exitActive();
  }

  get editingWidgetId(): string | null {
    return this.myEditingId;
  }
}
