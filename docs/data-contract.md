# 数据契约（P0.2 冻结版）

> 冻结日期：2026-10-10 ｜ 适用范围：`reader-vue` 全部前端代码
> 修改本文件 = 修改契约，**必须同步** `src/core/types.ts` 与 `scripts/schema/book.config.schema.json`

---

## 0. 已确认的决策（影响契约）

| # | 决策 | 对契约的影响 |
| --- | --- | --- |
| 1 | 两书一起做到 MVP-3 | 契约必须同时容纳水东 8 层与新官 5 层，且两者目录层级不同（`[volume,item]` vs `[volume,chapter,item]`） |
| 2 | 只做 http 静态站 | **数据放 `public/data/`，运行期用 fetch 按需加载**。不再要求「运行期零 fetch」——这让卷级 chunk 懒加载成为天然形态（风险 R4 直接缓解） |
| 3 | 需支持发布到网络 | vite `base: './'` + hash 路由，产物可直接扔到任意静态托管，无需服务端 rewrite |
| 4 | v2 跨书关联单独立项 | `gid` 字段与 `globalEntities` 保留在类型里（便于平滑升级），但本次不实现任何相关 UI |
| 5 | 路由模式（推导） | hash 路由，与设计文档 §6.1 的 `#/...` 写法一致 |

---

## 1. 目录与数据流

```
配置源（人写）               构建/打包产物（P1 打包器生成）        运行期
src/books/<slug>/            public/data/<bookId>/                fetch 按需加载
  book.config.json   ──复制──▶  book.config.json      ──▶  dataProvider.config()
                                meta.json             ──▶  dataProvider.meta()
                                chapters.json         ──▶  dataProvider.chapters()
                                items/<NN>.json       ──▶  dataProvider.itemChunk()  ← 进卷才加载
                                layers/<layer>.json   ──▶  dataProvider.layer()
                                entities.json         ──▶  dataProvider.entities()
                                join.json             ──▶  dataProvider.join()
                                enums.json            ──▶  dataProvider.enums()
                                search-index.json     ──▶  dataProvider.searchIndex()
public/data/index.json  ← 书架清单，只列数据完整的书
```

> 约定：**改源数据必须重跑打包器，不手工改 `public/data` 下的数据包**（继承旧版教训）。

---

## 2. 硬约束（违反即数据不可用）

1. **`iid` = `章号-序号`**（如 `01-001`），全书唯一、可排序，是所有层对齐的锚点。
   数值化口径统一为 `parseInt(iid.slice(3), 10)`——旧版「数字/字符串比较不一致」导致目录展开态错乱，禁止字符串直接比较。
2. **书证三件套**：任何层记录必须带 `original` / `source` / `confidence`。
3. **实体 span 偏移可断言**：`item.text.slice(span.s, span.e) === span.text`。
   这是风险 R1（正文着色全错）的唯一防线，打包期与运行期（`assertSpans`）共用同一口径。
4. **前端不写死任何书的字段**：导航 tab、筛选维度、详情块全部由 `book.config.json` 推导。

---

## 3. book.config.json

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `bookId` | string | 英文短名，同时是 `public/data/` 下的目录名 |
| `title` / `subtitle` / `genre` | string | 书架卡片展示 |
| `structure.tree` | string[] | 目录层级，如 `["volume","item"]` |
| `structure.chunkBy` | 'volume' \| 'chapter' | 懒加载分块粒度 |
| `structure.groupSize` | number | 每组条目数（旧版 GROUPS=5；水东因卷内条目多取 10） |
| `colors.primary` | string | 书主色，切书即换肤 |
| `colors.entityTypes` | Record<string,string> | 实体类型配色 |
| `layers[]` | LayerDecl[] | 要素声明，见下 |
| `join.layers` / `join.primary` | string[] / string | 跨层索引参与列与主键层 |
| `volProfile.enabled` | boolean | 卷阅读模式（VOL）；无标注的书设 false，前端隐藏该列 |

### LayerDecl

| 字段 | 说明 |
| --- | --- |
| `id` | 对应 `layers/<id>.json` |
| `label` | tab 名 |
| `required` | 公共必配层（ent / event）为 true |
| `tag` | 目录条目行尾徽标缩写（EN / AP / RG…），由 join 动态生成，不写死 R/P/E/S/T |
| `reserved` | 拓展要素：数据缺失时列表显示「待补建」而非白屏 |
| `views.list` | `table` / `card` / `tree` |
| `views.detail` | 详情块集合：`table` / `timeline` / `graph` / `flow` / `roster` / `parallel` / `note` / `slots` / `tabs` |
| `filter` | `chips`（扁平枚举）/ `tree`（有层级的值域：规则基类、卷模式）/ `none` |
| `filterBy` / `groupBy` | 筛选与分组依据字段 |
| `fields` | 字段声明，驱动列表列与详情块 |

### 三级启用判定（设计文档 §5.2）

| 级别 | 判定 | 表现 |
| --- | --- | --- |
| public | `id ∈ {ent, event}` | 必配，缺失则配置校验报错 |
| declared | 配置声明且 `reserved` 非真 | 正常启用 |
| reserved | `reserved: true` | tab 显示「待补建」 |

---

## 4. data 包文件规格

| 文件 | 结构 | 要点 |
| --- | --- | --- |
| `meta.json` | `{ bookId, title, stats, volumes[], vol_modes? }` | `stats` 的计数口径与校验脚本一致 |
| `chapters.json` | `ChapterNode[]` | 目录树骨架（卷/章 + 计数） |
| `items/<NN>.json` | `{ volume, items: ItemRecord[] }` | 每卷一块，进卷才加载 |
| `layers/<layer>.json` | `{ layer, count, records: LayerRecord[] }` | 记录含三件套 |
| `entities.json` | `Record<eid, EntityEntry>` | 主键表；`gid` 为 v2 预留（本次恒 null） |
| `join.json` | `{ columns, rows: JoinRow[] }` | `ids: Record<layerId, string[]>` |
| `enums.json` | `Record<layerId, Record<field, {value,count}[]>>` | chips / tree 的值域与计数 |
| `search-index.json` | `{ bookId, docs: SearchDoc[] }` | 构建期生成，运行期内存检索 |

### ItemRecord

```
iid        条粒度主键 `章号-序号`
ordinal    数值化序号 = parseInt(iid.slice(3))
volume     卷号
chapter    章号（structure.tree 含 chapter 时才有）
text       原文
norm       归一化原文（检索用）
translation 译文（可选）
spans      EntitySpan[]
```

### EntitySpan

```
id         mention 唯一 id（M00001）——**不是**实体主键
eid        实体主键，指向 entities.json
text       原文实际切片，恒满足 text === 原文.slice(s, e)
type       实体类型
s, e       原文偏移（闭开区间）
normalized 归一词
surface    源标注词形；仅当与原文字形不一致（异体字）时存在
confidence number | null
```

> **为什么 id 不是实体主键**：源数据里 `ENT-001`（礼部）在全书出现 4 次、`ENT-002`（鸿胪寺）
> 出现 3 次——它是「实体主键」而非「标注实例主键」。若直接把 ENT-NNN 当 id，前端用它做
> 列表 key / 路由参数必然撞车。因此打包期给每条标注发独立 mention id，主键另置 `eid`。
> 水东实测：1900 个主键 ↔ 2253 条标注；新官：591 ↔ 1981。

### LayerRecord

```
id         层内主键。主键层（ent）用 mention id；其余层用源 id（APPT-001 / XGF-R-001 …）
eid        仅主键层有：指向 entities.json
item_id    所属条目 iid
original / source / confidence   书证三件套（必带，见下方口径）
volume     冗余卷号，便于免二次查表
...        层特有字段，由 book.config.json 的 fields 声明
```

三件套口径：
- `original` 为空的层（源数据不提供），打包期回查条目原文补全；
- `source` 缺失时补 `"原文"`，计入 `meta.build.imputed.source`；
- `confidence` 源数据未提供时**置 null，不臆造**，计入 `meta.build.imputed.confidence`。

---

## 5. 跨书索引的列名映射

水东源 CSV 用复数列名，契约统一为层 id：

| CSV 列名 | 契约层 id |
| --- | --- |
| `ents` | `ent` |
| `appts` | `appt` |
| `events` | `event` |
| `regs` | `reg` |
| `lits` | `lit` |
| `rels` | `rel` |
| `nams` | `nam` |
| `trls` | `trl` |

分号分隔的多值解析为 `string[]`。

---

## 6. 与旧版约定的映射（防止丢失）

| 旧版约定 | 本契约落点 |
| --- | --- |
| 条粒度 iid | `ItemRecord.iid` + `ordinal` |
| 实体 span（s/e + 归一词） | `EntitySpan` + `assertSpans()` |
| 跨层索引 join | `join.json` 的 `ids` |
| 书证三件套 | `Evidence`，配置校验强制 |
| 覆盖式渲染 / 滚动续接 | P2.5 实现，状态在 `stores/toc.ts` |
| 前缀匹配 + 子孙累计计数 | P2.3 TreeNav，单测锁死 |

---

## 6.5 P1 实测：两书源数据适配记录

打包时发现并已固化的差异（新增一本书时按此清单比对）：

| 项 | 水东日记 | 新官轨范 |
| --- | --- | --- |
| 目录层级 | `volume → item`（38 卷） | `volume → chapter → item`（2 卷 / 11 章） |
| 条目原文来源 | 各层记录的 `original`（跨层 1192 条完全一致） | `索引/_item_registry.json`（标注层不带原文） |
| 条目数 | 1192（源 join 里的卷「00」5 条全空，已剔除） | 275（含 00-001 版本说明） |
| 实体主键 / 标注 | 1900 / 2253 | 591 / 1981 |
| 事件、流程关联条目 | 直接用 `item_id` | 用 `derived_from[]`，取首项 |
| 结构层 | 无 | 五维 `ledgers/times/docs/actors/frauds` 合并为一层，加 `dimension` |
| 字段改名 | `content→summary`、`category→type`、`relation_type→type`、`scope→range`、`content_location→text` | `prohibited_action→prohibition`、`obligation_action→obligation`、`punishment→penalty`、`modals→modality`、`timeline→states` |
| 卷阅读模式 | 无源标注，`enabled: true` 但 modes 待 P5 派生 | `enabled: false` |

### 6.5.1 span 定位的三级降级（P1 最高风险项的落地结果）

源数据 gap：水东 2253 条标注中 **291 条 `start/end` 为 null**。诊断后发现不是偏移算错，
而是**字形差异**（标注词形为规范字，原文用异体字：`聦/聪`、`戸/户`、`舎/舍`、`闗/关`、
`髙/高`、`顔/颜`…）。定位策略与实测命中：

| 级别 | 方法 | 水东 | 新官 |
| --- | --- | --- | --- |
| L1 | 源 `s/e` 有效且 `slice` 断言通过 | 1962 | 1981 |
| L2 | `indexOf(text)` | 0 | 0 |
| L3 | **等长**滑动窗口最小替换距离（容差 `max(1, len/3)`） | 238 | 0 |
| L0 | 未定位（差异过大，53 条） | 53 | 0 |
| | span 覆盖率 | **97.6%** | **100%** |

两处关键设计：
1. **L3 必须等长**——不做插入删除，偏移天然对齐，不会出现"差一位导致整段着色错位"。
2. **L3 命中时 `span.text` 取原文实际切片**（如「季聪」而非标注的「季聦」），
   原词形存入 `surface`。否则契约断言 `text.slice(s,e) === span.text` 必然失败。
3. L0 的记录**不丢**：仍进 `layers/ent.json` 与 `join.ids`，可检索、可跳转，只是正文不着色。
   未定位清单落盘在 `scripts/out/<bookId>.unlocated.json`，便于后续人工补表。

### 6.5.2 同条目内 span 去重

实体主键会跨条目复现，同一条目内也可能出现嵌套标注（「礼部尚书」内套「礼部」）。
打包期按起点排序后丢弃与已保留项重叠的后续项，实测水东丢弃 32 条真嵌套。
`meta.build.span_dropped_overlap` 记录该数量；L0 不参与该计数。

---

## 7. 打包与校验入口

```bash
npm run data        # 打包两书 → public/data/<bookId>/
npm run data:sd     # 只打包水东
npm run data:xg     # 只打包新官
npm run validate    # 校验全部数据包
npm run pack        # data + validate 串联（发版前跑这个）
```

* 打包器：`scripts/build_book_data.mjs`（通用，不含任何书名/字段硬编码）
  * 书特有的一切在 `scripts/profiles/<bookId>.mjs`：源路径、层定义、字段映射、卷/章标签。
  * **新增一本书 = 加一个 profile**，打包器与前端零改动（P0 门禁在真书上的延续）。
* 校验器：`scripts/validate_pack.mjs`，6 组断言 C1–C6（计数守恒 / span 断言 / 引用完整 /
  三件套 / 主键唯一 / 序号一致），非零退出码可直接接 CI。
* 配置校验：`validateBookConfig(config)`（`src/core/layerSchema.ts`），打包器与运行期共用。
* JSON Schema：`scripts/schema/book.config.schema.json`。
* span 校验：`assertSpans(items)`（运行期 dev 自检，与打包期同口径）。

### 当前数据包状态（2026-10-10 P1 完成）

| 书 | 条目 | 卷/章 | 实体主键 | 标注 | span 覆盖 | 校验 |
| --- | --- | --- | --- | --- | --- | --- |
| 水东日记 | 1192 | 38 卷 | 1900 | 2253 | 97.6%（L0 53） | 0 错误 |
| 新官轨范 | 275 | 2 卷 11 章 | 591 | 1981 | 100% | 0 错误 |

已知警告：水东 53 条实体字形差异过大未能定位；水东 event 层源数据未提供 confidence（234 条置 null）。
