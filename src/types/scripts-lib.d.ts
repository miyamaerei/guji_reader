/**
 * 打包脚本共享常量的类型声明。
 *
 * scripts/ 是 .mjs（Node 直跑），src/ 是 .ts（vite 编译），两者共享
 * `ent-fields.mjs` 以避免契约漂移。TS 需要一份声明才能跨模块 import。
 */
declare module '*/scripts/lib/*.mjs' {
  const value: unknown
  export = value
}

declare module '*/scripts/lib/ent-fields.mjs' {
  export const ENT_INDEX_FIELDS: string[]
}