import { useEffect, useRef } from 'react';
import { useSpinthStore } from '../store/spinthStore';
import { Icon, type IconName } from './Icon';
import { SHAPE_TYPE_OPTIONS } from '@spinth/core';

/**
 * 工具幽灵（docs/12 §4）：可创建元素的工具激活后，指针旁跟随一个缩小的
 * 半透明 DOM 示意（cursor/hand 无）。六工具统一 = 该工具的工具坞图标 +
 * 工具色（Icon 注册表同源——坞里什么图标，幽灵就是什么），32px / 60% 透明。
 *
 * 架构（2026-09-22 幽灵 DOM 化定稿）：
 * - **视觉归 react**：脑图原 PIXI 幽灵根（全尺寸节点）退役，与 shape/text/
 *   line/pen/sticky 统一为本组件——单一实现、样式系统直管；
 * - **语义归 core**：mind 模式「悬停已有脑图」的抑制判定由 MindService
 *   发布（mindGhostSuppressed$），本组件只消费；
 * - **高频坐标不穿层**：位置由本组件自监听 window pointermove 并 ref 直写
 *   transform（docs/12 §5 高频流纪律：不进 React 渲染、只写合成器属性，
 *   curPos$ 80ms 节流流不跟手）；
 * - 可见性 = 工具激活 && 指针在画布 rect 内 &&（mind 时未被抑制）。
 */

/** 幽灵锚点相对指针热点的偏移（右下，不遮指针） */
const OFFSET_X = 14;
const OFFSET_Y = 14;

interface GhostToolDef {
  icon: IconName;
  /** 工具主题色类（与工具坞激活色同源） */
  tone: string;
}

/** 可创建工具 → 幽灵示意（与 Toolbar 同源对齐；类名完整字符串保证被扫描。
 *  shape 图标随默认型动态（SHAPE_TYPE_OPTIONS 单源）——坞里什么图标，幽灵就是什么 */
const GHOST_TOOLS: Partial<Record<string, GhostToolDef>> = {
  shape: { icon: 'shape', tone: 'text-tool-shape' }, // icon 被动态覆盖（见 def 计算）
  text: { icon: 'text', tone: 'text-tool-text' },
  line: { icon: 'connector', tone: 'text-tool-line' },
  pen: { icon: 'pen', tone: 'text-tool-pen' },
  sticky: { icon: 'sticky', tone: 'text-tool-sticky' },
  mind: { icon: 'mindmap', tone: 'text-tool-mind' },
};

export function ToolGhost() {
  const cursorMode = useSpinthStore((s) => s.cursorMode);
  const suppressed = useSpinthStore((s) => s.mindGhostSuppressed);
  const toolOptions = useSpinthStore((s) => s.defaultToolOptions);
  const ref = useRef<HTMLDivElement | null>(null);
  /** 指针最后位置（常驻记录，只写 ref 不碰 DOM）——程序化切工具时幽灵无需等 move 即可就位 */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const def = GHOST_TOOLS[cursorMode];
  // shape 幽灵随默认型（SHAPE_TYPE_OPTIONS 单源——与工具坞按钮图标一致；current 读聚合表）
  const shapeIcon = (SHAPE_TYPE_OPTIONS.find((o) => o.id === (toolOptions['shape']?.type ?? 'rect'))
    ?.icon ?? 'shape') as IconName;
  const icon = cursorMode === 'shape' ? shapeIcon : def?.icon;
  const hidden = cursorMode === 'mind' && suppressed;

  useEffect(() => {
    const track = (e: PointerEvent): void => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', track, { passive: true });
    return () => window.removeEventListener('pointermove', track);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !def || hidden) return;
    // 画布 rect **缓存**：每次 pointermove 里调 getBoundingClientRect 会在
    // 渲染循环存在的页面上反复强制同步布局（layout thrashing），事件处理
    // 变慢就是「不跟手」的主因之一。move 热路径只有 isConnected 属性检查
    // （O(1) 不碰布局），rect 失效走四条通道重读：
    //   ① window resize ② 捕获阶段 scroll（宿主页面可滚动时 rect 随滚动漂移）
    //   ③ ResizeObserver（宿主布局改画布尺寸，不经 window resize）
    //   ④ 画布元素被替换（Board 重挂）→ move 里 isConnected 失检兜底重查
    let canvas = document.querySelector('#stage-container canvas') as HTMLElement | null;
    let rect = canvas?.getBoundingClientRect() ?? null;
    let ro: ResizeObserver | null = null;
    const observe = (): void => {
      ro?.disconnect();
      ro = null;
      const c = canvas;
      if (c && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          rect = c.getBoundingClientRect();
        });
        ro.observe(c);
      }
    };
    const requery = (): void => {
      canvas = document.querySelector('#stage-container canvas') as HTMLElement | null;
      rect = canvas?.getBoundingClientRect() ?? null;
      observe();
    };
    requery();
    const remeasure = (): void => {
      rect = canvas?.getBoundingClientRect() ?? null;
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, { capture: true, passive: true });

    const place = (x: number, y: number): void => {
      const inside =
        !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      el.style.opacity = inside ? '0.6' : '0';
      if (inside) {
        el.style.transform = `translate3d(${x + OFFSET_X}px, ${y + OFFSET_Y}px, 0)`;
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (!canvas?.isConnected) requery();
      // 合并事件的原始采样点：pointermove 按渲染帧合并派发（60Hz），
      // 高采样率鼠标（125-1000Hz）的中间点在 e.getCoalescedEvents()——
      // 取最后一个才能拿到帧内的最新位置（跟手关键之二）
      const coalesced = e.getCoalescedEvents?.();
      const last = coalesced && coalesced.length > 0 ? coalesced[coalesced.length - 1]! : e;
      place(last.clientX, last.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    // 工具切换时指针可能静止（程序化 setCursorMode / 未来快捷键）——按
    // 常驻记录的位置立即就位，不必等下一次 pointermove 才现身
    const p0 = pointerRef.current;
    if (p0) place(p0.x, p0.y);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, { capture: true });
      ro?.disconnect();
    };
  }, [def, hidden]);

  if (!def || hidden) return null;
  return (
    <div
      ref={ref}
      aria-hidden
      data-spinth-tool-ghost={cursorMode}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 30,
        willChange: 'transform, opacity',
      }}
    >
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-lg border border-edge bg-surface/70 ${def.tone}`}
      >
        <Icon name={icon ?? def.icon} size={17} strokeWidth={2} />
      </div>
    </div>
  );
}
