import type { IDataEngineService, IVmEngineService } from '../../types';
import type { ShapeType } from '../../types';
import { createCanvasMeasurer, measureDoc } from '../../platform/textEngine/measure';
import { htmlToDoc } from '../../platform/textEngine/htmlDoc';
import { htmlToPlainText } from '../../platform/textEngine/plainText';
import { insetRectOf, shapeHeightFromTextHeight } from '../shape/shapeVm';
import type { ITextEditStyle } from './textEditStyle';

/** 编辑落库依赖（textService.commitEdit 的方法体外移——纯函数，无状态） */
export interface ITextCommitDeps {
  readonly engine: IDataEngineService;
  readonly vmEngine: IVmEngineService;
}

/** 编辑落库 + 高度自适应（docs/07 §7 autoHeight——自原 flushWrite 迁入，
 *  34ms 节流已归 EditingService；测高随 per-实例字号与 marks 宽度）。
 *  SHAPE 走 autoHeight 分流（docs/17 §6 四点拍板，2026-10-10） */
export function commitTextEdit(
  deps: ITextCommitDeps,
  id: string,
  html: string,
  st: ITextEditStyle,
): void {
  const model = deps.engine.getModelById(id);
  const vm = deps.vmEngine.getVmById(id);
  if (!model || !vm) return;
  if (vm.type !== 'SHAPE') {
    const m = measureDoc(
      {
        // marks 渲染（docs/17 §4 刀 3）：测高与渲染同源输入（bold 参与宽度）
        paragraphs: htmlToDoc(html),
        // 数据矩形（Batch 1 · 1.7）：测高输入与渲染折行输入（next.width）同源——
        // getBounds 是旋转世界 AABB，θ≠0 时宽高失真且 SHAPE「只撑不缩」地板
        // 会正反馈膨胀（×|cosθ|+|sinθ|）
        maxWidth: Math.max(vm.getLocalRect().width - st.padding * 2, 1),
        style: {
          fontFamily: st.fontFamily,
          fontSize: st.fontSize,
          lineHeight: st.lineHeight,
          color: st.color,
        },
      },
      { measurer: createCanvasMeasurer() },
    );
    const newHeight = m.height + st.padding * 2;
    model.update({ text: html } as never);
    const b = vm.getLocalRect(); // 1.7：同源数据矩形（非世界 AABB）
    if (Math.abs(b.height - newHeight) > 0.5) {
      model.updateRect({ height: newHeight });
    }
    return;
  }
  // SHAPE（docs/17 §6 autoHeight）：空文本归一空串（与 LINE 同语义）；关着的
  // （autoHeight === false，手动缩放解除）或**空文本**只落 text——空段一行
  // 的公式下限（rect 54）会把矮形状无文字也撑高（实测：36 高短形在「单击
  // 已选中进编辑 → 拖角 blur flush」路径被撑到 54 且覆盖 resize 结果）。
  // 开着的测高走与渲染同源的 insetRectOf maxWidth（只依赖 w，无循环依赖）→
  // 撑高公式 → **只撑不缩**（max 公式值/当前高——删字不缩形，想缩手动拖、
  // 拖完自动解除）；text+height 显式包一个事务（TEXT 先例是背靠背两事务靠
  // captureTimeout 合并，远端污染事务会截断合并窗裂成两个 undo 步——SHAPE 不重蹈）
  const data = model.toJSON() as unknown as { shapeType?: ShapeType; autoHeight?: boolean };
  const text = htmlToPlainText(html).trim() ? html : '';
  if (!(data.autoHeight ?? true) || !text) {
    model.update({ text } as never);
    return;
  }
  const shapeType = data.shapeType ?? 'rect';
  const b = vm.getLocalRect(); // 1.7：SHAPE 测高/地板同源数据矩形（非世界 AABB）
  const m = measureDoc(
    {
      paragraphs: htmlToDoc(text),
      maxWidth: Math.max(insetRectOf(shapeType, b.width, b.height).width, 1),
      style: {
        fontFamily: st.fontFamily,
        fontSize: st.fontSize,
        lineHeight: st.lineHeight,
        color: st.color,
      },
    },
    { measurer: createCanvasMeasurer() },
  );
  const targetH = Math.max(shapeHeightFromTextHeight(shapeType, m.height), b.height);
  deps.engine.transact(() => {
    model.update({ text } as never);
    if (targetH - b.height > 0.5) {
      model.updateRect({ height: targetH });
    }
  });
}
