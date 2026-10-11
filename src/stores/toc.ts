/**
 * 目录状态模型（P2.4）
 *
 * 单一数据源：currentVol / currentGroup 永远由 currentItem 推导，不允许独立赋值。
 * 不变量（设计文档 §6.1.2，本节全部有单测覆盖的部分见 tests/core.test.ts）：
 *  1. currentVol / currentGroup = f(currentItem)
 *  2. 单组模式下每个容器（卷或章）至多展开一个组
 *  3. currentItem 所在组必须处于展开路径（ensureVisible 保证）
 *  4. 分组序号按容器内下标，不拿 iid 数值做全书分组
 *  5. 切书整树重置
 *
 * 「滚动续接」与「点击定位」是两条不同的路径：
 *  - 点击目录 → selectItem()：设置 currentItem + pendingScroll，由正文流消费后滚动
 *  - 滚动正文 → setFocus()：只更新 currentItem（用于目录高亮），**不触发滚动**，
 *    否则会出现「滚动 → 高亮 → 滚动」的抖动回环。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { findPath, type TreeNode } from '@/core/tree'
import type { TocIndex } from '@/core/toc'

export const useTocStore = defineStore('toc', () => {
  const nodes = ref<TreeNode[]>([])
  /** iid -> 卷/组/章 的定位索引，由目录树构建时一并产出 */
  const index = ref<TocIndex | null>(null)

  const openKeys = ref<Set<string>>(new Set())
  /** 单组模式：容器 key -> 展开的组号 */
  const openGroups = ref<Map<string, number>>(new Map())
  const multiOpen = ref(false)

  const currentItem = ref<string | null>(null)
  /** 待滚动条目，正文流渲染完成后消费（一次性） */
  const pendingScroll = ref<string | null>(null)
  /** 当前视口顶部条目（滚动驱动，不会反向触发滚动） */
  const focusItem = ref<string | null>(null)

  const searchTerm = ref('')
  const collapsed = ref(false)
  const groupSize = ref(10)

  const currentVol = computed(() =>
    currentItem.value ? index.value?.volumeOf.get(currentItem.value) ?? null : null,
  )
  const currentGroup = computed(() =>
    currentItem.value ? index.value?.groupOf.get(currentItem.value) ?? null : null,
  )
  /** 当前条目所在的展开路径（卷 → [章] → 组） */
  const currentPath = computed<string[]>(() =>
    currentItem.value ? findPath(nodes.value, currentItem.value) ?? [] : [],
  )

  function isOpen(k: string): boolean {
    return openKeys.value.has(k)
  }

  function toggle(key: string): void {
    const next = new Set(openKeys.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    openKeys.value = next
  }

  function openOnly(key: string): void {
    const next = new Set(openKeys.value)
    next.add(key)
    openKeys.value = next
  }

  /** 不变量 3：让 iid 所在的整条路径都展开 */
  function ensureVisible(iid: string): void {
    const idx = index.value
    if (!idx) return
    const vol = idx.volumeOf.get(iid)
    const container = idx.containerOf.get(iid)
    const group = idx.groupOf.get(iid)
    if (vol === undefined || container === undefined || group === undefined) return

    const next = new Set(openKeys.value)
    next.add(vol)
    if (container !== vol) next.add(container)
    next.add(`${container}#${group}`)
    openKeys.value = next

    // 不变量 2：单组模式下同一容器只留一个组
    if (!multiOpen.value) {
      const groups = new Map(openGroups.value)
      groups.set(container, group)
      openGroups.value = groups
      // 把同容器下其它已展开的组收起来，保持 openKeys 与 openGroups 一致
      for (const k of [...next]) {
        if (k.startsWith(`${container}#`) && k !== `${container}#${group}`) next.delete(k)
      }
      openKeys.value = new Set(next)
    }
  }

  /** 点击目录：定位 + 请求滚动 */
  function selectItem(iid: string): void {
    currentItem.value = iid
    focusItem.value = iid
    ensureVisible(iid)
    pendingScroll.value = iid
  }

  /** 滚动驱动：只更新高亮，绝不设置 pendingScroll */
  function setFocus(iid: string | null): void {
    if (focusItem.value === iid) return
    focusItem.value = iid
    if (iid && currentItem.value !== iid) {
      currentItem.value = iid
      ensureVisible(iid)
    }
  }

  /** 正文流消费掉滚动请求 */
  function consumeScroll(): string | null {
    const v = pendingScroll.value
    pendingScroll.value = null
    return v
  }

  function setIndex(n: TreeNode[], i: TocIndex, gs: number): void {
    nodes.value = n
    index.value = i
    groupSize.value = gs
  }

  function toggleVolume(vol: string): void {
    toggle(vol)
  }

  function expandAll(levels = 1): void {
    const next = new Set(openKeys.value)
    const walk = (list: TreeNode[], depth: number) => {
      for (const n of list) {
        if (!n.children?.length) continue
        if (depth < levels) next.add(n.key)
        walk(n.children, depth + 1)
      }
    }
    walk(nodes.value, 0)
    openKeys.value = next
  }

  function collapseAll(): void {
    openKeys.value = new Set()
    openGroups.value = new Map()
  }

  function reset(): void {
    nodes.value = []
    index.value = null
    openKeys.value = new Set()
    openGroups.value = new Map()
    currentItem.value = null
    focusItem.value = null
    pendingScroll.value = null
    searchTerm.value = ''
  }

  return {
    nodes,
    index,
    openKeys,
    openGroups,
    multiOpen,
    currentItem,
    focusItem,
    pendingScroll,
    searchTerm,
    collapsed,
    groupSize,
    currentVol,
    currentGroup,
    currentPath,
    isOpen,
    toggle,
    openOnly,
    ensureVisible,
    selectItem,
    setFocus,
    consumeScroll,
    setIndex,
    toggleVolume,
    expandAll,
    collapseAll,
    reset,
  }
})
