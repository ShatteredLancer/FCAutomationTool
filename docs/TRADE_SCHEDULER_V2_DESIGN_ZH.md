# Trade Scheduler v2 设计与实施跟踪

> 文档状态：V2-7 已完成，等待版本与发布决定
> 最后更新：2026-08-13
> 基线版本：`v0.7.91`
> 适用仓库：FCAutomationTool
> 实施边界：这是独立的 v2 路线，不是旧 TS0-TS15 路线的隐式 TS16

## 1. 文档目的

本文记录 Trade Scheduler v2 已确认的产品决策、运行时模型、兼容策略、实施顺序和验证门禁。旧版设计及真实页面证据继续保存在 [TRADE_SCHEDULER_DESIGN_ZH.md](TRADE_SCHEDULER_DESIGN_ZH.md)；在对应 v2 里程碑完成前，`v0.7.91` 的现有约束仍是实际运行行为。

v2 主要解决以下问题：

1. 普通操作、Job 激活和恢复操作依赖输入精确确认文本，交互成本过高。
2. 当前跨标签页共享的 `5 分钟 / 30 次` EA 请求预算会在执行前预留最坏路径，实际吞吐量过低。
3. Job 的 Interval 以分钟为最小单位，不能表达秒级交易任务。
4. Transfer Unsold Items 只能逐卡 Reprice，尚未利用 EA 原生批量重挂能力。
5. 长时间 Buy/List Run 可能长期占用执行权，不适合与短小的 Re-list All Job 公平共存。

状态只使用：

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

除纯文档里程碑外，一个里程碑只有同时满足实现、对应自动测试、完整 `npm run verify`、文档记录和规定的真实页面验证后才能标记为 `Complete`。

## 2. 调研结论

### 2.1 当前 Runner

- 请求预算固定为跨标签页共享的 5 分钟滑动窗口 30 次。
- Listing 每个两卡 chunk 至少预留 12 次请求。
- Buy 按最坏对账路径预留，单卡最多 14 次、双卡最多 28 次。
- Buy/List Job 的 Schedule 使用 `everyMinutes`，但 Job 内部已经存在秒级 `searchDelaySeconds` 和 `listingDelaySeconds`。
- EA Trade Adapter 已能发现 `relistExpiredAuctions()` capability，但 architecture test 和工程约束禁止实际调用。

### 2.2 Enhancer 26.1.6.4 参考行为

本机已安装 Enhancer 的可读实现显示：

- 市场搜索默认随机等待 `7-15` 秒。
- 每个市场搜索响应默认最多购买 1 张。
- 随机执行 `10-15` 个搜索周期后，暂停 `5-8` 秒。
- Bulk Listing 默认逐卡随机等待 `3-8` 秒。
- Enhancer 没有采用 Runner 当前的 `30/5 分钟 + 最坏情况预留`模型。
- Enhancer 的 `Re-list All` 是注入 UI，底层直接调用 EA 原生 `services.Item.relistExpiredAuctions()`。
- Enhancer 仍在页面上下文运行；关闭页面、退出登录或浏览器冻结时不能保证任务继续。

Enhancer 只作为行为参考。v2 不读取 Enhancer 私有状态，不调用 Enhancer 模块，也不依赖 Enhancer 安装。

## 3. 已确认的产品决策

### 3.1 不再要求输入任何确认文本

v2 的普通操作、定时任务激活、未知 Journal 处理、过期 Lease 处理和测试入口都不得要求用户输入 `LIST N`、`BUY N MAX ...`、`ENABLE ...`、`ACKNOWLEDGE ...` 或类似精确字符。

取消文字确认不等于取消事务保护：

- Preview、Prepared Plan、一次性执行凭据、item 身份复核、价格限制刷新、Lease、Journal、Circuit 和事后对账继续保留。
- 所有确认都使用结构化摘要和明确按钮，不能通过隐藏的通用 Resume 绕过。
- 高风险处理必须有醒目的红色标识、后果说明、处理结果选择和确认复选框。
- 界面不得默认选择会解锁未知交易状态的选项。
- 重复点击必须幂等；按钮进入执行态后立即禁用。

风险等级：

| 级别 | 示例 | 交互 |
| --- | --- | --- |
| 普通 | 只读 Preview、停止、禁用 Job | 直接按钮 |
| 注意 | Manual Buy/List/Reprice、启用一个或多个 Job | 黄色摘要、数量/价格/时间/授权范围、确认按钮 |
| 高风险 | 未知 Buy/Listing Journal、过期 Lease、Circuit 后人工恢复 | 红色摘要、固定结果选项、未默认勾选的风险复选框、红色按钮 |

未知 Journal 表示 EA mutation 可能已经被接受，但页面关闭、超时或回读失败导致 Runner 无法确定最终状态。处理流程必须先自动进行只读对账；仍无法确认时，用户可选择：

- 保持阻断，不改变状态。
- 已在 EA 页面确认交易完成。
- 已在 EA 页面确认交易未完成。
- 无法确认，但明确归档为 Unknown 并解除阻断。

后三项只归档当前证据并写入脱敏 Audit/History，不得在同一次点击中自动重试 Buy/List/Re-list。人工原因改为固定原因下拉菜单，可提供非必填备注，但不得要求输入字符才能继续。

### 3.2 Job Schedule 统一为秒

所有 Interval Schedule 的持久化单位统一为整数秒：

```json
{
  "type": "interval",
  "intervalSeconds": 300,
  "anchorAt": 1786579200000
}
```

- `intervalSeconds` 的最小表达单位为 1 秒。
- UI 可以提供 Seconds/Minutes/Hours 作为输入换算辅助，但存储、比较、诊断和调度只使用秒。
- 旧 `everyMinutes` 必须幂等迁移为 `intervalSeconds = everyMinutes * 60`。
- Once、Daily 和 Window 继续使用绝对时间/窗口字段，但所有内部延迟和容差统一使用毫秒或秒，不再混用分钟字段。
- 一个 Job 的上次 occurrence 尚未完成时，不得并发执行同一 Job；重复到期只保留一个合并后的 pending occurrence。

必须区分：

- `intervalSeconds`：一个 Job 多久触发一次。
- `searchDelaySeconds`：Buy Job 内两次市场搜索之间的等待。
- `buyDelaySeconds`：同一搜索响应内两次 Buy mutation 之间的等待。
- `listingDelaySeconds`：Club List/Transfer Reprice 内两次挂牌之间的等待。

### 3.3 动作级 Request Pacing 取代低额硬预算

v2 不再把 `5 分钟 / 30 次` 和最坏路径预留作为正常流量门禁。新的 Request Pacing 是共享执行器，不是第二套用户间隔配置。

用户配置定义期望节奏；Request Pacing 根据以下信息计算实际最早执行时间：

```text
Job 动作间隔
+ 跨 Tab 同类动作的最近时间
+ 当前 mutation 是否已完成必要对账
+ 周期暂停状态
+ 429 自适应冷却
= nextAllowedAt
```

所有 EA Trade 网络调用仍只能从 EA Trade Adapter 的白名单调用点发出，并继续经过跨标签页协调。第三方 Price Provider 和本地 inspect 不计入 EA pacing。

#### 默认值和配置范围

| 配置 | 默认值 | 初始 UI 范围 | 适用 Job |
| --- | --- | --- | --- |
| Market search delay | `7-15` 秒 | `3-300` 秒 | Buy |
| Buy delay in one response | `0-1` 秒 | `0-30` 秒 | Buy |
| Purchases per search response | `1` | `1-4` | Buy |
| Listing delay | `3-8` 秒 | `3-300` 秒 | Club List |
| Reprice delay | `3-8` 秒 | `3-300` 秒 | Transfer Reprice |
| Pause after search cycles | `10-15` 次 | 关闭或 `1-100` | Buy |
| Cycle pause duration | `5-8` 秒 | `1-600` 秒 | Buy |
| Consecutive empty search limit | 沿用现值并显式展示 | `1-100` | Buy |
| Initial 429 cooldown | `60` 秒 | `15-1800` 秒 | 全部 |
| Maximum 429 cooldown | `1800` 秒 | 不小于初始值 | 全部 |
| Maximum Job runtime | 沿用现值 | 秒级存储 | 全部 |

范围属于首轮保守边界，真实页面证据充分后才能进一步放宽。随机范围要求 `min <= max`；固定间隔使用相同的最小值和最大值。

`purchasesPerSearch > 1` 时：

- 只能使用当前 EA 搜索响应内仍然有效的候选。
- 每张卡在 Buy 前重新检查 definition、评分、卡类、Buy Now、剩余预算、保留金币、ownership、Transfer 容量和 Circuit。
- 每次 mutation 后必须完成该卡身份物化、路由和目的地确认，才能购买下一张。
- 任一 mutation 结果不明确时立即停止并废弃该搜索响应，不得继续购买或自动重试。

#### 429 与异常频率

- 429/Too Many Requests 停止当前动作，并开启跨标签页共享冷却。
- 连续 429 使用有上限的指数或阶梯退避；成功运行一段时间后再逐级恢复。
- 429 不得清空 Job、Journal 或授权，也不归类为 427 Circuit。
- `427`、Captcha、Session 失效和未知 mutation 继续 fail-closed；其中 427 和未知 mutation 不得自动 half-open。
- 可以保留只防止程序失控循环的高位紧急保护，但它不得按正常 Run 的最坏情况提前预留请求，也不得重新形成低吞吐硬预算。

`Request Pacing` UI 只显示运行状态，不重复编辑 Job 参数：

- 最近 EA 动作及时间。
- 当前生效的 Job 间隔。
- `nextAllowedAt` 倒计时及构成原因。
- 周期暂停或 429 cooldown。
- 当前持有执行权的 Tab/Job 摘要。

### 3.4 公平调度和可恢复时间片

Re-list All 只有在长时间 Buy/List Job 能主动让出执行权时才有可靠运行机会。v2 不允许一个长 Run 在等待搜索间隔时一直持有全局 Lease。

调度规则：

1. 到期 occurrence 进入有界 pending 集合；同一 Job 的多个逾期 occurrence 合并为一个。
2. 先按到期时间选择；同到期时间使用持久化轮转顺序，不能固定偏向 Buy 或 Listing。
3. 每次 dispatch 只执行一个不可分割时间片。
4. 一个时间片最多包含 2 次 mutation、30 秒活动时间或一个 Re-list All 聚合 mutation，先达到者结束。
5. 市场搜索后如果需要等待下一次搜索，必须持久化 checkpoint、释放 Lease 和执行权。
6. 已经开始的 mutation 及其必要对账不可被抢占；对账完成后才允许让出。
7. 下一轮从持久 checkpoint 恢复，不得重复已确认 mutation。
8. Scheduler/页面暂停、刷新和跨 Tab 接管后，只恢复明确 checkpoint，不补跑无界历史 occurrence。

在页面活跃、Session Ready 且没有未知交易状态的前提下，Re-list All 最迟在当前不可分割时间片结束并轮到其 pending occurrence 时执行。浏览器后台冻结、页面关闭、未登录、EA cooldown 或 Circuit 打开时不承诺实时执行。

### 3.5 EA 原生 Re-list All

新增独立 Job 类型 `bulk-relist`，调用 EA 原生 `relistExpiredAuctions()`，保留现有 Transfer Reprice。

两者语义不同：

| 功能 | Transfer Reprice | Re-list All |
| --- | --- | --- |
| 范围 | 符合筛选规则的逐卡项目 | 当前全部 Unsold Items |
| EA mutation | 每张 `list()` | 一次 `relistExpiredAuctions()` |
| 价格 | 重新计算/配置 | 保留 EA 当前拍卖价格 |
| Duration | Job 配置 | 使用 EA 重挂语义 |
| 回执 | 逐卡 | 前后快照聚合 |

Re-list All 执行流程：

1. 获取共享执行权并确认 Circuit、Session、Lease 和全局 Recovery 状态。
2. 刷新 Transfer List，记录有界的 Unsold item/trade ID、原价格和数量快照。
3. 没有 Unsold Items 时本地完成为 `skipped-empty`，不调用 mutation。
4. 调用一次 Adapter `relistExpiredAuctions()`。
5. 刷新 Transfer List并对比 Active/Unsold 状态。
6. 全部可确认时写聚合成功回执；部分可确认时写 partial；最终状态无法确认时保留 Unknown Journal 并阻止新 Trade mutation。

Journal 不保存 EA 活对象、Cookie、Token 或原始响应，只保存有界身份摘要、前后状态、数量和 mutation boundary。因为 EA 接口是聚合操作，不能伪造逐卡成功回执。

开放顺序：

1. Adapter capability 与 Fake/contract tests。
2. 只读 Preview。
3. 手动单次 Re-list All 实机验证。
4. 定时 `bulk-relist` Job。

定时 Re-list All 初始最小周期为 60 秒，UI 默认提供 1/5/10 分钟快捷值，但底层仍使用 `intervalSeconds`。真实页面验证前不得直接开放 recurring mutation。

## 4. 统一 Job 编辑器

Trade Scheduler Job 编辑器面向所有 Job。布局分成公共配置、类型配置、Schedule、Action Pace、风险摘要和运行状态，切换 Job 类型时只显示相关字段，不显示无效的禁用控件。

### 4.1 公共配置

- Job 名称、类型、Enabled。
- Once/Daily/Interval/Window。
- 开始时间、窗口和 `intervalSeconds`。
- Misfire 策略和最大运行时间。
- 429 cooldown 策略。
- Preview、Run Once、Enable/Disable、Stop。
- 最近一次结果、下一 occurrence、下一 action、当前 checkpoint。

### 4.2 类型差异

| 配置 | Buy | Club List | Transfer Reprice | Re-list All |
| --- | --- | --- | --- | --- |
| 卡片来源 | Market | Club | Transfer Unsold | 全部 Unsold |
| 评分/卡类 | 有 | 有 | 有 | 无 |
| 单次目标数量 | 有 | 有 | 有 | EA 当前全部 |
| 最大 Buy Now | 有 | 无 | 无 | 无 |
| 总预算/保留金币 | 有 | 无 | 无 | 无 |
| Market search delay | 有 | 无 | 无 | 无 |
| Buy delay | 有 | 无 | 无 | 无 |
| Purchases per response | 有 | 无 | 无 | 无 |
| 周期暂停 | 有 | 无 | 无 | 无 |
| Listing/Reprice delay | 无 | 有 | 有 | 无 |
| 固定价格/市场价策略 | 无 | 有 | 有 | 无 |
| 高价卡排除 | 无 | 有 | 有 | 无 |
| 拍卖时长 | 无 | 有 | 有 | EA 原语义 |
| 重新计算价格 | 无 | 是 | 是 | 否 |

### 4.3 运行中界面

- Job 编辑字段在运行时只读，Stop 始终可见。
- 状态栏区分 `waiting-schedule`、`waiting-turn`、`waiting-pace`、`cooldown-429`、`mutating`、`reconciling` 和 `blocked-recovery`。
- 显示下一动作倒计时，而不是只显示整个 Job 的下一次调度时间。
- 外部 Scheduler tick、跨 Tab 执行或页面恢复后，打开的 UI 必须自动刷新，但不能覆盖正在编辑的未保存表单。

## 5. 数据兼容和升级

v2 需要新的 Job Store schema。具体版本号在实现时确定，但迁移必须满足：

- `everyMinutes` 精确转换为 `intervalSeconds`。
- 缺少 pacing 字段的旧 Buy/List Job填入 v2 默认值。
- 旧 Job ID、名称、筛选、价格、History 和 metrics 保留。
- 旧 confirmation text/token 不迁移为可执行授权。
- 首次升级必须原子暂停 Scheduler、关闭 live execution 并解除全部 armed Job；用户检查新摘要后再用按钮启用。
- 导入/导出格式同步升级，旧格式可读，新格式不得降级丢失秒级或 pacing 配置。
- 迁移重复执行不得再次乘以 60 或改变已迁移值。

v2 分阶段开发期间，不允许同一运行路径同时混用旧 request reservation 和新 pacing。每个切换必须以明确的 Adapter/Transaction 边界完成，并由 architecture tests 锁定。

## 6. 实施里程碑

### V2-0 设计基线

状态：`Complete`

- 记录 Enhancer 参考行为和 EA Re-list All 调用事实。
- 确认取消全部文字确认、动作级 pacing、秒级调度、公平时间片和独立 bulk-relist Job。
- 旧版操作手册继续代表生产行为。

### V2-1 Characterization 与 schema

状态：`Complete`

- 为当前 confirmation、request budget、schedule、authorization、Journal 和 fairness 添加行为特征测试。
- 定义 v2 Job/Pacing/Checkpoint schema 和 allowlist sanitizer。
- 实现 `everyMinutes -> intervalSeconds` 幂等迁移及导入兼容。
- 暂不改变 EA mutation 行为。

实施结果（2026-08-13）：Trade Job 合同升级为 schema 2，规范 Interval 字段为 `intervalSeconds`；Trade Job 导出格式升级为 schema 2，同时继续接受 schema 1；Job Store 升级为 schema 6。旧 `everyMinutes` 只在输入兼容层读取，规范化后仅输出秒，并通过重复规范化测试确认不会再次乘以 60。旧持久 Store 第一次读取时会原子写回 schema 6，同时暂停 Scheduler、关闭 live execution、清除授权并解除全部 armed Job；第二次读取保持用户后续设置，不会重复回锁。EA Adapter、Journal、Lease、价格、数量和 mutation 流程未修改。

验证结果：全部 46 个 Trade 单元测试文件、302 项测试通过；完整 `npm run verify` 通过，包括 338 个 JavaScript 文件语法检查、160 个测试文件/1058 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和发布资产检查。该阶段无 EA 请求或真实交易写操作。

### V2-2 无文字确认 UI

状态：`Complete`

- Manual Buy/List/Reprice 改为风险摘要按钮。
- 单 Job/多 Job 激活改为摘要按钮。
- Journal、Lease、Circuit 和测试恢复入口改为高风险结构化操作。
- 保留现有 Prepared、授权 fingerprint、Recovery evidence hash 和幂等保护。

实施结果（2026-08-13）：Manual Buy、Club List、Transfer Reprice 和单/多 Job 激活均改为可见摘要加直接审批按钮，执行入口只接受结构化 `approved: true`，不再生成、显示或校验确认短语。Prepared token、当前 Job ID 集合、Lease、Journal、Circuit、目标身份、价格刷新和 mutation 后对账继续强制执行。未知 Buy/Listing Journal 与过期 Lease 改为固定处理结果、默认未勾选的风险确认和红色归档按钮；evidence hash 变化继续拒绝。Circuit 人工解锁也改为红色警示、风险确认和红色按钮，不会在解锁动作中自动重试。

验证结果：全部 46 个 Trade 单元测试文件、301 项测试通过；完整 `npm run verify` 通过，包括 338 个 JavaScript 文件语法检查、160 个测试文件/1057 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和发布资产检查。源码与 Trade 测试中不再存在旧 `confirmationText`、`requiredText` 或精确确认短语契约。

### V2-3 Request Pacing

状态：`Complete`

- 实现跨 Tab 共享动作时间、随机范围、周期暂停和状态 inspect。
- 移除正常路径的最坏情况请求预留和 `30/5 分钟`等待。
- 实现 429 自适应 cooldown；保留 427/未知 mutation Circuit。
- 支持 `purchasesPerSearch=1..4`，每张仍独立复核和对账。
- 更新诊断和 UI，不再显示 request slots。

实施结果（2026-08-13）：EA Trade Adapter、Fake Adapter、Buy/Listing Transaction 和 Scheduler 已统一接入共享 Request Pacer。Market Search、Buy、Listing 的动作间隔、Buy 每次搜索购买数量、搜索周期暂停和 429 初始/最大 cooldown 均由 Job policy 配置；Pacer 状态通过共享 storage + Web Lock 在 Tab 间同步。正常动作不再预留固定请求槽，429 只进入共享自适应 cooldown，不打开 Trade Circuit；427、Session、Captcha 和未知 mutation 仍按原 Circuit/Recovery 规则处理。

Mutation boundary 顺序已固定：Buy、Listing 和购买后路由必须先获取绑定 action 的一次性 permit，permit 获得后再次检查 Stop、Circuit 和 Lease，随后才能写入 Journal mutation boundary；Adapter 只消费匹配且未使用过的 permit，缺少、错 action 或重复 permit 均 fail-closed 且不会调用 EA。已接受 Buy/Listing 后若对账遇到 429，Run 保持 `ambiguous`，不自动重试；购买已确认但路由因 429 未执行时同样保留 Recovery 所需的未知状态。

验证结果：Trade focused/contract/architecture 测试 112 项通过；完整 `npm run verify` 通过，包括 338 个 JavaScript 文件语法检查、160 个测试文件/1055 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和发布资产检查。V2-3 尚未进行新的真实 EA 429 campaign；429 只在自然发生时收集，不主动压测 EA。

### V2-4 秒级调度与可恢复时间片

状态：`Complete`

- Scheduler 统一使用 `intervalSeconds`。
- 将长 Buy/List Run 拆成持久 checkpoint 时间片。
- 实现 pending occurrence 合并、跨类型公平轮转和无重叠恢复。
- 等待 pacing 时释放 Lease，不释放未知 mutation 的保护责任。

实施结果（2026-08-13）：Scheduler、Buy/Listing Executor 和 Chunk Coordinator 已支持秒级 pacing 的非阻塞等待。正常间隔未到时返回 `deferred`，持久化有界 continuation，状态显示 `waiting-pace` 和 `Resume` 时间，并释放全局 Lease 与 Operation Coordinator；不写 History、不推进 schedule、不重复消耗授权。恢复使用原 `runId`、`scheduledFor` 和授权 occurrence，已完成 mutation 从 cursor/summary 继续，已接受或不确定 mutation 仍保持不可抢占并继续对账。

授权改为两阶段：`beginAuthorization(jobId, runId)` 只保留 occurrence，终态才由 `completeAuthorization(jobId, runId)` 消耗。Deferred Journal 被同类型通道保留，只允许匹配的 continuation Run 恢复；其他 Run、手动操作或新的同类型 Job 均 fail-closed，不会覆盖 Journal，也不会误显示为人工 Recovery。若编辑/删除 Job、回锁或 continuation fingerprint 改变，则清除 continuation 并终止授权；若 continuation 已提前落盘而后续回调异常，Scheduler 以持久 checkpoint 为准恢复 deferred。

调度顺序按最早 due/resume 时间选择；相同时间按持久化的 Buy/Listing 类型轮转。一个 Buy continuation 等待 pacing 时，Listing 可以获得执行机会，但第二个 Buy 必须等待同类型 continuation 完成。Interval 在 continuation 等待期间经过的多个 occurrence 合并为同一个 pending occurrence，终态只增加一次 `runCount`，不会补跑历史 occurrence。

验证结果：V2-4 恢复、调度、执行器和 UI 聚焦测试 112 项通过；完整 `npm run verify` 通过，包括 338 个 JavaScript 文件语法检查、160 个测试文件/1072 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和 FSU 发布资产检查。V2-4 尚未进行新的真实 EA 页面 campaign。

### V2-5 手动 Re-list All

状态：`Complete`

- 在 EA/Fake Trade Adapter 增加唯一的 `relistExpiredAuctions()` 调用点。
- 增加只读 Preview、聚合 Journal、前后快照和 diagnostics。
- 先保持 scheduled gate 关闭。
- 完成一次空列表和一次真实 Unsold 手动验证。

实施结果（2026-08-13）：EA/Fake Trade Adapter 已增加唯一的 `relistExpiredAuctions()` 调用点，手动入口已接入 Trade Scheduler 工具栏。执行前会刷新 Transfer，保存最多 100 项的 Unsold item ID、definition ID、trade ID 和原 Bid/Buy Now 快照，并把短时一次性确认 token 绑定到完整快照 fingerprint。执行时要求 Scheduler paused/live-disabled、全局 Recovery 空闲、Operation Coordinator 和 Lease 可用；再次刷新并逐项复核快照后，只获取一个 `bulk-relist` mutation permit，并只发送一次 EA 聚合调用。

空 Unsold 会在二次刷新后以 `completed/skipped-empty` 结束，不获取 mutation permit、不调用 EA 重挂接口。非空聚合调用只有在所有 Preview item 都以同一身份出现在 Active Transfer 状态时才成功；accepted 后刷新失败、部分物化或无法确认都会把未确认项保留为 `unknown`，写聚合 Journal 并进入全局 Recovery。显式 427 会将项目记为终态 `failed` 并打开持久 Circuit，不伪造成未知结果。Journal、diagnostics、Recovery Audit、History 和过期 Lease correlation 已接通并保持有界脱敏；手动 History 在 metrics 中保留 `bulk-relist` 类型。

自动验证覆盖 EA observable 归一化、一次性 permit、唯一调用点、空列表零 mutation、快照变化阻断、完整/部分/刷新失败对账、427 Circuit、Recovery 归档、过期 Lease correlation、UI 风险确认和当时的 scheduled Job 门禁。V2-5 验收时定时 `bulk-relist` 尚不属于 `TRADE_JOB_TYPES`；该历史门禁已由后续 V2-6 候选按独立合同替换。

自动验证结果：V2-5 增强聚焦套件 16 个测试文件/119 项测试通过；最终完整 `npm run verify` 通过，包括 352 个 JavaScript 文件语法检查、167 个测试文件/1098 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和 FSU 发布资产检查。完整验证期间还发现并修正了显式 427 回执漏记聚合 `requested` 数量的问题。Re-list All 对话框层级已提高到 Scheduler 之上，并由新增 UI 回归测试锁定。

真实 EA 页面验证于 2026-08-13 完成。空 Unsold Run `manual-bulk-relist-1786609271826-e9698210401d18` 以 `completed/skipped-empty`、requested/succeeded/failed=`0/0/0` 结束，`mutationBoundaryCrossed=false`，没有调用聚合 mutation。真实 Unsold Run `manual-bulk-relist-1786614438385-9a61acb7c02ba` 一次处理 19 项，以 `completed`、requested/succeeded/failed=`19/19/0` 结束；19 个 Preview item ID 全部唯一且与回执逐项匹配，definition ID、Start Bid `1800` 和 Buy Now `1900` 保持不变，状态全部由 inactive 变为 Active，并取得新的 EA trade ID。Journal 只有一条聚合 request/accepted/reconciliation 链，History 只有一条对应终态；最终 Recovery 为空、Circuit closed、Lease/Coordinator idle。Runner log 记录 `relisted 19/19`，截图确认 19 项位于 Active Transfers 且价格一致。两项实机门禁均通过，V2-5 标记为 `Complete`。

### V2-6 定时 Re-list All

状态：`Complete`

- 增加 `bulk-relist` Job 合同、编辑器、授权和 History。
- 接入公平队列，验证长 Buy Job 下仍能获得执行机会。
- 最小 Interval 60 秒，重复到期只合并一个 occurrence。

实现结果（2026-08-13）：`bulk-relist` 已作为独立 Job 类型接入版本化合同、导入/导出、Job Store、结构化授权、Scheduler 分发和编辑器。只允许 `once/daily/interval/window`，拒绝 Manual；Interval 最小 60 秒，默认 300 秒并提供 60/300/600 秒快捷值。该 Job 没有卡类、评分、数量、报价、价格或时长设置，作用域固定为当前全部 Unsold，最多读取 100 项，并始终保留 EA 已有 Bid/Buy Now。

定时执行复用 V2-5 已验证的 Preview、完整 fingerprint、单次聚合 `relistExpiredAuctions()` mutation 和逐项 Active 对账。空 Unsold 以 `skipped-empty`、零 mutation 结束；partial、accepted 后刷新失败或未知结果继续进入全局 Recovery。Preview、执行前刷新或 mutation permit 在 mutation 前遇到正常 pacing/已有 429 cooldown 时，会持久化同一 `runId` 和授权 occurrence 的 continuation，释放 Lease/Operation Coordinator 后再恢复；EA mutation 已发送后返回 429 不得作为 continuation 自动重试。

公平状态已扩展为持久化的 `Buy -> Listing -> bulk-relist` 三类型轮转；最早 due/resume 时间仍优先，只有 due time 相同时才轮转。Scheduler History、长期 metrics、aggregate Journal、Recovery/Audit、过期 Lease 和 diagnostics correlation 均保留 `bulk-relist` 类型。Job Store schema 升级会安全回锁并解除已有 Job 的 Armed 状态，不自动授权迁移后的任务。

自动验证覆盖合同边界、配置迁移、三 Job 聚合授权、三类型公平轮转、空/非空执行、唯一 aggregate mutation、Preview/permit pacing continuation、mutation 前 429 cooldown、mutation 后 429 不重试、deferred Journal 同 run 覆盖、partial Recovery、过期 Lease、指标/UI 刷新、诊断关联和 EA 唯一直调点。完整 `npm run verify` 已通过：354 个 JavaScript 文件语法检查、168 个测试文件/1112 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和 FSU 发布资产检查全部通过。

首次定时空 Unsold 实机验证发现 EA Transfer repository 会把 `Available Items` 暴露为 `inactive`，但这些项目没有原拍卖 trade ID、Bid、Buy Now 或 expiry。旧候选错误地把 9 个 Available Items 当成 Unsold，调用一次 EA 原生 `relistExpiredAuctions()` 后 EA 返回 200 且正确地没有改变它们，本地对账却将其记录为 9 个 `unknown` 并进入 Recovery。修正后 EA 聚合调用方式不变；Adapter 和快照合同只把具有原拍卖身份及原 Bid/Buy Now 的 inactive 项定义为 Unsold，Available Items 仅保留在 Transfer state 计数中。只有 Available Items 时必须以 `0/0 skipped-empty` 结束，不能获取 mutation permit 或调用 EA 重挂接口。旧 ambiguous Journal 不会因升级自动消失，仍须核对 EA 状态后通过 Recovery 结构化归档。

后续实机诊断确认测试页面仍保留修复前的内存脚本：页面 Scheduler owner 于修复候选构建前创建，即使 Tampermonkey 中覆盖了同版本脚本，未 F5 的标签页仍继续执行旧函数。22:20 的定时 Run 将 21 个真实 expired auction 和 1 个 Available Item 一起计为 22 项；EA 一次聚合调用成功把前 21 项全部变为 Active 且保留价格，仅 Available Item 未变化，因此旧本地对账显示 `21/22 partial`。随后两次 Run 只对同一 Available Item调用接口并显示 `0/1 unknown`。用修复后的合同离线重算三次输入分别为 `21/21`、`0/0`、`0/0`。诊断现增加 `eligibilityContract: expired-auction-v2`，Jobs 页在 Recovery 存在时优先显示 `recovery-review-required`，避免已执行并自动解除 Armed 后被误读为 `no armed job`。同版本候选覆盖后必须 F5，并在任何新 mutation 前先保存只读诊断确认该 contract。

修复候选实机空列表验证通过。Run `trade-1786632184375-071d0b3552303` 在 diagnostics 明确记录 `eligibilityContract: expired-auction-v2` 的新页面中执行；Transfer 共 52 项，包括 21 个 Active 和 31 个没有拍卖身份的 inactive Available Items。结果为 `completed/skipped-empty`、requested/succeeded/failed=`0/0/0`，`mutationBoundaryCrossed=false`，Journal 完成、Recovery 为空、Circuit closed，Once Job 正常消费授权后自动解除 Armed。执行后选择器返回 `validation-gate-no-armed-job` 代表没有待执行任务，不是 Armed 保存失败；UI 已改为中性的 Scheduler idle 提示。V2-6 的定时空 Unsold 门禁通过，真实非空聚合调用的 21 个 expired auction 也已逐项确认成功；剩余集中门禁为 Interval/F5 occurrence 去重和 Buy continuation 公平调度。

Interval occurrence 门禁也已通过。Artifact `trade-scheduler-diagnostics-2026-08-13T14-57-36-653Z.json` 中 Job `bulk-relist-1786632855095` 以 60 秒 Interval 获得两次有限授权，分别产生 Run `trade-1786632969872-6aac7fde6ad14` 和 `trade-1786633027099-a5948440d59d9`。两个 Run 均为 `completed/skipped-empty`、requested/succeeded/failed=`0/0/0`，runId 不同且没有 mutation；第二轮后 `runCount=2`、authorization 为空、Job 自动解除 Armed、nextRunAt 清空、Scheduler 回锁，Recovery 为空、Circuit closed、Lease/Coordinator idle。由授权耗尽和 Armed=false 可确定不会产生第三轮。本轮按验收决定将 F5 中途恢复路径单独略过，不影响 C 的 Interval/两 occurrence/去重门禁判定；F5 恢复保留为后续非阻断补充证据。V2-6 剩余实机门禁仅为 Buy continuation 下 Re-list All 的公平调度。

公平调度门禁 D 已通过。Artifact `trade-scheduler-diagnostics-2026-08-13T15-07-19-663Z.json` 中 Buy Job `buy-1786633364949` 于 `scheduledFor=1786633500000` 启动 Run `trade-1786633502150-ded4c83093cd18`；采集时仍为 `waiting-pace/trade-action-pacing`，同一 continuation 已执行 25 个 slice 和 13 次无候选搜索，`runCount=0`、授权尚未消费，且没有购买或金币变化。Buy continuation 尚未终结时，到期的 Re-list All Job `bulk-relist-1786633457151` 获得执行权，Run `trade-1786633562151-405528943ed558` 以 `completed/skipped-empty`、requested/succeeded/failed=`0/0/0` 结束；此后 Scheduler 又继续派发原 Buy Run，并保持相同 runId。采集时 Lease/Coordinator idle、Recovery 为空、Circuit closed，证明等待 pacing 的 Buy 正确释放执行权，Re-list All 没有饥饿或并发 mutation。

V2-6 实机门禁 A-D 全部通过：A 定时空 Unsold；B 定时真实 Unsold；C 60 秒 Interval 的两次 occurrence、去重和授权耗尽；D Buy continuation 下 Re-list All 公平调度。F5 中途恢复按本轮验收决定暂不验证，作为非阻塞的后续补充证据保留。V2-6 标记为 `Complete`。

### V2-7 整合、文档与发布候选

状态：`Complete`

- 更新操作手册和 AGENTS 当前行为约束。
- 完成完整 `npm run verify`。
- 进行一次集中真实页面 campaign。
- 只有日志、diagnostics、Journal、History 和 EA 最终状态一致时才准备版本发布。

完成结果（2026-08-13）：README、操作手册和 AGENTS 已同步当前 V2 生产边界；A-D 集中实机 campaign 已闭合，涵盖定时空/非空 Re-list All、Interval occurrence 去重与授权耗尽，以及 Buy continuation 下的公平调度。最终 `npm run verify` 通过：354 个 JavaScript 文件语法检查、168 个测试文件/1117 项测试、ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和 FSU 发布资产检查全部通过。候选仍为 `0.7.91`；本阶段未升级版本、提交、打 tag 或发布。

## 7. 自动测试要求

至少新增以下覆盖：

- 所有普通和高风险路径不再渲染或校验精确确认文本。
- 高风险按钮未选择结果、未勾选风险确认或 evidence 已变化时拒绝执行。
- 旧 Schedule 幂等迁移和秒级 next-run 计算。
- 同一 Job 不重叠，逾期 occurrence 有界合并。
- Buy/List 等待 pacing 时不持有全局执行权。
- 多 Tab 同类动作共享 `nextAllowedAt`。
- `purchasesPerSearch > 1` 的逐张身份、预算和目的地复核。
- 429 退避、恢复和 427 持久 Circuit 的分类隔离。
- pending Buy/List/Re-list All 公平轮转，Re-list All 不会饥饿。
- Re-list All 空列表零 mutation、成功前后对账、partial 和 unknown Journal。
- Adapter 调用点唯一，domain/planner/scheduler 不直接访问 EA runtime。
- diagnostics 和持久数据继续脱敏、有界。

## 8. 集中真实页面验证

为减少频繁人工验证，先批量完成自动测试，再统一构建候选版本。最终 campaign 至少包含：

1. Manual Buy、Club List、Transfer Reprice 均无需输入字符，摘要与实际 mutation 一致。
2. 自定义 Market Search、Buy、Listing 间隔可在 diagnostics 中看到实际生效。
3. 在一个搜索响应自然出现多个合格候选时验证多买；不得人为制造高风险市场条件。
4. 秒级 Once/Interval Job 到期、合并和刷新恢复；确认 deferred Run 在 UI 中显示 Resume，等待期间可让另一种 Job 运行。
5. 长 Buy session 与到期 Re-list All 并存，后者在安全时间片后获得执行权。
6. 手动 Re-list All 对 Unsold Items 一次聚合调用并完成前后对账。
7. 定时 Re-list All 无卡时零 mutation，有卡时只执行一次。
8. Loop/Trade 互斥、双 Tab、F5、后台恢复和 Stop。
9. 429 只在自然发生时收集证据，不主动压测 EA；自动测试覆盖确定性退避分支。
10. 未知 Journal/过期 Lease 使用结构化高风险 UI 归档，且不会在同一步自动重试。

## 9. 不在本轮范围

- 页面关闭或未登录时由服务器/Companion 后台交易。
- 自动 Bid、Quick Sell、套利决策和无限数量任务。
- 绕过 EA 交易权限、Captcha、427 或 429。
- 依赖 Enhancer/FSU 私有 Trader runtime。
- 混合来源的一次 Listing transaction。
- 在没有真实页面证据前放宽现有单价、总预算、卡类和数量安全边界。

## 10. 当前下一步

V2-1 至 V2-7 已完成，Trade Scheduler v2 已具备发布候选条件。F5 中途恢复仍是非阻塞补充项，不影响当前验收，但后续取得证据时应补入操作手册。下一步仅在明确指令下确定新版本号、整理提交范围、提交、打 tag 和发布；不得在发布收口时扩大交易边界。
