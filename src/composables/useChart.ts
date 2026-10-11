/**
 * ECharts 组合式封装（P3 专用块共用）
 *
 * 设计取舍：
 *  - 四个专用块组件都用 `defineAsyncComponent` 懒加载，因此 echarts 只在真正打开
 *    任职时间线 / 关系图时才进包，不拖累阅读器首屏（P5 性能门禁的提前布置）。
 *  - 组件卸载时 dispose，ResizeObserver 自适应容器宽度。
 */
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'

export function useChart(
  el: Ref<HTMLElement | null>,
  option: Ref<echarts.EChartsOption>,
) {
  const chart = shallowRef<echarts.ECharts | null>(null)
  let ro: ResizeObserver | null = null

  function render() {
    if (!chart.value) return
    chart.value.setOption(option.value, true)
  }

  onMounted(() => {
    if (!el.value) return
    chart.value = echarts.init(el.value)
    ro = new ResizeObserver(() => chart.value?.resize())
    ro.observe(el.value)
    render()
  })

  watch(option, render, { deep: true })

  onBeforeUnmount(() => {
    ro?.disconnect()
    chart.value?.dispose()
    chart.value = null
  })

  return { chart, render }
}
