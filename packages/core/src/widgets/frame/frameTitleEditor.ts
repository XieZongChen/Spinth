import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  IVmEngineService,
  IViewportService,
} from '../../types';
import type { FrameData } from '../../types';
import type { IRect } from '../../common/geometry';
import type { FrameVm } from './frameVm';
import { resolveFrameTitleColor } from './frameVm';
import {
  FRAME_TITLE_FONT,
  FRAME_TITLE_LINE_HEIGHT,
  frameTitleRect,
  frameTitleWidth,
} from './frameGeometry';

/**
 * 容器标题编辑协作者（specs/container-frame §4.10，treeNodeEditor 同款）：
 * plain 内核（textarea）生命周期在 PlainTextKernel，本类只声明容器标题的
 * 编辑事实——标题文字区几何（世界坐标实时求值，left 侧垂直居中）、单行键位
 * （Enter 恒提交，不做 Shift+Enter 换行）、空标题 keep（容器不随文字删除）。
 * 只读早退在入口（editable$）。
 */
export class FrameTitleEditor extends Disposable {
  /** 本协作者发起的会话（editingWidgetId 语义；begin 后赋值） */
  private myEditing: string | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly history: IHistoryService,
    private readonly editing: IEditingService | null,
  ) {
    super();
  }

  get isEditing(): boolean {
    return this.myEditing !== null;
  }

  get editingWidgetId(): string | null {
    return this.myEditing;
  }

  /** 进入标题编辑（单击已选中容器的激活通道入口）。返回 false = 未开会话
   *  （只读 / 非容器 / 服务未组装） */
  enterTitleEdit(id: string): boolean {
    if (!this.editing) return false;
    if (!this.viewport.editable$.value) return false; // 只读早退（§4.10）
    const data = this.frameData(id);
    const vm = this.vmEngine.getVmById(id) as FrameVm | undefined;
    if (!data || data.type !== 'FRAME' || !vm) return false;
    const side = data.headerSide ?? 'top';
    let committed = false;
    this.editing.begin({
      widgetId: id,
      kernel: 'plain',
      nodeKey: 'title',
      // 实时求值（数据驱动）：34ms 节流落库后 kernel 重取 getRect 跟随
      getRect: (): IRect => {
        const d = this.frameData(id);
        if (!d) return { x: 0, y: 0, width: 0, height: 0 };
        const tr = frameTitleRect(d.width, d.height, d.headerSide ?? 'top');
        return { x: d.x + tr.x, y: d.y + tr.y, width: tr.width, height: tr.height };
      },
      getContent: () => this.frameData(id)?.title ?? '',
      style: {
        fontSize: FRAME_TITLE_FONT,
        // 行高对齐 pixi 渲染（像素值 = 常量行高，倍数行高编辑瞬间重影）
        lineHeightPx: FRAME_TITLE_LINE_HEIGHT,
        color: resolveFrameTitleColor(data),
        background: data.fill === 'none' ? 'transparent' : data.color,
        fontWeight: '500',
        paddingX: 0, // 文字区从 PAD 起（getRect 已含），编辑器不再叠内边距
        paddingY: 0,
        maxWidth: frameTitleWidth(data.width, data.height, side),
      },
      plainCursor: 'end',
      onCommit: (text) => {
        // 重取（undo 删除后闭包 data 失效）；同值跳过
        const m = this.engine.getModelById(id);
        const cur = this.frameData(id)?.title ?? '';
        if (m && cur !== text) {
          m.update({ title: text } as never);
          committed = true;
        }
      },
      emptyTextPolicy: 'keep', // 空标题不删容器（§4.10）
      onEnter: () => {
        (this.vmEngine.getVmById(id) as FrameVm | undefined)?.setTitleEditing(true);
      },
      onExit: (_isEmpty, meta) => {
        this.myEditing = null;
        (this.vmEngine.getVmById(id) as FrameVm | undefined)?.setTitleEditing(false);
        if (!meta.discarded && committed) this.history.stopCapturing(); // 一次编辑一步 undo
      },
      onPlainKeyDown: (e) => {
        if (e.isComposing) return false; // 输入法合成中不抢键
        // 标题单行：Enter 恒提交退出（不做 Shift+Enter 换行，§4.10）
        if (e.key === 'Enter') {
          e.preventDefault();
          this.exitTitleEdit(true);
          return true;
        }
        // 编辑态 Cmd/Ctrl + ± = 缩放画布（treeNodeEditor 同款转发）
        const meta2 = e.metaKey || e.ctrlKey;
        if (meta2 && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          this.viewport.zoomIn();
          return true;
        }
        if (meta2 && (e.key === '-' || e.key === '_')) {
          e.preventDefault();
          this.viewport.zoomOut();
          return true;
        }
        return false;
      },
    });
    this.myEditing = id;
    return true;
  }

  /** 退出标题编辑；commit=true 落库；false = Esc 丢弃（pending 不落库） */
  exitTitleEdit(commit: boolean): void {
    this.editing?.exitActive(commit ? undefined : { discard: true });
  }

  private frameData(id: string): (FrameData & IRect) | undefined {
    return this.engine.getModelById(id)?.toJSON() as (FrameData & IRect) | undefined;
  }
}
