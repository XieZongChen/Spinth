import { describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Text, Texture } from 'pixi.js';
import { measureDoc, type IMeasurer, type ITextStyleProps } from '../platform/textEngine/measure';
import {
  DocDisplay,
  MIN_TEXT_LINE_HEIGHT,
  type ITextRenderService,
} from '../platform/textEngine/docDisplay';
import { stubPixiCanvasDocument } from './helpers/pixiNodeEnv';

stubPixiCanvasDocument();

const mono: IMeasurer = { measure: (t) => t.length * 10 };
const style: ITextStyleProps = {
  fontFamily: 'sans-serif',
  fontSize: 20,
  lineHeight: 1.5, // 行高 30px
  color: '#333',
};

function viewOf(text: string): ReturnType<typeof measureDoc> {
  return measureDoc(
    { paragraphs: [{ spans: [{ text }] }], maxWidth: 200, style },
    { measurer: mono },
  );
}

/** 桩服务：模拟真实 TextRenderService 的 register 行为（按当前视口决策初始模式） */
function fakeService(overrides?: Partial<ITextRenderService>): ITextRenderService {
  return {
    dpr: 1,
    register: (d) => d.updateForViewport(true, 1),
    unregister: () => {},
    markDirty: () => {},
    snapshot: () => new Container(),
    ...overrides,
  };
}

/** 高清树内取 Text 列表（enterTextMode 的唯一 child 是 buildTextTree 容器） */
function nestedTexts(d: DocDisplay): Text[] {
  const out: Text[] = [];
  const walk = (c: Container): void => {
    for (const child of c.children) {
      if (child instanceof Text) out.push(child);
      else walk(child);
    }
  };
  walk(d);
  return out;
}

describe('DocDisplay 两级渲染（docs/07 §6）', () => {
  it('无纹理服务：直接高清 Text 模式', () => {
    const d = new DocDisplay(viewOf('hello'), style, null);
    expect(d.renderMode).toBe('text');
    expect(nestedTexts(d).length).toBe(1);
  });

  it('有纹理服务：register 即决策（屏内高清 → text 模式）', () => {
    const register = vi.fn((d: DocDisplay) => d.updateForViewport(true, 1));
    const d = new DocDisplay(viewOf('hello'), style, fakeService({ register }));
    expect(register).toHaveBeenCalledWith(d);
    expect(d.renderMode).toBe('text');
  });

  it('快照可用 + 缩远（行高×scale ≤ 10px）→ snapshot 模式；再放大切回 text', () => {
    const snapshot = vi.fn(() => new Container());
    const d = new DocDisplay(viewOf('hi'), style, fakeService({ snapshot }));
    // 行高 30：scale 0.3 → 9px ≤ 10 → 快照
    d.updateForViewport(true, 0.3);
    expect(d.renderMode).toBe('snapshot');
    expect(snapshot).toHaveBeenCalledTimes(1);
    // 同 scale 重复通知不重生成（模式不变即无操作）
    d.updateForViewport(true, 0.3);
    expect(snapshot).toHaveBeenCalledTimes(1);
    // 放大 → 高清
    d.updateForViewport(true, 1);
    expect(d.renderMode).toBe('text');
  });

  it('屏外（visible=false）即使放大也走快照', () => {
    const snapshot = vi.fn(() => new Container());
    const d = new DocDisplay(viewOf('hi'), style, fakeService({ snapshot }));
    d.updateForViewport(false, 1);
    expect(d.renderMode).toBe('snapshot');
  });

  it('快照生成失败（null）→ 降级高清 Text', () => {
    const d = new DocDisplay(viewOf('hello'), style, fakeService({ snapshot: () => null }));
    d.updateForViewport(true, 0.1);
    expect(d.renderMode).toBe('text');
    expect(nestedTexts(d).length).toBe(1);
  });

  it('快照分辨率：小字号抬升（min 行高 10 物理像素），常规字号 = dpr', () => {
    // fontSize 20 lh 1.5 → 30px 行高 → max(1, 10/30)=1 → ×dpr
    const small: ITextStyleProps = { ...style, fontSize: 4, lineHeight: 1.5 }; // 6px 行高 → 10/6>1
    const resolutions: number[] = [];
    const d = new DocDisplay(
      viewOf('x'),
      small,
      fakeService({
        dpr: 2,
        snapshot: (_v, _s, r) => {
          resolutions.push(r);
          return new Container();
        },
      }),
    );
    d.updateForViewport(true, 0.1);
    expect(d.renderMode).toBe('snapshot');
    expect(resolutions[0]).toBeCloseTo((10 / 6) * 2, 6); // 构造期 scale=1 生成（首次）
    // 1.27：text→snapshot 降档时分辨率纳入 scale（0.1 → ×0.25 下限）
    const rs: number[] = [];
    const dd = new DocDisplay(
      viewOf('x'),
      style,
      fakeService({
        dpr: 2,
        snapshot: (_v, _s, r) => {
          rs.push(r);
          return new Container();
        },
      }),
    );
    dd.updateForViewport(true, 1); // lineH30×1>10 → text
    expect(dd.renderMode).toBe('text');
    dd.updateForViewport(true, 0.1); // → snapshot，resolution = 1×2×0.25
    expect(dd.renderMode).toBe('snapshot');
    expect(rs[rs.length - 1]).toBeCloseTo(2 * 0.25, 6);
    // scale ∈ [0.25,1] 线性折扣（回归锁）
    const d3 = new DocDisplay(viewOf('x'), style, fakeService({ dpr: 2 }));
    d3.updateForViewport(true, 0.3); // 30×0.3=9 < 10 → snapshot
    expect(d3.snapshotResolution).toBeCloseTo(2 * 0.3, 6);
  });

  it('高清模式分辨率漂移 >10% 才调整（docs/07 §6）', () => {
    const d = new DocDisplay(viewOf('hi'), style, fakeService({ dpr: 1 }));
    d.updateForViewport(true, 1);
    const [t1] = nestedTexts(d);
    expect(t1).toBeDefined();
    expect(t1!.resolution).toBe(1);
    // 1 → 1.05：漂移 5%，不调整
    d.updateForViewport(true, 1.05);
    expect(nestedTexts(d)[0]).toBe(t1);
    expect(t1!.resolution).toBe(1);
    // 1 → 1.2：漂移 20%，原地调 resolution（同一实例，未重建）
    d.updateForViewport(true, 1.2);
    expect(nestedTexts(d)[0]).toBe(t1);
    expect(t1!.resolution).toBe(1.2);
  });

  it('destroy：unregister + 销毁快照纹理（Sprite 连带 texture）', () => {
    const unregister = vi.fn();
    const snapshot = (): Container => {
      const c = new Container();
      c.addChild(new Sprite(new Texture()));
      return c;
    };
    const d = new DocDisplay(viewOf('hi'), style, fakeService({ unregister, snapshot }));
    d.updateForViewport(true, 0.1); // 进快照
    expect(d.renderMode).toBe('snapshot');
    const sprite = (d.children[0] as Container).children[0] as Sprite;
    expect(sprite).toBeInstanceOf(Sprite);
    const tex = sprite.texture;
    d.destroy();
    expect(unregister).toHaveBeenCalledWith(d);
    expect(sprite.destroyed).toBe(true);
    expect(tex.destroyed).toBe(true);
  });

  it('measureDoc 输出的 span rect 与 Text 定位一致（渲染对齐前提）', () => {
    const view = viewOf('abcd');
    const span = view.paragraphs[0]!.lines[0]!.spans[0]!;
    expect(span.rect.x).toBe(0);
    expect(span.rect.y).toBe(0);
    expect(span.rect.width).toBe(40);
    const d = new DocDisplay(view, style, null);
    const [t] = nestedTexts(d);
    expect(t!.x).toBe(span.rect.x);
    expect(t!.y).toBe(span.rect.y);
  });

  it('两级阈值常量与规格一致（docs/07 §6 = 10px）', () => {
    expect(MIN_TEXT_LINE_HEIGHT).toBe(10);
  });
});
