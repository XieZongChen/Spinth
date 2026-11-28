import { Disposable } from '../../base/disposable';
import { Subject } from 'rxjs';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import { RectEditorVm } from './rectEditorVm';
import { createResizeSnaps, planResize, resizeSnapsOnAxis, type HandleDir } from './resizeMath';
import { inverseRotatePoint } from './rotateMath';
import { RectEditorRotate, type IRectEditorRotateHost } from './rectEditorRotate';
import type { RefLineService } from '../refLine/refLineService';

interface ResizeState {
  vmId: string;
  dir: HandleDir;
  start: IRect;
  /** 最近一帧的目标矩形（缩放数学的输出）：松手落库用它，禁止从视觉反推 */
  lastNext: IRect;
  /** 手势起点的宿主旋转（docs/05 §8）：≠0 时指针逆旋转进局部做缩放数学、
   *  吸附禁用（边开口轴对齐语义失真） */
  startRotation: number;
  /** 比例锁的起点宽高比（能力位 keepRatio 的控件才有，按住 Shift 时生效，
   *  docs/05 §4.4）——按当前比例锁，不纠正已拉歪的图 */
  ratio?: number;
  /** 手势指针（审查 P2）：window 级 move/up/cancel 只认它；undefined = 桩
   *  环境直调 down 无 id，不过滤（viewportPointerInput 同款约定） */
  pointerId: number | undefined;
}

/**
 * 单选缩放编辑（docs/05 §2/§4）：拖手柄视觉缩放（root.scale），
 * 松手 updateRect 落库。window 级监听保证拖出画布仍跟随。
 */
export class RectEditorService extends Disposable {
  private vm!: RectEditorVm;
  private targetId: string | null = null;
  private resize: ResizeState | null = null;
  /** 旋转手势状态机（docs/05 §8；rectEditorRotate）——服务只留入口转发与取消收口 */
  private readonly rotate: RectEditorRotate;

  /** 缩放手势逐帧通知（视觉预览已就位后发射）：连接点等覆盖层跟随用，
   *  与 selector.dragMove$ 同模式——缩放期 onStateChanged$ 不发射 */
  readonly resizeMove$ = new Subject<void>();
  /** 网格吸附开关探针（specs/flowchart-closeout §9.2；组合根注入。缺省关） */
  gridSnapOn: () => boolean = () => false;

  /** θ=0 缩放的吸附/量化（数学层经它回调；组装在 resizeMath，依赖延迟取） */
  private readonly snaps = createResizeSnaps(
    () => this.refLine,
    () => this.gridSnapOn(),
  );

  /** 缩放松手落库后、stopCapturing 前的钩子（组合根接锚定线急刻重路由——并入
   *  同一撤销项，docs/05 §4.4；next = commitResize 落库的目标矩形，正是微任务相
   *  reattach 将算出的 bounds——同源无换算；start = commitResize 收到的起点矩形，
   *  specs/sequence-diagram §4.7 加长保高度按前后几何重算端口）。与
   *  selector.onDragCommitted 同模式 */
  onResizeCommitted: ((vmId: string, next: IRect, start: IRect) => void) | null = null;

  /** 旋转预览逐帧钩子（组合根接 lineService.previewFollow——锚定线实时跟随，
   *  用户拍板 2026-10-15；与 resizeMove$ 同模式） */
  onRotatePreview: (() => void) | null = null;

  /** 旋转松手落库后、stopCapturing 前的钩子（组合根接锚定线急切重路由——
   *  并入同一撤销项，onResizeCommitted 同模式；docs/05 §8 第四条通道） */
  onRotateCommitted: ((vmId: string, theta: number) => void) | null = null;

  constructor(
    private viewport: IViewportService,
    private vmEngine: IVmEngineService,
    private selector: ISelectorService,
    private engine: IDataEngineService,
    private history: IHistoryService,
    private refLine: RefLineService,
  ) {
    super();
    this.rotate = new RectEditorRotate(this.rotateHost(), viewport, vmEngine, history);
  }

  /** 旋转手势的宿主适配：指针判定 / window 监听与缩放手势同一套；钩子经闭包
   *  读字段——组合根在构造之后才赋值，必须读到调用时的最新值 */
  private rotateHost(): IRectEditorRotateHost {
    return {
      isGesturePointer: (e, st, up) => this.isGesturePointer(e, st, up),
      armWindowListeners: (move, up) => this.armWindowListeners(move, up),
      endWindowListeners: (move, up) => this.endWindowListeners(move, up),
      setClickSuppression: (on) => {
        this.selector.suppressClickActivation = on;
      },
      followRotatePreview: (vm) => {
        const g = vm.getHostGeom();
        this.vm.show(g.rect, this.viewport.vpScale$.value, g.rotation);
        this.selector.updateSelectionFrame(g.rect);
      },
      commitRotate: (vmId, vm, theta) => {
        this.engine.transact(() => {
          vm.commitRotate(theta);
          this.onRotateCommitted?.(vmId, theta);
        });
      },
      reposition: () => this.reposition(),
      emitRotatePreview: () => this.onRotatePreview?.(),
    };
  }

  initialize(): void {
    this.vm = new RectEditorVm(this.viewport.optionLayer);
    this.vm.onHandleDown = (dir, wx, wy, pointerId) => this.startResize(dir, wx, wy, pointerId);
    this.vm.onRotateDown = (wx, wy, pointerId) =>
      this.rotate.begin(this.targetId, wx, wy, pointerId);

    this.addDisposable(
      this.selector.selected$.subscribe((ids) => this.onSelectionChanged(ids)),
      this.viewport.vpScale$.subscribe(() => this.reposition()),
      this.viewport.vpBounds$.subscribe(() => this.reposition()),
      // 拖拽移动中实时跟随（否则边框冻结在原地，形状移走后看似“另一个方块”）
      this.selector.dragMove$.subscribe(() => {
        if (!this.resize) this.reposition();
      }),
    );
  }

  /** dev 调试：编辑器框当前矩形 */
  get __editorFrame(): IRect | null {
    return this.vm.debugRect;
  }

  /** dev 调试：旋转柄世界坐标 + 可见性（E2E 定位与入口隐藏锁用，docs/05 §8） */
  get __rotateHandle(): { x: number; y: number; visible: boolean } | null {
    return this.vm.debugRotateHandle;
  }

  /** 缩放手势进行中（悬停指示器抑制用——docs/08 §10 批次 2） */
  get isResizing(): boolean {
    return this.resize !== null;
  }

  private onSelectionChanged(ids: string[]): void {
    this.targetSub?.unsubscribe();
    this.targetSub = null;
    if (ids.length === 1) {
      // 能力位闸门（docs/02 §5）：不可缩放的类型不出手柄。LINE/PEN 的交互几何
      // 方法是空操作（docs/08 §3）、MIND_MAP 的 w/h 是布局派生占位——出了手柄
      // 就是「看得到、拖不动」的假手柄（既有设计对线/脑图同样隐藏选框）
      if (this.engine.getModelById(ids[0]!)?.capabilities.resizable === false) {
        this.targetId = null;
        this.vm.hide();
        return;
      }
      this.targetId = ids[0]!;
      this.reposition();
      // 目标数据变化（拖动/远端）→ 跟随
      const vm = this.vmEngine.getVmById(this.targetId);
      if (vm) {
        const sub = vm.onStateChanged$.subscribe(() => {
          if (!this.resize) this.reposition();
        });
        this.targetSub = sub;
      }
    } else {
      this.targetId = null;
      this.vm.hide();
    }
  }

  private targetSub: { unsubscribe(): void } | null = null;

  private reposition(): void {
    if (!this.targetId) return;
    const vm = this.vmEngine.getVmById(this.targetId);
    if (!vm) {
      this.vm.hide();
      return;
    }
    // 旋转框（docs/05 §8）：视觉局部矩形 + θ——getHostGeom 预览感知（拖拽中跟随）；
    // 旋转柄走能力位闸门
    const g = vm.getHostGeom();
    const canRotate = this.engine.getModelById(this.targetId)?.capabilities.rotatable !== false;
    this.vm.show(g.rect, this.viewport.vpScale$.value, g.rotation, canRotate);
  }

  private startResize(dir: HandleDir, worldX: number, worldY: number, pointerId?: number): void {
    if (!this.targetId) return;
    const vm = this.vmEngine.getVmById(this.targetId);
    if (!vm) return;
    void worldX;
    void worldY;
    const startBounds = vm.getLocalRect();
    // 比例锁走能力位（与 resizable/rotatable 同款读法，无类型分支）；退化矩形不算
    const keepRatio = this.engine.getModelById(this.targetId)?.capabilities.keepRatio === true;
    this.resize = {
      vmId: this.targetId,
      dir,
      start: startBounds,
      lastNext: startBounds,
      startRotation: vm.getRotation(),
      ratio:
        keepRatio && startBounds.height > 0 ? startBounds.width / startBounds.height : undefined,
      pointerId,
    };
    // 手柄 down 被 RectEditorVm stopPropagation；up 仍冒泡到 stage，不得当 click
    // 激活编辑。抑制随手势生命周期（匹配指针的 window up / pointercancel /
    // cancelGesture 单源清除）——「一次性消费」会在 blur/多指等中途事件泄掉，
    // 复窗松手仍误进编辑。up 不用 once：异指针的 up 不得偷走监听
    this.selector.suppressClickActivation = true;
    this.armWindowListeners(this.onWindowMove, this.onWindowUp);
  }

  /** 手势期 window 监听四件套（move/up/pointercancel/lostpointercapture）——
   *  终止事件匹配手势指针时由处理器自行摘除（见 endWindowListeners） */
  private armWindowListeners(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): void {
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('lostpointercapture', this.onLostPointerCapture);
  }

  private endWindowListeners(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): void {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('lostpointercapture', this.onLostPointerCapture);
  }

  /** 手势指针判定：down 未携带 id（单测直调）不过滤；up 须主键——副键 up 与
   *  手势同 pointerId（主键拖拽中按放副键），不得终止手势 */
  private isGesturePointer(e: PointerEvent, st: { pointerId: number | undefined }, up: boolean) {
    if (st.pointerId !== undefined && e.pointerId !== st.pointerId) return false;
    return !up || e.button == null || e.button === 0;
  }

  /** 原生 pointercancel（触摸被系统接管/OS 抢指针）：仅手势指针匹配时取消——
   *  终止不落库（cancelGesture 回滚预览），抑制随之清除，手势不悬挂 */
  private onPointerCancel = (e: PointerEvent): void => {
    const st = this.resize ?? this.rotate.gesturePointer;
    if (!st || !this.isGesturePointer(e, st, false)) return;
    this.cancelGesture();
  };

  /** 捕获异常丢失（元素移除/浏览器收回）：手势已无法收到 up，按取消收口；
   *  正常 up 后的 lostpointercapture 到达时状态已清、监听已摘，天然 no-op */
  private onLostPointerCapture = (e: PointerEvent): void => {
    const st = this.resize ?? this.rotate.gesturePointer;
    if (!st || !this.isGesturePointer(e, st, false)) return;
    this.cancelGesture();
  };

  private onWindowMove = (e: PointerEvent): void => {
    // 主键已松的 move（up 丢失/副键抬起后）不得继续驱动预览
    if (!this.resize || !this.isGesturePointer(e, this.resize, false)) return;
    if ((e.buttons & 1) === 0) return;
    const vm = this.vmEngine.getVmById(this.resize.vmId);
    if (!vm) return;
    const worldRaw = this.viewport.clientToWorld(e.clientX, e.clientY);
    // 旋转态（docs/05 §8）：指针逆旋转到控件局部系再做缩放数学——输出局部
    // rect，渲染自动呈现「沿控件自身轴缩放」；吸附禁用（边开口语义失真）
    const th = this.resize.startRotation;
    const center = {
      x: this.resize.start.x + this.resize.start.width / 2,
      y: this.resize.start.y + this.resize.start.height / 2,
    };
    const world = th === 0 ? worldRaw : inverseRotatePoint(worldRaw, center, th);
    // 无状态计算：一切以「拖拽起点矩形 + 当前光标」推导，禁止读取实时视觉状态
    // （视觉状态每帧被本函数改写，作为基准会产生复合漂移）。数学在 resizeMath
    // （旋转态对侧锚定 / 吸附 / 比例锁 / 控件自述的整形），这里只接线；lastNext 即
    // 落库值（预览与落库同源）
    // 比例锁每帧只看当前 Shift（docs/05 §4.4）：手势中途按下 / 松开即时切换。
    // 只沿纵轴缩放的件（resizeAxis 探针）吸附只取手柄方向的纵向分量
    const axis = vm.resizeAxis?.();
    const next = planResize(
      this.resize.start,
      this.resize.dir,
      world,
      th,
      e.shiftKey ? this.resize.ratio : undefined,
      axis ? resizeSnapsOnAxis(this.snaps, axis) : this.snaps,
      vm.constrainResize?.bind(vm),
    );
    this.resize.lastNext = next;
    // 视觉反馈：per-type 预览（rect 型 position+scale；points 世界坐标型
    // 端点/采样点重映射重绘，避免拉伸线宽/箭头）
    vm.applyResizePreview(this.resize.start, next);
    this.vm.show(next, this.viewport.vpScale$.value, th);
    // 选区框实时跟随被缩放的形状（否则框冻结在旧尺寸）
    this.selector.updateSelectionFrame(next);
    this.resizeMove$.next();
    markRender();
  };

  private onWindowUp = (e: PointerEvent): void => {
    // 异指针/副键 up 不终止手势、不摘监听（once 版会被第二指针 up 偷走）
    if (!this.resize || !this.isGesturePointer(e, this.resize, true)) return;
    // up 即手势终止：单击激活抑制在此单源清除（stage 相位的 selector up 已
    // 早于本 window 相位读过它——顺序天然正确）
    this.selector.suppressClickActivation = false;
    this.endWindowListeners(this.onWindowMove, this.onWindowUp);
    this.refLine.hideMatches();
    const { vmId, start, lastNext } = this.resize;
    const vm = this.vmEngine.getVmById(vmId);
    if (vm) {
      // 直接落库「最近一帧的目标矩形」对应的真实数据——它是缩放数学的唯一输出，
      // 禁止从视觉（root/localBounds/scale）反推（getLocalBounds 在缩放中语义不可靠）
      vm.commitResize(start, lastNext);
      // 锚定线急切重路由（docs/05 §4.4）：必须夹在 commitResize（事务已闭、
      // 观察者相 state 已刷新）与 stopCapturing（并入同一撤销项）之间——留给
      // onStateChanged$ 微任务相会裂成第二个 undo 项（拖拽同款，2026-10-10）
      this.onResizeCommitted?.(vmId, lastNext, start);
    }
    this.resize = null;
    this.history.stopCapturing();
    this.reposition();
  };

  /** 只读降级手势收口（docs/21 §4）：缩放/旋转是 window 级监听（拖出画布仍
   *  跟随），不经 viewport 路由——editable 闸门与 dispatchGestureCancel 都打不
   *  到这里，降级时必须显式取消：撤监听、视觉预览按手势起点回落（预览通道
   *  零落库），不 commit、不 stopCapturing（取消路径无落库，无历史项可结）。
   *  复位同时通知跟随层（resizeMove$ / onRotatePreview）并 markRender——
   *  方法自带闭环，不依赖调用方后续恰好有别的重绘 */
  cancelGesture(): void {
    // 手势取消即终止：单击激活抑制单源清除（无手势时幂等）
    this.selector.suppressClickActivation = false;
    let cancelled = false;
    if (this.resize) {
      this.endWindowListeners(this.onWindowMove, this.onWindowUp);
      const { vmId, start } = this.resize;
      const vm = this.vmEngine.getVmById(vmId);
      if (vm) vm.applyResizePreview(start, start); // scale 归 1 = 回到起点视觉
      this.refLine.hideMatches();
      this.resize = null;
      // 跟随层复位（与 onWindowMove 同款通知）：快捷连接点按模型几何重排；
      // 不通知则叠层停在预览位置，直到下一次几何变化
      this.resizeMove$.next();
      this.reposition();
      cancelled = true;
    }
    // 旋转手势：撤监听 + 预览回落 + 锚定线重路由都在手势机内（不上报则线停在
    // 预览角度）；标脏由这里统一做
    cancelled = this.rotate.cancel() || cancelled;
    // 预览复位是视觉变更：方法自带闭环，复用方不必靠别的状态变更兜底标脏
    // （只读降级路径正好有清选区触发重绘，但 Esc 之类复用路径不一定有）
    if (cancelled) markRender();
  }
}
