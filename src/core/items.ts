/**
 * 条目与实体 span 的工具（P0.2）
 *
 * 两条来自旧版的硬教训在这里固化：
 *  1. iid 比较必须数值化——旧版「数字/字符串不一致」导致目录展开态错乱。
 *  2. span 偏移必须可断言——正文着色全错的根因就是 s/e 错位（风险 R1）。
 */
import type { EntitySpan, ItemRecord } from './types'

/** `01-001` → 1。统一数值化口径，禁止直接字符串比较 */
export function parseOrdinal(iid: string): number {
  return parseInt(String(iid).slice(3), 10)
}

/** 条目所属组号（0 基） */
export function groupIndexOf(iid: string, groupSize: number): number {
  return Math.floor(parseOrdinal(iid) / groupSize)
}

export interface TextSegment {
  text: string
  /** 命中实体时携带 span 信息 */
  span?: EntitySpan
}

/** 把原文按实体 span 切段，供正文着色渲染 */
export function buildSegments(text: string, spans: EntitySpan[]): TextSegment[] {
  if (!spans.length) return [{ text }]
  const sorted = [...spans].sort((a, b) => a.s - b.s || a.e - b.e)
  const segments: TextSegment[] = []
  let cursor = 0
  for (const span of sorted) {
    const s = Math.max(0, Math.min(span.s, text.length))
    const e = Math.max(s, Math.min(span.e, text.length))
    if (s < cursor) continue // 跳过重叠 span，避免渲染错位
    if (s > cursor) segments.push({ text: text.slice(cursor, s) })
    segments.push({ text: text.slice(s, e), span })
    cursor = e
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

export interface SpanMismatch {
  iid: string
  spanId: string
  expected: string
  actual: string
}

/**
 * 断言原文偏移与实体词形一致：text.slice(s, e) === span.text
 * 打包期（Python）与运行期（dev 自检）共用同一口径。
 */
export function assertSpans(items: ItemRecord[]): SpanMismatch[] {
  const mismatches: SpanMismatch[] = []
  for (const item of items) {
    for (const span of item.spans ?? []) {
      const actual = item.text.slice(span.s, span.e)
      if (actual !== span.text) {
        mismatches.push({
          iid: item.iid,
          spanId: span.id,
          expected: span.text,
          actual,
        })
      }
    }
  }
  return mismatches
}
