/**
 * ActionBar 选项常量与排版项工厂（specs/api-surface §3.5）——自 app.ts 迁出
 * 的纯数据层：色板/档位/选项表 + typoItems 工厂。boardActionBar.ts 只留分支
 * 逻辑，本文件不放分支。选项与工具坞二级菜单同源（单源常量见各 import 来源）。
 */
import type { IActionBarItem, IActionBarOption } from './types';
import { FONT_SIZE_OPTIONS } from './widgets/text/textVm';
import { PEN_COLOR_PALETTE } from './widgets/pen/penService';
import { defaultTextColorForFill } from './widgets/shape/shapeVm';

/** ActionBar 形状色板（视觉规格：与各控件 Service 默认色一致的语义色；流程图批
 *  追加 #ffffff/#000000——「白底黑框」可达，specs/flowchart-closeout §4.2） */
export const SHAPE_PALETTE = [
  '#e8f0fb',
  '#d1fae5',
  '#fde8e8',
  '#fef3c7',
  '#ede9fe',
  '#f1f5f9',
  '#ffffff',
  '#000000',
];
/** 形状边框色板（与线色板同源风格——「黑框 + 灰线」的经典流程图观感） */
export const SHAPE_BORDER_PALETTE = [
  '#1f2937',
  '#000000',
  '#ffffff',
  '#2563eb',
  '#dc2626',
  '#059669',
] as const;
/** 形状描边宽档位（与连线线宽档位不必相等：形状 1 ↔ 线 2 是既有观感基线） */
export const SHAPE_BORDER_WIDTH_OPTIONS: IActionBarOption[] = [1, 2, 4].map((n) => ({
  id: String(n),
  label: `${n} px`,
  text: String(n),
}));
/** 连线/画笔共用色板（与 PEN_COLOR_PALETTE 同源——2026-10-11 提名导出消内联双份） */
export const LINE_PALETTE: readonly string[] = PEN_COLOR_PALETTE;
/** 文字色板（specs/flowchart-closeout §16 对比度护栏返工）：深色六色（与线色
 *  板同源）+ 白/浅灰——黑填充（#000000）上默认字色自适应为白后，深色字仍
 *  可显式选回、浅底上浅色字也可达；与 LINE_PALETTE 分源（线色板保持全深色：
 *  白线在白画布不可见，文字底则是形状填充色） */
export const TEXT_COLOR_PALETTE: readonly string[] = [...PEN_COLOR_PALETTE, '#ffffff', '#f9fafb'];

/** 连线箭头选项（起点/终点两个字段共用；icon = @spinth/react Icon 语义名） */
export const ARROW_BAR_OPTIONS: IActionBarOption[] = [
  { id: 'none', label: '无箭头', icon: 'arrow-none' },
  { id: 'arrow', label: '开箭头', icon: 'arrow-open' },
  { id: 'solid', label: '实心箭头', icon: 'arrow-solid' },
  { id: 'diamond', label: '菱形箭头', icon: 'arrow-diamond' },
];

/** 行高档位（lineHeight per-实例批：倍数语义；TEXT/STICKY 专属，LINE 不暴露）。
 *  含各类型默认值（TEXT/SHAPE 1.5、STICKY 1.45）——默认档可显可选可切回；
 *  value 匹配不到 option 时触发钮会落 FALLBACK 圆点（2026-10-16 用户实测揪出） */
export const LINE_HEIGHT_OPTIONS: IActionBarOption[] = [1.2, 1.4, 1.45, 1.5, 1.6, 2.0].map((n) => ({
  id: String(n),
  label: `${n} 倍行高`,
  text: String(n),
}));

/** 文字对齐三态（TEXT/STICKY） */
export const ALIGN_OPTIONS: IActionBarOption[] = [
  { id: 'left', label: '左对齐', icon: 'align-left' },
  { id: 'center', label: '居中', icon: 'align-center' },
  { id: 'right', label: '右对齐', icon: 'align-right' },
];

/** 排版项工厂（value 显式带控件常量默认——触发钮显示当前档位/态）；
 *  行高与对齐同为 TEXT/STICKY 专属（LINE 单行居多不暴露，见批 3 同源化注记） */
export const typoItems = (
  data: Record<string, unknown>,
  def: { fontSize: number; align: 'left' | 'center' | 'right'; lineHeight: number },
  withAlign: boolean,
  withLineHeight: boolean,
): IActionBarItem[] => {
  const items: IActionBarItem[] = [
    {
      id: 'fontSize',
      kind: 'popover',
      label: '字号',
      value: String(data.fontSize ?? def.fontSize),
      options: FONT_SIZE_OPTIONS,
    },
    {
      id: 'textColor',
      kind: 'popover',
      label: '文字颜色',
      value: String(data.textColor ?? ''),
      // 深填充下缺省字色自适应为浅色（shapeVm 单源）——触发钮如实显示该色点；
      // TEXT/STICKY 无 fill 概念，不注入
      ...(data.textColor === undefined && data.fill === 'solid' && typeof data.color === 'string'
        ? { displaySwatch: defaultTextColorForFill(data.fill, data.color) }
        : {}),
      options: TEXT_COLOR_PALETTE.map((hex) => ({ id: hex, label: hex, swatch: hex })),
    },
  ];
  if (withLineHeight) {
    items.push({
      id: 'lineHeight',
      kind: 'popover',
      label: '行高',
      value: String(data.lineHeight ?? def.lineHeight),
      options: LINE_HEIGHT_OPTIONS,
    });
  }
  if (withAlign) {
    items.push({
      id: 'align',
      kind: 'popover',
      label: '对齐',
      value: String(data.align ?? def.align),
      options: ALIGN_OPTIONS,
    });
  }
  return items;
};
