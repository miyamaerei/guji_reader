/**
 * 通用树工具（P2.3）
 *
 * 目录树 / 筛选树 / 卷模式树共用同一套节点结构与扁平化算法，
 * 差异只在「节点从哪来」，不在「怎么渲染」。
 *
 * ⚠️ 这里锁死旧版最痛的一个 bug：**筛选计数 ≠ 结果数**。
 * 旧版把计数预先算好存在节点上，筛选后数字不跟着变，用户点「礼制 12」
 * 结果出来 7 条。本模块的铁律是——
 *
 *   计数永远由当前可见的子节点重新累计，绝不使用预存值。
 *
 * `filterTree()` 返回的新树，每个节点的 count 都等于「点它实际会看到的条数」，
 * 由 tests/core.test.ts 断言锁死。
 */

export interface TreeNodeTag {
  text: string
  title?: string
  tone?: 'layer' | 'muted' | 'primary'
}

export interface TreeNode {
  key: string
  label: string
  /** 该节点下的条目数（叶子为 1 或自身 count） */
  count?: number
  children?: TreeNode[]
  tags?: TreeNodeTag[]
  /** 叶子条目携带的 iid，供点击定位 */
  iid?: string
  /**
   * 节标题（仅叶子）。来自联邦库 `spine` 表；label 已按它渲染，
   * 此处留原始值供 tooltip / 检索等二次用途。
   */
  title?: string
  /** 禁用（如「待补建」层） */
  disabled?: boolean
  /** 节点附带的任意数据，渲染层不解释 */
  payload?: Record<string, unknown>
}

export interface FlatRow {
  node: TreeNode
  depth: number
  hasChildren: boolean
  open: boolean
  /** 祖先 key 链（不含自身） */
  path: string[]
}

/* ------------------------------------------------------------------ */
/* 计数                                                                */
/* ------------------------------------------------------------------ */

/**
 * 子孙累计计数：叶子用自己的 count（缺省 1），非叶子用子节点之和。
 * 这是「计数 === 结果数」的唯一来源。
 */
export function countOf(node: TreeNode): number {
  if (node.children && node.children.length) {
    let n = 0
    for (const c of node.children) n += countOf(c)
    return n
  }
  return node.count ?? 1
}

/* ------------------------------------------------------------------ */
/* 检索过滤                                                            */
/* ------------------------------------------------------------------ */

function matches(node: TreeNode, q: string): boolean {
  return node.label.toLowerCase().includes(q) || node.key.toLowerCase().includes(q)
}

/**
 * 按关键词过滤，并重算计数。
 *
 * 语义（由单测锁死）：
 *  - 节点自身命中 → 整棵子树保留（父节点命中意味着其下全部条目都算命中）
 *  - 仅子孙命中   → 保留节点 + 命中子树，count = 命中子孙之和
 *  - 都不命中     → 丢弃
 */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes
  const rec = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = []
    for (const n of list) {
      const self = matches(n, q)
      if (self) {
        // 自身命中：整棵子树保留，count 重新累计
        out.push({ ...n, count: countOf(n) })
        continue
      }
      const kids = n.children?.length ? rec(n.children) : []
      if (kids.length) {
        out.push({ ...n, children: kids, count: kids.reduce((s, k) => s + countOf(k), 0) })
      }
    }
    return out
  }
  return rec(nodes)
}

/* ------------------------------------------------------------------ */
/* 扁平化                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把树摊平成可直接渲染的行。
 *
 * 搜索态（query 非空）自动展开命中路径——用户搜到东西不应该还要手动点开三层。
 */
export function flattenTree(
  nodes: TreeNode[],
  open: ReadonlySet<string>,
  query = '',
  maxDepth = Infinity,
): FlatRow[] {
  const rows: FlatRow[] = []
  const searching = query.trim().length > 0
  const walk = (list: TreeNode[], depth: number, path: string[], forceOpen: boolean) => {
    for (const node of list) {
      const hasChildren = !!node.children?.length
      const isOpen = depth >= maxDepth ? false : forceOpen || open.has(node.key)
      rows.push({ node, depth, hasChildren, open: isOpen, path })
      if (hasChildren && isOpen) {
        walk(node.children as TreeNode[], depth + 1, [...path, node.key], searching)
      }
    }
  }
  walk(searching ? filterTree(nodes, query) : nodes, 0, [], searching)
  return rows
}

/* ------------------------------------------------------------------ */
/* 层级值域（筛选树）                                                  */
/* ------------------------------------------------------------------ */

export interface EnumItem {
  value: string
  count: number
}

/**
 * 由扁平枚举值构建层级树，分隔符默认 '>'。
 *
 * ⚠️ 混合值域的处理：真实数据里 `礼制` 和 `礼制>朝仪` 可能同时存在
 * （前者是「只标到大类」的记录）。此时父节点的计数 = 本类 + 全部子类，
 * 但「本类」那部分在树上没有对应的子节点——直接按子节点求和就会漏计，
 * 又变回「计数 ≠ 结果数」。
 *
 * 解法：给同时拥有自身值和子类的节点插一个 `（本类）` 子节点承载这部分计数，
 * key 加 `!` 后缀避免与父节点 key 撞车，真实筛选值放 `payload.value`。
 * 这样「父节点 count === 子孙累计 === 前缀匹配总数」依然成立。
 */
export function buildHierarchy(items: EnumItem[], sep = '>'): TreeNode[] {
  type Bucket = { count: number; children?: Map<string, Bucket> }
  const root: Bucket = { count: 0, children: new Map() }
  const SELF_SUFFIX = '!'

  for (const it of items) {
    const parts = String(it.value).split(sep).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) continue
    let cur = root
    for (const p of parts) {
      if (!cur.children) cur.children = new Map()
      let next = cur.children.get(p)
      if (!next) {
        next = { count: 0 }
        cur.children.set(p, next)
      }
      cur = next
    }
    cur.count += it.count
  }

  const toNodes = (bucket: Bucket, prefix: string): TreeNode[] => {
    if (!bucket.children) return []
    const out: TreeNode[] = []
    for (const [name, child] of bucket.children) {
      const value = prefix ? `${prefix}${sep}${name}` : name
      const kids = toNodes(child, value)
      // 同时有自身值和子类时，把自身值做成「（本类）」子节点，避免漏计
      if (child.count > 0 && kids.length) {
        kids.unshift({
          key: `${value}${SELF_SUFFIX}`,
          label: '（本类）',
          count: child.count,
          payload: { value },
        })
      }
      out.push({
        key: value,
        label: name,
        count: kids.length ? kids.reduce((s, k) => s + countOf(k), 0) : child.count,
        children: kids.length ? kids : undefined,
        payload: { value },
      })
    }
    return out.sort((a, b) => countOf(b) - countOf(a) || a.label.localeCompare(b.label))
  }
  return toNodes(root, '')
}

/**
 * 前缀匹配计数：对每个前缀，累加「值等于它或以它+分隔符开头」的全部记录条数。
 *
 * 这是「点父节点实际会筛出多少条」的独立口径，用来交叉验证
 * `buildHierarchy` 的子孙累计数——两者必须相等，否则又是「计数 ≠ 结果数」。
 */
export function countByPrefix(
  items: EnumItem[],
  prefixes: string[],
  sep = '>',
): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of prefixes) {
    let n = 0
    for (const it of items) {
      const v = String(it.value)
      if (v === p || v.startsWith(`${p}${sep}`)) n += it.count
    }
    out.set(p, n)
  }
  return out
}

/**
 * 多标签归属树（新官规则层的「6 基类 × 37 组合」用这个，不是前缀树）
 *
 * 值域形如 `禁止型+程序型`，它不属于「禁止型」的**子级**，而是**同时**归属两者——
 * 前缀树（`礼制>朝仪`）会把 `禁止型+程序型` 漏在「程序型」之外，于是
 * 「程序型 显示 128、点进去 96」又变成「计数 ≠ 结果数」。
 *
 * 因此：一个值在它包含的每个标签下都挂一个叶子节点，父节点计数 = 含该标签的值之和。
 * 各父节点计数之和 > 总数是**正确**的（组合被重复计入），`overlap` 把这个差额显式返回，
 * 由调用方在界面上说明，而不是让用户以为算错了。
 */
export function buildTagHierarchy(
  items: EnumItem[],
  sep = '+',
): { nodes: TreeNode[]; total: number; overlap: number } {
  const byTag = new Map<string, EnumItem[]>()
  for (const it of items) {
    const tags = String(it.value)
      .split(sep)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const t of tags) {
      const list = byTag.get(t)
      if (list) list.push(it)
      else byTag.set(t, [it])
    }
  }

  const nodes: TreeNode[] = []
  for (const [tag, list] of byTag) {
    const children: TreeNode[] = [...list]
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .map((it) => ({
        key: `${tag}${sep}${it.value}`,
        label: it.value,
        count: it.count,
        payload: { value: it.value },
      }))
    nodes.push({
      key: tag,
      label: tag,
      count: children.reduce((s, c) => s + countOf(c), 0),
      children,
      // 分支节点没有单一筛选值，标记出来供 UI 用「包含」语义过滤
      payload: { value: tag, tag: true },
    })
  }
  nodes.sort((a, b) => countOf(b) - countOf(a) || a.label.localeCompare(b.label))

  const total = items.reduce((s, it) => s + it.count, 0)
  return { nodes, total, overlap: nodes.reduce((s, n) => s + countOf(n), 0) - total }
}

/** 某值是否属于某标签（tags 筛选的判定，与 buildTagHierarchy 同口径） */
export function valueHasTag(value: string, tag: string, sep = '+'): boolean {
  return String(value)
    .split(sep)
    .map((s) => s.trim())
    .includes(tag)
}

/** 收集某节点下的全部叶子（用于「展开并全选」等批量操作） */
export function collectLeaves(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
  if (node.children?.length) for (const c of node.children) collectLeaves(c, out)
  else out.push(node)
  return out
}

/** 自顶向下找 key 所在路径，找不到返回 null */
export function findPath(nodes: TreeNode[], key: string): string[] | null {
  const walk = (list: TreeNode[], path: string[]): string[] | null => {
    for (const n of list) {
      if (n.key === key) return path
      if (n.children?.length) {
        const hit = walk(n.children, [...path, n.key])
        if (hit) return hit
      }
    }
    return null
  }
  return walk(nodes, [])
}
