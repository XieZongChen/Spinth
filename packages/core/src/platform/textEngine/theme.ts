/**
 * 文字默认色主题（docs/17 挂账清理 C2）：core 渲染色的 light/dark 两套默认值。
 * 环境级纯值状态（同 document 语言属性），非服务单例——「禁全局单例」铁律针对
 * 服务/依赖（构造环与隐式依赖），主题是所有渲染路径都要读的横切环境值，经
 * BoardSDK.setTheme 由 app 壳显式注入（theme.ts 的 applyTheme 时机）。
 *
 * 只主题化「画布底色之上的默认文字色」（TEXT 默认 / LINE 文字默认）；
 * STICKY 文字不主题化（便签底色固定浅黄，#4a3f35 两主题皆可读）；
 * per-实例 textColor override 优先级高于主题默认（resolveTextStyle 层序）。
 */

export type TextTheme = 'light' | 'dark';

let currentTheme: TextTheme = 'light';
let version = 0;

/** 主题切换（BoardSDK.setTheme 调用）——版本号递增供渲染层快速路径守卫 */
export function setTextTheme(theme: TextTheme): void {
  if (theme === currentTheme) return;
  currentTheme = theme;
  version++;
}

/** TEXT 控件默认文字色（dark 取 app 壳 tokens.css --spinth-text-1 同源浅色） */
export function defaultTextColor(): string {
  return currentTheme === 'dark' ? '#ededf2' : '#333333';
}

/** LINE 线上文字默认色（dark 用灰一档的 --spinth-text-2 同源） */
export function defaultLineTextColor(): string {
  return currentTheme === 'dark' ? '#a6a6b3' : '#1f2937';
}

/** 主题版本（textVm 快速路径守卫消费——主题变化使「纯平移」判定失效强制重建） */
export function textThemeVersion(): number {
  return version;
}
