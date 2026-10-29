import {
  TEXT_FONT,
  TEXT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH,
  TEXT_PADDING,
} from './textVm';
import { defaultTextColor } from '../../platform/textEngine/theme';
import {
  STICKY_FONT_SIZE,
  STICKY_LINE_HEIGHT,
  STICKY_PADDING,
  STICKY_TEXT_COLOR,
} from '../sticky/stickyVm';
import {
  SHAPE_TEXT_FONT_SIZE,
  SHAPE_LINE_HEIGHT,
  SHAPE_TEXT_COLOR,
  SHAPE_TEXT_PADDING,
} from '../shape/shapeVm';

/** 编辑样式（textService 编辑会话的排版事实——TEXT/STICKY/SHAPE 三型分流） */
export interface ITextEditStyle {
  padding: number;
  minWidth: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  fontFamily: string;
  /** 段落对齐（编辑器 textAlign 跟随渲染：TEXT/STICKY 默认 left、SHAPE center） */
  align: 'left' | 'center' | 'right';
}

/** 编辑样式按控件类型分流 + per-实例排版 override（docs/17 §4 打磨批 A：
 *  STICKY 与 TEXT 共用编辑会话，内边距分流量；fontSize/textColor/lineHeight 读
 *  model 可选字段 → 控件常量默认——与渲染 Vm 的 resolveTextStyle 同源语义；
 *  SHAPE 分支（docs/17 §6）：图形常量 + align 默认 center（与渲染对称） */
export function editStyleOf(
  type: string,
  data: {
    fontSize?: number;
    textColor?: string;
    lineHeight?: number;
    align?: 'left' | 'center' | 'right';
  },
): ITextEditStyle {
  if (type === 'STICKY') {
    return {
      padding: STICKY_PADDING,
      minWidth: 60,
      fontFamily: 'sans-serif',
      align: data.align ?? 'left',
      fontSize: data.fontSize ?? STICKY_FONT_SIZE,
      lineHeight: data.lineHeight ?? STICKY_LINE_HEIGHT,
      color: data.textColor ?? STICKY_TEXT_COLOR,
    };
  }
  if (type === 'SHAPE') {
    return {
      padding: SHAPE_TEXT_PADDING,
      minWidth: TEXT_MIN_WIDTH,
      fontFamily: 'sans-serif',
      align: data.align ?? 'center',
      fontSize: data.fontSize ?? SHAPE_TEXT_FONT_SIZE,
      lineHeight: data.lineHeight ?? SHAPE_LINE_HEIGHT,
      color: data.textColor ?? SHAPE_TEXT_COLOR,
    };
  }
  return {
    padding: TEXT_PADDING,
    minWidth: TEXT_MIN_WIDTH,
    fontFamily: TEXT_FONT,
    align: data.align ?? 'left',
    fontSize: data.fontSize ?? TEXT_FONT_SIZE,
    lineHeight: data.lineHeight ?? TEXT_LINE_HEIGHT,
    color: data.textColor ?? defaultTextColor(),
  };
}
