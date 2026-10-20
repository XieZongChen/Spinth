import { useEffect, useRef } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { computeGridTransform } from './dotGridMath';

/**
 * 点阵背景（docs/03 §6）——DOM/CSS 合成层实现，钉板点阵语义。
 *
 * 性能模型（2026-09 按 code review 迭代）：
 * - pan（最持续的手势）：只写 transform: translate3d（合成器操作，零 repaint，
 *   零 React 重渲染——zustand 命令式订阅 + ref 直写，不进渲染路径）；
 * - 缩放：点距变化时才重写 background-*（paint 属性，仅 200ms 缩放动画期间，
 *   与旧版"每帧全量"相比 pan 路径完全免费）；
 * - 层四边过盈 OVERSCAN px，平移量取模限制在 [-pitch, 0] 保证覆盖。
 *
 * 网格模型与对齐数学见 dotGridMath.ts（纯函数，单测覆盖）。
 */

import { OVERSCAN } from './dotGridMath';

export function DotGrid() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastPitch = -1;

    const apply = (
      scale: number,
      b: { x: number; y: number; width: number; height: number },
    ): void => {
      const t = computeGridTransform(scale, b);
      // 点距变化（缩放）才动 paint 属性；dot 半径随 pitch 等比 → 也随之更新
      if (t.pitch !== lastPitch) {
        el.style.backgroundImage = `radial-gradient(circle, var(--spinth-grid) ${t.dot / 2}px, transparent ${t.dot / 2 + 0.5}px)`;
        el.style.backgroundSize = `${t.pitch}px ${t.pitch}px`;
        lastPitch = t.pitch;
      }
      el.style.transform = `translate3d(${t.dx}px, ${t.dy}px, 0)`;
    };

    const state = useSpinthStore.getState();
    if (state.vpBounds) apply(state.pageScale, state.vpBounds);
    return useSpinthStore.subscribe((s) => {
      if (s.vpBounds) apply(s.pageScale, s.vpBounds);
    });
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute"
      style={{ inset: -OVERSCAN }}
    />
  );
}
