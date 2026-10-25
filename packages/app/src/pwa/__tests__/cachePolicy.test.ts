import { describe, expect, it } from 'vitest';
import {
  classifyRequest,
  navigationKey,
  toManifestPath,
  type IClassifyInput,
} from '../sw/cachePolicy';

const ORIGIN = 'http://localhost:5198';
const BASE_PATH = '/spinth/';

function input(over: Partial<IClassifyInput> = {}): IClassifyInput {
  return {
    url: `${ORIGIN}/spinth/assets/index-abc.js`,
    method: 'GET',
    mode: 'no-cors',
    hasRange: false,
    origin: ORIGIN,
    basePath: BASE_PATH,
    precached: new Set(['/spinth/assets/index-abc.js', '/spinth/index.html']),
    ...over,
  };
}

describe('classifyRequest 判定顺序（specs/pwa §6.2）', () => {
  it('清单内静态资源 → precached（cache-first）', () => {
    expect(classifyRequest(input())).toBe('precached');
  });

  it('非 GET 直通——即使 URL 在清单内', () => {
    expect(classifyRequest(input({ method: 'POST' }))).toBe('passthrough');
    expect(classifyRequest(input({ method: 'HEAD' }))).toBe('passthrough');
  });

  it('带 Range 头直通——视频式分段请求不接管', () => {
    expect(classifyRequest(input({ hasRange: true }))).toBe('passthrough');
  });

  it('跨源直通——外链图片保持既有占位/重试语义（docs/19 §4）', () => {
    expect(classifyRequest(input({ url: 'https://cdn.example.com/assets/index-abc.js' }))).toBe(
      'passthrough',
    );
  });

  it('scope 外同源路径直通', () => {
    expect(classifyRequest(input({ url: `${ORIGIN}/other/assets/index-abc.js` }))).toBe(
      'passthrough',
    );
  });

  it('mode=navigate 优先于清单命中——导航永远走 network-first（D6）', () => {
    expect(classifyRequest(input({ url: `${ORIGIN}/spinth/?doc=x`, mode: 'navigate' }))).toBe(
      'navigation',
    );
  });

  it('导航在 scope 外仍直通（短路先于分类）', () => {
    expect(classifyRequest(input({ url: `${ORIGIN}/?doc=x`, mode: 'navigate' }))).toBe(
      'passthrough',
    );
  });

  it('清单外 woff2 → runtime-revalidate（SWR 兜非 latin 子集）', () => {
    expect(
      classifyRequest(
        input({
          url: `${ORIGIN}/spinth/assets/nunito-cyrillic-wght-normal.1.woff2`,
        }),
      ),
    ).toBe('runtime-revalidate');
  });

  it('清单内 latin woff2 先命中 precached——顺序不可交换（§6.2 注）', () => {
    expect(
      classifyRequest(
        input({
          url: `${ORIGIN}/spinth/assets/nunito-latin-wght-normal.1.woff2`,
          precached: new Set(['/spinth/assets/nunito-latin-wght-normal.1.woff2']),
        }),
      ),
    ).toBe('precached');
  });

  it('同源但既不在清单也非字体 → 直通（防无界缓存增长，D7）', () => {
    expect(classifyRequest(input({ url: `${ORIGIN}/spinth/unknown.json` }))).toBe('passthrough');
  });

  it('非法 URL 直通不抛', () => {
    expect(classifyRequest(input({ url: 'not-a-url' }))).toBe('passthrough');
  });

  it('根路径部署（basePath=/）同源均 in-scope', () => {
    expect(
      classifyRequest(
        input({
          url: `${ORIGIN}/assets/index-abc.js`,
          basePath: '/',
          precached: new Set(['/assets/index-abc.js']),
        }),
      ),
    ).toBe('precached');
  });
});

describe('navigationKey / toManifestPath', () => {
  it('导航键去 query 且保证尾斜杠——?doc= 多文档共享一份 shell', () => {
    expect(navigationKey('/spinth/', ORIGIN)).toBe('http://localhost:5198/spinth/');
    expect(navigationKey('/', ORIGIN)).toBe('http://localhost:5198/');
  });

  it('导航键与带 query 的导航请求不同串——由调用方以键取 shell，非按请求 URL 匹配', () => {
    const key = navigationKey('/spinth/', ORIGIN);
    expect(key).not.toContain('?');
    expect(new URL(`${key}?doc=%E4%B8%AD`).pathname).toBe('/spinth/');
  });

  it('toManifestPath 剥 base 前缀，编码 docId 不影响 pathname 换算', () => {
    expect(toManifestPath('/spinth/', `${ORIGIN}/spinth/assets/a.js`)).toBe('assets/a.js');
    expect(toManifestPath('/', `${ORIGIN}/assets/a.js`)).toBe('assets/a.js');
    expect(toManifestPath('/spinth/', `${ORIGIN}/spinth/?doc=%E4%B8%AD`)).toBe('');
  });

  it('toManifestPath 对 scope 外路径原样返回（调用方保证不发生，防御值）', () => {
    expect(toManifestPath('/spinth/', `${ORIGIN}/x/a.js`)).toBe('/x/a.js');
  });
});
