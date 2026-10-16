/**
 * 联邦库（kb.sqlite）元数据与派生逻辑（只读）
 *
 * 纯函数集合：把联邦库表结构映射成 reader-vue 前端契约所需的形态
 * （BookConfig / BookMeta / ChapterNode / ItemChunk / LayerFile / JoinFile /
 *  EnumFile / EntityTable / SearchIndexFile / 远程检索与联邦关联结果）。
 *
 * 口径（与《联邦线》三份设计文档一致）：
 *  · 复合主键 (book_id, …) 隔离撞号；book_id 用联邦短码（sdr/qb/xgf/xyf/kzz/wzz/lgs/xzl）
 *  · 条目主键 iid = items.item_id（章-序号）；卷 00 为过渡数据一律剔除
 *  · 原文唯一可信源 = ent 层 records.payload.original（items.title 近乎为空）
 *  · 联邦库无 span 偏移 → 实体着色用「原文字符串定位词形」降级生成 span
 */
import { readFileSync } from 'node:fs'

/** 层中文名（未知层回退原文键） */
export const LAYER_LABELS = {
  ent: '实体',
  appt: '职官任职',
  event: '事件',
  evt: '事件',
  rel: '人物关系',
  trl: '译文',
  lit: '文献资产',
  nam: '名录谱牒',
  reg: '典章制度',
  opn: '论说',
  cus: '风俗',
  ming: '名物',
  geo: '地理',
  obj: '物事',
  cit: '引书',
  proc: '流程',
  rule: '规则',
  struct: '结构',
  actor: '人物',
  doc: '文书档案',
  fraud: '防弊',
  ledger: '账册',
  time: '时间',
  chr: '年谱纪事',
  mem: '记录',
}

/** 层徽标缩写（未知层取键前两字母大写） */
export const LAYER_TAGS = {
  ent: 'EN',
  appt: 'AP',
  event: 'EV',
  evt: 'EV',
  rel: 'RE',
  trl: 'TR',
  lit: 'LI',
  nam: 'NA',
  reg: 'RG',
  opn: 'OP',
  cus: 'CU',
  ming: 'MG',
  geo: 'GE',
  obj: 'OB',
  cit: 'CI',
  proc: 'PR',
  rule: 'RU',
  struct: 'ST',
  actor: 'AC',
  doc: 'DC',
  fraud: 'FD',
  ledger: 'LD',
  time: 'TM',
  chr: 'CH',
  mem: 'ME',
}

/** 字段中文名（未知字段回退原文键） */
export const FIELD_LABELS = {
  item_id: '条目',
  volume: '卷',
  layer: '层',
  id: '编号',
  ent_id: '实体主键',
  appointment_id: '任职主键',
  text: '词形',
  normalized: '归一词',
  norm: '归一',
  type: '类型',
  confidence: '置信度',
  original: '原文',
  translation: '译文',
  style: '风格',
  note: '注释',
  person: '人物',
  who: '主体',
  author: '作者',
  office: '官职',
  institution: '机构',
  place: '地点',
  where: '地点',
  when: '时间',
  time: '时间',
  status: '状态',
  evidence: '书证',
  action: '行为',
  what: '对象',
  summary: '内容摘要',
  name: '名称',
  title: '篇名',
  content: '内容',
  person_a: '人物甲',
  person_b: '人物乙',
  _layer: '层',
  act_type: '行为类型',
  actor: '行事者',
  actor_id: '行事者主键',
  affiliation: '隶属',
  age: '年岁',
  agent: '行为者',
  alias: '别名',
  allowed_action: '许为之事',
  analysis: '解析',
  anti_fraud: '防弊',
  attributes: '属性',
  author_ent_ids: '作者实体',
  chapter: '章',
  check: '核查',
  cit_id: '引文主键',
  citation_type: '引文类型',
  cited_work: '所引文献',
  condition: '条件',
  content_location: '内容定位',
  context: '语境',
  count: '计数',
  countermeasure: '对策',
  cus_id: '词条编号',
  deadline: '期限',
  derived_from: '派生自',
  derived_rule: '派生规则',
  description: '描述',
  detail: '细节',
  dim: '维度',
  doc_id: '文书主键',
  doc_type: '文书类型',
  duties: '职掌',
  ent_ids: '实体主键',
  entry: '事项',
  era: '时代',
  event_id: '事件主键',
  event_type: '事件类型',
  events: '事件集',
  evidence_refs: '书证引用',
  evolution: '沿革',
  example: '例证',
  first_person: '首述者',
  first_source: '最初出处',
  flow: '流程',
  format: '形制',
  fraud: '舞弊',
  fraud_id: '舞弊主键',
  frd_type: '防弊类型',
  frequency: '频次',
  geo_id: '地理主键',
  history: '沿革',
  institution_ent_ids: '机构实体',
  institutions: '机构集',
  is_combo: '是否复合',
  issue: '议题',
  item: '事项',
  keeper: '经管人',
  keyword: '关键词',
  ledger_id: '簿书主键',
  lgr_type: '簿书类型',
  lit_id: '文献主键',
  location: '位置',
  lore: '典故',
  mechanism: '手法',
  mechanism_type: '手法类型',
  ming_id: '名号主键',
  modals: '模态词',
  nam_id: '名称主键',
  names: '名称集',
  next_process: '后续流程',
  obj_id: '器物主键',
  object: '对象',
  obligation_action: '当为之事',
  official_ent_ids: '官员实体',
  officials: '官员集',
  opn_id: '见解主键',
  original_offset: '原文偏移',
  person_a_ent_ids: '人物甲实体',
  person_b_ent_ids: '人物乙实体',
  person_ent_ids: '人物实体',
  primary_type: '主类型',
  process_id: '流程主键',
  prohibited_action: '禁为之事',
  prohibited_effect: '违碍之效',
  punishment: '责罚',
  purpose: '用意',
  ref_events: '关联事件',
  reg_id: '制度主键',
  region: '地域',
  rel_id: '关系主键',
  related_item: '关联条目',
  relations: '关系集',
  response: '应答',
  responsibility: '职责',
  role: '角色',
  role_ent_ids: '角色实体',
  role_type: '角色类型',
  rule_id: '规则主键',
  source: '出处',
  stages: '阶段',
  state_machine: '状态机',
  steps: '步骤',
  struct_id: '结构主键',
  subject: '主体',
  subject_ent_ids: '主体实体',
  target_ent_ids: '对象实体',
  template_fields: '模板字段',
  term: '词条',
  time_id: '时序主键',
  timeline: '时间线',
  tme_type: '时序类型',
  trl_id: '译本主键',
  unit: '单位',
  usage_note: '用法注记',
  value: '取值',
  who_ent_ids: '相关人物实体',
  year: '年份',
  relation_type: '关系类型',
  direction: '方向',
  topic: '论题',
  stance: '立场',
  argument: '论证',
  trigger: '触发',
  start: '起始',
  end: '结束',
  surfaces: '词形集',
  scope: '范围',
  entries: '条目表',
  category: '类别',
  institution_id: '机构主键',
  office_name: '官职名',
  person_name: '人名',
  regulator: '规制者',
  target: '对象',
  reason: '缘由',
  result: '结果',
  payload: '负载',
}

/** 候选枚举字段名（值域小 → chips 筛选） */
export const ENUM_CANDIDATES = new Set([
  'type',
  'status',
  'style',
  'direction',
  'relation_type',
  'category',
  'stance',
  'kind',
  'reading_mode',
  'layer',
])

/** 候选引用字段名（指向实体层） */export const REF_CANDIDATES = new Set([
  'person',
  'who',
  'author',
  'place',
  'where',
  'institution',
  'person_a',
  'person_b',
  'normalized',
])

/** 长文本字段：不做枚举统计、列表 view 隐藏 */
export const LONG_TEXT_FIELDS = new Set([
  'original',
  'translation',
  'evidence',
  'note',
  'summary',
  'argument',
  'content',
  'entries',
  'text',
])

/** 书的主题色（按书架顺序取色，确定性映射） */
export const BOOK_COLORS = [
  '#7b3f00',
  '#185fa5',
  '#0f6e56',
  '#534ab7',
  '#a32d2d',
  '#854f0b',
  '#2f7d6e',
  '#6b4f8f',
  '#b2552e',
  '#3a7a3a',
]

/**
 * 实体类型默认配色（A6）。
 *
 * 前 8 色与 JSON 数据包盘同源（src/books/<bookId>/book.config.json），
 * 保证同一 type 在 JSON 模式与联邦模式下同色；后 13 色覆盖联邦库
 * 政书类实测的扩展 type（kb.sqlite nodes/records 值域全量 21 种：
 * person/place/work/official/object/era/system/institution/unknown/
 * behavior/doc/animal/time/plant/document/quantity/org/punishment/
 * event/food/posthumous）。
 *
 * 派生 config 时按各书 ent 层实际 type 值域取色；未覆盖的新 type 走
 * entityTypeColor() 的确定性回退，无需改代码。
 */
export const DEFAULT_ENTITY_TYPE_COLORS = {
  // —— JSON 数据包标准盘 ——
  person: '#534ab7',
  place: '#0f6e56',
  official: '#185fa5',
  work: '#993c1d',
  institution: '#a32d2d',
  era: '#854f0b',
  posthumous: '#5f5e5a',
  unknown: '#888780',
  // —— 联邦库扩展 type ——
  object: '#0e7490',
  system: '#7e22ce',
  behavior: '#4d7c0f',
  doc: '#334155',
  animal: '#be123c',
  time: '#a21caf',
  plant: '#15803d',
  document: '#b45309',
  quantity: '#1d4ed8',
  org: '#0f766e',
  punishment: '#86198f',
  event: '#065f46',
  food: '#9d174d',
}

/** 未覆盖 type 的回退调色板（浅底可读的深色系，按哈希确定性取色） */
export const ENTITY_TYPE_FALLBACK_COLORS = [
  '#0e7490',
  '#7e22ce',
  '#4d7c0f',
  '#334155',
  '#be123c',
  '#a21caf',
  '#15803d',
  '#b45309',
  '#1d4ed8',
  '#0f766e',
]

/**
 * 实体类型 → 颜色：已知 type 用标准盘，未知 type 按类型名哈希回落色板，
 * 保证「同 type 恒同色」（跨书、跨请求一致）。
 */
export function entityTypeColor(type) {
  const known = DEFAULT_ENTITY_TYPE_COLORS[type]
  if (known) return known
  let h = 0
  for (const ch of String(type ?? '')) h = (h * 31 + ch.codePointAt(0)) % 1000003
  return ENTITY_TYPE_FALLBACK_COLORS[h % ENTITY_TYPE_FALLBACK_COLORS.length]
}

/**
 * 卡片标题候选字段（按优先级取第一个存在的）。
 * 全部是通用字段名，不绑定任何书——某书没有就顺延下一个；
 * 都没有时前端回落到「第一个非空短字符串字段」。
 */
const TITLE_PREFERENCE = [
  'term',
  'name',
  'title',
  'person',
  'office',
  'official',
  'action',
  'what',
  'who',
  'object',
  'subject',
  'topic',
  'keyword',
  'alias',
  'cited_work',
  'names',
  'era',
  'author',
  'institution',
  'place',
  'location',
  'person_a',
  'entry',
  'keeper',
  'role_type',
  'duty',
]

/** 系统字段：记录主键本身与层标记/外键，卡片列表里不占行（主键已在卡头） */
function isSystemField(k) {
  return k === 'id' || k.startsWith('_') || (k.endsWith('_id') && k.length > 3)
}

export function layerLabel(key) {
  return LAYER_LABELS[normLayerKey(key)] ?? key
}

export function layerTag(key) {
  return LAYER_TAGS[normLayerKey(key)] ?? key.slice(0, 2).toUpperCase()
}

/**
 * 联邦层键 → 规范层 id（前端契约键）。
 * 联邦线各书层键命名不统一：政学录(xzl)的「事件」层在库里键为 evt，
 * 其余各书为 event。归一后前端一律按 event 消费；
 * 派生 SQL 按层查库时用 rawLayerKey 回转真实库键。
 */
export const LAYER_KEY_ALIAS = { evt: 'event' }

export function normLayerKey(key) {
  return LAYER_KEY_ALIAS[key] ?? key
}

export function rawLayerKey(key) {
  return Object.keys(LAYER_KEY_ALIAS).find((k) => LAYER_KEY_ALIAS[k] === key) ?? key
}

/**
 * 前端层键 → 库内候选键集合（原名 + 别名，双向），派生 SQL 用 `IN (...)` 匹配。
 *
 * 为什么不能只用 rawLayerKey 单选：别名表 {evt:'event'} 反查会把 'event'
 * 恒转成 'evt'，但库里 xzl/ysz 用 'evt'、sdr/kzz/qb/wzz/xgf/xyf 直接用
 * 'event'——单选必然漏掉一半书，event 层全线 404（走查 2026-10-13：详情空白、
 * 总览「事件」tab 数据缺失）。同时纳入原名与别名即可覆盖两种库键。
 */
export function layerKeyCandidates(key) {
  const out = new Set([key])
  const raw = rawLayerKey(key)
  if (raw) out.add(raw)
  const norm = normLayerKey(key)
  if (norm) out.add(norm)
  return [...out]
}

/**
 * 字段中文名（未知字段回退原文键）。
 * 通用规则（不写死任何书）：`<基名>_id` → `<基名>主键`、`<基名>_ent_ids` → `<基名>实体`，
 * 基名在字典里才拼装，否则原样回退——避免把未登记的新字段显示成半英半中。
 */
export function fieldLabel(f) {
  if (FIELD_LABELS[f]) return FIELD_LABELS[f]
  if (f.endsWith('_ent_ids')) {
    const base = fieldLabel(f.slice(0, -'_ent_ids'.length))
    if (base !== f.slice(0, -'_ent_ids'.length)) return `${base}实体`
  }
  if (f.endsWith('_id') && f.length > 3) {
    const stem = f.slice(0, -'_id'.length)
    const base = fieldLabel(stem)
    if (base !== stem) return `${base}主键`
  }
  return f
}

export function bookColor(bookId, books) {
  const idx = Array.isArray(books) ? books.findIndex((b) => b.book_id === bookId) : -1
  return BOOK_COLORS[Math.max(0, idx) % BOOK_COLORS.length]
}

/**
 * 书籍元信息（book_meta 表；种子见 server/book-meta.seed.sql）。
 *
 * 联邦库 books 表只有 book_id/name/统计字段，朝代/作者/体裁由这张辅助表带出。
 * 表不存在或该书无行 → null，调用方一律回落统计派生（老库不灌种子也能跑）。
 * 表存在性按 db 实例缓存，避免每本书重复查 sqlite_master。
 */
const bookMetaTableCache = new WeakMap()

export function bookMetaOf(db, bookId) {
  let exists = bookMetaTableCache.get(db)
  if (exists === undefined) {
    exists = !!db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='book_meta'")
      .get()
    bookMetaTableCache.set(db, exists)
  }
  if (!exists) return null
  const row = db.prepare('SELECT * FROM book_meta WHERE book_id = ?').get(bookId)
  if (!row) return null
  return {
    dynasty: String(row.dynasty ?? ''),
    author: String(row.author ?? ''),
    genre: String(row.genre ?? ''),
    subject: String(row.subject ?? ''),
    source: String(row.source ?? ''),
    confidence: String(row.confidence ?? ''),
    note: String(row.note ?? ''),
  }
}

export function parsePayload(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * 实体主键：优先 payload.ent_id，否则从 local_id 拆（sdr 形如 '01:ENT-001'；
 * qb/xgf 的 local_id 直接是 'ENT-501'，拆冒号后仍为自身）。
 * 返回值与 nodes 表（entities 端点、span.eid）口径一致。
 */
export function eidOf(payload, localId) {
  if (payload && payload.ent_id) return payload.ent_id
  const tail = String(localId ?? '').split(':').pop()
  return tail || null
}

/**
 * span 定位（联邦库无统一偏移约定，双策略降级）：
 *  · payload.start/end 存在且能精确切出词形（slice(original)===text）→ 直接采用
 *  · 否则用 original.indexOf(text)（找到才生成，找不到返回 null）
 * 任意策略都保证 text.slice(s,e)===span.text 不变量成立。
 */
export function spanLoc(payload, original, word) {
  if (typeof payload.start === 'number' && typeof payload.end === 'number' && word) {
    const e = payload.end
    if (e <= original.length && original.slice(payload.start, e) === word) {
      return { s: payload.start, e }
    }
  }
  if (!word) return null
  const s = original.indexOf(word)
  if (s < 0) return null
  return { s, e: s + word.length }
}

/** 转义 LIKE 通配符（% _），并包成 %term% */
export function like(term) {
  return `%${String(term).replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

/** 卷/条目级 id 序列化辅助 */
export function volLabel(id) {
  return `第${id}卷`
}

/* ------------------------------------------------------------------ */
/* BookConfig 推导（layer_catalog + layer_fields + 实际值域）           */
/* ------------------------------------------------------------------ */

export function deriveConfig(db, bookId) {
  const book = db
    .prepare('SELECT * FROM books WHERE book_id = ?')
    .get(bookId)
  if (!book) return null
  const books = db.prepare('SELECT book_id FROM books ORDER BY book_id').all()
  const catalog = db
    .prepare(
      "SELECT * FROM layer_catalog WHERE book_id = ? AND status = 'enabled' ORDER BY layer_key",
    )
    .all(bookId)
  const items = db
    .prepare(
      "SELECT COUNT(*) n, COUNT(DISTINCT volume) v FROM items WHERE book_id = ? AND volume <> '00'",
    )
    .get(bookId)

  const layers = catalog.map((lc) => {
    const fieldsRaw = db
      .prepare(
        'SELECT field_name, field_type, role, ref_layer FROM layer_fields WHERE book_id = ? AND layer_key = ? ORDER BY field_name',
      )
      .all(bookId, lc.layer_key)

    // —— 字段声明：文本字段直接声明；候选枚举字段统计值域决定是否升级为 chips 筛选 ——
    const fields = {}
    let filterBy = ''
    for (const f of fieldsRaw) {
      const key = f.field_name
      if (LONG_TEXT_FIELDS.has(key)) {
        if (key === 'original') fields[key] = { key, label: fieldLabel(key), type: 'original' }
        else if (key === 'translation')
          fields[key] = { key, label: fieldLabel(key), type: 'original', view: 'block' }
        continue
      }
      const decl = { key, label: fieldLabel(key), type: 'text' }
      if (REF_CANDIDATES.has(key) || f.role === 'ref' || f.ref_layer) {
        decl.type = 'ent-ref'
        decl.refLayer = f.ref_layer || 'ent'
      }
      if (key === 'confidence') decl.type = 'number'
      fields[key] = decl
    }

    // 枚举值域统计：只对候选枚举字段跑（避免 original 等长文本全表扫）
    if (ENUM_CANDIDATES.size) {
      for (const f of fieldsRaw) {
        const key = f.field_name
        if (!ENUM_CANDIDATES.has(key)) continue
        const vals = db
          .prepare(
            `SELECT json_extract(payload, '$.${key}') v, COUNT(*) c
             FROM records WHERE book_id = ? AND layer_key = ?
             GROUP BY v HAVING v IS NOT NULL AND v <> '' ORDER BY c DESC LIMIT 40`,
          )
          .all(bookId, lc.layer_key)
        if (vals.length >= 2 && vals.length <= 30) {
          fields[key] = {
            key,
            label: fieldLabel(key),
            type: 'enum',
            enum: vals.map((r) => String(r.v)),
            view: 'chip',
          }
          if (!filterBy) filterBy = key
        } else if (vals.length > 30 && !fields[key]) {
          // 值域太散：保留文本展示，不启用筛选
          fields[key] = { key, label: fieldLabel(key), type: 'text' }
        }
      }
    }

    // —— 字段统计（数据驱动，不写死任何书；只对卡片层跑，node 层走表格不受影响）——
    // avgLen 平均长 / maxLen 最长 / distinct 非空值域大小 / withNl 含换行记录数。
    // 用途：① 系统字段与常量字段（distinct<=1）在卡片列表里不承载信息 → hideInList；
    //       ② 平均超长字段（>300 字，如 norm 实为 original 原文副本——已知 C 类数据
    //          问题，回源修正前先在卡片里隐藏，详情仍可见，不丢信息）；
    //       ③ 超长且含换行的值在详情里按 pre-wrap 呈现；
    //       ④ titleKey 只取短字段，避免把长文当标题。
    const stat = {}
    if (lc.kind !== 'node') {
      for (const f of fieldsRaw) {
        const key = f.field_name
        if (!fields[key]) continue
        const s = db
          .prepare(
            `SELECT AVG(LENGTH(json_extract(payload, ?))) AS avg_len,
                    MAX(LENGTH(json_extract(payload, ?))) AS max_len,
                    COUNT(DISTINCT json_extract(payload, ?)) AS distinct_n,
                    SUM(CASE WHEN instr(json_extract(payload, ?), char(10)) > 0 THEN 1 ELSE 0 END) AS with_nl
             FROM records WHERE book_id = ? AND layer_key = ?`,
          )
          .get(`$.${key}`, `$.${key}`, `$.${key}`, `$.${key}`, bookId, lc.layer_key)
        stat[key] = {
          avgLen: s?.avg_len ?? 0,
          maxLen: s?.max_len ?? 0,
          distinct: s?.distinct_n ?? 0,
          withNl: s?.with_nl ?? 0,
        }
      }
      for (const [key, f] of Object.entries(fields)) {
        const s = stat[key]
        if (!s) continue
        // original：瘦身契约下列表记录不带 original（详见 src/stores/layers.ts load()，
        // full 默认 false），卡片行恒显示「—」；原文由 EvidenceBlock 在详情 full=1 时提供，故无条件隐藏
        if (key === 'original') f.hideInList = true
        if (isSystemField(key) || s.distinct <= 1 || s.avgLen > 300) f.hideInList = true
        if (!f.view && s.maxLen > 120 && s.withNl > 0) f.view = 'block'
      }
    }

    const isNode = lc.kind === 'node'
    const titleKey =
      TITLE_PREFERENCE.find(
        (k) => fields[k] && stat[k] && stat[k].avgLen > 0 && stat[k].avgLen <= 30 && stat[k].maxLen <= 200,
      ) ?? ''
    return {
      id: normLayerKey(lc.layer_key),
      label: layerLabel(lc.layer_key),
      required: lc.layer_key === 'ent',
      tag: layerTag(lc.layer_key),
      ...(titleKey ? { titleKey } : {}),
      views: { list: isNode ? 'table' : 'card', detail: ['table'] },
      ...(filterBy ? { filter: 'chips', filterBy, groupBy: filterBy } : { filter: 'none' }),
      fields,
    }
  })

  const joinLayers = layers.filter((l) => l.id !== 'ent').map((l) => l.id)

  // 实体类型配色（A6）：按库内 ent 层实际 type 值域生成——已知 type 用标准盘，
  // 未覆盖的新 type 走确定性回退。前端 span 着色 / chips 筛选 / 实体详情同源取色，
  // 无配置时 entityTypeColor 回落 undefined → 全 span 同色（走查问题现象）。
  const typeRows = db
    .prepare(
      `SELECT DISTINCT COALESCE(json_extract(payload, '$.type'), 'unknown') t
       FROM records WHERE book_id = ? AND layer_key = 'ent' ORDER BY t`,
    )
    .all(bookId)
  const entityTypes = {}
  for (const r of typeRows) {
    if (r.t) entityTypes[r.t] = entityTypeColor(r.t)
  }

  const meta = bookMetaOf(db, bookId)

  return {
    bookId,
    title: `《${book.name}》`,
    // 副标题：有 book_meta 带出朝代/作者/体裁，否则退回统计口径
    subtitle: meta
      ? `${meta.dynasty}·${meta.author} · ${meta.genre} · ${items.v} 卷 · ${items.n} 条`
      : `联邦库 · ${items.v} 卷 · ${items.n} 条`,
    genre: '联邦数据库形态（SQLite 查询）',
    structure: { tree: ['volume', 'item'], chunkBy: 'volume', groupSize: 10 },
    colors: { primary: bookColor(bookId, books), entityTypes },
    layers,
    join: { layers: joinLayers, primary: 'ent' },
  }
}

/* ------------------------------------------------------------------ */
/* BookMeta 推导                                                        */
/* ------------------------------------------------------------------ */

export function deriveMeta(db, bookId) {
  const book = db.prepare('SELECT * FROM books WHERE book_id = ?').get(bookId)
  if (!book) return null
  const items = db
    .prepare(
      "SELECT COUNT(*) n, COUNT(DISTINCT volume) v FROM items WHERE book_id = ? AND volume <> '00'",
    )
    .get(bookId)
  const layerCounts = db
    .prepare(
      "SELECT layer_key, COUNT(*) c FROM records WHERE book_id = ? AND volume <> '00' GROUP BY layer_key",
    )
    .all(bookId)
  const entCount = layerCounts.find((r) => r.layer_key === 'ent')?.c ?? 0
  const nodes = db
    .prepare("SELECT COUNT(*) c FROM nodes WHERE book_id = ? AND layer_key = 'ent'")
    .get(bookId)
  const vols = db
    .prepare(
      "SELECT volume, COUNT(*) c FROM items WHERE book_id = ? AND volume <> '00' GROUP BY volume ORDER BY volume",
    )
    .all(bookId)

  const stats = {
    volumes: items.v,
    items: items.n,
    mentions: entCount,
    entities: nodes?.c ?? 0,
  }
  for (const r of layerCounts) stats[normLayerKey(r.layer_key)] = r.c

  return {
    bookId,
    title: `《${book.name}》`,
    stats,
    volumes: vols.map((v) => ({ id: v.volume, label: volLabel(v.volume), itemCount: v.c })),
  }
}

/* ------------------------------------------------------------------ */
/* 目录 / 条目块                                                        */
/* ------------------------------------------------------------------ */

/**
 * 节标题映射：item_id → 标题。
 *
 * 真源是 `spine` 表（C9《书籍著录与结构契约》§3.6 落库映射），由
 * tools/kb-federation/spine_build.py 从 `<书>/书籍json/<书>_校对版.json`
 * 的 `volumes[].items[].title` 派生。
 *
 * 为什么不读 `items.title`：那一列是 `load.py:135` 写的「正文前 50 字短摘要」，
 * 是守「原文只在指纹库」铁律的折中，**不是**节标题（见 docs/跨书合并-数据库设计.md
 * 偏差台账 A6）。语义不同，不可混用。
 *
 * spine 表可能尚未建立（老库），此时静默返回空表，调用方回落到 iid。
 */
const _spineCache = new WeakMap()
export function spineTitlesOf(db, bookId) {
  let perBook = _spineCache.get(db)
  if (!perBook) {
    perBook = new Map()
    _spineCache.set(db, perBook)
  }
  if (perBook.has(bookId)) return perBook.get(bookId)
  let m = new Map()
  try {
    const rows = db
      .prepare(
        "SELECT item_id, title FROM spine WHERE book_id = ? AND kind = 'duan' AND item_id IS NOT NULL",
      )
      .all(bookId)
    m = new Map(
      rows.filter((r) => r.title && r.title.trim()).map((r) => [r.item_id, r.title]),
    )
  } catch {
    // spine 表不存在（未跑 spine_build.py）——回落 iid，不报错
  }
  perBook.set(bookId, m)
  return m
}

/** 卷级标题映射：卷号 → 卷名（spine kind='juan'）。缺则返回空表。 */
export function spineVolTitlesOf(db, bookId) {
  let perBook = _spineCache.get(db)
  if (!perBook) {
    perBook = new Map()
    _spineCache.set(db, perBook)
  }
  const k = `${bookId}#vol`
  if (perBook.has(k)) return perBook.get(k)
  let m = new Map()
  try {
    const rows = db
      .prepare(
        "SELECT no, title FROM spine WHERE book_id = ? AND kind = 'juan'",
      )
      .all(bookId)
    m = new Map(rows.filter((r) => r.title).map((r) => [r.no, r.title]))
  } catch {
    // 同上
  }
  perBook.set(k, m)
  return m
}

export function deriveChapters(db, bookId) {
  const vols = db
    .prepare(
      "SELECT DISTINCT volume FROM items WHERE book_id = ? AND volume <> '00' ORDER BY volume",
    )
    .all(bookId)
  const byVol = db
    .prepare(
      "SELECT volume, item_id FROM items WHERE book_id = ? AND volume <> '00' ORDER BY volume, item_id",
    )
    .all(bookId)
  // join 命中层数（每条目）：
  const hit = db
    .prepare(
      "SELECT item_id, COUNT(DISTINCT layer_key) c FROM records WHERE book_id = ? AND volume <> '00' GROUP BY item_id",
    )
    .all(bookId)
  const hitMap = new Map(hit.map((r) => [r.item_id, r.c]))
  const titles = spineTitlesOf(db, bookId)
  const volTitles = spineVolTitlesOf(db, bookId)
  const grouped = new Map()
  for (const r of byVol) {
    if (!grouped.has(r.volume)) grouped.set(r.volume, [])
    grouped.get(r.volume).push(r.item_id)
  }
  return vols.map((v) => ({
    key: v.volume,
    label: volTitles.get(v.volume) || volLabel(v.volume),
    count: grouped.get(v.volume)?.length ?? 0,
    children: (grouped.get(v.volume) ?? []).map((iid) => ({
      key: iid,
      label: titles.get(iid) || iid,
      count: hitMap.get(iid) ?? 0,
      iid,
      ...(titles.get(iid) ? { title: titles.get(iid) } : {}),
    })),
  }))
}

/**
 * 卷条目块（原文 + 译文 + 实体 span）
 *
 * span 降级定位：联邦库 records 无 s/e 偏移，用
 * original.indexOf(词形) 定位（找到才生成，找不到就跳过），
 * 保证 text.slice(s, e) === span.text 不变量恒成立。
 */
export function deriveItemChunk(db, bookId, volume) {
  const itemIds = db
    .prepare(
      'SELECT item_id FROM items WHERE book_id = ? AND volume = ? ORDER BY item_id',
    )
    .all(bookId, volume)
    .map((r) => r.item_id)
  const ents = db
    .prepare(
      "SELECT local_id, item_id, payload FROM records WHERE book_id = ? AND volume = ? AND layer_key = 'ent'",
    )
    .all(bookId, volume)
  const trls = db
    .prepare(
      "SELECT item_id, payload FROM records WHERE book_id = ? AND volume = ? AND layer_key = 'trl'",
    )
    .all(bookId, volume)
  const fallback = db.prepare(
    "SELECT payload FROM records WHERE book_id = ? AND item_id = ? AND layer_key <> 'ent' LIMIT 1",
  )

  const entByItem = new Map()
  for (const r of ents) {
    if (!entByItem.has(r.item_id)) entByItem.set(r.item_id, [])
    entByItem.get(r.item_id).push(r)
  }
  const trlText = new Map(
    trls.map((r) => [r.item_id, parsePayload(r.payload).translation ?? '']),
  )

  const isZero = (iid) => iid.startsWith('00-') || iid === '0'
  const titles = spineTitlesOf(db, bookId)
  const items = []
  for (const iid of itemIds) {
    if (isZero(iid)) continue
    const entRecs = entByItem.get(iid) ?? []
    let original = ''
    let first = null
    if (entRecs.length) {
      first = parsePayload(entRecs[0].payload)
      original = first.original ?? ''
    }
    if (!original) {
      const fb = fallback.get(bookId, iid)
      if (fb) original = parsePayload(fb.payload).original ?? ''
    }
    const spans = []
    for (const er of entRecs) {
      const p = parsePayload(er.payload)
      const word = p.text ?? ''
      const loc = spanLoc(p, original, word)
      if (!loc) continue
      const eid = eidOf(p, er.local_id)
      spans.push({
        id: er.local_id,
        ...(eid ? { eid } : {}),
        text: word,
        type: p.type ?? 'unknown',
        s: loc.s,
        e: loc.e,
        ...(p.normalized ? { normalized: p.normalized } : {}),
        ...(p.confidence != null ? { confidence: p.confidence } : {}),
      })
    }
    items.push({
      iid,
      ordinal: parseInt(iid.slice(3), 10) || 0,
      volume,
      ...(titles.get(iid) ? { title: titles.get(iid) } : {}),
      text: original,
      ...(trlText.get(iid) ? { translation: trlText.get(iid) } : {}),
      spans,
    })
  }
  return { volume, items }
}

/* ------------------------------------------------------------------ */
/* 层数据                                                               */
/* ------------------------------------------------------------------ */

/** 层记录：payload 展开 + 书证三件套。full=false 时剔除 original/norm（列表页瘦身） */
export function deriveLayer(db, bookId, layer, { full = false, itemId = null } = {}) {
  // layer 为前端规范键（如 event）；库内键各书不一（xzl/ysz 用 evt，其余用 event），
  // 查库用 IN 同时匹配原名与别名（layerKeyCandidates），单选必漏书（走查 2026-10-13）
  const cands = layerKeyCandidates(layer)
  const marks = cands.map(() => '?').join(',')
  const recs = itemId
    ? db
        .prepare(
          `SELECT local_id, item_id, payload FROM records WHERE book_id = ? AND layer_key IN (${marks}) AND item_id = ? ORDER BY local_id`,
        )
        .all(bookId, ...cands, itemId)
    : db
        .prepare(
          `SELECT local_id, item_id, payload FROM records WHERE book_id = ? AND layer_key IN (${marks}) ORDER BY item_id, local_id`,
        )
        .all(bookId, ...cands)
  const records = recs.map((r) => {
    const p = parsePayload(r.payload)
    const rec = {
      id: r.local_id,
      item_id: r.item_id,
      ...p,
    }
    const lean = !full && !itemId
    rec.original = lean ? '' : (p.original ?? '')
    // norm 同理：当前库里 norm 实为 original 副本（已知 C 类数据问题，待回源），
    // 前端零处读取 norm，而它让 kzz 的瘦身 ent 层膨胀到 19.5MB
    // （EntityDetail 的 mention 加载被拖死，走查 2026-10-13）。lean 裁剪，
    // full=1 保留原件。回源修正 norm 语义后此行依然安全（lean 本就不该带长文）。
    if (lean) delete rec.norm
    rec.source = '联邦库'
    rec.confidence = typeof p.confidence === 'number' ? p.confidence : null
    return rec
  })
  return { layer, count: records.length, records }
}

export function deriveEntIndex(db, bookId) {
  const recs = db
    .prepare(
      "SELECT local_id, item_id, payload FROM records WHERE book_id = ? AND layer_key = 'ent' ORDER BY item_id, local_id",
    )
    .all(bookId)
  const records = recs.map((r) => {
    const p = parsePayload(r.payload)
    // 原文直接取 payload 里的 original——曾经对每条记录单发一次
    // json_extract 查询（8481 次全量 payload 解析，kzz 上实测 52 秒，
    // EntityDetail 的 mention 加载被拖死，走查 2026-10-13）
    const orig = String(p.original ?? '')
    const loc = spanLoc(p, orig, p.text ?? '')
    return {
      id: r.local_id,
      item_id: r.item_id,
      eid: eidOf(p, r.local_id),
      text: p.text ?? '',
      type: p.type ?? 'unknown',
      normalized: p.normalized ?? '',
      normalized_conf: p.confidence != null ? p.confidence : null,
      confidence: typeof p.confidence === 'number' ? p.confidence : null,
      source: '联邦库',
      original: '',
      ...(loc ? { s: loc.s, e: loc.e } : {}),
    }
  })
  return { layer: 'ent', count: records.length, records }
}

/** 实体表：nodes(ent) 按 ent_id 聚合（同一实体主键跨条目/跨卷复现合并） */
export function deriveEntities(db, bookId) {
  const nodes = db
    .prepare(
      "SELECT uid, local_id, label, payload FROM nodes WHERE book_id = ? AND layer_key = 'ent'",
    )
    .all(bookId)
  // items 归集：nodes 无 item_id 列，出现条目从 ent 记录取。
  // local_id 两形态：`卷:ENT-NNN`（sdr/wzz/kzz）与裸 `ENT-NNN`（fqh/xzl），
  // 统一去掉冒号前缀即得 eid（走查 2026-10-13：前端曾恒显示「0 条」）
  const itemsByEid = new Map()
  for (const r of db
    .prepare("SELECT local_id, item_id FROM records WHERE book_id = ? AND layer_key = 'ent'")
    .all(bookId)) {
    const eid = r.local_id.includes(':') ? r.local_id.slice(r.local_id.indexOf(':') + 1) : r.local_id
    let set = itemsByEid.get(eid)
    if (!set) {
      set = new Set()
      itemsByEid.set(eid, set)
    }
    if (r.item_id) set.add(r.item_id)
  }
  const byId = new Map()
  for (const n of nodes) {
    const p = parsePayload(n.payload)
    const eid = p.ent_id || n.uid.split(':').pop() || n.local_id
    const cur = byId.get(eid) ?? {
      eid,
      normalized: p.normalized || n.label || '',
      type: p.type || 'unknown',
      surfaces: [],
      count: 0,
    }
    cur.count += 1
    const surfaces = Array.isArray(p.surfaces) ? p.surfaces : [n.label]
    for (const s of surfaces) {
      const str = String(s)
      if (str.length <= 25 && !cur.surfaces.includes(str)) cur.surfaces.push(str)
    }
    const items = itemsByEid.get(eid)
    if (items?.size) cur.items = [...items].sort()
    byId.set(eid, cur)
  }
  const out = {}
  for (const [, v] of byId) out[v.eid] = v
  return out
}

/* ------------------------------------------------------------------ */
/* join / enums                                                        */
/* ------------------------------------------------------------------ */

export function deriveJoin(db, bookId) {
  const rows = db
    .prepare(
      "SELECT item_id, volume, layer_key, group_concat(local_id, ',') ids FROM records WHERE book_id = ? AND volume <> '00' GROUP BY item_id, layer_key",
    )
    .all(bookId)
  const layers = db
    .prepare(
      "SELECT DISTINCT layer_key FROM records WHERE book_id = ? AND volume <> '00' AND layer_key <> 'ent' ORDER BY layer_key",
    )
    .all(bookId)
    .map((r) => r.layer_key)
  const byItem = new Map()
  for (const r of rows) {
    if (r.layer_key === 'ent') continue
    let row = byItem.get(r.item_id)
    if (!row) {
      row = { item_id: r.item_id, volume: r.volume, layer_count: 0, ids: {} }
      byItem.set(r.item_id, row)
    }
    row.ids[normLayerKey(r.layer_key)] = r.ids ? r.ids.split(',') : []
    row.layer_count += 1
  }
  return { columns: layers.map(normLayerKey), rows: [...byItem.values()] }
}

/** 枚举值域：对 config 里启用筛选/枚举字段统计 DISTINCT 值 + 计数 */
export function deriveEnums(db, bookId) {
  const config = deriveConfig(db, bookId)
  const out = {}
  for (const layer of config.layers) {
    const fields = layer.fields ?? {}
    const targets = []
    for (const [k, f] of Object.entries(fields)) {
      if (f.type === 'enum' || (layer.filterBy && layer.filterBy === k)) targets.push(k)
    }
    if (!targets.length) continue
    const bucket = {}
    for (const f of targets) {
      // 同 deriveLayer：层键 IN (原名, 别名)，避免 event/evt 二选一漏书
      const cands = layerKeyCandidates(layer.id)
      const marks = cands.map(() => '?').join(',')
      const vals = db
        .prepare(
          `SELECT json_extract(payload, '$.${f}') v, COUNT(*) c
           FROM records WHERE book_id = ? AND layer_key IN (${marks})
           GROUP BY v HAVING v IS NOT NULL AND v <> '' ORDER BY c DESC LIMIT 200`,
        )
        .all(bookId, ...cands)
      bucket[f] = vals.map((r) => ({ value: String(r.v), count: r.c }))
    }
    out[layer.id] = bucket
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 检索（远程 SQLite）                                                  */
/* ------------------------------------------------------------------ */

/** 多词 AND。每书在 ent(原文/实体) 与 trl(译文) 两域检索，合并成 SearchDoc */
export function deriveSearch(db, { bookId = null, terms = [] }) {
  if (!terms.length) return { total: 0, docs: [] }
  const books = bookId
    ? db.prepare('SELECT * FROM books WHERE book_id = ?').all(bookId)
    : db.prepare('SELECT * FROM books ORDER BY book_id').all()
  const docs = []
  const seen = new Set()
  const push = (doc) => {
    const k = `${doc.bookId}|${doc.iid}`
    if (seen.has(k)) return
    seen.add(k)
    docs.push(doc)
  }

  for (const bk of books) {
    // 原文/实体域：ent 层 original/text/normalized
    const entSql = `SELECT local_id, item_id FROM records WHERE book_id = ? AND layer_key = 'ent' AND ${terms
      .map(() => "payload LIKE ? ESCAPE '\\'")
      .join(' AND ')}`
    const entArgs = [bk.book_id, ...terms.map(like)]
    for (const r of db.prepare(entSql).all(...entArgs)) {
      const text = db
        .prepare(
          "SELECT json_extract(payload,'$.original') o FROM records WHERE book_id = ? AND local_id = ?",
        )
        .get(bk.book_id, r.local_id)
      push({
        bookId: bk.book_id,
        book: bk.name,
        iid: r.item_id,
        volume: r.item_id.slice(0, 2),
        where: ['text'],
        text: String(text?.o ?? '').slice(0, 600),
      })
    }
    // 译文域：trl 层 translation
    const trlSql = `SELECT item_id FROM records WHERE book_id = ? AND layer_key = 'trl' AND ${terms
      .map(() => "payload LIKE ? ESCAPE '\\'")
      .join(' AND ')}`
    const trlArgs = [bk.book_id, ...terms.map(like)]
    for (const r of db.prepare(trlSql).all(...trlArgs)) {
      const trl = db
        .prepare(
          "SELECT json_extract(payload,'$.translation') t FROM records WHERE book_id = ? AND layer_key='trl' AND item_id = ? LIMIT 1",
        )
        .get(bk.book_id, r.item_id)
      push({
        bookId: bk.book_id,
        book: bk.name,
        iid: r.item_id,
        volume: r.item_id.slice(0, 2),
        where: ['translation'],
        translation: String(trl?.t ?? '').slice(0, 600),
        text: '',
      })
    }
    if (docs.length > 400) break
  }
  docs.sort((a, b) => (b.bookIid = 0) || a.bookId.localeCompare(b.bookId) || a.iid.localeCompare(b.iid))
  return { total: docs.length, docs: docs.slice(0, 200) }
}

/* ------------------------------------------------------------------ */
/* 联邦实体关联（canonical / members / record_refs）                    */
/* ------------------------------------------------------------------ */

export function deriveAssoc(db, q) {
  const term = like(q)
  const groupsRaw = db
    .prepare(
      `SELECT c.canonical_id, c.repr_label, c.status, COUNT(m.uid) member_count,
              GROUP_CONCAT(DISTINCT substr(m.uid, 1, 3)) books
       FROM canonical c JOIN members m ON m.canonical_id = c.canonical_id
       WHERE c.repr_label LIKE ? ESCAPE '\\'
       GROUP BY c.canonical_id ORDER BY member_count DESC LIMIT 30`,
    )
    .all(term)
  const groups = groupsRaw.map((g) => {
    const members = db
      .prepare(
        'SELECT uid, method, confidence, status FROM members WHERE canonical_id = ? ORDER BY uid',
      )
      .all(g.canonical_id)
    return {
      canonical_id: g.canonical_id,
      repr_label: g.repr_label,
      status: g.status,
      member_count: g.member_count,
      books: g.books ? g.books.split(',') : [],
      members: members.map((m) => {
        const [bookId, , local] = String(m.uid).split(':')
        const node = db
          .prepare('SELECT label FROM nodes WHERE uid = ?')
          .get(m.uid)
        return {
          uid: m.uid,
          bookId: bookId || '',
          label: node?.label || local || m.uid,
          method: m.method,
          confidence: m.confidence,
        }
      }),
    }
  })
  const refs = db
    .prepare(
      `SELECT book_id, item_id, volume, layer_key, field, target_text, target_uid, target_ambiguous
       FROM record_refs WHERE target_text LIKE ? ESCAPE '\\'
       ORDER BY book_id, item_id LIMIT 60`,
    )
    .all(term)
  return { groups, refs, total: groups.length + refs.length }
}

/* ------------------------------------------------------------------ */
/* search-index 兼容（docs 形态，供旧检索索引接口）                     */
/* ------------------------------------------------------------------ */

export function deriveSearchIndex(db, bookId) {
  const items = db
    .prepare(
      "SELECT item_id, volume FROM items WHERE book_id = ? AND volume <> '00' ORDER BY item_id",
    )
    .all(bookId)
  const textOf = db.prepare(
    "SELECT json_extract(payload,'$.original') o FROM records WHERE book_id = ? AND item_id = ? AND layer_key = 'ent' LIMIT 1",
  )
  const trlOf = db.prepare(
    "SELECT json_extract(payload,'$.translation') t FROM records WHERE book_id = ? AND item_id = ? AND layer_key = 'trl' LIMIT 1",
  )
  const feats = db.prepare(
    `SELECT local_id, payload FROM records WHERE book_id = ? AND item_id = ? AND layer_key <> 'ent' AND layer_key <> 'trl' LIMIT 8`,
  )
  const docs = items.map((it) => {
    const o = textOf.get(bookId, it.item_id)?.o ?? ''
    const t = trlOf.get(bookId, it.item_id)?.t ?? ''
    const extras = []
    for (const f of feats.all(bookId, it.item_id)) {
      const p = parsePayload(f.payload)
      const obj = { ...p }
      delete obj.original
      extras.push(Object.values(obj).filter((x) => typeof x === 'string').join(' '))
    }
    return {
      iid: it.item_id,
      volume: it.volume,
      text: o.slice(0, 500),
      translation: t.slice(0, 500),
      fields: extras.join(' ').slice(0, 300),
    }
  })
  return { bookId, docs }
}