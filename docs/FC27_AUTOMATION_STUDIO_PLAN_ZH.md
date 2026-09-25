# FC27 Automation Studio 规划

记录日期：2026-09-25。本文区分“产品最终能力”和“当前已验证能力”。最终目标是能够解题并执行传统 SBC、为 Gallery 缺口下单、手动和定时买卖；当前 `27.0.1` 仍只保留已授权的单次传统 SBC 入口，新增交易和批量执行不能因为规划文档自动开放。

## 1. 决策

产品正式名称仍是 **FC Automation Tool**，“Studio”仅指工作台设计，不再改名。FC27 不再继续把旧的 Daily Loop Runner 面板作为所有功能的容器。产品保留一个共享的纯领域核心，再由 Web App 和 Android Companion 分别提供适配器和界面：

```text
              +-----------------------------+
              | FC Automation Studio core   |
              | contracts / policy / plan   |
              +-------------+---------------+
                            |
          +-----------------+-----------------+
          |                                   |
  FC27 Web App adapter                 Android adapter
  EA objects / FSU / DOM               Cordova / native bridge
          |                                   |
  desktop + mobile UI                  Companion UI
```

共享核心只接收可序列化的库存、挑战、Gallery、市场和能力快照，返回计划、保护结果和事务状态。它不读取 `window`、`document`、FSU 私有对象或 Android 凭证。所有 EA/Companion 写操作都留在适配器和事务层，并且每次写入后都必须重新读取并对账。这里的“只读”只表示当前合同采集和实机验收阶段；最终产品必须允许经过确认的 SBC 提交、Gallery 采购和交易执行。

优先顺序定为：

1. Puzzle 型传统 SBC：读取要求、生成解题计划、填阵、保存并提交；执行前必须由用户确认，批量执行另设门禁。
2. Gallery：读取收集进度和缺口，生成补全采购计划，并把合规缺口交给 Market 下单；购买结果对账后再刷新 Gallery。
3. 交易：Market 负责价格、订单和手动买入/挂牌，Automation 负责定时 Buy/Sell、恢复、预算和 Kill switch。
4. Streamlined SBC：等页面真实暴露积分、批次、资格和奖励合同后实现独立流程。
5. Rolling：FC26 的 85/86x10、Provisions、Storage sink、Swap 和三阵评分预测全部留在归档构建；FC27 只有在新合同证明需要连续循环时另建 points workflow。

Web App 缺少目标 SBC 时才评估 Android 路线。Android 不作为 Web App 的隐式后备执行器，也不通过改包绕过服务端未开放的能力。

## 2. Fodder GG 调查结论

### 2.1 可以取得什么

本地收到的 `Fodder — SBC tools for FC 26-0.4.0.txt` 是一个 bootstrap。它等待 EA 页面对象后拉取：

```text
https://fodder.gg/client.core.js
```

通过用户指定的 `127.0.0.1:1080` 代理已取得当前生产 bundle：

```text
版本: 1.2.9
大小: 894,543 bytes
SHA256: 414FEA91889887B2D72B713E08CA6BE152118CCA3CA43B42E52DC4969B35A7A5
文件: artifacts/fodder-client-1.2.9.js
```

文件头标明仅做 minify，没有 `sourceMappingURL`。因此可以下载完整的当时生产部署 bundle，用于黑盒行为和接口边界研究；不能得到作者的 TypeScript/源码仓库、构建配置、服务端 solver 或完整历史版本。`artifacts/` 调查副本不进入发布资产，也不应提交。

bundle 还会读取 `window.FODDER_GG_BACKEND`，调用 `/api/...` 资源，并通过 `GM_xmlhttpRequest` 或 `fetch` 访问 `fodder.gg`。这意味着客户端不是完全离线产品，单纯保存 bundle 不能复现账号、Gold 权限、服务器配置或后端求解能力。

### 2.2 观察到的功能证据

bundle 的公开桥包含下列类别（名称来自静态生产代码，不代表 FCAutomationTool 可以直接调用）：

| 类别 | 观察到的入口/文案 | 结论 |
| --- | --- | --- |
| 传统 SBC | `solveChallenge`、`solveSet`、`solveAll`、`routineSolveSets`、`routinePlanThenSubmit`、`currentChallenge` | 有批量解题和 routine 编排，依赖传统 Challenge/阵容模型。 |
| Solver 设置 | 评分、最低/最高评分、卡片价格、来源 pile、特殊卡、最大超额、Club/Storage/Transfer/Unassigned | 可作为 Puzzle 产品的交互参考；不能复制其默认保护策略。 |
| Gallery | `gallery.title`、`collected/missing/progress`、`selectCheapest`、`compare`、`tokens`、`points`、`badge/kit/grades` | 有收集进度和积分相关展示；服务端数据合同仍需在 FC27 页面确认。 |
| 市场 | `buyNow`、`bid`、`transfer`、`market-solve`、最低价、价格比较、买入风险提示 | 具备买入、挂牌/重挂和价格观察 UI；不能把前端文案当成 EA API 授权。 |
| 物品处理 | `routeUnassigned`、`quickSellUnassigned`、`sendNonDupesToClub`、`sendStorageNonDupesToClub`、开包和 Pick | 有库存移动和奖励处理；本项目必须继续执行 item/definition/pile 精确对账。 |
| 锁卡/保护 | `lockPlayer`、`unlockPlayer`、`lockedPlayers`、`avoidEvos`、`excludeActiveSquad`、联赛/国家排除 | 可借鉴设置分组；FSU Lock 和 Active Squad 的身份匹配仍以本仓库合同为准。 |

传统 solver 的内部片段显示它会加载 Challenge、填充 squad、显示预览、调用 `submitChallenge`，并在 EA 限流或填阵不足时停止或刷新 Club。该路径与 FC27 Streamlined 的积分贡献不能混用。

用户操作层可以完全在 FC Automation Tool 的 SBC Studio 中完成：选择 Challenge、查看要求、生成阵容、调整/锁定材料、确认、填阵、保存、提交和查看奖励结果，都不要求用户再打开 EA 的 SBC 页面逐张点卡。这里的“完全在工具界面”是指交互入口和进度展示统一在本工具；底层仍需保持已登录的 EA Web App 页面/Companion 会话作为运行时宿主，由 EA adapter 调用官方页面对象或同源事务接口。工具不能凭脱机计划或独立窗口伪造 EA receipt；宿主会话失效、Challenge 未加载、保存/提交合同变化或回执无法对账时，工具必须停止并显示需要回到 EA 登录/恢复页面的原因。

### 2.3 不会做的事情

- 不把 Fodder GG bundle、其压缩函数、图标、样式、远程代码或服务端调用复制进本仓库。
- 不把 Fodder GG 的商标、账号等级、Gold 权限或服务器结果描述为本项目能力。
- 不以抓到 `client.core.js` 代替许可证审查、EA 兼容性验证或服务端合同。
- 不运行第三方远程脚本来获得隐藏 API，也不绕过登录、付费功能、完整性检查或访问控制。
- 可以继续做静态、黑盒、脱敏的行为记录；若需要兼容参考，只记录输入、输出类别、错误和页面时序。

## 3. 功能分层和最小合同

### 3.1 Puzzle 型传统 SBC：从计划到执行

Puzzle 先按“解题”定义，而不是按 Rolling 定义。输入是当前 Set/Challenge 的完整要求、奖励、完成次数和可提交 pile；输出是一个或多个候选阵、每张卡的稳定引用、评分/化学/特殊条件、预计消耗和保护拦截原因。

最终求解器必须支持“计划 -> 执行 -> 对账”，同时保留独立的 Preview 阶段：

- 先做能力握手，确认是 `traditional`；未知格式直接显示 Unsupported。
- 使用不可变 Inventory snapshot，具体 item ID 一一分配，禁止同一实体出现在两个阵。
- 默认保护特殊、Holo、Evolution、loan、active trade 和未知属性；FSU Lock、Active Squad 是否保护沿用 Selection Policy 的 opt-in 设置，默认关闭，开启后才进入候选和提交前保护。
- 先生成 Preview，再由用户明确确认；确认后允许填阵、保存和提交。Preview 本身不能改变 EA 阵容，确认后的执行必须复用同一计划指纹，不得静默换阵。
- 对 `409 itemViolations` 保留 warning 与 item ID 的关联；未知 warning 停止。
- 提交后重新读取 Challenge、库存和奖励；部分成功记录 partial completion，不自动重发。
- 规划预算耗尽时返回 `planning-limit`，不能伪装成缺卡。若用户允许补卡，缺口必须单独转成 Market 采购计划，采购完成并对账后重新规划，不能在同一份旧快照上继续提交。

交付顺序是“单阵计划 -> 用户确认填阵/提交 -> 奖励和库存对账 -> 多阵联合规划 -> 有界批量”。自动买材料属于独立的 Market Order，开包、领取 Pick 和连续 solve-all 也各有事务门禁；它们不能偷偷夹在一次提交里，但可以在合同和恢复证据通过后由 Routine 编排。也就是说，solver 的最终职责是实际解题并提交，不是永远停在只读预览。

#### 3.1.1 需求从哪里来

需求读取不依赖用户复制页面内容。用户登录 EA Web App 后，Runner 在页面内通过 FC27 EA adapter 完成以下过程：

1. 从 EA 当前注册的 SBC Set/Challenge repository 或 DAO 读取活动列表，并用稳定的 Set ID、Challenge ID、奖励 ID 和完成次数建立候选索引。名称只用于显示，不能用来判断 SBC 类型。
2. 对用户选中的 Challenge 发起一次有界的精确读取，取得人数、阵容槽位、最低/最高评分、化学、联赛/国家、卡种、特殊卡数量、动态 eligibility group、重复次数、奖励和提交状态等原始字段。
3. 将 EA 实体转换成可序列化的 `ChallengeContract`。原始 group id、values、count 必须保留；`meetsRequirements` 这类运行时函数只作为适配器绑定的 matcher，不能塞入序列化合同。关键字段缺失、身份不一致或只有名称描述时，界面显示 `Unsupported`，不生成可提交计划。
4. 读取当前 Club、Storage、Transfer、Unassigned 的真实库存快照。FSU 只提供材料过滤、Lock 和库存兼容策略；它不是 SBC 要求的权威来源。
5. 纯 Planner 在这份快照和 `ChallengeContract` 上生成阵容计划。工具界面只渲染该计划，并记录输入版本、Challenge identity 和计划指纹。

因此用户看到的是工具自己的 SBC 表单，但数据来源仍是 EA 的实时合同。点击“确认并提交”前必须重新读取同一个 Challenge 和库存；如果要求、完成次数、奖励、库存版本或 matcher 发生变化，旧计划立即失效并要求重新规划。提交后再读取 Challenge、库存和奖励回执，只有消费 item ID、完成状态和奖励实体都能对账，工具才显示成功。

如果 EA 页面没有暴露可验证的 Challenge/DAO/同源响应，工具就没有安全途径知道完整要求。此时可以记录脱敏诊断或让用户提供一次性观察证据，但不能仅凭截图/名称继续填阵，更不能在需求未知时提交。

静态 bundle 中没有 `streamlined` 这一明确功能标识。虽然 Gallery 文案出现 `points`、`tokens`，这只能说明存在 Gallery/积分展示，不能证明存在 Streamlined SBC 选材、分批贡献、积分结转或提交实现。FC27 积分流程必须以 Web App/Companion 的真实 DTO 和一次低价值事务为证据。

当前 `27.0.1` 已将“Read requirements”接入正式面板：它可以展示经过方法指纹验证的 catalog 原始 requirement 行；当前传统 Planner 仍只接受已验证的玩家数量、最低/最高评分和整队品质三类条件，化学、联赛/国家组合、复杂 rarity/group、多阵 Puzzle 会明确停止为 Unsupported。原始行展示不等于完整 solver。

建议新增或拆出的纯模块：

```text
src/domain/sbc-contract.js
src/selection/traditional-puzzle.js
src/sbc/traditional-transaction.js
src/workflows/traditional-puzzle.js
src/adapters/ea/fc27-sbc.js
src/ui/fc27-sbc-studio.js
```

这些是拟议边界，不要求一次性移动旧 `src/sbc`；先为 FC27 写窄合同和 fixture，再逐项复用已有保护/对账代码。

### 3.2 Streamlined SBC

Streamlined 与 Traditional 必须是两个事务类型：

```text
Traditional: requirements -> squad plan -> save/submit -> reward
Streamlined: points requirement -> contribution plan -> contribute -> progress/reward
```

数据模型至少要有：

- `format`、Set/Challenge identity、目标积分、已投入积分、剩余积分和批次上限；
- 每张卡的权威积分值、积分来源版本、资格组和真实 pile；
- 允许的积分超额/损耗、已承诺材料、奖励和重复/重置状态；
- 服务器返回的 contribution receipt、进度变化和消耗 item IDs。

积分不能由 OVR、第三方价格或活动名称推断。没有权威积分值、资格 matcher、批次规则或提交结果时只读展示，不执行贡献。

建议模块：

```text
src/selection/points.js
src/sbc/contribution-contract.js
src/sbc/contribution-transaction.js
src/workflows/points-planner.js
src/adapters/ea/fc27-streamlined-sbc.js
```

连续运行只显示后续 2-3 次的保守预算：未开的随机包、未领取 Pick 和未知积分不计入确定性资源。每次开包、移动、贡献或手动库存变化都会使计划失效并重新计算；不能用三阵预测保证未来随机结果。

### 3.3 Gallery：收集目标、采购和验证入口

Gallery 不是只读终点，而是收集目标和采购计划的来源。流程分为“读取目标 -> 规划缺口 -> Market 下单 -> 库存对账 -> 刷新 Gallery”五步：

1. 读取 Gallery set、等级/进度、已收集/缺失卡和积分/代币字段。
2. 以稳定 definition/resource/variant 身份合并卡片，区分 Club 中实体和市场缺口。
3. 显示“在 Club”“市场最低价”“不可购买/信息未知”等来源，并按用户选择把可购买缺口加入采购计划。
4. 采购计划不能直接绕过交易门禁；它必须转换成 Market Order，重新执行价格上限、硬币保留、限流和精确订单回执。
5. Buy Now 成功后按 item/trade ID 对账并刷新库存；只有 Gallery 重新确认已收集，目标才标记为完成。不可购买、身份不完整或价格过期的缺口保持阻断。若收集还需要独立登记/消耗动作，单独展示、授权和验证，不能把购买回执当成收集完成。

Gallery 内直接提供“立即采购”和“定时采购”入口，内嵌共用的订单确认抽屉，不要求用户先跳到 Market 再操作一次。采购前为目标缺口和预算建立预约；买入后绑定实际 item ID，直到收集已验证且符合用户保留策略，SBC 选材和自动卖出都不得抢占这些实体。SBC 补卡、Gallery 采购和普通交易共用一份预约/任务互斥机制；每次下单前重新检查缺口，手动补齐后取消尚未执行的采购项。

建议模块：

```text
src/gallery/gallery-contract.js
src/gallery/gallery-planner.js
src/adapters/ea/fc27-gallery.js
src/ui/fc27-gallery.js
```

Gallery 与 SBC 选材不共享“最低价卡就是可提交卡”的假设；Gallery 的收集身份和 SBC 的可提交身份必须分开。

### 3.4 Market、交易和定时买卖

Market 是所有买卖动作的执行中心和订单工作台，不只是价格展示页，也不是单独复制一份自动化面板：

- **Price Compare**：按 definition、平台、卡种和来源比较价格，显示报价时间和可信度。
- **Order Plan**：接收 Gallery 缺口、SBC 补卡或用户手动选择，计算价格上限、数量、总预算、硬币保留和请求预算。SBC 补卡不得静默突破 Only Untradeable；需在独立采购确认中明确所购实体可用于该 SBC，未获该用途授权则不买、不提交。
- **Manual Buy/Sell**：用户确认单笔或明确列出的有限订单批次后执行 Buy Now、挂牌、到期改价重挂，并取得精确 receipt；不假设已挂牌物品能原地改价。
- **Scheduled Jobs**：由 Automation 调度已批准的 Market Order，保存 Job、Lease、operation ID、暂停原因和恢复状态。用户可以在 Market 中创建一次性订单批次或定时策略，Automation 负责按时间触发、恢复和停止。

因此 Gallery 负责“需要哪些卡”，Market 负责“以什么价格、数量、预算和订单类型买入或卖出”，Automation 负责“何时再次执行、失败后如何恢复以及何时停止”。三者共享库存和交易对账，但不混成一个不可恢复的 Loop。自动化买卖计划的编辑入口可以在 Market，运行状态和调度入口集中在 Automation；Gallery 的采购抽屉复用同一 Market Order 引擎。

自动化不是每张卡都弹确认：用户一次批准策略版本、卡片范围、单价、总数量/总支出、保留硬币、起止时间和必要的入库步骤后，在这个范围内自动执行；更换用途、突破预算、扩大卡种或超过期限必须重新确认。挂牌订单以真实可交易 item ID 为准，不自动出售 Gallery/SBC 预约材料。所谓“定时售出”在产品中准确命名为“定时挂牌/重挂”，成交时间和利润不作保证。

例如可以设置“今晚 20:00 开始，每 15 分钟检查一次某个确定版本，最高买价 650，累计最多 2 张、总支出最多 1,300，22:00 截止”；也可以串联“买入对账 -> 指定时间挂牌”，挂牌对象只能来自这个采购任务实际取得的实体。Gallery 目标仅在收集回读已确认、保留条件允许且用户批准后，才可进入后续自动挂牌步骤；不能预设买入就算收集成功或收集后一定允许出售。

现有 `src/trade` 的 Provider、Planner、Transaction、Journal、Lease、Pacing、Circuit Breaker 和 Scheduler 设计可以作为安全框架，但 FC26 adapter、`season=26`、EA DTO 和价格字段必须重新验证，不能直接接入 FC27 默认构建。

分三个交付层：

| 层 | 能力 | 默认状态 |
| --- | --- | --- |
| T0 | 价格查询、手动搜索、候选和订单预览 | 开放只读 |
| T1 | 单张手动 Buy Now/挂牌，用户逐次确认，精确 receipt 对账 | 真实合同验证后开放 |
| T2 | Gallery 采购计划转订单、定时 Buy/Sell、重启恢复、预算和 kill switch | T1 稳定后独立灰度 |

每个 Scheduled Job 都需要：

- 精确 selector：definition、版本、评级/类别、最大买入价、最小卖出价和数量上限；
- 硬币保留、Transfer/Club 容量、每日/每小时请求预算和冷却时间；
- 持久化 Job、单实例 Lease、幂等 operation ID、Journal 和审计摘要；
- EA 返回 accepted 但实体未落地时的有界 reconciliation；身份不明绝不重试；
- 页面隐藏、浏览器休眠、网络断开和 429/409/500 的明确暂停状态；
- Stop/kill switch 在安全点生效，不能中断提交临界区；
- 每一次实际买入/售出后的精确 item/trade ID、pile、价格和余额对账。

浏览器定时器不能保证电脑睡眠或浏览器关闭时执行。Web 版只承诺“页面保持运行时的有界调度”；若用户要求后台执行，Android 也只能在 OS 允许的 WorkManager/前台服务约束内补偿，不能承诺全天候运行。服务器代执行会引入凭据、账号风控和新的数据保护范围，当前不规划。

建议先为 FC27 建立独立入口：

```text
src/adapters/ea/fc27-trade.js
src/trade/fc27-contract.js
src/trade/fc27-jobs.js
src/ui/fc27-market.js
```

旧 `src/trade` 只有在 provider contract、价格语义、交易状态和真实单张 mutation 通过后才接入。

## 4. UI 设计

### 4.1 桌面布局

```text
┌──────────────┬───────────────────────────────────────────┐
│ FC Automation│ 顶部：账号 / 赛季 / 能力状态 / Stop       │
│ Tool         ├───────────────────────────────────────────┤
│              │ 当前工作区                                  │
│ SBC Studio   │ 预览 / 计划 / 保护 / 确认 / 进度           │
│ Gallery      │                                           │
│ Market       │ 价格 / 订单 / 手动买卖                   │
│ Inventory    │                                           │
│ Automation   │ 定时订单 / Routine / Kill switch         │
│ Activity     │                                           │
│ Settings     │                                           │
└──────────────┴───────────────────────────────────────────┘
```

左侧导航只切换工作区，不重建当前会话。顶部始终显示 `season`、`format`、库存 freshness、Live 状态和 Stop。单次/有限批次操作先 Preview -> Confirm；定时任务批准的是有期限、有预算的策略，不要求每次触发再确认。执行仍须逐笔 fresh 校验和对账，范围变化后暂停并重新批准。

### 4.2 SBC Studio

SBC Studio 内部分为 `Traditional Puzzle`、`Streamlined Points` 和 `Advanced/Legacy` 三个标签。它是用户的统一 SBC 操作入口；EA 页面作为运行时宿主，必要时仍需完成登录或 Challenge 初始化，不要求用户逐张点击卡片：

- Traditional：挑战列表、要求摘要、解题候选、保护拦截、预计奖励、单次确认。
- Streamlined：积分进度、剩余缺口、候选贡献批次、超额预算和服务器 receipt；合同未知时显示只读。
- Advanced/Legacy：Rolling 和 FC26 专用能力默认隐藏或明确标为 Archived，不与新计划混合。

右侧 Plan Inspector 固定显示：输入库存版本、计划指纹、会消耗的 item IDs、预计积分/评分、被保护卡和阻断原因。底部固定 `Preview`、`Confirm once`、`Stop`，移动端也保持同样顺序。

### 4.3 Gallery

Gallery 采用“集合卡片 + 缺口表 + 计划抽屉”：

- 集合卡片显示完成度、积分/等级和最后一次读取时间；
- 缺口表按 Club、Transfer、市场可见性和未知分组；
- 计划抽屉显示预计花费、可由现有库存满足的数量、市场采购项和需要确认的购买项；
- `立即采购 / 定时采购` 在 Gallery 内打开共用 Market Order 抽屉，调整价格上限、数量、总预算、硬币保留和期限后确认；高级订单管理才跳到 Market；
- 下单后 Gallery 显示 `ordered / received / verified`，未对账成功不能算完成。

### 4.4 Market 与 Automation

Market 显示价格比较、搜索、订单计划、手动 Buy/Listing、交易历史和来自 Gallery 的采购项。Automation 单独显示 Jobs：状态、下一次时间、请求预算、硬币保留、最近 receipt、暂停原因和 Kill switch。SBC 运行状态不会和 Market Job 混在一个 Loop 进度条里。

移动端沿用现有响应式基础，原型底部以短标签展示六个工作区：`SBC / 图鉴 / 市场 / 库存 / 自动化 / 记录`，与桌面入口一一对应；设置放在工作区内。正在执行的事务使用全屏确认和固定 Stop，避免底部面板被 EA 页面遮住。

### 4.5 Activity

Activity 是所有工作区共享的审计时间线：读取、计划、用户确认、EA receipt、对账、暂停和恢复。日志只保存脱敏的 item/definition/trade ID 摘要、数量、状态和原因，不保存 token、Cookie、完整 EA 对象或第三方 bundle。

离线界面原型见 [FC27 Automation Studio UI prototype](mockups/fc27-automation-studio.html)。原型使用模拟库存和状态，不连接 EA、FSU 或 Fodder GG；可演示 SBC 填阵/提交、Gallery 内嵌采购、Market 买入/挂牌确认和定时任务创建。订单抽屉包含单价、总数量、总预算、硬币保留、起止时间及间隔；所有结果仅在本页内存展示，不是真实 solver、下单或持久调度。

## 5. Web App 实施路线

W 编号用于追踪功能包，不等于严格串行次序。实际优先级是 **W0 -> W1 -> W3 交易基础 -> W2 采购闭环 -> W5 定时策略**；Gallery 读取/规划可先做，但只有 W3 的下单、对账和用途预约通过后才算 W2 完成。W4 根据 Web/Android 实际能力单独推进，不阻塞传统 Puzzle 和交易。

### W0：合同采集和依赖瘦身

- 读取 FC27 页面真实 Set/Challenge、Gallery、Transfer DTO 和能力状态。
- 为 Traditional、Streamlined、Gallery、Trade 建立最小脱敏 fixture。
- 在 FC27 生产入口中移除默认导入的 FC26 Rolling、Swap、完整 Builder 和 Trade Scheduler；旧代码保留在回归构建。
- 用 esbuild metafile 和架构测试确认默认入口只带当前阶段模块。

门禁：未知合同只能显示 Unsupported；`npm run verify` 和现有 FC26 regression 均通过。

### W1：Puzzle MVP（计划、填阵、提交）

- 实现传统 Challenge 扫描、约束规划、Preview、用户确认、填阵、保存、提交和奖励/库存对账。
- 复用 `inventory`、FSU Lock/Club 定向校验、提交前 validator 和 Journal；不复用 Rolling 的评分预测或 Swap。
- 先完成一个低价值、单阵、无特殊卡挑战的真实页面矩阵，再评估多阵/批量。

### W2：Gallery 目标和采购计划

- 读取集合和进度，完成稳定身份、缓存失效和来源显示。
- 将缺口规划转换成 Market Order，在 Gallery 内确认；依赖 W3 先完成单张真实采购，再实现多项有界采购和用途预约，只有展示/预览不算此阶段完成。
- 买入后精确对账并刷新 Gallery；等积分/代币合同确定后，再增加 points 贡献流程。

### W3：Market T0/T1（手动订单）

- 重做 FC27 Trade adapter，验证价格上下限、trade state、Transfer capacity 和单张 receipt。
- 恢复手动买入和挂牌；默认一次一项、用户确认、精确对账。
- 任何 EA 状态未知、余额/容量未知、accepted 无实体证据都停止。

### W4：Streamlined contribution

- 在真实页面确认积分来源、资格组、贡献批次、超额和奖励。
- 加入 points planner 与 contribution transaction 的差分测试和一次低价值实机事务。
- 事务通过前，Streamlined 只读展示；不由 Traditional solver 代提交。

### W5：Scheduled Market（Gallery 采购和自动买卖）

- 在 T1 稳定后实现持久 Job、Lease、请求预算、暂停/恢复和 kill switch。
- 先做页面前台运行的 once Job，再做 interval Job；每次只允许很小数量和低价值 selector。
- 浏览器关闭/睡眠时显示未执行状态，恢复后先对账再决定是否补偿，不追赶式重复下单。

### W6：连续流程和替代路线评估

- 只有 points transaction、奖励和库存对账稳定后，才设计 points rolling。
- 如果 Web App 仍不给 Streamlined 合同，转入 Android A0-A2 调查；不把失败请求归因于缓存并继续自动化。

## 6. Android Companion 备用路线

现有 `docs/ANDROID_COMPANION_APK_FALLBACK_ZH.md` 仍是权威门禁。当前 FC26 APK 静态结果证明它是 Cordova/PhoneGap 混合应用，存在 WebView JS 业务层和 SBC/Item 对象符号；这证明“可以研究”，不证明 FC27 包、签名、服务端或 SBC 能力可改。

触发后严格按以下顺序：

1. A0：核验 FC27 官方 APK hash、完整签名、ABI，在隔离模拟器/ARM64 真机安装未修改官方包，不登录也不写入账号。
2. A1：用户在官方 App 手动登录，确认目标 SBC/Gallery/库存页面确实可见；只保存脱敏 DTO 字段、路径类别和时序，不提交 HAR、Cookie、token 或账号数据库。
3. A1R：从 hash 锁定的官方副本做“只重打包”和“只增加本地诊断标记”两次实验，分开判断签名/资源破坏和业务代码问题。
4. A2：只读规划 PoC，复用共享纯 planner，显示资格、积分/库存和保护结果，不移动、不贡献、不交易。
5. A3：经用户单独确认，在隔离测试账号上做一次低价值人工确认事务；验证消耗实体、服务端进度、奖励和进程被杀后的恢复。
6. 只有 A0-A3 全部通过，才评估连续贡献、Gallery 购买和交易；改包失败、证书固定/完整性拒绝或接口未开放时停在只读辅助。

Android 适配器只替换 EA/页面边界，不把 Tampermonkey `unsafeWindow`、GM 存储或网页 FSU 设置复制进 App。凭证使用 Android Keystore/应用私有存储；不能从 Web App 自动导入锁卡或 token。若后台任务使用 WorkManager/前台服务，必须展示 Doze、系统杀后台和网络不可用造成的延迟，不能承诺精确定时。

共享范围限于 `domain`、`selection`、`inventory`、事务 Journal 和脱敏诊断。Android build、签名、versionCode、设备验收和分发许可与 userscript 独立，APK 不进入网页 Release 资产。

## 7. FSU 和上游同步

FSU 仍保持原脚本身份和 `upstreamVersion`。本地维护只通过 immutable origin + 可重放 patch + manifest：

1. 新上游版本到达时保存原始 hash，不能直接在旧 mod 文件上覆盖。
2. 对每个本地补丁标记“上游已解决 / 仍需保留 / 合同变化需重写”。
3. 先运行 `git apply --check` 和 patch replay，再做静态/fixture/真实页面验证。
4. Runner 只依赖窄 bridge（策略、锁卡、Club readiness、定向校验和价格能力），不依赖 FSU 完整内部 UI。
5. 一键填阵和价格显示继续沿原 FSU 函数做最小兼容；新 Gallery、积分和交易逻辑不塞入 FSU。
6. 上游已实现的 workaround 经回归后删除，避免本地补丁永久堆积。

这样 FSU 更新只需重新审查窄 bridge 和少量 patch，Runner 的 Puzzle/Gallery/Trade 核心不会随着 FSU UI 变动一起重写。

## 8. 预计交付和风险

| 阶段 | 主要交付 | 估计量级* | 最大阻塞 |
| --- | --- | ---: | --- |
| W0 | 合同 fixture、默认构建瘦身、能力探测 | 3-7 天 | FC27 DTO 未稳定 |
| W1 | Traditional Puzzle MVP | 1-2 周 | 多阵/特殊资格合同 |
| W2 | Gallery 收集进度、缺口、采购执行和回读闭环 | W3 通过后约 1-2 周 | Gallery 进度 API/variant 身份、采购用途预约 |
| W3 | Market 手动 Buy Now/挂牌与订单回执 | 1-2 周 | 交易状态/价格/风控 |
| W4 | Streamlined 单次贡献 | 1-3 周 | 积分和部分提交合同 |
| W5 | 定时 Buy/Sell | 2-4 周 | 浏览器休眠、限流和恢复 |
| Android A0-A2 | 包、页面和只读 PoC | 1-3 周 | 签名、完整性、FC27 接口 |

\* 量级只用于安排工作，不是完成承诺；真实 EA/Companion 验证、等待开放和账号测试时间另计。

发布按能力分别验收：Traditional 验证约束、填阵/提交和奖励/库存；Gallery 验证采购与收集回读；Market 验证订单、余额/实体、重启恢复和限流；Streamlined 另需权威积分、超额和部分贡献语义。Streamlined 未开放不阻断已验收的传统 SBC 或交易。离线 solver、第三方 bundle 分析、APK 能启动或一次请求返回 200 都不能替代各自的真实业务证据。

## 9. 当前下一步

无需用户登录即可完成的工作：


- 完成 W0 的模块依赖审计和默认 FC27 构建瘦身清单。
- 为 Traditional Puzzle、Gallery 和 Trade 各建立一个最小脱敏 fixture/contract test 目录设计。
- 把 Fodder GG 调查 hash、无 source map、黑盒边界和第三方许可限制保留在本文。
- 保持 Rolling 和 Android 改包路线为 Deferred，不改现有 Live/Release 门禁。

需要用户操作的工作只在真实页面合同采集时发生：打开专用浏览器、完成 EA 登录或验证码，然后由自动检查器读取当前页面。用户不需要复制日志、导出 HAR 或把账号凭证发来；只有页面确实无法从浏览器/适配器观察时，才把脱敏 HAR 作为补充证据。

## 10. 本次设计修正与验证（2026-09-25）

- 完成：明确 SBC 实际执行、Gallery 买入和 Market 订单/自动买卖目标；将只读限定为合同采集阶段或未支持的能力。已补充策略一次批准、材料用途预约、W3 先于 W2 采购闭环的依赖；Streamlined 不阻塞传统 SBC/交易交付。
- 完成：离线原型支持六个工作区、11 人模拟计划、填阵与提交分支、Gallery 本页采购确认、Market 买入/挂牌及模拟定时任务；取消/预算不足不创建任务。模拟任务刷新即丢失，不包含真实调度器。
- 验证：Chrome headless 的 1440×1000 和 390×844 视口通过导航、上述交互、SBC 三标签和异步刷新检查；文档与订单弹窗无横向溢出，0 个脚本异常、0 个 HTTP(S) 请求。内联 JavaScript 语法检查通过。
- 完整回归：`npm run verify` 通过，245 个测试文件 / 2,492 项测试；FSU patch replay、构建、根目录/dist 一致性及 FSU 资产检查通过。该结果验证已有代码基线，不代表新增业务已实现或真实 EA 验收。
- 范围：仅规划、里程碑和离线原型修改；版本保持 Runner `27.0.1` / FSU Local `26.09.9`，没有接入新生产业务、没有实际消费卡片或硬币，没有提交或发布。本节完成项不是 W0-W6 的业务完成声明。
