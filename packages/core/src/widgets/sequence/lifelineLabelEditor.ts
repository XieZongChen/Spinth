import { Disposable } from '../../base/disposable';
import { rectContainsPoint, type IPoint, type IRect } from '../../common/geometry';
import { clampSingleLineLabel } from '../../platform/textEngine/labelText';
import type {
  IDataEngineService,
  IEditingService,
  IHistoryService,
  IVmEngineService,
  IViewportService,
  LifelineData,
} from '../../types';
import type { LifelineVm } from './lifelineVm';
import {
  LIFELINE_HEAD_BORDER,
  LIFELINE_HEAD_COLOR,
  LIFELINE_LABEL_FONT_SIZE,
  LIFELINE_LABEL_LINE_HEIGHT,
  LIFELINE_LABEL_MAX_CHARS,
  lifelineHeadRect,
  lifelineLabelRect,
} from './lifelineGeometry';

const ZERO_RECT: IRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * 生命线标签编辑协作者（specs/sequence-diagram §3.7，FRAME 标题编辑器同款）：
 * plain 内核（textarea）生命周期在 PlainTextKernel，本类只声明标签的编辑事实——
 * 标签文字区几何（世界坐标实时求值）、居中单行、Enter 恒提交、空标签 keep
 * （头框不随文字删除）、落库清洗（连续空白折一 + trim + 截 64 字素，SYMBOL 口径）。
 * 只读早退在入口（editable$）。
 */
export class LifelineLabelEditor extends Disposable {
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

  /** 进入标签编辑（单击已选中生命线的激活通道入口，§7.2）。world 给出时按下点
   *  必须落在头框内——点轴不算。返回 false = 未开会话（只读 / 非生命线 / 点在
   *  头框外 / 服务未组装） */
  enterLabelEdit(id: string, world?: IPoint): boolean {
    if (!this.editing) return false;
    if (!this.viewport.editable$.value) return false; // 只读早退（§3.7）
    const data = this.lifelineData(id);
    const vm = this.vmEngine.getVmById(id) as LifelineVm | undefined;
    if (!data || data.type !== 'LIFELINE' || !vm) return false;
    if (world && !rectContainsPoint(lifelineHeadRect(data, data.head), world)) return false;
    const area = lifelineLabelRect(data.width, data.head);
    let committed = false;
    this.editing.begin({
      widgetId: id,
      kernel: 'plain',
      nodeKey: 'label',
      // 实时求值（数据驱动）：34ms 节流落库后 kernel 重取 getRect 跟随；actor 头
      // 的标签带可能伸出被压扁的 bbox，高度钳到 bbox 内
      getRect: (): IRect => {
        const d = this.lifelineData(id);
        if (!d) return ZERO_RECT;
        const a = lifelineLabelRect(d.width, d.head);
        return {
          x: d.x + a.x,
          y: d.y + a.y,
          width: a.width,
          height: Math.min(a.height, Math.max(d.height - a.y, 0)),
        };
      },
      getContent: () => this.lifelineData(id)?.label ?? '',
      style: {
        fontSize: LIFELINE_LABEL_FONT_SIZE,
        // 行高对齐 pixi 渲染（像素值 = 常量行高，倍数行高编辑瞬间重影）
        lineHeightPx: LIFELINE_LABEL_LINE_HEIGHT,
        color: LIFELINE_HEAD_BORDER,
        // 矩形头：编辑器 = 头框白底；actor 头：画布上的标签没有底，编辑器透明
        // （暗色主题下白底块会突兀地压在小人下方）
        background: data.head === 'actor' ? 'transparent' : LIFELINE_HEAD_COLOR,
        // 画布标签居中：编辑器同向，提交不跳位
        textAlign: 'center',
        paddingX: 0, // 文字区已含内边距（getRect 从 PAD 起），编辑器不再叠
        paddingY: 0,
        maxWidth: area.width,
      },
      plainCursor: 'end',
      onCommit: (text) => {
        // 重取（undo 删除后闭包 data 失效）；落库清洗；同值跳过
        const clean = clampSingleLineLabel(text, LIFELINE_LABEL_MAX_CHARS);
        const m = this.engine.getModelById(id);
        const cur = this.lifelineData(id)?.label ?? '';
        if (m && cur !== clean) {
          m.update({ label: clean } as never);
          committed = true;
        }
      },
      emptyTextPolicy: 'keep', // 空标签不删生命线（§3.7）
      onEnter: () => {
        (this.vmEngine.getVmById(id) as LifelineVm | undefined)?.setLabelEditing(true);
      },
      onExit: (_isEmpty, meta) => {
        this.myEditing = null;
        (this.vmEngine.getVmById(id) as LifelineVm | undefined)?.setLabelEditing(false);
        if (!meta.discarded && committed) this.history.stopCapturing(); // 一次编辑一步 undo
      },
      onPlainKeyDown: (e) => {
        if (e.isComposing) return false; // 输入法合成中不抢键
        // 标签单行：Enter 恒提交退出（不做 Shift+Enter 换行）
        if (e.key === 'Enter') {
          e.preventDefault();
          this.exitLabelEdit(true);
          return true;
        }
        // 编辑态 Cmd/Ctrl + ± = 缩放画布（FRAME 标题同款转发）
        const meta = e.metaKey || e.ctrlKey;
        if (meta && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          this.viewport.zoomIn();
          return true;
        }
        if (meta && (e.key === '-' || e.key === '_')) {
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

  /** 退出标签编辑；commit=true 落库；false = Esc 丢弃（pending 不落库） */
  exitLabelEdit(commit: boolean): void {
    this.editing?.exitActive(commit ? undefined : { discard: true });
  }

  private lifelineData(id: string): (LifelineData & IRect) | undefined {
    return this.engine.getModelById(id)?.toJSON() as (LifelineData & IRect) | undefined;
  }
}
