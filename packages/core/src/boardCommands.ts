import type { ShapeType, LineType, CursorMode } from './types';
import type { IRect } from './common/geometry';
import { Rectangle } from 'pixi.js';
import { setTextTheme } from './platform/textEngine/theme';
import {
  computeAlignDeltas,
  computeDistributeDeltas,
  type AlignMode,
  type DistributeAxis,
  type IDelta,
} from './platform/selector/alignOps';
import { collapseGroupParticipants, type ICollapsedPart } from './platform/selector/groupOps';
import { translatePoints } from './common/geometry';

/**
 * BoardSDK 命令区（Batch 2 · app.ts 三分批 A，2026-10-18）：原门面 856-1192 行
 * 命令方法整体迁出——BoardSDK 保留同名单行委托（公开 API 与桩测注入面零改动）。
 * ctx 是宿主 BoardSDK 的窄引用（服务字段直读——组装完成即非空，访问式与原
 * 门面 optional chaining 等价）。
 */
/** 对齐/分布参与项（docs/05 §7）——自 app.ts 迁入（命令区私有契约）；
 *  linePoints 仅自由线携带（落库分流标记）。localRect/rotation 是 reattach
 *  输入语义（docs/05 §8）——bounds 仍世界 AABB（对齐数学基准） */
export interface IAlignParticipant {
  id: string;
  vm: { id: string; commitDrag(init: IRect, dx: number, dy: number): void; getLocalRect(): IRect };
  bounds: IRect;
  localRect: IRect;
  rotation: number;
  linePoints?: Array<[number, number]>;
}

/** 画布底色 token（导出底色，docs/03 §8）——app.ts 同款函数的副本（两处
 *  import 会成环；主题 token 变更时两处同改，注释互指） */
function canvasTokenColor(): string {
  try {
    const v =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement).getPropertyValue('--spinth-canvas').trim()
        : '';
    return v || '#ffffff';
  } catch {
    return '#ffffff';
  }
}

export class BoardCommands {
  /** 宿主窄引用（BoardSDK 的服务字段——批 B 组装完成后非空；宽松 any 桥
   *  避免 app.ts ↔ boardCommands.ts 循环 import，字段名即契约） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private ctx: any) {}

  /** 主题切换（app 壳 theme.ts 的 applyTheme 时机调用——core 默认文字色随之；
   *  refreshAll 强制重画，textVm 以主题版本守卫判定全量重建，docs/17 C2） */
  setTheme(theme: 'light' | 'dark'): void {
    setTextTheme(theme);
    this.ctx.vmEngine?.refreshAll();
  }

  setCursorMode(mode: CursorMode): void {
    // 只读钳制（docs/21 §4）：宿主可编程调写工具时落为 cursor，视图工具
    // （cursor/hand）放行——否则 UI 宣称"可以画"（ToolGhost/二级菜单）而
    // viewport 已丢弃全部指针。空格临时抓手走 ViewportService 内部直调，不经此闸门
    const target =
      !this.ctx.viewport?.editable$.value && mode !== 'cursor' && mode !== 'hand' ? 'cursor' : mode;
    // 同模式切换不清选区（工具栏重复点击「选择」曾把选区抹掉——脑图 Tab/Enter
    // 依赖「MIND_MAP 在选区中」，静默失效，2026-09 Phase 4 审查实测揪出）；
    // 换工具才清——工具语义切换本来就该丢弃当前选中上下文
    if (this.ctx.viewport?.cursorMode$.value !== target) {
      this.ctx.selector?.setSelected([]);
    }
    this.ctx.viewport?.setCursorMode(target);
  }

  /** 工具坞二级菜单 → 形状默认创建型（zod 校验在 service；会话级不持久化） */
  setDefaultShapeType(t: ShapeType): void {
    this.ctx.shapeService?.setDefaultShapeType(t);
  }

  /** 工具坞二级菜单聚合写通道（按工具+参数分发到各 service setter，docs/04 §2；
   *  线宽笔宽批起一工具多参数——嵌套键分发） */
  setDefaultToolOption(tool: CursorMode, key: string, id: string): void {
    if (tool === 'shape' && key === 'type')
      this.ctx.shapeService?.setDefaultShapeType(id as ShapeType);
    else if (tool === 'line' && key === 'type')
      this.ctx.lineService?.setDefaultLineType(id as LineType);
    else if (tool === 'line' && key === 'width')
      this.ctx.lineService?.setDefaultStrokeWidth(Number(id));
    else if (tool === 'pen' && key === 'color') this.ctx.penService?.setDefaultPenColor(id);
    else if (tool === 'pen' && key === 'width')
      this.ctx.penService?.setDefaultStrokeWidth(Number(id));
    else if (tool === 'sticky' && key === 'color')
      this.ctx.stickyService?.setDefaultStickyColor(id);
    else if (tool === 'text' && key === 'fontSize')
      this.ctx.textService?.setDefaultFontSize(Number(id));
    else if (tool === 'eraser' && key === 'size') this.ctx.eraserService?.setRadius(Number(id));
  }

  updateEditable(v: boolean): void {
    if (v) {
      // 切回可写：只翻闸门 + 恢复写，不恢复工具/选区（无记忆，简单且可预期）
      this.ctx.viewport?.editable$.next(true);
      this.ctx.engine?.setWriteEnabled(true);
      return;
    }
    // 只读降级序列（docs/21 §4）——顺序本身是语义：
    // ① 退编辑会话：开着编辑器转只读会留下可输入的 DOM 而命令层已全禁，
    //    先 flush 收口（可能刚产生一次文本提交，必须先于⑤的拒写）
    this.ctx.editingService?.exitActive();
    // ② 手势收口（恰好一次，不双 cancel）：写工具 → setCursorMode('cursor')
    //    （viewport 内部对旧模式发 dispatchGestureCancel）；已 cursor/hand →
    //    直接 cancel 当前模式（取消框选蓝框/抓手拖拽）。只读闸门(:290)会吞掉
    //    后续 up，不收口则交互状态机悬挂在半路
    const mode = this.ctx.viewport?.cursorMode$.value;
    if (mode && mode !== 'cursor' && mode !== 'hand') {
      this.ctx.viewport?.setCursorMode('cursor');
    } else {
      this.ctx.viewport?.dispatchGestureCancel(mode ?? 'cursor');
    }
    // ③ 先翻闸门：其后所有派生状态（工具坞/菜单/schema 拉取）第一次计算就
    //    看到只读，不存在"先可写一帧"
    this.ctx.viewport?.editable$.next(false);
    // ④ 清选区：选区框/ActionBar/MindAddButtons 连带消失（②若走了
    //    setCursorMode 已顺带清一次，这里幂等）
    this.ctx.selector?.setSelected([]);
    // ⑤ 磁盘兜底最后联动（docs/21 §4）：UI 闸门 + writeEnabled 拒写同时生效
    this.ctx.engine?.setWriteEnabled(false);
  }

  /** 写命令统一只读守卫（Batch 1 · 1.13）：键盘 handler 层有闸门，但 react
   *  命令面（ActionBar/右键菜单）与宿主直调不经键盘——命令层自守不可绕过 */
  private assertEditable(): boolean {
    return !!this.ctx.viewport?.editable$.value;
  }

  setPageScale(scale: number, focus?: { x: number; y: number }, immediate?: boolean): void {
    this.ctx.viewport?.setPageScale(scale, focus, immediate);
  }

  zoomIn(): void {
    this.ctx.viewport?.zoomIn();
  }

  zoomOut(): void {
    this.ctx.viewport?.zoomOut();
  }

  zoomToFit(): void {
    this.ctx.viewport?.zoomToFit();
  }

  undo(): void {
    if (!this.assertEditable()) return;
    this.ctx.history?.undo();
  }

  redo(): void {
    if (!this.assertEditable()) return;
    this.ctx.history?.redo();
  }

  removeSelected(): void {
    if (!this.assertEditable()) return;
    // 4.9：单选脑图且焦点为子节点 → 删节点（删根/整图仍走通用路径删整图）
    if (this.ctx.mindService?.isNodeFocused()) {
      this.ctx.mindService.deleteFocused();
      return;
    }
    this.ctx.selector?.removeSelected();
  }

  // ---- 脑图节点（MindAddButtons / 快捷键共用入口，docs/11 §8） ----

  /** 建子节点并聚焦；根下 direction 决定侧向（Tab 不传 = 默认右侧） */
  mindAddChild(direction?: 'left' | 'right'): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.addChild(direction);
  }

  /** 建同级节点并聚焦 */
  mindAddSibling(): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.addSibling();
  }

  /** 删焦点节点（根 = 删整图） */
  mindDeleteFocused(): void {
    if (!this.assertEditable()) return;
    this.ctx.mindService?.deleteFocused();
  }

  bringToFront(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('front');
  }

  sendToBack(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('back');
  }

  bringForward(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('forward');
  }

  sendBackward(): void {
    if (!this.assertEditable()) return;
    this.ctx.layer?.apply('backward');
  }

  /** 键盘微移（docs/09 §2）：一个事务合并本次所有选中元素的位移。
   *  走交互几何契约（docs/05 §4.4）：rect 型平移 x/y，points 型（LINE/PEN）平移 points。 */
  nudgeSelected(dx: number, dy: number, _shift: boolean): void {
    if (!this.ctx.viewport?.editable$.value) return;
    const ids = this.ctx.selector?.selected$.value ?? [];
    if (ids.length === 0) return;
    this.ctx.engine!.transact(() => {
      for (const id of ids) {
        const vm = this.ctx.vmEngine?.getVmById(id);
        if (vm) {
          vm.commitDrag(vm.getLocalRect(), dx, dy);
        }
      }
    });
    // 撤销项切分（Batch 1 · 1.11①）：按住方向键 key-repeat（几十 ms 间隔）在
    // 500ms captureTimeout 窗口内全部并项——一次 undo 弹回整段位移
    this.ctx.history?.stopCapturing();
  }

  /** 多选几何命令：对齐六向（docs/05 §7，参考口径——以参与集最小包围盒为基准）。
   *  参与集 = 选中集剔除锚定线（见 collectAlignParticipants）；参与数 <2 整体 no-op。 */
  alignSelection(mode: AlignMode): void {
    if (!this.ctx.viewport?.editable$.value) return;
    const entries = this.collectCollapsedParticipants();
    if (entries.length < 2) return;
    this.applyGeometryDeltas(
      entries,
      computeAlignDeltas(
        entries.map((e) => e.bounds),
        mode,
      ),
    );
  }

  /** 导出 PNG（docs/03 §8）：selection = 选中集包围盒，canvas = 全画布。
   *  纯读零 Yjs 写入；extract.download 内置浏览器下载（恒 PNG）。 */
  exportPNG(mode: 'selection' | 'canvas'): void {
    const renderer = this.ctx.viewport?.renderer;
    const layer = this.ctx.viewport?.widgetLayer;
    if (!renderer || !layer) return;
    const PAD = 32;
    let b: IRect | null = null;
    if (mode === 'selection') {
      b = this.ctx.getSelectionBounds();
    } else {
      const lb = layer.getLocalBounds();
      if (lb.width > 0 && lb.height > 0)
        b = { x: lb.x, y: lb.y, width: lb.width, height: lb.height };
    }
    if (!b || b.width <= 0 || b.height <= 0) return; // 零选/空画布 no-op
    // 纹理上限钳制（Batch 1 · 1.19）：超大画布 @2x 可能超 GPU MAX_TEXTURE——
    // 按最长边降 resolution 至可容纳（最小 0.5，仍超 = no-op + warn，防空白产物）
    const EXPORT_BASE_RESOLUTION = 2;
    const MAX_EXPORT_EDGE = 8192; // 保守上限（多数 GPU 8192/16384，取安全值）
    const longest = Math.max(b.width + PAD * 2, b.height + PAD * 2);
    let resolution = EXPORT_BASE_RESOLUTION;
    if (longest * resolution > MAX_EXPORT_EDGE) {
      resolution = Math.max(0.5, MAX_EXPORT_EDGE / longest);
      if (longest * resolution > MAX_EXPORT_EDGE + 1) {
        console.warn(`[spinth:export] 画布 ${Math.round(longest)}px 超出可导出上限，已跳过`);
        return;
      }
      console.warn(`[spinth:export] 超大画布导出降为 ${resolution.toFixed(2)}x（原 2x）`);
    }
    // culling 挂起（extract 重渲染跳过 renderable=false——不挂起则视窗外控件缺失）
    const restore = this.ctx.culling?.suspendForExport() ?? (() => {});
    try {
      renderer.extract.download({
        target: layer,
        // widgetLayer 无自身变换——世界坐标即 layer 内坐标（zoomToFit 同源）
        frame: new Rectangle(b.x - PAD, b.y - PAD, b.width + PAD * 2, b.height + PAD * 2),
        resolution,
        clearColor: canvasTokenColor(),
        filename: mode === 'selection' ? 'spinth-selection.png' : 'spinth-board.png',
      });
    } finally {
      restore();
    }
  }

  /** 多选几何命令：分布两向（沿轴排序后等距化相邻间隙，两端不动）；<3 整体 no-op */
  distributeSelection(axis: DistributeAxis): void {
    if (!this.ctx.viewport?.editable$.value) return;
    const entries = this.collectCollapsedParticipants();
    if (entries.length < 3) return;
    this.applyGeometryDeltas(
      entries,
      computeDistributeDeltas(
        entries.map((e) => e.bounds),
        axis,
      ),
    );
  }

  /** 编组（docs/18 §3.1）：Mod+G / ActionBar「编组」入口；≥2 全可组才建 */
  canGroupSelection(): boolean {
    return this.ctx.group?.canGroupSelection() ?? false;
  }

  groupSelection(): void {
    if (!this.ctx.viewport?.editable$.value) return;
    this.ctx.group?.groupSelection();
  }

  /** 解组（docs/18 §3.2）：Mod+Shift+G；选中集涉及任一组即整组解 */
  canUngroupSelection(): boolean {
    return this.ctx.group?.canUngroupSelection() ?? false;
  }

  ungroupSelection(): void {
    if (!this.ctx.viewport?.editable$.value) return;
    this.ctx.group?.ungroupSelection();
  }

  /** 对齐/分布参与集：锚定线剔除（resolver 单源判定，见 resolveAlignParticipant） */
  private collectAlignParticipants(): IAlignParticipant[] {
    const ids = this.ctx.selector?.selected$.value ?? [];
    const parts: IAlignParticipant[] = [];
    for (const id of ids) {
      const p = this.resolveAlignParticipant(id);
      if (p) parts.push(p);
    }
    return parts;
  }

  /** 参与集 + 组折叠（docs/18 §5）：**整组在集**并为单参与体（union bounds，
   *  delta 由 applyGeometryDeltas 同值摊回每成员——相对位置不变）；Alt 部分
   *  在集按单体参与（参考：组内选择 = 个体） */
  collectCollapsedParticipants(): ICollapsedPart<IAlignParticipant>[] {
    return collapseGroupParticipants(
      this.collectAlignParticipants(),
      (id) => this.ctx.group?.groupOf(id) ?? undefined,
      (g) => this.ctx.group?.membersOf(g) ?? [],
    );
  }

  /** 单个选中项的对齐参与解析（schema 可用性与命令参与集的**单源**，2026-10-10
   *  审查处置：双份判定会漂移）：锚定线（任一端绑定宿主——位置由锚定系统拥有：
   *  宿主在集内被移动时经 anchor-follow 自动重路由跟随，宿主不动则不动，
   *  docs/05 §7）返回 null；自由线携带 points 快照（落库走 points 平移而非
   *  commitDrag——LINE 的 commitDrag 是 §4.4 例外的空操作，与「线不可整体
   *  拖动」拍板零冲突）。契约面不暴露 vm.state，LINE 判定走 model.toJSON()。 */
  private resolveAlignParticipant(id: string): IAlignParticipant | null {
    const vm = this.ctx.vmEngine?.getVmById(id);
    if (!vm) return null;
    if (vm.type === 'LINE') {
      const data = this.ctx.engine?.getModelById(id)?.toJSON() as unknown as
        | {
            startNodeId?: string | null;
            endNodeId?: string | null;
            points?: Array<[number, number]>;
          }
        | undefined;
      if (!data || data.startNodeId || data.endNodeId || !Array.isArray(data.points)) return null;
      return {
        id: vm.id,
        vm,
        bounds: vm.getBounds(),
        localRect: vm.getLocalRect(),
        rotation: vm.getRotation(),
        linePoints: data.points,
      };
    }
    return {
      id: vm.id,
      vm,
      bounds: vm.getBounds(),
      localRect: vm.getLocalRect(),
      rotation: vm.getRotation(),
    };
  }

  /** 单事务批量位移 + 锚定线急切重路由 + stopCapturing（= 一次撤销）。
   *  输入为组折叠后的参与体（docs/18 §5）：组参与体的 delta 同值摊回每成员
   *  （相对位置不变）。选区框经 onStateChanged$ 自动跟随。急切重路由必须在
   *  transact 之后（Yjs 观察者相 vm.state 已同步刷新，可取准确 bounds）、
   *  stopCapturing 之前（其事务经 captureTimeout 窗口并入同一撤销项）——若留给
   *  onStateChanged$ 微任务相（渲染后才广播）则裂成第二个 undo 项
   *  （2026-10-10 E2E 实测揪出）；微任务相的重复 reattach 被 points 同值
   *  跳过拦下（lineAnchorFollow）。 */
  private applyGeometryDeltas(
    entries: ICollapsedPart<IAlignParticipant>[],
    deltas: IDelta[],
  ): void {
    this.ctx.engine!.transact(() => {
      entries.forEach((entry, i) => {
        const d = deltas[i];
        if (!d || (d.dx === 0 && d.dy === 0)) return; // 已在目标位，省一次写（组参与体整块省）
        for (const p of entry.members) {
          if (p.linePoints) {
            // 自由线：points 平移（粘贴同款通道，updateSelectedStyle 的 as never 先例）
            this.ctx.engine
              ?.getModelById(p.vm.id)
              ?.update({ points: translatePoints(p.linePoints, d.dx, d.dy) } as never);
          } else {
            p.vm.commitDrag(p.localRect, d.dx, d.dy);
          }
        }
      });
    });
    // 移动过的非线参与者：带动锚定线重路由（reattach 内部对无锚定线的形状 no-op）。
    // bounds 用 p.bounds + delta 纯算术（对齐无拖拽预览、root 是旧值不能读 getBounds；
    // 平移不改尺寸，bbox 刚体随移——MIND_MAP 宿主也正确，toJSON 的占位 rect 反而错）
    for (let i = 0; i < entries.length; i++) {
      const d = deltas[i];
      if (!d || (d.dx === 0 && d.dy === 0)) continue;
      for (const p of entries[i]!.members) {
        if (p.linePoints) continue;
        this.ctx.lineService?.reattach(p.vm.id, {
          rect: {
            x: p.localRect.x + d.dx,
            y: p.localRect.y + d.dy,
            width: p.localRect.width,
            height: p.localRect.height,
          },
          rotation: p.rotation,
        });
      }
    }
    this.ctx.history?.stopCapturing();
  }

  /** 程序化复制/剪切（右键菜单用；快捷键走 document 原生事件通道） */
  async copySelected(): Promise<void> {
    if (!this.assertEditable()) return;
    await this.ctx.clipboard?.copySelected(false);
  }

  async cutSelected(): Promise<void> {
    if (!this.assertEditable()) return;
    await this.ctx.clipboard?.copySelected(true);
  }

  pasteAt(target: { x: number; y: number }): void {
    this.ctx.clipboard?.pasteAt(target);
  }

  /** 粘贴到当前视口中心（右键菜单「粘贴」） */
  pasteAtScreenCenter(): void {
    const b = this.ctx.viewport!.vpBounds$.value;
    this.ctx.clipboard?.pasteAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }

  closeContextMenu(): void {
    this.ctx.contextMenu?.close();
  }
}
