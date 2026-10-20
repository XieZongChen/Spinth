import { z } from 'zod';
import type { IRect } from '../common/geometry';
import type { IWidgetCapabilities } from './base';

/**
 * widget 数据 schema（zod 4）：schema 即类型唯一来源（ADR-2）。
 * 几何字段（x/y/width/height）不入 schema 主对象——存放在独立的 rect YKeyValue（docs/02 §2），
 * 经 DataProcessor.flatten 摊平后 IWidgetData = schema 推断 & IRect。
 */

export const ShapeTypeSchema = z.enum([
  'rect',
  'round-rect',
  'ellipse',
  'diamond',
  'triangle-up',
  'triangle-down',
  'parallelogram-right',
  'parallelogram-left',
  'eng-database',
  'eng-queue',
  'eng-file',
  'eng-folder',
  'stadium',
  'document',
  'hexagon',
  'predefined-process',
  'trapezoid-up',
  'trapezoid-down',
  'delay',
  'off-page',
]);
export const LineTypeSchema = z.enum(['STRAIGHT', 'ELBOWED', 'CURVE']);
export type LineType = z.infer<typeof LineTypeSchema>;
export type ShapeType = z.infer<typeof ShapeTypeSchema>;

/** 排版 override 字段（docs/17 §4 per-实例排版，打磨批 A）：optional 无 default——
 *  老文档零迁移；编辑器 profile 与渲染 Vm 同源消费「override → 控件常量默认」 */
export const TypoFields = {
  fontSize: z.number().optional(),
  /** 文字色（hex）。命名避开 LINE.color(线色)/STICKY.color(底色) 的既有语义 */
  textColor: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  /** 行高（倍数，1.5 = 1.5×fontSize）。LINE 不引用：编辑/渲染经 LINE_TEXT_LINE_HEIGHT
   *  常量同源（批 C 顺修），但连线文字单行居多不暴露 per-实例 */
  lineHeight: z.number().optional(),
} as const;

/** 旋转角（弧度，绕中心顺时针——pixi rotation 同向；docs/05 §8 旋转首版）：
 *  optional 无 default——老文档零迁移，消费侧 `?? 0`。仅 rect 四类引入
 *  （SHAPE/TEXT/STICKY/IMAGE）；LINE/PEN/MIND_MAP 首版不旋转 */
export const RotationField = {
  rotation: z.number().optional(),
} as const;

/** 编组标记（docs/18 成员 groupId 标记制，2026-10-17 四点拍板）：optional 无
 *  default——老文档零迁移，字段不存在即无组。仅自由六类引入（LINE 的锚定态
 *  排除是 groupOps 运行时判定）；MIND_MAP 不编组 */
export const GroupIdField = {
  groupId: z.string().optional(),
} as const;

export const ShapeSchema = z.object({
  id: z.string(),
  type: z.literal('SHAPE'),
  /** fractional indexing key，字典序即层级序 */
  zOrder: z.string(),
  shapeType: ShapeTypeSchema.default('rect'),
  color: z.string().default('#e8f0fb'),
  borderStyle: z.enum(['solid', 'dashed', 'none']).default('solid'),
  /** 图形内文字（HTML，同 TEXT/STICKY 语义；空串 = 无文字）。编辑经统一会话
   *  （docs/17 §6 SHAPE 扩展位，空文本 keep——形状不随文字删除/撑高） */
  text: z.string().default(''),
  /** 文字撑高形状（docs/17 §6 autoHeight，2026-10-10 四点拍板）：optional 无
   *  default——老文档零迁移，消费侧 `?? true`；手动拖角改宽/高即置 false */
  autoHeight: z.boolean().optional(),
  ...TypoFields,
  ...RotationField,
  ...GroupIdField,
});
export type ShapeData = z.infer<typeof ShapeSchema>;

export const TextSchema = z.object({
  id: z.string(),
  type: z.literal('TEXT'),
  zOrder: z.string(),
  /** 内容（TipTap HTML；测量时经 htmlToPlainText 转纯文本） */
  text: z.string().default('<p></p>'),
  ...TypoFields,
  ...RotationField,
  ...GroupIdField,
});
export type TextData = z.infer<typeof TextSchema>;

export const LineJoinSchema = z.enum(['top', 'right', 'bottom', 'left']);
export const LineSchema = z.object({
  id: z.string(),
  type: z.literal('LINE'),
  zOrder: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])),
  startNodeId: z.string().nullable().default(null),
  endNodeId: z.string().nullable().default(null),
  startJoin: LineJoinSchema.nullable().default(null),
  endJoin: LineJoinSchema.nullable().default(null),
  color: z.string().default('#4b5563'),
  /** 线宽。原名 width 与几何 RECT_KEYS 同名——create 被分流进 rect、update 被
   *  strip，线宽从未真正可写（数值巧合在工作，外部审查实锤）；改名后独立于几何 */
  strokeWidth: z.number().default(2),
  startArrow: z.enum(['none', 'arrow', 'solid', 'diamond']).default('none'),
  endArrow: z.enum(['none', 'arrow', 'solid', 'diamond']).default('arrow'),
  /** 线型：直线 / 正交折线 / 曲线（docs/08 §4；CURVE=三次贝塞尔 S 形，批次 4）。
   *  schema default 'STRAIGHT' 是 zod 兜底——**创建链实读 LineService 会话默认**
   *  （初始 ELBOWED，2026-09 拍板；工具坞二级菜单可切，docs/04 §2 会话态优先） */
  lineType: LineTypeSchema.default('STRAIGHT'),
  /** 用户手滑段锁定（批次 3 waypoint，docs/08 §10）：true = 拐点用户优先，
   *  锚定跟随只重贴两端锚点不重路由；端点重锚定/切 lineType 时复位 false */
  pinned: z.boolean().default(false),
  /** 虚线（docs/08 §1） */
  dashed: z.boolean().default(false),
  /** 线上文字（HTML，同 TEXT/Sticky 语义；空串 = 无） */
  text: z.string().default(''),
  /** 文字在路径上的位置比例 0~1（docs/08 §6） */
  textRatio: z.number().min(0).max(1).default(0.5),
  /** 线上文字排版 override（align 恒 center 与锚点语义绑定，不加字段） */
  fontSize: TypoFields.fontSize,
  textColor: TypoFields.textColor,
  ...GroupIdField,
});
export type LineData = z.infer<typeof LineSchema>;

export const PenSchema = z.object({
  id: z.string(),
  type: z.literal('PEN'),
  zOrder: z.string(),
  /** 世界坐标点集（无压感/时间戳，既有设计同款扁平结构） */
  points: z.array(z.tuple([z.number(), z.number()])),
  color: z.string().default('#1f2937'),
  strokeWidth: z.number().default(4), // 笔宽（线宽笔宽批 3→4：默认档入表 2/4/8/12；旧文档显式值不动）
  ...GroupIdField,
});
export type PenData = z.infer<typeof PenSchema>;

export const StickySchema = z.object({
  id: z.string(),
  type: z.literal('STICKY'),
  zOrder: z.string(),
  /** 便签底色（hex；历史版本曾为语义名 yellow/green/blue/pink，
   *  StickyVm 渲染时经 resolveStickyColor 兼容映射） */
  color: z.string().default('#fff3b0'),
  text: z.string().default(''),
  ...TypoFields,
  ...RotationField,
  ...GroupIdField,
});
export type StickyData = z.infer<typeof StickySchema>;

export const MindMapSchema = z.object({
  id: z.string(),
  type: z.literal('MIND_MAP'),
  zOrder: z.string(),
  /** 根节点 JSON 树（创建时输入；树结构由 MindNodeModel 构建期校验，schema 放行） */
  root: z.unknown().optional(),
});
export type MindMapData = z.infer<typeof MindMapSchema>;

export const ImageSchema = z.object({
  id: z.string(),
  type: z.literal('IMAGE'),
  zOrder: z.string(),
  /** 图片地址（http/data URL）。Phase 2 本地模式直接存源；大图会撑大 Yjs update
   *  帧——资产服务（blob 存储 + 引用）是 Phase 3+ 的方向，此处为已知性能债 */
  src: z.string().default(''),
  ...RotationField,
  ...GroupIdField,
});
export type ImageData = z.infer<typeof ImageSchema>;

/**
 * 控件判别联合 + 摊平几何（Batch 2 第三刀，2026-10-18 全量替换手写联合）：
 * 直接从 WIDGET_REGISTRY 派生——schema 即类型唯一来源（ADR-2）兑现，加类型
 * 只需注册表加一项（等价锁单测随之收口）；各 XxxData 别名保留（消费面广、
 * 语义同源——本就是 z.infer<各自 schema>）。加控件仍需 tokens.ts/app.ts
 * 登记 token（引擎零改动）。
 */
export type IWidgetData = z.infer<typeof WidgetDataUnion> & IRect;

// ---------------------------------------------------------------------------
// 类型注册表（Batch 2 · 类型注册表第一刀，2026-10-18）：type → { schema,
// capabilities } 单源——schema 域先收口（Model/Vm/Service 创建注册化与
// ActionBar/编辑/命中 per-type 注册化是后续刀，见 docs/16 §8 Batch 2 节）。
// IWidgetData 手写联合暂保留，由 widgetRegistry.test 的**编译期等价锁**防漂移
// （注册表派生联合 ≠ 手写联合即测红）；全量替换手写联合是第二刀。
// ----------------------------------------------------------------------------

/** 各类型能力位单源（docs/02 §4 八元，第五刀扩 editable/referenceable/
 *  erasable 三元）——此前七 Model 各自手写重复且无互查；语义注释：
 *  - rotatable：仅 rect 四类（SHAPE/TEXT/STICKY/IMAGE）；LINE/PEN/MIND_MAP 首版不旋转
 *  - groupable：自由六类；MIND_MAP 节点级选中走焦点体系（docs/18 §3.1）
 *  - resizable：LINE 无（端点手势管形状）；PEN 走 points 重映射非 root.scale
 *  - keepRatio：仅 IMAGE（图片默认锁定比例）
 *  - editable（第五刀）：统一编辑会话三类 TEXT/STICKY/SHAPE（docs/17——LINE
 *    线上文字走独立 textEditor 通道不在统一会话）
 *  - referenceable（第五刀）：参考线参照物四类（docs/06 §2）
 *  - erasable（第五刀）：分段橡皮仅对 PEN 笔迹 */
export const WIDGET_REGISTRY = {
  SHAPE: {
    schema: ShapeSchema,
    capabilities: {
      rotatable: true,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: true,
      referenceable: true,
      erasable: false,
    },
  },
  TEXT: {
    schema: TextSchema,
    capabilities: {
      rotatable: true,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: true,
      referenceable: true,
      erasable: false,
    },
  },
  LINE: {
    schema: LineSchema,
    // 类型级可组；锚定态由 groupOps 运行时判定（docs/18 §3.1 建组校验）
    capabilities: {
      rotatable: false,
      groupable: true,
      resizable: false,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: false,
      referenceable: false,
      erasable: false,
    },
  },
  PEN: {
    schema: PenSchema,
    capabilities: {
      rotatable: false,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: false,
      referenceable: false,
      erasable: true,
    },
  },
  STICKY: {
    schema: StickySchema,
    capabilities: {
      rotatable: true,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: true,
      referenceable: true,
      erasable: false,
    },
  },
  MIND_MAP: {
    schema: MindMapSchema,
    // 节点级选中走焦点体系，编组语义未定义（docs/18 §3.1）
    capabilities: {
      rotatable: false,
      groupable: false,
      resizable: false,
      movable: true,
      selectable: true,
      keepRatio: false,
      editable: false,
      referenceable: false,
      erasable: false,
    },
  },
  IMAGE: {
    schema: ImageSchema,
    capabilities: {
      rotatable: true,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: true,
      editable: false,
      referenceable: true,
      erasable: false,
    },
  },
} as const satisfies Record<string, { schema: z.ZodType; capabilities: IWidgetCapabilities }>;

/** 能力位派生类型集（第五刀）：`TYPES_WHERE('editable')` 等——消费方
 *  （编辑会话/参考线/橡皮）从注册表派生，散落硬编码 Set 全部收口单源 */
export function TYPES_WHERE(
  cap:
    | 'rotatable'
    | 'groupable'
    | 'resizable'
    | 'movable'
    | 'selectable'
    | 'keepRatio'
    | 'editable'
    | 'referenceable'
    | 'erasable',
): string[] {
  return Object.entries(WIDGET_REGISTRY)
    .filter(([, e]) => e.capabilities[cap])
    .map(([t]) => t);
}

/** 注册表派生判别联合——schema 单源（ADR-2「schema 即类型唯一来源」的全量兑现面；
 *  与手写 IWidgetData 的等价由编译期等价锁单测防漂移） */
export const WidgetDataUnion = z.discriminatedUnion('type', [
  WIDGET_REGISTRY.SHAPE.schema,
  WIDGET_REGISTRY.TEXT.schema,
  WIDGET_REGISTRY.LINE.schema,
  WIDGET_REGISTRY.PEN.schema,
  WIDGET_REGISTRY.STICKY.schema,
  WIDGET_REGISTRY.MIND_MAP.schema,
  WIDGET_REGISTRY.IMAGE.schema,
]);

// ---------------------------------------------------------------------------
// ActionBar schema v2（docs/12 §4/§5：选中浮动操作栏，schema 驱动动态渲染；
// 2026-10-03 参考视频对齐——多级化：bar 一级只放「当前值图标 + ▾」单按钮，
// 选项收进二级面板；文字提示收进 tooltip。segmented/color kind 退役）
// ----------------------------------------------------------------------------

export type ActionBarItemKind = 'toggle' | 'popover' | 'action';

export interface IActionBarOption {
  id: string;
  /** 中文名（面板选项 tooltip / aria 兜底文案） */
  label: string;
  /** Icon 语义名（图标选项；色块选项用 swatch；文本选项用 text——三选一） */
  icon?: string;
  /** 色块选项的 hex 渲染色 */
  swatch?: string;
  /** 文本选项的显示字（字号档位等数字型值，docs/17 §4 排版打磨批 B） */
  text?: string;
}

export interface IActionBarItem {
  /** 语义键：popover/toggle = updateSelectedStyle 的 patch 键；action = 动作 id（commands 层分发，docs/05 §7） */
  id: string;
  kind: ActionBarItemKind;
  /** 控件中文文案（一级按钮 tooltip + aria-label） */
  label: string;
  /** toggle/action：图标语义名 */
  icon?: string;
  /** popover：当前值（option id，触发钮显示其图标/色点）；toggle：boolean */
  value?: string | boolean;
  /** popover 选项（图标型 / 色块型） */
  options?: IActionBarOption[];
  /** action：不可用时的禁用态（分布键 <3 选中，参考同款） */
  disabled?: boolean;
}

export interface IActionBarSchema {
  /** 单选时的控件类型；多选为 '*'（仅通用动作） */
  type: string;
  items: IActionBarItem[];
}

/** 脑图焦点节点 +/- 按钮定位源（docs/12 §4；bounds = canvas 局部坐标，同 ActionBar 语义） */
export interface IMindAddButtonsState {
  bounds: { x: number; y: number; width: number; height: number };
  /** 根节点：左右均显示建子按钮、无同级/删除 */
  isRoot: boolean;
  /** 焦点节点侧向（沿父链继承；isRoot 时恒 right） */
  direction: 'left' | 'right';
  /** 左/右建子按钮的 x 基准边（canvas 局部坐标）：焦点节点边缘与同侧子树
   *  最远端取外——按钮不再压住子节点（2026-09 样式审查实测） */
  slotLeft: number;
  slotRight: number;
}
