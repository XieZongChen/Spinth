import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { Rectangle, Texture, type Renderer } from 'pixi.js';
import { splitChunk, TextRenderService } from '../platform/textEngine/textRenderService';
import { DocDisplay } from '../platform/textEngine/docDisplay';
import { measureDoc, type IMeasurer, type ITextStyleProps } from '../platform/textEngine/measure';
import type { IViewportService } from '../types';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';

stubPixiCanvasDocument();

/** 等待 scheduleUpdate 的宏任务帧（node 环境无 rAF，服务退化为 setTimeout） */
const nextFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function fakeViewport(scale = 1): IViewportService {
  return {
    vpScale$: new BehaviorSubject(scale),
    vpBounds$: new BehaviorSubject({ x: 0, y: 0, width: 800, height: 600 }),
  } as unknown as IViewportService;
}

/** 桩 renderer：generateTexture 返回可定宽高的 Texture；screen 800×600；resolution 2 */
function fakeRenderer(generateTexture?: () => Texture): Renderer {
  const tex = new Texture();
  Object.defineProperty(tex, 'width', { get: () => 200 });
  Object.defineProperty(tex, 'height', { get: () => 100 });
  return {
    screen: new Rectangle(0, 0, 800, 600),
    resolution: 2,
    generateTexture: generateTexture ?? vi.fn(() => tex),
  } as unknown as Renderer;
}

const mono: IMeasurer = { measure: (t) => t.length * 10 };
const style: ITextStyleProps = {
  fontFamily: 'sans-serif',
  fontSize: 20,
  lineHeight: 1.5, // 行高 30：scale ≤ 1/3 才值得高清
  color: '#333',
};

/** 造一个注册进服务的 DocDisplay（视口联动被测对象） */
function displayOn(svc: TextRenderService): DocDisplay {
  return new DocDisplay(
    measureDoc(
      { paragraphs: [{ spans: [{ text: 'hi' }] }], maxWidth: 200, style },
      { measurer: mono },
    ),
    style,
    svc,
  );
}

describe('splitChunk 超大文本二分切块（docs/07 §6）', () => {
  it('未超限：原样返回单块', () => {
    const chunk = new Rectangle(0, 0, 100, 100);
    expect(splitChunk(chunk, 8192)).toEqual([chunk]);
  });

  it('宽度超限：横向二分', () => {
    const pieces = splitChunk(new Rectangle(0, 0, 200, 50), 100);
    expect(pieces.length).toBe(2);
    expect(pieces[0]).toMatchObject({ x: 0, width: 100 });
    expect(pieces[1]).toMatchObject({ x: 100, width: 100 });
    for (const p of pieces) expect(p.height).toBe(50);
  });

  it('宽高均超限：网格切分且面积守恒', () => {
    const pieces = splitChunk(new Rectangle(0, 0, 200, 200), 100);
    expect(pieces.length).toBe(4);
    const area = pieces.reduce((s, p) => s + p.width * p.height, 0);
    expect(area).toBe(200 * 200);
  });

  it('非二次幂尺寸递归切到全部达标', () => {
    const pieces = splitChunk(new Rectangle(0, 0, 300, 40), 100);
    // 300 → 150+150 → 150 仍 ≥100 → 75+75：共 4 块
    expect(pieces.length).toBe(4);
    for (const p of pieces) expect(p.width).toBeLessThan(100);
    const xs = pieces.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(0);
  });

  it('块保持原始坐标系（拼回时无需平移补偿）', () => {
    const pieces = splitChunk(new Rectangle(10, 20, 200, 100), 100);
    const minX = Math.min(...pieces.map((p) => p.x));
    const minY = Math.min(...pieces.map((p) => p.y));
    expect(minX).toBe(10);
    expect(minY).toBe(20);
  });
});

describe('TextRenderService 视口联动编排（docs/07 §6）', () => {
  it('renderer 未 attach：register 安全降级（text 模式），不炸', () => {
    const svc = new TextRenderService(fakeViewport());
    svc.initialize();
    // 有服务但快照不可用 → 构造决策降级 text
    const d = displayOn(svc);
    expect(d.renderMode).toBe('text');
    expect(svc.stats.registered).toBe(1);
    d.destroy();
    svc.dispose();
  });

  it('缩远（scale ≤ 1/3）→ 降级快照；generateTexture 被调用', async () => {
    const vp = fakeViewport(1);
    const svc = new TextRenderService(vp);
    svc.initialize();
    const genTex = vi.fn(() => {
      const t = new Texture();
      Object.defineProperty(t, 'width', { get: () => 200 });
      Object.defineProperty(t, 'height', { get: () => 50 });
      return t;
    });
    svc.attachRenderer(fakeRenderer(genTex));
    const d = displayOn(svc);
    expect(d.renderMode).toBe('text'); // scale 1 屏内高清
    vp.vpScale$.next(0.3); // 行高 30×0.3=9 ≤ 10 → 快照
    await nextFrame();
    expect(d.renderMode).toBe('snapshot');
    expect(genTex).toHaveBeenCalled();
    d.destroy();
    svc.dispose();
  });

  it('屏外（世界包围盒不与屏幕矩形相交）→ 快照（即使 scale 1）', async () => {
    const vp = fakeViewport(1);
    const svc = new TextRenderService(vp);
    svc.initialize();
    svc.attachRenderer(fakeRenderer());
    const d = displayOn(svc);
    d.position.set(5000, 0); // 屏幕外（屏幕 800×600）
    vp.vpBounds$.next({ x: 100, y: 0, width: 800, height: 600 }); // 触发重评
    await nextFrame();
    expect(d.renderMode).toBe('snapshot');
    d.destroy();
    svc.dispose();
  });

  it('attachRenderer：此前降级的 display 全量重评', async () => {
    const vp = fakeViewport(0.2); // 直接以缩远状态启动（模拟 IndexedDB 恢复时序）
    const svc = new TextRenderService(vp);
    svc.initialize();
    const d = displayOn(svc);
    expect(d.renderMode).toBe('text'); // renderer 未就绪，快照生成失败降级
    svc.attachRenderer(fakeRenderer());
    await nextFrame();
    expect(d.renderMode).toBe('snapshot'); // 就绪后重评切快照
    d.destroy();
    svc.dispose();
  });

  it('destroy 注销：stats 归零；dispose 后不再响应视口', async () => {
    const vp = fakeViewport(1);
    const svc = new TextRenderService(vp);
    svc.initialize();
    svc.attachRenderer(fakeRenderer());
    const d = displayOn(svc);
    expect(svc.stats.registered).toBe(1);
    d.destroy();
    expect(svc.stats.registered).toBe(0);
    svc.dispose();
    vp.vpScale$.next(0.1); // dispose 后推送不炸
    await nextFrame();
    expect(svc.stats.registered).toBe(0);
  });

  it('stats：两级模式分布', async () => {
    const vp = fakeViewport(0.2);
    const svc = new TextRenderService(vp);
    svc.initialize();
    svc.attachRenderer(fakeRenderer());
    const d = displayOn(svc);
    await nextFrame(); // attachRenderer 的重评帧
    expect(svc.stats).toEqual({ registered: 1, snapshot: 1, text: 0 });
    d.destroy();
    svc.dispose();
  });

  it('dpr：未 attach 为 1，attach 后取 renderer.resolution', () => {
    const svc = new TextRenderService(fakeViewport());
    expect(svc.dpr).toBe(1);
    svc.attachRenderer(fakeRenderer());
    expect(svc.dpr).toBe(2);
    svc.dispose();
  });
});
