/**
 * 路由辅助（P2.9 修复）
 *
 * 整页详情路由为 `/detail/:book/:kind/:id`——book 是必填的第一段。
 * 之前 DetailPanel 拼成 `/detail/item/<iid>`（缺 book 段），
 * 命中 catch-all 被强制跳回首页，等于「整页」按钮失效。
 * 这里统一构造，避免再出现段数错位。
 */
export type DetailKind = 'item' | 'entity' | string

/** 构造整页详情的 hash 路径；bookId 必填，缺失时退回书架，不会产出错误段数 */
export function detailHref(bookId: string, kind: DetailKind, id: string): string {
  if (!bookId) return '#/'
  return `#/detail/${encodeURIComponent(bookId)}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`
}
