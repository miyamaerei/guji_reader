/**
 * 《水东日记》打包配置
 *
 * 源数据实测（2026-10-10）：
 *   8 层 × 38 卷；条目 1192（卷 01–38，记译文本与 trl 层一致）
 *   实体标注 2253 条 / 主键 1900 个（ENT-NNN 是主键，同键可跨条目复现）
 *   各层记录自带 original（无标点古文全文），跨层 1192 条完全一致 → 原文唯一可信
 *
 * 已知缺口：
 *   - join 里卷「00」有 5 条全空条目，各层均无数据，打包时剔除。
 *   - event 层缺 source/confidence，appt/reg/lit/nam/rel/trl 缺 source → 打包期补全并标记。
 */

import fs from 'node:fs'
import path from 'node:path'
import { listFiles, readJson } from '../lib/util.mjs'

export const SRC = 'C:/Users/Administrator/DoubaoWork/chats/2026-10-10/new-chat-2'
const DATA = path.join(SRC, 'data')
const MD = path.join(SRC, '交付物/全书记译文本/《水东日记》全书记译文本（38卷合册）.md')

export const bookId = 'shuidong-riji'
export const configPath = 'src/books/shuidong-riji/book.config.json'

/** 卷标题：从记译文本 md 解析（源数据里唯一带中文卷名的地方） */
const _titles = (() => {
  const md = fs.readFileSync(MD, 'utf8')
  const map = new Map()
  const re = /^##\s+(.+?)（第(\d{2})卷）/gm
  let m
  while ((m = re.exec(md))) map.set(m[2], m[1])
  return map
})()

export function volumeTitles() {
  return _titles
}

/** 卷标签：优先用 md 里的中文卷名，缺失时退化为「第NN卷」 */
export function volumeLabel(vol) {
  return _titles.get(vol) || `第${vol}卷`
}

/** 层定义：目录 / 记录键 / 主键字段 / 字段映射（源 → 契约） */
export const layers = [
  {
    id: 'ent',
    dir: 'ent',
    recordsKey: 'annotations',
    idKey: 'id',
    itemKey: 'item_id',
    /** 该层记录不进 join 的 ids（mention 量大，join 只存主键层） */
    joinMode: 'primary',
    map: { text: 'text', type: 'type', normalized: 'normalized' },
  },
  {
    id: 'event',
    dir: 'event',
    recordsKey: 'records',
    idKey: 'event_id',
    itemKey: 'item_id',
    map: { type: 'type', action: 'action', what: 'what', when: 'when', where: 'where', who: 'who' },
  },
  {
    id: 'appt',
    dir: 'appt',
    recordsKey: 'records',
    idKey: 'appointment_id',
    itemKey: 'item_id',
    map: { person: 'person', office: 'office', institution: 'institution', when: 'when', status: 'status', evidence: 'evidence' },
  },
  {
    id: 'reg',
    dir: 'reg',
    recordsKey: 'records',
    idKey: 'reg_id',
    itemKey: 'item_id',
    // 源字段 content 对应契约 summary（book.config 里声明的是 summary）
    map: { name: 'name', type: 'type', summary: 'content', institutions: 'institutions', officials: 'officials' },
  },
  {
    id: 'lit',
    dir: 'lit',
    recordsKey: 'records',
    idKey: 'lit_id',
    itemKey: 'item_id',
    map: { title: 'title', author: 'author', type: 'type', text: 'content_location' },
  },
  {
    id: 'nam',
    dir: 'nam',
    recordsKey: 'records',
    idKey: 'nam_id',
    itemKey: 'item_id',
    map: { name: 'name', type: 'category', range: 'scope', entries: 'entries', evidence: 'evidence' },
  },
  {
    id: 'rel',
    dir: 'rel',
    recordsKey: 'records',
    idKey: 'rel_id',
    itemKey: 'item_id',
    // 源字段 relation_type 对应契约 type
    map: { person_a: 'person_a', person_b: 'person_b', type: 'relation_type', direction: 'direction', evidence: 'evidence' },
  },
  {
    id: 'trl',
    dir: 'trl',
    recordsKey: 'records',
    idKey: 'trl_id',
    itemKey: 'item_id',
    map: { translation: 'translation', style: 'style', note: 'note' },
  },
]

/** 加载某一层的全部记录（跨卷合并，附 _vol） */
export function loadLayer(layer) {
  const dir = path.join(DATA, layer.dir)
  const re = new RegExp(`^${layer.dir}_(\\d{2})\\.json$`)
  const out = []
  for (const f of listFiles(dir, re)) {
    const j = readJson(path.join(dir, f))
    const recs = Array.isArray(j) ? j : j[layer.recordsKey] || []
    const vol = j.volume || f.slice(-7, -5)
    for (const r of recs) out.push({ ...r, _vol: vol })
  }
  return out
}

/** 条目清单与原文：join 为骨架，原文从层记录取（已验证跨层唯一） */
export function loadItems() {
  const join = readJson(path.join(DATA, 'join/_kg_join.json'))
  return join.filter((r) => r.volume !== '00' && r.item_id.slice(0, 2) !== '00')
}

export const joinKey = 'item_id'
export const meta = {
  title: '《水东日记》',
  subtitle: '明·叶盛 · 典章制度类笔记',
  genre: '明代笔记（典章制度型）',
}
