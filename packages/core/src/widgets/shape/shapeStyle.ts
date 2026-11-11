import { darkenHex, hexToNum } from '../../common/color';

/**
 * 形状样式解析单源（specs/flowchart-closeout §4.2）：borderColor/borderWidth/fill
 * 三字段 optional 无 default——老文档零迁移，缺省语义与解析前逐字节一致
 * （边框色 = darkenHex(color, 0.25) 派生、宽恒 1、恒填充）。
 * shapeVm.render 是唯一消费方；「纯平移快速路径」守卫键必须覆盖全部输出键
 * （漏加会让改边框色/宽/填充态不重画）。
 */

/** 缺省描边宽（渲染视觉规格——历史恒 1，流程图批暴露档位 1/2/4） */
export const SHAPE_DEFAULT_STROKE_WIDTH = 1;

export interface IResolvedShapeStyle {
  /** 填充态：false = 只描边不填充（无填充标注框） */
  fill: boolean;
  /** 填充色（pixi 数字色） */
  fillColor: number;
  /** 描边色（pixi 数字色；borderColor 缺失 = 填充色派生） */
  strokeColor: number;
  /** 描边宽 */
  strokeWidth: number;
  /** 虚线（borderStyle = dashed） */
  dashed: boolean;
}

export function resolveShapeStyle(data: {
  color: string;
  borderStyle: string;
  borderColor?: string;
  borderWidth?: number;
  fill?: 'solid' | 'none';
}): IResolvedShapeStyle {
  return {
    fill: data.fill !== 'none',
    fillColor: hexToNum(data.color),
    // borderColor 一旦写入即固定——「自动（随填充）」不提供还原选项（§4.2 拍板：
    // 避免「删除字段」写路径的语义未定义）
    strokeColor: data.borderColor ? hexToNum(data.borderColor) : darkenHex(data.color, 0.25),
    strokeWidth: data.borderWidth ?? SHAPE_DEFAULT_STROKE_WIDTH,
    dashed: data.borderStyle === 'dashed',
  };
}
