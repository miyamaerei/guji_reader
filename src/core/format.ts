/**
 * 字段值展示格式化（P5）
 *
 * 从 FieldValue.vue 抽出来的纯函数，让「怎么显示一个字段值」有单测保护。
 *
 * 起因是一个真实缺陷：`proc.steps` 是对象数组，`Array.join()` 直接得到
 * `「[object Object],[object Object]」`——流程链在列表里完全读不出来。
 * 这个 bug 之前一直被 `InfiniteList` 的分页掩盖（首屏 100 行里未必有
 * 流程层），换虚拟滚动后卡片一屏可见，才暴露出来。
 */

/** 对象里哪个键最能代表这条：steps 看 state/action，nam entries 看 person */
export const LABEL_KEYS = ['state', 'action', 'label', 'name', 'text', 'person', 'title', 'value']

/** 单个对象 -> 可读文本；找不到 label 类字段就退回第一个非空字符串字段 */
export function labelOf(o: unknown): string {
  if (o == null) return ''
  if (typeof o !== 'object') return String(o)
  const rec = o as Record<string, unknown>
  for (const k of LABEL_KEYS) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  for (const v of Object.values(rec)) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * 字段值 -> 展示文本。
 *
 * 纯字符串数组用「、」（并列枚举）；对象数组用「→」（有先后关系，如步骤链）。
 * 这个区分不是随意选的：steps 是流程有向链，用「、」会丢掉顺序信息。
 */
export function displayValue(v: unknown): string {
  if (Array.isArray(v)) {
    if (!v.length) return ''
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.join('、')
    return v
      .map(labelOf)
      .filter(Boolean)
      .join(' → ')
  }
  // 单对象（联邦库 ent-ref 形如 { text: '顺天府', ent_ids: [] }）也要走 labelOf：
  // 直接 String(v) 会渲染成 "[object Object]"（走查 2026-10-13，任职表三列全废）
  if (v !== null && typeof v === 'object') return labelOf(v)
  return String(v)
}