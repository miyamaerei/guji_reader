/**
 * 虚拟滚动的窗口计算（P5.2）
 *
 * 为什么要替换 `InfiniteList`：分页追加是**只增不减**——滚到列表底部时
 * 2253 行全部留在 DOM 里，节点数无上限；而每追加 100 行都要全量重排一次，
 * 长列表必然卡顿。虚拟滚动只保留视口内的行，DOM 规模恒定。
 *
 * 行高处理：古籍条目行高不固定（正文长度、书证折叠状态都影响），
 * 所以用「测量缓存 + 估算兜底」：
 *  · 已渲染过的行量出真实高度并缓存；
 *  · 未量过的行用平均高度估算；
 *  · 列表整体高度用估算 + 已测量修正，保证滚动条比例大致正确。
 *
 * 这样不需要固定行高假设，也不需要为此引第三方库。
 */

/** 视口上下各多渲染几行，避免快速滚动时露白 */
export const OVERSCAN = 6

export interface WindowInput {
  scrollTop: number
  viewportH: number
  total: number
  /** 已知行高（index -> px）；未给出的按 avgH 估 */
  heights: Map<number, number>
  avgH: number
  overscan?: number
}

export interface WindowOutput {
  start: number
  end: number
  /** 列表总高度（px），用于撑出滚动条 */
  totalHeight: number
}

/** 下标 -> 偏移量：已测量的用真值，未测的按 avgH 累加 */
function offsetOf(input: WindowInput, index: number): number {
  const { heights, avgH, total } = input
  let off = 0
  for (let i = 0; i < index && i < total; i++) {
    off += heights.get(i) ?? avgH
  }
  return off
}

/**
 * 由滚动位置求可见行区间 [start, end)。
 *
 * 复杂度是 O(n)（每次从头累加偏移），对 n≤3000 的古籍列表完全够用，
 * 且比维护一棵 Fenwick 树简单得多——过早优化反而是这类组件的常见坑。
 */
export function computeWindow(input: WindowInput): WindowOutput {
  const { scrollTop, viewportH, total, heights, avgH } = input
  const overscan = input.overscan ?? OVERSCAN
  const safeAvg = avgH > 0 ? avgH : 32

  // 总高度：已测量用真值，其余按平均
  let totalHeight = 0
  for (let i = 0; i < total; i++) totalHeight += heights.get(i) ?? safeAvg

  if (!total) return { start: 0, end: 0, totalHeight: 0 }

  // 二分找起点：找第一个 offset+height > scrollTop 的行
  let lo = 0
  let hi = total - 1
  let start = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const off = offsetOf(input, mid)
    const h = heights.get(mid) ?? safeAvg
    if (off + h > scrollTop) {
      start = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  // 终点：从起点线性推进到覆盖视口底部
  const bottom = scrollTop + viewportH
  let end = start
  let off = offsetOf(input, start)
  while (end < total && off < bottom) {
    off += heights.get(end) ?? safeAvg
    end++
  }

  const from = Math.max(0, start - overscan)
  const to = Math.min(total, end + overscan)
  return { start: from, end: to, totalHeight }
}

/**
 * 滚动位置 -> 该位置所属行下标（用于 scrollToIndex / 定位）。
 * 与 computeWindow 的二分逻辑一致，但以偏移量为中心。
 */
export function indexAtOffset(input: WindowInput, targetOffset: number): number {
  const { total } = input
  if (!total) return 0
  let lo = 0
  let hi = total - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsetOf(input, mid) <= targetOffset) lo = mid + 1
    else hi = mid - 1
  }
  return Math.min(total - 1, Math.max(0, lo - 1))
}

/** 由一批已测量高度算平均值（没有测量则用兜底） */
export function averageHeight(heights: Map<number, number>, fallback = 32): number {
  if (!heights.size) return fallback
  let sum = 0
  for (const h of heights.values()) sum += h
  return sum / heights.size
}