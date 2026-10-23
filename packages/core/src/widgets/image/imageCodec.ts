import { Texture } from 'pixi.js';
import type { IImageCodec } from './imageTextureCache';

/** 浏览器解码实现：显式 Image 元素 + decode()（PIXI Assets 管线对无扩展名
 *  blob: URL 推断不出 parser，docs/19 §3）；跨源 http 图需 CORS 头
 *  （crossOrigin=anonymous，img-src 已放行）。 */
export const browserImageCodec: IImageCodec = {
  async decode(url: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return img;
  },
  createTexture(img: HTMLImageElement): Texture {
    return Texture.from(img);
  },
};
