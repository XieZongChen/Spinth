/**
 * 从 visual.spec.ts 提取 toHaveScreenshot('...') 字面量 stem 清单。
 *
 * 基线清单的单一来源（specs/linux-visual §6.2 / D11）：基线齐全护栏与容器
 * 执行器的产物计数断言共用本模块，避免两处正则各自漂移。
 *
 * 返回 { stems, error }：stems 去重且去掉 .png 后缀；error 非 null 表示
 * spec 里存在非字面量（动态）快照名称——无法静态推导清单，调用方必须报错。
 */

import fs from 'node:fs';

export function extractVisualStems(specPath) {
  const source = fs.readFileSync(specPath, 'utf8');
  const callCount = [...source.matchAll(/toHaveScreenshot\(/g)].length;
  const literalMatches = [...source.matchAll(/toHaveScreenshot\(\s*'([^']+)'/g)];
  const stems = [...new Set(literalMatches.map((m) => m[1].replace(/\.png$/, '')))];
  if (callCount !== literalMatches.length) {
    return {
      stems,
      error:
        `visual.spec.ts 存在 ${callCount - literalMatches.length} 处非字面量（动态）快照名称——` +
        '无法推导基线清单，请改为字面量或更新提取逻辑（specs/linux-visual §6.2）',
    };
  }
  return { stems, error: null };
}
