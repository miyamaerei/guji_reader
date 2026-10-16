# 多书知识阅读器 `reader-vue`

用**一套前端**读**结构不同的多本古籍知识图谱**。当前主用形态为**联邦数据库模式**：
直查联邦知识库 `kb.sqlite`（**13 书**，含《水东日记》（明·叶盛）、《新官轨范》（明·佚名）等），见文末「联邦数据库模式」。

设计原则：**前端不写死任何书的字段**——目录层级、层 tab、筛选维度、详情块全部由数据源推导
（联邦模式由 `layer_catalog`/`layer_fields` 推导，书目元信息由 `book_meta` 表带出）。
新增一本书 = 联邦库加数据（items/records/nodes）+ `book_meta` 元信息，前端零改动。

## 快速开始

```bash
npm install                # 见下方「本机注意事项」
npm run dev:fed -- --db "E:/git/ToolBox/guji/tools/kb-federation/kb.sqlite"
                          # 开发模式：联邦 API(:8787) + Vite(:5173) 双进程
npm run build              # 类型检查 + 生产构建
```

访问：`/` 书架 ｜ `/#/reader/<bookId>` 阅读器（`?vol=01` 深链指定卷）｜ `/#/search` 跨书检索。

## 视觉主题「宣纸墨卷」

全站为古风（古香古色 + 卷轴形式），令牌与组件语汇集中在 `src/styles.css`，改色只动这一处：

* **色板**：宣纸底 `--paper #f6efdd`、墨色字 `--ink #2e2a23`、朱砂交互色 `--cinnabar #9c2b23`
  （chrome 唯一主色，各书身份色只保留在实体行内着色）、赭石/金/青黛（注疏译文）/木轴色系。
* **字体**：正文宋体系（serif 栈），楷体只用于题签、品牌、标题等点睛处。
* **卷轴**：阅读器中栏 = 上木轴（`.roller`，金色轴帽）+ 纸身（ItemStream，左右双线侧缘）+ 下木轴；
  顶栏/书架/详情等组件取「天头、册页、竹简、方笺、印章」语汇。
* **布局**：外壳为定高链（`html/body/#app{height:100%}` + `.app-shell{overflow:hidden}`），
  各页在各自滚动容器内滚、题头常驻——改 `min-height:100vh` 会当场撑爆（走查记录 G2）。

## 目录

```
src/
  core/          契约类型、配置解析、数据加载（api.ts 联邦源）、span 切分
  stores/        bookContext（切书重置）/ toc（目录状态与不变量）/ crumbs / layers
  views/         Bookshelf / Reader / List / Detail / Search
  books/         P1 JSON 数据包时代的 book.config.json（联邦模式下仅存历史价值）
server/
  sqlite-api.mjs   联邦只读 API（node:http + node:sqlite，零依赖）
  fed-lib.mjs      派生逻辑（config/meta/chapters/items/layers/entities/assoc/检索）
  book-meta.seed.sql  书目元信息种子（朝代/作者/体裁，灌入 kb.sqlite 的 book_meta 表）
scripts/
  build_book_data.mjs    通用打包器（P1 历史工具）
  validate_pack.mjs      数据包校验（C1–C6，P1 历史工具）
  profiles/<bookId>.mjs  P1 各书源路径/层定义差异
  lib/span.mjs           span 三级降级定位
  dev-fed.mjs            开发双进程（API 8787 + Vite 5173）
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

联邦模式（实时查库，以 `/api/books` 为准）：

| 书 | 条目 | 卷 | 实体主键 | 标注 |
| --- | --- | --- | --- | --- |
| 客座赘语 | 471 | 10 | 6175 | 8481 |
| 水东日记 | 1192 | 38 | 1900 | 2253 |
| 五杂俎 | 1288 | 12 | 3832 | 5821 |
| 新官轨范 | 274 | 11 | 591 | 591 |
| 先进遗风 | 100 | 2 | 9 | 9 |
| 政学录 | 183 | 5 | 1100 | 1100 |
| 吕公实政录 | 119 | 15 | 573 | 573 |
| 蘧编 | 71 | 20 | 805 | 997 |
| 宛署杂记 | 155 | 20 | 333 | 333 |
| 福惠全书 | 274 | 33 | 646 | 646 |
| 平平言 | 284 | 4 | 337 | 337 |

> P1 时代另有 JSON 数据包模式（`npm run data` / `npm run validate` / `public/data/`），
> 限于《水东日记》《新官轨范》两书，**已被联邦模式取代**：`dataProvider` 现硬接 `/api`，
> JSON 数据包不再被前端读取；`npm run pack` 仅作历史打包/校验工具保留。

## 本机注意事项（Windows）

本机 npm 装依赖时 `esbuild` / `rollup` 的 postinstall 会失败。解法：

```bash
npm install --ignore-scripts
npm install --ignore-scripts --save-optional @esbuild/win32-x64 @rollup/rollup-win32-x64-msvc
```

（已在 `optionalDependencies` 中固化。）

## 路线

P0 骨架与契约 → P1 数据打包（已完成，JSON 包模式已被联邦模式取代）→ P2 公共阅读器 → P3/P4 专用层视图 → **P5 联邦数据库模式（已落地，13 书）** → v2 跨书关联深化。

---

## 联邦数据库模式（v2）

阅读器已支持第二种数据源：**联邦知识库 SQLite**。不再打包 JSON 数据包，
而是由本地 Node 服务只读查询 `kb.sqlite`，前端经 `/api` 拉取——多书联邦检索、
canonical 实体合并关联均可在页面内完成。

### 架构

```
前端 Vue（src/core/api.ts → dataProvider 透传）
        │  /api（vite 代理 → http://127.0.0.1:8787）
        ▼
server/sqlite-api.mjs（node:http + Node 内置 node:sqlite，零第三方依赖）
        │  只读 SELECT（json_extract / join / LIKE，毫秒级）
        ▼
联邦知识库 kb.sqlite（books/items/records/layer*/nodes/canonical/members/book_meta… 27 表）
```

- 数据契约：前端 `BooksManifest`/`FedSearchDoc`/`FedAssocResult`，实现见 `src/core/api.ts`。
- SQL 层：`server/fed-lib.mjs`（派生目录/元数据/章节/条目/层/实体/关联/检索/跨层索引）+ `server/sqlite-api.mjs`（HTTP 路由）。
- **书目元信息**（朝代/作者/体裁）由 `book_meta` 表提供：联邦库 `books` 表本身不带这些字段，
  种子 SQL 见 `server/book-meta.seed.sql`（每条著录带 source 出处；无表时服务端回落统计派生，老库不灌也能跑）。
  应用方法：`sqlite3 <kb.sqlite路径> < server/book-meta.seed.sql`（幂等，可重复执行）。
- 原 JSON 数据包模式（P1）已被联邦模式取代：`dataProvider` 现硬接 `/api`，两套数据源**不可切换**；
  `npm run data/validate/pack` 仅保留作历史工具。

### 快速启动（联邦模式）

```bash
# 方式一：开发模式（API + Vite 双进程，vite 热更新）
npm run dev:fed -- --db "E:/git/ToolBox/guji/tools/kb-federation/kb.sqlite"
# 或设置环境变量 KB_SQLITE 替代 --db

# 方式二：生产模式（API 同进程托管 dist 静态文件）
npm run build
node server/sqlite-api.mjs --db "E:/git/ToolBox/guji/tools/kb-federation/kb.sqlite" --port 8787 --static dist
```

访问 `http://127.0.0.1:8787/`（书架 ｜ `/#/reader/<bookId>` 阅读器 ｜ `/#/search` 检索）。
端口可用环境变量 `API_PORT` 覆盖；`--db` 不传时默认读上文联邦路径。

### /api 端点

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` | 服务与库健康检查 |
| `GET /api/books` | 书架：13 书清单（卷/条目/层数/实体/标注统计 + book_meta 元信息） |
| `GET /api/books/:book/config·meta·chapters` | 单书配置 / 元信息 / 章节树（卷→条目→层徽标） |
| `GET /api/books/:book/items?volume=01&q=` | 卷条目原文列表（译文等层随附；参数名是 `volume`，不是 `vol`） |
| `GET /api/books/:book/layers/:layer` | 分层记录表（职官任职/实体/事件/译文/…）；`?limit=&offset=` 分页（`count` 恒为筛选口径总数）、`?field=&value=` 筛选下推（field 限该层 config 字段）、`?item_id=&full=1` 详情反查；不传 limit 即旧全量形态 |
| `GET /api/books/:book/join·enums·entities·ent-index·search-index` | 关联视图 / 枚举 / 实体导出 / 实体索引 / 跨层索引 |
| `GET /api/search?q=&books=` | 检索（空格分隔多个词 AND，`books=all` 跨书联邦检索） |
| `GET /api/assoc?q=` | 联邦实体关联：canonical 合并组（成员/覆盖书/匹配类型/置信度） |

### 数据口径

- **条目** = `items` 表；**各层记录** = `records` 表（`payload` 为 JSON 串，`json_extract` 按层取字段）。
- **原文** = 实体层（ENT）记录 `payload.original`；volume 00 空壳条目已剔除。
- **实体跨度**：优先使用记录自带 `start/end` 偏移（切片校验原文一致）；无偏移时按词形 `indexOf` 降级定位，span 不变量逐条验证。
- **跨书检索**：按 `books` 表逐书 LIKE 扫描 + 元组去重；**实体关联**基于 `canonical`/`members` 表按归一词合并，覆盖书与引用（`record_refs`）一并呈现。
- 服务层对库文件**只读**（`readonly: true`），不会写库。

### 联邦库书目（13 书，元信息见 `book_meta` 表）

| book_id | 书名 | 朝代 | 作者 | 体裁 | 卷数 | 条目 |
| --- | --- | --- | --- | --- | --- | --- |
| kzz | 客座赘语 | 明 | 顾起元 | 笔记 | 10 | 471 |
| sdr | 水东日记 | 明 | 叶盛 | 笔记 | 38 | 1192 |
| wzz | 五杂俎 | 明 | 谢肇淛 | 笔记 | 12 | 1288 |
| xgf | 新官轨范 | 明 | 佚名 | 官箴书 | 11 | 274 |
| xyf | 先进遗风 | 明 | 耿定向 | 遗闻录 | 2 | 100 |
| xzl | 政学录 | 清 | 郑端 | 政书 | 5 | 183 |
| lgs | 吕公实政录 | 明 | 吕坤 | 政书 | 15 | 119 |
| qb | 蘧编 | 明 | 叶向高 | 年谱 | 20 | 71 |
| ysz | 宛署杂记 | 明 | 沈榜 | 志书 | 20 | 155 |
| fqh | 福惠全书 | 清 | 黄六鸿 | 政书 | 33 | 274 |
| ppy | 平平言 | 清 | 方大湜 | 官箴书 | 4 | 284 |
| shz | 明史·食货志 | 清 | 张廷玉等 | 正史志书 | 6 | 254 |
| zgz | 明史·职官志 | 清 | 张廷玉等 | 正史志书 | 5 | 317 |

> `book_meta` 由 `server/book-meta.seed.sql` 灌入（幂等 `INSERT OR REPLACE`）。
> sqlite3 CLI 不可用时用 `python ../guji/tools/kb-federation/apply_book_meta_seed.py`。
> 无 `book_meta` 行的书，服务端回落为「联邦库 · N 卷 · M 条」，不报错。

### 节标题（C9 `spine` 表）

条目级节标题走联邦库 `spine` 表（契约见 `../guji/docs/书籍著录与结构契约.md` §3.6），
**不是** `items.title` —— 后者在 `load.py:135` 被写成「正文前 50 字摘要」，语义不同。

- 真源：`<书>/书籍json/<书>_校对版.json` 的 `volumes[].items[].title`
- 建表/重建：`python ../guji/tools/kb-federation/spine_build.py --build [--book X]`，自查 `--verify`
- 服务端：`server/fed-lib.mjs` 的 `spineTitlesOf`（条目级，`kind='duan'`）与
  `spineVolTitlesOf`（卷级，`kind='juan'`），注入 `deriveChapters` / `deriveItemChunk`
- 前端：`toc.ts:leaf()` 用 `title` 作 `label`（`key` 恒为 iid，跳转不受影响）；
  `ItemCard.vue` 有 `title` 时以节标题为主位、iid 退为右侧辅助标记
- 降级：无节标题真源的书（如《先进遗风》，无 `书籍json`）标签回落为 iid，不报错
- **注意**：`spine`/`spine_meta` **不在** `kbdb._BOOK_ID_TABLES` 里，
  故 `load --book X` / `load-all` 不会连带清掉 spine；只有 `spine_build.py --drop` 才删
