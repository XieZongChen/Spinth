import { Subject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import type {
  IDataEngineService,
  IEditSessionDescriptor,
  IEditingService,
  IHistoryService,
  ISelectorService,
  IViewportService,
} from '../../types';
import { RichTextEditor, type IEditorAttachStyle } from './richTextEditor';
import { PlainTextKernel } from './plainTextKernel';
import { htmlToPlainText } from './plainText';

/**
 * 统一编辑会话服务（docs/17）：跨控件编辑互斥 + 会话生命周期/节流单源。
 *
 * 会话状态机：全局单活动会话（descriptor 声明几何/内容/样式/行为）；
 * begin 抢占旧会话时走完整退出序列，零残留。退出序列时序敏感（桩测试锁定）：
 * clearTimeout → flush（尾字）→ 空文本策略 → onExit 钩子 → 内核 detach。
 *
 * 双内核（docs/17 §3）：html = RichTextEditor/TipTap（TEXT/STICKY/LINE）；
 * plain = PlainTextKernel/textarea（mind 节点，批 3）——34ms 节流在各自内核
 * 内单源（html 走本类 timer，plain 走 kernel timer），退出统一经 exitActive。
 */

/** 编辑内容节流（docs/07 §7：34ms throttle——原三处消费方逐字重复，收单源） */
const COMMIT_THROTTLE_MS = 34;

export class EditingService extends Disposable implements IEditingService {
  /** 内核惰性创建（首会话按需）：不触碰另一内核的 DOM 前置——node/垫片
   *  环境的纯文本测试不加载 TipTap，单机纯画布文档零富文本初始化 */
  private richEditor: RichTextEditor | null = null;
  private plainKernel: PlainTextKernel | null = null;
  private session: IEditSessionDescriptor | null = null;
  private pendingUpdate: string | null = null;
  private throttleTimer = 0;
  readonly session$ = new Subject<void>();

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly selector: ISelectorService,
    private readonly history: IHistoryService,
  ) {
    super();
  }

  private ensureRichEditor(): RichTextEditor {
    if (!this.richEditor) {
      this.richEditor = new RichTextEditor(this.viewport, {
        onUpdate: (html) => {
          this.scheduleCommit(html);
          // 打字变宽不等节流——同步量框（LINE 喂镂空先例泛化；不实现者零开销）
          this.session?.onFrameChange?.(this.richEditor?.layoutSize ?? null);
        },
        onUndo: () => this.kernelUndo('undo'),
        onRedo: () => this.kernelUndo('redo'),
        // Esc / 点外 = 请求退出会话——flush 顺序归本服务，内核不再自持 editingId
        onExit: () => this.exitActive(),
      });
      this.addDisposable(this.richEditor);
    }
    return this.richEditor;
  }

  private ensurePlainKernel(): PlainTextKernel {
    if (!this.plainKernel) {
      this.plainKernel = new PlainTextKernel(this.viewport, (opts) => this.exitActive(opts));
      this.addDisposable(this.plainKernel);
    }
    return this.plainKernel;
  }

  get editingWidgetId(): string | null {
    return this.session?.widgetId ?? null;
  }

  get activeKernel() {
    return this.session?.kernel ?? null;
  }

  begin(descriptor: IEditSessionDescriptor): void {
    // 全局互斥：抢占前先干净退出旧会话——**同内核同目标除外**（IME 重入：
    // plain kernel 按 widgetId+nodeKey 短路不重建编辑器，保住合成会话）。
    // 同目标重入（样式跟随）先 flush：把编辑器现值落库——否则重放的
    // getContent 读到节流前的旧 model 值，未落库输入被回退（C3 实测揪出）
    const sameTarget =
      this.session !== null &&
      this.session.kernel === descriptor.kernel &&
      this.session.widgetId === descriptor.widgetId &&
      this.session.nodeKey === descriptor.nodeKey;
    if (this.session && !sameTarget) {
      this.exitActive();
    } else if (sameTarget) {
      this.flushCommit();
    }
    this.session = descriptor;
    descriptor.onEnter?.();
    if (descriptor.kernel === 'html') {
      const editor = this.ensureRichEditor();
      editor.attachAndRemember(
        descriptor.getRect(),
        descriptor.getContent(),
        'edit',
        descriptor.style as IEditorAttachStyle,
      );
      // attach 同步完成后 DOM 已布局——立即量框（LINE 空文字首帧即断线，不等节流）
      descriptor.onFrameChange?.(editor.layoutSize);
    } else {
      this.ensurePlainKernel().begin(descriptor);
    }
    this.session$.next();
  }

  exitActive(opts?: { discard?: boolean }): void {
    const s = this.session;
    if (!s) return;
    const discard = opts?.discard ?? false;
    if (this.throttleTimer) {
      window.clearTimeout(this.throttleTimer);
      this.throttleTimer = 0;
    }
    let isEmpty: boolean;
    if (s.kernel === 'html') {
      if (discard) {
        this.pendingUpdate = null; // 丢弃 pending（html 路径 Esc 当前都是 flush，契约仍须成立）
      } else {
        this.flushCommit();
      }
      // 空文本判定读编辑器现值（flush 刚落库，与 model.text 一致）
      isEmpty = !htmlToPlainText(this.richEditor!.getHTML()).trim();
      if (isEmpty && !discard && s.emptyTextPolicy === 'delete-widget') {
        this.engine.removeByIds([s.widgetId]);
        this.selector.setSelected([]);
      }
      this.richEditor!.detach();
    } else {
      isEmpty = !(this.plainKernel?.currentValue ?? '').trim();
      this.plainKernel!.end(discard);
    }
    this.session = null;
    s.onExit?.(isEmpty, { discarded: discard });
    // 不在此 stopCapturing（2026-10-17 审查 P0-3 子项，落地即撤）：SHAPE 撑高等
    // 编辑提交的锚定线重路由是**微任务相**写入（渲染后广播才 reattach），靠
    // captureTimeout 开窗并入同一撤销项——exit 时关窗会把它裂成第二个 undo
    // 项（autoHeight E2E 实锤：undo 一步高度不回）。「尾字与下一操作并项」的
    // 体验小账让位于 undo 裂项家族守卫（docs/05 §7 急切重路由同款不变量）
    this.session$.next();
  }

  private scheduleCommit(html: string): void {
    // 同值过滤：与**模型现状**同值的 update 不调度——进编辑的 TipTap focus/
    // 规范化会产生一次「空 update」，空 commit 的测高会把用户拖大的便签压回
    // 单行内容高（2026-10-16 用户实测揪出）。精确相等优先（marks 变化内容
    // 相同也须 commit）；空文档内容级特判（'' ≡ '<p></p>'）。基准必须是模型
    // 现值而非会话起点快照——keep 策略件「输入→全删→退出」时全删 update 与
    // 起点快照双空特判命中被滤，删除静默丢失、退出后内容复活（38 轮 🟠 实证）
    if (this.session && html === this.session.getContent()) return;
    if (
      this.session &&
      htmlToPlainText(html).trim() === '' &&
      htmlToPlainText(this.session.getContent()).trim() === ''
    ) {
      return;
    }
    this.pendingUpdate = html;
    if (this.throttleTimer) return;
    this.throttleTimer = window.setTimeout(() => {
      this.throttleTimer = 0;
      this.flushCommit();
    }, COMMIT_THROTTLE_MS);
  }

  /** 立即落库 pending 内容（退出会话前必须 flush，防丢尾字） */
  private flushCommit(): void {
    const html = this.pendingUpdate;
    this.pendingUpdate = null;
    if (html === null || !this.session) return;
    this.session.onCommit(html);
  }

  /** 编辑中撤销/重做（P0-3，2026-10-17 外部审查）：① 先 flush pending——
   *  34ms 节流窗里的尾字未落库，不 flush 会先回滚上一事务、timer 到点又把
   *  pending 写回，被撤销的内容「复活」；② 再 undo/redo；③ 重同步——DOM
   *  仍显示撤销前内容，下一次 onUpdate 会以 DOM 为准把 undo 冲掉，须把
   *  model 现值经 attachAndRemember 重灌（同 sameTarget 重入的 C3 路径）。
   *  plain 内核不经过这里：textarea 原生 undo 自洽（核实过不同款） */
  private kernelUndo(action: 'undo' | 'redo'): void {
    this.flushCommit();
    if (action === 'undo') this.history.undo();
    else this.history.redo();
    const s = this.session;
    if (s && this.richEditor) {
      this.richEditor.attachAndRemember(
        s.getRect(),
        s.getContent(),
        'edit',
        s.style as IEditorAttachStyle,
      );
      s.onFrameChange?.(this.richEditor.layoutSize);
    }
  }

  override dispose(): void {
    if (this.throttleTimer) window.clearTimeout(this.throttleTimer);
    // 兜底：编辑中 dispose 也走统一退出序列（flush 尾字——原实现只清 timer 丢 pending）
    this.exitActive();
    super.dispose();
  }
}
