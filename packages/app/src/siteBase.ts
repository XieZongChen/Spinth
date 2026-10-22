/** 站点基路径：Vite 构建时注入，dev 为 '/'，始终以 '/' 结尾。 */
export const SITE_BASE = import.meta.env.BASE_URL;

/** 文档 URL：只改前缀，?doc= 语义不变。 */
export function docUrl(docId: string): string {
  return `${SITE_BASE}?doc=${encodeURIComponent(docId)}`;
}

/** public/ 资源 URL（name 不带前导 '/'）。 */
export function publicAsset(name: string): string {
  return `${SITE_BASE}${name.replace(/^\/+/, '')}`;
}
