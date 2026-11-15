/**
 * 树形图族公共类型（specs/tree-diagrams §3.1）：types/ 不 import widgets，
 * 只放跨层契约——物理轴、逻辑侧与节点 JSON 契约。
 *
 * direction 恒为**逻辑侧** left/right（D4）：orientation 决定物理轴
 * （horizontal：left=左 right=右；vertical：left=上 right=下），
 * 上下排列切换不重写任何节点数据，旧客户端按左右渲染降级不损坏。
 */

/** 物理轴变体：mind horizontal/vertical；org top-down（MVP）/left-right（Phase 4） */
export type TreeOrientation = 'horizontal' | 'vertical' | 'top-down' | 'left-right';

/** 逻辑分支侧（仅 mind 消费；org 无侧） */
export type TreeSide = 'left' | 'right';

/** 创建/模板用的纯 JSON 节点树（两种树共享；字段面见 specs/tree-diagrams §4.1） */
export interface ITreeNodeSpec {
  text: string;
  direction?: TreeSide;
  /** 分支色（hex）。仅根的直接子节点由 buildYTree 按位分配；深层沿父链继承。
   *  序列化透传（yTreeToSpec）——拖拽搬移子树不丢色 */
  lineColor?: string;
  /** 折叠（specs/tree-diagrams D5）：optional 无 default——缺省 = 展开；
   *  入文档（刷新/导出/多标签一致），一次切换一步撤销 */
  collapsed?: boolean;
  children?: ITreeNodeSpec[];
}

/** 1.0 公开导出别名（specs/tree-diagrams §11.2：公开面只增不删，重命名留别名） */
export type IMindNodeSpec = ITreeNodeSpec;
