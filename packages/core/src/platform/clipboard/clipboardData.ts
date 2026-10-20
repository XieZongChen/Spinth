import type { IWidgetData } from '../../types';
import type { IRect } from '../../common/geometry';

/**
 * 剪贴板序列化纯逻辑（docs/09 §1）：
 * 写入双格式（text/plain JSON 快照 + text/html 的 data-spinth 标签，同源数据），
 * 粘贴解析 plain JSON 优先、html 标签兜底。私有 MIME 浏览器 write() 不支持。
 */

export const SPINTH_CLIPBOARD_MAGIC = 'data-spinth';

export interface IWidgetSnapshot {
  data: IWidgetData;
  bounds: IRect;
}

export function serializeToHtml(snapshots: IWidgetSnapshot[]): string {
  const json = JSON.stringify(snapshots);
  // encodeURIComponent 处理 Unicode；base64 供 HTML 属性安全携带
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `<span ${SPINTH_CLIPBOARD_MAGIC}="${b64}"></span>`;
}

export function parseFromHtml(html: string): IWidgetSnapshot[] | null {
  const match = html.match(new RegExp(`${SPINTH_CLIPBOARD_MAGIC}="([^"]+)"`));
  if (!match) return null;
  try {
    const json = decodeURIComponent(escape(atob(match[1]!)));
    return validateSnapshots(JSON.parse(json));
  } catch {
    return null;
  }
}

/** 结构校验：数组 + 每项含 data(有 id/type) 与 bounds */
export function validateSnapshots(value: unknown): IWidgetSnapshot[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: IWidgetSnapshot[] = [];
  for (const item of value) {
    const data = (item as { data?: unknown }).data;
    const bounds = (item as { bounds?: unknown }).bounds;
    if (
      data &&
      typeof data === 'object' &&
      typeof (data as { id?: unknown }).id === 'string' &&
      typeof (data as { type?: unknown }).type === 'string' &&
      bounds &&
      typeof bounds === 'object'
    ) {
      out.push({ data: data as IWidgetData, bounds: bounds as IRect });
    }
  }
  return out.length > 0 ? out : null;
}

/** 粘贴优先级解析（docs/09 §1）：私有 JSON > HTML 标签 */
export function parsePastePayload(
  plain: string | undefined,
  html: string | undefined,
): IWidgetSnapshot[] | null {
  if (plain) {
    const fromPlain = validateSnapshots(safeJsonParse(plain));
    if (fromPlain) return fromPlain;
  }
  if (html) {
    const fromHtml = parseFromHtml(html);
    if (fromHtml) return fromHtml;
  }
  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
