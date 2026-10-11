/**
 * 极简直测运行器：用已有的 esbuild 把 tests/*.ts 现编成 JS 再用 node 跑。
 *
 * 不引 vitest 的原因：本机 npm 装依赖的 postinstall 会失败（esbuild/rollup 原生包），
 * 且 vitest 与已锁定的 vite 5 存在 peer 冲突。esbuild 已在 node_modules 里，零新增依赖。
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'scripts/out')

const entries = fs
  .readdirSync(path.join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(ROOT, 'tests', f))

if (!entries.length) {
  console.log('没有找到测试用例')
  process.exit(0)
}

fs.mkdirSync(OUT, { recursive: true })

for (const entry of entries) {
  const outfile = path.join(OUT, path.basename(entry).replace(/\.ts$/, '.mjs'))
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    logLevel: 'warning',
    alias: { '@': path.join(ROOT, 'src') },
  })
  console.log(`\n▶ ${path.basename(entry)}`)
  const r = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
