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
  // 4.9：脑图节点级选中的样式写入分流（分支色走 MindService 落节点，
  // 不经 widget 级 update——MIND_MAP schema 对树内字段是放行的 z.unknown）
  if (ids.length === 1 && typeof patch.lineColor === 'string' && patch.lineColor.startsWith('#')) {
    const vm = ctx.vmEngine?.getVmById(ids[0]!);
    if (vm?.type === 'MIND_MAP' && ctx.mindService?.isNodeFocused()) {
      ctx.mindService.setFocusedNodeColor(patch.lineColor);
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
  ctx.engine!.transact(() => {
    for (const id of ids) {
      ctx.engine?.getModelById(id)?.update(patch2 as never);
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
