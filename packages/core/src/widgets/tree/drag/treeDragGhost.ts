import { Sprite } from 'pixi.js';
import { markRender } from '../../../common/render';
import type { IRect } from '../../../common/geometry';
import type { TreeMapVm } from '../vm/treeMapVm';

/**
 * 树拖拽拖影管理（自 treeDragController 拆出，审查返工 P0-6 保 400 行铁律；
 * docs/11 §6「本体半透明 + generateTexture 快照」语义逐字迁移）：
 * 惰性创建（拖动成立才建——按下即建会让「第一次单击」闪现）、快照绝对定位
 * 无状态化（docs/14）、销毁时纹理随删 + 本体恢复不透明。
 */

/** 拖影宿主边界（controller 提供；窄结构避免反向依赖具体引擎类型） */
export interface ITreeDragGhostHost {
  getVmById(id: string): TreeMapVm | undefined;
  readonly optionLayer: { addChild(c: unknown): void };
  readonly renderer: { generateTexture(v: unknown): unknown } | null;
}

/** 拖影状态切片（controller 的 ITreeDragState 内嵌本字段） */
export interface ITreeGhostState {
  ghost: Sprite | null;
  startRect: IRect;
  startWorld: { x: number; y: number };
}

export class TreeDragGhost {
  constructor(private readonly host: ITreeDragGhostHost) {}

  /** 拖影惰性创建：本体半透明留原地 + 快照挂 optionLayer（无 renderer 降级
   *  只有半透明） */
  start(d: { mapId: string; nodeId: string } & ITreeGhostState): void {
    if (!d || d.ghost || d.startRect.width === 0) return;
    const vm = this.host.getVmById(d.mapId);
    if (!vm) return;
    vm.setNodeAlpha(d.nodeId, 0.8); // 本体半透明留原地（既有设计 alpha 档位）
    const nodeVm = vm.getNodeVm(d.nodeId);
    const renderer = this.host.renderer;
    if (nodeVm && renderer) {
      const ghost = new Sprite(renderer.generateTexture(nodeVm) as never);
      ghost.eventMode = 'none';
      ghost.alpha = 0.9;
      ghost.position.set(d.startRect.x, d.startRect.y);
      this.host.optionLayer.addChild(ghost);
      d.ghost = ghost;
      markRender();
    }
  }

  /** 拖影跟随（快照绝对定位：起始世界 rect + 指针位移——无状态化，docs/14） */
  sync(d: ITreeGhostState | null, world: { x: number; y: number }): void {
    if (!d?.ghost) return;
    d.ghost.position.set(
      d.startRect.x + (world.x - d.startWorld.x),
      d.startRect.y + (world.y - d.startWorld.y),
    );
    markRender(); // 快照跟手依赖标脏（同幽灵根，漏标即「拖影不动」）
  }

  /** 拖影销毁 + 本体恢复不透明（松手/取消统一出口） */
  clear(d: ({ mapId: string; nodeId: string } & ITreeGhostState) | null): void {
    if (!d) return;
    if (d.ghost) {
      const tex = d.ghost.texture;
      d.ghost.destroy();
      tex.destroy(true);
      d.ghost = null;
      markRender();
    }
    this.host.getVmById(d.mapId)?.setNodeAlpha(d.nodeId, 1);
  }
}
