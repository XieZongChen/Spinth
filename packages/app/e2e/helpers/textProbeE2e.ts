import type { Page } from '@playwright/test';

/** 文本编辑 E2E 公共探针 helper（specs/split-large-files §5.3）：
 *  直返数据（evaluate 结果结构化克隆——函数/闭包传不出来，同「丢 getter」铁律族）。 */

export async function textOf(page: Page, type: string): Promise<string | undefined> {
  return page.evaluate((t) => {
    const d = (
      window as unknown as {
        __spinthDebug: { __debug: { vmStates: Array<Record<string, unknown>> } };
      }
    ).__spinthDebug.__debug;
    const s = d.vmStates.find((v) => String(v.type) === t);
    return s === undefined ? undefined : String(s.text ?? '');
  }, type);
}

export async function centerOf(page: Page, type: string): Promise<{ x: number; y: number }> {
  return page.evaluate((t) => {
    // 公开面（toScreenPoint）与调试面拆两个断言（specs/runtime-narrowing §3.8）
    const pub = (
      window as unknown as {
        __spinth: { toScreenPoint(p: { x: number; y: number }): { x: number; y: number } };
      }
    ).__spinth;
    const d = (
      window as unknown as {
        __spinthDebug: {
          __debug: {
            vmStates: Array<Record<string, unknown>>;
            vmPositions: Array<{ x: number; y: number }>;
          };
        };
      }
    ).__spinthDebug.__debug;
    const i = Math.max(
      0,
      d.vmStates.findIndex((s) => String(s.type) === t),
    );
    const p = d.vmPositions[i] ?? { x: 0, y: 0 };
    const st = d.vmStates[i] as { width?: number; height?: number } | undefined;
    // 真中心（旧实现点左上+20：选中态第二次点击落在西边 resize 热区，
    // 曾靠「resize 松手误进编辑」的旧 bug 才进得了编辑）
    const s = pub.toScreenPoint({
      x: p.x + Number(st?.width ?? 0) / 2,
      y: p.y + Number(st?.height ?? 0) / 2,
    });
    return { x: Math.round(s.x), y: Math.round(s.y + 44) };
  }, type);
}
