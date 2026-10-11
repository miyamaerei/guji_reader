/**
 * ent 层瘦身契约（P5.1）
 *
 * 打包脚本（.mjs）与前端（.ts）共用这里的常量——两处各写一份必然漂移，
 * 而漂移的后果是「索引声称不含 original、运行时却按含 original 渲染」。
 */

/** 精简索引保留的字段；其余（original/source/confidence/start/end）仅在全量文件里 */
export const ENT_INDEX_FIELDS = [
  'id',
  'eid',
  'text',
  'normalized',
  'type',
  'item_id',
  'volume',
]