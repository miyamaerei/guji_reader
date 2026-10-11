# 多书知识阅读器 `reader-vue`

用**一套前端**读**结构不同的多本古籍知识图谱**。当前接入《水东日记》（明·叶盛）与《新官轨范》（明·佚名）。

设计原则：**前端不写死任何书的字段**——目录层级、层 tab、筛选维度、详情块全部由 `book.config.json` 推导。
新增一本书 = 加一个数据包 + 一个配置，前端零改动。

## 快速开始

```bash
npm install                # 见下方「本机注意事项」
npm run data               # 打包两书 → public/data/
npm run validate           # 校验数据包（6 组断言）
npm run dev                # 开发预览
npm run build              # 类型检查 + 生产构建
```

访问：`/` 书架 ｜ `/#/reader/<bookId>` 阅读器 ｜ `?vol=01` 可深链到指定卷。

## 目录

```
src/
  core/          契约类型、配置解析、数据加载、span 切分
  stores/        bookContext（切书重置）/ toc（目录状态与不变量）/ crumbs
  views/         Bookshelf / Reader / List / Detail / Search
  books/         每书一个目录，放 book.config.json（配置源）
scripts/
  build_book_data.mjs    通用打包器（无书名/字段硬编码）
  validate_pack.mjs      数据包校验（C1–C6）
  profiles/<bookId>.mjs  书的全部差异都在这（源路径、层定义、字段映射、卷章标签）
  lib/span.mjs           span 三级降级定位
public/data/<bookId>/    打包产物
docs/data-contract.md    数据契约（冻结版 + P1 实测适配记录）
```

## 数据契约要点

* 条目主键 `iid = 章号-序号`，是各层对齐的锚点。
* **`ENT-NNN` 是实体主键，不是标注实例主键**。同一主键跨条目复现（礼部 ENT-001 出现 4 次），
  因此每条标注发独立 mention id，主键另置 `eid`。
* span 不变量：`原文.slice(s, e) === span.text`。源数据为异体字时 `text` 取原文实际切片，
  原词形存 `surface`。
* 书证三件套 `original / source / confidence` 必带；源数据不提供时 `confidence` **置 null 不臆造**。

详见 `docs/data-contract.md`。

## 当前数据

| 书 | 条目 | 卷/章 | 实体主键 | 标注 | span 覆盖 | 校验 |
| --- | --- | --- | --- | --- | --- | --- |
| 水东日记 | 1192 | 38 卷 | 1900 | 2253 | 97.6% | 0 错误 |
| 新官轨范 | 275 | 2 卷 11 章 | 591 | 1981 | 100% | 0 错误 |

## 本机注意事项（Windows）

本机 npm 装依赖时 `esbuild` / `rollup` 的 postinstall 会失败。解法：

```bash
npm install --ignore-scripts
npm install --ignore-scripts --save-optional @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc
```

（已在 `optionalDependencies` 中固化。）

## 路线

P0 骨架与契约 → **P1 数据打包（已完成）** → P2 公共阅读器 → P3/P4 两书专用层视图 → P5 性能与发布 → v2 跨书关联（另立项）。
