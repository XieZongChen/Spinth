import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IDataEngineService, IEditingService, IVmEngineService } from '../../types';
import { htmlToPlainText } from '../../platform/textEngine/plainText';
import { pointAtRatio, ratioAtPoint } from './lineMath';
import { LINE_TEXT_FONT_SIZE, LINE_TEXT_LINE_HEIGHT, type LineVm } from './lineVm';
import { defaultLineTextColor } from '../../platform/textEngine/theme';

/**
 * 线上文字编辑协作者（自 lineService 拆出，2026-10-05 A1 整理批刀 1——照
 * MindNodeEditor 先例；2026-10-06 编辑会话批 2 收编统一 EditingService）：
 * 本类退化为 descriptor 工厂——TipTap 生命周期/34ms 节流/flush 已上收，
 * 只声明 LINE 的编辑事实：ratio 锚定（pendingRatio 与首帧内容合并落库成单
 * 撤销单元）、编辑态镂空喂框（onFrameChange）、收/复手柄（host 回调）。
 * 手柄/浮层的显隐经 host 回调交还宿主（编辑器不持有浮层引用）。
 */

/** 编辑态选框描边色（spinth 功能蓝——与端点手柄/选中框同语言） */
const LINE_EDIT_BORDER = '#2878ff';

/** 宿主回调：浮层与选中态语义操作（MindNodeEditor 模式的窄回调面） */
export interface ILineEditorHost {
  /** 进入编辑时收掉已显示的端点圆/段条（编辑期手柄全收，refreshHandles 有
   *  editingId 守卫不再 show——2026-10-02 实测编辑框内压着胶囊手柄） */
  hideEditOverlays(): void;
  /** 退出编辑后仍单选该线 → 恢复选中态手柄 */
  refreshHandles(ids: string[]): void;
}

export class LineTextEditor extends Disposable {
  /** 本协作者发起的会话 id（编辑守卫语义 = LINE 在编辑；begin 后赋值——
   *  抢占旧会话的 onExit 不误清新值） */
  private myEditingId: string | null = null;

  constructor(
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly editing: IEditingService,
    private readonly host: ILineEditorHost,
  ) {
    super();
  }

  get editingWidgetId(): string | null {
    return this.myEditingId;
  }

  /** 双击已选中的线 → 在点击位置 ratio 处进入文字编辑（onLineDblClick 入口） */
  enterTextEdit(id: string, world?: { x: number; y: number }): void {
    const vm = this.vmEngine.getVmById(id);
    const model = this.engine.getModelById(id);
    if (!vm || !model || vm.type !== 'LINE') return;
    vm.flushUpdate(); // 与 textService.enterEdit 同因：同步读几何前先应用合批
    const data = model.toJSON() as unknown as {
      points: Array<[number, number]>;
      text: string;
      textRatio: number;
      fontSize?: number;
      textColor?: string;
    };
    const pts = data.points.map((p) => ({ x: p[0], y: p[1] }));
    const plain = htmlToPlainText(data.text || '');
    // 会话局部状态（闭包隔离：begin 抢占旧会话的 onExit 不波及本次）
    let ratio = data.textRatio;
    let pendingRatio: number | null = null;
    if (!plain.trim() && world) {
      // 新文字：锚定到点击位置（延迟与首次内容写入合并落库）
      ratio = ratioAtPoint(pts, world);
      pendingRatio = ratio;
    }
    this.editing.begin({
      widgetId: id,
      kernel: 'html',
      // 编辑态选框（参考复刻，2026-10 用户拍板透明底）：透明底 + 功能蓝描边
      // 圆角框，中心对准文字锚点（与 pixi Text anchor 0.5 同心，垂直零偏差），
      // 宽度随内容自适应；pixi 侧文字隐藏（镂空断线保持）——文字只留 DOM 一份
      getRect: () => {
        const { point } = pointAtRatio(pts, ratio);
        return { x: point.x, y: point.y, width: 0, height: 0 };
      },
      getContent: () => (plain.trim() ? data.text : '<p></p>'),
      style: {
        // per-实例排版 override（docs/17 §4 打磨批 A）：model 字段 → 常量默认
        fontSize: data.fontSize ?? LINE_TEXT_FONT_SIZE,
        color: data.textColor ?? defaultLineTextColor(),
        lineHeight: LINE_TEXT_LINE_HEIGHT,
        anchor: 'center',
        widthMode: 'content',
        textAlign: 'center',
        cursor: 'end', // 二次进入光标落内容末尾（防 TipTap 单例旧选区残留）
        frame: { borderColor: LINE_EDIT_BORDER, radius: 6, padding: '6px 10px' },
      },
      onCommit: (html) => {
        const m = this.engine.getModelById(id);
        if (!m) return;
        // 空文本归一为空串（线保留，不删线——与 TEXT 空删除语义不同）
        const p = htmlToPlainText(html);
        const payload: Record<string, unknown> = { text: p.trim() ? html : '' };
        if (pendingRatio !== null) {
          payload.textRatio = pendingRatio;
          pendingRatio = null;
        }
        m.update(payload as never);
      },
      emptyTextPolicy: 'keep',
      onEnter: () => {
        (vm as LineVm).setTextEditing(true);
        this.host.hideEditOverlays();
      },
      onExit: () => {
        this.myEditingId = null;
        pendingRatio = null;
        const v = this.vmEngine.getVmById(id);
        if (v && v.type === 'LINE') {
          (v as LineVm).setEditorFrame(null);
          (v as LineVm).setTextEditing(false);
          // vm 侧两次状态切换只改场景图——退出瞬间（未选中/无手柄动作带 tick）
          // 画面会停在编辑态残像，显式补 tick
          markRender();
        }
        // 仍单选该线 → 恢复选中态手柄（编辑期被 refreshHandles 守卫压住）——
        // 选中态由宿主 selector 持有，经 host 回调交还
        this.host.refreshHandles([id]);
      },
      /** 打字变宽不等 34ms 节流落库——同步量框即时跟随镂空（diff 守卫零冗余重绘）；
       *  begin 的 attach 后也即触发一次（空文字首帧即断线） */
      onFrameChange: (frame) => {
        const v = this.vmEngine.getVmById(id);
        if (v && v.type === 'LINE') {
          (v as LineVm).setEditorFrame(frame);
          // setEditorFrame 的 drawLine 只改场景图——无渲染 tick 画面会停在旧
          // 状态（双击后首键前线穿框/双显的窗口期，2026-10-02 实测揪出）
          markRender();
        }
      },
    });
    this.myEditingId = id;
  }

  exitEdit(): void {
    this.editing.exitActive();
  }
}
