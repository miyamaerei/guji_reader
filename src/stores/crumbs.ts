/**
 * 面包屑与历史回跳（P2.9 的能力，P0 先把状态容器定下来）
 * 切书必须清空：历史回跳栈不跨书（设计文档 §6.1.2 不变量 5）
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Crumb {
  label: string
  to: string
}

export const useCrumbsStore = defineStore('crumbs', () => {
  const stack = ref<Crumb[]>([])

  function push(crumb: Crumb): void {
    const idx = stack.value.findIndex((c) => c.to === crumb.to)
    if (idx >= 0) stack.value.splice(idx)
    stack.value.push(crumb)
  }

  function popTo(to: string): void {
    const idx = stack.value.findIndex((c) => c.to === to)
    if (idx >= 0) stack.value.splice(idx + 1)
  }

  function reset(): void {
    stack.value = []
  }

  return { stack, push, popTo, reset }
})
