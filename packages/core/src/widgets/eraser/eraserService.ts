import { BehaviorSubject } from 'rxjs';
import { Disposable } from '../../base/disposable';
import { genId } from '../../utils/id';
import { eraseStrokeAgainstSweep, type IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  IHistoryService,
  IPointerEventInfo,
  IViewportService,
  IVmEngineService,
} from '../../types';
import { EraserCursor } from './eraserCursor';

/** 橡皮半径（屏幕像素，÷ vpScale 换算世界坐标——缩放下手感一致，通用口径）；
 *  方括号 [ ] 步进调整（参考同款，步进 4 见 keyboardService 分发处），
 *  MIN/MAX 钳制 */
export const ERASER_RADIUS_DEFAULT_PX = 10;
export const ERASER_RADIUS_MIN_PX = 4;
export const ERASER_RADIUS_MAX_PX = 40;
/** 大小五档（docs/04 §2 工具默认参数节）：工具坞二级菜单（圆点梯度图标，图标名
 *  eraser-size-<px>——Icon.tsx 同步注册）；id = 像素数字串（探针/命令通道同口径） */
export const ERASER_SIZE_STEPS = [4, 8, 16, 24, 40] as const;
export const ERASER_SIZE_OPTIONS = ERASER_SIZE_STEPS.map((px) => ({
  id: String(px),
  label: `${px}px`,
  icon: `eraser-size-${px}`,
}));

/**
 * 分段橡皮（参考语义，用户拍板）：只擦 PEN 笔画、扫过部分消失、剩余分段
 * 保留——整删有选中+Delete，橡皮的存在意义就是分段。切割走 common/geometry
 * 纯函数（扫掠线段胶囊，批 1）；手势抄 penService 骨架 + 既有设计 board 整删版
 * 参照。落库三分支（一个事务 = 一次撤销）：全擦删 / 剩一段 setPoints 保 id
 * （连续小擦不爆炸新建）/ 多段原设第一段 + 新建其余（继承 color/strokeWidth）。
 * 大小可调（方括号）+ 圆形指示跟随（EraserCursor，optionLayer）。
 */
export class EraserService extends Disposable {
  private erasing = false;
  private prev: { x: number; y: number } | null = null;
  private radiusPx = ERASER_RADIUS_DEFAULT_PX;
  /** 工具参数输出流（docs/04 §2 工具默认参数节——唯一「调参即刻生效」项：
   *  面板点选/方括号步进同源走 applyRadius，EraserCursor 视觉即刻跟随） */
  readonly radiusPx$ = new BehaviorSubject<number>(this.radiusPx);
  private cursor: EraserCursor | null = null;

  constructor(
    private viewport: IViewportService,
    private engine: IDataEngineService,
    private vmEngine: IVmEngineService,
    private history: IHistoryService,
  ) {
    super();
  }

  initialize(): void {
    this.viewport.registerGlobalEventListener('eraser', {
      onPointerDown: (e) => this.onPointerDown(e),
      onPointerMove: (e) => this.onPointerMove(e),
      onPointerUp: () => this.onPointerUp(),
      onPointerUpOutside: () => this.onPointerUp(),
      // 手势取消（Batch 1 · 1.9）：erasing 悬空会使 Escape 处理器 armed 残留
      // （此后任意时刻按 Esc 回退无关的最近一步）——cancel 显式复位 + 切 undo 项
      onPointerCancel: () => {
        if (!this.erasing) return;
        this.erasing = false;
        this.history.stopCapturing();
      },
    });
    // Escape 中途取消（capture 相拦下，mindService onTypeToEdit 同款）：undo 一步
    // 回退本手势的切割（事务靠 captureTimeout 窗口合并）+ 复位手势 + 吃掉事件
    // ——阻断 edit.escape 把模式中途切 cursor（viewport 按当前模式查表派发，
    // 模式一换 eraser 的 onPointerUp 断流、stopCapturing 被跳过）。
    // 边角：慢拖事务间隔 > captureTimeout（500ms）拆多步时只回退最后一步
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this.erasing) return;
      this.history.undo();
      this.erasing = false;
      this.prev = null;
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    this.addDisposable(() => window.removeEventListener('keydown', onKey));
    // 圆形指示：window pointermove passive 自监听（高频坐标不穿事件管线，
    // lineHoverOverlay 同款）；cursorMode 切走隐藏；vpScale 变化重画
    this.cursor = new EraserCursor(
      this.viewport.optionLayer,
      this.radiusPx,
      () => this.viewport.vpScale$.value,
    );
    const onMove = (e: PointerEvent): void => {
      const w = this.viewport.clientToWorld(e.clientX, e.clientY);
      this.cursor!.moveTo(w);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    const modeSub = this.viewport.cursorMode$.subscribe((mode) => {
      if (mode === 'eraser') this.cursor!.show();
      else this.cursor!.hide();
    });
    const scaleSub = this.viewport.vpScale$.subscribe(() => this.cursor?.rescale());
    this.addDisposable(() => {
      window.removeEventListener('pointermove', onMove);
      modeSub.unsubscribe();
      scaleSub.unsubscribe();
      this.cursor?.destroy();
      this.cursor = null;
    });
  }

  /** 方括号调大小（仅 eraser 模式生效——handler 分发面无模式过滤，服务内自查） */
  adjustRadius(delta: number): void {
    if (this.viewport.cursorMode$.value !== 'eraser') return;
    this.applyRadius(this.radiusPx + delta);
  }

  /** 面板点选直设（flyout 仅 eraser 激活时可见，无模式自查必要；钳制复用） */
  setRadius(px: number): void {
    this.applyRadius(px);
  }

  private applyRadius(px: number): void {
    const next = Math.min(ERASER_RADIUS_MAX_PX, Math.max(ERASER_RADIUS_MIN_PX, Math.round(px)));
    if (next === this.radiusPx) return;
    this.radiusPx = next;
    this.cursor?.setRadius(next);
    this.radiusPx$.next(next);
  }

  /** 当前半径（屏幕像素；__debug.eraserRadius 探针转发） */
  get currentRadiusPx(): number {
    return this.radiusPx;
  }

  private onPointerDown(e: IPointerEventInfo): void {
    this.erasing = true;
    this.prev = { x: e.world.x, y: e.world.y };
    this.eraseSweep(e.world.x, e.world.y); // 单点圆首擦（点击即擦）
  }

  private onPointerMove(e: IPointerEventInfo): void {
    if (!this.erasing || !this.prev) return;
    this.eraseSweep(e.world.x, e.world.y);
    this.prev = { x: e.world.x, y: e.world.y };
  }

  private onPointerUp(): void {
    if (!this.erasing) return;
    this.erasing = false;
    this.prev = null;
    // 拖动期间多次切割事务靠 captureTimeout 窗口合并为一步撤销（pen 同款语义）
    this.history.stopCapturing();
  }

  /** 一次扫掠（prev → cur 胶囊）对候选笔画的切割落库 */
  private eraseSweep(curX: number, curY: number): void {
    const p = this.prev!;
    const r = this.radiusPx / this.viewport.vpScale$.value;
    // 宽相位：扫掠 bbox 外扩 r → 空间索引候选 + PEN 过滤（bbox 相交粗筛，
    // 窄相位由切割函数逐段精判）
    const sweepRect: IRect = {
      x: Math.min(p.x, curX) - r,
      y: Math.min(p.y, curY) - r,
      width: Math.abs(curX - p.x) + r * 2,
      height: Math.abs(curY - p.y) + r * 2,
    };
    // 橡皮目标从注册表能力位判定（Batch 2 第五刀：erasable 单源——新增可擦类型自动纳入）
    const candidates = this.vmEngine
      .getVmsInRect(sweepRect)
      .filter((vm) => this.engine.getModelById(vm.id)?.capabilities.erasable === true);
    if (candidates.length === 0) return;

    const removeIds: string[] = [];
    const single: Array<{ id: string; points: Array<[number, number]> }> = [];
    const multi: Array<{
      id: string;
      runs: Array<Array<[number, number]>>;
      color: string;
      strokeWidth: number;
      groupId?: string;
    }> = [];
    for (const vm of candidates) {
      const model = this.engine.getModelById(vm.id);
      if (!model) continue;
      const data = model.toJSON() as unknown as {
        points: Array<[number, number]>;
        color: string;
        strokeWidth: number;
        groupId?: string;
      };
      const runs = eraseStrokeAgainstSweep(data.points, p, { x: curX, y: curY }, r);
      if (runs === null) continue; // 粗筛命中但精判未覆盖（bbox 冗余部分）
      if (runs.length === 0) removeIds.push(vm.id);
      else if (runs.length === 1) single.push({ id: vm.id, points: runs[0]! });
      // groupId 同源带出（Batch 1 · 1.11③）：编组笔被擦断不脱组
      else
        multi.push({
          id: vm.id,
          runs,
          color: data.color,
          strokeWidth: data.strokeWidth,
          groupId: data.groupId,
        });
    }
    if (removeIds.length === 0 && single.length === 0 && multi.length === 0) return;

    this.engine.transact(() => {
      if (removeIds.length > 0) this.engine.removeByIds(removeIds);
      for (const s of single) {
        // points 键被 PenModel.update 改道 setPoints（全量替换，docs/16 §2）
        this.engine.getModelById(s.id)?.update({ points: s.points } as never);
      }
      for (const m of multi) {
        this.engine.getModelById(m.id)?.update({ points: m.runs[0]! } as never);
        for (let i = 1; i < m.runs.length; i++) {
          this.engine.add({
            id: genId(),
            type: 'PEN',
            zOrder: this.engine.genInitialOrder(),
            points: m.runs[i]!,
            color: m.color,
            strokeWidth: m.strokeWidth,
            // 切割新段继承原件编组（Batch 1 · 1.11③）——groupId 是编组语义
            // 关键字段（剪贴板复制已专门重映射），漏带即脱组
            ...(m.groupId ? { groupId: m.groupId } : {}),
          } as never);
        }
      }
    });
  }
}
