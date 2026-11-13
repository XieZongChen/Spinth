import type { IRect } from './common/geometry';
import { htmlToDoc } from './platform/textEngine/htmlDoc';

/**
 * dev/E2E 探针快照纯聚合：消费方是 boardDebug.ts 适配器（DEV 调试入口
 * window.__spinthDebug.__debug，specs/runtime-narrowing §3.5）。字段契约与
 * E2E 消费面零改动；本文件不 import 具体服务，依赖经 IDebugSnapshotDeps 注入。
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- 探针跨服务读内部映射与
 * vm.state（dev 专用面，不在公共契约上） */
type AnyVm = { id: string; type: string; root: { zOrder?: string }; state: any };

export interface IDebugSnapshotDeps {
  engine: { modelMapping?: Map<string, unknown> } | null;
  vmMapping: Map<string, AnyVm>;
  selector: { __selectionFrame?: IRect | null; selected$: { value: string[] } } | null;
  rectEditor: {
    __editorFrame?: IRect | null;
    __rotateHandle?: { x: number; y: number; visible: boolean } | null;
  } | null;
  widgetChildrenCount: number;
  renderCount: number;
  textRender: { stats: { registered: number; snapshot: number; text: number } } | null;
  culling: { culledCount: number } | null;
  shapeService: { defaultShapeType: string } | null;
  defaultToolOptions: Record<string, Record<string, string>>;
  eraserService: { currentRadiusPx: number } | null;
  lineService: Record<string, unknown> | null;
  refLine: {
    __spacingGaps: Array<{ axis: string; from: number; to: number; cross: number; value: number }>;
  } | null;
  shapeTypeOptionIds: string[];
  mindService: {
    nodesDebug: Array<{ id: string; text: string; worldRect: IRect }>;
    dropPreviewDebug: IRect | null;
    getFocusedState(): { nodeId: string; isRoot: boolean; worldRect: IRect } | null;
  } | null;
  awareness: {
    peers$: {
      value: Map<
        number,
        {
          userId: string;
          userName: string;
          userColor: string;
          cursorPos: { x: number; y: number } | null;
          selectedWidgetIds: string[];
        }
      >;
    };
  } | null;
  /** 图片纹理缓存探针（E2E 断言同图一份纹理/refs 计数；entries 含保活空闲条目）；null = 未建 */
  imageTextures: {
    debug(): {
      entries: Array<{ key: string; refs: number; uid: number; idle: boolean }>;
      pending: number;
      keepAlive: { count: number; bytes: number };
    };
  } | null;
  /** 资产 objectURL 租约快照（id → refs；E2E 断言切 src/删图计数归位） */
  assetStore: { debugLeases(): Record<string, number> } | null;
}

export function buildDebugSnapshot(d: IDebugSnapshotDeps) {
  return {
    modelCount: d.engine?.modelMapping?.size ?? 0,
    vmCount: d.vmMapping.size,
    widgetChildren: d.widgetChildrenCount,
    renderCount: d.renderCount,
    canvasCount: typeof document !== 'undefined' ? document.querySelectorAll('canvas').length : 0,
    selectionFrame: d.selector?.__selectionFrame ?? null,
    editorFrame: d.rectEditor?.__editorFrame ?? null,
    rotateHandle: d.rectEditor?.__rotateHandle ?? null,
    textRender: d.textRender?.stats ?? { registered: 0, snapshot: 0, text: 0 },
    culledCount: d.culling?.culledCount ?? 0,
    selectedIds: [...(d.selector?.selected$.value ?? [])],
    defaultShapeType: d.shapeService?.defaultShapeType ?? 'rect',
    defaultToolOptions: { ...d.defaultToolOptions },
    eraserRadius: d.eraserService?.currentRadiusPx ?? 10,
    lineAnchors: d.lineService?.anchorHoverDebug ?? null,
    spacingGaps: d.refLine?.__spacingGaps ?? [],
    shapeTypeOptions: d.shapeTypeOptionIds,
    lineAnchorActive: d.lineService?.anchorActiveDebug ?? null,
    linePreview: d.lineService?.previewFollowDebug ?? null,
    lineGhost: d.lineService?.ghostPreviewDebug ?? false,
    lineGhostMode: d.lineService?.ghostModeDebug ?? null,
    lineGhostBounds: d.lineService?.ghostBoundsDebug ?? 'none',
    lineSegments: d.lineService?.lineSegmentsDebug ?? null,
    lineSegmentActive: d.lineService?.lineSegmentActiveDebug ?? null,
    lineEndpointActive: d.lineService?.lineEndpointActiveDebug ?? null,
    /** 最近一次 ELBOWED 重路由的第三方避障集合（specs/flowchart-closeout §8.2；
     *  E2E 断言避障生效；null = 未触发重路由）。本键名 lastRouteObstacles 是
     *  E2E 探针路径——只允许存在于本 dev 入口（生产侧走中性 routeObstaclesProbe，
     *  check-debug-bundle 扫描本字面量在产物中为零） */
    lastRouteObstacles: d.lineService?.routeObstaclesProbe ?? null,
    lineKnockout: d.lineService?.lineKnockoutDebug ?? null,
    mindNodes: d.mindService?.nodesDebug ?? [],
    dropPreview: d.mindService?.dropPreviewDebug ?? null,
    /** marks 渲染探针（docs/17 §4 刀 3）：首个 TEXT/STICKY 的渲染 span 清单
     *  （E2E 断言 bold/color 落位——与渲染同源 htmlToDoc） */
    textSpans: (() => {
      const tv = Array.from(d.vmMapping.values()).find(
        (v) => v.type === 'TEXT' || v.type === 'STICKY',
      );
      const text = tv ? String((tv.state as unknown as { text?: string }).text ?? '') : '';
      return htmlToDoc(text).flatMap((p: { spans: unknown }) => p.spans);
    })(),
    mindFocus: d.mindService?.getFocusedState()
      ? (() => {
          const st = d.mindService!.getFocusedState()!;
          return { nodeId: st.nodeId, isRoot: st.isRoot, worldRect: st.worldRect };
        })()
      : null,
    peers: d.awareness
      ? [...d.awareness.peers$.value.entries()].map(([clientId, st]) => ({
          clientId,
          userId: st.userId,
          userName: st.userName,
          color: st.userColor,
          pos: st.cursorPos ? { ...st.cursorPos } : null,
          selected: st.selectedWidgetIds.length,
          selectedIds: [...st.selectedWidgetIds],
        }))
      : [],
    vmPositions: Array.from(d.vmMapping.values()).map((vm) => ({
      id: vm.id,
      // 数据左上（pivot 式后 root.x/y 是视觉中心——E2E 消费方均为「左上」语义）
      x: vm.state.x,
      y: vm.state.y,
      zOrder: vm.root.zOrder,
    })),
    vmStates: Array.from(d.vmMapping.values()).map((vm) => ({
      ...(JSON.parse(JSON.stringify(vm.state)) as Record<string, unknown>),
      // 真渲染探针（P0 修复配套）：IMAGE 的 sprite 已建（占位=false）
      hasSprite: (vm as unknown as { hasSprite?: boolean }).hasSprite ?? null,
      // 加载会话探针（docs/19 §4）：IMAGE 的 src/状态/重试次数/纹理标识
      imageLoad: (vm as unknown as { loadDebug?: unknown }).loadDebug ?? null,
    })),
    /** 纹理缓存探针：entries[].key=assetId（refs>0 在租 / idle=true 保活空闲）；
     *  keepAlive = 空闲池条目数与估算字节（E2E 验双上限） */
    imageTextures: d.imageTextures?.debug() ?? {
      entries: [],
      pending: 0,
      keepAlive: { count: 0, bytes: 0 },
    },
    /** 资产 URL 租约（id → 计数；非资产图为空对象） */
    assetLeases: d.assetStore?.debugLeases() ?? {},
  };
}
