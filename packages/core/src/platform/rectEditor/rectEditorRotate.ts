import type {
  IBaseWidgetVm,
  IHistoryService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import { markRender } from '../../common/render';
import { pointerAngle, snapAngle } from './rotateMath';

export interface RotateState {
  vmId: string;
  /** 手势起点的宿主角度 + 起点指针角（θ = θ0 + Δ指针角，绕视觉中心） */
  startTheta: number;
  startPointerAngle: number;
  /** 旋转中心（世界坐标，视觉/预览感知——取自 getHostGeom） */
  center: { x: number; y: number };
  /** 最近一帧角度：松手落库用它 */
  lastTheta: number;
  /** 手势指针（同缩放手势）：window 级 move/up/cancel 只认它；undefined = 桩
   *  环境直调 down 无 id，不过滤 */
  pointerId: number | undefined;
}

/** 旋转手势的宿主回调（RectEditorService 实现）：手势机不持有编辑框 / 选区 / 引擎，
 *  副作用全部经此回流——指针判定与 window 监听沿用缩放手势那套，两个手势的
 *  终止语义保持同源 */
export interface IRectEditorRotateHost {
  /** 手势指针判定：down 未携带 id 不过滤；up 须主键——副键 up 与手势同
   *  pointerId（主键拖拽中按放副键），不得终止手势 */
  isGesturePointer(e: PointerEvent, st: { pointerId: number | undefined }, up: boolean): boolean;
  /** 手势期 window 监听四件套（move/up/pointercancel/lostpointercapture）的挂载 / 摘除 */
  armWindowListeners(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): void;
  endWindowListeners(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): void;
  /** 单击激活抑制：手柄 down 被 RectEditorVm stopPropagation、up 仍冒泡到 stage，
   *  不得当 click 激活编辑——抑制随手势生命周期（开始置位、终止 / 取消清除） */
  setClickSuppression(on: boolean): void;
  /** 旋转框跟随（编辑框 + 选区框）：预览直写后调用 */
  followRotatePreview(vm: IBaseWidgetVm): void;
  /** θ 落库 + 锚定线急切重路由**同事务**（= 一步 undo）——比「两事务靠
   *  captureTimeout 窗口合并」结构性更强：实测窗口合并在页面环境对紧邻两事务
   *  不稳定（E2E 实锤裂项），显式 transact 免疫 */
  commitRotate(vmId: string, vm: IBaseWidgetVm, theta: number): void;
  /** 手势终止 / 取消后的编辑框复位 */
  reposition(): void;
  /** 旋转预览逐帧钩子发射（组合根接 lineService.previewFollow——锚定线实时
   *  跟随）；落库钩子夹在 commitRotate 的事务内，由宿主自己发 */
  emitRotatePreview(): void;
}

/**
 * 旋转手势（docs/05 §8）：preview 直写 root.rotation（零落库），锚定线经
 * onRotatePreview 实时跟随；松手 commitRotate 单事务 = 一步 undo。
 * 从 RectEditorService 拆出：手势状态机自成一体，服务只剩入口转发与取消收口。
 */
export class RectEditorRotate {
  private state: RotateState | null = null;

  constructor(
    private host: IRectEditorRotateHost,
    private viewport: IViewportService,
    private vmEngine: IVmEngineService,
    private history: IHistoryService,
  ) {}

  /** 进行中的手势指针（宿主 pointercancel / lostpointercapture 判定用）；无手势 = null */
  get gesturePointer(): { pointerId: number | undefined } | null {
    return this.state;
  }

  begin(targetId: string | null, worldX: number, worldY: number, pointerId?: number): void {
    if (!targetId) return;
    const vm = this.vmEngine.getVmById(targetId);
    if (!vm) return;
    const g = vm.getHostGeom(); // 视觉中心（拖拽/预览感知）
    const center = { x: g.rect.x + g.rect.width / 2, y: g.rect.y + g.rect.height / 2 };
    const startTheta = vm.getRotation();
    this.state = {
      vmId: targetId,
      startTheta,
      startPointerAngle: pointerAngle(center, { x: worldX, y: worldY }),
      center,
      lastTheta: startTheta,
      pointerId,
    };
    this.host.setClickSuppression(true);
    this.host.armWindowListeners(this.onMove, this.onUp);
  }

  onMove = (e: PointerEvent): void => {
    const st = this.state;
    if (!st || !this.host.isGesturePointer(e, st, false)) return;
    // 主键已松的 move（up 丢失/副键抬起后）不得继续驱动预览
    if ((e.buttons & 1) === 0) return;
    const vm = this.vmEngine.getVmById(st.vmId);
    if (!vm) return;
    const world = this.viewport.clientToWorld(e.clientX, e.clientY);
    let theta = st.startTheta + (pointerAngle(st.center, world) - st.startPointerAngle);
    if (e.shiftKey) theta = snapAngle(theta); // Shift 15° 步进（docs/05 §8）
    st.lastTheta = theta;
    vm.applyRotatePreview(theta);
    // 编辑框/选区框跟随（旋转框）+ 锚定线实时跟随
    this.host.followRotatePreview(vm);
    this.host.emitRotatePreview();
    markRender();
  };

  onUp = (e: PointerEvent): void => {
    const st = this.state;
    // 异指针/副键 up 不终止手势、不摘监听
    if (!st || !this.host.isGesturePointer(e, st, true)) return;
    // up 即手势终止：单击激活抑制在此清除（stage 相位的 selector up 已早于
    // 本 window 相位读过它——顺序天然正确）
    this.host.setClickSuppression(false);
    this.host.endWindowListeners(this.onMove, this.onUp);
    const vm = this.vmEngine.getVmById(st.vmId);
    if (vm) this.host.commitRotate(st.vmId, vm, st.lastTheta);
    this.state = null;
    this.history.stopCapturing();
    this.host.reposition();
  };

  /** 取消（只读降级等）：撤监听、视觉预览按手势起点回落（预览通道零落库），
   *  不 commit、不 stopCapturing（取消路径无落库，无历史项可结）；复位同时通知
   *  跟随层。返回是否有手势被取消——标脏留给调用方（宿主把缩放 / 旋转两支
   *  合并成一次 markRender） */
  cancel(): boolean {
    const st = this.state;
    if (!st) return false;
    this.host.setClickSuppression(false);
    this.host.endWindowListeners(this.onMove, this.onUp);
    const vm = this.vmEngine.getVmById(st.vmId);
    if (vm) vm.applyRotatePreview(st.startTheta);
    this.state = null;
    // 锚定线重路由（与 onMove 同款通知）：不上报则线停在预览角度
    this.host.emitRotatePreview();
    this.host.reposition();
    return true;
  }
}
