/**
 * 内存检索（P1.5 索引已就绪 + P2.8 检索实现）
 *
 * 索引在打包期生成（search-index.json），运行期只做线性扫描。
 * 中文没有词边界，因此用「子串 + 多词 AND」而不是分词：
 * 输入「礼部 胡濙」= 两个词，都要命中才算。
 *
 * 字段权重：原文 1.0 / 译文 0.7 / 层字段 0.5。
 * 逐字段累加命中次数，最后按总分排序——同一条里出现越集中越靠前。
 */
import type { SearchDoc } from './types'

export interface SearchHit {
  iid: string
  volume: string
  score: number
  /** 命中片段（已做上下文截取，供高亮渲染） */
  snippet: string
  /** 片段内命中位置 [start, end)，相对 snippet */
  ranges: [number, number][]
  /** 命中的字段集合，用于行尾标注「原文/译文/层字段」 */
  where: ('text' | 'translation' | 'fields')[]
}

const WEIGHT = { text: 1, translation: 0.7, fields: 0.5 } as const

/** 拆词：空白分隔；连续 CJK 不做切分（保留用户原意） */
export function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let from = 0
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i < 0) break
    n++
    from = i + needle.length
  }
  return n
}

const CONTEXT = 30

/**
 * 检索。terms 之间为 AND；任一词未命中即丢弃该条。
 * @param limit 结果上限（防止 1192 条全渲染）
 */
export function searchDocs(docs: SearchDoc[], query: string, limit = 200): SearchHit[] {
  const terms = tokenize(query)
  if (!terms.length) return []
  const hits: SearchHit[] = []

  for (const doc of docs) {
    const text = doc.text ?? ''
    const trans = doc.translation ?? ''
    const fields = doc.fields ?? ''
    let score = 0
    const where = new Set<SearchHit['where'][number]>()
    let ok = true

    for (const t of terms) {
      const inText = countOccurrences(text, t)
      const inTrans = countOccurrences(trans, t)
      const inFields = countOccurrences(fields, t)
      if (inText + inTrans + inFields === 0) {
        ok = false
        break
      }
      if (inText) {
        score += inText * WEIGHT.text
        where.add('text')
      }
      if (inTrans) {
        score += inTrans * WEIGHT.translation
        where.add('translation')
      }
      if (inFields) {
        score += inFields * WEIGHT.fields
        where.add('fields')
      }
    }
    if (!ok) continue

    // 片段：优先在原文里取，原文没命中就退回译文
    const anchor = where.has('text') ? text : trans || text
    const term = terms.find((t) => anchor.includes(t)) ?? terms[0]
    const { snippet, ranges } = excerpt(anchor, term, CONTEXT)
    hits.push({
      iid: doc.iid,
      volume: doc.volume,
      score: Math.round(score * 100) / 100,
      snippet,
      ranges,
      where: [...where],
    })
  }

  hits.sort((a, b) => b.score - a.score || a.iid.localeCompare(b.iid))
  return limit > 0 ? hits.slice(0, limit) : hits
}

/** 取命中词附近的上下文片段，并给出命中位置（相对片段） */
export function excerpt(
  text: string,
  term: string,
  context = CONTEXT,
): { snippet: string; ranges: [number, number][] } {
  if (!text) return { snippet: '', ranges: [] }
  const at = term ? text.indexOf(term) : -1
  if (at < 0) {
    const head = text.slice(0, context * 2)
    return { snippet: head, ranges: [] }
  }
  const start = Math.max(0, at - context)
  const end = Math.min(text.length, at + term.length + context)
  const leading = start > 0 ? '…' : ''
  const body = leading + text.slice(start, end)
  const hasTrail = end < text.length
  const snippet = body + (hasTrail ? '…' : '')
  // 末尾省略号位于 body.length 处，range 绝不能越过它（否则高亮吞掉「…」变成「礼…」）
  const maxEnd = body.length
  const offset = leading.length - start
  const ranges: [number, number][] = []
  let from = 0
  for (;;) {
    const i = text.indexOf(term, from)
    // 命中词必须整段落在截取窗口内（i + term.length <= end），
    // 跨窗口的命中直接丢弃——宁可少高亮一个，也不让标记错位或吞掉省略号。
    if (i < 0 || i + term.length > end) break
    const s = i + offset
    const e = Math.min(i + term.length + offset, maxEnd)
    if (e > s) ranges.push([s, e])
    from = i + term.length
  }
  return { snippet, ranges }
}

/** 把片段按命中位置切段，供高亮渲染复用（与 ItemText 的实体着色同构） */
export interface SnippetSegment {
  text: string
  hit: boolean
}

export function segmentSnippet(snippet: string, ranges: [number, number][]): SnippetSegment[] {
  if (!ranges.length) return [{ text: snippet, hit: false }]
  const out: SnippetSegment[] = []
  let cursor = 0
  for (const [s, e] of ranges) {
    const a = Math.max(cursor, Math.min(s, snippet.length))
    const b = Math.max(a, Math.min(e, snippet.length))
    if (a > cursor) out.push({ text: snippet.slice(cursor, a), hit: false })
    if (b > a) out.push({ text: snippet.slice(a, b), hit: true })
    cursor = b
  }
  if (cursor < snippet.length) out.push({ text: snippet.slice(cursor), hit: false })
  return out
}
