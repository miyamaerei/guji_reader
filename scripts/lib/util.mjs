/**
 * 打包器公共工具
 *
 * 约定：所有内部文本统一用 UTF-8 读写；控制台输出走 out() 以规避 Windows GBK 终端。
 */

import fs from 'node:fs'
import path from 'node:path'

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

export function writeJson(p, data, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf8')
  return p
}

/** Windows 控制台可能是 GBK，逐行输出前做一次探测，失败就降级 */
const enc = process.stdout.encoding || 'utf8'
export function out(...args) {
  const line = args.join(' ')
  try {
    process.stdout.write(line + '\n')
  } catch {
    process.stdout.write(Buffer.from(line + '\n', 'utf8').toString(enc) + '\n')
  }
}

/** UTF-8 安全读 CSV（去 BOM） */
export function readCsv(p) {
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
  const rows = []
  let row = [],
    cell = '',
    quoted = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c === '\r') {
      /* skip */
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  const head = rows.shift() || []
  return rows
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** 计数 Map 转有序数组 */
export function tally(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'zh'))
}

/** 推入计数 Map */
export function bump(map, key, n = 1) {
  map.set(key, (map.get(key) || 0) + n)
  return map
}

/** `01-001` -> 1 */
export function ordinalOf(iid) {
  const m = /-(\d+)$/.exec(iid)
  return m ? parseInt(m[1], 10) : NaN
}

export function volumeOf(iid) {
  const m = /^([^-]+)-/.exec(iid)
  return m ? m[1] : ''
}

/** 去空白，供检索与比对 */
export function squash(s) {
  return (s || '').replace(/\s+/g, '')
}

/** 截断，供搜索摘要 */
export function excerpt(s, n = 120) {
  const t = (s || '').replace(/\s+/g, ' ')
  return t.length <= n ? t : t.slice(0, n) + '…'
}

/** 目录遍历（非递归） */
export function listFiles(dir, re) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => re.test(f))
}

export const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-')
