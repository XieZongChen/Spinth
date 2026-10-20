/** 颜色工具：shape 边框色 = 填充色 HSL 亮度 -25%（既有设计同款视觉规则） */

export function darkenHex(hex: string, amount = 0.25): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const f = (c: number): number => Math.max(0, Math.round(c * (1 - amount)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

export function hexToNum(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
