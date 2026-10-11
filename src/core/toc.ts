/**
 * 目录树构建（P2.4）
 *
 * 输入是打包期产出的 chapters.json（卷 → [章] → 条），输出 TreeNav 可渲染的
 * TreeNode[]。分组节点在这里生成——chapters.json 只到条目，不预置分组，
 * 这样改 groupSize 不需要重跑打包器。
 *
 * 分组序号用「条目在父容器 children 里的下标」，不用 iid 数值：
 * iid 的序号是卷内重编的（`01-001`/`02-001` 序号都从 1 起），
 * 拿它做全书分组会错位。这是旧版数字/字符串混用 bug 的同类雷区。
 */
import type { ChapterNode } from './types'
import type { TreeNode, TreeNodeTag } from './tree'

export interface TocBuildOptions {
  /** structure.tree，如 ['volume','item'] 或 ['volume','chapter','item'] */
  tree: string[]
  /** 每组条目数 */
  groupSize: number
  /** 条目行尾的层命中徽标（来自 join.json） */
  tagOf?: (iid: string) => TreeNodeTag[]
}

/** iid -> 所属容器（三层书是「卷/章」，两层书是卷） */
export type ContainerMap = Map<string, string>

export interface TocIndex {
  /** iid -> 卷 */
  volumeOf: Map<string, string>
  /** iid -> 分组父容器 key */
  containerOf: ContainerMap
  /** iid -> 在容器内的组号 */
  groupOf: Map<string, number>
}

function groupLabel(start: number, end: number): string {
  return start === end ? `第 ${start} 条` : `第 ${start}–${end} 条`
}

/** 把一组条目节点包成分组节点列表 */
function wrapGroups(
  leaves: TreeNode[],
  containerKey: string,
  groupSize: number,
  index: TocIndex,
): TreeNode[] {
  if (!leaves.length) return []
  if (groupSize <= 0) return leaves
  const groups: TreeNode[] = []
  for (let i = 0; i < leaves.length; i += groupSize) {
    const slice = leaves.slice(i, i + groupSize)
    const gi = Math.floor(i / groupSize)
    const key = `${containerKey}#${gi}`
    for (const leaf of slice) index.groupOf.set(leaf.iid as string, gi)
    groups.push({
      key,
      label: groupLabel(i + 1, i + slice.length),
      count: slice.length,
      children: slice,
    })
  }
  return groups
}

/**
 * 一次遍历同时产出树与索引，避免「树和索引各算一遍、口径可能分叉」。
 */
export function buildTocTree(
  chapters: ChapterNode[],
  opts: TocBuildOptions,
): { nodes: TreeNode[]; index: TocIndex } {
  const useChapter = opts.tree.includes('chapter')
  const index: TocIndex = { volumeOf: new Map(), containerOf: new Map(), groupOf: new Map() }
  const nodes: TreeNode[] = []

  for (const vol of chapters) {
    const volKey = vol.key
    let groupsUnder: { key: string; label: string; leaves: TreeNode[] }[] = []

    if (useChapter) {
      for (const chap of vol.children ?? []) {
        const leaves = (chap.children ?? []).map((it) => leaf(it.key, it.count, opts))
        for (const l of leaves) {
          index.volumeOf.set(l.iid as string, volKey)
          index.containerOf.set(l.iid as string, chap.key)
        }
        groupsUnder.push({ key: chap.key, label: chap.label, leaves })
      }
    } else {
      const leaves = (vol.children ?? []).map((it) => leaf(it.key, it.count, opts))
      for (const l of leaves) {
        index.volumeOf.set(l.iid as string, volKey)
        index.containerOf.set(l.iid as string, volKey)
      }
      groupsUnder = [{ key: volKey, label: vol.label, leaves }]
    }

    const childNodes: TreeNode[] = []
    for (const g of groupsUnder) {
      const groups = wrapGroups(g.leaves, g.key, opts.groupSize, index)
      if (useChapter) {
        childNodes.push({
          key: g.key,
          // 章名取 chapters.json 给的 label（如「卷上 · 体立为政事情」），
          // 不要从 key（`01/01`）里切——那只能得到章号，中文标题就丢了
          label: g.label,
          count: g.leaves.length,
          children: groups,
        })
      } else {
        childNodes.push(...groups)
      }
    }

    nodes.push({
      key: volKey,
      label: vol.label,
      count: vol.count,
      children: childNodes,
    })
  }

  return { nodes, index }
}

/**
 * iid → 卷 的映射（唯一权威口径）
 *
 * ⚠️ 不要用 `iid.slice(0, 2)` 当卷号。两书的 iid 前缀语义不同：
 *  · 水东（38 卷两层）：前缀是**卷号**，卷内序号从 1 重编（01-001 … 38-xxx）
 *  · 新官（3 卷三层）：前缀是**章号**，卷下含章 02–11（02-001 … 11-015），
 *    按前缀去取 chunk 会请求不存在的 items/05.json
 *
 * 唯一可靠的做法是从 chapters.json 的树结构解析——树上的父子关系就是权威。
 */
export function buildIidVolumeMap(chapters: ChapterNode[]): Map<string, string> {
  const m = new Map<string, string>()
  const walk = (volKey: string, nodes: ChapterNode[]) => {
    for (const n of nodes) {
      if (n.children?.length) walk(volKey, n.children)
      else m.set(n.key, volKey)
    }
  }
  for (const v of chapters) walk(v.key, v.children ?? [])
  return m
}

function leaf(iid: string, count: number, opts: TocBuildOptions): TreeNode {
  return {
    key: iid,
    label: iid,
    count: count,
    iid,
    tags: opts.tagOf?.(iid) ?? [],
  }
}
