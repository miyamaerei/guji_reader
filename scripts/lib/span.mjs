/**
 * 实体 span 定位（P1.2 核心）
 *
 * 源数据的实体偏移存在两类缺口，按三级策略降级处理：
 *   L1 精确：源数据自带 s/e，断言 original.slice(s,e) === text 后直接采用。
 *   L2 直查：s/e 缺失，用 original.indexOf(text) 定位。
 *   L3 模糊：仍失败（多为单字异体：聦/聪、戸/户、舎/舍），用最小替换距离的等长
 *           滑动窗口找回位置，阈值 d <= max(1, floor(len/3))。
 *   L0 未定位：s = -1。记录仍进表、仍可检索与跳转，但正文不着色。
 *
 * 硬约束：L3 只做「等长窗口比对」，不做插入删除，因此偏移天然对齐，
 *         不会出现差一位导致整段着色错位的情况。
 */

/** 长度为 1 的阈值下允许完全不匹配，长词按 1/3 容差 */
function tolerance(len) {
  return Math.max(1, Math.floor(len / 3))
}

/**
 * 等长滑动窗口，返回替换距离最小的位置
 * @returns {{i:number,d:number}|null}
 */
function bestWindow(original, text) {
  const L = text.length
  if (L === 0 || L > original.length) return null
  let best = null
  for (let i = 0; i + L <= original.length; i++) {
    let d = 0
    for (let k = 0; k < L; k++) {
      if (original[i + k] !== text[k] && ++d > (best ? best.d : Infinity)) break
    }
    if (best === null || d < best.d) {
      best = { i, d }
      if (d === 0) break
    }
  }
  return best
}

/**
 * @param {{text:string,start?:number|null,end?:number|null}} ann 源标注
 * @param {string} original 该条目原文（已验证跨层唯一）
 * @returns {{s:number,e:number,level:'L1'|'L2'|'L3'|'L0',delta?:number,matched?:string}}
 *
 * 注意：L3 命中时原文用的是异体字形（季聦/季聪、戸/户），此时返回的 matched 是
 * 「原文实际切片」。调用方必须以 matched 作为 span.text，否则契约的
 * `text.slice(s,e) === span.text` 断言必然失败；原始标注词形另存 surface。
 */
export function locateSpan(ann, original) {
  const text = ann.text || ''
  const s = ann.start
  const e = ann.end

  // L1 精确
  if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && e <= original.length) {
    if (original.slice(s, e) === text) return { s, e, level: 'L1' }
  }

  // L2 直查
  const direct = original.indexOf(text)
  if (text && direct >= 0) return { s: direct, e: direct + text.length, level: 'L2' }

  // L3 模糊（等长窗口）：原文为异体字形，返回实际切片供 span.text 使用
  if (text) {
    const best = bestWindow(original, text)
    if (best && best.d <= tolerance(text.length)) {
      return {
        s: best.i,
        e: best.i + text.length,
        level: 'L3',
        delta: best.d,
        matched: original.slice(best.i, best.i + text.length),
      }
    }
  }

  return { s: -1, e: -1, level: 'L0' }
}

/**
 * 批量定位并产出报告
 * @param {Array} anns
 * @param {(ann:any)=>string} originalOf
 */
export function locateAll(anns, originalOf) {
  const stats = { L1: 0, L2: 0, L3: 0, L0: 0 }
  const unlocated = []
  const results = anns.map((ann) => {
    const original = originalOf(ann) || ''
    const r = locateSpan(ann, original)
    stats[r.level]++
    if (r.level === 'L0') {
      unlocated.push({ id: ann.id, item: ann.item_id, text: ann.text, origLen: original.length })
    }
    return { ann, ...r }
  })
  return { results, stats, unlocated }
}

/**
 * 同一条目内按起点排序，并丢弃区间重叠的后续项。
 * 重叠会让渲染层切分原文时产生嵌套 span，必须在打包期消掉。
 */
export function dedupeSpans(spans) {
  const located = spans.filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || b.e - a.e)
  const kept = []
  let lastEnd = -1
  for (const sp of located) {
    if (sp.s < lastEnd) continue // 与已保留项重叠
    kept.push(sp)
    lastEnd = sp.e
  }
  const dropped = spans.length - kept.length
  return { spans: kept, dropped }
}
