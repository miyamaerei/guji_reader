/**
 * 卷阅读模式（VOL）派生（P3.7）
 *
 * 设计文档/数据契约都写明：水东「无源标注，enabled:true 但 modes 待派生」。
 * 因此这里分两路：
 *  - meta.vol_modes 已存在（真实主题标注）→ 直接用，前端零改动；
 *  - 不存在（当前水东实况）→ 退化为单一「全卷」模式，覆盖全部卷，
 *    使「模式→卷→条目」过滤树与目录卷徽标这套基础设施端到端可用。
 *    真实多模式一旦在数据包里补齐即自动生效。
 */
import type { BookMeta, VolProfile } from '@/core/types'

export function deriveVolProfile(meta: BookMeta): VolProfile {
  if (meta.vol_modes) return meta.vol_modes
  const all = 'all'
  const byVolume: Record<string, string> = {}
  let itemCount = 0
  for (const v of meta.volumes) {
    byVolume[v.id] = all
    itemCount += v.itemCount || 0
  }
  return {
    modes: [{ key: all, label: '全卷', volumeCount: meta.volumes.length, itemCount }],
    byVolume,
  }
}
