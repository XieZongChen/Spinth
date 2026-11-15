/**
 * mind 分支色板（docs/11 §2）：每个一级分支一个颜色，深层继承。
 * 公开导出源（包入口 re-export 冻结，specs/tree-diagrams §11.2）。
 */

/**
 * 分支色板（既有设计脑图核心视觉语言）。
 * 曾只定义未消费——全图连线/描边退化灰色（2026-09 样式审查实锤）。
 * 饱和度取中：浅色画布不刺眼、暗色画布足够亮。
 */
export const BRANCH_COLORS = [
  '#e0559c',
  '#3e8bff',
  '#2fa96e',
  '#e8843c',
  '#7c5cfc',
  '#0fb5a6',
] as const;

/** 第 i 个一级分支的分支色（越界循环取色） */
export function branchColorAt(index: number): string {
  const i = ((index % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length;
  return BRANCH_COLORS[i]!;
}

/** 根层新分支取色：从 preferIndex 位起取色板中第一个未被现有一级分支占用的色
 *  （撞色规避——按位取色在中间插入时会与既有兄弟同色，2026-09-20 收口）；
 *  色板全被占用（一级分支 > 6 个）则循环复用按位色 */
export function nextBranchColor(existing: ReadonlySet<string>, preferIndex: number): string {
  for (let i = 0; i < BRANCH_COLORS.length; i++) {
    const c = branchColorAt(preferIndex + i);
    if (!existing.has(c)) return c;
  }
  return branchColorAt(preferIndex);
}
