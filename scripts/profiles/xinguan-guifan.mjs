/**
 * 《新官轨范》打包配置
 *
 * 源数据实测（2026-10-10）：
 *   5 层 × 11 章；条目 275（00-001 为版本说明，其余 01-001…11-015）
 *   实体标注 1981 条 / 主键 591 个（源数据直接给出 ent_id，主键明确）
 *   条目原文统一在 索引/_item_registry.json；标注层不带 original，需回查
 *
 * 与《水东日记》的差异（正是「同一套契约容纳两本结构不同的书」的验证点）：
 *   · 目录三层 volume → chapter → item（水东是两层）
 *   · 事件 / 流程层用 derived_from[] 而非 item_id 关联条目
 *   · struct 层是「五维」：ledgers / times / docs / actors / frauds，需合并成一层
 */

import fs from 'node:fs'
import path from 'node:path'
import { listFiles, readJson } from '../lib/util.mjs'

export const SRC = 'C:/Users/Administrator/DoubaoWork/chats/2026-10-09/new-chat/新官轨范_阅读器'
const RAW = path.join(SRC, 'raw')

export const bookId = 'xinguan-guifan'
export const configPath = 'src/books/xinguan-guifan/book.config.json'

/** 章号 → {卷 id, 卷名, 章名}。卷上=01 章；卷下=02（总纲）…11 章 */
export const CHAPTERS = [
  ['00', '00', '卷首', '版本说明'],
  ['01', '01', '卷上', '体立为政事情'],
  ['02', '02', '卷下', '牧民备用'],
  ['03', '02', '卷下', '上任第一'],
  ['04', '02', '卷下', '直日第二'],
  ['05', '02', '卷下', '御史第三'],
  ['06', '02', '卷下', '民情第四'],
  ['07', '02', '卷下', '公务第五'],
  ['08', '02', '卷下', '粮料第六'],
  ['09', '02', '卷下', '礼仪第七'],
  ['10', '02', '卷下', '御灾第八'],
  ['11', '02', '卷下', '词讼第九'],
]
const CH = new Map(CHAPTERS.map(([c, v, vn, cn]) => [c, { vol: v, volName: vn, name: cn }]))

export function chapterOf(iid) {
  return String(iid).split('-')[0]
}
export function volumeOf(iid) {
  return CH.get(chapterOf(iid))?.vol ?? '00'
}
export function volumeLabel(vol) {
  const hit = CHAPTERS.find(([, v]) => v === vol)
  return hit ? `${hit[2]}` : `第${vol}卷`
}

/** 章标签：卷名 + 章名，如「卷下 · 上任第一」 */
export function chapterLabel(ch) {
  const hit = CHAPTERS.find(([c]) => c === ch)
  return hit ? `${hit[2]} · ${hit[3]}` : `第${ch}章`
}

/* ------------------------------------------------------------------ */
/* 层定义                                                              */
/* ------------------------------------------------------------------ */

const ID_KEYS = {
  ent: 'id',
  event: 'event_id',
  rule: 'rule_id',
  proc: 'process_id',
  struct: null, // 五维各自不同，合并时统一为 _mid
}

export const layers = [
  {
    id: 'ent',
    dir: '标注',
    recordsKey: 'entities',
    idKey: 'id',
    itemKey: '_item_id', // 由 id 前两段推导后注入
    joinMode: 'primary',
    map: { text: 'text', type: 'type', normalized: 'normalized' },
  },
  {
    id: 'event',
    dir: '事件',
    recordsKey: 'events',
    idKey: 'event_id',
    itemKey: '_item_id', // 由 derived_from[0] 推导后注入
    map: { type: 'type', action: 'action', what: 'what', when: 'when', where: 'where', who: 'who', title: 'title' },
  },
  {
    id: 'rule',
    dir: '规则',
    recordsKey: 'rules',
    idKey: 'rule_id',
    itemKey: 'item_id',
    map: {
      type: 'type',
      modality: 'modals',
      condition: 'condition',
      subject: 'subject',
      obligation: 'obligation_action',
      prohibition: 'prohibited_action',
      permission: 'allowed_action',
      object: 'object',
      purpose: 'purpose',
      deadline: 'deadline',
      penalty: 'punishment',
    },
  },
  {
    id: 'proc',
    dir: '流程',
    recordsKey: 'processes',
    idKey: 'process_id',
    itemKey: '_item_id',
    map: { title: 'title', trigger: 'trigger', event_type: 'event_type', steps: 'steps', states: 'timeline' },
  },
  {
    id: 'struct',
    dir: '结构',
    recordsKey: null, // 五维合并
    idKey: '_mid',
    itemKey: 'item_id',
    map: { name: '_name', dimension: '_dimension', mechanism: 'mechanism' },
  },
]

/** struct 五维：维度 key → {数组名, id 字段, 名称字段, 中文维度名} */
const STRUCT_DIMS = [
  ['ledgers', 'ledger_id', 'name', '文簿'],
  ['times', 'time_id', 'keyword', '时限'],
  ['docs', 'doc_id', 'doc_type', '文书'],
  ['actors', 'actor_id', 'name', '角色'],
  ['frauds', 'fraud_id', 'fraud', '防弊'],
]

/* ------------------------------------------------------------------ */
/* 加载                                                                */
/* ------------------------------------------------------------------ */

function filesOf(dir) {
  return listFiles(path.join(RAW, dir), /^(\d{2})_.*\.json$/).filter((f) => !f.includes('归一_汇总'))
}

/** 非 struct 层：遍历章文件，注入 _item_id / _vol */
function loadFlat(layer) {
  const out = []
  for (const f of filesOf(layer.dir)) {
    const j = readJson(path.join(RAW, layer.dir, f))
    const recs = j[layer.recordsKey] || []
    for (const r of recs) {
      let iid = r[layer.itemKey === '_item_id' ? 'item_id' : layer.itemKey]
      if (!iid && r.id && layer.id === 'ent') iid = String(r.id).split('-').slice(0, 2).join('-')
      if (!iid && Array.isArray(r.derived_from)) iid = r.derived_from[0]
      if (!iid) continue
      out.push({ ...r, _item_id: iid, _vol: volumeOf(iid), _chapter: chapterOf(iid) })
    }
  }
  return out
}

function loadStruct() {
  const out = []
  for (const f of filesOf('结构')) {
    const j = readJson(path.join(RAW, '结构', f))
    for (const [arrKey, idKey, nameKey, dimName] of STRUCT_DIMS) {
      for (const r of j[arrKey] || []) {
        const iid = r.item_id || (Array.isArray(r.derived_from) ? r.derived_from[0] : null)
        if (!iid) continue
        out.push({
          ...r,
          _mid: r[idKey],
          _name: r[nameKey],
          _dimension: dimName,
          _dimKey: arrKey,
          item_id: iid,
          _vol: volumeOf(iid),
          _chapter: chapterOf(iid),
        })
      }
    }
  }
  return out
}

export function loadLayer(layer) {
  return layer.id === 'struct' ? loadStruct() : loadFlat(layer)
}

/* ------------------------------------------------------------------ */
/* 条目                                                                */
/* ------------------------------------------------------------------ */

/** 条目原文权威来源：索引/_item_registry.json（标注层不带 original，必须回查这里） */
export function originals() {
  const reg = readJson(path.join(RAW, '索引/_item_registry.json'))
  return Object.entries(reg).map(([iid, v]) => [iid, v.original || ''])
}

export function loadItems() {
  const reg = readJson(path.join(RAW, '索引/_item_registry.json'))
  return Object.keys(reg).map((iid) => ({
    item_id: iid,
    volume: volumeOf(iid),
    chapter: chapterOf(iid),
    source: '原文',
  }))
}

export const joinKey = 'item_id'

export const meta = {
  title: '《新官轨范》',
  subtitle: '明 · 佚名 · 为官施政手册',
  genre: '明代官箴（施政手册型）',
}
