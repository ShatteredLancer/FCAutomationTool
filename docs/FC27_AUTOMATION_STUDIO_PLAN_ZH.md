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

交互方向已按用户反馈调整为 EA 原生 SBC 页面优先：右侧挑战要求栏增加 FCAT 解题/填充入口，在原生球场查看填阵结果；工具工作台保留设置、计划历史和多阵任务管理。无需在工作台重建整套 SBC 球场，也无需用户逐张点卡。底层使用已登录的 EA Web App/Companion adapter；宿主会话失效、保存/提交合同变化或回执无法对账时停止并显示原因。

### 2.3 不会做的事情

- 不把 Fodder GG bundle、其压缩函数、图标、样式、远程代码或服务端调用复制进本仓库。
- 不把 Fodder GG 的商标、账号等级、Gold 权限或服务器结果描述为本项目能力。
- 不以抓到 `client.core.js` 代替许可证审查、EA 兼容性验证或服务端合同。
- 用户已允许在专用浏览器加载插件做功能调查；可以检查其页面、设置和已审查为只读的入口。生产 FCAT 不依赖第三方远程脚本或私有求解服务，不绕过登录、付费功能或访问控制。
- 可以继续做静态、黑盒、脱敏的行为记录；若需要兼容参考，只记录输入、输出类别、错误和页面时序。

### 2.4 官网与实际客户端的补充核对（2026-09-25）

本次通过 `127.0.0.1:1080` 和隔离 Chrome 实际读取了 fodder.gg 的公开 FC27 页面，保存公开页面文本及截图到 `artifacts/fodder-research/`。另在专用浏览器中对 SHA256 核验的 `client.core.js` 1.2.9 做了临时页面注入（未安装 Tampermonkey 脚本），确认 EA 登录页出现 Fodder GG 与 `NEW! Gallery` 标签，并在 Marquee Matchups Set 页面看到 `Solve Challenge` 入口；当前账户该整组入口带 `Gold` 锁。检查器只进行了页面导航和 DOM 观察，未点击求解、确认、填阵、保存、提交、买入或挂牌。请求拦截记录到一条 EA `POST /ut/game/fc27/appstats` 和一条 Fodder `POST /prices/observed`，两者均已阻断；这不是事务写入验收，也不能推断求解调用链已经安全。具体单阵 solver 结果、填阵、交易和 Gallery 写入仍未验收。

公开页面给出的功能边界比 FSU One-click Fill 更宽：

- [SBC Solver](https://fodder.gg/features/sbc-solver) 明确展示 `Squad Rating`、`Clubs in Squad`、`Total Chemistry` 等要求，支持单个 Challenge、重复 SBC、整组 Challenge、用市场球员补足，以及在方案中 `Swap a player`；页面同时明确“提交前先审查”。
- [Transfer Market](https://fodder.gg/features/transfer-market) 展示搜索、最低 Buy Now、税后收益、挂牌和快捷键；这只是第三方产品说明，不能证明 EA 在当前账号/赛季允许同样的写入合同。
- [Pack Opener](https://fodder.gg/features/pack-opener) 展示多包选择、重复卡去向和 Player Pick 暂停；它与 FCAT 当前明确关闭的开包、移动和 Pick 写权限无关。
- 本次读取的导航与 Features 页面没有独立 Gallery 说明；bundle 存在收集进度、等级、First Owner 记录、价格比较和自动采购入口，真实 DTO、积分和购买事务尚待实机核验。
- [Gold](https://fodder.gg/gold) 将市场补卡、整组求解、每次最多 20 阵及方案替换列为会员能力；客户端存在对应权限检查。页面功能展示不证明当前用户账户可以使用。
- [Android 安装](https://fodder.gg/install/android) 指向 Firefox + Tampermonkey + EA Web App。这是手机网页运行方式，不能解决仅 Companion App 开放的 SBC。

对本地保存的 `artifacts/fodder-client-1.2.9.js` 做静态核对后，可以把其 Solver 分成四层：

1. `extractRequirements` 将 EA `eligibilityRequirements` 转为单卡评分、品质、国家/联赛/俱乐部及其数量/同组条件、稀有数量、整队评分、化学和 rarity group。未知 key 在未启用对应能力时返回 Unsupported；另一分支会携带原始规则交给后端，不能据此推断后端支持所有规则，也不能照抄数字 key 作为 FC27 权威语义。
2. 库存候选读取 Club、Storage 和 Unassigned；Market 是可选求解来源，缺卡可由服务器返回购买计划，并非已持有实体。pool 携带 item ID、definition ID、重复、可交易、Evolution 等字段；锁卡 item/definition ID、国家/联赛和价格/评分限制进入 filters。
3. `POST /v1/solves` 后轮询 `/v1/solves/:id`，不可用时回退 `POST /solve`。响应是 player IDs/assignment/购买计划，不是本地可离线复现的求解算法。
4. 公开 `solveChallenge` 默认 `fillPitch:true`，会填充当前 squad，并在 `skipSave` 未开启时尝试 EA `services.SBC.saveChallenge`；填充路径还可能将所选 Unassigned 卡移入 Club。`solveAndSubmit`、`solveAll`、`solveSet` 和 routine 包含提交路径。因此默认调用并非只读。客户端内部另有 `fillPitch:false` 的计划分支，但也会读取库存/报价并向其服务器上传候选，必须先核对完整调用链再做实机调查。

官网展示右侧要求下方的“解决挑战”按钮；bundle 的 `mountButton` 则锚定原生球场 `.ut-squad-pitch-view`，打开求解设置弹层。实机 Set 页确实出现了 Fodder GG 浮动入口，但整组入口显示 Gold 锁；单阵按钮位置和求解结果仍需在原生 Challenge 页面单独验收。FCAT 按用户指定采用原生右侧栏入口，按钮显示“FCAT 解题填充”：读取当前 Challenge 合同和库存，生成自己的计划/预览，确认后填入并保存到原生阵容；提交保留独立动作。当前生产执行链尚不支持 10 人/brick、化学、国家/联赛组合、动态 rarity group 或多阵；纯 preview 虽有非 brick 槽位分配，不能代表生产执行已支持。

FSU 的两条路径不能混用：`oneFillCreationGF` 只生成品质、稀有度、最低 OVR 和很窄的 rarity group 条件，遇到 `TEAM_RATING` 或 `CHEMISTRY_POINTS` 会清空填充条件；`getTemplate` 则从 FUTBIN/FUT.GG 方案导入概念阵，再用库存卡替换并调用 `meetsRequirements()`。此外它已有按需求搜索、评分计算、参考方案和概念球员批量购买等辅助功能；不能把“一键填充不支持 Puzzle”扩大为 FSU 完全没有 Puzzle 辅助能力。这些功能保留，FCAT 新增独立 Puzzle planner，并复用现有库存/保护合同。

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
- 规划预算耗尽时返回 `planning-limit`，不能伪装成缺卡。若用户允许补卡，缺口必须转成共用 Trade 模块的 Market Order；订单先经过价格上限、硬币保留、Transfer 容量和用途预约检查，买入取得精确 receipt 后刷新库存，再用新快照重新规划，不能在同一份旧快照上继续提交。

交付顺序是“单阵计划 -> 用户确认填阵/提交 -> 奖励和库存对账 -> 多阵联合规划 -> 有界批量”。自动买材料属于独立的 Market Order，开包、领取 Pick 和连续 solve-all 也各有事务门禁；它们不能偷偷夹在一次提交里，但可以在合同和恢复证据通过后由 Routine 编排。也就是说，solver 的最终职责是实际解题并提交，不是永远停在只读预览。

#### 3.1.1 需求从哪里来

需求读取不依赖用户复制页面内容。用户登录 EA Web App 后，Runner 在页面内通过 FC27 EA adapter 完成以下过程：

1. 从 EA 当前注册的 SBC Set/Challenge repository 或 DAO 读取活动列表，并用稳定的 Set ID、Challenge ID、奖励 ID 和完成次数建立候选索引。名称只用于显示，不能用来判断 SBC 类型。
2. 对用户选中的 Challenge 发起一次有界的精确读取，取得人数、阵容槽位、最低/最高评分、化学、联赛/国家、卡种、特殊卡数量、动态 eligibility group、重复次数、奖励和提交状态等原始字段。
3. 将 EA 实体转换成可序列化的 `ChallengeContract`。原始 group id、values、count 必须保留；`meetsRequirements` 这类运行时函数只作为适配器绑定的 matcher，不能塞入序列化合同。关键字段缺失、身份不一致或只有名称描述时，界面显示 `Unsupported`，不生成可提交计划。
4. 读取当前 Club、Storage、Transfer、Unassigned 的真实库存快照。FSU 只提供材料过滤、Lock 和库存兼容策略；它不是 SBC 要求的权威来源。
5. 纯 Planner 在这份快照和 `ChallengeContract` 上生成阵容计划。工具界面只渲染该计划，并记录输入版本、Challenge identity 和计划指纹。

因此用户仍在 EA 原生 SBC 页面查看挑战和阵容，FCAT 只在右侧栏提供计划、保护和确认面板；数据来源仍是 EA 的实时合同。点击“确认并提交”前必须重新读取同一个 Challenge 和库存；如果要求、完成次数、奖励、库存版本或 matcher 发生变化，旧计划立即失效并要求重新规划。提交后再读取 Challenge、库存和奖励回执，只有消费 item ID、完成状态和奖励实体都能对账，工具才显示成功。

如果 EA 页面没有暴露可验证的 Challenge/DAO/同源响应，工具先进入“规则探测”流程：只读记录方法指纹、原始 requirement 行、请求/响应字段形状和页面校验结果，生成脱敏 fixture，并用一个低价值、未提交的候选阵验证 matcher。探测结果经过合同测试和真实页面复核后，才能把该规则加入 Planner；在此之前仍显示 `Unsupported`，不能仅凭截图、名称或猜测继续填阵，更不能在需求未知时提交。

未知规则不是永久放弃，而是一个独立的适配任务：`observe -> fixture -> matcher -> preview -> low-value validation -> enable`。探测过程中不得调用 Fodder GG 私有求解接口，也不得用一次成功的网页点击替代 EA 规则合同。

静态 bundle 中没有 `streamlined` 这一明确功能标识。虽然 Gallery 文案出现 `points`、`tokens`，这只能说明存在 Gallery/积分展示，不能证明存在 Streamlined SBC 选材、分批贡献、积分结转或提交实现。FC27 积分流程必须以 Web App/Companion 的真实 DTO 和一次低价值事务为证据。

当前 `27.0.1` 已将“Read requirements”接入正式面板：它可以展示经过方法指纹验证的 catalog 原始 requirement 行；当前传统 Planner 仍只接受已验证的玩家数量、最低/最高评分和整队品质三类条件，化学、联赛/国家组合、复杂 rarity/group、多阵 Puzzle 会明确停止为 Unsupported。下一步会针对这些规则建立脱敏 fixture 和探测 matcher；原始行展示不等于完整 solver。

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

#### 3.1.2 无 AI 核心与可选 LLM

确定性求解与 AI 分层：默认先运行本地 Planner；后续模板热启动、局部修复和市场候选联合规划也不以 AI 为前提。LLM 只帮助选择有界策略，不直接产生可执行十一人阵容，不裁决 EA 规则，不扩大材料或交易授权。具体开发接入见 [可选 LLM 配置](FC27_LLM_ASSISTANT_ZH.md)。

2026-09-25 首批实现三种可配置协议：`chat-completions`、`responses`、`gemini`。endpoint 与 model 自填，不绑定某个厂商；DeepSeek/其他模型可以由兼容 Chat Completions 的服务提供，Gemini 可选择兼容服务或原生 `generateContent`。使用 JSON 指令循环，不依赖大型 Agent 框架或提供商原生 function-call 格式。严格本地 schema 校验始终开启，服务端 `json/schema/text` 输出选项只影响请求格式，不影响本地安全检查。

当前唯一工具 `run_puzzle_planner` 接受 `balanced/low-rating/nation/league/club` 搜索排序提示；不会删候选、改要求、扩大评分或改变 Storage 优先。先用本地默认策略；只有 `FC27_PUZZLE_SEARCH_LIMIT` 才允许模型辅助，未知规则/缺失数据/明确候选不足不发送给模型继续猜解。候选分组、评分分布与规则经过双层白名单投影后发送；不上传 account scope、item/definition ID、卡名、完整库存或原始 EA 响应。每次模型返回后重读本地上下文/策略/Club 指纹，变化即停止。

调用默认最多 3 次（核心硬上限 4 次），每次输出最多 2,048 tokens；每次规划最多 50,000 节点，会话默认共 150,000 节点。不自动重试 400/401/429，不跟随重定向，不把密钥从旧 endpoint 转发到新 endpoint。已有本地可行解时零模型请求；AI 不可用仍保留本地结果，可以重新执行普通 `puzzle`。本阶段没有模型选卡、买卡、模板/查价工具，不能宣称完整 AI Solver 或最低价优化已完成。

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

SBC Studio 是计划和审计工作区，不替换 EA 的 SBC 球场。用户从 EA 原生 Challenge 右侧栏点击 `FCAT 解题填充`，再在面板内选择策略和确认；EA 原生页面继续负责显示要求、球场和最终提交按钮。工作区内部分为 `Traditional Puzzle`、`Streamlined Points` 和 `Advanced/Legacy` 三个标签：

- Traditional：当前挑战的要求摘要、解题候选、保护拦截、预计奖励、单次确认；不要求用户逐张点击卡片。
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

- 读取 FC27 页面真实 Set/Challenge、Gallery、Transfer DTO 和能力状态；未知字段先进入有界规则探测，不用名称猜测。
- 为 Traditional、Streamlined、Gallery、Trade 建立最小脱敏 fixture。
- 在 FC27 生产入口中移除默认导入的 FC26 Rolling、Swap、完整 Builder 和 Trade Scheduler；旧代码保留在回归构建。
- 用 esbuild metafile 和架构测试确认默认入口只带当前阶段模块。

门禁：未知合同只能显示 Unsupported；`npm run verify` 和现有 FC26 regression 均通过。

### W1：Puzzle MVP（计划、填阵、提交）

- 实现传统 Challenge 扫描、约束规划、Preview、用户确认、填阵、保存、提交和奖励/库存对账。
- Solver 发现缺卡时直接生成 Trade Order 草案；由共用 Market/Trade 事务执行买入并取得精确 receipt，买入后刷新库存并重新规划。
- 对化学、国家/联赛、动态 group 和 brick 等未知规则先完成 `observe -> fixture -> matcher -> preview` 探测，验证通过后再开放对应执行路径。
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

### 10.1 生产面板只读合同采集（2026-09-25）

在用户完成登录后，专用 Chrome 通过生产入口面板读取当前 EA SBC catalog。面板刷新后观察到 9 个 Set；Bronze Upgrade（Set 4）为单个 `NOT_STARTED` Challenge，规则是整队铜卡；Marquee Matchups（Set 19）为四个 Challenge，其中一个 `IN_PROGRESS`，其余三个 `NOT_STARTED`。进行中的 Challenge 包含国家组合、联赛/俱乐部、卡品质、化学或动态 group 等原始规则，面板逐行保留 `count/scope/pairs`，目前对未审查 key 显示 `Unsupported requirement — retained for inspection`。

本次只执行了经过方法指纹校验的 Challenge catalog GET 和面板展示。Set 奖励来源显示为 `cached/unverified`，Challenge 奖励来自本次响应但仍未授权执行；没有调用 Challenge 初始化、读取阵容、保存、提交、开包、移动、交易或任何账号写接口。脱敏样本见 `tests/fixtures/fc27-production-panel-catalog-observation.json`。

为减少人工操作，`scripts/browser-inspection/agent-session.mjs` 增加了窄范围 `panel-catalog [set-id]` 命令：它只打开生产面板、触发 `Refresh targets`、以真实鼠标事件点击 `Read requirements` 并读取 `dataset.result`，不提供任意脚本执行入口；面板缺失时最多刷新页面一次以重新注入 Tampermonkey。该命令的浏览器报告仍标记 `liveExecutionEnabled:false`。生产入口生成文件的默认 `inspectCatalog=null` 也已同步构建。

这批证据不能宣称 Puzzle solver 已完成。Set 19 的多阵联合规划、化学/联赛/国家/动态 group 精确 matcher、Challenge 初始化后真实阵容读取，以及填阵、保存和提交仍属于 W1，必须在新的 fixture、跨阵原子性边界和低价值账号授权后逐项实现。

### 10.2 Puzzle 只读规划核心（2026-09-25）

本批实现了 W1 的离线/独立只读核心：`src/fc27/sbc-requirements.js` 保留 EA 原始 `key/scope/values/count` 并按已观察 FC27 枚举解析；`src/fc27/puzzle-preview.js` 复用现有 FSU 材料保护和候选筛选，在固定搜索预算内按稳定顺序回溯组合，检查唯一 `definitionId`、brick 槽、国家/联赛/俱乐部、品质档、稀有度和动态 group。它只返回 `preview` 或带原因/缺口的 `blocked`，不填阵、初始化 Challenge、保存、提交、移动或买卖。

库存快照现在保留已观察的 `nationId`、`teamId`、`basePossiblePositions`、`groups`，运行时只读观察同时记录化学参数阈值、profile 和能力枚举。队伍评分和化学必须由调用方注入经过审查的纯评估器；缺少可靠事实时返回 `FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE`，不会用简单平均、卡面名称或 Fodder GG 结果猜测。`scripts/browser-inspection/agent-session.mjs` 增加 `puzzle <setId> <challengeId>` 命令，使用独立 Puzzle read adapter，仅允许当前 `IN_PROGRESS` Challenge 的 catalog/squad GET 和缓存读取。

已进一步核对 EA `clubCounter/getNumberOfPlayersByClub`：国家、联赛按实体字段计数；俱乐部关系必须应用 `TeamConfig.teamLinks`。纯 matcher 和规划器现在要求完整映射快照（显式空表可用，缺失/截断不可用），独立 Adapter 用 Map 内建操作复制完整表，不调用 EA getter 或页面方法。此合同已做合成回归，重新登录后的实机读取确认完整映射有 64 条。

实机本批确认 9 个缓存 Set、314 个 Club 条目，其中球员 306 名；这不表示 fresh 全量库存。六张脱敏样本具备国家、球队、联赛、可踢位置和 groups。化学参数的实际阈值为：国家 2/5/8、联赛 3/5/8、俱乐部 2/4/7，每档加 1；它们只是当前配置观察，未硬编码为求解器默认值。样本见 `tests/fixtures/fc27-puzzle-runtime-observation.json`。EA 编译代码还显示评分公式受配置开关影响，化学使用位置、关联球队和 profile，需读取配置并作差分验证。

缺口报告仅表示当前安全候选视图下某条规则的最低缺额；不同规则缺额可能重叠，不能相加为采购数量，也不能从缺额猜 definition ID。搜索超限单独返回 `FC27_PUZZLE_SEARCH_LIMIT`，不自动生成买单。后续 Market 必须先取得具体卡版本、报价、预算和用途预约，再确认采购；receipt 成功、库存刷新和重新解题仍是必需步骤。

当前仍未完成：FC27 真实 Chemistry/Rating 公式差分、复杂 brick 和多阵联合规划、原生侧栏按钮、填阵/保存/提交，以及共用 Trade receipt/库存刷新闭环。初始实现按稳定槽位排列；后续有界位置匹配与搜索见 10.4。规划核心只找固定预算内的首个可行组合，不保证最低价格。即使返回 `preview`，也不能据此授权 Live 或宣称具备 Fodder GG 完整解题能力。

为加载新增的 `puzzle` 命令，专用浏览器曾重启并返回登录页；用户再次登录后，新增 Adapter 已执行实机检查，结果见下一节。版本保持 Runner `27.0.1` / FSU Local `26.09.9`，生产包增加库存字段、等价候选筛选拆分和默认不启用的阵型字段投影；Puzzle 核心及检查 Adapter 不进入生产构建，FSU 维护源不变。

### 10.3 登录后 Puzzle Adapter 实机检查（2026-09-25）

在原生 Home 页面执行 `puzzle 19 43`，不用进入或修改阵容即可通过已审查的 catalog GET 和进行中 squad GET 取得 Italy v Belgium 的需求及槽位：11 人、无 brick、formation 16，位置序列为 `[0,3,5,5,7,12,14,14,16,25,25]`。阵型通过 `_formation.positions[].typeId` 的 data descriptor 复制，不调用 getter；共享读取入口只有显式 `includeFormation:true` 才返回此投影，传统读取默认结果不变。

本次观测为 309 个 Club 缓存条目、301 名球员；在最高 74 分和既有 FSU 策略下有 47 名安全候选，排除 254 名（评分范围 232、可交易/未知 14、排除联赛/未知 8）。这些为 Club-only provisional 数据，不表示 fresh 全量库存。5 条规则全部解析：意大利/比利时至少 1 人、至少 3 个俱乐部、至少 3 张银卡、最低 Bronze、化学至少 14。64 条关联球队映射完整复制；化学 profile 枚举确认为 BASE=1 / ICON=3 / HERO=2，NORMAL=1 / UNIVERSAL_WITH_PLAYER_COUNT=2，profile override 字段也已保留。

最终停止码 `FC27_PUZZLE_TEAM_FACTS_UNAVAILABLE`，`nodes=0`、`selectedCount=0`，原因是尚未注入验证过的化学评估器。它不是请求卡死，也不证明库存无解；47 名候选仅通过材料保护，不能据此承诺能满足化学 14。下一步先读取评分/化学开关，再完成位置分配及与 EA 计算的差分验证，然后才能评估整阵可行性。脱敏证据见 `tests/fixtures/fc27-puzzle-plan-observation.json`；对应回归使用合成卡片重放真实规则，不保存真实卡库或账号身份。

这次 Agent 没有初始化 Challenge、填阵、保存、提交、开包、移动或交易。专用浏览器会话保留，无需用户复制日志。本批最终 `npm run verify` 通过 249 文件 / 2,577 项测试；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 43 文件 / 590 项测试及离线浏览器 smoke。构建为 143,673 bytes，root/dist、版本、FSU patch replay 和发布资产检查通过；这不等于 Puzzle Live 验收。尚未更新 Tampermonkey 安装、提交或发布。

### 10.4 化学评估、位置搜索与首次可行预览（2026-09-25）

用户退出主机 Ultimate Team 并进入专用浏览器后，沿用当前登录会话进行只读检查，无需复制日志或修改阵容。本轮定位并修复两个新 Puzzle 路径问题：

1. 配置读取：EA 的 `checkFeatureEnabled` 位于原型上，之前适配器用 `ownData` 只读自身属性，导致误报 `FC27_PUZZLE_CHEMISTRY_CONFIG_UNAVAILABLE`。现在对两个配置读取方法（含 `getStringSettingByKey`）使用最多 5 层的 descriptor 查找，遇 accessor 即停止，不执行或越过 getter。共享 `ownData`、传统 Live 及 FSU 源未改。
2. 搜索效率：低评分优先组合加位置全排列在 47 名候选上耗尽 50,000 节点。现在在不改变候选集合和材料保护的前提下，优先搜索国家/联赛/关联俱乐部联系更强的候选；配置的 Storage 优先顺序保留。位置先做最大匹配，再做有界排列；普通卡化学上界证明不达标时跳过排列。组合、上界、匹配和评估共用预算；超限不等于缺卡，不自动生成买单。

新增纯 `puzzle-evaluator.js`，接收当前 EA 参数阈值、完整关联球队、profile、特殊身份常量及显式化学/浮点评分开关。缺少配置仍停止，不猜默认值；无队伍评分/化学要求的 Puzzle 不额外要求这些配置。评估器按完整 11 槽位和实际 formation 计算，普通 brick 以 `null` 传递；越位卡仍可作为材料，但不贡献普通化学。复杂 brick、特殊 profile 和未知规则继续拒绝。评分同时覆盖整数与浮点分支，不用简单平均。

最新实机 `puzzle 19 43` 结果：

| 项目 | 观察结果 |
| --- | --- |
| 库存 | 332 个 Club 缓存条目，其中 324 名球员；Club-only provisional，不是 fresh 全量 |
| 策略 | 最高 74 分及原 FSU 保护不变；47 名安全候选，277 名被既有保护排除 |
| 配置 | chemistry profiles 开启、浮点评分开启；4 个 profile、super-chem rarity 列表显式为空；64 条关联球队 |
| 计划 | `preview / READ_ONLY_PLAN`，11/11 人，所选卡面评分 65–71 |
| 本地计算 | 化学 17（需求至少 14）、队伍评分 68；尚非 EA 独立确认 |
| 搜索 | 43 节点：组合 15、位置 26、评估 1、上界 1 |

聚合证据见 `tests/fixtures/fc27-puzzle-evaluator-observation.json`，不包含账号或真实 item/definition ID。回归覆盖继承配置方法、getter 遮挡、显式 true/false/未知开关、无效配置、完整 11 槽/尾部 brick、不可变评估输入、越位解、小规模全排列对照、剪枝失败与预算超限区分、关联候选搜索和已有传统保护。评估器回调内的断言已移到回调外，避免被异常隔离捕获后产生假阳性。

本轮未接入生产 Puzzle 入口，未更新 Tampermonkey 安装，未填阵、保存、提交、开包、移动或交易；Runner 保持 `27.0.1`、FSU Local 保持 `26.09.9`，未提交、推送或发布。下一步是对脱离真实阵容的同一方案做 EA 计算差分验证，再接原生 SBC 侧栏预览及 fresh 校验后的填阵事务；真实账号写入另行确认。市场补卡仍按共用 Trade receipt、库存刷新、重新规划的路线实施。

本轮验证：聚焦测试通过 5 文件 / 71 项；`npm run verify` 通过 251 文件 / 2,601 项，语法、未定义变量、架构、配置、FSU patch replay、构建和资产一致性检查通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 45 文件 / 614 项及离线浏览器 smoke。生产构建仍为 143,673 bytes，root/dist 与版本一致，FSU 资产仍为 `26.09.9`；`git diff --check` 通过。Node/offline smoke 不替代 EA 公式差分和真实业务验收。

### 10.5 可选 LLM 与自定义中转开发接入（2026-09-25）

已实现协议与服务商分离的配置：`chat-completions`、`responses`、原生 `gemini` 均接受用户指定的完整请求 URL 和模型名。DeepSeek 或其他模型可通过兼容 Chat Completions 的端点接入，Gemini 也可由兼容服务提供；不能仅凭品牌声称已验证某个中转。服务端 JSON/schema 输出模式可选，本地始终检查严格 JSON action。具体配置、限制和启动方法见 [可选 LLM 助手](FC27_LLM_ASSISTANT_ZH.md)。

AI 默认关闭。每次先运行本地 Puzzle planner，只有搜索预算耗尽时才让模型选择 `balanced/low-rating/nation/league/club` 重排策略；已有可行方案、未知规则、配置缺失或明确的安全候选不足均零模型调用。模型不能修改候选集合、材料保护、Storage 优先、规则或最终评估，也不能直接指定十一人阵容或执行账号操作。默认最多 3 次请求、每次 20 秒及 2,048 output tokens，本地每轮最多 50,000 节点、整个会话最多 150,000 节点。无效响应、重复策略、输入漂移、超时和限流均停止本次 AI 尝试；本地结果保留，普通 `puzzle` 命令独立可用。

新增 `StartFCAutomationToolAIInspection.ps1`；后续按用户要求支持仓库外 `%LOCALAPPDATA%\FCAutomationTool\ai-inspection.json` 一次配置、免重复输入。首次导入将 Key 与精确 endpoint/协议一起用 Windows 当前用户 DPAPI 加密，清空明文 `apiKey`；`-SaveConfig` 可不启动浏览器直接导入，`-SetKey` 可隐藏输入，`shareAggregates` 默认 false。解密后的密钥只留在本机检查进程，不注入页面或继承给 Chrome；没有读取其他程序或当前聊天会话的凭据。启动前精确检测专用 profile 占用，保留登录数据及旧进程，失败提供明确阶段。两层白名单只发送需求、分组计数、评分分布和搜索摘要，不上传账号、item/definition ID、完整卡库、原始 EA 对象或模型推理。HTTP 禁止 Cookie 和重定向、响应限 128 KiB；协议/地址/模型不会自动切换，付费请求不会自动重试。

当前接线位于专用浏览器检查器：`ai-test` 发送合成连接测试，无需 EA 登录；`puzzle-ai <set-id> <challenge-id>` 要求登录并仅观察进行中的 Challenge。正式 Tampermonkey 面板、FSU 维护源、生产网络权限和事务入口没有接入 AI。配置本机 API 后仍需实际验证所选服务商；本批未调用外部模型，未填阵、保存、提交、开包、移动或买卖，不能据自动测试宣称真实 AI 或 EA 业务验收完成。

验证已完成：聚焦 6 文件 / 83 项；`npm run verify` 255 文件 / 2,656 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 49 文件 / 669 项及离线浏览器 smoke。覆盖三协议 localhost HTTP 实际收发、重定向拒绝、超时/取消、响应上限、JSON/schema 拒绝、聚合脱敏、密钥隔离、登录/输入漂移门禁以及搜索超限后由模型策略推动本地求解成功。PowerShell 启动器语法解析通过，未输入真实 key 启动。构建与 10.4 同为 143,673 bytes，root/dist 和版本一致，FSU patch replay 与资产检查通过；Runner 仍 `27.0.1`，FSU Local 仍 `26.09.9`，未提交、推送或发布。模板、市场补卡、多阵优化、正式面板和 Android 接入仍是后续任务。

### 10.6 市场补卡联合规划与安全边界（2026-09-26）

已完成开发期的市场补卡规划核心。`market-catalog.js` 规范化 FC27 赛季目录和有时效的报价索引；`puzzle-market.js` 把 FSU 安全候选、Club 库存和有报价的目录候选放入同一个有界搜索，按额外金币成本、购买数量、预算、单价上限和最低留存金币优化。市场候选只表示 `definitionId/catalogRef` 假设，不伪造 EA `item.id`，也不会绕过锁卡、Active Squad、Evolution、特殊卡、联赛或交易属性保护。`puzzle-market-session.js` 只把国家/联赛/关联俱乐部的计数和价格下界交给可选 LLM；模型只能选择有限路线，本地规划器仍是唯一决定者。买入闭环仍要求重新核价、明确批准、精确购买回执、刷新库存、重新规划和单独 SBC 确认。

新增 `puzzle-market` / `puzzle-market-ai` 只读检查命令及 51 项市场目录、联合规划、会话和输入读取回归测试；共享 LLM 测试补充市场聚合与改善预算场景，运行时观察测试补充两项市场方法描述符场景。输入快照采用有界循环读取，短读、截断、增长、时间戳变化和超限均安全停止；五次策略和总节点预算耗尽后不再向 AI 宣称仍可改善。FC27 专项验证 `node scripts/verify-fc27-prelaunch.mjs --browser` 已通过 54 文件 / 734 项及离线浏览器 smoke；这不是 EA 市场业务验收。

最终 `npm run verify` 通过 260 文件 / 2,721 项，包含语法、未定义变量、架构、配置、FSU patch replay、构建和资产一致性检查。生产构建仍为 143,673 bytes，Runner 保持 `27.0.1`、FSU Local 保持 `26.09.9`；本批市场规划代码没有加入生产入口，也没有更新安装、提交、推送或发布。

本轮浏览器 `inspect` 仅证明当次报告中的 FC27 页面不是登录页、SBC/Club 对象存在、Club 缓存约 332 条；FSU 为 `trusted-provisional`，报告明确是被动描述且样本被截断，没有完整 FC27 球员目录、报价平台/赛季证据，也没有调用 EA 市场搜索合同。运行时观察现在只记录 `services.Item`、`UTSearchCriteriaDTO` 及 `searchConceptItems`、`searchTransferMarket`、`requestMarketData` 的数据/函数/accessor 描述，不会调用或构造请求；报告会明确 `NO_MARKET_CONTRACT_VERIFICATION`。因此当前仍只能生成开发期只读预览，`marketAvailabilityVerified:false`、`executable:false`；不能把 Club 缓存当作市场目录，也不能买卡或提交 SBC。下一步是增加经过方法指纹审查的 FC27 只读目录/报价 Provider，并用脱敏真实响应 fixture 验证平台映射、分页、报价 TTL 和重复 definition 处理；在此之前保持阻断。

### 10.7 EA 市场只读探针（2026-09-26，真实响应已取得；采购仍阻断）

最新 `agent-2026-09-26T01-45-20.358Z.json` 由用户在已登录专用浏览器执行 `market-probe` 取得：FC27 页面已登录，探针完成 1 页银卡目录和 3 个精确版本挂牌读取，共 4 个 EA 请求，无 401/429/5xx。平台为 `PSN:FFA27PS5`；20 个公开 definition 版本中 3 个取得有效一口价观察（500、850、600），其余 17 个未查询。该结果证明当前 EA 原生只读目录/报价合同可用，但只是抽样观察，不是完整球员库、全市场最低价或可成交保证。

已增加 `src/adapters/ea/fc27-market-read.js` 和开发命令 `market-probe`。按已保存 EA bundle 审查 `/ut/game/fc27/defid` 目录及 `/ut/game/fc27/transfermarket` 挂牌读取，使用独立原生请求和确切响应归属，避开 Item Service 的共享市场缓存。`requestMarketData()` 用于价格上下限，不能用作本探针的即时一口价。请求前验证方法指纹、账号上下文和依赖；只读一页最多 20 张银卡目录，至多读取三个精确版本各 20 条、上限 2,000 金币的挂牌。800ms 最小请求间隔，超时、401/427/429/500、上下文漂移或响应异常均停止且不自动重试。报告不导出账号、item ID、trade ID 或认证信息。

该探针不写 EA Repository、不清共享缓存、不买入、挂牌、移动、填阵或提交；仍未接入正式面板和 Puzzle 实时补卡 Provider。新增 Node 投影层只把有新鲜有效挂牌观察的版本标记为 `marketable:true`，未查询版本保持未纳入，空挂牌和过期报价分别计入 coverage，绝不转成免费球员。投影后的快照已接入探针报告，但不携带 `marketPolicy`、金币余额或账号/拍卖身份；因此只能作为下一步人工审查的规划输入，仍保持 `marketAvailabilityVerified:false`、`executable:false`。

脱敏 fixture `tests/fixtures/fc27-market-probe-observation.json` 仅保存公开版本事实和报价聚合，不包含原始响应、账号、持有 item 或 trade ID。已逐项核对其目录/报价与本地真实报告一致。回放保留原始时间戳，按采样时刻可投影 3 个版本；按当前时间，超过 10 分钟的报价返回 `FC27_MARKET_QUOTES_UNAVAILABLE`，不会刷新时间冒充新报价。把这些公开事实接入合成的三人银卡缺口时，联合规划器得到 3 张、估算 1,950 金币；该测试的 Challenge、库存和预算是合成输入，不能当作账号真实 SBC 验收，也不能推断三张卡现在可以买到。

命令列表由启动时的 `agent-session.mjs` 加载；只有辅助模块按命令热加载。旧终端不认识新命令时，先用 `q` 正常退出，再执行 `node scripts/browser-inspection/run.mjs --agent --with-extensions`。沿用原专用 profile，不删除登录数据、不抢占旧进程；如 EA 要求登录，由用户处理，然后在 `agent >` 输入 `market-probe`。无需复制输出，Agent 读取本地报告。`--interactive` 不提供这些命令。

后续仍需保存并审查更多脱敏目录/报价 fixture，核对分页覆盖和 Challenge 驱动的有限查询路线，再接 fresh 补卡规划。真实报价读取已通过，但完整市场覆盖、实时余额、购买回执、自动买入和 SBC 写入仍未实现或验收。

本批聚焦验证覆盖市场投影、报价 TTL、空挂牌、短目录页和探针报告接线。最终 `npm run verify` 通过 263 文件 / 2,793 项测试，构建、FSU patch replay 与资产检查通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 57 文件 / 806 项测试及离线浏览器 smoke，退出码为 0。真实 EA 验证仅覆盖上述目录与报价读取，离线测试不替代真实补卡规划、购买或 SBC 写入验收。Runner 仍为 `27.0.1`，FSU Local 仍为 `26.09.9`；没有更新安装、消费卡片、交易、提交、推送或发布。

### 10.8 Challenge 驱动的市场查询路线（2026-09-26，真实只读观察完成）

新增 `src/fc27/market-query-route.js` 和开发命令 `puzzle-market-live <set-id> <challenge-id>`。通过既有只读 Adapter 读取真实需求、进行中的阵型、Club 缓存和 FSU 策略后，按品质与评分上限选择目录档位，优先查询有最低人数要求的国家、联赛或俱乐部，再保留通用填充候选的查询。每轮最多 3 页目录、每页 20 个版本，再选择最多 4 个不同版本查询挂牌；市场请求最多 7 次，另有 Challenge catalog 和进行中 squad 的只读 GET。每次挂牌仅观察 20 条、2,000 金币以下的一口价；查询间隔和失败停止继续使用已审查的市场 Adapter。

版本筛选排除已持有版本、特殊/进化/装饰卡、不明确的公开字段、超过当前评分上限及排除联赛；以现有库存的国家/联赛关联计数排序。查价名额会先为每个实际查询的国家/联赛/俱乐部条件保留一个合规版本，再填充通用候选，避免通用银卡挤掉触发查询的稀缺条件。这仍是有界抽样启发式，不是穷举、最低价证明或完整缺口求解：跨品质、精确人数条件、位置覆盖和复杂化学的查询路线仍需继续完善，现有库存关联计数也不代表这些库存全部可用。没有找到报价不等于市场无卡，有报价不等于购买成功。

报告将目录页、版本筛选计数、挂牌价格与请求数保存到 `puzzleMarket.marketRoute`，保留 `complete:false`、`executable:false`。`FC27_MARKET_ROUTE_OBSERVED` 表示有限查询完成；其外层 `status:blocked` 表示尚未接通可执行补卡流程，不是请求异常。`Only Untradeable` 开启时可只读观察报价，但必须标记 `materialPolicyBlocked:true`；联合规划器拒绝把市场可交易卡当作合规材料，不会自动关闭 FSU 保护。采购测试现已显式使用 `onlyUntradeable:false`，另有开启保护时的阻断回归。

真实专用浏览器报告 `artifacts/fc27-browser/agent-2026-09-26T02-43-53.637Z.json` 已观察 Set 19 / Challenge 43：11 个球员槽位、国家 27/7 合计至少 1 张、至少 3 个品质 2、至少 3 个俱乐部、最低化学 14；Club 328 张缓存仍是 provisional/club-only。3 页银卡目录共 60 个公开版本，筛选出 54 个，随后查询 4 个版本的 20/20/19/10 条一口价，最低观察价分别为 850、1700、1500、500。会话累计网络汇总为 112 次、109 成功、未授权桶（401/403）1 次、无 429/5xx；该汇总无法归因到本次 7 个市场请求或某个具体 HTTP 状态。该报告的实际选中版本恰好来自通用第三页，说明此前仅按库存关联度排序会漏掉国家 27/7 的候选；已增加条件页代表版本回归并修复。旧路线实机查询已观察，本轮排序修复仅通过脱敏目录离线回放，尚未重新实机验证。

本轮 `npm run verify` 通过 265 文件 / 2,805 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 59 文件 / 818 项及离线浏览器 smoke，两者退出码均为 0。构建仍为 143,673 bytes，Runner `27.0.1`、FSU Local `26.09.9`、root/dist 一致，FSU patch replay 与发布资产校验通过。新增脱敏回放 fixture `tests/fixtures/fc27-puzzle-market-route-observation.json`，没有接入生产 Puzzle/交易入口，没有修改 FSU 源码、安装、提交、推送或发布。

这次实机只证明只读查询合同和报价观察成功，不能当作可执行补卡验收。报告仍明确 `complete:false`、`executable:false`、`marketAvailabilityVerified:false`；最高 74 分和 `Only Untradeable=true` 来自开发检查预设，不能直接解释成用户的 FSU 设置。因此 `materialPolicyBlocked:true` 是当前预设的预期结果，市场可交易卡不会被当作 SBC 材料。该命令本轮用查询路线 callback 替代求解，`safeCandidates:0` 与 `nodes:0` 是占位值，不表示库存没有安全材料或已证实无解。下一步是以明确材料策略和预算，将新鲜报价接入库存+市场联合规划；购买还需重新核价、明确批准、精确购买回执和库存重规划。全量市场覆盖、实际金币余额、购买回执与 Puzzle 填阵/提交仍 Pending。

### 10.9 Puzzle 精确材料复核与右侧只读结果（2026-09-26）

用户再次运行 `puzzle 19 43` 的最新报告 `agent-2026-09-26T04-44-09.039Z.json`（观察时间 `2026-09-26T04:44:45.428Z`）返回 `preview / READ_ONLY_PLAN`：338 名 Club 缓存球员中有 47 名安全候选，选择 11 人，43 搜索节点；本地计算化学 17、评分 68，需求化学至少 14。其余 291 名被既有策略排除（评分 267、类型/pile 2、交易属性 14、联赛 8）。随后对 11 张选中 Club 卡执行了一次有界精确读取，`exactValidation` 为 `verified`，11/11 present、definition 唯一。网络累计 90 次请求中 87 成功、未授权桶（401/403）1 次、无 429/5xx；该汇总无法归因到某个请求。该结果证明当次 provisional Club 快照及选中实体通过精确复核，不需要据此前市场命令的占位 `safeCandidates:0` 买卡；仍不证明 EA 已确认本地化学/评分，也不是填阵或提交许可。脱敏证据为 `tests/fixtures/fc27-puzzle-owned-recheck-observation.json`，没有账号、item/definition ID 或完整库存。

本轮实现：

- 新增开发期 `fc27-puzzle-verify.js`，在原只读规划 callback 中保留选中 refs 和原始规范化字段；沿用 `createFc27ClubReadTransport()`，只对至多 11 个 definition 发起一次有界 Club 定向搜索。该读取在 EA 原生合同中是 `POST /club` 搜索，不是写入。没有全量分页、重试、缓存改写或阵容改动。最新专用浏览器实机已返回 `exactValidation.status=verified`，这只授权把该次结果作为临时预览证据，不能跨刷新或复用于执行。
- `validateFc27PuzzleSelection()` 同时核对确切 item ID、definition ID 和原计划对应关系，以及评分、rarity、国家、联赛、俱乐部、位置、groups、交易/租借/特殊/进化/装饰等字段。服务器返回另一个同版本 item 不能替代原计划；满页、重复响应身份、不相关版本、缺失、未知字段或属性变化均以 `FC27_EXACT_ITEMS_CHANGED` 阻断，不换卡。
- 读取前后核对账号/平台、FSU 策略、选中卡的本地快照、关联球队与化学配置；漂移以 `FC27_RUNNER_INPUTS_CHANGED` 停止。HTTP 429/超时等保留脱敏停止码，不导出原始异常或 item refs。成功仅报告本次选中材料 `exactValidation`，不会把整个 Club 升级为 ready；该结果不允许复用于后续写入。
- 现有检查终端的 `puzzle` 命令在每次运行时重新打包新 helper，不要求重启或重新登录。先清理旧结果面板，再求解、精确复核、显示开发期右侧 `FCAT · Puzzle 只读验证` 面板。面板展示人数、评分/化学及槽位评分，只有关闭按钮；不含球员姓名/身份，也不是原生 SBC 侧栏的正式填充按钮。显示失败不能改变验证结果，失败报告不展示旧方案。
- 保持原 Planner 的 selected/ref 合同及市场 `catalogRef` 不变；不把精确字段加入通用求解器输出，不调用 LLM/Market，不修改正式面板、传统 Live transaction 或 FSU。`puzzle-ai` 与市场命令本轮不增加这次精确读取。

验证：`npm run verify` 267 文件 / 2,820 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 61 文件 / 833 项及离线浏览器 smoke 均通过。覆盖缺失、错版本、同版本不同 item、位置变化、重复响应、策略/选中卡/化学/关联球队漂移、错误隔离及不重试；离线 UI 用上述真实聚合报告验证未校验状态，使用显式合成 exact-success 覆盖成功显示，检查失败清空、转义、关闭和 1280/390/320 宽度。合成 UI 的“11 张通过”不是实机证据。

Runner 保持 `27.0.1`，FSU Local 保持 `26.09.9`；生产构建 143,673 bytes，root/dist、FSU patch replay 和资产检查通过。没有安装更新、消费卡片、提交、推送或发布。最新实机已验收精确 Club 复核；`EA_TEAM_FACTS_DIFFERENTIAL` 和 `PUZZLE_FILL_TRANSACTION` 仍 Pending，后续应在脱离真实阵容的模型上完成 EA 计算差分，再实现逐次确认且重新读取材料的填阵事务。

### 10.10 EA 计算入口实机指纹（2026-09-26）

新增开发期 `fc27-team-facts-probe.js`，随已有 `puzzle` 命令热加载。只检查三个工厂/仓库对象和八个明确的 EA 原型，每个最多 256 个描述符、单个方法源最多 65,536 字符；输出方法名、参数数量和 SHA-256，不调用方法/构造器/getter，不导出源码、账号或球员身份。即使方法存在，报告仍为 `FC27_EA_TEAM_FACTS_UNVERIFIED`，不删除差分 Pending。

用户完成本轮检查，报告 `agent-2026-09-26T05-04-05.843Z.json`（`2026-09-26T05:04:53.593Z`）为 `READ_ONLY_PLAN`，343 名缓存球员、47 名安全候选，11/11 精确 Club 复核通过，本地化学 17/评分 68。脱敏方法证据见 `tests/fixtures/fc27-team-facts-probe-observation.json`。

已将本地保存的 EA `compiled_2.js` 方法源与真实页面 SHA-256 比较：`_calculateRating`、`calculateChemistry`、`isRequirementMet`、`meetsRequirements` 和底层 `UTSquadChemCalculatorUtils.calculate` 匹配；`getRating` 与 EA 源不匹配，但与本地 FSU 覆写的函数源精确匹配。该覆写会顺便更新页面阵容总价，因此不能把方法名或 EA 原型来源当作原生只读实现证明，也不能据此推断整个 FSU 安装版本。源码表明 `_calculateRating` 修改接收对象 `_rating`，`calculateChemistry` 写入阵容及各槽位化学字段，均不能直接在当前真实 squad 上调用。底层计算器依赖与隔离执行合同仍待审查。

下一步为隔离计算：对同一槽位排列和材料构造脱离 Repository 的输入，逐一审核计算器及其依赖指纹，比较 EA 与本地评分、化学和每条 requirement。不能以本轮方法存在、材料复核或某一次数值相等直接开放填阵；通过后再接原生 SBC 侧栏计划/确认入口和 fresh 材料校验。

本轮完整验证 268 文件 / 2,824 项，FC27 专项 62 文件 / 837 项及离线浏览器 smoke 通过。首次 smoke 暴露上一节夹具已更新为真实 `exactValidation=verified`、测试仍按未验证状态断言的失配；现改为回放真实已验证状态，并单独构造无校验覆盖，修正了上一节关于该 UI 回放的过期描述。生产构建与 FSU 不变；本轮未填阵、保存、提交、购买、推送或发布。

评分子项随后完成隔离差分：`scripts/browser-inspection/ea-rating-differential.mjs` 只接受当前报告的 11 张评分、float 开关、精确 Club 校验和实时 `_calculateRating` 指纹；它从本地已审查 `compiled_2.js` 提取同一函数，放入禁用代码生成的 Node VM，以复制数据得到 EA 评分。真实报告的本地 68 与隔离结果 68 一致，返回 `FC27_EA_RATING_DIFFERENTIAL_MATCH`。这不是完整 EA 队伍事实验收：化学计算器仍依赖未公开的内部注册链，`calculateChemistry` 会写回对象，逐条 `isRequirementMet` 也需要隔离 Squad/Challenge；因此 Puzzle 填阵、保存和提交继续阻断。

### 10.11 普通卡化学隔离差分接线（2026-09-26，实机结果待复核）

用户再次执行 `puzzle 19 43` 后，报告 `agent-2026-09-26T05-04-05.843Z.json` 的观察时间更新为 `2026-09-26T05:35:58.037Z`，仍为 343 名缓存球员、47 名安全候选、11/11 精确复核通过，本地化学 17 / 评分 68。该次检查只取得方法描述符和聚合结果，没有保存所选球员的化学输入，不能拿它事后伪造真实化学差分。

新增 `scripts/browser-inspection/ea-chemistry-differential.mjs`，接入已有热加载 `puzzle` 命令。一次精确复核成功后，开发 Adapter 只把选中卡的类型、评分、rarity、国家/联赛/俱乐部、位置和普通卡保护标记，以及阵型、化学配置投影到临时回调；不传 account、item/definition ID 或其它库存。该数据经本机浏览器控制通道传到 Node 内存，校验后只返回聚合差分报告，不保存到 JSON、不发送给 LLM 或外部服务。新增回调仍检查输入漂移；阻断时不输出临时输入，畸形报告封装也不允许把整个 payload 当作报告落盘。

隔离计算只提取本地已审查的 13 个 `UTSquadChemCalculatorUtils` 方法，逐一核对文件源码 SHA-256 与页面实时指纹；完整 bundle 不执行、不打包、不随仓库分发。禁用动态代码生成的 Node VM 内使用复制数据构造普通卡、化学配置读取、关联球队查询和计算结果容器，150ms 超时且没有页面/宿主函数。先重算本地输入并核对原计划，再比较 11 个位置的化学分和总分；它明确是 `isolated-ea-ordinary-chemistry-algorithm / detached-data-facades`，不是 EA 实体构造链或服务器接纳证明。

范围为 11 张不高于 74 分、无经理/砖块/特殊卡、已精确复核的普通卡，要求当前评分差分先通过。已用合成输入覆盖全关联 33、错位 30、无关联 0、关联俱乐部 2 及启用普通 profile 33；五类均逐槽匹配。源码或页面指纹变化、未知配置、材料/阵型/评分漂移和原始异常均停止。测试额外覆盖回调的属性白名单、深复制、漂移、失败不暴露材料，以及正常/异常报告不落盘临时输入。真实 EA bundle 仅存在于忽略的本地 artifacts：纯保护测试始终执行，依赖该文件的隔离算法回放在干净检出明确 skip，不将 skip 算作已验证。

最新一次实机检查（同一会话，无需重新登录）已完成化学差分：`puzzle.eaChemistryDifferential` 返回 `FC27_EA_CHEMISTRY_DIFFERENTIAL_MATCH`，本地 17 与隔离 EA 17 一致，11 个位置全部匹配；评分仍为 68 对 68，11/11 Club 精确复核通过。因此不需要再重复验证评分或化学。仍待一次性完成逐条 requirement 差分，然后接 fresh 材料复核及用户逐次确认的填阵事务；`PUZZLE_FILL_TRANSACTION` 继续阻断正式写入。Runner `27.0.1`、FSU Local `26.09.9`、正式入口和已发布资产不变。

本轮验证：`npm run verify` 通过 270 文件 / 2,856 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 64 文件 / 869 项及全部离线浏览器 smoke；本机存在已审查 EA 文件，因此上述算法回放实际运行、没有 skip。`git diff --check` 通过，仅已有 CRLF 转换提示。生产构建仍为 143,673 bytes，root/dist 一致，FSU patch replay 和资产校验通过。未修改正式入口/FSU 源码，未安装、填阵、保存、提交 SBC、购买、Git 提交、推送或发布；既有未提交修改全部保留。

### 10.12 条件差分、固定填阵事务核心及正式构建接线（2026-09-26）

最新报告 `artifacts/fc27-browser/agent-2026-09-26T07-19-44.787Z.json` 已一次性核验 Set 19 / Challenge 43：本地与隔离 EA 评分均为 68、化学均为 17，11 个位置化学一致，五条 requirement 均判定满足，23 个方法指纹匹配。报告为 `preview / READ_ONLY_PLAN`，只剩 `PUZZLE_FILL_TRANSACTION`。这批只读证据已经完成，无需用户再次运行同样命令；隔离算法匹配仍不代表 EA 服务器已接受保存或提交。

新增 `puzzle-fill-plan.js` 与 `puzzle-fill-transaction.js`。前者固定所选 item/definition、位置、安全字段与规则，重算评分、化学和全部条件；后者复用共享 `submitSbcAttempt({prepareOnly:true})`，实现只保存不提交的事务核心：原计划句柄、一次确认、60 秒有效期、互斥锁、Journal 写前持久化及回读、fresh 输入和精确 Club 复核、保存前再次确认上下文、保存后逐槽回读和对账。未知结果进入恢复，不重试保存；发出保存后 Stop 不能跳过对账。不自动换卡或覆盖非空阵容。两个核心测试文件分别包含 30 和 31 项测试。

该核心目前支持 11 张普通不可交易 Club 卡、最高 74 分、无砖块；这些是已实现范围，后续需扩展能力，不能视为所有 Puzzle 的固有规则。本节时点尚未接通写入 Provider、持久化和原生侧栏；后续完成状态见 10.13。

正式生产面板已加入 `Plan Puzzle` 只读规划入口，展示人数、评分、化学和槽位评分，切换时清除旧传统提交计划，不为 Puzzle 启用 Submit。规划调用独立 Puzzle Adapter，现有传统单次 Live 路径保留。最终交互仍按原生 SBC 右侧按钮实施；市场与可选 AI 仍在独立检查工具中，不冒充正式面板采购能力。

用户明确要求按发布版本标准开发，本轮同步移除历史固定体积、production/acceptance 逐文件构建许可、旧只读/hash 批准与安装 fixture 发布阻断、全局业务 Pending 及禁止新增网络能力的工程限制。实际依赖和体积仍记录，网络权限按具体域名检查，材料/事务保护与回归保持。详情和历史来源见 [门禁核查](FC27_GATES_AUDIT_ZH.md)。正式产物由 143,673 增至 214,409 bytes，Puzzle 接线保留，不因没有性能依据的旧上限撤回。

最终 `npm run verify` 通过 274 文件 / 2,980 项；FC27 专项通过 68 文件 / 993 项及全部离线浏览器 smoke。当前发布 readiness 与本地七项资产打包通过，manifest 为 `releaseScope:fc27`、`liveExecutionEnabled:true`、`releaseEligible:true`；后者只表示可进入正常发布流水线。Runner 保持 `27.0.1`，FSU Local 保持 `26.09.9`，未安装更新、操作 EA 阵容、购买、Git 提交、推送或发布。下一步是把已测试的填阵核心接入真实 Provider 和原生侧栏，再进行有明确计划与用户确认的保存验证。

### 10.13 Puzzle 保存、持久恢复与原生侧栏（2026-09-26）

**2026-09-26 交互规则更新：**用户要求同类功能默认保持参考插件的界面和操作一致，除非明确要求差异化。Puzzle 原生按钮因此改为一次点击完成解题、复核、填阵保存，进度/结果显示在原按钮旁，计划/校验/结果记入后台；不展开 Tools、不再选择或二次确认。以下两阶段交互记载属于历史实现。保护、锁/Journal、写后核验仍执行，传统提交确认不受影响。

一键接线已完成：`solveAndFillPuzzle()` 在同一忙碌区间执行规划和已存在的单次保存事务；点击绑定 Set/Challenge 及原页面锚点，保存前导航变化停止，保存发出后的读回不因导航中断。按钮执行期间禁用，伪造 DOM click 不执行；进度和限流/非空阵/恢复状态显示在右栏，不展开面板。最近一次尝试写入 `fcat-fc27-puzzle-last:<账号作用域>`，包含最多 20 个阶段、选中 refs、规则/校验聚合及最终结果，不保存全库存或凭证、不外传；该诊断 key 不可替代单独的持久事务 Journal。诊断显示失败不放宽或改变事务结果。Tools 中手动预览/传统提交入口保留为独立操作，不是原生按钮必经流程。

验证：完整 277 文件 / 3,016 项，FC27 专项 71 文件 / 1,029 项通过；离线浏览器实测一键不打开面板/弹窗、重复点击禁用、目标切换停止、按钮原位置反馈。首次 smoke 暴露缺失目标时回调返回 null 而非 false，修正后全部 smoke 通过，并重新执行 lint、build、dist 校验。产物仍为 `27.0.1`，248,264 bytes；FSU 不变。真实保存验收仍独立记录，不因改变交互宣称已通过。

专用浏览器已通过 Tampermonkey 编辑器更新本次一键构建，重载编辑器回读源码一致。刷新后保留登录，重新进入 Italy v Belgium，按钮可见且启用，tooltip 为“一键解题、复核并保存阵容，不提交 SBC”，位于 Exchange Players 前；截图 `artifacts/fc27-browser/puzzle-one-click-real-sidebar.png`。本轮未点击一键按钮执行真实保存，未覆盖页面已有球员；实例保持打开。安装/显示已核对，一键业务保存尚待实测。

**最新实机结果：**用户登录后，Agent 已在专用 Chrome 更新既有 Tampermonkey 安装，重载编辑器确认源码与本地 242,443 bytes 构建一致，刷新 Web App 保留登录，再由原生页面导航进入 Marquee Matchups → Italy v Belgium（Set 19 / Challenge 43）。页面实际结构还包含 `SBCSquadDetailNavigationController.currentController`，上一轮仅修正三级主导航仍取不到详情按钮；本轮按真实结构修复并核对详情 Controller 类型及 Set/Challenge 一致。已看到 **FCAT 解题填充** 出现在 **Exchange Players** 前面，并完成真实鼠标点击。catalog 返回 `FC27_CATALOG_READ_UNCONFIRMED / HTTP 429`，规划因此停止，没有再次请求、保存、提交或买卡。按钮显示/点击验收通过，成功规划和保存仍待限流解除后继续；没有因 429 放宽任何检查。

本地证据：`artifacts/fc27-browser/puzzle-native-live-check.json`（含安装 SHA256、目标、按钮和脱敏结果）、`puzzle-native-real-sidebar.png`、`puzzle-native-real-result.png`。Runner `27.0.1`、FSU `26.09.9`；仅更新专用浏览器中的 FCAT，未变更 FSU 设置。完整 `npm run verify` 277 文件 / 3,009 项通过；FC27 专项 71 文件 / 1,022 项通过。并行运行时离线 Web Lock owner-close smoke 首次出现 `null`/`save-pending` 时序失败，单独重跑 `run.mjs --self-test` 全部通过，未更改锁实现或删除断言；日志保留为 `artifacts/puzzle-button-live-browser-verify.log` 与 `puzzle-button-live-browser-recheck.log`。未 Git 提交、推送或发布，专用浏览器保持打开以便查看。

后续截图反馈修正：侧栏按钮没有出现，确认原页面 Reader 错把 `getPresentedViewController()` 弹窗控制器当成普通页面导航。EA 本地源码与既有 FSU 的活动 Controller 路径均表明应读取三级 `currentController`；现已修正。此前单元测试复制了错误导航形状，离线挂载 smoke 又直接注入 target，未覆盖这个集成错误；现在先以无弹窗导航形状复现，再将真实 Reader 接入浏览器按钮测试。按钮应位于右侧 **Exchange Players** 上方；页面右栏较长时需向下滚动。截图里的现有三张卡不会因按钮出现而自动被覆盖；当前填阵仍要求空阵。本地同为 `27.0.1` 的构建不能凭显示版本辨别新旧，需要重新安装此次生成的本地脚本并刷新。

按钮修正后完整 `npm run verify`（277 文件 / 3,007 项）及 FC27 专项（71 文件 / 1,020 项、全部离线浏览器 smoke）通过，产物重建为 242,047 bytes。结果记录在 `artifacts/puzzle-button-verify.log` 和 `artifacts/puzzle-button-browser-verify.log`。尚未接管用户浏览器或验证账号页面上的修正结果。

三项开发已接通：

1. `fc27-acceptance-session.js` 将 Puzzle 固定方案连接到现有原生保存 Provider。多 Challenge Set 按当前打开的 Challenge 精确读取，不套用传统单阵/单奖励合同。确认后重新读取需求、配置、选中 Club 实体和目标空阵；原生保存前再次检查空阵及策略，保存一次后逐槽回读，重算条件。确认字段按值比较，不受 UI 对象字段顺序影响。整个 Puzzle 路径没有提交、购买或开包动作。
2. `puzzle-fill-journal.js` 使用隔离 GM key，复用传统 SBC Web Lock。先持久化 `save-pending`，保存且回读一致才记为 `saved`；响应丢失不自动重试。未决记录阻断新的 Puzzle 和传统事务；刷新后 `Check recovery` 重新确认 Challenge 归属，以及原阵精确保存或空阵且材料仍在 Club，再由用户 `Confirm recovery` 清理记录。部分阵容、错槽或身份不符保持未决。成功终态不要求每次手工清理。
3. `fc27-puzzle-page.js` 与 `fc27-puzzle-native-button.js` 从当前原生 SBC Controller 读取 Set/Challenge，在右侧 EA 按钮区插入 **FCAT 解题填充**。点击只生成该 Challenge 的方案并展开 FCAT 面板；用户点击 **Fill and save once → Confirm** 才保存。导航离开时移除按钮，切换 Challenge 时重新绑定，不从目录第一条猜目标。Puzzle 方案不会启用传统 `Submit once`。

当前试用范围仍为普通不可交易 Club 卡、最高 74 分、11 槽且无砖块，目标阵容必须为空。FSU 源码/缓存合同未改；不会消耗卡片，也不代表市场补卡、多阵联合规划或任意 Puzzle 已经完成。保存后如果 EA 当前页面未同步显示，返回再进入同一 Challenge 查看，不能因此再次保存。

真机步骤（按最新一键规则）：更新本地产物后刷新 Web App，在 EA 内打开已初始化、空阵的目标 Challenge；点右栏 **FCAT 解题填充**，后台完成规划、材料复核和一次保存，直接在右栏查看结果，无需二次确认。检查 EA 阵容的 11 个位置和条件状态；不要点击 EA Submit。遇到 `recovery-required` 时先使用面板恢复检查，不重复填阵。之前 23 个指纹和评分/化学/条件差分证据继续保留，无需重复采集同一份只读报告。

新增覆盖包括实际事务代码与模拟 GM 的会话集成、确认顺序、四阵 Set 目标选择、重复确认、跨刷新未决恢复、错槽/缺卡恢复拒绝、原生保存前非空阵/替补保护、原生页面绑定，以及浏览器真实点击/取消/伪事件拒绝/切换页面。真实 EA 保存尚未执行，不能将这些离线结果写成实机验收；本轮未提交、推送或发布。

最终 `npm run verify` 通过 277 文件 / 3,007 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 71 文件 / 1,020 项及全部离线浏览器 smoke。发布 packaging readiness、FSU patch 重放和资产一致性、`git diff --check` 均通过。Runner `27.0.1` 已重建为 242,027 bytes，root/dist 一致；FSU Local 仍为 `26.09.9`。日志为本地忽略的 `artifacts/puzzle-fill-verify.log`、`artifacts/puzzle-fill-browser-verify.log`。专用浏览器仍由用户已有的 `--agent --with-extensions` 终端持有，使用控制管道而非可附加 CDP；本轮未抢占会话或要求重采报告，未安装新脚本或执行真实保存。当前可进入上述范围的真机实验，实际服务器接受保存及页面显示仍 Pending。

### 10.14 Puzzle 当前阵读取与请求复用（2026-09-26）

本次针对原生一键填充收到 catalog HTTP 429 的反馈，删除重复采集路径。已打开的原生 SBC 详情 Controller 持有精确 `_challenge`、需求、`squad._players[index]._item` 和 `_formation.positions[].typeId`，无需再读整个 Set。`fc27-puzzle-page.js` 只投影当前目标，不执行属性 getter；身份不明、槽位错乱、非空阵、替补占用、砖位或阵型异常时停止，不改用全量扫描兜底。

`fc27-acceptance-session.js` 原生路径直接把页面快照交给 Planner，规划阶段只读取现有 Club 缓存、FSU 策略和本地化学配置。原生点击不再走开发用完整诊断和预览精确查询，不请求其它 Challenge、奖励、Unassigned、市场或全量 Club；此前保存的 catalog 429 也不阻断当前页面。Tools 的独立 `Read requirements` 仍采用账号作用域内按 Set 的单次 catalog 记录和跨标签互斥，成功和失败都记录，不自动重试；它不是原生一键填充的前置步骤。

正常成功路径的自动测试锁定以下 EA 调用预算；这是本功能的调用顺序，不包括 EA 页面导航和其它插件自行产生的请求：

| 阶段 | 读取或动作 | 次数 |
| --- | --- | --- |
| 当前 Challenge、需求、阵型与规划候选 | 当前页面模型及现有 Club/FSU 缓存 | 0 网络请求 |
| 已选材料精确复核 | 只读 `POST /club`，限定所选 11 个 definition，并逐张核对 item 与安全属性 | 1 |
| 保存前空阵确认 | 当前 Challenge squad DAO 回读 | 1 |
| 填阵保存 | 当前 Challenge `PUT squad` | 1 |
| 保存后对账 | 当前 Challenge squad DAO 实际回读 | 1 |

“只请求一次”落实为同次操作不重复查询同一批材料、只保存一次、没有自动重试。需求和配置在后续步骤直接复用并在本地检查变化；保存后的评分、化学、全部条件使用实际回读布局复核，不额外扫描目录。动态库存、目标空阵和保存结果不能永久缓存为有效证据：再次执行真实写入时仍必须定向复核所选材料，以防已售出、已消耗或属性变化。保存发出前切页停止；发出后即使切页也完成必要对账，未知结果保留 Journal，不能重发保存。

后台继续保存最近一次计划、规则、阶段及结果到隔离 GM 诊断键，事务 Journal 独立记录保存状态，不保存全库存或凭证。HTTP 429/超时继续停止且不自动重试；请求精简降低本功能的额外负担，不代表能保证 EA 或其它插件永不触发限流。

新增 `fc27-puzzle-native-flow.test.js` 贯通真实 Page Reader、Planner、Session 和 Provider，验证 `POST club → squad → PUT squad → squad` 顺序与精确 11 个版本；非空阵零请求且不覆盖。页面测试覆盖空实体 ID、真实嵌套形状、稀疏/错位数组、替补、砖位、非法阵型、getter、切页后目标查找及歧义；现有事务测试继续覆盖输入漂移、锁/恢复和写后对账。完整回归发现旧 preview 测试误将整个报告作为选项传入，新 `layout` 字段引起误分支；已修正测试调用为精确目标并补齐真实布局身份，没有放宽生产校验。

验证：`npm run verify` 278 文件 / 3,035 项通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 72 文件 / 1,048 项及全部离线浏览器 smoke 通过，均退出 0。构建/版本/root-dist、FSU patch 重放及资产一致性通过；Runner `27.0.1` 为 262,092 bytes，FSU Local `26.09.9` 不变。日志为 `artifacts/puzzle-request-budget-verify.log` 和 `artifacts/puzzle-request-budget-browser-verify.log`。

真实页面状态（2026-09-26）：请求优化代码当时尚未完成新版本实际保存验收。最近一次打开专用浏览器停在 EA 登录页，之后已正常关闭；10.13 的“保持打开”只描述当时状态。离线通过不能替代真实 EA 接受保存和页面显示。尚未 Git 提交、推送或发布。

### 10.15 Puzzle 普通砖位与持久化评分上限（2026-09-27）

本轮扩展按实际非砖位数量选材、复核、批准、保存和回读，支持 1–11 名普通不可交易 Club 球员。阵型仍保留 EA 的完整 11 槽，普通砖位与替补席保持空实体；砖位占卡、布局漂移、重复 item/definition 和保存后错槽均阻断。custom brick 的额外化学贡献尚未实现，继续明确停止。Journal schema 2 固定记录砖位；schema 1 保留完整 11 人约束，不能把损坏的旧记录误当成小阵容。保存异常不重复发送，恢复只接受同一目标的精确回读。

新增 Tools 内的“解题球员最高评分”设置，按账号作用域保存在 GM 中，默认 74。用户显式保存 1–99 的整数上限，有效值仍被 FSU Golden Player Range 限制；不会因为缺料自动提高。原生“FCAT 解题填充”直接使用已保存策略，仍是一次点击，不增加操作中选择或确认。设置损坏或过程中 GM/FSU 策略变化均停止；传统单次提交的 74/83 合同不变。无队伍评分/化学需求的 Puzzle 不再强制要求化学配置。

离线验收覆盖记录的重大比赛 Set 19 / Challenge 43 的五条条件与阵型，材料采用合成库存，不冒充真实账号成功；此外覆盖 1/2/10/11 人、默认保护与显式金卡上限、FSU 更低上限、跨会话设置、策略漂移、保存前后砖位变化和恢复。请求预算仍为 `POST club → GET squad → PUT squad → GET squad`，只查询本阵实际选中版本。

验证：`npm run verify` 278 文件 / 3,053 项；`node scripts/verify-fc27-prelaunch.mjs --browser` 72 文件 / 1,066 项及全部离线 smoke 通过。日志为 `artifacts/puzzle-bricks-policy-verify.log`、`artifacts/puzzle-bricks-policy-browser.log`。构建 Runner 27.0.1 / 268,554 bytes，FSU 26.09.9 不变。

实机验收未通过（更正）：用户切换到仍有重大比赛的新账号；专用浏览器通过既有篡改猴编辑器更新 FC Automation Tool，并在重新加载编辑器后核对完整源码与本地产物一致，SHA256 `b4ac11c8c06a8e98818ef6a821c36bc9d33b08f72d0855662afe291f0b759af5`。在 Marquee Matchups → Italy v Belgium（Set 19 / Challenge 43）点击原生“FCAT 解题填充”一次，脚本报告“阵容已保存，未提交 SBC”。脱敏网络记录为一次 `POST /club`、一次保存前 `GET /sbs/challenge/43/squad`、一次 `PUT /sbs/challenge/43/squad` 和一次保存后 `GET`，均 HTTP 200。首次保存后的本地页面读取实际仍为 `squadEmpty:true`；完整刷新后曾读到 `false`，但这不足以证明一次点击即可在原生球场正常使用。后续用户截图和模型检查确认空阵/恢复阻断，故撤回此前“实机验收已完成”的表述。未提交 SBC、未购买、未消费金币。此前 2x79 是 Agent 选择了错误测试目标，未发现程序自动选择该 SBC 的证据。

### 10.16 页面空阵与跨子阵恢复阻断诊断（2026-09-27，当时尚未修复；后续见 10.17）

用户证据为桌面 `捕获1.PNG`、`捕获2.PNG`：Italy v Belgium 和 Norway v Portugal 的球场均为空、评分/化学为 0，并提示保存状态待核对。按用户选择保留当前页面及真实 Journal，只做诊断；未重新点击填阵、重新安装、清除记录或调用提交/购买。

确认事实：

- 专用浏览器安装源码 SHA256 仍与上述 271,322 bytes 产物一致，不能归因于未安装更新。
- 当前账号的 Puzzle Journal 指向 Set 19 / Challenge 43，schema 2、`save-pending`、11 张卡。一次只读 squad GET 的实际返回与记录的 item/definition/slot 全部一致；材料安全字段与现有 Club 缓存亦无差异。此证据确认服务器保存状态，不等于页面同步、全部条件重新验收或允许提交。
- Norway（44）的最近一次日志仅到 `planning`，结果为 `FC27_PUZZLE_FILL_RECOVERY_REQUIRED`；它被 Italy（43）的账号级未决记录阻断，尚不能称为 Norway 求解器失败。
- 最近一次诊断日志会被后续 blocked 点击覆盖，因此当前 GM 中没有造成 pending 的原始异常；不能把下面的离线复现当成那次历史操作的完整日志。

已复现的代码调用链：

1. `solveAndFillPuzzle → createFc27PuzzleFillTransaction → submitSbcAttempt(prepareOnly) → provider.save → PUT squad → provider.readSavedSquad`。DAO 的 `loadChallenge` 通过 Factory 创建独立 squad，Provider 投影并校验它，但没有把已验证结果同步到页面持有的 Challenge/squad 和视图；原生 Service 本来负责的模型赋值/通知被绕开了。服务器有卡而页面仍空时，代码仍可报告 `filled`。
2. 空页面上再次点击会重新规划；事务先写 `save-pending` 并把 `dispatched` 设为 true，随后才进入 `provider.save` 的服务器空阵检查。发现服务器已占用时抛出 `FC27_PUZZLE_EXISTING_SQUAD_BLOCKED`，未发出第二个 PUT，却返回 `recovery-required/saved:null` 并留下未决记录。
3. 后续任何子阵在 `preparePuzzle` 读取该账号的 `save-pending` 时停止。`inspectRecovery` 只比对服务器阵容与 Journal，故可以同时出现 `outcome:saved` 和页面空阵；恢复结果不应表述为页面已经可用。

使用既有 `fc27-puzzle-native-flow` 合成重大比赛库存及真实 Reader/Planner/Session/Provider 的临时诊断测试，得到：首轮 `filled`、页面 0 人；第二轮 `recovery-required/FC27_PUZZLE_EXISTING_SQUAD_BLOCKED`；Journal `save-pending`；恢复 `outcome:saved`；总 PUT 次数仍为 1。测试通过说明故障可复现，不表示产品通过验收；临时测试已移除，未改动生产实现。

最小修复计划：

- `src/adapters/ea/fc27-puzzle-page.js` / `fc27-traditional-provider.js`：保存后复用现有一次 GET 的实体，核对精确目标与卡片后通过经审查的 EA 本地模型/通知接口同步球场、摘要和条件；不额外保存，不对新页面覆盖旧计划。测试必须使用彼此独立的服务器、Repository 和页面模型。
- `src/fc27/puzzle-fill-transaction.js` / Provider：把服务器空阵检查放在持久写边界之前，或提供真正紧邻请求发送的受控边界；只有确实可能发出的 PUT 才留下不确定提交记录。已有待核对记录不能盲目清空，也不能因本地异常自动重发 PUT。
- `src/adapters/browser/fc27-acceptance-session.js` / `fc27-puzzle-native-button.js`：区分服务器已保存、页面待同步及确实未知；保留首个故障阶段/原因，避免后续 blocked 点击覆盖关键证据。在原按钮位置展示当前操作及阻断来源，不增加 Tools 跳转或二次选择。
- 验收需覆盖一次点击后球场真实卡片、评分、化学及全部条件；重复点击不产生第二个保存、不制造未决记录；切换其他子阵不被伪未决状态阻断。未授权提交 SBC，不能为测试恢复而再次消耗材料或金币。

分类：页面未同步与提前写未决记录是代码逻辑错误；后续为防止重复写入而停止是正常安全策略；不是求解器计算死循环，也没有证据证明这两张截图源于缺卡。修复完成前不应将 Puzzle 宣称为已实机验收可用。

### 10.17 原生页面同步修复、品质配比与真实材料边界（2026-09-27）

已实施的修复：

- 保存后复用已有 readback 的 EA 实体，保持原生页面持有的 Squad 引用，通过已核对源码指纹的 `UTSquadEntity.update` / `EAObservable.notify` 同步球场及条件；不增加 GET 或 PUT。页面已被用户编辑成不同阵容或方法合同变化时不覆盖。
- Journal 的 `save-pending` 在 Provider 完成空阵/布局检查后、transport 实际发送前写入；仅调用 `adapter.save` 不再等同于请求已经发出。未知写结果保留恢复记录。
- 同一子阵的原生按钮可用一次 GET 精确核对并恢复已有保存，不重发保存；其他子阵提示待恢复的目标。首次写故障保留在独立 GM 记录，后续 blocked 不覆盖。
- Puzzle 默认保护上限改为 82，Tools 设置可手动调整；已有明确保存的低上限不自动提高，FSU 更低金卡上限、联赛、不可交易及其它保护仍有效。传统 Runner 的 74/83 合同不变。
- EA 品质原始 `min/exact/max` 语义不修改。另行生成用户材料配比：最低银卡＋至少 2 金用恰好 2 金＋9 银；最低铜卡＋至少 3 银用 3 银＋8 铜；全铜/全银继续受原生条件限定。若其它评分/化学条件与该配比无法同时满足，停止而不自动增加高品质卡。没有最低品质条件时不凭空推导全铜限制。
- 在最多 78 种品质数量分配中确定配比，不枚举全部球员组合。球员搜索增加全员/零数量条件过滤、同组候选的必要条件与必需材料上界传播；仍使用原有总搜索预算，AI/市场规划共享这些限制，未知结果不冒充“证明无解”。原按钮显示当前配比及评分上限，搜索耗尽与明确材料不足分开描述。

实机证据：Italy v Belgium（19/43）更新脚本后，通过原按钮恢复已保存的 11 人，原生页面显示条件 6/6、评分 69、化学 14；重复点击显示已有阵容，未重复保存或提交。已有阵容属于此前保存，不因本次新配比自动覆盖或重选。

Norway v Portugal（19/44）确认为当前空阵，其六条 EA 条件含至少 1 挪威/葡萄牙球员、同俱乐部至少 3 人、最多 5 联赛、至少 2 金、最低银、化学至少 18。默认 82 与 2 金＋9 银下，实机一次按钮搜索返回 `FC27_PUZZLE_SEARCH_LIMIT`，网络记录为空，未填阵或写未决 Journal。不可将它描述为真实保存失败或完整新填阵验收通过。

为区分搜索漏解与材料边界，从当前页面/Club 缓存读取脱敏候选属性，不发额外 EA 请求。保留的 fixture 只有评分、稀有度、国籍/联赛/俱乐部和位置等属性，测试分配合成 item/definition ID，不含账号/真实库存身份。离线更大预算单遍完成组合遍历：1,585 个进入化学上界检查的阵容，只有 2 个乐观上界达到 18；对这 2 个逐一检查全部可上位球员子集与位置匹配，实际最高化学 17。其它阵容的乐观上界低于 18。此结论仅针对已采集、已按保护筛选的缓存候选，不声称全账号/市场无解。把化学改为 17 的**合成测试变体**可在原 50,000 节点预算内找到 2 金＋9 银方案；绝不修改真实 EA 的 18 要求。

实际状态：旧保存恢复与原生显示已验证；新空阵一次完整保存的实机验收仍受材料条件阻挡。未提交 SBC、未购买、未消费金币。FSU 26.09.9 源码不变；当前是本地 27.0.1 构建，未推送/tag/发布。

最终验证：`npm run verify` 281 文件 / 3,080 项通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 75 文件 / 1,093 项及全部离线浏览器 smoke 通过，均退出 0。生成 Runner 27.0.1 / 284,084 bytes，SHA256 `b1b965a0608ba3bb76400dd238e4b7d354b584a6504d5ed5ce81d827a5a39cca`；专用浏览器安装后重载篡改猴编辑器，确认源码与该产物一致。日志：`artifacts/puzzle-material-policy-final-verify.log`、`artifacts/puzzle-material-policy-browser-verify.log`；实际页面动作：`artifacts/fc27-browser/puzzle-live-acceptance.json`。

最终产物的 Norway 按钮复验：原位置显示“9 银＋2 金，最高 82：本次搜索未找到满足全部条件的阵容，未放宽选材或修改阵容。”；操作期间 EA 网络记录仍为空，页面仍为空阵，没有新保存。用户无需重启或重新登录即可在专用浏览器继续查看。

### 10.18 Puzzle 缺卡采购规划与缓存复用（2026-09-27）

已把缺卡规划接入原生 Puzzle 一键按钮的阻断路径：当当前 Club 材料在既定品质配比、评分上限、FSU/锁卡/联赛/Evolution/交易保护和化学条件下不可行时，按钮只生成采购建议，不自动买卡、不填阵、不保存、不提交。采购建议沿用当前 Challenge 的确定性解题结果和同一份输入快照，市场只查询满足缺口的 FC27 普通版本，不生成假 item ID。

本轮在专用浏览器的 Set 19 / Challenge 44（Norway v Portugal）得到真实结果：当前阵容为空，要求最低银卡、至少 2 张金卡、化学至少 18；Club 方案保持 2 金＋9 银，库存种子化学为 17。市场目录和报价全部从此前持久化的账号作用域缓存读取，新增市场请求为 0，缓存命中 5 次。规划给出 3 个一张卡的候选：首选 Alessio Besio（67 分、版本 263748、观察价 500，补入后化学 19），备选 Alexander Bernhardsson（73 分、500）和 Fraser Hornby（72 分、550）。

采购结果明确保持 `executable:false`。后续仍必须重新读取库存和 SBC、重新核价、检查金币保留线和 Transfer 容量、取得用户明确批准、执行一次精确 Buy Now 回执，并以实际 item ID 重新规划；当前入口不能把市场卡当作已拥有材料，也不能绕过 Trade 事务门禁。目录/报价缓存按账号作用域和查询键持久化，成功结果受 TTL 约束，过期、短读、版本身份变化、平台/赛季不匹配或写入未确认均停止，失败记录不会自动重试。

验证：`npm run verify` 通过 283 个测试文件、3092 项测试；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 77 个 FC27 专项文件、1105 项及离线浏览器 smoke。构建产物为 FC Automation Tool 27.0.1（316125 bytes），FSU Local 26.09.9，FSU patch replay、root/dist 一致性和资产检查通过。真实页面只完成补卡只读规划，未购买、移动、填阵、保存或提交 SBC。
