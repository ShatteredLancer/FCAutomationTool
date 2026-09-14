# Trade Scheduler 设计与实施跟踪

> 文档状态：TS0-TS15 已完成，`v0.7.91` 已发布；本文件作为 v1 历史基线保留
> 最后更新：2026-08-12
> 适用仓库：FCAutomationTool
> 功能边界：定时自动买入、定时批量挂牌、交易任务调度、逐项回执与诊断
> 后继设计：已确认的新范围见 [TRADE_SCHEDULER_V2_DESIGN_ZH.md](TRADE_SCHEDULER_V2_DESIGN_ZH.md)，在对应里程碑完成前不代表当前运行行为

## 1. 文档目的

本文固定 Trade Scheduler 的产品边界、运行时依赖、配置模型、交易事务、安全停止条件和分阶段交付标准。后续实现必须在本文的里程碑中更新状态、测试结果和真实页面验证证据，不能只在提交信息中声明完成。

状态只使用：

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

每个里程碑只有同时满足以下条件才能标记为 `Complete`：

1. 设计范围内的实现已完成。
2. 对应 unit、contract、workflow 和 architecture tests 通过。
3. `npm run verify` 通过。
4. 涉及 EA 写操作的阶段完成规定的真实 Web App 小规模验证。
5. 本文记录实际结果、剩余风险和下一步。

## 2. 目标

Trade Scheduler 提供两个独立的计划任务类型：

- **Buy Job**：在指定时间启动一个有数量、价格、预算、时长和请求频率上限的自动 Buy Now 会话。
- **Listing Job**：在指定时间从 Club 和/或 Transfer List 选择符合条件的可交易球员，按评分规则和市场报价策略逐张挂牌。

两个任务都必须支持：

- 手动 `Run now`。
- 单次、每日、间隔或时间窗口调度。
- Preview、Arm、Pause、Stop 和 Recap。
- 会话、交易权限、金币、容量和卡片身份预检。
- 429、认证失效、Captcha、结果不明确和库存阻塞时的确定性停止。
- 持久化任务、运行租约、历史回执和诊断导出。

## 3. 已确认事实

### 3.1 EA 交易接口

Enhancer `26.1.5.6` 至 `26.1.6.2` 和本地 FSU `26.09` 的实际实现均表明，页面内可使用以下 EA Web App 服务：

```js
services.Item.searchTransferMarket(criteria, page)
services.Item.bid(item, buyNowPrice)
services.Item.move(itemOrItems, destinationPile)
services.Item.requestMarketData(item)
services.Item.list(item, startPrice, buyNowPrice, durationSeconds)
services.Item.relistExpiredAuctions()
```

这些都是 EA Web App 内部接口，不是稳定的公开 API。所有调用必须集中在 `src/adapters/ea`，上层 Planner、Scheduler 和 Workflow 不得直接访问 `services`、`repositories`、`window` 或 EA Controller。

### 3.2 Enhancer 接口边界

Enhancer 没有公开 Trader/Bulk Listing 调用接口：

- Chrome manifest 没有 `externally_connectable`。
- Trader、`listItem` 和 Bulk Listing Controller 封闭在 Webpack 模块中。
- 没有稳定挂载到 `window` 的交易命令。
- `window.postMessage` 桥只用于扩展自己的跨域请求、通知和 Companion App 交互。

不得依赖 Enhancer 私有模块编号、Webpack runtime、DOM 按钮或内部 Store。Enhancer 仅作为行为参考和兼容对象。

### 3.3 FSU 接口边界

FSU 的 Bulk Auction 同样调用 `services.Item.list()`，并提供价格限制、错误映射、取消和列表刷新方面的参考。Trade Scheduler 不读取 FSU 的价格缓存、运行标志或 UI，也不要求 FSU 已安装。

FCAutomationTool 的现有 SBC 功能仍可继续使用 FSU 筛选和锁卡能力，但新的交易子系统必须保持独立。

### 3.4 价格来源

当前 `src/reward/player-prices.js` 直接通过 FCAutomationTool HTTP Adapter 请求：

1. FUT.GG。
2. FUT.GG 失败或为空时回退 FUTNext。

FUTNext 请求地址当前为：

```text
https://enhancer-api.futnext.com/players/prices
```

域名包含 `enhancer-api` 不代表依赖已安装的 Enhancer。请求由 FCAutomationTool/Tampermonkey 直接发出。

FSU 和 Enhancer 都允许用户选择自己的价格来源，但 Trade Scheduler 不继承它们的设置。新功能必须提供独立、可诊断的 Price Provider 配置。

### 3.5 EA 不支持评分范围市场搜索

`services.Item.searchTransferMarket(criteria, page)` 当前确认使用的市场条件包括：

- `type`
- `category`
- `defId`
- `maskedDefId`
- `rarities`
- `position`
- `nation`
- `league`
- `club`
- `minBid`
- `maxBid`
- `minBuy`
- `maxBuy`

EA `UTSearchCriteriaDTO` 没有可靠的 `rating`、`minRating` 或 `maxRating` 市场条件。实施 Trade Adapter 前仍需在真实页面导出 DTO 字段和序列化请求，锁定 FC26 当前版本的确切字段。

Enhancer 的评分搜索实际流程为：从 FUTNext 获取指定评分的 definition ID 列表，然后每次选择一个 definition ID 写入 `criteria.defId` 再调用 EA 搜索。

## 4. 已解决的设计决策

| ID | 决策 | 状态 |
| --- | --- | --- |
| D1 | Trade Scheduler 位于 FCAutomationTool 仓库，但作为与 Loop Runner、Batch Open 并列的独立子系统。 | Resolved |
| D2 | Trade Job 不进入 Loop/Workflow JSON，也不复用 SBC `rounds` 语义。 | Resolved |
| D3 | 买入后不提供 destination 配置：默认发 Club；Club 重复发 Transfer List。 | Resolved |
| D4 | Club 重复且 Transfer List 已满时停止 Buy Job，保留当前卡并报告阻塞。 | Resolved |
| D5 | 评分范围拆成精确评分通道；每个通道维护对应 definition ID 池。 | Resolved |
| D6 | 每次 EA 市场请求只搜索一个 definition ID，不向 EA 一次提交整个评分段。 | Resolved |
| D7 | 对当前搜索响应显式按 Buy Now 升序排序，不依赖 EA 返回顺序；同价使用稳定 tie-break。 | Resolved |
| D8 | 不跨评分比较后再购买。评分通道轮换，各自买当前 definition ID 响应中的最低合格价格。 | Resolved |
| D9 | 交易执行只使用 EA 页面服务；评分目录和市场报价直接使用外部 Provider。 | Resolved |
| D10 | 不依赖 Enhancer 或 FSU 执行交易，也不复制 Enhancer 私有源码。 | Resolved |
| D11 | 未登录时不自动登录、不保存 EA 凭证、不把访问令牌交给外部后台。 | Resolved |
| D12 | 首个可写阶段先实现手动 Bulk Listing，再实现自动买入。 | Resolved |
| D13 | Buy Job 必须显式配置 `cardClass`，不提供隐式默认卡类。 | Resolved |
| D14 | Price Provider 的 `auto` 顺序固定为 FUT.GG，再回退 FUTNext。 | Resolved |
| D15 | FUTNext rating catalog 默认缓存 24 小时；platform、season 或 parser version 变化时立即失效，刷新失败后不使用已过期数据。 | Resolved |
| D16 | `common-gold`、`rare-gold` 和 `special` 精确区分卡类；`normal-gold` 匹配普金与稀有金但排除特殊卡，兼容别名 `gold` 等同 `normal-gold`。 | Resolved |

## 5. 非目标

首轮设计明确不包含：

- 自动登录、保存账号密码、Cookie 或 EA Access Token。
- 自动解决 Captcha。
- 绕过 EA 限流、安全限制或交易权限。
- 在浏览器和 EA 页面关闭时由远程服务器模拟 Web App 交易。
- 自动出价、追价、狙击倒计时拍卖。
- 自动 Quick Sell。
- 自动套利、利润保证或未经用户配置的市场判断。
- 与 Enhancer Trader 或 FSU Bulk Auction 并发执行。
- 把交易任务嵌入 SBC Workflow。

## 6. 总体架构

```text
Trade Scheduler UI
        |
        v
Job Config / Persisted Schedule
        |
        v
Scheduler + Operation Coordinator + Cross-tab Lease
        |
        +---------------------------+
        |                           |
        v                           v
Buy Planner / Transaction     Listing Planner / Transaction
        |                           |
        +-------------+-------------+
                      |
                      v
               Trade Adapter
                      |
                      v
        EA services / repositories / DTOs

External data:
Player Catalog Provider -> rating to definition IDs
Price Quote Provider    -> definition IDs to timestamped prices
```

建议模块边界：

```text
src/adapters/ea/trade.js
src/adapters/fake/trade.js
src/trade/contracts.js
src/trade/error-policy.js
src/trade/player-catalog.js
src/trade/price-quotes.js
src/trade/buy-plan.js
src/trade/buy-transaction.js
src/trade/listing-plan.js
src/trade/listing-transaction.js
src/trade/scheduler.js
src/trade/schedule-policy.js
src/trade/run-lease.js
src/ui/trade-scheduler-dialog.js
src/ui/trade-job-editor.js
src/ui/trade-recap.js
```

实际文件可以在实施时调整，但必须保持以下依赖方向：

```text
UI -> Scheduler -> Planner/Transaction -> Adapter -> EA runtime
```

## 7. 公共数据合同

### 7.1 Trade Job Envelope

```json
{
  "schemaVersion": 1,
  "id": "stable-job-id",
  "name": "84-85 Gold Buy",
  "type": "buy",
  "enabled": false,
  "armed": false,
  "schedule": {},
  "misfirePolicy": {},
  "policy": {},
  "createdAt": 0,
  "updatedAt": 0
}
```

`enabled` 表示配置有效且可显示；`armed` 表示允许调度器在到期时执行。导入配置不得自动把任务设为 `armed`。

### 7.2 运行回执

每次执行生成唯一 `runId`，至少记录：

```json
{
  "runId": "uuid",
  "jobId": "stable-job-id",
  "jobType": "buy",
  "scheduledFor": 0,
  "startedAt": 0,
  "finishedAt": 0,
  "status": "completed",
  "reason": null,
  "requested": 0,
  "succeeded": 0,
  "failed": 0,
  "skipped": 0,
  "coinsBefore": null,
  "coinsAfter": null,
  "receipts": []
}
```

回执必须可序列化，不能持有 EA Item、Controller 或 Observable 对象。

## 8. Buy Job

### 8.1 配置模型

建议初始配置：

```json
{
  "ratingMin": 84,
  "ratingMax": 85,
  "cardClass": "rare-gold",
  "maxBuyNow": 1000,
  "ratingPriceOverrides": {},
  "quantity": 10,
  "totalBudget": 10000,
  "maxRuntimeMinutes": 30,
  "searchDelaySeconds": [8, 15],
  "maxPurchasesPerSearch": 1,
  "maxConsecutiveEmptySearches": 30
}
```

首版只实现 Buy Now，不实现竞价。`quantity`、`totalBudget` 和 `maxRuntimeMinutes` 都是硬上限，任意一个达到即结束。

`ratingPriceOverrides` 的精确评分价格优先于 `maxBuyNow`。没有精确覆盖时使用评分段统一上限。

### 8.2 固定库存路由

购买后路由不向用户暴露配置：

```text
购买结果对账
-> Club 中没有相同 definitionId：发送 Club
-> Club 中已有相同 definitionId：发送 Transfer List
-> Transfer List 无容量：停止任务并保留当前卡
```

重复判断必须同时考虑：

- EA Item 的 duplicate 状态。
- 当前 Live Club 中相同 definition ID。
- 延迟元数据恢复后重新读取的结果。

在购买前，如果当前 Unassigned 已有无法解析或无法移动的卡，Buy Job 必须阻断，不得继续增加 Unassigned。

### 8.3 评分通道和 definition ID 池

`84-85` Job 物化为：

```text
rating lane 84 -> definition IDs for 84
rating lane 85 -> definition IDs for 85
```

FUTNext 当前观察到的评分目录接口为：

```text
https://rest.futnext.com/players/filter?rating=<rating>&platform=<platform>
```

该接口是第三方、未文档化接口，必须封装在 Player Catalog Provider 中。目录响应需要校验、去重、版本化缓存并记录获取时间。新赛季、平台变化或 parser version 变化必须失效。

目录不可用且没有仍在 TTL 内的 last-known-good 数据时，任务停止。不得退化为无条件 Rare Gold 搜索。

### 8.4 搜索轮次

首版采用确定性轮换：

```text
选择下一个评分通道
-> 选择该通道下一个 definition ID
-> 构建 UTSearchCriteriaDTO
-> clearTransferMarketCache
-> searchTransferMarket(criteria, 1)
-> 校验所有返回实体的 definitionId、rating、cardClass 和 Buy Now
-> 对合格结果按 Buy Now 升序排序
-> 当前响应最多购买一张
-> 等待随机间隔
```

价格相同的结果使用以下 tie-break：

1. Buy Now 升序。
2. `expires` 升序。
3. `tradeId` 升序。

因为一个请求只针对一个 definition ID，同一响应内不存在 84 与 85 的选择问题。该最低价只是当前 definition ID 当前响应中的最低价，不宣称是整个评分段的全局最低价。

通道和 definition ID 的游标必须在单次运行中保存，避免始终从同一个球员开始。不同运行可以使用由 `runId` 派生的稳定打散顺序，但测试必须可重现。

### 8.5 Buy Transaction

```text
Preflight
-> Search
-> Validate result identity and price
-> Re-read coins and limits
-> services.Item.bid(item, buyNowPrice)
-> Reconcile Watch List / Purchased / Unassigned / Transfer / Club
-> Route Club or Transfer
-> Verify destination
-> Emit receipt
```

以下检查必须在 `bid()` 前再次执行：

- 任务未停止。
- 当前报价仍不超过评分价格上限。
- 单张价格不超过剩余预算。
- 当前金币足够并保留配置的最低余额。
- 当前运行未达到数量或时间上限。
- Unassigned 可安全接收和处理结果。
- 目标 Transfer List 在重复场景下有容量。

网络结果不明确时，不得直接再次购买。必须刷新 Watch List、Purchased、Unassigned、Transfer、Club 和金币并按 `tradeId`、item ID、definition ID、价格及时间窗口对账。无法证明成功或失败时状态为 `ambiguous`，停止整个 Buy Job。

## 9. Listing Job

### 9.1 配置模型

```json
{
  "sources": ["transfer", "club"],
  "cardClass": "normal-gold",
  "ratingRules": [
    { "min": 75, "max": 82, "buyNow": 700 },
    { "min": 83, "max": 83, "buyNow": 900 },
    { "min": 84, "max": 84, "buyNow": 1800 }
  ],
  "marketOverride": {
    "enabled": true,
    "markupPercent": 5,
    "maxQuoteAgeMinutes": 10
  },
  "startPricePolicy": "one-step-below",
  "durationSeconds": 3600,
  "listingDelaySeconds": [4, 8],
  "maxListings": 50,
  "expiredPolicy": "reprice"
}
```

`cardClass` 不允许从评分推断卡种：

- `common-gold`：非特殊普金。
- `rare-gold`：非特殊稀有金。
- `normal-gold`：普金和稀有金，但排除特殊卡。
- `special`：仅特殊卡。
- `gold`：仅作为 `normal-gold` 的兼容别名；新 UI 和新配置不应继续生成该值。

### 9.2 候选过滤

候选必须：

- 来自配置允许的 pile。
- 是 Player。
- 可交易。
- 不在 Active Trade 或 Closed Trade 中。
- 不属于 limited-use、concept 或 Academy enrolled 状态。
- 满足 card class 和 rating rule。
- 按 item ID 能重新解析到同一 Live 实体。

Transfer List 中 `sold`、仍 active 或状态不明确的实体不得重新挂牌。Expired item 根据 `expiredPolicy` 选择跳过、原价 relist 或重新报价；首版推荐只实现 `skip` 和 `reprice`，不盲目调用全量 `relistExpiredAuctions()`。

### 9.3 价格规则

基础价格来自匹配的评分规则：

```text
configuredPrice = ratingRule.buyNow
```

若 Market Override 开启且报价有效：

```text
quotedPrice > configuredPrice
    ? quotedPrice * (1 + markupPercent / 100)
    : configuredPrice
```

计算后必须：

1. 按 EA 价格步进取整。
2. 读取 `requestMarketData()`。
3. 限制在 `_itemPriceLimits.minimum` 和 `_itemPriceLimits.maximum` 内。
4. 校验 start price 不高于 Buy Now。

当 Quote Provider 失败、报价过期或返回零时，默认使用配置价格并在 Preview/Recap 标记 `quote-unavailable`。高价值卡可在后续阶段增加 EA 最低 BIN 复核，但不能默认逐卡多次搜索市场。

### 9.4 Listing Transaction

```text
Resolve exact item
-> Validate trade state
-> Check Transfer List capacity
-> Request price limits
-> Recompute and validate prices
-> services.Item.list(item, start, buyNow, duration)
-> Refresh Transfer List
-> Verify matching item and auction values
-> Emit receipt
```

每张成功挂牌后重新读取容量。EA 响应成功但 Transfer List 无匹配实体时属于 `ambiguous`，停止任务并对账，不得重复挂牌。

## 10. Price Quote Provider

Price Provider 是独立配置，不读取 FSU 或 Enhancer 的设置。

首版建议支持：

```text
Auto       -> FUT.GG, then FUTNext fallback
FUTNext    -> FUTNext only
FUT.GG     -> FUT.GG only
```

每个 Quote 必须包含：

```json
{
  "definitionId": 0,
  "price": 0,
  "source": "FUTNext",
  "quotedAt": 0,
  "expiresAt": 0
}
```

交易报价缓存与 Recap 价格缓存可以复用底层 HTTP parser，但不能复用不适合交易的函数命名或隐含 TTL。应将当前 `loadPlayerPickPrices()` 泛化或在其下增加共享 Provider，保持现有 Recap 行为不变并用 characterization tests 锁定。

## 11. Scheduler

### 11.1 调度类型

```text
once       -> 单次绝对时间
daily      -> 指定时区的每日时间
interval   -> 从成功或计划时间起每隔 N 分钟/小时
window     -> 指定时间窗口内最多运行一次
manual     -> 仅 Run now，不自动触发
```

所有持久化时间使用 UTC epoch；显示和 daily 计算使用任务记录的 IANA timezone。不得使用一个长时间 `setTimeout` 作为真实来源。

Scheduler 通过绝对 `nextRunAt` 计算到期任务，并在以下时机重新评估：

- 页面启动并达到 EA readiness。
- 固定短周期 tick。
- `visibilitychange` 回到可见。
- `focus`。
- 浏览器恢复 online。
- 当前 Operation 结束。

### 11.2 任务状态

```text
disabled
armed
waiting-time
waiting-session
waiting-operation
running
cooldown
completed
missed
blocked
```

状态转换必须由纯函数计算并覆盖 fake clock 测试。UI 不能自行修改运行状态。

### 11.3 Misfire Policy

```text
skip
grace-window
next-login
```

推荐默认 `grace-window`，例如计划时间后 15 分钟内页面恢复并登录则执行，超过后记录 `missed`。`next-login` 必须由用户显式选择，避免登录后突然执行早已过期的价格策略。

### 11.4 跨标签页和运行租约

同一账号只能有一个 Trade 或 Loop 写操作。建议组合使用：

- `navigator.locks` 作为同源活跃标签页互斥。
- GM storage 中的持久化 lease。
- `BroadcastChannel` 通知其它标签页。
- 唯一 `ownerId` 和 `runId`。

Lease 必须有到期时间和心跳。页面崩溃后新标签页只能在 lease 过期并完成库存/交易对账后接管，不能从中间索引直接继续写操作。

## 12. Web App 未登录或不可用

Tampermonkey 只能在 EA 页面中运行，因此：

- 浏览器关闭：不能执行。
- EA 页面关闭：不能执行。
- 页面打开但未登录：进入 `waiting-session`。
- 登录失效：停止当前任务并通知。
- Trade Access 不允许：进入 `blocked`。
- 页面后台被冻结：恢复后按绝对时间和 Misfire Policy 重新评估。

不得保存登录凭证或自动填写登录。不得把 EA Cookie、Access Token 或 Persona 数据发送到自建后台。

未来可选的 Companion Extension 只允许：

- 使用 `chrome.alarms` 提醒。
- 打开或聚焦 EA Web App。
- 通知页面重新评估到期任务。

它不得在扩展 Service Worker 中直接交易，也不能保证用户仍处于登录状态。Companion Extension 不属于首轮范围。

## 13. Operation Coordinator 和插件共存

Trade Scheduler、Loop Runner、Batch Open、Dynamic SBC live scan 和其它库存写操作必须共享一个 Operation Coordinator。

互斥要求：

- Loop 运行时，Trade Job 进入 `waiting-operation`。
- Trade Job 运行时，禁止启动 Loop、Batch Open 和写入型刷新。
- Dynamic SBC 只读缓存恢复可以继续；会发 EA 请求的 live scan 应等待交易任务结束。
- Buy Job 开始前必须确认 Unassigned 可处理。
- Club 卡挂牌成功后必须刷新 Runner Inventory，并使可能包含旧 Club 实体的选择缓存失效。

Enhancer Trader、Enhancer Auto Buy、FSU Bulk Auction 与 Trade Scheduler 不得同时运行。普通 Enhancer UI、价格显示和 FSU SBC 功能可以保留。

由于 Enhancer 没有公开运行锁，首版采用明确用户约束和页面警告。后续可以增加只读诊断包装，记录最近是否出现非 Runner 发起的 `searchTransferMarket`、`bid` 或 `list`，但不能假装可以可靠阻止第三方插件。

## 14. 限流和错误策略

| 类型 | 默认行为 | 是否自动恢复 |
| --- | --- | --- |
| 429 / Too Many Requests | 立即停止当前 Trade Run，设置长冷却并通知 | 当前 Run 不恢复 |
| 401 / Session expired | 停止并进入 `waiting-session` | 重新登录后按 Misfire Policy |
| 403 / Permission denied | 阻断任务 | 否 |
| 427 / Auction operation blocked（EA 未公开） | 立即停止、持久熔断全部 Trade mutation、要求人工清除 | 否 |
| Captcha required | 停止所有自动交易并解除 armed 状态 | 否 |
| 512 / 521 | 有限次数退避；仍失败则停止 | 有界 |
| Lost bid / 已被购买 | 记录为竞争失败，等待后继续 | 是 |
| Destination full | 停止并保留当前实体 | 否 |
| Card already in trade | 跳过该卡并刷新；重复发生则停止 | 有界 |
| Ambiguous transport/result | 对账；无法判定则停止 | 不盲目重试 |

默认请求节奏应保守：

- Buy 搜索间隔建议 `8-15 秒`。
- 每个市场响应最多购买一张。
- Listing 间隔建议 `4-8 秒`。
- 周期性暂停和会话最长时间必须可配置但不能关闭所有安全限制。
- 统计最近请求、失败率、状态码和 Circuit Breaker 状态。

这些间隔只能降低请求压力，不能被描述为规避检测或保证账号安全。

## 15. UI 设计

Trade Scheduler 使用独立全屏/大对话框，不塞入紧凑的 Loop Run Options。

```text
Trade Scheduler
|-- Jobs
|   |-- Next run / Status / Armed
|   |-- Run now / Pause / Edit / Duplicate / Delete
|-- Buy editor
|   |-- Ratings / Card class / Price / Quantity / Budget
|   |-- Schedule / Limits / Preview
|-- Listing editor
|   |-- Sources / Rating rules / Quote policy / Duration
|   |-- Schedule / Limits / Preview
|-- History
    |-- Run recap / Receipts / Diagnostics
```

触摸和移动端要求：

- 使用现有 responsive dialog 和至少 44px 触摸目标。
- 编辑器采用分段视图，不在手机上显示横向宽表。
- 运行时固定显示 Stop、状态、已完成数量、金币变化和下一动作。
- Recap 每页 15 项，包含停止原因和 Preview。

所有自动任务默认未 armed。保存配置和允许自动执行是两个独立动作。

## 16. Recap 和诊断

Buy item receipt 至少包含：

- rating、definition ID、EA item ID、trade ID。
- Buy Now、评分价格上限、购买前后金币。
- 评分通道和 definition ID 游标。
- EA 响应状态和对账结果。
- Club/Transfer 最终去向。

Listing item receipt 至少包含：

- 来源 pile、item ID、definition ID、rating。
- 配置价格、报价、报价来源和年龄。
- 最终 start/Buy Now、duration、价格限制。
- EA 响应和 Transfer List 验证结果。

Trade diagnostics JSON 至少包含：

- Runner、浏览器和平台版本。
- Job 配置的脱敏快照。
- Schedule、lease 和 Operation Coordinator 状态。
- EA readiness、Trade Access、pile capacity 和金币快照。
- 每次请求的类型、耗时、状态码和重试决定。
- Provider 请求状态，不记录 Cookie、Token 或完整认证头。
- 全部逐项回执和最终停止原因。

## 17. 测试策略

### 17.1 Unit

- Job schema 和迁移。
- Rating lane 展开、definition ID 去重和游标轮换。
- 当前响应最低 Buy Now 排序和 tie-break。
- 评分价格覆盖。
- Listing rule 优先级、价格步进和 market override。
- Schedule、timezone、DST、misfire 和 absolute next run。
- Error policy、backoff 和 circuit breaker。

### 17.2 Contract

- Trade Adapter 不泄露 EA 对象。
- Fake Adapter 与 EA Adapter 的输入/输出一致。
- Price/Catalog Provider 的可序列化合同。
- Operation Coordinator 和 lease 合同。

### 17.3 Workflow/Transaction

- 单张挂牌成功、容量满、价格限制、Active Trade 和 ambiguous response。
- 单张买入成功并进入 Club。
- Club 重复转 Transfer。
- Club 重复且 Transfer 满时停止并保留。
- 429、401、Captcha 和中途 Stop。
- 购买成功响应丢失后的对账，证明不会重复购买。
- 页面恢复后 skip、grace-window 和 next-login。

### 17.4 Architecture

- `src/trade` 和 `src/ui` 不直接访问 EA runtime。
- 所有 `searchTransferMarket`、`bid`、`list`、`requestMarketData` 调用只存在于 EA Adapter。
- Scheduler 不导入 UI。
- 交易代码不读取 Enhancer/FSU 私有全局。

### 17.5 Live validation

真实页面验证必须从最低风险开始：

1. Preview 无写操作。
2. 一张低价值 Club 可交易卡手动挂牌。
3. 一张 Transfer 卡手动挂牌。
4. 停止和容量边界。
5. 定时触发一张挂牌。
6. 一张低价值卡手动 Buy Now，验证 Club 去向。
7. 已有重复时验证 Transfer 去向。
8. 最后才验证定时 Buy Job。

每一步都必须保存 Runner log 和 Trade diagnostics；前一步验证失败时不得扩大数量。

## 18. 实施里程碑

### 18.1 路线图总览

本路线图以 TS15 为终点。TS8 之后不再使用笼统的“生产化待办”，而是拆成可独立验收的 TS9-TS15。表中的四个进度列必须分别更新；实现或自动测试完成，不代表真实 EA 写操作已经获准，也不代表可以发布对应生产门禁。

| Milestone | 目标 | Depends on | Implementation | Automated verification | Live validation | Release state |
| --- | --- | --- | --- | --- | --- | --- |
| TS0 | 设计冻结 | - | Complete | N/A | Complete | Closed |
| TS1 | 合同、Provider、只读诊断 | TS0 | Complete | Complete | Complete | Closed |
| TS2 | 手动 Listing 基础 | TS1 | Complete for guarded subset | Complete | Single-card complete | Guarded path released |
| TS3 | Scheduler 与定时 Listing 基础 | TS1-TS2 | Complete for guarded subset | Complete | Once/single-card complete | Guarded path released |
| TS4 | 手动 Buy 基础 | TS1 | Complete for guarded subset | Complete | Single-card complete | Guarded path released |
| TS5 | 定时 Buy 基础 | TS3-TS4 | Complete for guarded subset | Complete | Once/single-card complete | Guarded path released |
| TS6 | 可观测性、配置迁移和共享预算 | TS1-TS5 | Complete for guarded scope | Complete | Complete for guarded scope | Guarded infrastructure released |
| TS7 | Transfer reprice 单卡门禁 | TS2-TS3-TS6 | Complete | Complete | Complete | Guarded path released |
| TS8 | 有界双卡 Trade 候选 | TS4-TS7 | Complete | Complete | Complete | Guarded two-item path validated in `0.7.70` |
| TS9 | 有界手动多卡事务 | TS8 Complete | Complete for candidate | Complete locally | Complete | Four-item Listing/Reprice/Buy paths passed |
| TS10 | 循环调度生产门禁 | TS9 Complete | Complete for single armed Job | Complete locally | Complete | Daily/Interval/Window and terminal relock passed |
| TS11 | Buy 策略生产扩展 | TS10 Complete | Complete for Rare Gold | Complete locally | Complete | Three-lane non-uniform quota Buy passed |
| TS12 | Listing/Reprice 策略生产扩展 | TS11 Complete | Complete for candidate | Complete locally | Complete | Listing/Reprice live paths passed; bounded quote backfill automated; live fallback observation optional |
| TS13 | 多 Job、长期运行与恢复 | TS12 Complete | Complete | Complete | Complete on `0.7.91` | Multi-Job, reload, Loop mutex and two-phase Lease recovery passed |
| TS14 | 可选 Companion 最终决策 | TS13 candidate complete | Complete: deferred | Complete by review | N/A | Closed as deferred |
| TS15 | 生产发布与路线图关闭 | TS14 decision closed | Complete | Complete | Complete on `0.7.91` | Released as `v0.7.91` |

进度维护规则：

1. TS8 与 V9-12 的有序实机 campaign 已完成，TS9-TS12 均满足当前有界范围的实现、自动验证和实机门禁。TS12 的真实 stale/unavailable 或高价回填继续作为可选只读观察，不再阻止下一阶段。
2. 可以提前实现后续阶段的纯函数、Fake Adapter 和关闭状态 UI，但必须保持默认禁用，并在表中分别记录实现、自动验证和实机验证状态。
3. 每次推进必须同时更新本表、对应里程碑的 `Status`/checkbox、第 20 节验证记录和运维文档；仅修改版本号或提交信息不算推进。
4. 实机 campaign 可以合并验证多个已经通过自动门禁的场景，但必须按风险从低到高执行；前一场景出现 `ambiguous`、身份不一致、价格不一致、页面崩溃或未知 Journal 时立即终止整个 campaign。
5. TS15 完成后进入维护模式。自动出价、套利、自动 Quick Sell、后台服务器代交易、保存 EA 凭证、自动处理 Captcha 和 `relistExpiredAuctions()` 不会自动成为 TS16；任何此类扩展都需要新的独立设计评审。

### 18.2 人工介入与合并验证计划

从当前 TS8 到 TS15，正常情况下只安排三轮必须由用户参与的真实 EA 验证。后续阶段可以先批量完成编码和离线测试，再安装一次候选版按顺序验证多个门禁；不要求每完成一个内部模块就单独收一次日志。只有前序场景失败、候选版在验证后修改了 mutation/recovery 逻辑，或 EA 页面接口发生变化时，才增加补充轮次。

| Campaign | 覆盖里程碑 | 用户必须执行的操作 | 预计人工占用 | 需要交付的证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| V8 双卡门禁 | TS8 | 安装/刷新一次候选版；选择低价值卡；依次确认手动双卡 Club Listing、Transfer reprice、双评分 Buy、一次定时 Listing/Reprice/Buy；保持登录并在异常时停止 | 约 30-60 分钟；不含等待合适 expired 卡 | 最终 Listing、Buy、Scheduler diagnostics 各一份；失败时立即导出当前日志 | Complete；六项 `0.7.70` 实机证据已复核 |
| V9-12 生产策略合并 campaign | TS9-TS12 | 安装一次已通过完整测试且默认回锁的候选版；验证手动多卡与 Stop；验证 daily/interval/window；执行低价多评分 Buy；验证 Club Listing、市场报价和一次 expired reprice；按脚本要求切后台、刷新并重新登录 | 约 60-90 分钟主动操作，外加至少 1 小时 expiry/调度观察 | 一个按 `runId` 关联的合并 diagnostics 包；若全部通过，不需要逐阶段发送 | Complete on `0.7.84`; live quote fallback/high-value observation remains optional |
| V13-15 长期运行与最终 canary | TS13、TS15 | 安装一次候选版；配置 3 个低数量 Buy/Club Listing/Transfer Reprice Job；触发一次 Loop/Trade 互斥和请求预算等待；让标签页后台运行；执行一次刷新/重登；用 `EXPIRE LEASE 1` 验证只读 Lease 恢复和 Recovery UI；最后确认发布 | 约 45-60 分钟主动操作，外加低频观察 | 最终 Scheduler diagnostics、相关 Listing/Buy diagnostics 和 Runner log；通过后作为 TS13/TS15 发布证据 | Complete on `0.7.91`; natural request-budget cooldown did not occur and remains automated-only evidence |
| VC Companion 可选验证 | TS14 | 不执行；已有 V9-12 页面后台触发证据，Companion 不改变“页面关闭或未登录时不得交易”的边界 | N/A | 本文 TS14 决策记录 | Deferred and closed |

三轮必须验证中，不能由本地自动测试替代的人工动作只有：

1. 在真实 EA Web App 登录并安装/刷新候选 userscript。
2. 选择账户中真实存在的低价值卡、自然产生的 inactive/expired 卡和可接受的 Buy 价格；测试不会人为填满 Transfer List 或制造 429/427。
3. 对真实挂牌、重挂和购买输入精确确认文本并触发 mutation。Codex 不代替用户承担金币或卡片处置决定。
4. 执行浏览器环境动作，例如切到后台标签、刷新、重新登录、休眠后恢复，以及等待挂牌自然到期。
5. 在每轮结束时导出 diagnostics；正常通过时只需交付最终文件，发生异常时立即停止并交付当时文件。
6. 最终确认是否发布稳定版；构建、版本更新、测试、tag 和 release 操作仍可由 Codex 执行。

其余工作，包括实现、单元/合同/架构测试、Fake clock、崩溃恢复矩阵、构建、版本迁移、文档和日志分析，均不要求用户逐步介入。O4、O8-O15 默认采用表中的建议值；只有用户要改变默认决策时才需要额外讨论，不增加实机验证轮次。

### TS0 设计冻结

Status: Complete

Scope:

- [x] 调研 Enhancer Trader 和 Bulk Listing。
- [x] 调研 FSU Bulk Auction。
- [x] 确认 EA 交易执行接口。
- [x] 确认 EA 不支持直接评分范围搜索。
- [x] 确认 FCAutomationTool 当前直接访问 FUT.GG/FUTNext。
- [x] 固定买入后 Club/重复 Transfer 路由。
- [x] 固定评分通道和单响应最低价策略。
- [x] 固定 Trade Scheduler 与 Loop/Workflow 的边界。

Tests: 不适用，文档阶段。

Live validation: 使用 Enhancer/FSU 已安装源码进行静态行为交叉验证；尚未由 FCAutomationTool 发起交易。

Next: 解决第 19 节首轮 Open decisions，然后开始 TS1。

### TS1 合同、Provider 和只读诊断

Status: Complete

Scope:

- [x] Trade contracts 和 Job schema。
- [x] Fake Trade Adapter。
- [x] EA Trade Adapter readiness 和只读 DTO/能力诊断。
- [x] Player Catalog Provider 和缓存。
- [x] 通用 Price Quote Provider，保持现有 Recap 回归行为。
- [x] Error classification 和纯 Circuit Breaker。
- [x] Architecture tests。

Tests: `npm run verify` 通过；115 个测试文件、744 个测试通过，syntax、ESLint、配置/Profile、架构、构建产物和 FSU release 检查全部通过。

Live validation: Complete。EA Web App PC 实测确认 capability、criteria、Trade Access、金币、Transfer capacity、外部 Provider 回退和 item price limits 均可读取，且诊断中不包含认证信息。以下命令保留用于后续兼容性复核；不得将其扩展为买入、移动或挂牌操作。

```js
__FCLoopRunner.inspectTradeCapabilities()

__FCLoopRunner.loadTradePlayerCatalog({
  ratings: [84, 85],
  platform: "pc"
})

__FCLoopRunner.loadTradePriceQuotes({
  definitionIds: [123456],
  platform: "pc",
  provider: "auto"
})

__FCLoopRunner.inspectTradePriceLimits(
  { id: 123456789, pile: "club" },
  { refresh: true }
)
```

其中 `definitionIds` 应替换为 catalog 返回的真实低价值卡 definition ID；`id` 应替换为 Club 或 Transfer List 中一张低价值卡的真实 item ID。`inspectTradePriceLimits(..., { refresh: true })` 只调用 EA `requestMarketData()` 读取价格限制。

Exit criteria: Met。Provider、schema、错误策略、Adapter 能力探测、完整测试和真实页面只读诊断均通过；可以开始 TS2。

### TS2 手动 Bulk Listing

Status: Guarded manual single-item Club Listing and Transfer reprice complete; multi-item Bulk Listing remains gated.

Scope:

- [x] Listing Planner。
- [x] Listing Transaction 和对账核心。
- [x] Preview model 和只读运行时入口。
- [x] 一次性确认 token、显式确认和 Stop 核心。
- [x] 手动 Listing UI 的 Preview/Prepare/Confirm/Stop 交互。
- [x] Club 候选过滤和 Active Transfer 排除的真实字段验证。
- [x] Expired/Inactive Transfer reprice 真实字段验证。
- [x] 固定价格、market override、EA 价格步进和 duration Preview。
- [x] Price limits、容量和逐卡事务重检。
- [x] 可序列化逐项 Listing run receipt。
- [x] Listing Recap UI 和 diagnostics 导出。

Tests: TS2c UI 后 `npm run verify` 通过；124 个测试文件、777 个测试通过。新增覆盖手动 Job 的 Club 单卡硬门禁、主面板互斥、Preview/Prepared 状态隔离、配置变更撤销确认、精确确认、Stop、失败诊断、确认 token 脱敏和每页 15 项的 Recap。Architecture audit 确认 `requestMarketData()`、`list()` 和 `requestTransferItems()` 各一个 EA Trade Adapter 调用点，`searchTransferMarket()` 和 `bid()` 均为零调用点。

Live validation: TS2a 已确认 Club `inactive` 和 Transfer `active` 字段、common/rare/special 分类、Active Trade 排除和报价回退。TS2b 已对一张低价值 Club common Gold 完成独立 Prepare、人工复核、显式确认、一次挂牌、Transfer 刷新和精确回读。TS2c 新 UI 已于 2026-08-09 用一张低价值 Club 卡完成 Preview、Prepare、确认、挂牌、Recap 和 diagnostics 导出验证。TS7.1/TS7.2 又完成了 Transfer `expired -> inactive` 字段映射、手动单卡 `REPRICE 1`、EA Bid/Buy Now 下限和挂牌后 Active 精确回读验证。连续多卡 Stop/节流和容量竞争仍未开放或实机验证。

Exit criteria: Met for the guarded single-item subset. Overall Bulk Listing criteria remain not met; multi-item pacing, Stop between real writes and capacity races require a separate design and staged gate.

### TS3 Scheduler 和定时挂牌

Status: In progress; guarded single scheduled Club item live validation complete.

Scope:

- [x] 持久化 Job Store。
- [x] once/daily/interval/window/manual。
- [x] misfire policy。
- [x] Operation Coordinator compatibility bridge。
- [x] 跨标签页 lease 和过期 lease 强制恢复对账门禁。
- [x] Trade Scheduler UI、可视化 Buy/Listing Job Editor 和 History。
- [x] 默认 paused、自动执行锁定、导入 Job disarm。
- [x] HTTP 427 持久 Circuit Breaker、人工 reset 和脱敏 diagnostics。
- [x] `once + Club + maxListings=1` 显式确认、启动即自动回锁的 TS3 验证执行器。

Tests: Fake clock、IANA timezone/DST、misfire、Job Store、History 上限、双 owner lease、过期 lease、Coordinator、427、响应脱敏和响应式 UI 已覆盖；完整 `npm run verify` 结果见下方实施记录。

Live validation: EA 原生挂牌已恢复，TS2c 手动单卡和 TS3 定时单卡均于 2026-08-09 验证通过。TS3 Job 按计划触发，只挂牌一张 Club 卡，History、Transfer 精确对账及启动即自动回锁均符合预期；完整证据见下方 2026-08-09 实施记录。不得据此开放批量、Transfer reprice 或 Buy。

Exit criteria: Not met。离线核心、UI、定时单卡和 skip misfire 已完成；仍需真实页面证明 grace 内重载/恢复、双标签页和被 Loop 占用时不重复执行，并验证 expired lease 的回锁行为。

### TS4 手动 Auto Buy

Status: Complete for guarded manual one-card Club and duplicate-to-Transfer routes; broader Buy automation remains locked.

Scope:

- [x] Buy Planner 和评分通道轮换。
- [x] FUTNext rating catalog 物化。
- [x] 当前响应最低 Buy Now 选择。
- [x] Buy Transaction 和 ambiguous reconciliation 的离线实现。
- [x] 固定 Club/重复 Transfer 路由。
- [x] 数量、预算、金币余额、时长和空搜索上限。
- [x] Preview、15 项分页 Buy Recap 和 allowlisted diagnostics。
- [x] 手动单卡 Buy UI、精确确认、Coordinator/lease/circuit 门禁和 History 接线。

Tests: Fake Adapter、伪 EA Observable、Planner、Transaction、Preview、Recap、diagnostics 和架构边界测试通过。覆盖精确 definition/rating/card-class/价格筛选、当前响应最低价、Club/重复 Transfer 路由、Transfer 满、Unassigned gate、Stop/预算/空搜索、427、运行中 circuit 变化、ambiguous item+金币双证据和禁止二次购买。单元测试不解除生产门禁。

Live validation: Read-only Preview and one low-value non-duplicate purchase to Club passed on `0.7.41`. On `0.7.44`, a controlled seed followed by one duplicate purchase proved the complete Transfer route: one search, one Buy request, exact coin reconciliation, Unassigned materialization, move-to-Transfer HTTP 200 and exact final repository inspection. Scheduler History persisted exactly one receipt, Transfer usage advanced by one, and the Lease, Coordinator and Circuit all returned to idle/closed. The temporary live gate accepts only one manual, unarmed, single-rating Rare Gold Job with quantity 1 and price/budget no greater than 2000.

Exit criteria: Met for guarded manual single-card Club and duplicate-to-Transfer execution. Transfer-full remains covered by deterministic adapter/transaction tests and will receive additional live evidence only when the account is naturally full; the list will not be filled artificially. Quantity above one, rating ranges, other card classes, scheduled Buy and unattended production execution remain locked behind TS5 and later gates.

### TS5 定时 Auto Buy

Status: Guarded once/one-card live validation complete in `0.7.45`; broader scheduled Buy automation remains locked.

Scope:

- [x] Buy Job 配置、Editor 和只读评分通道 Preview 接入 Scheduler UI。
- [x] Buy Job 定时执行器接入 Scheduler；`0.7.45` 仅开放独立的首次真实验证门禁。
- [x] 429/401/Captcha/427/ambiguous 复用 Transaction、Error Policy、Circuit 和启动即回锁的确定性停止。
- [x] 定时 Buy 运行状态、脱敏 History、持久 Journal 和 diagnostics 接线。
- [x] 页面恢复、Misfire Policy、Web Lock、GM lease 和 Loop/Trade Coordinator 复用。
- [x] 显式全局最低保留金币；Job 只能提高、不能降低该底线。
- [x] 与 Listing Job 公平排队和全局请求预算；不扩大当前单 Armed Job 门禁。

Tests: 新增 strict gate、确认文本、全局/Job 金币底线、启动即回锁、低金币零请求、生产开关关闭、in-grace 页面恢复、一次 Buy、一次 History、lease 释放和 UI 状态覆盖；完整仓库验证结果见下方实施记录。

Live validation: Complete for the guarded `0.7.45` gate. One `once`、数量 1、Rare Gold 单评分任务在价格上限 1000、总预算 1000 和显式最低保留金币约束下完成；执行前原子回锁、单次 Buy、金币对账、Club 路由、History/Journal 及 Lease/Coordinator 释放均由导出证据确认。该结论不开放更宽策略。

Exit criteria: Met for the guarded once/one-card path. One explicit low-value live run proved auto-relock, minimum retained coins, one Buy request, route reconciliation, one History receipt and released Lease/Coordinator. Daily/interval/window、next-login、rating ranges、其它 card class 和 quantity > 1 仍不属于本阶段。

### TS6 生产化和可选 Companion 评估

Status: Complete within the current guarded scope; broader production automation remains locked.

Scope:

- [x] 长时间运行指标和日志压缩。
- [x] Job-only 配置导入/导出和 schema migration。
- [x] Provider 健康状态和缓存管理 UI。
- [x] 文档、故障排查和安全说明。
- [x] 评估仅用于 alarm/notification/open-tab 的 Companion Extension；当前决定暂缓实现。
- [x] 跨标签页 EA Trade 请求预算、单卡事务容量 reservation 和 Buy/Listing 公平选择核心。

Tests: TS6.1 Job Store migration、累计计数、History 淘汰后保留、停止原因聚合/定长和 responsive Summary UI 已有单元测试；完整仓库结果见实施记录。

Live validation: TS6.1/TS6.2/TS6.3 的迁移、导入导出、Provider 检查和缓存清理均已完成对应实机证据；这些阶段均不以请求量或成交量作为成功标准，也不扩大交易门禁。

Exit criteria: 形成独立发布说明、真实风险清单和可恢复运行手册。

### TS7 Transfer reprice 分阶段门禁

Status: Complete for guarded manual and once-scheduled one-card Transfer reprice; broader Transfer automation remains locked.

Scope:

- [x] 只读识别 EA Transfer `expired` 状态并标准化为 `inactive`；未知状态继续 fail closed。
- [x] 手动 Transfer-only 单卡 Prepare、`REPRICE 1` 精确确认、执行和 Active 状态精确回读。
- [x] 区分 EA Bid 最低价和 Buy Now 最低价，并按 EA 合法价格步长报价。
- [x] 定时 Transfer reprice 的独立关闭门禁、诊断证据和单次启用门禁。
- [x] `once + Transfer-only + expiredPolicy=reprice + maxListings=1` 实机执行、自动回锁和不重复验证。
- [x] 明确禁止 `relistExpiredAuctions()`、混合来源、循环计划和多卡执行。

Tests: TS7.1-TS7.4 已覆盖 Transfer 状态映射、只读 Preview、手动 reprice、价格下限、变更前精确实体复核、定时选择器、关闭门禁和单次执行。各阶段完整验证结果见第 20 节实施记录。

Live validation: `0.7.54` 至 `0.7.60` 已依次完成 expired 状态观察、手动单卡重挂、生产关闭门禁和一次定时单卡重挂；挂牌后同一 item 以确认价格进入 Active，Transfer 容量不增加，Scheduler 自动暂停、关闭 live execution、解除 armed 且没有重复执行。

Exit criteria: Met for guarded one-card manual and once-scheduled Transfer reprice. Multi-item、mixed-source、recurring 和 bulk relist 仍未开放。

### TS8 有界双卡 Trade 候选

Status: Complete. Implementation、full automated verification and the ordered six-scenario EA live campaign passed on candidate `0.7.70`.

Scope:

- [x] 手动 Club Listing 或 Transfer reprice 扩展为单一来源、最多两张卡。
- [x] 单次定时 Listing/reprice 扩展为 `maxListings=1..2`，继续禁止 recurring、mixed-source 和多 Job 执行。
- [x] 手动和单次定时 Buy 扩展为 Rare Gold、一个评分或两个相邻评分、数量最多两张。
- [x] 保留每卡 2000、总 Buy 预算 4000、定时 Buy 最低保留金币和最多两次 Buy mutation 的硬门禁。
- [x] Listing Journal 与 Buy Journal 记录两项状态及逐项 mutation boundary；未知写入结果阻止后续项和新 Run。
- [x] 手动 Listing 接入共享跨标签页 Lease；Listing/Buy 每次写入前续租并校验。
- [x] 按任务规模原子预留请求预算：Listing 12；单卡 Buy 14；双卡 Buy 28。
- [x] 补齐崩溃恢复、终态 Journal 替换和双卡确认文本的边界测试。
- [x] 通过完整 `npm run verify` 并生成唯一候选版本 `0.7.70`。
- [x] 按第 20 节 TS8 顺序完成手动双卡挂牌/重挂、多项 Journal、单次定时双卡和双评分数量二 Buy 实机验证。

Tests: 全部 Trade 聚焦测试为 41 个文件、250 个测试通过；完整 `npm run verify` 为 153 个测试文件、983 个测试通过，并通过 325 个 JavaScript 文件语法检查、ESLint、配置/Profile、架构审计、FSU patch replay、userscript 构建和发行产物一致性检查。

Live validation: Complete on `0.7.70`. 六份 2026-08-11 diagnostics 依次证明手动双卡 Club Listing、手动双卡 Transfer reprice、手动相邻评分数量二 Buy、单次定时双卡 Club Listing、单次定时双卡 Transfer reprice 和单次定时相邻评分数量二 Buy 全部到达 terminal `completed`。所有 Listing/Buy 均为 requested 2、succeeded 2、failed 0、skipped 0；每个 item 只跨过一次 mutation boundary，并在 Journal `receipt-recorded` 前完成精确身份、价格、Active/目标 pile 对账。

定时三个 Job 均只有一个 matching History Run，`runCount=1`、`nextRunAt=null`，随后保持 `armed=false`、Scheduler paused、live execution disabled。Lease 和 Coordinator 均释放，Circuit closed，后续 ticks 没有重复执行。Transfer reprice 前后容量不增加；Club Listing 后容量按两张增长。手动 Buy 以两次搜索和两次 mutation 分别买入 85/84 各一张并按 duplicate-to-Transfer/Club 路由；定时 Buy 在两次 85 lane 空搜索后以两次 mutation 买入两张 84，证明相邻 lane 会轮换而不保证每个评分各成交一张。

定时 Buy 的交易回执记录 spent 1600，而账户净余额从 1212872 变为 1211890。982 的净减少与同期一笔 650 售出扣除 5% EA 税后的 618 入账完全相符；两笔 800 Buy 均有独立 trade/item 和 Club 路由核验，最终余额仍高于 1092184 的全局和 Job retained-coins floor，因此不构成 Buy 歧义。最终请求预算均回到 available，Listing/Buy 实际动作已按 action 聚合，且没有活动 reservation、Lease 或 mutation Journal 阻止下一次 Run。六份文件未发现 Authorization、Cookie、Token、reservation identifier、raw response body 或其它禁止字段。

Exit criteria: Met for the guarded two-item scope. TS9 可以开始实现；第三张及更多卡、非相邻评分、非 Rare Gold、循环计划、自动 Journal acknowledgement 和 unattended startup 仍保持关闭，直到对应后续里程碑独立完成。

### TS9 有界手动多卡事务

Status: Candidate implementation and automated verification complete; live quote compatibility observation optional.

Depends on: TS8 必须完成全部双卡实机验证并标记为 `Complete`；O9 必须先确定首轮 Run cap 和 chunk cap。

Scope:

- [x] Listing/Buy Journal 上限扩展为 4 项，保留逐项 Prepare、mutation boundary、对账、终态和脱敏证据。
- [x] 通用 chunk coordinator 将 Run 拆为最多两个 2 项 chunk；每个 chunk 单独取得共享请求预算，未取得时仅本地等待，15 分钟 deadline 后停止。
- [x] 手动 Club Listing 和手动 Transfer reprice 保持来源互斥，并使用准确的 `LIST N` / `REPRICE N` 确认文本。
- [x] 手动 Buy 仍限 Rare Gold、每卡不超过 2000、总预算不超过 8000、评分跨度不超过 3、总数量不超过 4。
- [x] 在每张卡和每个 chunk 之间响应 Stop；已成功项保留回执，剩余项记为 skipped。
- [x] 容量、金币、价格限制、卡片身份、active/inactive 状态和 Club duplicate 路由在每次写入前重新检查。
- [x] 任一 unknown/ambiguous/incomplete chunk 停止整个 Run，不跳过、不自动 acknowledge、不自动重试。

Automated tests:

- Fake Adapter 覆盖跨 chunk 成功、预算等待、Stop、容量竞争、金币变化、首项成功后后项失败和中途重载。
- Journal 覆盖有界序列化、schema migration、逐项 checkpoint、终态替换条件和未知事务阻止新 Run。
- 请求预算测试证明任一时刻不超过共享 `30 requests / 5 minutes`，且取消或失败会释放未使用 reservation。
- 完整 `npm run verify`、architecture audit、构建和 root/dist 一致性必须通过。

Live validation:

- 在一个合并 campaign 中依次验证手动多卡 Club Listing、Transfer reprice 和 Rare Gold Buy；每种只提高一个数量级，并保存操作前后 diagnostics。
- 验证中主动执行一次安全 Stop，但不故意制造 429、427、断网或浏览器崩溃。
- 证明部分成功、剩余未执行、请求预算恢复、Lease/Coordinator 释放以及 Journal 可解释。

Exit criteria: 三种手动多卡路径均在确定的 cap 内通过自动测试和低价值实机验证；无无限队列、无不明重试、无跨来源执行，TS10 可以复用同一 chunk/Journaling 核心。

Out of scope: 循环计划、多 Job 同时 armed、非 Rare Gold Buy、混合 Club/Transfer、自动 Journal acknowledgement、无上限 bulk 操作。

Next: TS10 循环调度生产门禁。

### TS10 循环调度生产门禁

Status: Candidate implementation and focused automated verification complete for exactly one armed Job; V9-12 live validation pending.

Depends on: TS9 Complete；O4、O10 和 O11 必须形成明确决策。

Scope:

- [x] 单一 armed Job 支持 `daily`、`interval` 和 `window`；daily/interval 的精确确认只授权两次 occurrence，window 只授权一次。
- [x] 授权绑定 Job schedule/policy fingerprint；配置编辑、删除、导入、授权过期、次数耗尽或失败终态均回锁并解除武装。
- [x] 继续复用跨标签页 Web Lock/Lease、Operation Coordinator、Circuit Breaker、共享请求预算和逐项 Journal。
- [x] 页面关闭或 EA 未登录时不执行也不排队；恢复后只按 `skip` 或最多 15 分钟 `grace-window` 计算当前 occurrence。
- [x] Loop Runner 与 Trade Run 保持互斥；等待状态不发送 EA mutation。
- [x] 每个 occurrence 使用独立 `runId`；相同 Run ID 的重复授权消费被拒绝且不会扣减第二次。
- [x] `next-login` 从 UI 和生产 gate 中移除并继续拒绝。

Automated tests:

- Fake clock 覆盖 daily/interval/window、DST、grace、skip、休眠唤醒、reload、双 owner 和同一 due time 去重。
- 覆盖 Loop/Trade 互斥、Lease 失效、预算不足等待、Circuit 打开、登录未就绪和启动后回锁。
- Scheduler History、Journal 和 diagnostics 必须能关联 schedule occurrence、dispatch 和最终 Run。
- 完整仓库验证通过，所有 once/manual 行为保持回归覆盖。

Live validation:

- 使用两项以内的低风险 Job，按 daily -> interval -> window 顺序验证；不与 TS11/TS12 的数量或策略扩展混合。
- 合并验证前台标签、后台标签、刷新后重登、短时休眠、双标签页和 Loop 占用场景。
- 每个计划时间最多一个 History Run；页面关闭期间无 EA 请求，恢复后行为与 Misfire Policy 一致。

Exit criteria: 三种循环计划在单 armed Job 限制下可预测运行，无重复 mutation、无页面关闭交易、无越过 Loop/Trade 互斥；运维文档给出恢复和暂停流程。

Out of scope: 多个 armed Job 的生产调度、后台扩展直接交易、自动登录、扩大 Buy/List 策略。

Next: TS11 Buy 策略生产扩展。

### TS11 Buy 策略生产扩展

Status: Candidate implementation and focused automated verification complete for bounded Rare Gold ranges; V9-12 live validation pending.

Depends on: TS10 Complete；O14 必须确认支持的 Buy card class 边界。

Scope:

- [x] 评分范围扩展为最多 4 个逐评分精确 lane；每个 lane 仍按 definition ID 分解 EA 搜索，不发送 EA 评分范围条件。
- [x] 支持每评分价格上限、每评分数量配额、Job 总数量、总预算、全局/Job 最低保留金币和整个 Run 共用的最大运行时间。
- [x] lane 与 definition cursor 跨 chunk 保持轮转；已达到评分配额的 lane 被排除，每个响应仍只买最低合格 Buy Now。
- [x] 数量大于 2 时复用 chunk coordinator；共享上限保持 `30 requests / 5 minutes`，不以提高上限换吞吐。
- [x] 连续空搜索、价格/预算/金币越界、Transfer 满、Unassigned 阻塞及 429/427/未知响应均有明确停止原因。
- [x] Preview 显示 lane、definition 数量、评分配额、总预算、运行上限和 chunk reserve；diagnostics 保留脱敏 lane/候选/拒绝/购买计数。
- [x] O14 决定 TS11 仍只支持 Rare Gold；其它 card class 保持拒绝。

Automated tests:

- 覆盖三种及以上逐评分 lane、per-rating override、跨 chunk fairness、数量配额、总预算和最低金币底线。
- 覆盖跨 chunk 搜索、空结果退避、同价 tie-break、重复卡路由、容量竞争和部分完成后停止。
- Property/contract tests 证明任何购买都满足精确 definition、rating、card class、价格和预算约束。
- 完整仓库验证和构建产物检查通过。

Live validation:

- 先验证多评分 Preview，再以低价 Rare Gold 进行一个有界手动 Run 和一个已通过 TS10 的循环 Run。
- diagnostics 必须显示每个 lane 的搜索/命中/购买计数、实际支出、停止原因和未使用预算，且不包含原始 EA 响应。
- 不通过制造请求风暴验证 429；只验证已有 Circuit/退避路径在正常流量下保持关闭和可观测。

Exit criteria: Rare Gold 多评分、多数量 Buy 在手动和循环调度下通过有界验证，任何购买都可追溯到配置 lane 和精确回执；其它卡类保持锁定或已有独立批准记录。

Out of scope: Bid、竞价追踪、利润保证、自动套利、未知 card class、跨账号策略。

Next: TS12 Listing/Reprice 策略生产扩展。

### TS12 Listing/Reprice 策略生产扩展

Status: Candidate implementation and focused automated verification complete; V9-12 live validation pending.

Depends on: TS11 Complete；O8 和 O12 必须形成结论。

Scope:

- [x] Club Listing 与 Transfer reprice 保持来源互斥；同一 Run 不执行混合来源。
- [x] 支持最多 4 项、分评分价格规则、市场报价 markup、EA Bid/Buy Now 双下限和合法步进。
- [x] 市场报价保留 provider、quotedAt、expiresAt 和 freshness；陈旧/缺失报价按 `configured` 或 `skip` 显式处理。
- [x] 支持 1/3/6/24 小时 duration；expired 默认 `skip`，只有显式 Transfer Job 可 `reprice`。
- [x] Reprice 每项写入前确认同一 item 仍为 inactive；sold、active、closed 或 unknown 状态均不写入。
- [x] 每项写入前重读 EA Bid/Buy Now 下限；O8 决定 Buy Now 超过 10000 的项在 Preview、Prepare 和最终 mutation 前均排除。
- [x] Preview 对排序后的候选建立最多 16 项的有界报价池；高价或 `fallback=skip` 项不占最终 `maxListings` 名额，继续回填池内后续候选，池外项保持 deferred。
- [x] 保持禁止 `relistExpiredAuctions()`，不通过 DOM、Enhancer 或 FSU 私有状态执行批量挂牌。

Automated tests:

- 价格策略矩阵覆盖固定价、评分 override、provider quote、markup、stale quote、EA 双下限、步进和 fallback。
- 覆盖首项及多个前置高价回填、`fallback=skip` 初始报价发现、9 选 4 实际缺陷形状、16 项报价池上限和池外 deferred 语义。
- 覆盖 Club/Transfer 来源隔离、duration、expired timeout、sold/active race、容量竞争和部分成功 Journal。
- Architecture test 继续保证 EA mutation 只有 Adapter 允许的精确 `list()` 调用点，`relistExpiredAuctions()` 调用点为零。
- 完整仓库验证和发行产物一致性通过。

Live validation:

- 使用低价值卡分别验证多卡 Club Listing、1 小时到期后的显式 reprice、3 小时 duration 和 provider quote/固定价 fallback。
- 对每张卡核对 Bid、Buy Now、duration、item ID、trade ID、前后状态和 Transfer 容量；任何身份或状态不一致立即停止。
- 不填满 Transfer List 来制造容量错误，也不使用高价值卡测试未批准策略。

Exit criteria: Listing 和 Reprice 的定价、超时及来源策略在手动和循环 Job 中一致，低价值实机结果与 Preview 完全相符，任何 expired 处理均为精确逐项操作。

Out of scope: 混合来源、自动 relist all、低价抢挂、利润保证、自动 Quick Sell。

Next: TS13 多 Job、长期运行与恢复。

### TS13 多 Job、长期运行与恢复

Status: Complete on `0.7.91`.

Depends on: TS12 Complete；O13 必须确认未知 Journal 的人工处理政策，O10 必须确认多 armed Job 上限。

Scope:

- [x] 从单 armed Job 扩展为最多 3 个 armed Jobs，但全局同时只允许一个 Trade mutation Run；公平调度先按 due time，同 due time 再按 Job type 和稳定 tie-break 决定。
- [x] History、Listing Journal、Buy Journal、Lease、Scheduler event 和 request budget wait 使用统一 `runId` correlation，支持跨 reload 和跨多次 schedule occurrence 对账。
- [x] 对长期 cooldown、预算恢复、登录未就绪和 Loop 占用显示明确 runtime 状态；Provider 健康和 request retry 时间保持只读。
- [x] 过期 Lease 使用两阶段接管；先做只读对账，只有匹配终态 History 且无未知 Journal 时才显式清理并获取新 Lease。
- [x] 未知 Journal 不自动 acknowledge；Recovery UI 展示证据 hash、风险阶段和数量，要求锁定/空闲状态、精确确认和人工原因，并写入有界本地审计。
- [x] 无 Journal/History 的过期 Lease 提供独立 `LEASE Recovery`；确认只写审计和 blocked History，不清理 Lease、不调用 EA。
- [x] 长期 diagnostics 只保留有界聚合和脱敏事件；History 100、Scheduler events 100、Journal events 80、Audit 20、correlations 20。
- [x] Fake-clock soak 覆盖 3 个 Buy/Listing Job、会话/Loop/预算等待、reload、双标签 Lease、公平调度和各自授权耗尽。

Automated tests:

- Fake clock 长时间推进覆盖多 Job 公平、同一 due time、预算耗尽/恢复、休眠、reload、跨标签 lease 和 Circuit cooldown。
- Crash/recovery matrix 覆盖 mutation 前、请求已发出、EA 响应后、对账中和 History 写入前后的每个 checkpoint。
- Migration/retention tests 覆盖旧 Job Store、旧 Journal、上限淘汰和诊断脱敏。
- 完整仓库验证通过，并增加固定时长的 soak test；测试不得依赖真实 EA。

Live validation:

- 在低频、低数量条件下运行一个包含 Buy、Club Listing、Transfer reprice 和 Loop 互斥的合并长时 campaign。
- 验证后台标签、页面刷新、重新登录、系统休眠和双标签页；不主动断网或终止浏览器来制造未知写入。
- 证明没有并发 mutation、没有重复 schedule occurrence、没有绕过预算，所有等待和恢复均可从 UI/diagnostics 解释。
- 使用 `EXPIRE LEASE 1` 只写入受控过期 Lease；全局 Recovery 门禁必须在授权前阻断。人工 Lease acknowledgement 只写 Audit/blocked History，后续重新授权才允许 Scheduler 以终态 History 完成两阶段清理和接管。

Live result: `0.7.91` completed the three-Job campaign with five independently authorized Runs: Buy `2/2`, Club Listing `2/2`, Transfer Reprice `1/1`. A Player Pick Loop occupied the shared Coordinator until 15:55:10 and Reprice started only at 15:55:12. F5 changed the page owner while preserving the two remaining Interval authorizations; the second Buy and Club runs completed afterward, then both Jobs disarmed and the Scheduler relocked without a third occurrence. Controlled Lease `expired-lease-validation-1786523178663` produced a zero-mutation blocked audit receipt, remained unavailable for overwrite until acknowledgement, and was then cleared by the subsequent authorized one-card Listing. No duplicate `runId`, duplicate `scheduledFor`, unknown Journal, concurrent mutation, unexpected terminal state or open Circuit was observed. Request-budget cooldown did not arise naturally and was not manufactured; the automated cooldown/soak coverage remains the evidence for that branch.

Exit criteria: 有限多 Job 可长时间运行且始终串行写入；恢复、阻塞、人工处理和日志保留均有确定协议，运维人员无需读取原始 EA 对象即可定位状态。

Out of scope: 自动确认未知交易、远程后台代执行、无限 History、无限 armed Jobs、保存 EA 凭证。

Next: TS14 可选 Companion 最终决策。

### TS14 可选 Companion 最终决策

Status: Complete. Companion deferred.

Depends on: TS13 Complete；O15 必须记录实现或永久暂缓的依据。

Scope:

- [x] V9-12 已证明页面保持打开时，后台标签可由 interval/focus/visibility/online wakeup 触发并正确补充检查；现阶段没有证据证明必须增加扩展 alarm。
- [x] Companion 暂缓：userscript 只在已登录且页面存在时执行；页面关闭、浏览器退出或未登录时不交易，恢复后按 misfire、Journal 和 Lease 规则处理，不补做未经授权的旧 occurrence。
- [ ] 若实现，Companion 只允许 alarm、通知以及打开/聚焦 EA 页面；实际到期判断、登录检查、确认和 EA 写操作仍由页面内 Runner 完成。
- [ ] Companion 不保存 Cookie、Token、账号密码、EA Item 或交易响应，不在 Service Worker 调用 EA 接口，也不自动登录。
- [ ] 定义 userscript 与 extension 的版本/消息协议、权限最小化、卸载降级和诊断边界。

Automated tests:

- 若暂缓实现：完成决策审查和文档一致性检查即可，运行时测试为 N/A。
- 若实现：覆盖消息 schema、来源校验、alarm 去重、页面缺失/未登录、通知、版本不兼容和无扩展降级；静态审计证明扩展无 EA mutation 与凭证存储。
- 两种结论都必须保持 `npm run verify` 通过。

Live validation:

- 若实现，只验证 alarm/notification/open/focus 和页面内接管，不以页面关闭时成交作为成功标准。
- 若暂缓实现，确认无扩展安装时完整 Trade Scheduler 行为不变。

Exit criteria: Companion 已被明确拒绝/暂缓，或以最小权限完成验证；不存在“扩展稍后也许会后台交易”的模糊边界。

Out of scope: Service Worker 交易、远程服务器交易、自动登录、凭证同步、绕过浏览器/EA 限制。

Next: TS15 生产发布与路线图关闭。

### TS15 生产发布与路线图关闭

Status: Complete. Candidate schema, capability matrix, automated verification, V13-15 canary, commits, tag and immutable GitHub Release are complete.

Depends on: TS14 Complete；所有仍会影响生产默认值的 Open decisions 必须 Resolved 或明确 Deferred with reason。

Scope:

- [x] 冻结候选生产 Job Store schema 5、Authorization collection schema 2、默认安全参数、旧单授权迁移和 Job-only schema 1 导入/导出；回滚点为已验证的 `0.7.84`。
- [x] 为 Manual、Once、Recurring、Buy、Club Listing、Transfer reprice、Stop、Circuit、Journal recovery 和 Loop/Trade 互斥建立最终候选能力矩阵。
- [x] 完成候选 UI 可访问性、触摸屏/手机布局、长列表、确认文案、状态提示和 Recovery 审查。
- [x] 更新设计文档和运维手册中的能力边界、隐私边界、故障排查、一次性 V13-15 campaign 和低风险首次运行流程；正式 Release notes 在通过 canary 后生成。
- [x] 执行完整自动验证、迁移验证、离线 soak 和候选构建一致性检查。
- [x] 在 `0.7.91` 完成有界真实页面 V13-15 canary，包括多 Job、Loop 互斥、F5/后台恢复、授权耗尽和两阶段 Lease Recovery。
- [x] 明确候选 GA 生产门禁与仍然禁用的能力；`EXPIRE LEASE 1` 只保留为有文档的只读恢复验证入口。
- [x] 发布最终候选和稳定版本，并在第 20 节记录版本、测试数量、实机证据、剩余风险和回滚点。

Candidate capability matrix:

| Path | Candidate support | Hard boundary |
| --- | --- | --- |
| Manual Club Listing / Transfer Reprice | Supported | 单一来源，1-4 项，每个 chunk 最多 2 项，逐项身份/价格/Transfer 回读 |
| Manual Buy | Supported | Rare Gold，最多 4 个连续评分和 4 项，单卡 2000，总预算 8000 |
| Scheduled Buy / Club Listing / Transfer Reprice | Supported behind explicit authorization | `once/daily/interval/window`；最多 3 个 armed Jobs；once/window 1 Run，daily/interval 2 Runs；全局只允许一个 mutation Run |
| Stop / request cooldown / Loop mutex | Supported | 只在安全点停止；预算不足本地等待；Runner operation 活跃时不开始 Trade |
| Circuit / unknown Journal / expired Lease | Supported fail-closed | 未知 mutation 全局阻止写入；Recovery 仅在锁定空闲状态人工审计；Lease 两阶段接管 |
| Background/reload/relogin | Supported while an authenticated EA page exists | 页面关闭、浏览器退出或未登录时不交易；恢复后只按 misfire/授权处理 |
| Other Buy card classes, mixed Listing sources, `next-login`, more than 4 items, more than 3 armed Jobs | Unsupported | 必须 fail closed；不得通过 JSON 绕过 |
| Automatic bid, Quick Sell, relist-all, Companion/server-side trading | Unsupported | 不在本路线图范围；禁止调用 `relistExpiredAuctions()` |

Automated tests:

- `npm run verify`、architecture audit、schema/Profile 校验、构建、root/dist equality、发行资产和安装更新路径全部通过。
- 使用旧版本 Job/Journal/History fixture 完成迁移与回滚测试；敏感信息扫描不得发现 Token、Cookie、凭证或原始 EA 响应。
- 完成至少一次固定时长的离线多 Job soak 和确定性重放。

Live validation:

- 候选版只用低价值、低数量 Job 做最终 canary，覆盖一个完整 recurring 周期和一次 reload/relogin 恢复。
- 核对无重复交易、无超预算、无并发 Loop/Trade、无未知 Journal、diagnostics 可导出且隐私合规。
- canary 失败必须回锁相关 gate，而不是只补日志后继续发布。

Exit criteria: 能力矩阵中所有标为 supported 的路径均有自动测试和真实证据；所有 unsupported 路径均 fail closed；稳定版本、运维手册和回滚点已发布。Trade Scheduler 路线图至此结束并转入维护模式。

Out of scope: 第 5 节非目标，以及未通过独立设计评审的新交易类型或规避 EA 限制的功能。

Next: Maintenance only；新范围必须新建设计文档，不沿用未定义的 TS16。

## 19. Open decisions

以下事项在进入对应实现阶段前必须明确记录结论：

| ID | 问题 | 建议默认 | 决定阶段 | 状态 |
| --- | --- | --- | --- | --- |
| O1 | Buy Job 默认 `cardClass` 是 rare-gold、normal-gold 还是必须显式选择？ | 必须显式选择 | TS1 | Resolved: D13 |
| O2 | Price Provider 默认顺序。 | Auto: FUT.GG -> FUTNext | TS1 | Resolved: D14 |
| O3 | FUTNext rating catalog TTL 和 last-known-good 最长允许时间。 | 24 小时，版本变化立即失效 | TS1 | Resolved: D15 |
| O4 | 默认 Misfire Policy 和 grace window。 | grace-window，15 分钟 | TS10 | Resolved: TS10 bounded recurring authorization |
| O5 | 最低金币余额是否为所有 Buy Job 的全局硬限制。 | 全局硬限制，可被 Job 提高但不能降低 | TS4 | Resolved: TS5 explicit reserve gate |
| O6 | Listing expired 默认跳过还是重新报价。 | skip；reprice 必须显式选择 | TS2 | Resolved: TS7.2 explicit manual gate |
| O7 | 是否允许同一 rating rule 同时匹配普通金和特殊卡。 | 不允许；card class 必须明确 | TS2 | Resolved: explicit card-class contract |
| O8 | 是否需要高价值卡 EA 最低 BIN 复核。 | 首版不实现，高价值卡继续排除 | TS12 | Resolved: exclude Buy Now above 10,000 |
| O9 | 手动 Run 和单个 chunk 的 Listing/Buy 数量上限。 | 首次只提高一个数量级；chunk 不超过 TS8 已验证的两项，Run cap 由最坏请求成本决定 | TS9 | Resolved: Run cap 4, chunk cap 2, 15-minute budget wait deadline |
| O10 | Recurring 阶段允许多少 armed Jobs，以及何时开放多 Job。 | TS10 只允许一个；TS13 通过长时验证后才允许有限多 Job | TS10/TS13 | Resolved for TS13 candidate: at most 3 independently authorized Jobs; release pending V13-15 |
| O11 | 是否支持 `next-login`。 | 默认拒绝；只有能证明不补跑旧 occurrence 且不会无确认交易时才开放 | TS10 | Resolved: rejected |
| O12 | 未售出超时后的默认行为。 | 默认 `skip`；1/3 小时后 `reprice` 必须由 Job 显式配置 | TS12 | Resolved: skip by default; reprice requires explicit Transfer Job |
| O13 | 未知或跨 mutation boundary 的 Journal 是否允许自动 acknowledge。 | 不允许，只能人工查看证据后解除 | TS13 | Resolved: never automatic; exact manual confirmation plus bounded local audit and blocked History |
| O14 | Buy 是否扩展到 Rare Gold 之外的 card class。 | TS11 保持 Rare Gold；其它卡类逐类评审 | TS11 | Resolved for TS11: Rare Gold only |
| O15 | 是否实现 Companion Extension。 | 默认暂缓；只有页面 timer 的实测限制无法由 userscript 解决时才实现最小 Companion | TS14 | Resolved: deferred; page-open userscript wakeups are sufficient for current scope |

## 20. 决策与验证日志

后续更新按以下格式追加，不改写历史结果：

```text
YYYY-MM-DD / TSx / Decision or validation title
Status:
Commit/Version:
Automated tests:
Live setup:
Observed result:
Diagnostics:
Remaining risk:
Next:
```

### 2026-08-06 / TS0 / Initial design

Status: Complete

Commit/Version: Documentation draft on repository version `0.7.31`.

Automated tests: Not run; no runtime code changed.

Live setup: Static inspection of installed Enhancer `26.1.6.2`, retained Enhancer versions `26.1.5.6-26.1.6.2`, local FSU `26.09`, and FCAutomationTool source.

Observed result: Enhancer and FSU both use EA `services.Item.list`; Enhancer rating filtering resolves external definition IDs and injects one ID into each EA market search; FCAutomationTool prices call FUT.GG and FUTNext directly.

Diagnostics: No EA transaction was executed.

Remaining risk: EA internal DTO and response fields still require TS1 live capability capture; external rating catalog is undocumented.

Next: Resolve O1-O3 and implement TS1 without write operations.

### 2026-08-06 / TS1 / Read-only foundation

Status: In progress; implementation and automated verification complete, live EA-page validation pending.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: `npm run verify` passed: 115 test files and 743 tests; syntax, ESLint, config/Profile validation, architecture audit, build, dist and FSU release checks also passed.

Live setup: Pending. The Console commands in TS1 must be run after EA Web App and FCAutomationTool are ready.

Observed result: Trade contracts, disarmed import behavior, explicit card class, Fake/EA adapters, FUTNext rating catalog, platform-isolated price quotes, error classification and circuit breaker are implemented. Existing Player Pick price-loading behavior remains covered by compatibility tests.

Diagnostics: Runtime exposes `inspectTradeCapabilities`, `inspectTradePriceLimits`, `loadTradePlayerCatalog`, `clearTradePlayerCatalogCache`, `loadTradePriceQuotes` and `clearTradePriceQuoteCache`. The only implemented EA Trade service invocation is read-only `requestMarketData()`; market search, bid, move and list have zero call sites.

Remaining risk: Real FC26 page objects may expose different DTO, Trade Access, coin, capacity or item price-limit shapes. These fields must be captured through the allowlisted diagnostics before TS2.

Next: Collect and review the TS1 Console outputs; mark TS1 complete only after confirming the diagnostics contain no authentication data and the read-only values match the live account.

### 2026-08-06 / TS1 / Live read-only validation round 1

Status: Partial pass; one compatibility fix implemented and awaiting a one-command retest.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: After the live-shape fix, `npm run verify` passed: 115 test files and 744 tests; all other verification stages passed.

Live setup: EA Web App on PC with FCAutomationTool `0.7.31`; artifact `trade-ts1-diagnostics-2026-08-06T12-10-47-903Z.json`; Console reported no errors.

Observed result: `runtimeReady` and `canTrade` were true; Trade Access was allowed; all required EA methods and 13 allowlisted search criteria fields were present; Transfer List was 11/100. FUTNext returned 50 definition IDs for each of ratings 84 and 85. FUT.GG returned HTTP 403 and Auto correctly fell back to five FUTNext quotes. A Club item resolved successfully and read-only `requestMarketData()` returned HTTP 200 with price limits 700-10000.

Diagnostics: No token, auth, cookie, persona, email, session, password, secret or credential field/string was present. The only mismatch was `coins: null`.

Remaining risk: Live `getCurrency(GameCurrency.COINS)` returns an object with an `amount` field, while the initial Adapter expected a directly numeric value. The Adapter now accepts both shapes and has a contract test ensuring private currency/user fields are not serialized. The live coin value still requires confirmation after reloading the rebuilt userscript.

Next: Run `__FCLoopRunner.inspectTradeCapabilities()` once with the rebuilt userscript and confirm `coins` is a finite value. No catalog, quote or price-limit rerun is required.

### 2026-08-06 / TS1 / Live coin validation round 2

Status: Complete.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: Unchanged from round 1: 115 test files and 744 tests passed.

Live setup: EA Web App on PC after reloading the rebuilt FCAutomationTool `0.7.31` userscript.

Observed result: `runtimeReady: true`, `canTrade: true`, Trade Access allowed at level 2, coins read as a finite value, and Transfer List remained 11/100 with 89 free slots. The 13 criteria fields and required Trade methods remained available.

Diagnostics: The compatibility reader extracted only the numeric `amount` from the live EA currency object; no user or currency object was serialized.

Remaining risk: TS1 has no known blocker. EA internal APIs remain unstable and continue to require Adapter-level allowlisting and versioned live validation in later write stages.

Next: Start TS2 manual Bulk Listing implementation. Do not perform a real listing until Planner preview, explicit confirmation, stop behavior and per-item receipts pass automated tests.

### 2026-08-06 / TS2a / Listing candidate and preview foundation

Status: In progress; automated implementation complete, live read-only candidate validation pending.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: `npm run verify` passed: 117 test files and 752 tests; all syntax, ESLint, config/Profile, architecture, build, dist and FSU release checks passed.

Live setup: Pending. Reload the rebuilt userscript and export the read-only candidate/preview artifact before implementing `list()`.

Observed result: The EA Trade Adapter now exports allowlisted Club/Transfer candidate snapshots; the pure Planner filters non-player, untradeable, limited-use, concept, Academy, evolution, Active/Closed/unknown Trade, card-class and rating-rule mismatches. Preview applies source/rating/item ordering, `maxListings`, fixed price, fresh market override, stale/unavailable fallback, EA price increments and duration.

Diagnostics: Runtime exposes `inspectTradeListingCandidates()` and `previewTradeListings()`. Preview returns aggregate scan counts, selected entries, rejection counts and at most 20 rejection samples; it does not return raw EA items or the complete Club. Architecture audit keeps `services.Item.list()` at zero call sites.

Remaining risk: Live EA auction methods and tradeability fields may differ from fixtures. Transfer expired items in particular must be observed as `inactive`, `closed`, `active` or `unknown` before defining write eligibility and reconciliation.

Next: Collect one read-only Preview artifact covering both Club and Transfer sources. Review it before adding Listing Transaction or UI confirmation.

### 2026-08-07 / TS2a / Live listing preview validation

Status: Complete for Club candidates and Active Transfer exclusion; Expired Transfer shape remains pending under TS2.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: At artifact generation time, 117 test files and 752 tests passed.

Live setup: EA Web App on PC; artifact `trade-ts2a-preview-2026-08-06T22-54-02-815Z.json`; Console reported no errors.

Observed result: The scan returned all 2706 unique entities: 2679 Club and 27 Transfer. All 27 Transfer items were tradeable active auctions and were rejected as `active-trade`. Club filtering found 88 common Gold, 32 rare Gold and 13 Special eligible items without cross-class selection. FUT.GG returned HTTP 403 and Auto fell back to FUTNext for all 10 requested rare-Gold quotes; nine were below configured price and one higher quote applied 5% markup plus EA increments, producing start/buy-now 2600/2700.

Diagnostics: No authentication or user identity fields were present. Non-player, untradeable, card-class and active-trade rejection totals reconciled with all scanned entities. Preview remained read-only.

Remaining risk: No expired or inactive Transfer item existed during capture, so Transfer reprice eligibility and post-list state cannot yet be considered live-validated.

Next: Implement and validate the guarded Club single-item transaction before enabling bulk execution or Transfer reprice.

### 2026-08-07 / TS2b / Guarded Club listing transaction core

Status: Complete for the guarded Club single-item transaction; bulk execution and Transfer reprice remain gated.

Commit/Version: Uncommitted working tree on repository version `0.7.31`.

Automated tests: `npm run verify` passed: 119 test files and 763 tests; all other verification stages passed.

Live setup: EA Web App on PC; prepared artifact `trade-ts2b-prepared-2026-08-06T23-12-53-842Z.json` and run receipt `trade-ts2b-receipt-2026-08-07T01-34-29-467Z.json`. Runtime remained hard-limited to one Club item and rejected Transfer sources.

Observed result: Preparation selected one 77-rated common Gold Club item with EA limits 300-10000 and final prices 650/700. The write returned HTTP 200, Transfer refresh returned HTTP 200, and reconciliation found the same item ID and definition ID in the Transfer pile with an Active auction, trade ID, start price 650, buy-now 700 and about 3598 seconds remaining. The receipt completed with requested 1, succeeded 1, failed 0 and skipped 0.

Diagnostics: `services.Item.list()` and `requestTransferItems()` each have one audited Adapter call site. No retry exists after an accepted or ambiguous write. The receipt contains no authentication or user identity fields. Console separately reported an unhandled HTTP 500 through EA `trackUserTransaction` after the verified listing; neither the list response nor Transfer refresh recorded that failure. It is classified as non-blocking external telemetry and deferred unless it later affects a Trade receipt or reconciliation result.

Remaining risk: Expired/Inactive Transfer shape, Transfer reprice, bulk pacing, Stop between real writes and capacity races are not live-validated. Keep the Club single-item and Transfer-source gates until the corresponding next-stage validation is complete.

Next: Implement the Bulk Listing UI and multi-item execution behind conservative limits; do not enable Transfer reprice until an expired/inactive Transfer candidate is captured and validated.

### 2026-08-07 / TS2c / Manual Listing UI and diagnostics

Status: Complete for the guarded Club single-item UI flow.

Commit/Version: Uncommitted working tree on repository version `0.7.33`.

Automated tests: `npm run verify` passed: 124 test files and 777 tests; syntax, ESLint, config/Profile validation, architecture audit, build, dist and FSU release checks also passed.

Live setup: EA Web App on PC, Runner `0.7.34`; artifact `trade-listing-diagnostics-2026-08-09T14-35-50-291Z.json`. Enhancer Trader/Auto Buy and FSU Bulk Auction were not part of the transaction.

Observed result: The independent responsive dialog supports card class, rating/price rules, quote provider, market override, duration, read-only Preview, price-limit Prepare, exact confirmation, one-item execution, Stop, Recap and diagnostics export. The live run scanned 2950 Club entities, found 94 eligible common Gold cards and prepared exactly one item. EA price limits loaded as 300-10000; `list()` returned HTTP 200 for start/buy-now 650/700 and one-hour duration. Transfer refresh completed and reconciliation found the exact item/definition in Transfer with an Active auction and trade ID. The receipt completed requested 1, succeeded 1, failed 0, skipped 0; circuit remained closed and no error was recorded.

Diagnostics: Export includes allowlisted runner/operation state, Job, Preview, sanitized Prepared plan, receipt and sanitized errors. Confirmation tokens and raw error responses are excluded. Recap pages contain at most 15 item receipts.

Remaining risk: Transfer sources, Transfer reprice, multi-item execution and Auto Buy remain unavailable. One scheduled Club single-item run, page resume, expired-lease reconciliation and misfire behavior still require live validation.

Next: Validate exactly one scheduled Club item through the TS3 auto-relocking gate. Do not broaden the gate after that run without a separate review.

### 2026-08-08 / TS3 offline Scheduler, persistent circuit and Job UI

Status: Guarded single-run validation gate implemented; one live scheduled Club item pending.

Commit/Version: Uncommitted working tree on repository version `0.7.33`.

Automated tests: The guarded validation implementation passes `npm run verify` with 137 test files and 823 tests. Syntax, ESLint, config/Profile validation, architecture audit, FSU patch replay, generated userscript/dist equality and FSU release assets all pass.

Observed result: Job configuration is persisted independently from Loop/Workflow config. Pure scheduling supports manual, once, daily IANA timezone, interval and one-shot window schedules; fake-clock coverage includes DST, skip/grace-window/next-login decisions, session/operation waits and absolute advancement. The store persists bounded History and defaults to paused with `liveExecutionEnabled=false`. After TS2c passed live validation, a separate validation executor now accepts only one armed `once + Club + maxListings=1` Job. Exact confirmation `RUN ONCE 1` enables the wait; execution start immediately pauses, disables live execution and disarms the Job. Misfire, stale lease, circuit/config changes and tick errors also relock. Buy Jobs remain configuration-only.

Safety: EA status `427` is classified as `auction-operation-blocked`, stops the current transaction without retry, and opens a GM-storage-backed persistent circuit. Preparation and every Listing mutation check the same circuit. The circuit never enters half-open by elapsed time and blocks until explicit manual reset. Stored diagnostics retain only allowlisted operation, endpoint, status/code, Job/Run, Trade Access and capacity fields. Operation Coordinator bridges existing Runner busy state, and the cross-tab lease fails closed when an expired run has not been reconciled.

Live blocker: The account currently receives `427` from EA-native auction/watchlist endpoints with Runner, FSU and Enhancer disabled. Historical TS2b HTTP 200 proves the implementation previously listed successfully but does not clear the current account/backend state. No live Listing, relist, bid, buy or high-frequency market validation may run while this persists.

Next: Schedule one low-value Club card 2-3 minutes ahead, enable the guarded gate, keep the page logged in for the first run, and export Scheduler plus Listing diagnostics. Review auto-relock, History and Transfer reconciliation before testing page resume or any broader schedule.

### 2026-08-08 / TS4 offline Buy core and preview UI

Status: Offline implementation complete; no production Buy entry exists.

Commit/Version: Uncommitted working tree targeting repository version `0.7.34`.

Automated tests: `npm run verify` passes with 136 test files and 817 tests. Syntax, ESLint, config/Profile validation, architecture audit, FSU patch replay, generated userscript/dist equality and FSU release assets also pass. The focused Trade suite covers the EA/Fake Adapter contract, exact rating/definition lane rotation, candidate sorting, transaction limits, persistent circuit checks, ambiguous reconciliation, Preview, 15-item Recap, diagnostics and Scheduler UI.

Observed result: FUTNext catalog data is materialized into one exact search lane per rating and definition ID. A new search invalidates the previous EA live-item map. Candidates are revalidated and sorted by Buy Now, expiry and trade ID; at most one current-response item can reach Buy Now. Non-duplicate purchases target Club and Club duplicates target Transfer. Preview is available from Buy Job cards and public runtime diagnostics, but it performs no EA market search and always reports live execution locked.

Safety: Search, Buy, refresh and move are normalized by the EA Trade Adapter and expose allowlisted snapshots only. Every search and Buy mutation rechecks the shared circuit. An ambiguous response can proceed only when the exact item materializes and the coin delta equals the requested Buy Now; refresh uncertainty, missing evidence, route uncertainty and 427 stop the run without another purchase. Automatic Buy remains absent from the Scheduler executor, `liveExecutionEnabled=false`, and Scheduler remains paused.

Remaining risk: EA `requestUnassignedItems` and optional Transfer/Club/Watchlist refresh behavior, post-Buy repository timing, exact coin update timing, duplicate routing and Transfer capacity races are only fixture-validated. The current account/backend status 427 makes a real Buy probe unsafe. The global minimum retained coin balance decision remains open and is not silently defaulted.

Next: Run the full repository verification. Then stop TS4/TS5 production work until EA native Listing and market endpoints recover; resume with read-only preview diagnostics before one explicitly confirmed low-value purchase.

### 2026-08-09 / TS3 guarded scheduled Listing validation gate

Status: Complete for the guarded single scheduled Club item flow.

Commit/Version: Uncommitted working tree targeting repository version `0.7.35`.

Automated tests: `npm run verify` passes with 139 test files and 837 tests. New coverage verifies exact gate eligibility, confirmation, atomic pause/live-off/disarm, Scheduler-to-executor integration, one History receipt, lease, Web Lock and Coordinator compatibility, recovery wakeups, page resume, FSU Club readiness and misfire behavior, delayed EA session readiness, disabled production paths, and rejected price-limit refresh diagnostics with usable existing limits.

Observed result: The main Trade Scheduler permits one temporary validation run only when exactly one enabled+armed Job is a `once` Listing from Club with `maxListings=1`. The run must be 15 seconds to 15 minutes ahead and use skip or at most a 15-minute grace window. Exact input `RUN ONCE 1` enables waiting. At execution start the executor pauses the Scheduler, disables live execution and disarms the Job before Prepare or `list()`; a missed run, stale lease, circuit/config change or tick exception also relocks. Scheduler diagnostics include a sanitized Prepared plan and receipt without the confirmation token.

Live validation: EA Web App on PC, Runner `0.7.35`; artifact `trade-scheduler-diagnostics-2026-08-09T14-59-47-540Z.json`. The Job was scheduled for `1786287480000` and started 1.702 seconds later. It immediately relocked the Scheduler (`paused=true`, `liveExecutionEnabled=false`, `armed=false`), completed one run and cleared `nextRunAt`. The exact Club item `913454790934` / definition `265850` was listed at 650/700 for one hour. `list()` and Transfer refresh returned HTTP 200; reconciliation found an Active Transfer auction with trade ID `607251201956` and about 3598 seconds remaining. The receipt recorded requested 1, succeeded 1, failed 0, skipped 0; the circuit remained closed and the lease and Coordinator were idle after completion.

Misfire live validation: EA Web App on PC, Runner `0.7.36`; artifact `trade-scheduler-diagnostics-2026-08-09T15-25-49-566Z.json`. A `once + skip` Job scheduled for `1786289040000` was first evaluated after page restart at `1786289119476`, 79.476 seconds late and outside the 15-second tick tolerance. History recorded exactly one `missed / misfire-skip` receipt with requested 0, succeeded 0 and no item receipts. Runtime retained `lastStartedAt=null` and `runCount=0`, proving the Listing Executor and EA mutation transaction did not start. The Scheduler finished paused and live-disabled, the Job was disarmed, and Circuit, Lease and Coordinator were inactive.

Diagnostic note: The Prepared price-limit refresh returned HTTP 403 while the EA Item still exposed valid existing limits 300-10000. This did not invalidate the confirmed price or the subsequently verified Listing. Price-limit diagnostics now report data availability separately from refresh outcome (`status`, `refreshStatus`, `limitsSource`), and the final transaction receipt retains the same refresh evidence. A rejected read-only refresh alone does not open the mutation circuit when valid limits remain available.

Post-validation hardening (`0.7.36`): Scheduler relock is now one Job Store operation that pauses, disables live execution and disarms every pending Job. Misfire, expired lease, circuit/config changes, manual disable and unexpected tick errors all use this path. Any Job create/edit/delete while live execution is enabled also relocks before persisting the change. The generic Pause/Resume UI was removed so a changed Job cannot reuse an earlier `RUN ONCE 1` confirmation. Scheduler and Listing transactions share one `runId` and `scheduledFor`; expired-lease takeover writes a sanitized blocked History receipt without the lease token. Integration tests cover one execution after an in-grace page resume, zero execution after skip/grace expiry, delayed EA session readiness, repeated ticks and expired-lease takeover.

Resume wakeups (`0.7.37`): In addition to the fixed five-second absolute-time tick, visible `visibilitychange`, window `focus` and browser `online` now trigger an immediate idempotent Scheduler tick. Hidden visibility changes do nothing, listeners are removed on Runner destroy, and the Scheduler's existing in-flight guard collapses overlapping wakeups. Same-tab Runner operation coverage confirms a due Trade Job remains `waiting-operation` and executes at most once only if the operation clears inside grace.

Cross-tab hardening: When `navigator.locks` is available, every Scheduler tick runs under the same-origin exclusive `fc-loop-runner-trade-scheduler-v1` Web Lock with `ifAvailable`; a second tab returns busy without evaluating or executing the Job. GM storage lease remains the persistent crash/reload layer and fallback for browsers without Web Locks. The guarded Listing transaction now renews and verifies that lease immediately before each `listItem()` mutation; a lost or expired lease produces `listing-execution-lease-lost` with zero list calls. An accepted mutation still proceeds to Transfer reconciliation even if later state becomes uncertain.

Cross-tab diagnostics expose only the random tab owner ID, Web Lock support/name and a bounded in-memory tick timeline. Each event retains trigger (`startup`/`interval`/`focus`/`online`/`visibility`/manual), status/reason, Job/Run and the selected runtime status/reason/next time. This preserves short-lived `browser-lock-held` and `waiting-operation` evidence after later ticks. It does not persist across reloads and excludes arbitrary inputs and lease tokens. Lease snapshots retain owner, Run/Job and timing fields but always remove the internal token, including while a lease is active or expired.

Club readiness after restart (`0.7.38`): Artifact `trade-scheduler-diagnostics-2026-08-09T15-45-38-727Z.json` from live `0.7.37` reached Scheduler execution 151.054 seconds after its due time but blocked in 14ms with `no-eligible-listing-candidates`, requested 0 and no EA mutation. The page session and Trade capability were ready, but the scheduled Prepare snapshot was not retained. `0.7.38` therefore held an FSU-backed Job in `waiting-session` until Club data was fully validated and retained blocked Prepared scans for diagnostics.

FSU provisional correction (`0.7.39`): Artifact `trade-scheduler-diagnostics-2026-08-09T15-57-17-878Z.json` proved that the `0.7.38` gate was too strict. At 23:57:15 the armed Job scheduled for 23:55 remained `waiting-session / fsu-club-provisional`; no new History, Prepare or mutation existed. This was not an incomplete startup: `trusted-provisional` is the optimized FSU fast path and intentionally skips a full Club scan, so it does not automatically become fully validated. Guarded scheduling now waits only for FSU `loading/not-ready`. A provisional cache may select exactly one Club candidate, but before the Listing Transaction is created the executor must call FSU targeted Club validation for that exact item ID and definition ID. Failure, missing identity or an unavailable validator blocks with requested 0 and no `list()` call. The transaction still reloads the live item, eligibility and EA price limits and validates the lease immediately before mutation. Scheduler diagnostics now include page/FSU readiness, cache status and the sanitized targeted-validation result. FSU remains optional; without it the EA Trade Adapter path is unchanged.

In-grace restart live validation: EA Web App on PC, Runner `0.7.39`; artifact `trade-scheduler-diagnostics-2026-08-10T05-21-24-757Z.json`. The `once` Job was scheduled for 13:16:00 and first executed after a full page restart at 13:19:32.517, 212.517 seconds late but inside its 15-minute grace window. FSU was intentionally still `provisional / trusted-provisional / fullyValidated:false`. The executor prepared one Club common Gold, then targeted the exact item `913459392327` / definition `267680` through FSU; the same identity returned after 2814ms with no missing item. EA price limits refreshed to 300-10000, `list()` returned HTTP 200, Transfer refresh returned HTTP 200, and reconciliation found active trade `607277852375` at 650/700 with 3598 seconds remaining. History recorded exactly one completed run with requested 1, succeeded 1 and runCount 1. The Scheduler atomically ended paused, live-disabled and disarmed; lease and Coordinator were empty and the circuit remained closed. An older expired Job separately recorded `misfire-grace-expired` with requested 0, confirming restart did not revive it or issue another mutation.

Remaining risk: Expired lease reconciliation, dual-tab races and Loop/Trade mutual exclusion have not yet been observed on the live page. Normal scheduled execution, skip misfire, grace expiry and in-grace full page restart are now verified. The gate intentionally cannot run a second Job, daily/interval/window schedules, next-login, Transfer sources, reprice, bulk Listing or Buy.

Next: Validate dual-tab/operation-busy and expired-lease fail-closed behavior without broadening the mutation limit. Then resume TS4 with the existing read-only Buy preview before adding one explicitly confirmed low-value purchase gate. Keep Transfer sources, reprice, bulk Listing and scheduled Buy disabled until their separate staged validations.

Live-validation diagnostics preparation (`0.7.40`): Scheduler diagnostics retain the last 100 allowlisted tick events per page lifetime instead of only the latest tick. Recovery wakeups identify their trigger, and every event includes the persisted runtime summary after evaluation. This is diagnostic-only: it does not add an EA request, persist a new credential/state field, or broaden the one-card validation gate. Automated coverage locks bounded retention, field allowlisting, wakeup sources and actionable runtime selection. The dual-tab run must export diagnostics from both tabs before either is reloaded so the losing tab's `browser-lock-held` evidence remains available.

Dual-tab live validation (`0.7.40`): Artifacts `trade-scheduler-diagnostics-2026-08-10T07-46-53-502Z.json` and `trade-scheduler-diagnostics-2026-08-10T07-46-28-990Z.json` were exported before either page reloaded. The pages had distinct owners `tab-1786347494381-c6675518300a7` and `tab-1786347752331-8347ab8bd338c8`, with Web Locks supported in both. For Job `listing-1786347886061`, scheduled at 15:46:00 local time, the losing page recorded `interval / busy / browser-lock-held` at 15:46:02.720 and had no local Guarded receipt or completed event. The winning page recorded exactly one completed Run `trade-1786347962637-0f3f3cc138dcd`; EA accepted exactly one Listing and Transfer reconciliation found item `897981278776` / definition `50551170` as active trade `607281427497` at 650/700. Shared History contained one record for the target Job and runtime `runCount=1`. Both exports ended paused, live-disabled and disarmed with no active lease or Coordinator operation. This satisfies the live dual-tab exclusion gate; no second EA mutation or History receipt was observed.

Operation-busy live finding (`0.7.40`): Artifact `trade-scheduler-diagnostics-2026-08-10T08-14-48-273Z.json` and the matching Runner `log.txt` covered a `Daily Rare Pack to 5x80+ Loop`. The Listing Job was due at 16:03:00. The Loop finished its third SBC at 16:03:39, and the guarded Trade Job did not start until 16:03:42.158, proving the two write operations did not overlap. The diagnostics were exported about 11 minutes later, however, so five-second repeated `paused` events exhausted the 100-event window and removed the earlier `waiting-operation` entries. The post-Loop Listing also exposed a separate stale-candidate defect: Prepare selected item `897981278776`, which the previous dual-tab run had already listed as active trade `607281427497`. FSU reported a fully validated cache, so targeted provisional validation was not required; EA rejected the second list request with HTTP 200 and `success:false`.

Operation-busy follow-up (`0.7.41`): Consecutive identical Scheduler events are now coalesced with `firstAt`, latest `at` and `count`, preserving important transitions without allowing routine interval ticks to evict them. Club Listing preparation refreshes Transfer before candidate selection, and the Trade Adapter excludes a Club entity when the same item ID exists in Unassigned, Storage or Transfer. The Listing Transaction refreshes Transfer again immediately before each `list()` and blocks `listing-item-already-in-transfer` or a failed Transfer preflight before any EA mutation. These checks apply to manual and scheduled Listing and do not depend on FSU cache status. Automated coverage locks stale cross-pile exclusion, rejected refresh classification, Prepare fail-closed behavior and zero-write transaction blocking. Repeat the operation-busy live run on `0.7.41` to capture the direct waiting timeline and confirm a fresh candidate completes after the Loop.

Operation-busy live validation (`0.7.41`): Artifact `trade-scheduler-diagnostics-2026-08-10T09-07-38-587Z.json`. The Job was scheduled for 17:06:00. The bounded timeline retained 18 `waiting-operation / runner-operation-active` observations from 17:06:02.022 through 17:07:22.021, coalesced into three entries without losing the first/latest timestamps. The only Trade Run started at 17:07:27.022 after the Runner operation ended. Transfer was refreshed before preparation, candidate `897987946576` / definition `84121924` was selected instead of the stale cross-pile item from the prior run, and EA accepted one 650/700 Listing. Reconciliation found active trade `607283554103`; Transfer usage advanced from 7 to 8. Shared History contains exactly one completed target Run with requested 1, succeeded 1 and no failures or skips. This satisfies the Loop/Trade exclusion and fresh-candidate gates.

Expired-lease live validation preparation (`0.7.41`): A console-only helper stages one already-expired test lease after exact confirmation `EXPIRE LEASE 1`. It requires a paused/live-disabled Scheduler, exactly one eligible armed future `once + Club + maxListings=1` Job, no existing lease and no Runner operation. Staging does not enable scheduling or call EA. The normal `RUN ONCE 1` gate must then encounter the expired lease and produce one `blocked / expired-lease-reconciliation-required` History receipt, atomically relock and perform zero Listing mutations.

Automated verification: `npm run verify` passes with 142 test files and 849 tests, including confirmation/state guards, token redaction and the existing expired-lease Scheduler recovery contract.

Expired-lease live validation (`0.7.41`): Artifact `trade-scheduler-diagnostics-2026-08-10T09-39-19-166Z.json`. The scheduled Job hit the staged expired lease at 17:38:00.157 and stopped in 3ms with exactly one `blocked / expired-lease-reconciliation-required` History receipt. The receipt recorded requested 0, succeeded 0, failed 0 and skipped 0; `runCount` remained 0. The Job was disarmed, Scheduler ended paused with live execution disabled, the lease was cleared, and both Prepared Listing and Guarded Listing receipt were null. The diagnostics contained no lease token. No EA market, price-limit, Prepare or Listing mutation occurred. This satisfies the expired-lease fail-closed gate.

Next: Resume TS4 with the existing read-only Buy Preview only. Keep Buy Jobs manual, unarmed and live execution disabled; export the Scheduler diagnostics after preview so the FUTNext catalog attempts, exact rating lanes and `liveExecutionAllowed:false` can be reviewed before any future purchase gate is considered.

TS4 read-only Buy Preview live validation (`0.7.41`): Artifact `trade-scheduler-diagnostics-2026-08-10T09-46-32-433Z.json`. A manual, unarmed Rare Gold 84 Job with max Buy Now 1000, quantity 1 and budget 1000 loaded 50 definition IDs from FUTNext into one exact 84-rating lane with no missing rating. The plan was ready while `mode=preview-only`, `liveExecutionAllowed=false`, Buy receipt and error were null, Scheduler remained paused/live-disabled, and no lease or Trade operation existed. History did not gain a Buy Run. This satisfies the read-only Preview gate without an EA Transfer Market search or purchase mutation.

TS4 guarded single-Buy implementation: The Scheduler shows `Buy one` only after a ready read-only Preview and only for an enabled, unarmed, manual Rare Gold Job with exactly one rating, quantity 1, and both effective price and total budget capped at 2000. A separate modal requires exact text `BUY 1 MAX <price>`. Execution acquires the shared Operation Coordinator and cross-tab Trade Run Lease, rechecks the persistent circuit, refreshes Preview, heartbeats the lease immediately before Buy Now, and passes `maxBuyAttempts=1` to the transaction. Competition loss and ambiguous reconciliation therefore cannot spend the same confirmation on a second Buy request. The final sanitized receipt is written once to History and exposed through Buy diagnostics with search and mutation-attempt counts. Scheduled Buy remains unavailable.

Automated verification after the guarded Buy gate: `npm run verify` passes with 145 test files and 873 tests. The suite covers the exact manual confirmation, locked Scheduler requirement, stale Preview invalidation, one Buy mutation maximum, pre-Buy lease heartbeat, controlled Club/Transfer definition filtering, ownership-race and Transfer-full pre-search stops, destination-specific refresh, competition loss stop, UI recap, History/diagnostic allowlisting and all pre-existing Loop/Listing behavior.

First guarded Buy procedure (completed): Install the newly built userscript, keep the Scheduler paused/live-disabled, create or retain one manual unarmed Rare Gold 84 Job with max price and budget at or below 1000, run Preview, open `Buy one`, and confirm exactly once. Save both the Buy modal diagnostics and Scheduler diagnostics immediately; do not retry from the same page if the result is ambiguous or blocked.

TS4 first guarded Buy live validation (`0.7.41`): Artifacts `trade-buy-diagnostics-2026-08-10T11-18-05-991Z.json` and `trade-scheduler-diagnostics-2026-08-10T11-18-14-897Z.json`. Manual Run `manual-buy-1786360667871-dee9adf9a6d3f8` used one 84 Rare Gold lane with max Buy Now 1000, quantity 1 and budget 1000. It performed two exact-definition searches: definition `252154` returned no eligible candidate, then definition `256675` purchased item `914697943293` / trade `607287431196` for 900. The run recorded `buyAttempts=1`, requested 1, succeeded 1, failed/skipped 0, and completed in 13.771 seconds. Coins reconciled exactly from 1,184,041 to 1,183,141 and the item was verified in Club; Transfer usage remained 8/100. Scheduler History contained exactly one matching sanitized Buy Run. At export the Scheduler remained paused/live-disabled, both Buy Jobs were unarmed, the lease and Coordinator were empty, all operation flags were false, and the persistent circuit was closed. This satisfies the first non-duplicate-to-Club live gate.

Next: Validate one completed purchase whose definition is already owned so routing must end in Transfer. Keep the same manual single-card confirmation and save both diagnostics immediately afterward. Do not widen quantity, rating range, card class, price cap or scheduling, and do not proceed to Transfer-full testing until the duplicate route is proven.

Controlled destination validation: The single-Buy modal now exposes a validation-only `Auto route / Club only / Transfer only` selector that is never persisted into the Job. `Transfer only` filters the fresh Preview and transaction catalog to definitions currently owned in Club, requires `BUY 1 TO TRANSFER MAX <price>`, and rechecks ownership immediately before Buy. `Club only` applies the inverse filter and confirmation. No matching definition blocks before a market search; an ownership race blocks before Buy. When `Transfer only` is selected and Transfer capacity is already zero, the transaction returns `transfer-list-full` before any market search. This makes the remaining route and capacity live gates deterministic without enabling scheduled or bulk Buy.

Validation UI release (`0.7.42`): The prior guarded Buy implementation was built under the same `0.7.41` metadata as the first live test, so Tampermonkey could retain the earlier script and show no `Buy one` action after Preview. The Runner version is now `0.7.42`. Preview status and the per-Job detail explicitly report either `Buy one ready` or the exact unavailable reason, distinguishing stale installation, unlocked Scheduler, invalid Job policy and an unready Preview.

Transfer validation crash hardening (`0.7.43`): The first `Transfer only` attempt caused the EA page to become unavailable immediately after confirmation, and no post-attempt Buy/Scheduler diagnostics were exported. The purchase outcome is therefore unresolved and must be reconciled from the next session's coins, Transfer usage and Job History before any retry. Code review found that destination filtering checked each of 50 catalog definitions by rebuilding the full Club view every time, repeated once in the guarded gate and once in the transaction. With a roughly 19,000-item Club this created avoidable renderer allocation and CPU pressure on a path not exercised by the successful automatic Club route. EA and Fake Trade Adapters now expose a batch ownership snapshot that reads each inventory pile once and indexes all requested definitions in one pass. The transaction still performs a separate final single-definition ownership check immediately before Buy. Large-inventory regression coverage locks one pile read for 20,000 Club items and 50 definitions. This removes the identified pre-search renderer risk but does not yet prove that EA duplicate purchase routing to Transfer is valid; the live Transfer gate remains pending.

Post-crash reconciliation: Artifact `trade-scheduler-diagnostics-2026-08-10T12-15-44-580Z.json` was exported after restarting the entire browser under `0.7.43`. It retained the expired Lease for Run `manual-buy-1786363435970-66e802bb05e838`, acquired at `1786363435971`. Its `heartbeatAt` remained exactly equal to `acquiredAt`; the Buy transaction renews this Lease synchronously immediately before its only allowed `bid()` call. History contained no receipt for this Run, the Buy diagnostic state was empty after restart, and the Circuit contained no Buy failure event. This proves the Runner did not reach its Buy mutation boundary. Concurrent external buying changed both coins and Transfer usage, so neither value is used as transaction evidence. The failure location is consistent with the pre-search repeated ownership scan removed in `0.7.43`.

Persistent Buy phase journal (`0.7.44`): A sanitized GM-storage journal now records the latest guarded Buy phase before and after every important asynchronous boundary: fresh Preview, destination filtering, each market search, candidate selection, pre-Buy Lease heartbeat, `bid()`, purchase reconciliation, destination move, destination refresh and final repository inspection. It retains Run/Job IDs, timestamps, safe item/trade/search identifiers, route, price and response status/code only; raw EA payloads, account data, credentials and arbitrary error objects are excluded. The journal survives a tab or full-browser exit and is included in both Buy and Scheduler diagnostics. A completed or blocked Run retains its terminal phase for later review, while a new confirmed Run replaces the previous journal. This does not add an EA request, retry, purchase allowance or automatic execution path.

Expired pre-Buy recovery (`0.7.44`): On startup, an expired Lease belonging to a still-configured Buy Job is automatically reconciled only when `heartbeatAt === acquiredAt`, which proves the guarded executor never crossed its immediate pre-`bid()` Lease boundary. Recovery writes one `blocked / browser-terminated-before-buy-heartbeat` History receipt with requested 0 and clears the expired Lease. A Lease with any later heartbeat remains untouched and is reported for manual investigation because its purchase outcome may be ambiguous. This prevents a known pre-mutation browser crash from consuming the next confirmation merely to clear stale coordination state without weakening post-mutation fail-closed behavior.

Expired pre-Buy recovery live validation: Artifact `trade-scheduler-diagnostics-2026-08-10T12-28-20-971Z.json` from `0.7.44` contains exactly one recovered History receipt for Run `manual-buy-1786363435970-66e802bb05e838`: `blocked / browser-terminated-before-buy-heartbeat`, requested/succeeded/failed/skipped all 0, with the original acquired/heartbeat/expiry timestamps retained and no coin fields. The Lease is now null, Scheduler remains paused/live-disabled, Circuit is closed, Coordinator and all operation flags are idle, and no Buy journal exists before a new validation starts. This confirms deterministic pre-mutation crash recovery without an EA request.

Batch ownership live validation: Artifact `trade-buy-diagnostics-2026-08-10T12-32-50-754Z.json` from `0.7.44` records a complete persistent journal for a controlled `Transfer only` attempt. Fresh Preview completed, then all 50 Rare Gold 84 catalog definitions were indexed against current ownership in about 9ms without freezing or terminating the browser. No definition was currently owned in Club, so the gate ended `blocked / buy-transfer-definitions-unavailable` before transaction creation, market search, Lease heartbeat or `bid()`. The receipt has requested/succeeded/failed/skipped all 0 and the Circuit remained closed. This validates the renderer-pressure fix and fail-closed destination filter, but not the actual duplicate-to-Transfer route. The next controlled probe must first seed one catalog definition through the already-validated `Club only` route and then run `Transfer only` before any Loop or external tool can consume or move that card.

Controlled Club seed: Artifact `trade-buy-diagnostics-2026-08-10T12-36-26-846Z.json` records one completed `Club only` Run. All 50 catalog definitions were initially unowned; two market searches selected item `914742162136`, definition `192505`, trade `607290060994` for 800. Exactly one Buy attempt returned HTTP 200, coins reconciled by 800, the item materialized in Unassigned, move-to-Club returned HTTP 200 and final repository inspection loaded the exact item in Club. The journal reached `receipt-recorded`, requested/succeeded were 1/1 and the Circuit remained closed.

Controlled duplicate-to-Transfer live validation: Artifact `trade-buy-diagnostics-2026-08-10T12-39-30-149Z.json` records one completed `Transfer only` Run against the seeded definition. Batch ownership selected exactly 1 of 50 definitions (`192505`) in about 8ms. One market search selected item `914336425187`, trade `607290151001` for 800; the Lease heartbeat completed immediately before the only `bid()` call. Buy returned HTTP 200, coins reconciled by 800, and the item materialized in Unassigned. Move-to-Transfer returned HTTP 200, Transfer refresh completed, and final repository inspection loaded the exact item in Transfer. The journal reached `receipt-recorded`; requested/succeeded were 1/1, searches/buyAttempts were 1/1, and the Circuit remained closed. This satisfies the actual duplicate purchase routing behavior. A final Scheduler diagnostic should confirm one persisted History receipt and released Lease/Coordinator before the gate is considered fully closed.

Transfer Buy gate closure: Artifact `trade-scheduler-diagnostics-2026-08-10T12-40-35-149Z.json` contains exactly one History receipt for Run `manual-buy-1786365561664-917f08b322c79`, with requested/succeeded 1/1, failed/skipped 0, searches/buyAttempts 1/1 and expected destination Transfer. Transfer usage advanced from Preview 33/100 to 34/100, matching the single verified route. The Lease is null, Coordinator is idle, every Runner operation flag is false, Scheduler remains paused/live-disabled, the Buy Job is unarmed with runtime `disabled / not-armed`, and the Circuit remains closed. This closes the guarded manual single-card Buy live gate for both Club and duplicate-to-Transfer routes. Scheduled Buy, quantity above one, rating ranges, other card classes and unattended execution remain disabled pending separate gates.

### 2026-08-10 / TS5 / Guarded scheduled Buy offline core

Status: Guarded once/one-card live validation complete in `0.7.45`; production expansion remains disabled.

Decision: Scheduled Buy has no implicit minimum retained coin default. The user must persist an explicit global reserve before the Job can become eligible. A Buy Job may define a higher local reserve; the effective value is `max(global, job)`, so a Job cannot weaken the global floor. The activation text includes the effective value: `RUN BUY ONCE 1 RESERVE <coins>`.

Implementation: The common guarded Job selector accepts the existing one-card Listing path and the new Buy path. The Buy path is limited to exactly one enabled+armed `once` Job, one Rare Gold rating, quantity 1, max Buy Now and total budget at most 2000, skip or grace no longer than 15 minutes, at most five empty searches and at most five minutes. The executor uses the Scheduler-owned Web Lock/GM Lease, atomically calls Job Store `relock()` before Preview, acquires the shared Operation Coordinator, regenerates Preview, rechecks Circuit/capabilities/reserve, authorizes at most one Buy mutation and sanitizes the receipt before Scheduler History persistence. Buy Transaction also enforces the retained-coin floor immediately before the mutation path.

Production boundary: The offline implementation was built and verified with `SCHEDULED_BUY_LIVE_GATE_ENABLED=false`. Version `0.7.45` changes only this gate to `true` for the first guarded live validation. The UI persists the global reserve, allows a higher Job reserve and requires the effective reserve in the confirmation text. Scheduler diagnostics export both Listing and Buy validation-gate states. This does not enable recurring schedules, ranges, other card classes, quantity above one or price/budget above 2000.

Automated evidence: `npm run verify` passes on `0.7.45` with 150 test files and 901 tests. Strict-gate, Store migration, UI, dynamic confirmation, reserve, low-coins, relock and transaction tests pass. An end-to-end Fake Adapter resume test starts 59 seconds late inside grace, acquires the Scheduler lease, performs exactly one `buyNowItem()`, routes and verifies the item, writes exactly one sanitized History receipt, completes the once runtime, leaves the Job disarmed and releases the Lease. Existing Scheduler tests continue to cover skip/grace, waiting-session, waiting-operation and single execution; tick-lock tests cover dual-tab exclusion; Error Policy and Buy Transaction tests cover 429, 401, Captcha, 427, Stop and ambiguous no-retry behavior.

Next: Treat the guarded once/one-card gate as validated. Keep range, bulk, recurring schedules, other card classes and higher price/budget limits disabled until each receives a separate TS6 design review and staged live gate.

First live procedure: Disable all external Auto Buy/Trader activity and ensure no Loop or Batch operation is running. In Trade Scheduler, save `Global minimum retained coins` as the current coin balance minus 2000. Keep every other Job unarmed. Create one enabled+armed Buy Job scheduled once 2-3 minutes ahead with Rare Gold, rating 84-84, max Buy Now 1000, quantity 1, total budget 1000, optional Job reserve blank, grace-window 15, runtime 5 minutes, empty-search limit 5 and delay 8-15 seconds. Run the read-only Preview, then enter the exact confirmation displayed by the gate and enable it. Keep the logged-in EA page open. After the Job completes or stops, do not rearm or retry; immediately save Scheduler diagnostics and the Runner log. If the page/browser exits, reopen once, wait for startup reconciliation and export diagnostics without rearming.

TS5 guarded scheduled Buy live validation (`0.7.45`): Artifacts `trade-scheduler-diagnostics-2026-08-10T14-47-58-266Z.json` and matching Runner `log.txt`. Job `buy-1786372472974` was scheduled for 22:38:00 and Run `trade-1786372680058-4a70438a012bd8` started 58ms later. The executor atomically relocked before live work; at export the Scheduler was paused, live execution was disabled and the Job was disarmed with runtime `completed`, `runCount=1`. One exact Rare Gold 84 market search selected item `914376401372` / definition `265536`, trade `607293930459`, for 900 under a 1000 limit. Exactly one Buy attempt returned HTTP 200; coins reconciled from 1,094,184 to 1,093,284 while preserving the explicit 1,092,184 reserve. The item materialized in Unassigned, moved to Club with HTTP 200 and final repository inspection loaded the exact item in Club. History contains one sanitized completed receipt with requested/succeeded 1/1, failed/skipped 0, searches/buyAttempts 1/1 and spent 900. The persistent journal reached `receipt-recorded`; Lease and Coordinator were empty and Circuit remained closed. The destination refresh helper reported `unsupported`, but the following direct repository inspection proved `pile=club`, so this is a supported fallback rather than an unresolved route. This closes the TS5 guarded once/one-card live gate without widening its policy.

### 2026-08-10 / TS6.1 / Persistent bounded observability

Status: Offline implementation complete; no Trade execution policy changed.

Decision: Long-running health must survive the 100-entry History retention limit without retaining unbounded receipts. Job Store schema `2` therefore persists an aggregate metrics snapshot and migrates an existing schema `1` store by replaying only its currently retained, already-sanitized History once. Subsequent `addHistory()` calls append the bounded receipt and update metrics in the same store write.

Metrics: Fixed buckets retain total Runs by status and Job type, requested/succeeded/failed/skipped outcomes, Buy purchases/searches/attempts/spend, Listing successes, first/last timestamps and one allowlisted last-Run reference. Stop reasons are truncated to 120 characters, merged by exact value, sorted by frequency/recency and capped at 20. No item details, EA response, raw error, authentication data or unbounded events are added. Metrics never call the EA Adapter and remain cumulative when old History entries are evicted.

UI/diagnostics: Trade Scheduler adds a responsive `Summary` tab for the aggregate counters and stop reasons. Scheduler diagnostics already export the normalized Job Store snapshot, so the same metrics are included without another diagnostic path or network request.

Boundary: The validated TS5 `once`、Rare Gold、单评分、`quantity=1`、价格/预算不超过 2000 和显式 reserve 门禁保持不变. TS6.1 does not enable recurring schedules, rating ranges, bulk Buy, other card classes, Transfer reprice or broader Listing.

Automated evidence: `npm run verify` passes on `0.7.46` with 150 test files and 904 tests. Syntax, ESLint, config/Profile validation, architecture audit, FSU patch replay, all unit/contract/workflow tests, userscript build, dist equality and FSU release assets pass.

Next: Install `0.7.46`, open Trade Scheduler -> Summary, and save one Scheduler diagnostic. Confirm Job Store schema `2`, migrated aggregate totals and bounded reasons against retained History; no additional purchase is required for this check.

TS6.1 live migration validation (`0.7.46`): Artifact `trade-scheduler-diagnostics-2026-08-10T15-21-17-267Z.json`. Job Store schema `2` and metrics schema `1` loaded successfully from the existing installation. The retained 18 History Runs independently recompute to exactly the persisted aggregate: statuses completed 10、blocked 5、missed 2、failed 1; Job types Buy 7、Listing 11; outcomes requested 12、succeeded 10、failed 1、skipped 1; Buy purchases 4、searches 6、attempts 4、spent 3400; Listing successes 6. Metrics retained eight distinct bounded reasons and the exact latest TS5 Run reference. No duplicate migration or missing count was observed. At export the Scheduler remained paused/live-disabled with zero armed Jobs, Lease and Coordinator were empty, and Circuit was closed. This closes TS6.1 without an EA mutation.

Next: Design TS6.2 configuration export/import as a Job-only, fail-closed format. Export must omit History, metrics, runtime state, confirmation data and account-specific reserve; import must validate schema, disarm every Job and atomically relock before changing configuration.

### 2026-08-10 / TS6.2 / Job-only configuration portability

Status: Offline implementation complete; live import/export round-trip pending.

Format: `daily-loop-runner-trade-jobs` schema `1` exports at most 100 Jobs with only Job schema、ID、name、type、enabled、schedule、misfire policy and portable policy fields. It omits Armed、timestamps、History、metrics、runtimes、paused/live state、confirmation/authorization data and both global and per-Job minimum retained coins. Top-level and Job-level unknown fields, incompatible kind/schema, duplicate IDs, oversized text and invalid Jobs fail closed.

Import transaction: The UI requires `Validate` before `Replace jobs`; any text mutation invalidates validation, and apply reparses the exact text. Job Store validates all Jobs before mutation, then performs one replacement write that atomically pauses the Scheduler, disables live execution, disarms every imported Job and rebuilds disabled runtimes. Local History、metrics and global reserve remain unchanged. Preview state is cleared after import. No EA Adapter or network request is involved.

UI: Trade Scheduler Jobs adds `Export config` and `Import config`. Export downloads one JSON file; Import uses a dedicated responsive JSON surface and displays the exact replacement count after validation.

Boundary: Configuration portability does not transfer account authorization and does not make an otherwise unsupported Job eligible for the TS5 execution gate. Existing `once`、Rare Gold、single-rating、quantity 1 and price/budget restrictions remain unchanged.

Automated evidence: `npm run verify` passes on `0.7.47` with 151 test files and 914 tests. Coverage includes field allowlisting, execution/account-state omission, per-Job reserve rejection, kind/schema compatibility, duplicate IDs, import disarm, atomic replacement, local state preservation, stale validation invalidation and responsive UI. Syntax, ESLint, config/Profile validation, architecture audit, FSU patch replay, userscript build, dist equality and FSU release assets also pass.

Live procedure: Install `0.7.47`. In Trade Scheduler, note the current Job count, global reserve, History count and Summary total. Select `Export config`, open the downloaded JSON, then select `Import config`, paste the unchanged JSON, press `Validate`, verify the replacement count, and press `Replace with N Job(s)`. Do not Arm or run a Job. Export Scheduler diagnostics immediately afterward. Expected: all imported Jobs unarmed, Scheduler paused/live-disabled, History/metrics/reserve unchanged, Lease/Coordinator idle and no new Trade History receipt.

TS6.2 live round-trip validation (`0.7.47`): Artifacts `trade-jobs-2026-08-10T15-47-02-114Z.json` and `trade-scheduler-diagnostics-2026-08-10T15-47-58-026Z.json`. The export identified kind `daily-loop-runner-trade-jobs`, schema `1`, Runner `0.7.47` and exactly one Buy Job. Its fields were limited to schema、ID、name、type、enabled、schedule、misfire policy and policy; Armed、timestamps、History、metrics、runtime/safety state and per-Job reserve were absent. After import, the diagnostic contained the same portable Job values exactly, with `armed=false` and runtime `disabled / not-armed`. Scheduler remained paused/live-disabled; global reserve remained 1,092,184; History and Summary remained 18 Runs with the same latest Run and all Buy/Listing counters unchanged. Lease and Coordinator were empty and Circuit was closed. This closes TS6.2 without an EA request or Trade History mutation.

Next: Proceed to TS6.3 Provider health and cache management UI. Keep cache actions read-only or explicit invalidation only; they must not trigger a market search, Buy, Listing or broaden the TS5 execution gate.

### 2026-08-10 / TS6.3 / Provider health and cache management

Status: Complete for read-only health inspection and explicit Player Catalog invalidation; no Trade execution policy changed.

Health contract: FUTNext Player Catalog and FUT.GG/FUTNext Price Quote providers expose `inspect()` snapshots that never call HTTP or the EA Adapter. Snapshots contain only schema/capture time、fresh/partial/stale/empty state、TTL timestamps、lane/entry/definition aggregate counts、source/platform counts and one truncated allowlisted last-load summary. Definition IDs、prices、URLs and raw errors are excluded. Player Catalog health reads the normalized persisted cache; Price Quote health reads the current page's in-memory cache.

UI/diagnostics: Trade Scheduler adds a responsive `Providers` tab with separate Player Catalog and Price Quote status, cache counts, freshness and last-load time. Scheduler diagnostics include the same aggregate `providers` object. Empty caches disable their clear action.

Invalidation: `Clear player catalog` and `Clear price quotes` first call the Job Store atomic `relock()`, then remove only the selected cache and render a fresh health snapshot. The action disarms every Job even when the Scheduler was already paused, because a later execution must be reauthorized against the new cache state. It does not call a Provider load, EA market search, Buy/Listing mutation, History write or metrics/reserve update.

Tests: Provider tests prove inspect-before-load causes zero requests, fresh-to-stale TTL classification, aggregate source/platform counts, identifier/price omission and explicit clear state. UI tests cover responsive health rendering, empty-cache button state and clear callbacks. Existing Store relock tests lock the atomic pause/live-off/disarm behavior.

Boundary: TS6.3 does not add provider probing, automatic refresh, cache warmup or execution fallback. TS5 Buy and Listing mutation gates remain unchanged.

Automated evidence: `npm run verify` passes on `0.7.48` with 151 test files and 917 tests. Syntax, ESLint, config/Profile validation, architecture audit, FSU patch replay, all unit/contract/workflow tests, userscript build, dist equality and FSU release assets pass. Provider-specific coverage is in `tests/unit/trade-player-catalog.test.js`, `tests/unit/trade-price-quotes.test.js` and `tests/unit/trade-scheduler-dialog.test.js`.

Live procedure: Install `0.7.48`. Do not open Buy Preview or Listing Preview, Arm a Job, enable live execution or start a Loop. Open `Trade Scheduler -> Providers`, inspect both provider panels and immediately save Scheduler diagnostics. Confirm that merely opening Providers did not add History, change Summary totals, acquire a Lease/Coordinator operation or trigger Trade activity. If Player Catalog is non-empty, select `Clear player catalog` exactly once, do not run anything, and save a second Scheduler diagnostic. Price Quote cache is page-memory-only and may already be empty after reload; a disabled clear button is expected in that case.

Expected after explicit clear: Player Catalog reports `empty`; Scheduler is paused with live execution disabled; every Job is unarmed; History remains 18; Summary total remains 18; global reserve remains 1,092,184; Lease and Coordinator are idle; Circuit is closed; and no new Trade History receipt exists. The first diagnostic proves read-only inspection, while the optional second diagnostic proves fail-closed cache invalidation.

Live validation (`0.7.48`): Artifacts `trade-scheduler-diagnostics-2026-08-10T16-02-04-869Z.json` and `trade-scheduler-diagnostics-2026-08-10T16-03-04-808Z.json`. The first export inspected a fresh persisted Player Catalog with one fresh lane and 50 aggregate definitions; Price Quotes was empty after page reload. Both providers reported `loadCount=0` and no last load, proving that opening Providers and exporting diagnostics did not initiate provider HTTP work. After one explicit `Clear player catalog`, the second export reported zero lanes/definitions and `status=empty`, with the clear timestamp recorded and `loadCount` still zero. Across both exports, History remained 18 with the same latest Run, aggregate Summary remained 18 with every counter unchanged, global reserve remained 1,092,184, the sole Job stayed unarmed, Scheduler stayed paused/live-disabled, Lease and Coordinator were idle, all Runner/Trade operation flags were false, and Circuit remained closed. No Trade History receipt or EA mutation was added. This closes the TS6.3 inspection and fail-closed invalidation gates.

### 2026-08-11 / TS6.4 / Companion Extension evaluation

Decision: Defer implementation. A Companion could use `chrome.alarms` to notify the user, focus/open the EA Web App and ask an already logged-in page to reevaluate due Jobs. It cannot safely trade from a Service Worker, preserve an EA session, bypass browser background throttling guarantees or recover an ambiguous mutation. The existing in-page absolute-time wakeups already cover startup、interval、focus、online and visibility while the EA page exists.

Rationale: A separate extension would add host permissions、a second release/update channel、cross-context authentication boundaries、message validation and another persistent state owner without widening the safe execution boundary. The current guarded once/one-card workloads do not justify that cost. Reconsider only after recurring schedules are independently designed and validated, and only when the requirement is notification/open-tab rather than unattended execution.

Boundary: No Companion code, permissions or background credential handling are added. Recurring/range/bulk Buy, broader Listing and automatic provider refresh remain outside the validated production boundary.

Next: Prepare the TS4-TS6 implementation as one reviewable commit set and release candidate without broadening any live execution gate.

### 2026-08-11 / TS6.5 / Shared request budget and fair dispatch

Status: Implementation, automated validation and read-only live validation complete; guarded production execution boundaries unchanged.

Implementation: 所有七类 EA Trade 网络调用统一在 EA Trade Adapter 取得请求许可，包括价格限制、挂牌、Transfer 刷新、市场搜索、Buy、购买后刷新和购买后路由。预算固定为跨标签页共享的 5 分钟 30 次滑动窗口；支持 Web Locks 时，读取、占用和释放均在独占锁内完成。Local repository/capability inspect 与 FUTNext/FUT.GG Provider HTTP 不计入该预算。UI 和 diagnostics 仅显示聚合使用量、剩余量、动作计数、恢复时间及锁支持状态，不提供清空或提高上限入口。

Transaction reservation: 单卡 Buy/Listing 在进入 mutation 事务前必须原子占用 12 个请求槽。事务 Adapter 只能消费自身 reservation；其它标签页不能占用这些槽，事务结束后只释放未使用槽，已经转化为真实 EA 请求的槽继续计入窗口。页面崩溃遗留的 reservation 最迟随 5 分钟窗口到期。容量不足进入 `trade-request-budget-insufficient`，不计为 EA Circuit failure。

Fair dispatch: Scheduler 会评估全部到期候选；Buy 与 Listing 同时到期时优先选择与上次实际 dispatch 不同的类型，同类型内按最早 `nextRunAt`、再按稳定 Job ID 排序。只有取得 lease 并通过过期 lease 恢复门禁后才记录 dispatch；misfire、waiting、cooldown 和 lease 获取失败均不改变公平状态。Job Store schema 3 只持久化最后 Job ID/type/time 和累计 dispatch 次数，状态保持有界。

Boundary: 公平选择核心不允许绕过 `selectGuardedScheduledTradeJob()`。生产 UI 仍要求恰好一个 enabled+armed Job，执行器仍仅接受已验证的 once/one-card Listing 或 once/single-rating/one-card Rare Gold Buy，并在启动时立即 relock。Recurring、rating range、quantity > 1、其它 card class、更高价格/预算、Bulk Buy/Listing 和自动改价均未开放。

Automated evidence: 请求预算覆盖滑动窗口、Web Lock 串行化、原子 reservation、跨调用方隔离、scoped 消费、未使用槽释放、已发送请求保留、崩溃后过期恢复和容量恢复时间。Scheduler/Job Store 覆盖 schema migration、公平交替、稳定排序、cooldown 不 dispatch，以及 scheduled Buy/Listing 在事务前 reserve 并在退出时 release。`npm run verify` 通过：152 个测试文件、938 项测试，syntax、ESLint、配置/Profile、架构、FSU patch、userscript 构建、dist equality 和 FSU release 检查全部成功。

Live validation (`0.7.49`): Artifacts `trade-scheduler-diagnostics-2026-08-11T00-36-02-194Z.json`, `trade-listing-diagnostics-2026-08-11T00-41-47-157Z.json` and `trade-scheduler-diagnostics-2026-08-11T00-41-55-061Z.json`. The baseline export reported `limit=30`, `windowMs=300000`, `used=0`, `remaining=30`, single-card reserve required 12/ready and Web Lock support. A manual Club common-Gold Listing was then prepared without entering `LIST 1` or invoking `list()`: it refreshed Transfer once, loaded EA price limits once and produced a ready one-card plan, while Listing receipt and error remained null. The second Scheduler export attributed exactly two requests as `transfer-refresh:1` and `price-limits:1`, leaving 28 slots and single-card reserve ready. Coins remained 1,213,094 and Transfer usage remained 24/100. History and aggregate Summary remained 18, dispatch remained 0, Scheduler remained paused/live-disabled, no Lease or Runner/Trade operation existed, and Circuit remained closed. The newly created manual Listing Job was armed but could not execute while paused/live-disabled. The exports contained no authorization/cookie/token, URL, lease token, reservation ID or raw request-event list. This validates real Adapter accounting, cross-dialog persistence and sanitized diagnostics without an EA mutation.

Next: 先发布并观察真实页面中的预算聚合和 cooldown 诊断。任何 recurring、multi-job 或 bulk 工作必须另立门禁，不得把本阶段的公平调度测试当作生产授权。

### 2026-08-11 / TS6.6 / Manual Job scheduling-state hardening

Status: Implementation, automated validation and live validation complete; broader production automation remains locked.

Issue: The read-only TS6.5 validation exposed a manual Listing Job with `armed=true`, runtime `waiting-time` and `nextRunAt=null`. It could not execute while Scheduler was paused/live-disabled, but the contradictory state could occupy the one-armed production gate and mislead diagnostics.

Implementation: Trade Job normalization now forces every `schedule.type=manual` Job to `armed=false`, direct validation rejects an armed manual envelope, and runtime creation/evaluation reports `disabled / manual-only`. Job Store loading repairs a retained legacy manual runtime to `disabled / manual-only` with no pending time while preserving its historical runtime fields. The guarded scheduled selector ignores a legacy armed manual entry, and the Job editor disables Armed for Manual schedules and clears it when a scheduled draft changes back to Manual. Coordinator diagnostics also suppress legacy external operation `type/reason` whenever `busy=false`, so an idle bridge cannot retain `runner-operation-active` text.

Boundary: Manual Listing and Buy still use their existing `Run now` Preview/Prepare/exact-confirmation gates. Once/Daily/Interval/Window normalization and the guarded once/one-card production gate are unchanged. No EA request, mutation, recurring execution, multi-Job execution or bulk policy is added.

Automated evidence: Contract, Job Store migration, schedule evaluation, guarded selector, dialog and Coordinator tests cover the invariant, legacy repair and idle external-state sanitization. Full repository verification is required for candidate `0.7.51` before the final diagnostics-only retest.

Live validation: Artifact `trade-scheduler-diagnostics-2026-08-11T01-44-42-236Z.json` on `0.7.50` proved the retained manual Listing Job `listing-1786408835948` migrated from `armed=true / waiting-time` to `armed=false / disabled / manual-only` with `nextRunAt=null`; the separate once Buy Job remained unarmed and disabled. Scheduler remained paused/live-disabled with zero armed Jobs, History and aggregate Summary remained 18, dispatch remained 0, request budget reported 0/30 used with no actions, Lease and all Runner/Trade operation flags were idle, and Circuit remained closed. The follow-up `0.7.51` artifact `trade-scheduler-diagnostics-2026-08-11T01-51-07-366Z.json` reported `coordinator.external={busy:false,type:null,reason:null}` with the same zero-request, zero-dispatch, paused and closed-circuit state. No credential, URL, lease token or reservation ID was exported. This closes TS6.6 without enabling any additional Trade execution.

### 2026-08-11 / TS7.1 / Transfer Listing read-only observation

Status: Implemented and covered by focused automated tests. Live Transfer observation is required before any Transfer mutation is considered.

Purpose: Collect real EA shapes for Transfer items in `active`, `inactive`, `closed` and `unknown` states without widening the production Listing gate. This stage is observation-only; it does not implement reprice, bulk Listing or recurring execution.

Implementation:

- Listing Preview now accepts `club`, `transfer` or `club + transfer` sources and preserves the selected source list in the Preview Job and diagnostics.
- `expiredPolicy=skip` rejects Transfer candidates whose EA auction state is `inactive` with `expired-trade-skipped`. `expiredPolicy=reprice` keeps those candidates in the read-only plan so their identity, state and pricing shape can be reviewed.
- `active` Transfer candidates remain rejected as `active-trade`, and `closed`/`unknown` states retain their existing fail-closed rejection behavior.
- Preview rejection samples now retain only a bounded, allowlisted auction snapshot: normalized state, state source, primitive EA state, the three boolean state signals, tradeId and numeric price/time fields. Raw EA auction objects and methods are never exported.
- The UI exposes source and expired-item choices, but disables Prepare for Transfer and mixed-source drafts. The Prepare callback repeats the Club-only gate, so a synthetic or stale click cannot call the live preparation path.
- `createManualListingJob()` remains Club-only, skips expired items and limits live work to one item. Transfer support exists only in `createManualListingPreviewJob()`; no `list()` call, confirmation token or Listing receipt is produced by Preview.

Boundary: This stage does not add Transfer reprice, moving Club items, bulk Listing, multiple production Jobs, scheduled Transfer work or automatic market-price mutation. The next evidence must be a saved Transfer-only Preview diagnostic with no Prepare, confirmation or receipt fields populated. Only after the EA state shapes and stale/expired behavior are understood should a separate design for Transfer mutation be proposed.

Automated evidence: Manual Listing tests verify that the live factory strips Transfer/reprice settings while the Preview factory preserves them. Listing-plan tests verify expired Transfer skip/reprice and unconditional active-trade rejection. Dialog tests verify Transfer Preview, disabled Prepare, synthetic-click fail-closed behavior, diagnostic Job preservation and switching back to Club. Adapter tests verify the allowlisted auction-state signals, observed `expired` mapping and no raw EA object leakage. Full `npm run verify` is required for the `0.7.54` correction candidate.

Live finding and correction: `0.7.52` artifact `trade-listing-diagnostics-2026-08-11T02-12-16-979Z.json` scanned all 14 Transfer items but rejected every item as `unknown-trade-state`; the first diagnostic schema did not preserve enough state evidence. `0.7.53` artifact `trade-listing-diagnostics-2026-08-11T02-22-16-794Z.json` again scanned all 14 without Prepare or receipt and proved a single consistent EA shape: primitive `tradeState="expired"`, all three legacy boolean methods false, valid tradeId/prices and `expires=-1`. The Adapter now maps only the observed primitive `expired` value to normalized `inactive`; unknown primitive values remain fail-closed. `expiredPolicy=skip` therefore rejects these items, while `expiredPolicy=reprice` may include them in Preview. Transfer Prepare and all Transfer mutation remain disabled. The correction candidate is `0.7.54`.

Live validation (`0.7.54`): Artifact `trade-listing-diagnostics-2026-08-11T02-34-21-845Z.json` scanned all 14 Transfer items with `expiredPolicy=reprice`. Nine Rare Gold players in the configured 75-85 range were eligible, one was selected and eight were deferred by the one-item limit. The selected Kim Little item was normalized to `auctionState=inactive`; the other five items were rejected only as `rating-rule-mismatch`, and `unknown-trade-state` disappeared completely. The Preview remained read-only: operation flags were false, the Job was manual and unarmed, and Prepared, Club validation, receipt and error were all null. The circuit remained closed. This closes TS7.1 state observation and primitive `expired` mapping without enabling Transfer mutation.

### 2026-08-11 / TS7.2 / Guarded single-item Transfer reprice

Status: Implementation, automated validation and one-card live mutation validation complete. Broader Transfer automation remains locked.

Implementation:

- A separate manual factory creates exactly one Transfer-only Job with `expiredPolicy=reprice`, manual schedule and `armed=false`. The existing live Club factory remains Club-only with `expiredPolicy=skip`.
- Listing Preparation refreshes Transfer before scanning either Club or Transfer sources, then resolves one exact item and refreshes its EA price limits. A Transfer plan produces the distinct confirmation text `REPRICE 1`; Club remains `LIST 1`.
- Immediately before mutation, the transaction refreshes Transfer again, resolves the same item ID/definition ID/pile and reruns eligibility. The item must still be `inactive`; Active, Closed, unknown, moved, missing or changed items stop before `list()`.
- The existing single-entity `service.list(item, startPrice, buyNow, duration)` Adapter path is reused. The implementation never calls the bulk `relistExpiredAuctions()` method. After an accepted request, Transfer is refreshed and the same item must be Active at the exact confirmed prices or the receipt becomes ambiguous.
- The operation Coordinator, 12-request transaction reservation, Circuit, Stop handling, exact confirmation and History/diagnostic paths are unchanged. Transfer reprice does not consume an additional Transfer slot.

Boundary: Only Manual + Transfer-only + expired reprice + one item is admitted. Mixed sources, `expiredPolicy=skip`, multiple items, Scheduled Transfer, recurring Jobs and bulk relist remain blocked. The Scheduled Listing selector and executor still require and force Club-only.

Automated evidence: Manual factory, Preparation, Transaction and dialog tests cover the separate reprice Job, Transfer refresh before scan and before mutation, `REPRICE 1`, exact inactive identity, Active stale-state rejection, post-list Active reconciliation, unchanged Transfer capacity and disabled mixed/skip UI paths. Club Listing and Scheduled Club gates remain covered. Full `npm run verify` is required for candidate `0.7.57`.

First live procedure: Install `0.7.57`, keep the Scheduler paused/live-disabled, select Transfer-only with `Include expired in Preview`, use one low-value rating/price rule and click `Prepare reprice` once. Do not type `REPRICE 1` and do not click Reprice item. Save Listing diagnostics immediately. The artifact must show one Prepared inactive Transfer entry, a completed Transfer preflight, loaded price limits, confirmation metadata without its token, no receipt, no active operation and a closed Circuit. Only after reviewing that artifact may the one-card mutation be attempted.

Prepare-only live validation (`0.7.55`): Artifact `trade-listing-diagnostics-2026-08-11T03-08-54-338Z.json` selected the same Transfer item `914773859871` / definition `245872` (`Kim Little`) after a successful Transfer refresh. The Prepared plan contained exactly one `inactive` entry and price-limit refresh returned HTTP 200 with EA `_itemPriceLimits.minimum=700` and `maximum=10000`. At this stage the Runner incorrectly treated `minimum` as a common floor and prepared 700/700; confirmation was sanitized to `REPRICE 1`. The Job remained manual/unarmed, operation flags were false, receipt and error were null, and Circuit remained closed, so the read-only gate passed while the price semantics still required live clarification.

Live mutation validation and price-floor correction (`0.7.55` -> `0.7.56`): Artifact `trade-listing-diagnostics-2026-08-11T03-36-45-677Z.json` exposed the EA price-limit semantic error. EA's `_itemPriceLimits.minimum` is the Bid minimum; the Buy Now minimum is the next legal EA price step. For this item the floors were therefore 700 Bid and 750 Buy Now, so the prepared 700/700 request placed Buy Now below its floor and EA rejected `list()` with HTTP 400. Artifact `trade-listing-diagnostics-2026-08-11T03-37-31-443Z.json` then repriced the same item at 1700/1800 successfully: EA returned HTTP 200, the post-list Transfer refresh resolved the same item as `active` with tradeId `607316016267`, exact 1700/1800 prices and 3598 seconds remaining, Transfer capacity was unchanged and Circuit stayed closed. This validates the guarded single-card Transfer mutation path.

Correction and follow-up evidence: `0.7.57` explicitly models `bidMinimum=minimum` and derives `buyNowMinimum` as the next legal EA price step. With `one-step-below`, floors 650/700 preserve 650/700, while floors 700/750 adjust a configured 650/700 pair to 700/750. `startPricePolicy=same` preserves equal actual prices only after both reach the Buy Now floor; if no valid Buy Now price fits below EA's maximum, Prepare fails closed with `price-limits-no-valid-buy-now`. Prepared diagnostics retain both derived floors alongside EA's original minimum/maximum. Artifact `trade-listing-diagnostics-2026-08-11T04-18-14-770Z.json` on `0.7.56` successfully repriced one item at 700/750 with EA Bid minimum 650, and post-list verification found the exact item Active at those prices. Artifact `trade-listing-diagnostics-2026-08-11T04-21-38-876Z.json` then configured Buy Now 700 against the same 650 Bid / 700 Buy Now floors and correctly prepared 650/700 without executing a mutation. Manual one-card Transfer reprice is live-validated, but mixed sources, multiple items, Scheduled Transfer, recurring Jobs and bulk relist remain blocked.

### 2026-08-11 / TS7.3 / Scheduled Transfer reprice offline gate

Status: Offline implementation complete; production Scheduled Transfer mutation remains disabled.

Implementation:

- Scheduled Listing inspection now distinguishes `club-listing` from `transfer-reprice` and returns a mode-specific confirmation. Transfer requires exactly one source, `expiredPolicy=reprice`, `once`, `maxListings=1`, and the separate `scheduledTransferRepriceEnabled` gate.
- The offline executor preserves Transfer as the source, uses `REPRICE 1` for the prepared transaction and skips FSU targeted Club validation for Transfer items. It still relocks before every attempt, uses the shared request reservation, refreshes/reconciles through the existing transaction and never calls `relistExpiredAuctions()`.
- Production entry, scheduler selection, Scheduler UI and diagnostics pass `scheduledTransferRepriceEnabled=false`. An armed Transfer Job therefore remains blocked before Prepare with `scheduled-transfer-reprice-validation-gate-disabled`; Club scheduled Listing behavior is unchanged.

Boundary: No Scheduled Transfer request, mutation, multi-item execution, mixed-source execution, recurring schedule or bulk relist is enabled by TS7.3. The offline true-gate tests are authorization-shape tests only and are not live approval.

Automated evidence: Scheduled selector tests cover disabled/enabled gate, exact `RUN REPRICE ONCE 1` confirmation, explicit reprice requirement and single-source restriction. Executor tests cover Transfer preparation, preserved Transfer policy, no Club FSU validation and exact `REPRICE 1` transaction handoff. Existing Club scheduled Listing, Scheduler UI and production gate tests remain green.

First production-gate evidence (`0.7.58`): Artifact `trade-scheduler-diagnostics-2026-08-11T04-58-06-527Z.json` contained one enabled and armed once Transfer-only reprice Job with `maxListings=1`. It confirmed `validationGates.scheduledTransferReprice=false`, Scheduler paused/live-disabled, request budget unused, no Lease, no Coordinator operation, no receipt and run count zero. The artifact did not serialize the selector result, so it proved zero side effects but could not identify the exact rejecting branch.

Diagnostic follow-up (`0.7.59`): Scheduler diagnostics now include a sanitized `schedulerRuntime.selection` summary with ready state, reason, Job ID/type and non-secret required text. Install `0.7.59`, keep the same Job armed and the Scheduler paused/live-disabled, then save diagnostics again. Expected: `validationGates.scheduledTransferReprice=false`, `selection.reason=scheduled-transfer-reprice-validation-gate-disabled`, no request budget change, no Lease/Coordinator activity and no Trade receipt. Do not attempt to bypass the disabled UI or call `RUN REPRICE ONCE 1`.

Second production-gate evidence (`0.7.59`): Artifact `trade-scheduler-diagnostics-2026-08-11T05-12-31-076Z.json` recorded the exact disabled selector branch for one armed Transfer-only reprice Job: `selection.ready=false`, `selection.reason=scheduled-transfer-reprice-validation-gate-disabled`, and `requiredText=null`. Scheduler and live execution were disabled, request budget remained unused, Lease and Coordinator were empty, no listing operation or Prepared state existed, run count stayed zero and Circuit remained closed. This completes the production fail-closed evidence.

### 2026-08-11 / TS7.4 / Scheduled Transfer one-card live candidate

Status: Implementation, automated validation and one-card live mutation validation complete.

Implementation:

- The separate production `scheduledTransferRepriceEnabled` gate is enabled after the TS7.3 disabled-gate evidence. The shared selector, UI, enable API and executor now admit only the already validated Transfer reprice shape.
- Enabling still requires one enabled and armed Job, `once`, Transfer-only, `expiredPolicy=reprice`, `maxListings=1`, a run time between 15 seconds and 15 minutes in the future, a closed Circuit, an idle Coordinator and exact `RUN REPRICE ONCE 1` input.
- When due, the executor relocks and disarms the Scheduler before Prepare, preserves Transfer/reprice policy, uses the existing single-card `REPRICE 1` transaction, refreshes the exact Transfer item before mutation and verifies the same item Active at exact prices afterward. Completion leaves live execution disabled and the Job unable to repeat.

Boundary: Installing this candidate does not execute an existing Job because persisted live execution remains disabled and the UI requires a fresh exact confirmation. Mixed sources, multiple cards, interval/daily/window schedules, bulk relist and `relistExpiredAuctions()` remain blocked.

Automated evidence: Selector summary tests cover both disabled and enabled gates. Scheduler UI tests require exact `RUN REPRICE ONCE 1`. The integrated Scheduler test executes one mocked Transfer reprice, verifies Transfer/reprice policy and transaction confirmation, then proves paused/live-disabled/disarmed state, one History receipt and no second transaction.

First live procedure: Install `0.7.60`. Edit or create one low-value Transfer-only reprice Job with `maxListings=1`, schedule it 2-5 minutes in the future, enable and arm it, and keep `grace-window` at no more than 15 minutes. Type exact `RUN REPRICE ONCE 1` and click `Enable one-card schedule` once. Do not run another Loop or Trade action until it finishes. Save Scheduler diagnostics immediately after the scheduled time, whether it succeeds or blocks.

Live validation: Artifact `trade-scheduler-diagnostics-2026-08-11T05-22-01-641Z.json` on `0.7.60` completed exactly one scheduled Transfer reprice. Job `listing-1786425581847` was due at `1786425660000` and started 4.459 seconds later. Prepare refreshed Transfer, scanned 16 items and selected one normalized inactive Rare Gold item `913466897671` / definition `50590559` (`Toluwalase Arokodare`). Refreshed EA price limits were Bid 650 and Buy Now 700; the transaction listed the same item at 650/700 for one hour, EA returned HTTP 200, and post-list refresh resolved the same item as Active with tradeId `607318372393`, exact prices and 3599 seconds remaining.

The Scheduler recorded one completed History receipt with requested 1, succeeded 1 and failed 0. Request budget accounted for exactly six calls: three Transfer refreshes, two price-limit requests and one list mutation. Execution then left the Scheduler paused, live execution disabled, the Job disarmed, `nextRunAt=null`, `runCount=1`, no Lease or Coordinator operation, and a closed Circuit. Later ticks remained paused and did not repeat the transaction. This closes the guarded once/one-card Scheduled Transfer reprice path.

Next: Preserve `maxListings=1` and `once` for the production scheduler until a separate bounded multi-item design is reviewed. The safest expansion order is manual bounded multi-item Listing/reprice first, then one-time scheduled bounded work, and recurring schedules last. Mixed Club/Transfer sources and `relistExpiredAuctions()` remain out of scope throughout.

### 2026-08-11 / TS8 / Bounded two-item Trade candidate

Status: Complete in candidate `0.7.70`. Implementation、full automated validation and all six ordered two-item EA live scenarios passed.

Scope:

- Manual Listing/reprice accepts one source and at most two cards. Club requires `expiredPolicy=skip`; Transfer requires `expiredPolicy=reprice`. Mixed sources remain Preview-only.
- Once-scheduled Listing/reprice accepts the same two source-specific modes with `maxListings=1..2`. Daily, interval, window, next-login and more than one armed Job remain blocked.
- Manual and once-scheduled Buy remain Rare Gold only, accept one rating or two adjacent ratings, and cap quantity at two. Per-card price remains at most 2000, total budget at most 4000, and scheduled Buy still requires an explicit retained-coins floor.
- `relistExpiredAuctions()` is never called. Buy still searches one exact rating and one definition per request and buys at most one card from a response.

Persistence and recovery:

- Listing now has a GM-backed bounded Journal; Buy Journal schema records the same two-item state shape. Each item retains Prepare/search, exact sanitized identity, mutation boundary, allowlisted response summary, reconciliation and terminal state.
- Manual Listing now uses the shared cross-tab Lease during execution. Scheduled Listing and Buy continue using the Scheduler-owned Lease. Every Listing and Buy mutation heartbeats immediately before the EA write.
- A browser termination before a mutation boundary may be reconciled as a blocked Run. Once any item crossed a mutation boundary, an active or uncertain Journal blocks all later Runs and prevents automatic retry. A first-item success remains visible when the second item fails, is stopped or becomes ambiguous.
- Diagnostics export only item/definition/trade IDs, pile, prices, primitive response status/code and bounded phases. Tokens, cookies, reservation IDs, raw EA objects and response bodies are excluded.

Request budget:

- Listing reserves atomically before Prepare and shares the reservation through Transaction. The two-item worst case is 11 EA calls, retained under a 12-slot reservation.
- Buy reserves the bounded worst case, including repeated empty searches and broad ambiguity reconciliation: 14 slots for one item and 28 for two. Unused slots are released. A two-item Buy therefore starts only when nearly the full 30-request window is available.

Automated exit criteria:

- Two-item Listing success, Stop between items, first success plus uncertain second item, per-item journal boundaries and no retry after ambiguity.
- Two adjacent Buy lanes with quantity two, first success plus uncertain second item, retained-coins floor, total budget, destination routing, two-attempt cap and 28-slot reservation.
- Once Scheduler relocks/disarms before Prepare, validates every provisional FSU Club candidate, dispatches only once and leaves recurring/mixed/third-item paths fail-closed.
- Full repository syntax, lint, architecture, unit, build and distribution verification must pass before assigning the candidate version.

Automated evidence: All 41 focused Trade test files and 250 Trade tests pass. Full `npm run verify` passes with 153 test files and 983 tests, 325 JavaScript files syntax-checked, plus ESLint, config/Profile validation, architecture audit, FSU patch replay, userscript build, root/dist equality and FSU release asset checks. Candidate version: `0.7.70`.

Ordered live-validation campaign:

1. Install the final candidate, leave Scheduler paused/live-disabled, save baseline Scheduler diagnostics and confirm Circuit closed, Lease empty and request budget at 30/30.
2. Prepare two low-value Club cards without confirmation. Save Listing diagnostics and verify two Prepared items, sanitized Journal entries, one shared reservation and no Listing receipt. After review, enter `LIST 2` once. Stop and export immediately on any blocked/ambiguous result.
3. Prepare two inactive low-value Transfer cards and repeat the same review before entering `REPRICE 2`. Verify both exact items become Active at their confirmed prices and Transfer capacity does not increase.
4. Create a manual Rare Gold Buy Job for adjacent ratings such as 84-85, quantity 2, per-rating limits at or below 2000 and total budget at or below 4000. Run Preview, enter `BUY 2 MAX <max>` once, then export Buy and Scheduler diagnostics.
5. Create one once-scheduled dual Club Listing and validate `RUN ONCE 2`; after completion verify paused/live-disabled/disarmed, one History Run and no repeat tick. Repeat with Transfer-only reprice and `RUN REPRICE ONCE 2` only if two suitable inactive low-value items exist.
6. Create one once-scheduled adjacent-rating quantity-two Buy with an explicit retained-coins floor. Enable it with `RUN BUY ONCE 2 RESERVE <floor>`, then verify at most two Buy attempts, floor preservation, one History Run and no repeat tick.
7. Export all diagnostics before reload. If any step is blocked, ambiguous, crashes the page or produces an identity/price/destination mismatch, stop the campaign immediately and do not retry from the same page.

Live evidence: The six artifacts captured from 07:20 through 09:00 on 2026-08-11 completed in the required order. Manual Club Listing listed two items at 650/700; manual Transfer reprice relisted two inactive items at 650/700 without consuming Transfer capacity; manual Buy completed two 800 purchases across the configured 84-85 lanes and routed one duplicate to Transfer and one item to Club. The three `once` Jobs then completed two-item Club Listing、Transfer reprice and Buy exactly once, automatically relocked/disarmed, persisted one matching History Run each and remained paused on later ticks. Every terminal Journal is `completed / receipt-recorded`, all item mutation boundaries reconciled, Circuit remained closed, and no active Lease/Coordinator state remained.

The scheduled Buy searched both adjacent lanes, recorded two empty 85 searches and bought two 84 items. This is expected: adjacent lanes define the eligible and rotating search range, not a one-card-per-rating quota. Its 1600 receipt spend and 982 net coin decrease differ because a concurrent 650 sale contributed the expected post-tax 618; exact purchased item/trade reconciliation and the 1092184 retained floor both passed. Diagnostics prove the persisted Scheduler/History state and later no-repeat ticks. They cannot by themselves prove whether the operator kept the same dialog DOM open, so the separate in-place UI refresh remains an observational browser check rather than a Trade mutation blocker.

Still out of scope: recurring work, mixed Club/Transfer execution, quantity above two, non-adjacent or three-rating Buy, non-Rare-Gold Buy, price/budget cap increases, automatic Journal acknowledgement, unattended browser startup and bulk relist APIs.

### 2026-08-11 / Roadmap / TS9-TS15 finite production plan

Status: Complete for roadmap definition; no TS9+ implementation or production gate is approved.

Commit/Version: Documentation update on candidate `0.7.70` worktree.

Automated tests: The roadmap addition itself is documentation-only. The current TS8 candidate evidence, including the later Scheduler dialog refresh regression fix, is 41 focused Trade test files / 250 Trade tests and 153 files / 983 tests in full `npm run verify`.

Observed result: The post-TS8 work is now finite and split into TS9 bounded manual batches, TS10 recurring schedules, TS11 Buy strategy expansion, TS12 Listing/Reprice policy expansion, TS13 multi-Job long-running recovery, TS14 the final Companion decision and TS15 production release closure. Each milestone has dependencies, scope checkboxes, automated requirements, live-validation requirements, exit criteria, exclusions and a named next stage. User-operated EA validation is consolidated into three mandatory campaigns: V8, V9-12 and V13-15; the Companion campaign is optional and omitted when TS14 remains deferred.

Diagnostics: No EA request or mutation was performed.

Remaining risk: TS8 live validation is complete. TS9-TS15 remain plans only; their caps and production defaults must be resolved through O4 and O8-O15 before the corresponding implementation stage.

Next: Start TS9 bounded manual multi-item implementation while preserving the validated TS8 two-item production cap until TS9 has its own automated and live evidence.

### 2026-08-11 / TS8 / Scheduler dialog external-state refresh

Status: Implementation and focused automated validation complete; live confirmation is folded into the existing V8 scheduled scenarios.

Commit/Version: Candidate `0.7.70` worktree.

Observed issue: A guarded once Job reached its scheduled time and executed, but an already open Trade Scheduler dialog continued to show the pre-run Job/runtime state. Closing and reopening the dialog loaded the correct completed state. The Scheduler, transaction and persisted History were not reported as failed; the stale view came from the dialog retaining its initial snapshot until a local UI action called `render()`.

Implementation: The page entry now supplies a one-second refresh scheduler. The dialog reads the latest Job Store and refreshes the banner every interval, but rebuilds Jobs/Summary/History only when the persisted snapshot changes. Active Job editing and JSON import are not rebuilt, so unsaved operator input remains intact. Closing, backdrop dismissal or replacing an existing Scheduler dialog disposes the refresh timer.

Automated tests: `tests/unit/trade-scheduler-dialog.test.js` passes 19 tests. New coverage proves an external once-Job completion changes the open banner from running/enabled to paused/locked, exposes the new `listing | completed | 2/2` History without reopening, cancels the timer on close and preserves an active editor's unsaved name during refresh. All 41 focused Trade files / 250 tests pass; full `npm run verify` passes with 153 files / 983 tests, plus syntax, ESLint, architecture, build and release-asset checks.

Diagnostics: No EA request or mutation was needed for this UI fix.

Remaining risk: Real browser timer throttling may delay the one-second poll while the tab is backgrounded. Returning to the visible tab must still refresh without closing the dialog; D/E/F of V8 will provide this evidence. Polling does not alter Scheduler timing or execute Jobs.

Next: Rebuild and run full repository verification, then use the same `0.7.70` V8 campaign to confirm in-place updates during scheduled Listing, reprice and Buy.

### 2026-08-11 / TS9-TS12 / Consolidated candidate implementation

Status: Candidate implementation and local automated verification complete; V9-12 real EA campaign pending.

Commit/Version: Uncommitted candidate worktree on version `0.7.84`; no tag or release is approved before the remaining Interval evidence review.

Automated tests: Candidate `0.7.84` passes all 43 focused Trade test files and 284 Trade tests. Full `npm run verify` passes with 155 test files and 1017 tests, 330 JavaScript files syntax-checked, plus ESLint, config/Profile validation, architecture audit, FSU patch replay, userscript build, root/dist equality and FSU release asset checks. Root and dist userscripts both report `0.7.84`; FSU release assets pass at `26.09.6`.

Observed result: TS9 adds a four-item Run cap, two-item chunk cap, independent per-chunk request reservations, bounded local budget waiting, Stop between chunks and fail-closed handling for unknown or incomplete chunks. TS10 adds one armed Job with occurrence-bound authorization: daily/interval allow two confirmed Runs, once/window allow one, and edit/import/delete/expiry/exhaustion relock the Job. TS11 adds up to four contiguous Rare Gold rating lanes, per-rating quantities, an 8000 total budget cap and one Run-wide runtime deadline. TS12 adds explicit quote freshness/fallback handling, source-specific Listing/reprice, and exclusion of Buy Now above 10000 at Preview, Prepare and final pre-mutation checks. Manual and scheduled paths share the same bounded chunk core and retain partial-success Journals.

Diagnostics: Sanitized Listing/Buy Journals and exports include chunk index, offset, quantity, required/remaining budget, retry time, chunk result counts, per-rating purchases and bounded candidate/rejection counts. They do not add raw EA payloads, credentials, request reservation identifiers or confirmation tokens. No real EA request or mutation was performed during this implementation round.

Remaining risk: Naturally unavailable quotes and high-value backfill remain optional read-only observations because their release behavior is locked by automated tests. TS13 multi-Job and long-running recovery, TS14 Companion decision and TS15 release closure remain locked. Do not call `relistExpiredAuctions()` or intentionally manufacture 429/427.

Next: Proceed to TS13 multi-Job and long-running recovery design and implementation; keep all TS13 production gates disabled until its automated and live campaign requirements are met.

### 2026-08-11 / V9-12 / First live campaign and Interval terminal correction

Status: Complete on candidate `0.7.84`. Steps 1-6 passed; the Step 7 Planner defect is corrected and automatically verified. Real stale/unavailable/high-value fallback evidence remains optional.

Commit/Version: Initial live evidence came from candidate `0.7.80`; Buy follow-up evidence came from `0.7.81` and `0.7.82`; the next worktree is `0.7.83` so browser evidence can distinguish visible chunk-budget waiting and same-dialog Journal recovery.

Observed result: Manual Club Listing completed four items in two chunks. Manual Transfer reprice stopped after two verified successes and left two items unmutated. Daily executed once and relocked manually. Window execution waited behind a Loop for 75.630 seconds, executed once inside the allowed window, and did not replay after refresh. High-value Listing Preview rejected every quoted candidate above 10,000; zero selected cards was the required fail-closed result. The first multi-rating Buy used `84=1, 85=1, 86=2` instead of the planned `2/1/1` quotas and an unrealistically low 800 ceiling, so five empty searches ended safely without a Buy attempt. A second run at 2000 bought one exact 84 for 1600 and verified it in Club, then exposed an obsolete whole-Unassigned-empty gate before the next search.

Interval finding: Both authorized occurrences completed two exact Listings and no third Run occurred, but authorization exhaustion relocked the Store before the Scheduler persisted its advanced runtime. The Scheduler then overwrote that relocked snapshot with stale recurring `waiting-time/nextRunAt`. The correction now rereads the Job Store after execution, persists `completed/nextRunAt=null` when authorization has disarmed the unchanged Job, and does not restore runtime for a deleted Job or overwrite a Job whose schedule/policy changed while the Run was active. Focused regression coverage includes all three cases. The current `0.7.83` gate passes 43 Trade files / 279 Trade tests and the full 155 files / 1012 tests.

Diagnostics: The supplied step 1-7 Listing, Buy and Scheduler exports contain complete bounded receipts, journals, request-budget state and run IDs without raw credentials. Step 6 also exposed an unrelated Loop/Unassigned move failure; it does not invalidate Trade mutex evidence and remains a separate Loop investigation.

Interval terminal validation (`0.7.84`): Artifact `trade-scheduler-diagnostics-2026-08-12T02-32-18-075Z.json`. Job `Interval terminal 0.7.84` executed at scheduled times 10:17:21.897 and 10:22:21.897 local time with distinct run IDs. Both receipts completed `2/2`, failed/skipped `0/0`, and all four exact items were verified active in Transfer at Bid 650 / Buy Now 700 for one hour. Final runtime is `completed`, `reason=null`, `nextRunAt=null`, `runCount=2`; authorization is null, Job is disarmed, Scheduler is paused and live execution is locked. The export was captured 576.828 seconds after the second finish and 296.182 seconds after the hypothetical third due time; 115 subsequent interval ticks remained paused with no third Run. Lease, Coordinator and Operation were idle and the page/FSU session was ready.

Remaining risk: Quote fallback and high-value backfill remain opportunistic read-only evidence when those quote states occur naturally. They are no longer V9-12 release gates.

Buy Unassigned and materialization correction: The EA market permits another Buy while unrelated items remain Unassigned. Transaction safety is therefore scoped to the exact purchased item: each accepted Buy must reconcile its item/trade identity, route that item to Club or Transfer, and verify the exact destination before another search. Pre-existing or concurrently arriving unrelated Unassigned items no longer block the Run. Because EA may return accepted before repository materialization and an immediate refresh may return 304, reconciliation now performs at most three budgeted checks with bounded delays and scans all owned piles on the final attempt. A prior ambiguous Journal can be released only when its exact item is later observed at its recorded destination; that reconciliation never starts another Buy in the same action. Ambiguous purchase identity, failed routing, destination mismatch, Transfer capacity, retained coins, request budget and Circuit checks remain fail-closed.

Latest Buy evidence: The `0.7.82` Step 3 export first reconciled the prior exact 86 item at its recorded destination and correctly returned `buy-journal-reconciled-retry-required` without issuing a Buy. The next confirmed Run bought an 84 for 1500 and an 85 for 1300, reconciled and routed both to Club, and completed chunk 1 as `2/2`. Chunk 2 then required 28 request slots while 21 remained and entered bounded local wait until the five-minute window recovered. The operator stopped during that wait, so this is valid first-chunk and wait evidence but not a completed four-item quota run. The backend did not hang and no unrelated Unassigned gate blocked either purchase.

Buy observability correction: Candidate `0.7.83` forwards the existing Journal/checkpoint stream into the open Manual Buy dialog. It shows Preview, chunk number, market search, purchase reconciliation, routing, finished-item count, and request-budget `required/remaining/retry` progress while preserving an active Stop button. The wait countdown is local UI work and sends no EA request. When exact Journal reconciliation returns `buy-journal-reconciled-retry-required`, the same dialog now clears the confirmation and allows a separately confirmed new Run; the reconciliation click itself still cannot buy.

Completed Buy evidence: The `0.7.83` Step 3 export completed four exact purchases across two chunks with the persisted non-uniform quotas `84=1, 85=1, 86=2`. It bought 85/1100 and 84/800 into Club, waited locally for approximately 298 seconds when chunk 2 needed 28 request slots and only 21 remained, then resumed and bought two duplicate 86 cards for 1400 and 1100 into Transfer. Both chunks completed `2/2`; the final receipt is `completed`, requested/succeeded `4/4`, failed/skipped `0/0`, spent 4400, Journal `completed / receipt-recorded`, and Circuit closed. The alternate `1/1/2` quota is sufficient production evidence for the same three-lane non-uniform quota mechanism; diagnostics, Preview and execution all agree, so there is no UI-to-policy mapping discrepancy.

Listing backfill correction (`0.7.84`): Preview now prefilters and sorts candidates before building a quote pool capped at `maxListings * 4` and 16 items. It requests quotes for every unique definition in that pool, then skips high-value, stale-skip or unavailable-skip candidates while continuing until `maxListings` is filled or the pool is exhausted. Candidates outside the pool remain deferred and are never accepted through configured-price fallback without a requested quote. Diagnostics expose pool limit, size, truncation and evaluated/deferred/rejected counts. Five new regressions cover leading high-value candidates, fallback-skip discovery, the observed 9-candidate Step 7 shape and a larger truncated Club pool; the 10,000 guards at Preview, Prepare and mutation remain unchanged. The final gate passes 43 Trade files / 284 Trade tests and 155 total files / 1017 total tests.

Next: V9-12 is closed. Proceed to TS13 multi-Job, long-running recovery and the V13-15 campaign plan; do not enable multiple armed Jobs before the TS13 gates pass.

### 2026-08-12 / TS13-TS15 / Multi-Job recovery candidate

Status: Complete. Candidate implementation, full repository verification, consolidated V13-15 live campaign, tag and immutable Release are complete. TS14 Companion is explicitly deferred.

Commit/Version: Corrected candidate `0.7.91` is committed as `980d6094fdb6ce104d3f271d75babb78db7b934c` and synchronized to `origin/main`; rollback point is the verified `0.7.84` release state.

Implemented result: Job Store schema 5 and Authorization collection schema 2 support at most three independently authorized Jobs. Once/window grant one Run, daily/interval grant two Runs, authorization is consumed only by the selected Job, and all Trade writes remain serialized by Coordinator, Web Lock and persistent Lease. Due time has priority; equal due times alternate Buy/Listing with a stable Job-ID tie-break. Legacy single authorization migrates without arming or authorizing extra Jobs.

Recovery result: Unknown Buy or Listing mutation evidence globally blocks Manual and Scheduled Trade before a new mutation starts. Recovery acknowledgement requires a paused/locked Scheduler, idle Runner/Coordinator, no active Lease, exact run-specific confirmation, unchanged evidence hash and an explicit reason. It archives the Journal and writes bounded Audit/blocked History without calling EA. Expired Lease takeover is two-phase: read-only reconciliation accepts only matching terminal History with no uncertain Journal, and an unproven Lease must be acknowledged before a later Scheduler tick can clear it and acquire a new Lease.

Diagnostics and tests: Bounded Recovery Audit and run correlations connect History, Journal, Lease, Scheduler events and request-budget waits by `runId`. Fake-clock soak covers three Jobs, fairness, session/Loop/budget waiting, reload, shared Lease and independent authorization exhaustion. The `0.7.91` correction adds direct same-page and cross-tab overlapping-tick regressions: preflight cannot run without the Scheduler lock, an active Journal matching the current unexpired Lease is in-flight rather than Recovery, and another Job's authorization/armed state remains unchanged. Six focused files / 57 tests pass. Full `npm run verify` passes with 338 JavaScript files syntax-checked and 160 test files / 1055 tests, plus ESLint, config/Profile validation, architecture audit, FSU patch replay, userscript build, root/dist equality and FSU release asset checks. Root and dist userscripts both report `0.7.91`; FSU release assets remain `26.09.6`.

Live gate: Passed on `0.7.91`. The campaign covered three low-quantity Jobs, Loop mutex, background/F5 recovery, authorization exhaustion and controlled `EXPIRE LEASE 1` recovery. Natural request-budget cooldown did not occur and was not forced; automated budget and fake-clock soak tests remain authoritative for that branch.

Remaining risk: Browser background throttling remains browser-dependent. Both pre-F5 and post-F5 Runner logs are available and agree with the final diagnostics; the post-F5 log records the second Interval runs, Lease staging, acknowledgement, two-phase reconciliation and final Listing. Unknown Journal acknowledgement remains deliberately manual; automatic bid, Quick Sell, relist-all, mixed Listing sources, more than four items and more than three armed Jobs remain unsupported.

`0.7.90` canary failure: The 2026-08-12 first round enabled three Jobs and five Runs. `V13 Reprice` completed `1/1`; `V13 Buy` run `trade-1786515232458-b767858b3984e` bought one card for 900 and routed it to Transfer, with terminal Buy Journal `completed / receipt-recorded`. While that Buy was still executing, the five-second interval started an overlapping tick. Recovery and authorization preflight ran before the Scheduler Web Lock, observed the legitimate in-flight mutation Journal, misclassified it as `buy-journal-mutation-review-required`, and globally relocked all Jobs at 14:14:17. The original Buy then completed at 14:14:19. `V13 Club` never started and was disarmed; this persisted state matches the screenshot and was not a UI refresh issue. There was no EA failure or unknown mutation, and the successful Buy must not be retried for recovery.

Correction: Recovery, authorization, Circuit, Job selection, execution-result relocking and unexpected-tick relocking now all execute inside the Scheduler Web Lock. A same-page mutex rejects overlapping ticks even without Web Locks. Recovery partitions only an active Journal whose `runId` and `jobId` exactly match the current unexpired Lease as in-flight; mismatched, missing-Lease and expired-Lease unknown Journals remain fail-closed. Because the erroneous global relock cleared all authorizations, steps five/six of the failed campaign were correctly not run and the next canary must start from preparation.

`0.7.91` canary result: Prepare diagnostics at 15:27:24 contained three armed Jobs and five authorized Runs. Buy ran at 15:43:11 and 16:03:57, each purchasing one 86 Rare Gold for 900 and routing it to Transfer. Club Listing ran at 15:49:11 and 16:14:13, each listing one Common Gold at 650/700 for one hour and verifying the same item active in Transfer. Reprice was scheduled for 15:54:00, waited while the Player Pick Loop was active, then ran at 15:55:12 and verified the same inactive Transfer item active at 650/700. The page owner changed after F5 from `tab-1786519132017-8002b990356b6` to `tab-1786521462781-15aa0562aa9678`; remaining authorization and next times survived. Final state had all three Jobs disarmed, no authorization, paused/locked Scheduler, closed Circuit and no active Lease or Recovery review. Lease Recovery acknowledgement recorded evidence `12bf5b68` with zero mutation, followed by one successful authorized Club Listing. `log1.txt` and the replacement `log2.txt` cover the complete page timelines and match all seven campaign History records. The bottom-of-dialog text `Guarded schedule enabled for 1 Job(s)` was a stale local action message only; persisted state and Banner were correct, and the UI now clears stale action text on external state transitions.

Release result: local `npm run verify` passed with 338 JavaScript files, 160 test files and 1055 tests. GitHub Actions Verify passed for implementation commit `980d609` and release-preparation commit `a0ccf3a`. Annotated tag `v0.7.91` points to `a0ccf3ab3bd1a3b6ecd26ec677d651105d45f631`. The immutable Release workflow completed successfully on 2026-08-12 and published nine assets, including Runner/FSU userscripts and metadata, Profile assets and `SHA256SUMS`. The Release is the repository `latest`, downloaded metadata reports `0.7.91`, and the downloaded userscript matches its published checksum. Windows build-runner newline differences normalize to the same userscript content as the repository build.

Rollback and remaining risk: Roll back to the verified `0.7.84` behavior if a Trade regression appears, but preserve diagnostics before changing versions. Browser background throttling remains environment-dependent. Natural request-budget cooldown and quote fallback remain covered by deterministic automated tests rather than manufactured EA failures. Unsupported capabilities remain fail-closed as listed in the candidate capability matrix.

Next: v1 maintenance only. 新的确认交互、Request Pacing、秒级调度、公平时间片和 EA 原生 Re-list All 已转入独立的 [Trade Scheduler v2 设计](TRADE_SCHEDULER_V2_DESIGN_ZH.md)，不得作为隐式 TS16 修改本路线的历史结论。
