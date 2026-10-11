/**
 * 《蘧编》（明·叶向高）打包配置
 *
 * 源数据实测（2026-10-10，new-chat-7/qubian_kb）：
 *   76 条指纹库，入层 71 条（卷 01-20）；卷 00 序/前言 2、21 后记 2、22 附录 1 不入层
 *   8 层 × 71 条：
 *     ents 997 / appts 63 / evts 281 / rels 338 / lits 9 / mems 114 / chrs 71 / trls 71
 *   ID 段位：卷 NN × 500 + 卷内层内序号，前缀 ENT-/APPT-/EVT-/REL-/LIT-/MEM-/CHR-/TRL-
 *
 * 与水东/新官的关键差异：
 *   · **年谱体**——条目是「某年某事」（如「万历四十一年癸丑（1613年），余五十五岁。」），
 *     而非笔记条目或官箴条目。故 chrs（年谱纪年）是本书特有的核心层。
 *   · mems（奏疏谕旨互动）是本书特有层，上疏/具揭/传谕/谕旨 + 结果（允准/不允/留中/未报）。
 *   · 每条记录都**重复携带整条 original 书证全文**——同条目几十条记录各存一份，
 *     是体积爆炸的主因。转换时按 item_id 回查统一注入，不额外占层文件空间
 *     （构建器本就用 originalOf 回填，此处只保证口径一致）。
 *   · 源 ents 记录带 start/end 与 ent_id；ent_id 是聚合后的实体主键，
 *     构建器会按 normalized 重新聚合，两者应一致（validate 时可交叉核对）。
 *
 * 已知缺口（如实登记，不阻断）：
 *   - 209 处 ent start/end 为 null（规范名 vs 原文变体/异体/缺字 ☐），
 *     构建器会走 L2/L3 定位兜底，未命中则正文不着色。
 *   - lits 仅 9 条、trls 全部为「注释性翻译」，样本小，chip 筛选意义有限。
 */

import path from 'node:path'
import { readJson } from '../lib/util.mjs'

export const SRC = 'C:/Users/Administrator/DoubaoWork/chats/2026-10-10/new-chat-7/qubian_kb'

export const bookId = 'qubian'
export const configPath = 'src/books/qubian/book.config.json'

/** 条目指纹库：iid -> {original, title, volume, in_layer} */
const REGISTRY = readJson(path.join(SRC, '_item_registry.json'))
/** 跨层索引：records[iid] = {item_id, volume, title, layers:{层:[id]}} */
const JOIN = readJson(path.join(SRC, '_kg_join.json'))

/**
 * 条目清单：只取入层条目（in_layer=true），与 _kg_join.records 的 71 条一致。
 * 00 序/前言（00-001/00-002）、21 后记（21-001/21-002）、22 附录（22-001）不入层。
 */
export function loadItems() {
  const out = []
  for (const [iid, rec] of Object.entries(JOIN.records)) {
    const reg = REGISTRY[iid]
    if (!reg) continue
    if (reg.in_layer === false) continue
    out.push({
      item_id: iid,
      volume: rec.volume ?? reg.volume,
      title: rec.title ?? reg.title,
      source: '蘧编（明·叶向高）',
    })
  }
  return out
}

/**
 * 条目原文：统一从指纹库取。
 *
 * 不用层记录的 original —— 那样会把同一段全文在几十条记录里各存一份，
 * 体积翻十几倍；且各层 original 理论上应一致（以指纹库为唯一权威）。
 */
export function originals() {
  const out = new Map()
  for (const [iid, rec] of Object.entries(REGISTRY)) {
    if (rec.in_layer === false) continue
    if (rec.original) out.set(iid, rec.original)
  }
  return out
}

/** 卷标签：年谱体按「卷NN」即可，卷内首条标题已在目录里 */
export function volumeLabel(vol) {
  return `卷${vol}`
}

/**
 * 层定义。字段映射遵循契约（见 docs/data-contract.md）。
 *
 * joinMode:'primary' 仅用于 ent —— mention 量 997 条远大于其他层，
 * join 的 ids 数组会显著膨胀；ent 层的 id 由构建器改写为 mention 唯一 id，
 * 故主键层不进 join（与水东一致）。
 */
export const layers = [
  {
    id: 'ent',
    dir: 'ents',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    joinMode: 'primary',
    map: { text: 'text', type: 'type', normalized: 'normalized' },
  },
  {
    id: 'appt',
    dir: 'appts',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    // person/institution 是纯文本，源数据无 ent 引用 —— 与 P3 水东 appt 同样按文本聚合
    map: { person: 'person', office: 'office', institution: 'institution', when: 'when', status: 'status' },
  },
  {
    // 层 id 用契约规定的 'event'（公共必配层 PUBLIC_LAYER_IDS = ['ent','event']），
    // 源目录名是 evts —— dir 指向源文件，id 是项目内约定，两者不必同名。
    id: 'event',
    dir: 'evts',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    map: { type: 'type', who: 'who', action: 'action', what: 'what', when: 'when', where: 'where' },
  },
  {
    id: 'rel',
    dir: 'rels',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    map: { person_a: 'person_a', person_b: 'person_b', type: 'type', direction: 'direction' },
  },
  {
    id: 'lit',
    dir: 'lits',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    // 源字段实测：title/author/type/content_location（不是 name/text）
    map: { title: 'title', author: 'author', type: 'type', text: 'content_location' },
  },
  {
    id: 'mem',
    dir: 'mems',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    map: { actor: 'actor', target: 'target', type: 'type', issue: 'issue', response: 'response', result: 'result' },
  },
  {
    id: 'chr',
    dir: 'chrs',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    // era/year/age 三件套是年谱体的核心：year 是绝对年（1559 起），
    // age 是年差（age = year − 1559，出生年 0），与 trl 首句虚岁标注并存的既定设计。
    map: { era: 'era', year: 'year', age: 'age', category: 'category', summary: 'summary', first_person: 'first_person' },
  },
  {
    id: 'trl',
    dir: 'trls',
    recordsKey: 'records',
    idKey: 'id',
    itemKey: 'item_id',
    map: { translation: 'translation', style: 'style' },
  },
]

/**
 * 加载某一层的全部记录（层聚合文件本身已是 {layer,count,records}）
 *
 * ⚠️ 关键：**剥离每条记录自带的 original**。
 * 源数据里每条记录都重复携带整条书证全文——appt 仅 63 条却占 706KB、
 * ent 997 条达 10.8MB，全是同一段原文的几十份拷贝。转换时丢掉 original，
 * 构建器会用 `originalOf`（来自指纹库）统一回填，语义完全一致、体积降一个量级。
 * 不这么做的话，本书光层文件就会拖垮首屏（且这些全文本来也用不上：
 * 列表不展示书证，详情按 item_id 回查即可）。
 */
export function loadLayer(layer) {
  const j = readJson(path.join(SRC, `归一_${layer.dir}.json`))
  const recs = Array.isArray(j) ? j : j[layer.recordsKey] || []
  return recs.map((r) => {
    const { original, ...rest } = r
    return { ...rest, _vol: r.volume }
  })
}

export const joinKey = 'item_id'
export const meta = {
  title: '《蘧编》',
  subtitle: '明·叶向高 · 纪年体士人年谱',
  genre: '明代年谱（纪年编年体）',
}