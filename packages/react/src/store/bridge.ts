import type { BoardPublicApi } from '@spinth/core';
import { useSpinthStore } from './spinthStore';

/**
 * 桥（docs/12 §2）：SDK rxjs 输出流 → zustand 只读镜像。
 * 返回解除函数（Board 组件卸载时调用）。
 */
export function connectBoard(sdk: BoardPublicApi): () => void {
  const store = useSpinthStore;
  // 空态引导种子（P0 修复）：modelCount 此前只在 widgetsChanged$ 镜像——刷新
  // 已有内容的文档时首帧引导误现（首个 widgetsChanged 迟到/删除不触发）
  store.setState({ modelCount: sdk.modelCount });
  // schema 缓存（Batch 1 · 1.24）：vp 流（平移/缩放每帧）只重算 bounds——此前
  // 每帧全新 getActionBarSchema()（选中态重算 + React 树 diff），选中态平移掉帧。
  // 失效由订阅点显式驱动（selected$/widgetsChanged$——选中内容或数据变化），
  // vp 流命中缓存 → zustand 浅比较（schema 引用不变）跳过 ActionBar 重渲
  let schemaCache: ReturnType<BoardPublicApi['getActionBarSchema']> | undefined;
  const invalidateSchema = (): void => {
    schemaCache = undefined;
  };
  const getSchema = (): ReturnType<BoardPublicApi['getActionBarSchema']> => {
    if (schemaCache !== undefined) return schemaCache;
    schemaCache = sdk.getActionBarSchema();
    return schemaCache;
  };
  const syncSchema = (): void => {
    const schema = getSchema();
    const world = sdk.getSelectionBounds();
    if (!schema || !world) {
      store.setState({ actionBar: { schema: null, bounds: null } });
      return;
    }
    const a = sdk.toScreenPoint({ x: world.x, y: world.y });
    const c = sdk.toScreenPoint({ x: world.x + world.width, y: world.y + world.height });
    store.setState({
      actionBar: {
        schema,
        bounds: { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y },
      },
    });
  };
  // 视口流轻路径：schema 命中缓存（引用不变）→ zustand 浅比较跳过 ActionBar 重渲
  // 脑图 +/- 按钮（拉取式同 ActionBar 模式）：焦点/树/视口/选中变化时重算
  const syncMindButtons = (): void => {
    store.setState({ mindAddButtons: sdk.getMindAddButtons() });
  };
  const subs = [
    sdk.docState$.subscribe((v) => store.setState({ docState: v })),
    sdk.mindGhostSuppressed$.subscribe((v) => store.setState({ mindGhostSuppressed: v })),
    sdk.wsState$.subscribe((v) => store.setState({ wsState: v })),
    sdk.editBlocked$.subscribe((v) => store.setState({ editBlocked: v })),
    sdk.persistState$.subscribe((v) => store.setState({ persistState: v })),
    sdk.storageStatus$.subscribe((v) => store.setState({ storageStatus: { ...v } })),
    sdk.cursorMode$.subscribe((v) => {
      store.setState({ cursorMode: v });
      syncMindButtons();
    }),
    // 工具默认参数聚合（会话级，docs/04 §2——Toolbar 常驻二级菜单/ToolGhost 消费）
    sdk.defaultToolOptions$.subscribe((v) =>
      store.setState({
        defaultToolOptions: Object.fromEntries(Object.entries(v).map(([k, m]) => [k, { ...m }])),
      }),
    ),
    sdk.vpScale$.subscribe((v) => store.setState({ pageScale: v })),
    sdk.vpBounds$.subscribe((v) => store.setState({ vpBounds: { ...v } })),
    sdk.editable$.subscribe((v) => store.setState({ editable: v })),
    sdk.selected$.subscribe((v) => {
      store.setState({ selectedCount: v.length });
      invalidateSchema();
      syncSchema();
      syncMindButtons();
    }),
    sdk.canUndo$.subscribe((v) => store.setState({ canUndo: v })),
    sdk.canRedo$.subscribe((v) => store.setState({ canRedo: v })),
    sdk.contextMenuOptions$.subscribe((v) => store.setState({ contextMenu: v })),
    // 视口/数据变化 → ActionBar 跟随（schema 里的当前值同步刷新）
    sdk.vpScale$.subscribe(() => syncSchema()),
    sdk.vpBounds$.subscribe(() => syncSchema()),
    // 网格吸附开关（specs/flowchart-closeout §9.2）：ContextMenu 勾选项消费
    sdk.gridSnap$.subscribe((v) => store.setState({ gridSnap: v })),
    sdk.widgetsChanged$.subscribe(() => {
      invalidateSchema();
      syncSchema();
      syncMindButtons(); // 树结构/文本变化 → 节点几何重算（布局微任务先于此广播）
      // 空态引导（Batch 1 · 1.23）：画布件数镜像——0→显示引导，首件即隐
      store.setState({ modelCount: sdk.modelCount });
    }),
    // 脑图焦点变化：浮动操作栏（含删除按钮）也要重算——根/子节点焦点切换不改
    // selected$（单选脑图始终是同一个 id），只刷 ＋ 按钮会让 ActionBar 停在旧节点上方。
    // invalidate 先行（第三轮审查）：schema 缓存按选中集键控，焦点切子节点→根时
    // 选中集不变、schema 却变（lineColor 等）——缓存不失效则 ActionBar 残留旧值
    sdk.mindFocusChanged$.subscribe(() => {
      invalidateSchema();
      syncSchema();
      syncMindButtons();
    }),
    sdk.vpScale$.subscribe(() => syncMindButtons()),
    sdk.vpBounds$.subscribe(() => syncMindButtons()),
    // 拖拽中隐藏（docs/12 §3：拖拽中置 null），松手落库后 widgetsChanged$ 恢复
    sdk.dragMove$.subscribe(() => {
      store.setState({ actionBar: { schema: null, bounds: null } });
      store.setState({ mindAddButtons: null });
    }),
  ];
  return () => subs.forEach((s) => s.unsubscribe());
}
