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
import { resizeRotatedRect, type HandleDir } from './resizeMath';
import { inverseRotatePoint, pointerAngle, snapAngle } from './rotateMath';
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
  /** 手势指针（审查 P2）：window 级 move/up/cancel 只认它；undefined = 桩
   *  环境直调 down 无 id，不过滤（viewportPointerInput 同款约定） */
  pointerId: number | undefined;
}

interface RotateState {
  vmId: string;
  /** 手势起点的宿主角度 + 起点指针角（θ = θ0 + Δ指针角，绕视觉中心） */
  startTheta: number;
  startPointerAngle: number;
  /** 旋转中心（世界坐标，视觉/预览感知——取自 getHostGeom） */
  center: { x: number; y: number };
  /** 最近一帧角度：松手落库用它 */
  lastTheta: number;
  /** 手势指针（同 ResizeState.pointerId） */
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
  private rotate: RotateState | null = null;

  /** 缩放手势逐帧通知（视觉预览已就位后发射）：连接点等覆盖层跟随用，
   *  与 selector.dragMove$ 同模式——缩放期 onStateChanged$ 不发射 */
  readonly resizeMove$ = new Subject<void>();

  /** 缩放松手落库后、stopCapturing 前的钩子（组合根接锚定线急切重路由——并入
   *  同一撤销项，docs/05 §4.4；next = commitResize 落库的目标矩形，正是微任务相
   *  reattach 将算出的 bounds——同源无换算）。与 selector.onDragCommitted 同模式 */
  onResizeCommitted: ((vmId: string, next: IRect) => void) | null = null;

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
  }

  initialize(): void {
    this.vm = new RectEditorVm(this.viewport.optionLayer);
    this.vm.onHandleDown = (dir, wx, wy, pointerId) => this.startResize(dir, wx, wy, pointerId);
    this.vm.onRotateDown = (wx, wy, pointerId) => this.startRotate(wx, wy, pointerId);

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
    this.resize = {
      vmId: this.targetId,
      dir,
      start: startBounds,
      lastNext: startBounds,
      startRotation: vm.getRotation(),
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
    const st = this.resize ?? this.rotate;
    if (!st || !this.isGesturePointer(e, st, false)) return;
    this.cancelGesture();
  };

  /** 捕获异常丢失（元素移除/浏览器收回）：手势已无法收到 up，按取消收口；
   *  正常 up 后的 lostpointercapture 到达时状态已清、监听已摘，天然 no-op */
  private onLostPointerCapture = (e: PointerEvent): void => {
    const st = this.resize ?? this.rotate;
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
    // （视觉状态每帧被本函数改写，作为基准会产生复合漂移）
    // 1.6：旋转态走对侧锚定版（θ=0 内部退化为 resizeRect 等价输出）
    let next = resizeRotatedRect(this.resize.start, this.resize.dir, world, th);
    if (th === 0) {
      // 参考线吸附：只有被拖动的边参与（docs/06 §3）；旋转态跳过
      const snapped = this.refLine.snapForResize(next, this.resize.dir);
      next = snapped.rect;
    }
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
      this.onResizeCommitted?.(vmId, lastNext);
    }
    this.resize = null;
    this.history.stopCapturing();
    this.reposition();
  };

  // ---------- 旋转手势（docs/05 §8）：preview 直写 root.rotation（零落库），
  // 锚定线经 onRotatePreview 实时跟随；松手 commitRotate 单事务 = 一步 undo ----------

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
    if (this.rotate) {
      this.endWindowListeners(this.onRotateMove, this.onRotateUp);
      const { vmId, startTheta } = this.rotate;
      const vm = this.vmEngine.getVmById(vmId);
      if (vm) vm.applyRotatePreview(startTheta);
      this.rotate = null;
      // 锚定线重路由（与 onRotateMove 同款通知）：不上报则线停在预览角度
      this.onRotatePreview?.();
      this.reposition();
      cancelled = true;
    }
    // 预览复位是视觉变更：方法自带闭环，复用方不必靠别的状态变更兜底标脏
    // （只读降级路径正好有清选区触发重绘，但 Esc 之类复用路径不一定有）
    if (cancelled) markRender();
  }

  private startRotate(worldX: number, worldY: number, pointerId?: number): void {
    if (!this.targetId) return;
    const vm = this.vmEngine.getVmById(this.targetId);
    if (!vm) return;
    const g = vm.getHostGeom(); // 视觉中心（拖拽/预览感知）
    const center = { x: g.rect.x + g.rect.width / 2, y: g.rect.y + g.rect.height / 2 };
    this.rotate = {
      vmId: this.targetId,
      startTheta: vm.getRotation(),
      startPointerAngle: pointerAngle(center, { x: worldX, y: worldY }),
      center,
      lastTheta: vm.getRotation(),
      pointerId,
    };
    this.selector.suppressClickActivation = true; // 同 startResize：抑制随手势生命周期
    this.armWindowListeners(this.onRotateMove, this.onRotateUp);
  }

  private onRotateMove = (e: PointerEvent): void => {
    if (!this.rotate || !this.isGesturePointer(e, this.rotate, false)) return;
    if ((e.buttons & 1) === 0) return;
    const vm = this.vmEngine.getVmById(this.rotate.vmId);
    if (!vm) return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    let theta =
      this.rotate.startTheta +
      (pointerAngle(this.rotate.center, world) - this.rotate.startPointerAngle);
    if (e.shiftKey) theta = snapAngle(theta); // Shift 15° 步进（docs/05 §8）
    this.rotate.lastTheta = theta;
    vm.applyRotatePreview(theta);
    // 编辑框/选区框跟随（旋转框）
    const g = vm.getHostGeom();
    this.vm.show(g.rect, this.viewport.vpScale$.value, g.rotation);
    this.selector.updateSelectionFrame(g.rect);
    // 锚定线实时跟随（用户拍板 2026-10-15）
    this.onRotatePreview?.();
    markRender();
  };

  private onRotateUp = (e: PointerEvent): void => {
    // 异指针/副键 up 不终止（同 onWindowUp）
    if (!this.rotate || !this.isGesturePointer(e, this.rotate, true)) return;
    this.selector.suppressClickActivation = false; // 手势终止：抑制单源清除（同 onWindowUp）
    this.endWindowListeners(this.onRotateMove, this.onRotateUp);
    const { vmId, lastTheta } = this.rotate;
    const vm = this.vmEngine.getVmById(vmId);
    if (vm) {
      // rotation 落库 + 锚定线急切重路由**同事务**（= 一步 undo）——比
      // 「两事务靠 captureTimeout 窗口合并」结构性更强：实测窗口合并在
      // 页面环境对紧邻两事务不稳定（E2E 实锤裂项），显式 transact 免疫
      this.engine.transact(() => {
        vm.commitRotate(lastTheta);
        this.onRotateCommitted?.(vmId, lastTheta);
      });
    }
    this.rotate = null;
    this.history.stopCapturing();
    this.reposition();
  };
}
