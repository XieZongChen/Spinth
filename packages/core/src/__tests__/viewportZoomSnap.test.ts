// @vitest-environment jsdom
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';
stubPixiCanvasDocument();
import { describe, expect, it, vi } from 'vitest';
import { ViewportZoom } from '../platform/viewport/viewportZoom';

/**
 * 缩放收尾语义（docs/16 §7、CI 实测）：
 * pixi-viewport 的 Animate 是收敛式插值，慢环境下停在离目标 1.6%~3% 的残差
 * （CI 实测 1.3934 vs 1.44）。缩放次数、HUD 与 LOD 都按精确倍数解读，
 * 因此动画收尾必须把 scale 对齐到目标值；immediate 路径本就精确。
 */
function makeHost() {
  const animate = vi.fn();
  const scaleSet = vi.fn();
  const onMoved = vi.fn();
  const remove = vi.fn();
  const viewport = {
    scale: { x: 1, y: 1, set: scaleSet },
    center: { x: 100, y: 50 },
    animate,
    moveCenter: vi.fn(),
    plugins: { remove },
  };
  const host = {
    viewport,
    widgetLayer: { children: [] as unknown[] },
    getRendererSize: () => ({ width: 800, height: 600 }),
    onMoved,
  };
  return { host, animate, scaleSet, onMoved, remove };
}

type Host = ConstructorParameters<typeof ViewportZoom>[0];

describe('ViewportZoom 收尾对齐', () => {
  it('animate 收尾把 scale 对齐到精确目标并同步视口', () => {
    const { host, animate, scaleSet, onMoved } = makeHost();
    const zoom = new ViewportZoom(host as unknown as Host);

    zoom.setPageScale(1.44);

    const options = animate.mock.calls[0]?.[0] as { scale: number; callbackOnComplete: () => void };
    expect(options.scale).toBe(1.44);
    expect(typeof options.callbackOnComplete).toBe('function');

    options.callbackOnComplete();
    expect(scaleSet).toHaveBeenCalledWith(1.44);
    expect(onMoved).toHaveBeenCalled();
  });

  it('immediate 路径精确归位且先取消在飞动画', () => {
    const { host, animate, scaleSet, onMoved, remove } = makeHost();
    const zoom = new ViewportZoom(host as unknown as Host);

    zoom.setPageScale(1, undefined, true);

    expect(animate).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('animate');
    expect(scaleSet).toHaveBeenCalledWith(1);
    expect(onMoved).toHaveBeenCalled();
  });
});
