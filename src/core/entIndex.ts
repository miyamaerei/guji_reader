/**
 * ent 层瘦身（P5.1）
 *
 * 问题：水东 `layers/ent.json` 单文件 2.5MB / 2253 条，其中 **`original`
 * （书证全文）占 83%（701KB）**。但实体列表只需 text / type / eid / item_id 做
 * 筛选与展示，书证全文只有点开某条实体详情时才需要——现在每次进实体层
 * 就把701KB 一起下载了。
 *
 * 方案：**列表读精简索引，详情按需取全文**。
 *  · `ent-index.json`  —— 去掉 original/source/confidence/start/end，约 140KB
 *  · `layers/ent.json`  —— 保留全量（含书证），仅详情与导出用
 *
 * ⚠️ 这是「双文件」而非「删字段」：书证是学术引用的核心，不能为了体积丢掉。
 * 前端按需取即可，没必要让列表页替详情页买单。
 *
 * 打包期由 `npm run data` 生成；运行时由 layers store 决定读哪个。
 */

import { ENT_INDEX_FIELDS as SHARED_ENT_INDEX_FIELDS } from '../../scripts/lib/ent-fields.mjs'
import type { LayerRecord } from './types'

/**
 * 精简索引保留的字段。
 *
 * ⚠️ 从打包脚本 `scripts/lib/ent-fields.mjs` 单一来源引入，不在此处复写一份——
 * 两处各写必然漂移，而漂移的后果是「索引声称不含 original、运行时却按含
 * original 渲染」，属于静默出错，单测也难覆盖。
 */
export const ENT_INDEX_FIELDS: readonly string[] = SHARED_ENT_INDEX_FIELDS

/** 判定一条记录是否适合放进精简索引（字段齐备、无需全文） */
export function toEntIndexRecord(rec: LayerRecord): LayerRecord {
  const out: Record<string, unknown> = {}
  for (const k of ENT_INDEX_FIELDS) {
    const v = rec[k]
    if (v !== undefined) out[k] = v
  }
  return out as LayerRecord
}

export interface EntIndexFile {
  layer: string
  count: number
  /** true 表示索引已带书证全文，无需再读全量文件 */
  full: boolean
  records: LayerRecord[]
}

/**
 * 索引是否够用：给定所需字段集合，判断精简索引能否满足。
 * 用于运行时自检——若将来某视图需要 original，索引不够会立刻暴露，
 * 而不是悄悄渲染出空的证据块。
 */
export function entIndexSufficient(needed: readonly string[], index: EntIndexFile): boolean {
  if (index.full) return true
  return needed.every((f) => ENT_INDEX_FIELDS.includes(f))
}