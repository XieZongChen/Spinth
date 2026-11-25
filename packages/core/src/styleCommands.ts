/**
 * ActionBar 样式写入命令（specs/api-surface §3.1 Step 4）——updateSelectedStyle
 * 自 app.ts 756-796 行逐字迁入。不走 BoardCommands（避免给命令类加一个只有
 * 门面在用的方法）；BoardSDK.updateSelectedStyle 一行委托至此，公开签名不变。
 * 自带 editable 判断（与命令层 assertEditable 语义同源，独立守卫）。
 */
import type { IBoardCommandHost } from './boardHost';

/** ActionBar 样式写入：一个事务覆盖全部选中（schema 字段经 zod strip 防越权） */
export function updateSelectedStyle(ctx: IBoardCommandHost, patch: Record<string, unknown>): void {
  const ids = ctx.selector?.selected$.value ?? [];
  if (ids.length === 0 || !ctx.viewport?.editable$.value) return;
  // 折叠 toggle（specs/tree-diagrams §8.4）：文档写走 TreeService，不进通用
  // widget update（collapsed 是树内字段非 schema 字段；只读闸门沿用上方 editable）
  if (typeof patch.treeCollapsed === 'boolean') {
    ctx.treeService?.setCollapsedFocused(patch.treeCollapsed);
    return;
  }
  // 排列方向（specs §10.2 图属性）：写图字段 orientation，一步撤销零节点写
  if (
    (patch.treeOrientation === 'horizontal' || patch.treeOrientation === 'vertical') &&
    ids.length === 1
  ) {
    ctx.treeService?.setOrientation(ids[0]!, patch.treeOrientation);
    return;
  }
  // 容器归属清父（specs/container-frame §5.3）：右键「移出容器」经通用样式
  // 通道分流到 FrameService——I5 归属写唯一入口（同 treeCollapsed 分流先例）
  if ('parentId' in patch && patch.parentId === undefined) {
    ctx.frame?.detachSelection();
    return;
  }
  // 4.9：脑图节点级选中的样式写入分流（分支色走 TreeService 落节点，
  // 不经 widget 级 update——MIND_MAP schema 对树内字段是放行的 z.unknown）
  if (ids.length === 1 && typeof patch.lineColor === 'string' && patch.lineColor.startsWith('#')) {
    const vm = ctx.vmEngine?.getVmById(ids[0]!);
    if (vm?.type === 'MIND_MAP' && ctx.treeService?.isNodeFocused()) {
      ctx.treeService.setFocusedNodeColor(patch.lineColor);
      return;
    }
  }
  // 排版档位数值化（option id 是数字串，schema 期望 number——同 lineColor
  // hex 特判的 per-字段分流先例；per-字段条件覆写，不给 patch 引入不存在的键）
  const patch2: Record<string, unknown> = { ...patch };
  if (patch.fontSize !== undefined) patch2.fontSize = Number(patch.fontSize);
  if (patch.strokeWidth !== undefined) patch2.strokeWidth = Number(patch.strokeWidth);
  if (patch.lineHeight !== undefined) patch2.lineHeight = Number(patch.lineHeight);
  if (patch.borderWidth !== undefined) patch2.borderWidth = Number(patch.borderWidth);
  // SHAPE 填充 popover 分流（specs/flowchart-closeout §4.2）：「无填充」选项 id
  // 复用 color 字段传 'none'——core 侧转写 fill:'none'（不落非法 color）；
  // 显式选色板色 = 要填充，fill 复位 'solid'。LINE/PEN/STICKY 的 color 是
  // 纯 hex 色板（无 none 项），fill 键经各自 schema strip，不受影响
  if (patch.color === 'none') {
    delete patch2.color;
    patch2.fill = 'none';
  } else if (typeof patch.color === 'string' && patch.color.startsWith('#')) {
    patch2.fill = 'solid';
  }
  // 切回折线 = 自动路由接管：重路由并入本事务（切型 + 重路由一步撤销）。不交给
  // vm 的 lineType diff——那是微任务相，本事务已关、stopCapturing 已过，写入会
  // 裂成独立撤销项；undo·redo 落回 ELBOWED 同样带 lineType diff，在那里重路由
  // 会覆盖恢复出来的历史路由（含 pinned）并清空重做栈。线型实际有变才触发
  // （重复点选当前项幂等）；rerouteLine 自带非线/自由线早退
  const toElbowed = patch2.lineType === 'ELBOWED';
  ctx.engine!.transact(() => {
    for (const id of ids) {
      const model = ctx.engine?.getModelById(id);
      const wasElbowed =
        toElbowed && (model?.toJSON() as { lineType?: string } | undefined)?.lineType === 'ELBOWED';
      model?.update(patch2 as never);
      if (toElbowed && !wasElbowed) ctx.lineService?.rerouteLine(id);
    }
  });
  if (
    patch2.fontSize !== undefined ||
    patch2.lineHeight !== undefined ||
    patch2.shapeType !== undefined
  ) {
    // 高度重排：autoHeight 只在编辑提交路径触发，外部改字号/行高/切图形类型
    // （内接几何变化，docs/17 §6 autoHeight）需显式重测——在主事务后、
    // stopCapturing 前，reflowHeight 的事务并入同一撤销项
    for (const id of ids) {
      ctx.textService?.reflowHeight(id);
    }
  }
  ctx.history?.stopCapturing();
}
