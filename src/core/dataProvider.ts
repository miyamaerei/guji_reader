/**
 * 数据加载（P7 联邦数据库形态）
 *
 * 数据源已从 public/data/<bookId>/*.json 静态包切换为后端 SQLite 只读 API
 * （server/sqlite-api.mjs，查询联邦库 kb.sqlite）。
 *
 * 方法签名与历史版本完全一致——bookRegistry / layers store / 五个视图的
 * 调用点零改动；数据契约（BookConfig/BookMeta/ItemChunk/LayerFile/JoinFile…）
 * 由后端按联邦库实时推导，无需打包器参与。
 * P8 新增 layerPage：总览页服务端分页（历史全量方法保留给阅读器详情反查）。
 */
import { api } from './api'

export const dataProvider = {
  manifest: () => api.books(),
  config: (bookId: string) => api.config(bookId),
  meta: (bookId: string) => api.meta(bookId),
  chapters: (bookId: string) => api.chapters(bookId),
  /** 卷级 chunk：进卷才加载 */
  itemChunk: (bookId: string, volume: string) => api.itemChunk(bookId, volume),
  /** 分层记录表：列表页瘦身（无书证），详情需要书证时走 layer(id, {itemId, full}) */
  layer: (bookId: string, layerId: string, opts?: { itemId?: string; full?: boolean }) =>
    api.layer(bookId, layerId, opts),
  /** 层记录分页（总览页触底续读，见 core/api.ts layerPage） */
  layerPage: (
    bookId: string,
    layerId: string,
    page: { offset: number; limit: number; field?: string; value?: string },
  ) => api.layerPage(bookId, layerId, page),

  /**
   * ent 层精简索引：实体列表只需 text/type/eid 做筛选展示，
   * 书证全文由详情页按需走 `layer(id, {itemId, full})` 取回。
   */
  entIndex: (bookId: string) => api.entIndex(bookId),
  entities: (bookId: string) => api.entities(bookId),
  join: (bookId: string) => api.join(bookId),
  enums: (bookId: string) => api.enums(bookId),
  searchIndex: (bookId: string) => api.searchIndex(bookId),
}

export function clearDataCache(): void {
  // SQLite 侧无前端内存缓存：API 数据实时查询，本函数保持兼容空实现
}