import type { IActivationLookup, IFrameLookup } from '../../types';

/**
 * 级联复合查找（specs/sequence-diagram §5.3）：容器的级联钩子与激活条的随行钩子
 * 合成同一个 IFrameLookup。selector / clipboard / layer 的调用点不认具体类型，
 * 注入点从 FrameService 换成它即可（调用方零改动）；alignCommands 经命令宿主的
 * cascade 字段读它。
 *
 * - expandForCascade = 两者并集去重保序——容器展开在前，生命线天然排在它的条之前
 *   （粘贴批次按入批序递增 zOrder，层级因此正确）；
 * - reconcileParents / adoptByLanding = 两者依次调用（容器先、激活条后）；
 * - 其余五个方法直通 frame（激活条不参与：不进容器、不参与框选归并与图层钳制）。
 */
export function composeCascadeLookup(
  frame: IFrameLookup,
  seq: IActivationLookup | null,
): IFrameLookup {
  if (!seq) return frame;
  return {
    isFrame: (id) => frame.isFrame(id),
    childIds: (frameId) => frame.childIds(frameId),
    expandForCascade: (ids) => [
      ...new Set([...frame.expandForCascade(ids), ...seq.expandActivations(ids)]),
    ],
    reconcileParents: (ids, rectOf) => {
      frame.reconcileParents(ids, rectOf);
      seq.reconcileActivations(ids, rectOf);
    },
    adoptByLanding: (ids) => {
      frame.adoptByLanding(ids);
      seq.adoptActivationsByLanding(ids);
    },
    computeLayerClamps: (post) => frame.computeLayerClamps(post),
    createMarqueeFrameFilter: (groups) => frame.createMarqueeFrameFilter(groups),
  };
}
