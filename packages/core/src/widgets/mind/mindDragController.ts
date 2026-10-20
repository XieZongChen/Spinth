import { Sprite } from 'pixi.js';
import { Disposable } from '../../base/disposable';
import { markRender } from '../../common/render';
import type { IRect } from '../../common/geometry';
import type {
  IDataEngineService,
  ISelectorService,
  IViewportService,
  IVmEngineService,
} from '../../types';
import type { MindMapVm } from './mindMapVm';
import type { MindMapModel, IMindNodeSpec } from './mindMapModel';
import { findMindNode, nodeDirection, yTreeToSpec } from './mindMapModel';
import { buildTreeDropAreas, hitTreeDropAreas, type IMindTreeDropAreas } from './mindDropHit';
import type { IDropTarget } from './dropArea';
import { fakeBlockRect, MindDropPreview } from './mindDropPreview';
import { HORIZONTAL_OFFSET_NODE, HORIZONTAL_OFFSET_ROOT } from './mindLayout';
import type { MindTreeOps } from './mindTreeOps';

/**
 * 脑图拖拽重排协作者（自 mindService 拆出，2026-10-06 批刀 2）：docs/11 §6——
 * 节点拖起判定（单轴阈值）+ 拖影快照跟随（generateTexture）+ 全脑图 DropArea
 * 命中（会话级缓存）+ 落点预置块预览 + 松手三分支（moved/new-map/click）。
 * 拖拽会话状态（drag/dropAreaCache/dropPreview）归属本类；树写落库经兄弟直引
 * MindTreeOps；焦点写入与拖出成图经 host 回调交还宿主。
 */

/**
 * 拖动判定阈值（屏幕像素，既有设计 dragger.start(event, 10)）：**单轴**超过 10px 才
 * 算拖拽（既有设计为轴阈值 `tractionX >= traction || tractionY >= traction`，非欧氏距离），
 * 微抖不构成拖拽、松手仍按单击处理。
 */
const DRAG_THRESHOLD_SCREEN = 10;

/** MindService ↔ 拖拽域的边界：焦点写入与拖出成图留在服务侧 */
export interface IMindDragHost {
  setFocusedNode(id: string | null): void;
  createMindMap(x: number, y: number, rootSpec?: IMindNodeSpec): string;
}

interface IMindDragState {
  /** 拖起的源脑图 id */
  mapId: string;
  /** 拖起节点 id */
  nodeId: string;
  /** 节点 JSON 快照（move 的序列化源） */
  spec: IMindNodeSpec;
  /** 拖起时指针（世界坐标） */
  startWorld: { x: number; y: number };
  /** 最后命中 drop 目标（松手落库用——docs/14 规则 4） */
  lastTarget: IDropTarget | null;
  /** 命中目标所属脑图（跨图拖拽用；null = 未命中/与源图相同） */
  lastTargetMapId: string | null;
  moved: boolean;
  /** 拖影快照（docs/11 §6：本体半透明留原地 + 快照跟随光标） */
  ghost: Sprite | null;
  /** 光标相对节点左上角的抓取偏移（快照绝对定位用） */
  grabOffset: { x: number; y: number };
  /** 拖起时节点世界 rect（快照回位基准） */
  startRect: { x: number; y: number; width: number; height: number };
}

export class MindDragController extends Disposable {
  private drag: IMindDragState | null = null;
  /** 拖拽会话级 DropArea 缓存：dragMove 每 move 重建曾是最热路径（全树 walk ×2 +
   *  O(n) DropArea 分配）。拖拽期间树结构/节点 rect 静态（模型零写入、预览纯视觉），
   *  建一次整会话复用，dragEnd 释放；远端并发改树的边界由 move 落库侧的 insertAt
   *  越界钳制兜底（docs/11 §6） */
  private dropAreaCache: Array<{
    mapId: string;
    model: MindMapModel;
    vm: MindMapVm;
    areas: IMindTreeDropAreas;
  }> | null = null;
  /** 拖拽落点预览（docs/11 §6 蓝色落点矩形 + 预连线；惰性创建随 dispose 销毁） */
  private dropPreview: MindDropPreview | null = null;

  constructor(
    private readonly viewport: IViewportService,
    private readonly engine: IDataEngineService,
    private readonly vmEngine: IVmEngineService,
    private readonly selector: ISelectorService,
    private readonly treeOps: MindTreeOps,
    private readonly host: IMindDragHost,
  ) {
    super();
  }

  /** 会话进行中（宿主 isDragging 契约与焦点跟随的「拖拽中不跟随」守卫共用） */
  get active(): boolean {
    return this.drag !== null;
  }

  /** dev 调试探针：落点预置块（E2E/单测断言落点位置——数据探针优先于截图） */
  get dropPreviewDebug(): IRect | null {
    return this.dropPreview?.lastBlock ?? null;
  }

  /** cursor 模式按下在脑图节点上（非根）：启动拖拽（含拖影，docs/11 §6：
   *  本体半透明留原地 + generateTexture 快照跟随光标——无 renderer 时降级无拖影） */
  startDrag(mapId: string, nodeId: string, world: { x: number; y: number }): boolean {
    const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
    if (!model?.hasRoot()) return false;
    const node = findMindNode(model.root, nodeId);
    if (!node || node === model.root) return false; // 根不可拖
    const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
    const rect = vm?.getNodeRect(nodeId) ?? null;
    const worldRect = rect
      ? { x: vm!.root.x + rect.x, y: vm!.root.y + rect.y, width: rect.width, height: rect.height }
      : { x: world.x, y: world.y, width: 0, height: 0 };
    this.drag = {
      mapId,
      nodeId,
      spec: yTreeToSpec(node.yMap),
      startWorld: { ...world },
      lastTarget: null,
      lastTargetMapId: null,
      moved: false,
      ghost: null,
      grabOffset: { x: world.x - worldRect.x, y: world.y - worldRect.y },
      startRect: worldRect,
    };
    return true;
  }

  /** 拖影惰性创建（既有设计拖影走 selectionService.dragStart$——拖动成立后才建，
   *  按下即建会让「第一次单击」闪现半透明+快照）：本体半透明留原地 +
   *  generateTexture 快照挂 optionLayer（无 renderer 降级只有半透明） */
  private startGhost(): void {
    const d = this.drag;
    if (!d || d.ghost || d.startRect.width === 0) return;
    const vm = this.vmEngine.getVmById(d.mapId) as MindMapVm | undefined;
    if (!vm) return;
    vm.setNodeAlpha(d.nodeId, 0.8); // 本体半透明留原地（既有设计 alpha 档位）
    const nodeVm = vm.getNodeVm(d.nodeId);
    const renderer = this.viewport.renderer;
    if (nodeVm && renderer) {
      const ghost = new Sprite(renderer.generateTexture(nodeVm));
      ghost.eventMode = 'none';
      ghost.alpha = 0.9;
      ghost.position.set(d.startRect.x, d.startRect.y);
      this.viewport.optionLayer.addChild(ghost);
      d.ghost = ghost;
      markRender();
    }
  }

  /** 拖影跟随（快照绝对定位：起始世界 rect + 指针位移——无状态化，docs/14） */
  private syncGhost(world: { x: number; y: number }): void {
    const d = this.drag;
    if (!d?.ghost) return;
    d.ghost.position.set(
      d.startRect.x + (world.x - d.startWorld.x),
      d.startRect.y + (world.y - d.startWorld.y),
    );
    markRender(); // 快照跟手依赖标脏（同幽灵根，漏标即"拖影不动"）
  }

  /** 拖影销毁 + 本体恢复不透明（松手/取消统一出口） */
  private clearGhost(): void {
    const d = this.drag;
    if (!d) return;
    if (d.ghost) {
      const tex = d.ghost.texture;
      d.ghost.destroy();
      tex.destroy(true);
      d.ghost = null;
      markRender();
    }
    (this.vmEngine.getVmById(d.mapId) as MindMapVm | undefined)?.setNodeAlpha(d.nodeId, 1);
  }

  /** 拖拽中：对全脑图节点做 DropArea hitTest；返回落点或 null（空白=成新图） */
  dragMove(world: { x: number; y: number }): boolean {
    if (!this.drag) return false;
    // 拖动判定 = 位移超阈值（3 屏幕像素换算世界单位）——微抖不构成拖拽，
    // 松手仍按单击处理（曾仅以「move 事件发生过」为据，点一下就拆树成新图）
    const scale = this.viewport.vpScale$.value || 1;
    if (!this.drag.moved) {
      const threshold = DRAG_THRESHOLD_SCREEN / scale;
      const dx = Math.abs(world.x - this.drag.startWorld.x);
      const dy = Math.abs(world.y - this.drag.startWorld.y);
      if (dx >= threshold || dy >= threshold) {
        this.drag.moved = true;
        this.startGhost(); // 拖动成立才建拖影（按下即建 = 单击闪现拖拽视觉，用户实测揪出）
      }
    }
    const hit = this.hitDropAnyMap(world, this.drag.mapId, this.drag.nodeId);
    this.drag.lastTarget = hit?.target ?? null;
    this.drag.lastTargetMapId = hit?.mapId ?? null;
    this.updateDropPreview(this.drag?.lastTarget ?? null);
    this.syncGhost(world);
    return !!hit;
  }

  /**
   * 落点预览（docs/11 §6）：把落点换算成「父节点 + 插入下标」，再按既有设计
   * calculateFakeBounds 的规则摆 40×16 蓝色预置块 + 预连线。
   * asChild 与 asSibling 在这里统一成同一件事——预置块都挂在某个父节点的子位。
   */
  private updateDropPreview(hit: IMindDragState['lastTarget']): void {
    if (!hit) {
      this.dropPreview?.hide();
      return;
    }
    const vm = this.vmEngine.getVmById(this.drag?.lastTargetMapId ?? this.drag?.mapId ?? '') as
      MindMapVm | undefined;
    const model = this.engine.getModelById(this.drag?.lastTargetMapId ?? this.drag?.mapId ?? '') as
      MindMapModel | undefined;
    if (!vm || !model?.hasRoot()) {
      this.dropPreview?.hide();
      return;
    }

    // 落点归一化：dest = 承接新节点的父；index = 插入下标；direction = 该侧
    const destId = hit.kind === 'asChild' ? hit.nodeId : hit.parentId;
    const index = hit.index;
    const dest = findMindNode(model.root, destId);
    const destRect = dest ? vm.getNodeRect(dest.id) : null;
    if (!dest || !destRect) {
      this.dropPreview?.hide();
      return;
    }
    const isRoot = dest === model.root;
    // 落点侧向：根层左右分支混排，而根自身没有侧向（nodeDirection 缺省给 right），
    // 所以必须按「插入位相邻兄弟」判侧——asSibling 目标不带 direction 字段，
    // 曾对根层一律按 right 处理：拖左侧节点时预置块被画到根节点**右侧**（用户实测：
    // 「预置节点乱飘」）。非根节点整棵子树同侧，取父的侧向即可。
    const direction: 'left' | 'right' = !isRoot
      ? nodeDirection(dest)
      : (hit.direction ??
        (() => {
          // 兜底（目标未带侧向时）：按插入位相邻兄弟判侧
          const neighbor = dest.children[index] ?? dest.children[index - 1];
          return neighbor ? nodeDirection(neighbor) : 'right';
        })());

    // 同侧前后兄弟（根层按侧过滤，与 drop 命中口径一致）
    const siblings = dest.children.filter((c) => !isRoot || nodeDirection(c) === direction);
    // index 是 children 绝对下标；换算成该侧序号（根层才有意义）
    const sideIndex = isRoot
      ? siblings.filter((c) => dest.children.indexOf(c) < index).length
      : index;
    const beforeNode = sideIndex > 0 ? siblings[sideIndex - 1] : null;
    const afterNode = sideIndex < siblings.length ? siblings[sideIndex] : null;

    const toWorld = (r: IRect): IRect => ({
      x: vm.root.x + r.x,
      y: vm.root.y + r.y,
      width: r.width,
      height: r.height,
    });
    const worldDest = toWorld(destRect);
    // 预置块挂在被拖子树之外：invalidate 由调用方保证（此处直接算）
    const block = fakeBlockRect({
      dest: worldDest,
      before: beforeNode ? toWorld(vm.getNodeRect(beforeNode.id) ?? destRect) : null,
      after: afterNode ? toWorld(vm.getNodeRect(afterNode.id) ?? destRect) : null,
      direction,
      offset: isRoot ? HORIZONTAL_OFFSET_ROOT : HORIZONTAL_OFFSET_NODE,
    });

    if (!this.dropPreview) this.dropPreview = new MindDropPreview(this.viewport.optionLayer);
    this.dropPreview.show({ block, dest: worldDest, isRoot, direction });
  }

  /** 松手：拖动且命中 → move；拖动未命中 → 拖出成新图；**未拖动（单击）= 焦点
   *  落按下节点**——曾无条件走成新图：点一下子节点整棵子树被拆成新脑图
   *  （用户实测揪出，2026-09-20） */
  /** 手势取消（Batch 1 · 1.9）：pointercancel/blur/切工具——只收会话与视觉
   *  （拖影/预览/缓存），不落库不建图；焦点保持按下节点 */
  dragCancel(): void {
    if (!this.drag) return;
    this.clearGhost();
    this.drag = null;
    this.dropAreaCache = null;
    this.dropPreview?.hide();
  }

  dragEnd(world: { x: number; y: number }): 'moved' | 'new-map' | 'click' | null {
    if (!this.drag) return null;
    const d = this.drag;
    this.clearGhost(); // 读 this.drag——必须在置空前（拖影销毁 + 本体恢复）
    this.drag = null;
    this.dropAreaCache = null; // 会话缓存释放（热区随树快照过期）
    this.dropPreview?.hide();
    if (!d.moved) {
      // 单击：不搬移不成图；焦点 = 按下节点（选区在按下时已建整图）。
      // 再次单击已选中节点 = 进入文本编辑——由 selector 的通用激活通道
      // （onActivate → enterNodeEditAt）触发，与既有设计「选中态再点一次」一致，
      // 不再用限时双击（既有设计无时间窗，慢速两次点击同样进编辑）
      this.host.setFocusedNode(d.nodeId);
      return 'click';
    }
    const hit = d.lastTarget;
    if (hit) {
      const newId = this.treeOps.move(d, hit);
      // 松手重选被拖节点（docs/11 §6 原文「move → 重选中」；move 序列化重建
      // id 全新生成——曾把焦点清空，getFocused 对 null 惰性回退根 →
      // 拖拽后选中态闪到根节点，用户实测揪出）
      const destMapId = d.lastTargetMapId ?? d.mapId;
      if (destMapId !== d.mapId) {
        // 跨图搬移：选区切到目标图（selected$ 订阅会先落根，下面覆写）
        this.selector.setSelected([destMapId]);
      }
      this.host.setFocusedNode(newId);
      return 'moved';
    }
    // 空白 → 成新图（world 位置；createMindMap 内部设新图根焦点）。
    // 剥拖起节点的分支色（跨脑图强制重分配，docs/11 §6）：原节点成为新图根
    // （根不落色），其后代升为一级分支由 buildYTree 按位重新分配
    this.engine.transact(() => {
      this.treeOps.removeNode(d.mapId, d.nodeId);
    });
    const spec = { ...d.spec };
    delete spec.lineColor;
    this.host.createMindMap(world.x, world.y, spec);
    return 'new-map';
  }

  /**
   * 跨脑图命中（既有设计 mindController.hitTestDrop：遍历所有 MIND_MAP 取首个命中）。
   * 源脑图排在最前——同图重排是高频操作，不应被其它图抢走。
   * 装配与树级命中在 mindDropHit.ts 纯函数模块；热区集按拖拽会话缓存
   * （首批 move 惰性建、dragEnd 释放，0b50168）。
   */
  private hitDropAnyMap(
    world: { x: number; y: number },
    sourceMapId: string,
    excludeId: string,
  ): { target: IDropTarget; mapId: string } | null {
    if (!this.dropAreaCache) {
      const mapIds = this.vmEngine
        .getAllVms()
        .filter((vm) => vm.type === 'MIND_MAP')
        .map((vm) => vm.id);
      const ordered = [sourceMapId, ...mapIds.filter((id) => id !== sourceMapId)];
      this.dropAreaCache = ordered.flatMap((mapId) => {
        const model = this.engine.getModelById(mapId) as MindMapModel | undefined;
        const vm = this.vmEngine.getVmById(mapId) as MindMapVm | undefined;
        if (!model?.hasRoot() || !vm) return [];
        return [
          {
            mapId,
            model,
            vm,
            areas: buildTreeDropAreas(model, vm, mapId === sourceMapId ? excludeId : '', (n) =>
              nodeDirection(n),
            ),
          },
        ];
      });
    }
    for (const entry of this.dropAreaCache) {
      const target = hitTreeDropAreas(entry.vm, entry.areas, world);
      if (target) return { target, mapId: entry.mapId };
    }
    return null;
  }

  override dispose(): void {
    this.dropPreview?.destroy();
    this.dropPreview = null;
    super.dispose();
  }
}
