/**
 * 跨阅读器的 UI 偏好开关（P3.6）
 *
 * 当前只有一个：正文是否随原文显示译文。放独立 store 是因为它跨视图（阅读器、
 * 整页详情）共享，且状态应在切书/重进时保持。后续若加夜间模式等也放这里。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** 正文译文开关：开启后所有带译文的条目一并显示译文 */
  const showTranslation = ref(false)
  return { showTranslation }
})
