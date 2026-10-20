import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { markRender } from '../../common/render';
import { hexToNum } from '../../common/color';
import type { IAwarenessState } from './awarenessService';

/**
 * 单个远端 peer 的渲染器（docs/10 §3 渲染层决策）：
 * 光标 + 名牌 + 选区互见，画在 optionLayer（世界坐标锚定，随视口变换零成本跟随）。
 * 同构实例族（组合式，ADR-8 第一岔路）；逐字段比对只重绘变化。
 *
 * 光标纹理按 userColor 缓存复用（每色一张），peer 首现时创建——
 * 规避首帧前纹理状态不上屏的坑（docs/03 §6 教训适用于创建时机）。
 */

/**
 * 光标纹理缓存：按 renderer 隔离（色 → 纹理）。模块级单 Map 会跨 renderer 复用
 * 纹理——StrictMode 双挂载销毁旧 renderer 后新实例拿到已销毁纹理（外部审查揪出，
 * Phase 1 双挂载先例）。WeakMap 随 renderer 回收自动释放。
 */
const cursorTexCache = new WeakMap<object, Map<string, Texture>>();

function cursorTexture(color: string, renderer: { generateTexture(o: unknown): Texture }): Texture {
  let byColor = cursorTexCache.get(renderer);
  if (!byColor) {
    byColor = new Map();
    cursorTexCache.set(renderer, byColor);
  }
  let tex = byColor.get(color);
  if (!tex) {
    const g = new Graphics();
    const c = hexToNum(color);
    // 24×24 箭头光标轮廓（视觉规格：白描边深色填充）
    g.moveTo(0, 0)
      .lineTo(0, 16)
      .lineTo(4.2, 12.4)
      .lineTo(7, 18)
      .lineTo(9.6, 16.7)
      .lineTo(6.9, 11.2)
      .lineTo(12, 11)
      .closePath()
      .fill({ color: c })
      .stroke({ width: 1.5, color: 0xffffff });
    tex = renderer.generateTexture(g) as Texture;
    g.destroy();
    byColor.set(color, tex);
  }
  return tex;
}

const NAME_TAG_FONT_SIZE = 11;
/** peer 停止更新后隐藏（docs/10 §3：60s 活跃检测） */
const IDLE_HIDE_MS = 60_000;

export class PeerRenderer extends Container {
  private state: IAwarenessState | null = null;
  private lastActiveAt = 0;
  private readonly cursorSprite: Sprite;
  private readonly nameTag: Text;
  private readonly selectionG = new Graphics();
  private readonly nameTagBg = new Graphics();
  /** 世界 bbox 查询（选区框渲染；注入避免直接依赖 vmEngine） */
  private boundsOf: (id: string) => Rectangle | null;

  constructor(
    private renderer: { generateTexture(o: unknown): Texture },
    boundsOf: (id: string) => Rectangle | null,
  ) {
    super();
    this.boundsOf = boundsOf;
    this.eventMode = 'none';
    this.cursorSprite = new Sprite(Texture.EMPTY);
    this.nameTag = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: NAME_TAG_FONT_SIZE,
        fontWeight: '700',
        fill: 0xffffff,
      },
    });
    this.nameTag.eventMode = 'none';
    this.cursorSprite.eventMode = 'none';
    this.addChild(this.selectionG, this.cursorSprite, this.nameTagBg, this.nameTag);
  }

  /** 状态更新（逐字段比对；pageScale 用于光标尺寸反向补偿）。
   *  keepIdle=true 为纯缩放重排（视口变化触发）——不复活闲置隐藏、不重置计时
   *  （曾一缩放全部幽灵光标复活，外部审查揪出） */
  update(next: IAwarenessState, pageScale: number, now: number, keepIdle = false): void {
    if (keepIdle) {
      this.rescale(pageScale);
      return;
    }
    const prev = this.state;
    this.state = next;
    this.lastActiveAt = now;
    this.visible = true;

    // 光标（尺寸不随画布缩放：scale = 1/pageScale）
    if (next.cursorPos) {
      this.cursorSprite.texture = cursorTexture(next.userColor, this.renderer);
      this.positionCursor(next.cursorPos, pageScale);
      this.cursorSprite.visible = true;
      // 名牌：圆角底板 + 超长截断（docs/10 §3 规格；此前裸 Text 偏差——外部审查揪出）
      if (!prev || prev.userName !== next.userName)
        this.redrawNameTag(next.userName, next.userColor);
      this.nameTag.position.set(
        next.cursorPos.x + 14 / pageScale,
        next.cursorPos.y + 18 / pageScale,
      );
      this.nameTag.scale.set(1 / pageScale);
      this.nameTagBg.scale.set(1 / pageScale);
      this.nameTag.visible = true;
      this.nameTagBg.visible = true;
    } else {
      this.cursorSprite.visible = false;
      this.nameTag.visible = false;
      this.nameTagBg.visible = false;
    }
    this.redrawSelection(pageScale);
    markRender();
  }

  /** 仅按新 scale 重排（不动 visible/活跃计时/纹理） */
  private rescale(pageScale: number): void {
    if (!this.state?.cursorPos) return;
    this.positionCursor(this.state.cursorPos, pageScale);
    this.redrawSelection(pageScale);
    markRender();
  }

  private positionCursor(pos: { x: number; y: number }, pageScale: number): void {
    this.cursorSprite.position.set(pos.x, pos.y);
    this.cursorSprite.scale.set(1 / pageScale);
    this.nameTag.position.set(pos.x + 14 / pageScale, pos.y + 18 / pageScale);
    this.nameTag.scale.set(1 / pageScale);
    this.nameTagBg.scale.set(1 / pageScale);
  }

  private redrawNameTag(userName: string, color: string): void {
    this.nameTag.text = userName.length > 12 ? `${userName.slice(0, 11)}…` : userName;
    this.nameTag.scale.set(1);
    const w = this.nameTag.width + 12;
    const h = this.nameTag.height + 6;
    this.nameTagBg.clear();
    this.nameTagBg.roundRect(0, 0, w, h, h / 2).fill({ color: hexToNum(color), alpha: 0.92 });
  }

  private redrawSelection(pageScale: number): void {
    const next = this.state;
    if (!next) return;
    // 选区互见（用户色 outline；仅渲染不参与命中/zOrder）
    this.selectionG.clear();
    for (const id of next.selectedWidgetIds) {
      const b = this.boundsOf(id);
      if (!b) continue;
      this.selectionG
        .rect(b.x, b.y, b.width, b.height)
        .stroke({ width: 1.5 / pageScale, color: hexToNum(next.userColor) });
    }
  }

  /** 活跃检测（60s 无更新隐藏） */
  tick(now: number): void {
    if (this.visible && now - this.lastActiveAt > IDLE_HIDE_MS) {
      this.visible = false;
      markRender();
    }
  }

  get peerId(): string {
    return this.state?.userId ?? '';
  }
}
