/**
 * 脑图服务测试共用的视口桩补充方法（坐标换算恒等、画布偏移 0）。
 *
 * MindService 的焦点视窗跟随（docs/11 §7）需要屏幕空间换算与程序化平移，
 * 只做树/焦点断言的桩测试不必关心跟随结果，统一用这里的恒等映射与空实现。
 */
export function mindViewportStub(): {
  toScreen: (p: { x: number; y: number }) => { x: number; y: number };
  worldToClient: (p: { x: number; y: number }) => { x: number; y: number };
  getClientSize: () => { width: number; height: number };
  panBy: (dx: number, dy: number) => void;
} {
  return {
    toScreen: (p) => ({ x: p.x, y: p.y }),
    worldToClient: (p) => ({ x: p.x, y: p.y }),
    getClientSize: () => ({ width: 800, height: 600 }),
    panBy: () => {},
  };
}
