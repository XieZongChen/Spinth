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

/** 容器归属标记（specs/container-frame §2.2）：optional 无 default——旧文档
 *  零迁移，字段不存在即顶层。仅自由七类引入（锚定线持 parentId 由 FrameService
 *  运行时排除——同 LINE 锚定态不编组先例）；FRAME/树控件不带该字段 */
export const ParentIdField = {
  parentId: z.string().optional(),
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
  /** 流程图样式批（specs/flowchart-closeout §4.2）：optional 无 default——老文档
   *  零迁移，消费侧 `?? 缺省`（shapeStyle.resolveShapeStyle 单源）。borderColor
   *  一旦写入即固定，不随填充色变化（无「自动（随填充）」还原选项——避免
   *  「删除字段」写路径的语义未定义）；fill 'none' = 只描边不填充，命中
   *  语义不变（bbox 命中） */
  borderColor: z.string().optional(),
  /** 描边宽（档位 1/2/4，SHAPE_BORDER_WIDTH_OPTIONS 单源）；缺失 = 1 */
  borderWidth: z.number().optional(),
  /** 填充态：'solid'（缺省）= 填充 color；'none' = 无填充标注框 */
  fill: z.enum(['solid', 'none']).optional(),
  ...TypoFields,
  ...RotationField,
  ...GroupIdField,
  ...ParentIdField,
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
  ...ParentIdField,
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
  /** 锚点沿边参数（docs/08 §3）：optional 无 default——缺失 = 边中点
   *  （同边多线默认同点引出，允许重叠）；显式写入 = 用户手工固定该端，
   *  用于把同边多条线分开。端点重锚定时由投影计算写入 */
  startPort: z.number().min(0).max(1).optional(),
  endPort: z.number().min(0).max(1).optional(),
  /** 线上文字排版 override（align 恒 center 与锚点语义绑定，不加字段） */
  fontSize: TypoFields.fontSize,
  textColor: TypoFields.textColor,
  ...GroupIdField,
  ...ParentIdField,
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
  ...ParentIdField,
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
  ...ParentIdField,
});
export type StickyData = z.infer<typeof StickySchema>;

/** 组织架构图（specs/tree-diagrams §5.4/§7.3，Phase 3）：与 MIND_MAP 同骨架
 *  的 kind 实例——树数据/编辑/撤销/持久化复用，布局/连线/导航/落点/样式按
 *  org 策略。orientation MVP 只写 top-down（left-right 为 Phase 4 扩宽） */
export const OrgChartSchema = z.object({
  id: z.string(),
  type: z.literal('ORG_CHART'),
  zOrder: z.string(),
  /** 根节点 JSON 树（创建时输入；树结构由 TreeNodeModel 构建期校验，schema 放行） */
  root: z.unknown().optional(),
  orientation: z.enum(['top-down']).optional(),
});
export type OrgChartData = z.infer<typeof OrgChartSchema>;

export const MindMapSchema = z.object({
  id: z.string(),
  type: z.literal('MIND_MAP'),
  zOrder: z.string(),
  /** 根节点 JSON 树（创建时输入；树结构由 MindNodeModel 构建期校验，schema 放行） */
  root: z.unknown().optional(),
  /** 排列物理轴（specs/tree-diagrams D4）：optional 无 default——老文档零迁移，
   *  消费侧 `?? 'horizontal'`。direction 恒逻辑侧 left/right（vertical 时
   *  left=上、right=下），切换 orientation 不重写任何节点；旧客户端忽略
   *  本字段按左右渲染（降级不损坏） */
  orientation: z.enum(['horizontal', 'vertical']).optional(),
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
  ...ParentIdField,
});
export type ImageData = z.infer<typeof ImageSchema>;

/** 符号控件（specs/symbol-widget §2）：矢量图标 + 外置单行标签（标签计入
 *  bbox，几何走独立 rect 同 SHAPE 扁平化路径）。symbol 不用 enum——旧客户端
 *  打开新项目文件未知类型跳过 + warning（docs/20），未知 id 渲染占位图（D7） */
export const SymbolSchema = z.object({
  id: z.string(),
  type: z.literal('SYMBOL'),
  zOrder: z.string(),
  /** 符号种类 id（§4.1 清单，SYMBOL_KINDS 单源）；未知值降级占位（D7） */
  symbol: z.string().default('net-server'),
  /** 外置标签（纯文本非 HTML，单行 ≤64 字符）；空串 = 只画图标 */
  label: z.string().default(''),
  /** 逐实例着色（hex）；缺省 = 主题文字色（light #333333 / dark #ededf2），
   *  图标与标签同色；写入即固定不随主题反转（同 textColor 实例数据语义） */
  color: z.string().optional(),
  ...GroupIdField,
  ...ParentIdField,
});
export type SymbolData = z.infer<typeof SymbolSchema>;

/** 容器（specs/container-frame §2.1）：标题带 + 背景 + 边框，内部不承载文字；
 *  子元素归属是扁平文档上的 parentId 标记（容器不存 childIds）。optional 无
 *  default 的字段一律「缺省由消费侧常量兜底」，旧文档零迁移 */
export const FrameSchema = z.object({
  id: z.string(),
  type: z.literal('FRAME'),
  zOrder: z.string(),
  /** 标题（纯文本单行，非 HTML——plain 内核编辑；空串 = 只有带、无文字） */
  title: z.string().default(''),
  /** 背景色（hex）；fill 'none' 时不画底 */
  color: z.string().default('#ffffff'),
  /** 填充态：'solid'（缺省）= 填充 color；'none' = 无底只有边框 */
  fill: z.enum(['solid', 'none']).optional(),
  /** 边框：未写 borderColor = 派生暗色（与 SHAPE 同口径：写死不自适应） */
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'none']).default('solid'),
  /** 标题带位置：top（缺省，标题条在上）/ left（行泳道，左侧表头列） */
  headerSide: z.enum(['top', 'left']).optional(),
  /** 标题文字色；缺省随带底自适应（specs/container-frame §5.4 双态护栏：
   *  白底深字/深底浅字，defaultTextColorForFill 同源——「主题墨色」仅在
   *  无填充对画布时成立） */
  titleColor: z.string().optional(),
});
export type FrameData = z.infer<typeof FrameSchema>;

/** 控件实现族（specs/tree-diagrams D1）：family 是引擎层的唯一判据——
 *  `family: 'tree'` 的唯一含义是「节点不是 widget、几何由树布局派生、
 *  空间索引与 culling 豁免」。vmEngine/culling/selector 只认 family，
 *  不出现具体类型硬编码；种类差异在 widgets/tree 的 TREE_KINDS 注册表 */
export type WidgetFamily = 'widget' | 'tree';

/**
 * 控件判别联合 + 摊平几何（Batch 2 第三刀，2026-10-18 全量替换手写联合）：
 * 直接从 WIDGET_REGISTRY 派生——schema 即类型唯一来源（ADR-2）兑现，加类型
 * 只需注册表加一项（等价锁单测随之收口）；各 XxxData 别名保留（消费面广、
 * 语义同源——本就是 z.infer<各自 schema>）。加控件仍需 tokens.ts/app.ts
 * 登记 token（引擎零改动）。
 */
export type IWidgetData = z.infer<typeof WidgetDataUnion> & IRect;

// ---------------------------------------------------------------------------
// 类型注册表（Batch 2 · 类型注册表第一刀，2026-10-18）：type → { family,
// schema, capabilities } 单源——schema 域先收口（Model/Vm/Service 创建注册化与
// ActionBar/编辑/命中 per-type 注册化是后续刀，见 docs/16 §8 Batch 2 节）。
// IWidgetData 手写联合暂保留，由 widgetRegistry.test 的**编译期等价锁**防漂移
// （注册表派生联合 ≠ 手写联合即测红）；全量替换手写联合是第二刀。
// ----------------------------------------------------------------------------

/** 各类型能力位单源（docs/02 §4 八元，第五刀扩 editable/referenceable/
 *  erasable 三元）——此前七 Model 各自手写重复且无互查；语义注释：
 *  - rotatable：旋转手柄入口闸门（rectEditorService 唯一消费点）。rect 四类
 *    （SHAPE/TEXT/STICKY/IMAGE）支持 rotation 数据，但入口**暂时隐藏**
 *    （用户拍板：手感未达预期）——四类当前置 false；rotation 字段、渲染、
 *    命中、缩放、连线锚定全保留，恢复 = 四类改回 true（docs/05 §8、
 *    specs/rotate-hide）。LINE/PEN/MIND_MAP 不旋转
 *  - groupable：自由六类；MIND_MAP 节点级选中走焦点体系（docs/18 §3.1）
 *  - resizable：LINE 无（端点手势管形状）；PEN 走 points 重映射非 root.scale
 *  - keepRatio：仅 IMAGE（图片默认锁定比例）
 *  - editable（第五刀）：统一编辑会话三类 TEXT/STICKY/SHAPE（docs/17——LINE
 *    线上文字走独立 textEditor 通道不在统一会话）
 *  - referenceable（第五刀）：参考线参照物四类（docs/06 §2）
 *  - erasable（第五刀）：分段橡皮仅对 PEN 笔迹 */
export const WIDGET_REGISTRY = {
  SHAPE: {
    family: 'widget',
    schema: ShapeSchema,
    capabilities: {
      rotatable: false, // 入口暂隐藏（见上方 rotatable 注释）
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
    family: 'widget',
    schema: TextSchema,
    capabilities: {
      rotatable: false, // 入口暂隐藏（见上方 rotatable 注释）
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
    family: 'widget',
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
    family: 'widget',
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
    family: 'widget',
    schema: StickySchema,
    capabilities: {
      rotatable: false, // 入口暂隐藏（见上方 rotatable 注释）
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
    family: 'tree',
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
  ORG_CHART: {
    family: 'tree',
    schema: OrgChartSchema,
    // 与 MIND_MAP 同（specs §9.1）：节点级选中走焦点体系
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
    family: 'widget',
    schema: ImageSchema,
    capabilities: {
      rotatable: false, // 入口暂隐藏（见上方 rotatable 注释）
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
  SYMBOL: {
    family: 'widget',
    schema: SymbolSchema,
    capabilities: {
      // 不旋转（specs/symbol-widget §2.4/D6：标签带恒高，旋转几何不做）
      rotatable: false,
      groupable: true,
      resizable: true,
      movable: true,
      selectable: true,
      // contain 适配不改宽高比，但 bbox 仍是矩形缩放（keepRatio 只约束手势）
      keepRatio: false,
      // 标签走统一编辑会话（docs/17，TYPES_WHERE('editable') 自动纳入）
      editable: true,
      referenceable: true,
      erasable: false,
    },
  },
  FRAME: {
    family: 'widget',
    schema: FrameSchema,
    capabilities: {
      // 不旋转（specs/container-frame §2.6：旋转变换与子元素坐标无解）
      rotatable: false,
      // 容器与组互斥（§4.13：几何归属 vs 选择聚合，两套语义不混用）
      groupable: false,
      resizable: true,
      movable: true,
      selectable: true,
      keepRatio: false,
      // 标题走自有 plain 内核会话（§4.10，同 LINE 线上文字先例——不走
      // TYPES_WHERE('editable') 的富文本通道，那条通道写 text 字段）
      editable: false,
      // 参考线可吸附容器边（泳道对齐刚需，§2.6）
      referenceable: true,
      erasable: false,
    },
  },
} as const satisfies Record<
  string,
  { family: WidgetFamily; schema: z.ZodType; capabilities: IWidgetCapabilities }
>;

/** family === 'tree' 的类型集（编译期从注册表派生，specs/tree-diagrams D1）：
 *  引擎判定单源——注册表加树类型而此处不覆盖会在 TREE_KINDS 编译锁处红 */
export type TreeWidgetType = {
  [K in keyof typeof WIDGET_REGISTRY]: (typeof WIDGET_REGISTRY)[K]['family'] extends 'tree'
    ? K
    : never;
}[keyof typeof WIDGET_REGISTRY];

/** 运行时树判定（vmEngine 查询豁免 / culling 豁免 / selector 节点拖拽分流共用） */
export function isTreeWidgetType(type: string): type is TreeWidgetType {
  const entry = (WIDGET_REGISTRY as Record<string, { family?: WidgetFamily }>)[type];
  return entry?.family === 'tree';
}

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
 *  加类型只在 WIDGET_REGISTRY 加一项，union 零改动（specs/api-surface §3.8 a：
 *  此前逐键手列七个 schema 引用，注册表加项忘改此表即静默漏类）。
 *  派生等价由本文件三条 `_Union*` 编译锁 + widgetRegistry.test 的类型锁防漂移 */
type RegistrySchema = (typeof WIDGET_REGISTRY)[keyof typeof WIDGET_REGISTRY]['schema'];

// z.discriminatedUnion 要求「非空 tuple」；Object.values 只能是数组，
// 故此处一次断言。非空性由 widgetRegistry.test 的「注册表覆盖七类型」兜底。
const REGISTRY_SCHEMAS = Object.values(WIDGET_REGISTRY).map(
  (e) => e.schema,
) as unknown as readonly [RegistrySchema, ...RegistrySchema[]];

export const WidgetDataUnion = z.discriminatedUnion('type', REGISTRY_SCHEMAS);

// —— 派生等价锁（编译期即红）：union 与注册表任一方向漂移都逃不掉 ——
type AssertNever<T extends never> = T;
type RegistryData = {
  [K in keyof typeof WIDGET_REGISTRY]: z.infer<(typeof WIDGET_REGISTRY)[K]['schema']>;
}[keyof typeof WIDGET_REGISTRY];

/** 注册表里有、union 覆盖不到的数据形态（schema 漂移） */
export type _UnionCoversRegistry = AssertNever<
  Exclude<RegistryData, z.infer<typeof WidgetDataUnion>>
>;
/** union 里有、注册表给不出的数据形态 */
export type _RegistryCoversUnion = AssertNever<
  Exclude<z.infer<typeof WidgetDataUnion>, RegistryData>
>;
/** 判别键双向对齐（注册表键集 ≡ union type 键集） */
export type _UnionTypeKeys = AssertNever<
  | Exclude<keyof typeof WIDGET_REGISTRY, z.infer<typeof WidgetDataUnion>['type']>
  | Exclude<z.infer<typeof WidgetDataUnion>['type'], keyof typeof WIDGET_REGISTRY>
>;

// ActionBar DOM 契约（docs/12 §4/§5）外移至 actionBar.ts（schema 单源不拆，
// 此处显式 re-export 保持既有 import 路径）
export type {
  ActionBarItemKind,
  IActionBarOption,
  IActionBarItem,
  IActionBarSchema,
  IMindAddButtonsState,
  ITreeAddButtonsState,
} from './actionBar';
