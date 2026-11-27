import {
  AlignCenter,
  Triangle,
  Database,
  Download,
  Frame,
  File,
  Folder,
  Hexagon,
  ImageDown,
  MoreHorizontal,
  Upload,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  ChevronDown,
  Circle,
  ClipboardPaste,
  Copy,
  Diamond,
  Eraser,
  Group,
  Hand,
  Link as LinkIcon,
  Minus,
  Moon,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Scan,
  Scissors,
  SendToBack,
  Squircle,
  SquareDashed,
  Spline,
  Square,
  StickyNote,
  Sun,
  Trash2,
  Type,
  Ungroup,
  Undo2,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  Network,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

/**
 * 图标统一封装（docs/12 §4）：项目内不允许直接 import lucide-react 组件——
 * - 语义名注册表收敛图标选型（换图标集只改此文件）
 * - 尺寸/线宽/无障碍语义一处约定（工具图标一律装饰性，aria-hidden）
 * - lucide 无贴切对应的（线型/箭头/边框类，2026-10-03 ActionBar v2）用
 *   svgIcon 内联 SVG 自绘——造型与 core lineMath 绘制语义一致
 */

/** 语义图标名（按用途命名，不按 lucide 原名——解耦图标库） */
export type IconName =
  | 'select' // 选择工具
  | 'hand' // 抓手
  | 'shape' // 矩形
  | 'eraser' // 橡皮（lucide Eraser，2026-10-08 eraser 批）
  | 'text' // 文本
  | 'connector' // 连接线
  | 'pen' // 画笔
  | 'sticky' // 便签
  | 'mindmap'
  | 'collapse'
  | 'expand'
  | 'tree'
  | 'orgchart' // 脑图
  | 'frame' // 容器
  | 'sequence' // 时序图
  | 'sequence-message-sync' // 同步消息（实心箭头）
  | 'sequence-message-async' // 异步消息（开放箭头）
  | 'sequence-message-return' // 返回消息（虚线 + 开放箭头）
  | 'undo'
  | 'redo'
  | 'trash'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'bring-front'
  | 'send-back'
  | 'select-all'
  | 'sun'
  | 'moon'
  | 'add' // 加号（MindAddButtons 等创建入口）
  | 'remove' // 减号（MindAddButtons 删除入口）
  // ActionBar v2（2026-10-03，schema option.icon 语义名）
  | 'line-straight'
  | 'line-elbow'
  | 'line-curve'
  | 'arrow-none'
  | 'arrow-open'
  | 'arrow-solid'
  | 'arrow-diamond'
  | 'border-solid'
  | 'border-dashed'
  | 'border-none'
  // shapeType 切换（2026-10-08，图形类型四态——UI 解锁 ellipse/diamond）
  | 'shape-rect'
  | 'shape-round-rect'
  | 'shape-ellipse'
  | 'shape-diamond'
  | 'symbol'
  | 'symbol-net-server'
  | 'symbol-net-router'
  | 'symbol-net-switch'
  | 'symbol-net-firewall'
  | 'symbol-net-cloud'
  | 'symbol-net-load-balancer'
  | 'symbol-net-internet'
  | 'symbol-net-user'
  | 'symbol-net-database'
  | 'symbol-net-storage'
  | 'symbol-data-queue'
  | 'symbol-doc-file'
  | 'symbol-doc-folder'
  | 'shape-triangle-up' // 12 型扩展（docs/04 §8.2，2026-10-11）
  | 'shape-triangle-down'
  | 'shape-parallelogram-right'
  | 'shape-parallelogram-left'
  | 'shape-eng-database'
  | 'shape-eng-queue'
  | 'shape-eng-file'
  | 'shape-eng-folder'
  | 'shape-stadium'
  | 'shape-document'
  | 'shape-hexagon'
  | 'shape-predefined-process'
  | 'shape-trapezoid-up'
  | 'shape-trapezoid-down'
  | 'shape-delay'
  | 'shape-off-page'
  | 'line-width-1'
  | 'line-width-2'
  | 'line-width-4'
  | 'line-width-8'
  | 'pen-width-2'
  | 'pen-width-4'
  | 'pen-width-8'
  | 'pen-width-12'
  | 'image-down'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  // 橡皮大小五档（docs/04 §2 工具默认参数节，2026-10-11——lucide 无档位序列，自绘圆点梯度）
  | 'eraser-size-4'
  | 'eraser-size-8'
  | 'eraser-size-16'
  | 'eraser-size-24'
  | 'eraser-size-40'
  // 多选几何命令八键（docs/05 §7，2026-10）——obj- 前缀区别于文字对齐三态
  | 'obj-align-left'
  | 'obj-align-hcenter'
  | 'obj-align-right'
  | 'obj-align-top'
  | 'obj-align-vcenter'
  | 'obj-align-bottom'
  | 'obj-dist-h'
  | 'obj-dist-v'
  // 编组/解组（docs/18，2026-10-17——lucide Group/Ungroup）
  | 'group'
  | 'ungroup'
  | 'link'
  // 项目菜单（docs/20 §9.1——lucide Download/Upload/MoreHorizontal）
  | 'download'
  | 'upload'
  | 'more'
  | 'chevron-down';

/** 自绘 SVG 图标组件（与 LucideIcon 同 props 面，aria/focusable 内部固定） */
type SvgIconCmp = (props: {
  size?: number;
  strokeWidth?: number;
  className?: string;
  'aria-hidden'?: boolean;
  focusable?: boolean;
}) => ReactElement;

/** 内联 SVG 工厂：24 viewBox / currentColor / round cap-join，与 lucide 视觉同源 */
const svgIcon = (draw: ReactNode): SvgIconCmp =>
  function SvgIcon({ size = 18, strokeWidth = 2, className }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden
        focusable={false}
      >
        {draw}
      </svg>
    );
  };

const ICONS: Record<IconName, LucideIcon | SvgIconCmp> = {
  select: MousePointer2,
  hand: Hand,
  shape: Square,
  text: Type,
  connector: Spline,
  pen: Pencil,
  eraser: Eraser,
  sticky: StickyNote,
  mindmap: Waypoints,
  collapse: ChevronsDownUp,
  expand: ChevronsUpDown,
  tree: ListTree,
  frame: Frame,
  // 时序图（specs/sequence-diagram §8.1）：两个参与者头框 + 竖直虚线轴 + 一条
  // 消息箭头——静态示意，与画布生命线（头框 + 虚线轴）同语义
  sequence: svgIcon(
    <>
      <rect x="3.5" y="2.5" width="7" height="5" rx="1" />
      <rect x="13.5" y="2.5" width="7" height="5" rx="1" />
      <line x1="7" y1="7.5" x2="7" y2="21.5" strokeDasharray="2.5 2.5" />
      <line x1="17" y1="7.5" x2="17" y2="21.5" strokeDasharray="2.5 2.5" />
      <line x1="8" y1="13" x2="15.5" y2="13" />
      <path d="M13 10.8 L15.8 13 L13 15.2" />
    </>,
  ),
  // 时序图消息三类（specs/sequence-diagram §4.3）：两条虚线轴 + 一条消息，图标区分
  // 箭头形态——实心 / 开放 / 虚线（与落库的 endArrow / dashed 预设同语义）
  'sequence-message-sync': svgIcon(
    <>
      <line x1="4" y1="3" x2="4" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="20" y1="3" x2="20" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="5.5" y1="12" x2="16" y2="12" />
      <path d="M15.5 9.4 L19.5 12 L15.5 14.6 Z" fill="currentColor" />
    </>,
  ),
  'sequence-message-async': svgIcon(
    <>
      <line x1="4" y1="3" x2="4" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="20" y1="3" x2="20" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="5.5" y1="12" x2="19" y2="12" />
      <path d="M15.8 8.8 L19.2 12 L15.8 15.2" />
    </>,
  ),
  'sequence-message-return': svgIcon(
    <>
      <line x1="4" y1="3" x2="4" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="20" y1="3" x2="20" y2="21" strokeDasharray="2.5 2.5" />
      <line x1="5.5" y1="12" x2="19" y2="12" strokeDasharray="3 2.4" />
      <path d="M15.8 8.8 L19.2 12 L15.8 15.2" />
    </>,
  ),
  orgchart: Network,
  undo: Undo2,
  redo: Redo2,
  trash: Trash2,
  'zoom-in': Plus,
  'zoom-out': Minus,
  'zoom-fit': Scan,
  copy: Copy,
  cut: Scissors,
  paste: ClipboardPaste,
  'bring-front': BringToFront,
  'send-back': SendToBack,
  'select-all': SquareDashed,
  sun: Sun,
  moon: Moon,
  add: Plus,
  remove: Minus,
  'chevron-down': ChevronDown,
  'line-straight': svgIcon(<line x1="4" y1="12" x2="20" y2="12" />),
  'line-elbow': svgIcon(<path d="M4 18 V9 a2 2 0 0 1 2 -2 H20" />),
  'line-curve': svgIcon(<path d="M4 18 C 10 18, 14 6, 20 6" />),
  // 无箭头 = 线端空心圆（spinth 端点圆语义，区别于纯直线）
  'arrow-none': svgIcon(
    <>
      <line x1="4" y1="12" x2="16" y2="12" />
      <circle cx="19" cy="12" r="2.5" />
    </>,
  ),
  'arrow-open': svgIcon(
    <>
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M14 6 L20 12 L14 18" />
    </>,
  ),
  'arrow-solid': svgIcon(
    <>
      <line x1="4" y1="12" x2="13" y2="12" />
      <path d="M20 12 L12 7 V17 Z" fill="currentColor" stroke="none" />
    </>,
  ),
  'arrow-diamond': svgIcon(
    <>
      <line x1="3" y1="12" x2="11" y2="12" />
      <path d="M17 8 L21.5 12 L17 16 L12.5 12 Z" fill="currentColor" stroke="none" />
    </>,
  ),
  'border-solid': svgIcon(<rect x="5" y="5" width="14" height="14" rx="2.5" />),
  'border-dashed': svgIcon(
    <rect x="5" y="5" width="14" height="14" rx="2.5" strokeDasharray="3 3" />,
  ),
  'shape-rect': Square,
  'shape-round-rect': Squircle,
  'shape-ellipse': Circle,
  'shape-diamond': Diamond,
  'shape-triangle-up': Triangle,
  'shape-triangle-down': svgIcon(<path d="M5 6 H19 L12 19 Z" />),
  'shape-parallelogram-right': svgIcon(<path d="M8 6 H22 L16 18 H2 Z" />),
  'shape-parallelogram-left': svgIcon(<path d="M2 6 H16 L22 18 H8 Z" />),
  'shape-eng-database': Database,
  'shape-eng-queue': svgIcon(
    <>
      <path d="M12 5 C17 5 20 8 20 12 C20 16 17 19 12 19 Z" />
      <path d="M12 5 C7 5 4 8 4 12 C4 16 7 19 12 19 Z" fill="none" />
    </>,
  ),
  'shape-eng-file': File,
  'shape-eng-folder': Folder,
  'shape-stadium': svgIcon(<rect x="3" y="7" width="18" height="10" rx="5" />),
  // 符号（specs/symbol-widget §6.4/§6.5）：工具入口「图标 + 标签线」示意；
  // 13 个种类简笔与画布 48 视方资产同语义（DOM 侧不引 glyph SVG 字符串）
  symbol: svgIcon(
    <>
      <circle cx="12" cy="8.5" r="4.5" />
      <line x1="6.5" y1="19" x2="17.5" y2="19" />
    </>,
  ),
  'symbol-net-server': svgIcon(
    <>
      <rect x="7" y="4" width="10" height="16" />
      <line x1="9.5" y1="8" x2="14.5" y2="8" />
      <line x1="9.5" y1="12" x2="14.5" y2="12" />
      <line x1="9.5" y1="16" x2="14.5" y2="16" />
    </>,
  ),
  'symbol-net-router': svgIcon(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.6 6.8L12 4.6L14.4 6.8" />
      <path d="M9.6 17.2L12 19.4L14.4 17.2" />
      <path d="M6.8 9.6L4.6 12L6.8 14.4" />
      <path d="M17.2 9.6L19.4 12L17.2 14.4" />
    </>,
  ),
  'symbol-net-switch': svgIcon(
    <>
      <rect x="3.5" y="8.5" width="17" height="7" />
      <path d="M7.5 10.5L10 12L7.5 13.5" />
      <path d="M13.5 10.5L16 12L13.5 13.5" />
    </>,
  ),
  'symbol-net-firewall': svgIcon(
    <>
      <rect x="4" y="5.5" width="16" height="13" />
      <line x1="4" y1="9.8" x2="20" y2="9.8" />
      <line x1="4" y1="14.2" x2="20" y2="14.2" />
      <line x1="12" y1="5.5" x2="12" y2="9.8" />
      <line x1="8" y1="9.8" x2="8" y2="14.2" />
      <line x1="16" y1="9.8" x2="16" y2="14.2" />
      <line x1="12" y1="14.2" x2="12" y2="18.5" />
    </>,
  ),
  'symbol-net-cloud': svgIcon(
    <path d="M17.8 18H6.9a4.2 4.2 0 1 1 .8-8.3A5.6 5.6 0 0 1 18 9a4.5 4.5 0 0 1-.2 9Z" />,
  ),
  'symbol-net-load-balancer': svgIcon(
    <>
      <rect x="5" y="10" width="14" height="4.5" />
      <path d="M12 3.5V8.4M10.3 7L12 8.9L13.7 7" />
      <path d="M7 14.5V18.4M5.3 16.7L7 18.6L8.7 16.7" />
      <path d="M12 14.5V18.4M10.3 16.7L12 18.6L13.7 16.7" />
      <path d="M17 14.5V18.4M15.3 16.7L17 18.6L18.7 16.7" />
    </>,
  ),
  'symbol-net-internet': svgIcon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5C9.4 5.8 8 8.6 8 12s1.4 6.2 4 8.5c2.6-2.3 4-5.1 4-8.5s-1.4-6.2-4-8.5Z" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
    </>,
  ),
  'symbol-net-user': svgIcon(
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M5 19.5a7 7 0 0 1 14 0" />
    </>,
  ),
  'symbol-net-database': svgIcon(
    <>
      <path d="M5 6.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5" />
      <path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>,
  ),
  'symbol-net-storage': svgIcon(
    <>
      <rect x="4.5" y="5" width="15" height="3.6" />
      <rect x="4.5" y="10.2" width="15" height="3.6" />
      <rect x="4.5" y="15.4" width="15" height="3.6" />
    </>,
  ),
  'symbol-data-queue': svgIcon(
    <>
      <path d="M6 12a2.6 4.6 0 1 0 5.2 0a2.6 4.6 0 1 0-5.2 0" />
      <line x1="8.6" y1="7.4" x2="17" y2="7.4" />
      <line x1="8.6" y1="16.6" x2="17" y2="16.6" />
      <path d="M17 7.4A2.6 4.6 0 0 1 17 16.6" />
    </>,
  ),
  'symbol-doc-file': svgIcon(
    <>
      <path d="M6 3.5h8.5L18.5 7.5v13H6Z" />
      <path d="M14.5 3.5v4h4" />
    </>,
  ),
  'symbol-doc-folder': svgIcon(<path d="M3.5 6.5h6l2 2.5h9v9.5h-17Z" />),
  'shape-document': svgIcon(<path d="M5 5 H19 V14 Q16.5 17.5 12 16.5 Q7.5 15.5 5 17 Z" />),
  'shape-hexagon': Hexagon,
  'shape-predefined-process': svgIcon(
    <>
      <rect x="3.5" y="5" width="17" height="14" />
      <path d="M7.5 5 V19 M16.5 5 V19" />
    </>,
  ),
  'shape-trapezoid-up': svgIcon(<path d="M8 6 H16 L20 18 H4 Z" />),
  'shape-trapezoid-down': svgIcon(<path d="M4 6 H20 L16 18 H8 Z" />),
  'shape-delay': svgIcon(<path d="M5 6 V18 H12 A6 6 0 0 0 12 6 Z" />),
  'shape-off-page': svgIcon(<path d="M5 6 H19 V14 L12 19 L5 14 Z" />),
  // 线宽四档（粗细横线示意，stroke-width 与档位值近似映射）
  'line-width-1': svgIcon(<path d="M4 12 H20" strokeWidth={1} />),
  'line-width-2': svgIcon(<path d="M4 12 H20" strokeWidth={2} />),
  'line-width-4': svgIcon(<path d="M4 12 H20" strokeWidth={3.5} />),
  'line-width-8': svgIcon(<path d="M4 12 H20" strokeWidth={5.5} />),
  // 笔宽四档（圆点大小示意）
  'pen-width-2': svgIcon(<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />),
  'pen-width-4': svgIcon(<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />),
  'pen-width-8': svgIcon(<circle cx="12" cy="12" r="4.8" fill="currentColor" stroke="none" />),
  'pen-width-12': svgIcon(<circle cx="12" cy="12" r="6.4" fill="currentColor" stroke="none" />),
  'image-down': ImageDown,
  // 无边框 = 点线弱化框（视觉上「近乎没有」）
  'border-none': svgIcon(
    <rect x="5" y="5" width="14" height="14" rx="2.5" strokeDasharray="0.5 4" />,
  ),
  'align-left': AlignLeft,
  'align-center': AlignCenter,
  'align-right': AlignRight,
  'eraser-size-4': svgIcon(<circle cx="12" cy="12" r="2" />),
  'eraser-size-8': svgIcon(<circle cx="12" cy="12" r="3" />),
  'eraser-size-16': svgIcon(<circle cx="12" cy="12" r="4.5" />),
  'eraser-size-24': svgIcon(<circle cx="12" cy="12" r="6" />),
  'eraser-size-40': svgIcon(<circle cx="12" cy="12" r="8" />),
  'obj-align-left': AlignStartVertical,
  'obj-align-hcenter': AlignCenterVertical,
  'obj-align-right': AlignEndVertical,
  'obj-align-top': AlignStartHorizontal,
  'obj-align-vcenter': AlignCenterHorizontal,
  'obj-align-bottom': AlignEndHorizontal,
  'obj-dist-h': AlignHorizontalDistributeCenter,
  'obj-dist-v': AlignVerticalDistributeCenter,
  group: Group,
  link: LinkIcon,
  download: Download,
  upload: Upload,
  more: MoreHorizontal,
  ungroup: Ungroup,
};

export interface IconProps {
  name: IconName;
  /** 逻辑像素尺寸（默认 18，随字号缩放的 UI 用 16/20） */
  size?: number;
  /** 描边宽度（默认 2；小图标建议 1.75 保持通透） */
  strokeWidth?: number;
  className?: string;
}

/** 语义名缺失时的占位（schema icon 配错不破布局——label 仍在 tooltip 兜底） */
const FALLBACK_ICON: SvgIconCmp = svgIcon(<circle cx="12" cy="12" r="3" />);

export function Icon({ name, size = 18, strokeWidth = 2, className }: IconProps) {
  const Cmp = ICONS[name] ?? FALLBACK_ICON;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden
      focusable={false}
    />
  );
}
