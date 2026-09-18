# FC27 上线后适配记录

## 2026-09-18 FSU SBC 导入弹窗按钮修复

FC27 官方编译代码中的 `EADialogViewController` 只读取 `continueOption`/`cancelOption`，而 Local FSU 原共用 `events.popup` 只传旧 `dialogOptions`。因此“导入方案 ID 或网址”弹窗会显示标题和输入框，但按钮容器为空。Local FSU `26.09.9` 同时传递新旧选项；FC27 运行时按 `dialogOptionEnums` 重标自定义按钮、补齐第三个动作，并把 Escape 绑定到最后的取消项。空输入默认方案、URL/ID 解析、Club readiness、选材、保存和提交均未改变。

Node 回归覆盖两按钮导入、三按钮评分补全、自定义标签、Escape 取消以及 FC26 旧 `dialogOptions` 视图。`npm run check:fsu-patch` 与完整 `npm run verify` 仍是交付门禁；当前未在登录账号上点击真实填阵或提交。

## 2026-09-18 单次 Live 开放

用户在了解只读边界后明确要求“打开 live 限制”。本次开放本地 `27.0.1` 的现有单次传统 SBC 执行，不覆盖只读 `v27.0.0`，不将授权解释为 Agent 可以直接代用户消费。

- 默认入口与 manifest 共享构建注入的 Live 模式；版本和 lock 同步为 `27.0.1`，安装身份/GM key 不变。独立 Acceptance 和旧只读检查工具仍不自动执行。
- `Verify squad` 仍只读取、选材及整阵 fresh 定向校验；成功后才可点击 `Submit once`，确认目标、人数、评分上限和一次执行后才保存/提交。取消、缺料、计划过期/属性变化、未决 Journal、跨标签冲突仍停止。每次执行消耗一次计划，不能重放确认或自动连做。
- 范围仍是单 Challenge、11 人无 brick、普通 Club 卡、不可交易及原 FSU 策略；默认上限 74、可选 83 且不突破 FSU 更严格范围。Evolution/租借/特殊卡/未知条件继续排除，不放宽保存前后 validator 或错误确认规则。
- 事务核心、EA Provider、FSU 源/缓存合同和共享 FC26 提交实现不改。开放不包含 Rolling、自动开包、补给、移动、Pick 或交易，也不等于旧季全部功能已恢复。
- 新增会话级单次确认、非法批准、重复调用、精确材料变化回归；浏览器模拟校验准备零执行、取消、确认一次、执行中禁用、评分变更失效、缺料、只读面板隔离及桌面/手机布局。
- 历史 `27.0.0` 安装/更新 fixture 和只读发布许可保持原样；新 manifest 的 `releaseEligible:false`、`FC27_LIVE_ACCEPTANCE_PENDING` 保留。公开发布命令预期拒绝新 Live 包，需要新的真实业务/安装验收及独立发布批准。

完成验证：`npm run verify` 通过 244 文件 / 2,487 项，FC27 专项 40 文件 / 507 项及浏览器检查通过。新面板在桌面 1280 与手机 390 视口完成确认/取消/缺料检查；只读 Acceptance 仍关闭 Live。

实际专用 Chrome / Tampermonkey 已从 `27.0.0` 安装更新至本地 `27.0.1`，安装器及已安装完整源码一致；随后关闭浏览器，再启动独立复核，版本/源码、原合成 GM 记录保留、刷新、跨标签排斥和关闭持锁页日志保留均通过。新版 130,729 bytes / 22 白名单模块，SHA256 为 `5c17626e8d067e03915668b6becaf106e34054adb1dec5e51b51077351fb9f25`；脱敏安装记录为 `tests/fixtures/fc27-live-candidate-installation-observation.json`，完整本地报告在忽略目录 `artifacts/fc27-browser`。

发布检查按预期以 `FC27_READONLY_RELEASE_NOT_APPROVED` 拒绝本地 Live 包，不影响本地运行。未创建提交/tag 或推送/发布，远程 `v27.0.0` 保持不变；专用浏览器与临时服务已关闭。没有执行真实 SBC、开包、移动或交易，EA 消费闭环未验证，不能用上述合成事务或 GM 安装证据代替。

## 2026-09-18 只读首版发布授权

用户在明确确认“27.0.0 只读首版、Live 关闭、后续验收再开放业务”的范围后回复“确认发布首版”。本次据此允许提交、推送和发布 `v27.0.0`，不执行 EA 消费，也不把真实业务标为通过。

- 发布许可由 `scripts/fc27-readonly-release.json` 绑定精确版本、Runner SHA256 和 FSU Local `26.09.8` SHA256；门禁覆盖安装/更新证据、FSU 重放和构建一致性。变更脚本、未来版本、撤销许可或 Live 开启均拒绝发布。
- Runner 文件与此前实机验收的 SHA256 完全一致。变更只在发布政策、构建换行归一化、CI 顺序、manifest 和文档；不改变业务行为。manifest 的 `releaseEligible:true` 仅指本次只读交付，`FC27_LIVE_ACCEPTANCE_PENDING` 仍保留为未验收业务状态。
- Release 使用[固定发布说明](releases/27.0.0.md)，不以自动生成的提交列表宣称所有旧季功能已支持。FSU 原有手动操作是独立能力，不受 Runner Live 开关控制。
- 真实保存/提交/奖励验收继续等待安全库存；未来开放需要新版本、独立批准和新的产物安装证据，禁止替换本次已发布资产。

发布前验证：`npm run verify` 通过 244 文件 / 2,480 项测试；FC27 专项通过 40 文件 / 500 项及浏览器检查。已额外从 Git 暂存区干净检出，验证 Windows 换行转换后的 Runner/FSU 构建、SHA256 和发布门禁；默认门禁、`--packaging`、显式资产打包和旧 Profile 回归构建均通过。

首次远程 CI 发现合成运行时的指纹 Map 使用未归一化 CRLF、与生产方法校验的 LF 输入不一致，14 项测试失败；干净检出复现后仅修测试夹具，并添加 LF/CRLF 与未知源码拒绝回归。浏览器 smoke 同时改为关闭持锁页后有界观察原生锁实际释放，再断言日志保留；没有修改生产脚本或放宽互斥。修正后干净检出 34 项相关测试、完整套件及浏览器通过。原提交 `675d937` 不打发布 tag，以后续 CI 通过的修正提交为发布目标。

当前执行状态：已完成正式发布及实际 GitHub 下载核验。以下“全部 Release 阻断”和“本地未发布”是此前的历史状态，已由本次只读发布结果取代；Live 与真实业务 Pending 不变。

### 发布与交付结果

- Release：[FC Automation Tool v27.0.0 (Read-only)](https://github.com/ShatteredLancer/FCAutomationTool/releases/tag/v27.0.0)，2026-09-18 19:26:30（UTC+8）发布，Release ID `391420267`；非 draft、非 prerelease，已成为 latest。
- 发布提交为 `40463dcc775c3874f1241712c53b36ed2987dfbb`；annotated tag `v27.0.0` 已推送。功能/发布准备提交 `675d937` 与测试修正一并包含在标签中。
- [完整 CI](https://github.com/ShatteredLancer/FCAutomationTool/actions/runs/35339129561)、[FC27 专项和浏览器 CI](https://github.com/ShatteredLancer/FCAutomationTool/actions/runs/35339129578)、[正式发布工作流](https://github.com/ShatteredLancer/FCAutomationTool/actions/runs/35339412407) 全部成功。
- 实际从版本固定下载地址取得全部七项资产，每个文件 SHA256 均与本地打包产物一致；`SHA256SUMS` 本身也一致。Runner 为 `e28912e954aaa3cb2c64d3255d7e555baee993588f87291cb9d87cc7b674d508`，FSU Local `26.09.8` 为 `95d49b111f8340f22633ecfb93e98ec461efaf87a6cc545e032381b296478627`。
- Runner/FSU 各自 `.meta.js`、`.user.js` 的四个 `releases/latest/download` 地址均实下载并通过相同校验；公开资产清单恰为七项，Release 正文与固定发布说明一致。下载文件保存在忽略目录 `artifacts/release-v27.0.0-delivery`。
- 本次验证 GitHub 交付，不重做或冒充新的 Tampermonkey 自动升级。既有安装/受控更新 fixture 中 `published:false` 和 `githubDeliveryVerified:false` 保留当时观测；本节补充发布后的证据，产物字节未变。
- 不移动 tag、不替换已发布资产。后续代码、功能开放及修复使用新版本和新的批准/安装证据；真实 SBC 保存、提交、奖励及中断恢复仍等安全库存充足后独立验收。

## 2026-09-18 正式入口与发布资产准备

用户最新决定为“先跳过 1，直接完成 2，等到库存有了再验证真实业务”。本批完成第 2 项的本地版本、正式入口、全新身份、资产及受控更新验收；第 1 项真实 SBC 保存/提交/奖励验收明确延期。**`27.0.0` 是当前本地版本，不是已发布或已开放 Live 的版本。** 下文同日早期记录中的 `0.8.65`、生产入口未切换、正式身份未验证已由本节取代。

| 项目 | 状态与证据 |
| --- | --- |
| 版本与身份 | `fc-automation-tool@27.0.0`，package/lock 同步；`@name FC Automation Tool`、namespace 为新仓库 URL，全新 GM 存储，不迁移旧 Runner/Acceptance 数据 |
| 精简构建 | `npm run build` 默认采用 `src/fc27/production-entry.js`；22 个白名单输入、130,516 bytes，旧约 3 MB 包不再作为默认产物 |
| 旧季隔离 | 旧 Rolling、Swap、Provisions、Trade、Profile 和 FSU 研究原型不进入新 bundle；旧源/测试保留，历史 package 注入只用于内存回归构建，冻结校验通过 |
| 正式安装 | 真实 Chrome / Tampermonkey 5.5.0 安装源码与产物完整匹配；390/1280 视口检查通过，提交按钮禁用 |
| 独立 GM | 首次合成自检不存在旧记录，刷新后存在；双标签返回 `FC27_EXCLUSIVE_ACCESS_UNAVAILABLE`，关闭持锁页后仍为 `save-pending`。自检记录与业务 Journal 隔离且零 EA 请求 |
| 更新验证 | 同一正式身份临时安装仅 metadata 变更的 `26.99.99`；本机服务提供新版，真实 Tampermonkey 读取 metadata 和完整文件各一次，经源码核对/更新确认升级至 `27.0.0` |
| 更新后复核 | 浏览器重启后已安装完整源码仍等于正式 SHA256，原合成 GM 记录保留；脚本 metadata 恢复 GitHub `.meta.js` / `.user.js`，管理器实际更新 URL 为正式 GitHub `.user.js` |
| EA 只读 | 原 FSU `26.09.8`，Club 41 人、2/2 fresh 精确复核、Unassigned 清空、奖励包 509 基线 0；正式面板返回 `SAFE_MATERIAL_SHORTAGE`、`submitted:false` |
| 资产清单 | Runner 与 FSU 各 script/meta/manifest，加 `SHA256SUMS`；不打包旧 Loops/Profile zip 或 Preview。本地包装与一致性检查通过 |
| Live / Release | `liveEnabled:false`；默认发布检查仍失败为 `FC27_LIVE_ACCEPTANCE_PENDING`，没有创建 commit、tag、Release 或推送 |

安装证据绑定 `e28912e954aaa3cb2c64d3255d7e555baee993588f87291cb9d87cc7b674d508`，脱敏记录为 `tests/fixtures/fc27-production-installation-observation.json`。本地完整报告及截图位于忽略的 `artifacts/fc27-browser/production-*`。`26.99.99` 只是测试降版 metadata，不是发布版本或新的版本来源；最终安装已恢复正式源码。

更新测试边界：它验证真实扩展的本地下载/应用更新、同一身份和 GM 保留，**没有验证尚未发布的 GitHub 资产交付**。首次检查中更新被留在“应用更新”待确认状态，测试工具已补齐真实确认及源码核对；不能只看请求成功就标记安装完成。FSU 的版本/身份/设置未因本批修改。

旧热加载器仍是 FC26 工具，现拒绝非 FC26 页面和 FC27 下载内容，且在 destroy/eval 前停止。FC27 开发必须在 Tampermonkey 直接重装后刷新，不注入页面 GM bridge。对应四项回归保留正常 FC26 行为。

### 本批验证

- `npm run verify`：244 文件、2,469 项通过；语法、undef、架构、旧配置、FSU patch replay、构建及 dist 一致性通过。
- `node scripts/verify-fc27-prelaunch.mjs --browser`：40 文件、489 项和离线浏览器 smoke 通过；冻结 FC26 校验通过。
- `node scripts/package-fc27-release.mjs`、`node scripts/check-release-readiness.mjs --packaging` 通过。打包检查不绕过默认发布阻断。
- 真实 Tampermonkey 安装、受控更新、更新后浏览器重启/GM/只读 EA 均通过；没有保存、提交、开包、移动、领取或交易。

### 库存充足后接续

1. Agent 重开专用浏览器，只在确需登录/验证码时请用户操作；重新读实时合同、保护策略和库存，不沿用现在 41 人的数量结论。
2. 选择一套低价值传统 SBC，展示精确材料、评分上限和一次执行摘要，由用户确认后在受控验收入口验证保存、回读、submit-only、精确库存消失、完成次数及奖励增量。当前正式包不提供任意开关绕过 Live 门禁。
3. 按证据完成异常/重启恢复验收，才审查开启正式入口 Live、移除构建及发布阻断；最终 artifact 变化后重跑安装/更新验证，不能复用旧 SHA256 证据。
4. 用户明确批准发布后提交并创建匹配 tag；Release 发布后自动核验实际 GitHub asset/meta/SHA256 和安装更新地址。旧 FC26 固定版本链接继续保留，不向新包夹带旧名资产。

积分 SBC、连续 Rolling、自动开包/补给及交易仍是独立后续模块，不因 `27.0.0` 本地切换而宣称可用。

## 2026-09-18 EA Provider 与真实 GM 验收

按用户“先把 1、2 赶快结束”，本批完成真实 EA Provider 接线和独立 Tampermonkey 安装验收，不再把它们留作后续待实现任务。**完成的是实现、合成事务回归和实机非消耗验证，不是 EA 保存/提交验收，也不是发布 `27.0.0`。** 下文更早批次的“Provider/真实 GM 尚未接通”是历史状态，以本节为准。

| 工作 | 本批完成情况 | 仍需的业务验收 |
| --- | --- | --- |
| 1. EA 事务 Provider | 实时合同/策略、精确 Club refs、独立保存/回读、submit-only、库存/奖励对账及缓存清理已接线；真实只读通过 | 充足安全材料下的整阵 fresh 校验、实际保存/提交和奖励到账 |
| 2. GM、互斥及恢复 | 独立 Acceptance 脚本实际安装；真实 GM 跨刷新/浏览器重启、双标签互斥、关闭持锁页后日志保留通过；恢复证据和明确确认入口已实现 | 真实 EA 中断事务的正向恢复；目前未制造真实未决事务 |

### EA Provider

- 新增 `src/adapters/ea/fc27-traditional-provider.js` 与 `fc27-transaction-transport.js`，由独立 Acceptance 入口组合既有单次核心、Planner 和共享 `submit-attempt`。生产 Runner 和共享提交实现没有本批变更，不自动开放旧 Loop。
- 原 FSU 仍负责 Club 缓存和保护设置。本 Provider 对实际选中最多 11 张普通 Club 卡执行已有原生只读 Adapter 的 definition 定向查询，再精确匹配 item/definition 和安全属性。原 FSU 在 ready 时的校验可能只返回缓存，因此不能将 `cached:true` 当作本次 fresh 证据；这里不建立另一套全量库存服务，不写入 fresh 查询实体，不改 FSU 源码。
- 保存前读取 detached squad，暂限 11 个无 brick 首发且替补为空；保存所有真实槽位，回读和最终验证检查精确卡片/位置。写请求遵循已审查 DAO 协议，但使用自有 `UTHttpRequest`，**不是调用会再次保存的 Service，也不是带队列重试的 DAO mutation**。方法源码/实例、账号及 endpoint 均核验；关闭 retry/reauth，始终 `skipUserSquadValidation=false`，取消/超时不得解释成回滚。
- Unassigned 和 My Packs 直接只读查询服务器，不能用空 Repository 冒充权威空库存。实机发现 `PurchaseDisplayGroup.MYPACKS` 为小写 `mypacks`，修正原适配假设并补回归；只统计精确奖励 ID/不可交易性/数量的已拥有包，不统计商店可购买包。
- 提交前调用已核验的原 FSU dirty hook；权威读取确认精确选中实体全部消失且目标完成次数增加 1 后，才通过已审查本地 Repository 方法移除对应 item ID 并失效 Club stats。全体缓存身份先预检，冲突不部分删除；拒绝或结果不明不删除卡。对账还要求原目标/奖励身份不变、精确包增量及 Unassigned 无待处理物品，否则保留未决状态。

### 持久化与恢复

- `src/fc27/acceptance-entry.js` 的安装身份为 `FC Automation Tool Acceptance` / `/acceptance` namespace，无更新下载地址；版本仍读 package 的 `0.8.65`，不是正式 FC27 安装身份。构建固定 22 个依赖白名单，不含旧 Rolling/交易；`liveEnabled:false` 硬关闭，脚本沙箱不向页面暴露执行、授权或 GM bridge。
- Journal schema 2 增加 Set 完成次数基线；严格保留 schema 1 读取，但缺少该证据的旧未决记录不得静默升级为可恢复。保存/提交边界仍先写 GM、回读一致再执行，未决不能被新批准覆盖。
- 保存前后中断，仅当全部原卡仍在、进度/包数未变、Unassigned 已清，才提供 `abandoned` 确认。提交不明/已提交，仅当全部精确原卡消失、进度恰增 1、奖励包恰增预期数量且无待处理物品，才提供 `completed` 确认。提交不明但库存未变仍不可重试。
- 恢复先只读检查，用户明确确认后在同一锁内重读记录并重新取证，必要时完成精确缓存清理，再落盘终态；无清空日志、自动重提或强制确认入口。真实未决业务日志恢复尚待后续受控事务验收。
- `scripts/browser-inspection/acceptance.mjs --install --live-read` 自动构建、核对 Tampermonkey 安装器中的完整源码、安装隔离脚本并测试。GM 测试运行于网络拦截的空白匹配页，使用与真实账号隔离的 synthetic journal；**GM API 和原生 Web Lock 是真实的，EA 事务是合成的**。关闭页面前确认原生锁已持有，随后仍能读取 `save-pending`；不是模拟 Map，也不声称验证了服务器提交。
- 专用浏览器沿原 profile 恢复登录，无需用户补卡/抄日志。真实 Provider 确认 Club 41 人、2/2 精确卡 fresh、Unassigned 清空、奖励 509 已拥有数量 0；两卡抽样不等于完整 11 人验证。实际安装面板的铜 Upgrade 准备返回 `SAFE_MATERIAL_SHORTAGE`、`submitted=false`、无需恢复，属于正确保护停止。390/1280 宽度安装面板截图无重叠，Submit once 保持禁用。

### 验证与后续

`npm run verify` 通过 520 个 JS 语法检查、241 文件 / 2463 项测试及 lint、架构、FSU patch replay、构建/资产一致性；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 37 文件 / 483 项测试及全部离线浏览器检查。事务/持久/恢复与构建专项共 139 项。Acceptance bundle 为 129,871 bytes / 22 模块，原只读 Preview 为 53,774 bytes / 14 模块。实机摘要见 `tests/fixtures/fc27-transaction-provider-observation.json`，原始报告/截图在忽略目录 `artifacts/fc27-browser`，不保存账号/球员身份或凭证。

后续发布门禁：

1. 可行低价值整阵与一次实际保存/提交/奖励闭环，执行前单独批准具体目标、上限及次数；当前不要求购买球员、不放宽保护。
2. 正式 `27.0.0` 新安装入口、版本/资产/更新渠道验收与发布审计。Acceptance 的独立身份不能代替正式安装验收；`RENAME_RELEASE_NOT_APPROVED` 保留。

新积分 SBC、连续 Rolling/Swap/Provisions、开包和交易都不在本批开放范围。Runner `0.8.65`、FSU Local `26.09.8` 不变；没有保存 EA 阵容、提交、开包、移动或交易，没有提交 Git、推送或发布。专用浏览器和临时安装服务已关闭，隔离 Acceptance 脚本保留安装且 Live 关闭。

## 2026-09-18 持久日志与跨标签互斥

继续实现上一批事务核心的基础设施，仍不开放 EA 写操作。新增 `src/fc27/traditional-journal.js`、`traditional-lock.js` 和 `src/adapters/browser/fc27-transaction-persistence.js`；通过依赖注入连接 GM API 与浏览器 Web Locks，不进入 FC26 生产、FC27 Preview 或真实页面只读检查命令，也不修改原 FSU。真实 EA 执行 provider 仍是下一步，不把基础设施回归当作业务提交验收。

### 已完成

- Journal 使用精确的赛季/账号/平台作用域 key，不用短 hash，不读取旧季状态。只保存一条 schema 固定的记录、最多 11 个唯一 item/definition refs、目标、奖励和数量基线；不保存授权、凭证或原始 EA 对象。字段缺失、额外字段、稀疏/超量数组、getter、阶段与提交结果不一致均拒绝，不能先截断或丢弃字段再把损坏记录认作有效。
- 直接注入 `GM_getValue/GM_setValue`，支持同步或异步返回，读取异常不转成空记录，写后必须回读一致。没有 localStorage、通用旧存储封装或默认成功 fallback，没有 `remove/clear` 接口；新事务不能覆盖损坏或未决记录。
- 正常日志顺序为 `save-pending -> saved -> submit-pending -> submitted -> completed`，明确拒绝只允许从 `submit-pending -> rejected`。同一事务不能改目标、选中卡或奖励，也不能倒退时间或跳阶段；只有完整终态之后，新的 operation ID 才能开始下一次获批尝试。这不是未知事务的自动恢复或人工确认入口。
- 同源全部新 FC27 单次传统事务共用固定 exclusive Web Lock，使用 `ifAvailable`，竞争时不排队、不读日志、不执行效果；同一实例还保留本地互斥。不支持 Web Locks 时禁止执行，不以页面内锁假装跨标签保护。日志读取/写入必须在匹配作用域的持锁期间执行。
- GM 写入超时不代表写入已取消：已发出的写入尚未结束时，组合层保留原生锁，等待其完成或明确失败，不让下一标签页覆盖仍在写入的记录。若 GM 永久无响应，当前尝试保持锁定，不提供强行解锁/继续；关闭页面后的恢复仍须读取已存证据，不能重发 EA 提交。
- 单次核心复用同一严格 Journal schema，避免两套终态判断；日志初读失败会显示待恢复，EA 明确拒绝但拒绝日志未落盘时也保持待恢复。提交成功的既有确认/对账语义不变，共享 `src/sbc/submit-attempt.js` 未修改。

### 验证边界

新增持久层 43 项测试，事务套件从 56 扩到 63 项；覆盖整套模拟 EA 流程、重建组合层后未决阻断、日志读写错误、拒绝落盘失败及超时写入期间互斥。核心独立 bundle 的白名单增至 7 个模块，仅增加统一 Journal schema，仍不包含 EA Adapter、旧 Workflow、Rolling 或交易。

`scripts/browser-inspection/traditional-persistence-smoke.mjs` 进入既有 `--self-test`：在离线拦截的虚拟 HTTPS 页面启动两个真实 Chrome 标签页，验证原生 Web Locks 竞争、刷新后待处理记录保留、拒绝覆盖、关闭持锁页后锁释放但记录不丢失。GM API 由独立合成 Map/binding 模拟，**不是 Tampermonkey GM 跨刷新实机验收**。报告为忽略目录中的 `artifacts/fc27-browser/traditional-persistence-self-test.json`；没有 EA 页面、账号读写或外部请求，测试浏览器已关闭。

本批完整验证：`npm run verify` 通过 509 个 JS 语法检查、238 文件 / 2430 项测试、架构检查、FSU patch replay、构建及资产一致性；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 34 文件 / 450 项测试及全部离线浏览器检查。`git diff --check` 通过。Runner 仍为 `0.8.65`、FSU Local 仍为 `26.09.8`，生产 Runner、package/lock 和 FSU 维护源没有本批修改；未提交、未推送、未发布。

### 后续顺序

1. 接通并审查真实 EA 执行 provider：原 FSU 整阵定向复核、实时实体、独立保存/回读、DAO submit-only、权威库存和奖励对账；保留现有保护，不要求用户为了开发补卡。
2. 接入独立受控安装入口的真实 GM 注入，验收同一脚本身份下的跨刷新持久化和双标签互斥；补只读恢复证据及明确人工恢复流程。当前未决记录不能通过“重新批准”绕过。
3. 有可行低价值阵容后，单独批准具体目标、材料上限及一次执行，完成真实保存/提交/奖励验收。
4. 再完成 `27.0.0` 全新安装、版本/资产/更新通道验收；`RENAME_RELEASE_NOT_APPROVED` 继续保留。

## 2026-09-18 实时合同与单次事务核心

按用户“继续”实施上一节的前两步，不消耗当前 41 名球员。本次新增真实只读合同 Adapter 和隔离事务核心；不改原 FSU、FC26 生产入口或正式版本，不开放任何浏览器写操作。

### 最新 Set / Challenge / 奖励

`src/adapters/ea/fc27-sbc-contract.js` 从已审查的 DAO `getSets()`、`getChallengesForSet()` 取得两次独立新响应，再对唯一 `IN_PROGRESS` 挑战执行已审查的 squad GET。只读合同不再使用缓存 Set 奖励；不向 EA Repository 注入返回实体，不初始化未开始挑战，不创建编辑器。

- 每次请求起始至少间隔 800ms，单次 15 秒截止；304/401/429/500、未知方法/结构、账号或 DAO 变化均停止，不重试。
- 目前限定单 Challenge、AND 简单传统条件、单一 Pack reward；未知奖励、多个奖励、多阵和其它要求继续拒绝。读取报告不等于所有活动均有执行资格，事务准备仍检查活动时间、完成次数、保护和材料。
- 保存/提交方法只比较源码指纹，绝不调用。`writeContractVerified=false` 保留，不能把方法源码吻合当作实际保存/提交验收。
- 专用浏览器新增 `runner-contract <setId>`；它单独打包读取 Adapter，不带入事务核心。内部合同保留账号作用域，命令输出去掉 context，仅返回白名单字段。

本次专用浏览器沿原 profile 恢复登录，无需用户操作；Bronze Upgrade（Set 4 / Challenge 16）与 Gold Upgrade（Set 6 / Challenge 18）均取得最新 Set、规范化需求和真实槽位，Pack 奖励分别为 509、1022，数量 1、不可交易。`getSets/getChallengesForSet/saveChallenge/submitChallenge` 四个方法指纹均吻合；没有执行后两个方法。实机摘要在 `tests/fixtures/fc27-fresh-sbc-contract-observation.json`，不含账号和球员 ID。浏览器及临时安装服务已正常关闭，profile 保留。

### 隔离事务核心

`src/fc27/traditional-transaction.js` 复用现有纯 `previewTraditionalSquad()` 和共享 `submitSbcAttempt()`，没有重写共享提交实现。它不进入生产 Runner、FC27 Preview 或检查工具构建；所有真实效果通过未来的 Adapter、持久 Journal 和跨标签互斥注入。

- `prepare()` 绑定规范化账号/赛季/平台、当前 Set/Challenge/奖励、原保护策略和精确选中实体/位置，生成深度不可变计划；暂限普通不可交易 Club 卡、最高 83，仍服从更低的用户上限、FSU Gold Range、联赛及所有保护，不支持 Storage/Swap/特殊卡。
- `approve()` 要求结构化明确批准、精确目标、上限、人数及一次执行；权限仅保存在内存 WeakMap，绑定该实例生成的计划，60 秒过期、只能消费一次，不接受克隆/跨重载权限。默认 `enabled=false`，非布尔真值也不能开启。
- `execute()` 强制要求已验证的“提交时不隐式保存”Adapter、作用域 Journal 与跨标签互斥。执行逐卡 fresh 校验、保存、实际阵容回读/验证、最终再次校验，再发送一次提交；不换卡、不调用 Service 自动再保存、不设置 `skipValidation:true`、不自动重试 409 或未知回执。
- 保存/提交前先持久化 `save-pending/submit-pending` 并回读确认；只存一条当前作用域有界记录，最多 11 个精确 refs、目标、预期奖励和包数量基线。未决/损坏记录或其它上下文记录都阻止新操作；标为 completed/rejected 的记录同样必须通过 item/definition 唯一性、奖励完整性和非负整数基线校验，损坏时保留原记录且零保存/提交。内存授权不写入记录，也不进入诊断。
- 提交确认后即使 Stop、Journal 后续写入失败或锁释放异常，也保留 `submitted=true` 并执行对账。只有同一目标的进度、精确消费 refs 和目标包相对基线的数量增量都确认后才完成；其它情况保留未决记录。不将无回执、错目标或超时当成失败后可重试，提交不明为 `submitted=null`。
- 每个注入效果有 15 秒外层截止。超时不是撤销 EA 操作，也不证明服务端没执行；后续必须对账，不能重新发送。锁提供者提前返回不能留下仍可继续写入的后台操作。

事务核心新增 56 项测试，包含两份真实需求配合明确合成库存的 11 人准备，以及精确属性变化、保护、策略/账号变化、保存后错槽、授权过期/复用、并发、默认关闭、能力撤销、409、无回执、超时、Journal 故障与终态损坏、完整终态后重新批准、奖励不足、Stop 与锁丢失。独立打包只含 6 个白名单模块（新核心、传统 Planner、context、共享 SBC transaction 和两个 domain 文件），没有旧 Workflow、Rolling、交易、UI 或 EA Adapter；压缩体积限制 25 KB。

### 当前完成边界

| 项目 | 当前状态 |
| --- | --- |
| 最新 Set / Challenge / 奖励合同与方法源码复核 | Adapter 已实现；铜、金 Upgrade 实机只读通过；不是写事务验收 |
| 单次事务编排、精确批准、保存/提交前后校验与对账判定 | 核心及合成效果回归完成；尚未连接真实 EA mutation |
| 下一阶段：真实执行 provider | 接入原 FSU 整阵定向校验、最新 EA 实体定位、独立 squad 构造/保存/回读、DAO submit-only 和权威库存/奖励对账；不得直接复制合成测试的 `fresh/verified` 标志 |
| 下一阶段：GM / 跨标签锁 / 未决恢复 | 接入真实 GM Journal 与 Web Lock，完成跨刷新实机验收；当前核心只阻断未决记录，还没有自动恢复或人工清除入口 |
| 真实低价值事务 | 待材料可行并单独批准具体目标、上限及次数；不要求用户现在买卡 |
| `27.0.0` 新安装与发布 | 仍 Pending，`RENAME_RELEASE_NOT_APPROVED` 不变；不能仅凭上述离线核心通过升版发布 |

本批收尾：`npm run verify` 通过 504 个 JS 语法检查、237 文件 / 2380 项测试、架构检查、FSU patch replay、构建及资产校验；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 33 文件 / 400 项测试及离线浏览器检查。隔离 Runner Preview 为 53,774 bytes / 14 模块，仍不含事务核心。`git diff --check` 通过；package/lock、生产 Runner 源码/产物和共享 `submit-attempt` 无本批改动，构建版本仍为 Runner `0.8.65`、FSU Local `26.09.8`。未提交、未推送、未发布；本批真实 EA 操作仅为上文只读合同读取，没有保存、提交或消耗球员。

## 2026-09-18 用户确认 41 人后的发布续验

用户已完成本次专用浏览器登录，并明确确认当前 Club 确实只有 41 名球员。该数量与读取到的 49 个条目 / 41 名球员一致；本次缺料不能再解释成缓存漏加载，也不应靠重复刷新或要求用户买卡来通过测试。数量确认不改变 `trusted-provisional` 合同，实际选中整阵仍须提交前逐卡定向复核；其它 pile 的被动空缓存不等于服务器权威空库存。

本次 Tampermonkey 管理页独立确认原 FSU Local `26.09.8`，没有安装 Runner。FC27 账号/Persona/SKU 匹配，FSU 自然初始化成功；原 `validateClubPlayers` 两卡抽样再次通过 `fresh=true`、2/2 精确身份及安全属性一致。不改 FSU 设置或源码，没有填阵、保存、提交、开包、移动、领取或交易。

| 目标 | 安全候选 / 所需 | 当前停止原因 | Set 层观察到的奖励 |
| --- | --- | --- | --- |
| Bronze Upgrade，Set 4 / Challenge 16 | 5 / 11 | `SAFE_MATERIAL_SHORTAGE` | pack 509，1 个，不可交易 |
| Silver Upgrade，Set 5 / Challenge 42 | 7 / 11 | `SAFE_MATERIAL_SHORTAGE` | pack 1013，1 个，不可交易 |
| Gold Upgrade，Set 6 / Challenge 18 | 5 / 11 | `SAFE_MATERIAL_SHORTAGE` | pack 1022，1 个，不可交易 |

上述是现有保护策略下的正常不足，不是程序卡死。铜/银上限 74，金上限为已批准的 83，并与 FSU 范围取交集；Only Untradeable、五个联赛排除及特殊/进化等保护均保留。Intro to SBCs 和 Intro to Upgrade SBCs 的已读取挑战均已完成，不能重做作为低成本验收。League & Nation Advanced 含多阵、联赛/国家/化学要求，不属于当前单阵简单条件预览范围，未据此扩大支持或初始化其它挑战。

本批仅补只读 Catalog 的奖励投影：原实现只返回 Challenge awards，三种 Upgrade 的该数组都是空，不能据此判断没有奖励。新增 `setRewards` 明确标记 `source=cached-set,fresh=false`；Challenge 仍来自本次 GET，未知 Set 奖励保持 `null`，不冒充空数组。调用前后 Set 奖励摘要变化时停止，不调用 getter、不追加 Set 刷新或写操作。`rewardIdentityVerified=false` 与 Live 门禁保持：缓存包 ID 不是新鲜 Set 合同，更不是奖励已经发放的证明。

实机重新读取三个 Catalog，确认上述分层；新增脱敏 fixture `tests/fixtures/fc27-low-inventory-acceptance-observation.json`，没有账号或球员 ID。6 项新增回归覆盖两层奖励、缺失/空/未知/getter/超界、读取期间变化及三个实际 SBC 的合成账号回放。未修改生产 Runner、package/lock、FSU mod/patch 或发布门禁。

### 提交接口的静态审查

继续检查此前取得的 EA 官方公开 `compiled_2.js`，SHA256 仍为 `8EF7D4415E8BD61B39114808866C831A3EC40301F1BCACF5E5FC170F6D0DC00F`。这是已下载源码的静态证据，不是本次运行时方法指纹或真实事务通过，原文仅留在忽略的 artifacts：

- DAO `saveChallenge(id, squad)` 使用 PUT `/sbs/challenge/{id}/squad`，逐槽保存 `index/itemData.id/dream`。
- DAO `submitChallenge(id, skipValidation, chemistryVersion)` 使用 PUT `/sbs/challenge/{id}`；保留 `skipUserSquadValidation`，成功 DTO 包含 `challengeId/setId/grantedChallengeAwards` 等字段；返回 squads 时转换为关联 warning name 与 item IDs 的 409，不能把它当已提交。
- **Service `submitChallenge(challenge, set, ...)` 内部先调用 `saveChallenge`，成功后才提交**，还会更新完成次数、重置可重复 Set、删除本地已消费卡及清理 squad cache。因此不能直接将它放在一次保存后校验之后，声称最终提交前没有再次写阵；使用 DAO 时也必须显式完成对应对账，不能只把 Service 换成 DAO 后假定行为等价。

### 距离 27.0.0 的剩余工作

不能把当前阻断简化为“只差凑齐 11 张卡”。隔离 Runner 目前仍是只读 Preview，生产入口仍为 `0.8.65`。材料不足只影响实机正向配阵和真实提交，下面的实现工作仍可在材料不足期间推进：

| 顺序 | 工作 | 当前状态 / 所需用户操作 |
| --- | --- | --- |
| 1 | 新鲜 Set + Challenge + 奖励合同，当前运行时方法指纹复核 | 未完成；Agent 继续只读完成，无需补卡 |
| 2 | 独立 FC27 单次传统事务：精确计划、整阵定向复核、保存回读、最终验证、提交一次、奖励/库存对账 | 待实现及合成数据回归；不应自动开放旧 FC26 全部 Loop |
| 3 | 超时结果不明、重复点击、Stop、刷新恢复及未到账保护 | 待事务实现与验证；未知提交不得自动重试 |
| 4 | 真实完整预览及一次低价值保存/提交/奖励确认 | 待自然获得合适材料或新低成本目标；届时单独批准目标、材料上限和次数，不要求现在买卡 |
| 5 | `27.0.0` 新安装入口、版本/资产/更新通道及实机安装验收 | 待前述闭环；继续保留 `RENAME_RELEASE_NOT_APPROVED` |

FSU 价格显示的完整验收单独追踪，不把恢复全部 FSU 功能当作首个传统 SBC Runner 版本的前提。新积分 SBC、旧 Rolling/Swap/Provisions/交易仍不因本次读取自动开放。

本批收尾：`npm run verify` 通过 500 个 JS 语法检查、235 文件 / 2308 项测试、FSU patch replay、构建及资产校验；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 31 文件 / 328 项及离线浏览器检查，隔离 Runner 为 53,752 bytes / 14 模块。`git diff --check` 通过。专用浏览器和临时安装服务已正常关闭，profile 保留。未升版本、未提交、未推送、未发布。

## 2026-09-18 自然重启与初始化竞态定位

用户要求重开专用浏览器，检查正常登录是否恢复。本轮使用原 profile、代理 `127.0.0.1:1080` 和已安装的原 FSU `26.09.8`，复用登录状态，无需用户重新输入凭证。全程没有手动调用 `events.init()`，没有设置 readiness 标志，也没有执行填阵、保存、提交、开包、移动或交易。

- 首次重开自然初始化成功，Club 进入 `trusted-provisional`，不是全量 ready；build/set/lock 三组运行时指纹与升级前一致。管理页再次确认实际版本 `26.09.8`。
- 继续调用原 FSU 的有界定向验证，2/2 卡片的 fresh 精确身份与安全属性通过；不将两卡抽样推广为全量校验。
- 核对原 `getPriceForUrl` 和 `externalRequest` 源码 hash 后，向当前 provider 3（FutNext）只查询两种卡，2/2 返回有效非零报价，设置未变。请求没有赛季参数，本次不能确认 FC27 报价归属，也没有验证卡面显示；未切换 provider、写价格缓存或调用会继续 fallback 的批量 `loadPlayerInfo`。
- 后续刷新有一次约 24 秒后自然初始化成功，也有一次持续未初始化。最终失败复现抓到原警告 `cntlr.current() 为空，跳过初始化`：20,013ms 触发检查时 Controller 为空，21,911ms 已观察到 Controller 存在，但 55 次一秒轮询结束仍 `initialized=false/initPending=false`。没有 pageerror。虽然该轮试图对照后台刷新，采样中 `document.visibilityState` 始终 visible，不能归因于后台节流。

已确认的失败调用链为 `UTHomeHubView.prototype._generate` -> `events.waitForClickShieldToHide` -> 一次性 `cntlr.current()` 检查 -> 空值分支仅警告退出。遮罩结束不等于 Controller 已就绪；随后 Controller 就绪没有重试，且 Home 已 `_generated`，不会因等待而重新注册初始化。该次属于真实初始化遗漏，不是库存不足、安全选材停止或价格查询失败。其它历史失败是否全部同因仍未证明。Runner 随后返回 `FC27_FSU_SEASON_MISMATCH`，但 EA 上下文已确认 FC27，FSU 尚未初始化；不能把该停止码单独解释为账号进入旧赛季。

最小修复已完成：原 mod 新增只供 Home 启动使用的 30 秒有界 readiness 等待，逐 100ms 检查当前 App/root、Home 视图挂载、Controller、父级视图和 click shield；复用 `initialized/initPromise` 去重，页面离开、视图替换和超时都会取消，不修改共用的 `waitForClickShieldToHide`，也不提升 Club readiness。Local 版本递增至 `26.09.8`，patch、manifest 和资产已重建。回归覆盖 Controller 迟到、遮罩超时、重复触发、初始化占用、页面离开和失败不重试。

修复后专用浏览器自然冷启动及连续两次刷新均通过：无启动警告、无 page error、未手动初始化；约 32 秒进入 initialized，约 36 秒进入 `trusted-provisional`。价格赛季/显示、真实配阵与事务仍未验收，`27.0.0` 发布继续阻断。证据为 `tests/fixtures/fc27-fsu-startup-race-observation.json`；临时启动/价格探针已删除。

收尾验证：`npm run verify` 通过 500 个 JS 语法检查、235 文件/2302 项测试、FSU patch replay、构建及正式资产检查；FC27 专项检查通过（含新增启动回归），`git diff --check` 通过。专用浏览器验证后已关闭，profile 和已安装 FSU `26.09.8` 保留。

## 2026-09-18 FSU 升级与 Runner 只读面板

本批在用户授权的专用浏览器继续验证，未执行填阵、保存、提交、开包、移动或交易。Runner/package 保持 `0.8.65`，FSU 维护源、patch 和正式资产未改；仅将浏览器中的原 FSU 从 `26.09.6` 升级到已有的 `26.09.7`。没有安装独立 FSU Preview，也没有提交或推送 Git。

| 项目 | 结果 | 边界 |
| --- | --- | --- |
| 原 FSU 升级安装 | Complete | 刷新 Tampermonkey 管理页后确认实际版本为 `26.09.7`，不是以磁盘版本推断 |
| 设置保留 | Complete（运行时三组） | 升级前后 `info.build/set/lock` 的规范化 SHA256 完全相同；仅输出摘要，不导出锁卡 ID/设置内容。不是所有 GM key 的逐项验收 |
| 自动初始化 | **Pending / 新发现阻断** | 刷新后 `info/events`、Home hook 和 FSU Home tiles 存在，但 initialized=false、设置未加载、Club 未就绪。关闭已识别的每日登录通知、重新进入 Home 均未恢复；不能直接归因于通知、代理或价格补丁 |
| 原初始化函数 | 受控调用通过 | 审查原函数并校验其源码 hash，在 FC27 Home、无 modal/shield、无在途初始化时调用一次；随后 initialized=true、Club ready、设置指纹一致。该诊断恢复不是自动启动验收，临时调用入口已从工具删除 |
| Runner 只读面板 | 实机负向预览通过 | 临时注入隔离 Preview 构建，选择实际 Gold Upgrade / 83，显示 `SAFE_MATERIAL_SHORTAGE` 和 5/11。读取 41 名 Club 缓存球员，仍标记 partial，不虚称全 pile 权威库存 |
| 价格 / 一键填阵 / Live | Pending | 已确认运行中的价格函数为赛季绑定版本；未验收第三方报价成功、卡面价格或原 FSU 写阵，更未验收 Runner 提交与奖励 |

面板使用既有原 FSU Adapter 与传统预览，不另建 FSU 设置/库存服务。提供本地输入刷新、当前缓存 Set 选择、74/83 分只读上限及缺料诊断；上限仍与 FSU Gold Range 取交集，原联赛/不可交易及特殊/进化等保护不变。当前只有 Club 候选，无填阵/保存/提交入口、无自动请求循环、无价格/交易/旧 Rolling 引用。预览请求串行，输入变化清除旧结果，退出后的迟到结果不再渲染。未知条件继续拒绝。

构建白名单从原先 4 个被动检查模块扩至 14 个已审查只读模块，产物约 53 KB，仍隔离于 FC26 生产入口。正式版本与发布阻断不变。`runner-panel` 临时挂载当前代码，不写 Tampermonkey；`runner-panel-preview <setId> [74|83]` 只操作自己的预览控件；`runner-settings` 仅输出三组设置摘要。真实页面截图仅截面板，保存在被忽略的 `artifacts/fc27-browser/runner-panel-live.png`；脱敏事实为 `tests/fixtures/fc27-fsu-upgrade-panel-observation.json`。

下一步先定位并最小修复原 FSU 自动初始化触发链，补冷启动/刷新回归，不能用 Runner 自动调用 init 或直接把 Club 标记 ready 来绕过。随后验收原价格请求/卡面显示。卡量不足时继续离线验证事务与只读检查，不要求用户买卡；写阵/单次提交须具体目标、材料上限和次数另行批准。成功完整配阵、事务/奖励对账、恢复、真实 userscript 安装和 `27.0.0` 发布仍待验收。

最终验证：`npm run verify` 通过 499 个 JS 语法检查、234 文件/2282 项测试、FSU patch replay、构建与正式产物一致性；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 30 文件/302 项及离线浏览器检查。新增面板覆盖串行、未知目标/上限拒绝、缺料、输入刷新清旧结果、退出后迟到结果及异常脱敏；桌面 1280、移动 390/320 宽均通过布局和截图检查。初次 lint 的三处浏览器全局引用已修正为 `globalThis`，完整重跑通过。`git diff --check` 通过；正式发布门禁仍保留。验证浏览器与临时安装服务结束后关闭，专用 profile 和安装的 FSU `26.09.7` 保留，下一轮由 Agent 重开，不要求用户为检查准备额外材料。

## 2026-09-18 缺卡期间的原 FSU 抽样验证

用户确认开服卡量不足，本轮不要求买卡、开包或反复重试缺料阵。由 Agent 在已登录的专用浏览器继续只读验证；未改原 FSU、GM 设置或 EA 库存，未安装新版脚本。

| 项目 | 结果 | 验收边界 |
| --- | --- | --- |
| 原 FSU 精确查卡 | 实机通过 2/2 | 调用实际安装 `26.09.6` 的 `validateClubPlayers`，fresh payload 的 item/definition 与回读实体、安全属性一致；Club 仍为 `trusted-provisional`，不是全量 ready |
| 完整 11 人只读规划 | 离线通过 | 使用真实 Gold 条件/槽位和明确合成的充足库存；未把模拟球员注入浏览器，不是实机完整配阵 |
| 后续库存变化 | 离线通过 | 两个不同模拟库存快照规划两阵且 item 不重复，耗尽停止，加入新模拟材料后重新规划；不是连续提交或奖励开包验收 |
| 原价格接口 | 仅被动检查 | 当前 provider 为 `3`（FutNext）；函数仍含 FUT.GG `/26/` 分支，但本轮未调用，不能据此宣称请求了旧赛季价格。缓存有 28 张 EA 均价，不代表第三方报价或卡面显示已通过 |
| 保存、提交、奖励、停止恢复 | Pending | 等自然积累材料或出现合适的低成本目标，再单独批准目标、上限及次数；不为测试放宽保护 |

新增 `runner-support`（零网络函数/缓存检查）和 `runner-validate`（最多两卡原 FSU 定向查询）。后者先核对 FC27 上下文、原方法 SHA256、空闲队列与 capture hook；继续使用 FSU 自有 scoped capture、每次 45 秒/最多两次的有界请求，诊断外层 100 秒截止且不额外重试。失败只输出脱敏停止码，返回 `cached:true` 时单独报告缓存匹配，不冒充 fresh 证据。原接口可能按查询结果更新其本地实体缓存，不执行账号物品操作。

首次诊断误报 `FC27_FSU_VALIDATION_BUSY`，没有调用 FSU。原因是原 FSU 在第一次请求时才初始化 `clubPayloadCaptureSessions`，快速缓存启动时该属性确实不存在。先补失败测试，再只修诊断的空闲判断：允许属性完全不存在，仍拒绝 null、未知形状、getter 和非空集合；没有修改原 FSU capture 或 readiness 逻辑。修正后取得上述 2/2 fresh 结果。脱敏实机摘要见 `tests/fixtures/fc27-original-fsu-sample-observation.json`，此前缺料 fixture 保持历史语义。

价格季节绑定补丁仍是磁盘上的 `26.09.7`，尚未升级安装或实机验收。原 FSU `externalRequest` 缺少显式超时、FutNext URL 不含赛季，本轮没有主动触发该价格请求，也未改 provider 设置。后续价格验收应单独核对新版本、有效请求赛季和真实卡面显示，不能将接口存在性当作恢复完成。

最终验证：`npm run verify` 通过 495 个 JS 语法检查、233 个测试文件、2274 项测试及 FSU patch replay、构建、dist/Local 资产检查；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 29 文件、294 项及离线桌面/移动 smoke。初次 lint 发现诊断模块的 `TextEncoder` 全局引用不合规范，已改用现有 Adapter 的 `globalThis.TextEncoder` 后完整重跑通过。`git diff --check` 通过，生产 Runner、package/lock、FSU 维护源/patch/正式资产均未改变。

本轮生产 Runner 仍为 `0.8.65`；正式发布检查按预期返回 `RENAME_RELEASE_NOT_APPROVED`，FC27 Live 和 `27.0.0` 发布门禁保持。未提交、未推送、未升版本。专用浏览器保留在空闲命令提示符，没有自动业务运行；当前不需要用户重新登录或准备测试材料。

## 2026-09-18 获批 83 分金卡只读预览

用户明确批准把本次只读预览上限从 74 扩至原 FSU 允许的 83 分。`runner-preview <setId> [74|83]` 现在接受显式参数，省略时仍为 74；有效上限与原 FSU Gold Range 取更严格值。其它保护不变，不持久化策略、不修改原 FSU 或其 GM 设置，也不授权填阵、保存、提交、开包或交易。

- Gold Upgrade（Set 6 / Challenge 18）的当前列表和 squad GET 均成功，挑战为 `IN_PROGRESS`、11 槽、无 brick。真实条件为 `PLAYER_QUALITY=3,count=-1,scope=GREATER(0),value=3`，与铜/银的 EXACT 不同。依据 EA 最低整队品质比较补齐“最低金卡”这一已观察组合，归一化为全部球员 75-99 分；它不是允许超过用户 83 分上限。最低铜/银、其它 scope、未知枚举及化学等未审查条件仍拒绝。
- 83 分预览两次均返回 `SAFE_MATERIAL_SHORTAGE`：41 名缓存球员中，5 张安全候选，距离 11 人还差 6 张。第二次新增的首个失败条件计数为评分不在要求/策略范围 25 张、不可交易检查未通过 3 张、联赛检查未通过 8 张；后两项包含属性未知时的安全拒绝，不把重叠排除重复计数，也不输出球员或账号身份。
- 本次保留 Only Untradeable、特殊/进化/租借/概念等保护及原 FSU 五个联赛排除；Lock/Active Squad 仍为已批准的默认关闭。库存仅为 Club 缓存，`provisional/complete:false`，没有 FSU 全量或精确定向读取，不能据此断言完整账号资源不足。Storage、Unassigned、Transfer 不在本次候选范围。
- 改动限于 FC27 只读 Adapter、纯预览诊断和专用浏览器命令，不接入 FC26 生产入口、不修改 FSU mod/patch/资产。脱敏事实追加到 `tests/fixtures/fc27-original-fsu-runner-observation.json` 的 `goldPreview`，此前 74 分铜/银记录保留。回放测试的球员全为合成数据，不冒充真实库存。

最终验证：`npm run verify` 通过 493 个 JS 语法检查、232 个测试文件、2246 项测试及 FSU patch replay、构建、dist/Local 资产一致性检查；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 28 文件、266 项及离线桌面/移动 smoke。`git diff --check` 通过，package/lock/生产 Runner/FSU 维护源与发布产物均无本批差异。正式发布检查仍按预期返回 `RENAME_RELEASE_NOT_APPROVED`。未提交、未推送、未升版本。

本批原定下一步为原 FSU 受控精确实体读取；现已完成两卡抽样，见本页最新记录。用户确认开服卡量不足，不要求补卡，也不继续抬高上限或取消联赛保护来凑阵。真实正向完整配阵、奖励身份、单次保存/提交与对账、停止恢复和全新安装仍待验收，因此 Runner 保持 `0.8.65`，`27.0.0` 发布仍阻断。

## 2026-09-18 登录后原 FSU / Runner 只读续验

本批用户完成专用浏览器登录后，由 Agent 执行只读检查。Tampermonkey 管理页再次确认实际安装原 Local FSU `26.09.6`、没有 Runner；没有把本地产物 `26.09.7` 当作已安装版本，没有安装独立 Preview。

- 当前 FC27 账号/Persona/SKU 上下文通过精确匹配；FSU 已初始化，缓存状态为 `trusted-provisional`。读取到 49 个 Club 条目、41 名球员，但缓存依然标记 `complete:false`，没有执行 FSU 全量或定向复核。
- FSU 实际策略为 Only Untradeable 开启、Exclude Evolution 关闭、排除 5 个联赛、Storage 优先、Gold Range `75-83`。仅本次诊断在内存中叠加用户此前批准的最高 74 分、排除特殊/进化/租借/概念卡；保留 FSU 联赛排除，不保存或修改原设置，Lock/Active Squad 保护仍按已批准的默认关闭。
- 起初 `inProgressChallenges=0` 只表示本地 Set 的 Challenge 尚未加载，不能据此认定没有活动。新增 `runner-catalog <setId>` 只调用源码 hash 已核对的 `getChallengesForSet` GET；不调用 `loadChallenge` 初始化分支、不写回 Repository、不进入编辑器或触发自动填阵。15 秒超时，错误/429 不重试，不输出账号和卡片 ID。
- Bronze Upgrade（Set 4 / Challenge 16）和 Silver Upgrade（Set 5 / Challenge 42）均为 `IN_PROGRESS`。它们使用 `PLAYER_QUALITY=3`、`count=-1`、`scope=EXACT(2)`，分别取值 1/2。旧 FC27 解析器只识别全员 OVR min/max，现依据 EA 的整队品质比较与 64/74 分界补齐精确 Bronze/Silver/Gold 条件；`-1` 原样保留，不误当人数或未知值。其它 scope、组合条件、化学及未知枚举仍拒绝。
- `runner-preview <setId>` 用同一只读列表响应绑定已经进行中的挑战，再通过已核对源码的 GET 读取阵容槽位，两次请求起始至少间隔 800ms。铜、银阵实机均为 11 槽、无 brick；不初始化未开始挑战。原 FSU 缓存与临时严格策略接入纯 Planner，不引入新的 FSU 设置或库存服务。

| 实际只读结果 | 需要 | 缓存中安全候选 | 停止原因 |
| --- | --- | --- | --- |
| Bronze Upgrade | 11 | 5 | `SAFE_MATERIAL_SHORTAGE` |
| Silver Upgrade | 11 | 7 | `SAFE_MATERIAL_SHORTAGE` |

这是当前缓存和保护策略下的正常停止，不是卡死，也不能据此宣称完整 Club 确实缺卡。四个 Intro to SBCs Challenge 均已完成，旧 A Brace 两人阵不能继续作为未完成实测目标。无填阵、保存、提交、开包、移动或交易；没有为了配齐材料提高评分上限或取消联赛保护。

脱敏证据：`tests/fixtures/fc27-original-fsu-runner-observation.json`。新增列表读取、原 FSU 只读规划、品质规则和 fixture 回放测试，覆盖账号/策略变化、未知属性、可交易/租借/特殊卡保护、未开始挑战拒绝和错误无重试。当前只完成负向材料不足路径，正向完整配阵、原 FSU 精确实体复核、奖励归属、单次事务、恢复和安装发布仍待验收；生产版本继续 `0.8.65`，不解除 `27.0.0` 发布门禁。

后续再次读取 Bronze 列表遇到 `FC27_CATALOG_READ_UNCONFIRMED` / `status=0`，本次没有自动重试，也未继续读取 squad。它只证明该次读取没有成功，不能推断为提交失败、封禁或特定代理问题；随后零请求的 Runner 输入检查仍能读取原上下文与 provisional 缓存。该 transport 结果另存 fixture 并加入回归，不覆盖前两次已经取得的真实布局和选材不足证据。检查工具在长会话中热更新构建模块的缓存问题也已修正，并增加三个命令接线测试。

最终验证：`npm run verify` 通过 493 个 JS 语法检查、232 个测试文件、2237 项测试，FSU patch replay、构建、dist 一致性和 Local 资产检查通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 28 文件、257 项及离线桌面/移动 smoke，`git diff --check` 通过。正式发布检查仍按预期返回 `RENAME_RELEASE_NOT_APPROVED`。未提交、未推送、未升版本。

本批结束时专用浏览器保持打开、无自动业务运行，83 分扩展尚待批准；后续用户已批准并完成金卡只读检查，结果见本页最新记录。真实保存/提交、材料消耗和奖励处理仍需另行批准。下文“未登录”为上一批历史状态，不提前标记 `27.0.0` 验收完成。

## 2026-09-18 Runner 发布准备续验

用户要求继续验证 Runner，准备首个正式 `27.0.0`。当前仍是验证/实现阶段，不是发布授权；生产入口与 package 保持 `0.8.65`，未创建 tag、Release 或推送。

| 验收项 | 状态 | 本轮结果与接续 |
| --- | --- | --- |
| 离线冻结与 FSU 维护边界 | Complete | Runner 冻结比较不变；FSU origin 与历史 Git blob 逐字节一致。Local 只允许同一上游的本地修订递增，配置、身份和权限不可漂移，仍强制 manifest/hash/patch replay；旧冻结误阻断已修正 |
| Runner 读取原 FSU 的检查入口 | Complete（诊断） | 新增 `runner` 只读命令，读取确切上下文、原 FSU 策略、ready/provisional、定向验证函数存在性、缓存数量及进行中 Challenge 数；不调用 FSU 函数，不把 partial 缓存提升为权威库存 |
| 专用浏览器安装版本 | Partial | Tampermonkey 5.5.0 管理页实际列出一个 Local FSU `26.09.6`，未安装 Runner；这次没有安装或启用新脚本。不能把磁盘上的 `26.09.7` 当作已安装版本 |
| FC27 登录后策略/库存合同 | Waiting for login | 页面 `login=true`、账号/Persona/SKU 未取得，`runner` 返回 `FC27_CONTEXT_UNAVAILABLE`、`liveExecutionEnabled=false`。已请用户只完成登录/验证码，其余诊断由 Agent 执行 |
| 传统 SBC 只读规划 | Pending | 登录后取得当前 Challenge 和真实完整条件，沿原 FSU 设置核对保护、材料、槽位及精确身份；旧 research planner 只支持已验证人数/全员 OVR min/max，不宣称可解全部传统 SBC |
| 单次写阵/保存/提交及奖励对账 | Pending，需另行批准 | 先展示具体目标、材料上限及次数，再验证保存回读、提交确认、奖励身份和材料消耗；不能将本次“继续验证”扩大为材料消耗授权 |
| 停止/异常恢复与安装发布 | Pending | 实机通过后才接正式入口、确定首版支持范围、完成全新安装及更新通道验收，再同步 package/lock/产物为 `27.0.0`；不提前删除发布阻断 |

验证：`npm run verify` 通过 490 个 JS 语法检查、230 个测试文件、2213 项测试；FSU patch replay、构建、dist 一致性通过。`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 26 文件、233 项测试及 Chrome 离线桌面/移动 smoke。新增 15 项 FSU 维护边界测试、10 项 Runner 输入检查测试、1 项 runtime 工具回归；未知字段不取宽松默认值，未调用填阵、保存、提交、开包、移动或交易。

专用浏览器接续：`node scripts/browser-inspection/fsu-setup.mjs --proxy http://127.0.0.1:1080`。Agent 使用 `manager`/`scripts` 核对实际安装版本，`runtime` 查看脱敏页面证据，`runner` 查看接入阻断；用户只需登录。`runner` 是有白名单依赖的临时诊断构建，不安装全局对象、不启动旧 Runner、不写保护策略。检查到函数存在不代表其网络/业务合同已通过。

本轮最终仍未登录，Agent 已用 `q` 关闭专用浏览器及安装服务，profile 保留，下次需由 Agent 重开后请用户登录。`git diff --check` 通过；正式发布检查仍按预期返回 `RENAME_RELEASE_NOT_APPROVED`，没有解除门禁、提交 Git 或推送本轮改动。

以下记录按各历史批次理解；阶段提交时的旧冻结阻断已被本节替代，历史安装版本不确定记录不回填为本次新证据。

日期：2026-09-17。用户授权继续五步适配，要求由 Agent 完成能自动完成的操作。本文件区分真实页面证据、离线实现和未完成门禁，不把插件按钮出现等同于兼容成功。

2026-09-18 阶段提交边界：本次保存 FSU Local `26.09.7` 的 FUT.GG 赛季修复、FC27 只读适配/浏览器工具、上游候选检查及历史 Preview 研究代码。Runner 保持 `0.8.65`，不接入 FC27 Live、不创建 tag/Release、不推送。独立 Preview 不是默认安装或后续必做路线。专项预发布命令仍被旧 FSU 冻结检查阻断，见 [当前验证与限制](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md#2026-09-18-当前增量修复)；原型时期的成功记录不可覆盖这个阻断。

证据修正：原版初始化/Club ready 记录的实际安装版本未独立确认，fixture 已将 `scriptVersion` 改为未知，保留历史路线基线与原误记的本地产物版本。不能据此宣称 `26.09.7` 已安装或实机通过。当前没有运行中的专用浏览器；接续时需重新打开并核对版本。

本次提交前验证：`npm run verify` 通过 228 文件、2187 项测试；独立 FC27/上游测试通过 24 文件、207 项，三项隔离构建、FSU core lint 和 Chrome 离线桌面/移动 smoke 均通过。未访问真实 EA 页面、未执行账号写操作；预发布总检查的冻结边界阻断仍保留，不把分项成功称为全部门禁通过。

## 后续 FSU 接线

2026-09-18 价格修复批次：基于原 `26.09.6` 的最小增量修复已升为 FSU Local `26.09.7`。FUT.GG 查询和登录探测不再写死 `/26/`，未知赛季直接停用 FUT.GG 请求；原 FutNext fallback、一键填阵、库存、保护和提交逻辑未改。当时 patch replay、构建和 release 资产检查通过，`npm run verify` 为 228 个测试文件、2186 项测试，`git diff --check` 通过。最近专用浏览器检查未登录，随后已关闭，尚未取得新的 `initialized/clubReady` 或真实价格/一键填阵只读证据。

2026-09-18 路线已修正为原 `26.09.6` 的增量兼容修复，不再发展独立 FSU 替代品。已在同一专用浏览器中替换 Preview、恢复未经修改的原包，实机为 `initialized=true/clubReady=true/clubCacheStatus=ready`，原价格与一键填阵函数/设置存在；没有执行填阵或提交。证据见 `tests/fixtures/fc27-fsu-local-baseline-observation.json`。此前独立 Preview 的五步门禁仅保留历史参考，不再要求先完成它的策略/锁卡/配阵才能检查原版。后续直接在原调用链复现价格与填阵问题，最小修改并复测，详情见 [当前 FSU 路线](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

2026-09-17 最新安装验收：用户恢复代理并安装 Tampermonkey 5.5.0 / Preview `26.09.6.27.2`、开启“允许用户脚本”后，Agent 确认真实 GM 独立自检键写后回读及跨刷新保留，面板与桥已加载。通过真实面板读取 41 名 Club 球员，首屏 25 张显示 EA 均价；FUT.GG GM 请求返回 403，保留 EA 均价。脱敏证据为 `tests/fixtures/fc27-fsu-installation-observation.json`。策略/锁卡业务 key、整条配阵和实际写入仍未验收，不能用安装诊断替代 readiness。此记录取代下文历史段落的“GM 真安装未验收”。

本批通过完整 verify 227 文件/2,183 测试，FC27/browser gate 24 文件/205 测试，Preview .2 为 85,068 bytes、19 个模块；生产 Runner/FSU/原 patch 不变，未提交/推送。用户已批准默认低评分策略的只读配阵，但随后询问独立 Preview 的维护范围；本次未保存策略或执行配阵，专用浏览器及安装服务已正常关闭。继续前应明确临时 Preview 与长期上游兼容层的界线，不能把整个 FSU 重写作为恢复两项功能的默认路线。

历史 Preview .1 批次的优先级为一键填阵与价格显示，市场工具和 Evo 延后。当时已完成 GM 注入入口、作用域策略/锁卡界面、冷启动 bridge、fresh Club 到传统只读规划/精确复核的接线，以及 EA 均价和 FC27 FUT.GG 价格表。实际填阵、保存、提交未开放；当时 GM 真安装和卡面挂钩未验收，后来的 Preview .2 安装证据见上文。这是下表步骤 2/3 的历史进展，不代表步骤 4 已获授权。当前路线见 [FSU FC27 本地支持](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

后续实机 41/41 Club、两卡定向复核通过，39 张有 EA 均价；FUT.GG 直连探测为 403。已生成独立 `FSU-FC27-Preview.user.js`，版本 `26.09.6.27.1`，FSU 身份不变但关闭 Preview 自动更新，不修改冻结生产 FSU/Runner。上游检查只生成候选 artifact，新增每 6 小时 CI workflow 尚未推送或启用。

此后续批次完整 verify 为 225 文件/2,163 测试，FC27/browser gate 为 22 文件/185 测试，并通过两种视口 UI 检查和 `git diff --check`。Preview 82,454 bytes；正式版本和冻结输入未改变，未提交/推送，实机浏览器已正常关闭。

## 五步状态

| 步骤 | 当前状态 | 完成内容与剩余工作 |
| --- | --- | --- |
| 1. 原生只读采集 | 工具完成，实机部分通过 | 已取得 Set/Challenge、进行中 A Brace 的真实 brick、账号作用域；现已完成 41/41 Club 球员读取及两卡定向复核，其它 pile 和全部策略保护仍待验证 |
| 2. FSU 最小支持 | 真实安装及独立 GM 持久化通过，F2 未完成 | Preview 面板/桥和 fresh Club 实机通过；策略/锁卡业务 key 及整条规划仍待验收，不修改生产 FSU mod |
| 3. 传统 SBC 只读规划 | 核心与 Preview UI/真实读取接线完成，实机策略未验收 | 全员 OVR 上下限、人数、brick、唯一 definition、保护和跨账号拒绝均有测试；实际整条预览须待 GM 策略确认，未接入生产入口或写阵 |
| 4. 一次低价值真实提交 | 未执行，保留单独确认门禁 | 先完成真实 Challenge/奖励/库存身份、FSU 策略和定向校验；用户批准具体材料、次数和上限后才允许写操作 |
| 5. FC27 精简组合 | 隔离边界保持，业务接入待完成 | 新规划核心没有引入 FC26 Rolling、Swap、Provisions、交易或旧配置；现有 Preview 构建仍保持原白名单，不以离线模块存在宣称产品已完成 |

当前优先顺序为传统 SBC 只读、最小 FSU provider、传统单次事务、奖励对账。积分 SBC 等网页真实出现后单独适配，不再把积分 MVP 作为传统 SBC 的前置条件。APK 仍为用户另行确认的备用路线。

## 已取得的证据

专用 Chrome `152.0.7977.83`，扩展禁用，页面 `APP_YEAR_SHORT=27`。实际执行的操作包括打开官方 Web App、原生首页进入 SBC、打开 `Intro to SBCs` 的 Set 列表，以及对已经进行中的 Challenge 2 发起经源码核对的阵容 GET。登录由用户完成。没有初始化未开始的 Challenge，也没有填充、保存、提交、开包、移动、领取或交易。

- SBC Repository 当前返回 6 个 Set，不等于 6 个均已解锁或受支持。页面当时只展示可进入的 `Intro to SBCs`。
- Set 1 中 `A Brace` 为 Challenge 2，状态 `IN_PROGRESS`，`eligibilityOperation=AND`。
- 它的两条原始 eligibility 为 `kvPairs._collection[26]=[65]`、`[28]=[74]`，各 `count=2`、`scope=0`。当前 EA enum 分别映射 `PLAYER_MIN_OVR`、`PLAYER_MAX_OVR`。保留原始 scope，不能仅凭 key 名省略语义验证。
- Challenge 奖励观察为 `type=pack,value=200,count=1,tradable=false`；Set 奖励与 Challenge 奖励分开保存，不凭 UI 名称猜包 ID 或奖励已到账。
- 用户截图显示两处可用位置、九处封锁位置。列表页的 `challenge.squad` 仍未赋值；新增受限 GET 实际取得 `simpleBrickIndices=[0,1,4,5,6,7,8,9,10]`、`customBrickIndices=[]`、`FIELD_PLAYERS=11`，证实可用槽位为 2、3，需要两人。读取结果没有写回 Challenge 模型或打开阵容编辑器。
- 原生 Club 缓存观察到 29 个条目，其中只有 21 个球员，其余包含队徽、球衣等物品；先前样本里的 99 分属于非球员条目。它仍不是完整 Club。探针每 pile 最多输出 6 个通用匿名样本和 6 个球员样本，不导出完整卡库或以样本做真实选材。
- `rating`、`rareflag` 是 accessor，样本中 `_rating`、`_rareflag` 是 data。交易属性实际使用 `tradable`，不是凭空补出的 `tradeable/untradeable`。未知安全属性保持 `null`。
- `info` 和 `FSULocalRunnerBridge` 在禁用扩展的原生会话中缺失，属本轮分层条件，不是 FSU 兼容失败结论。
- 实机核对 `services.User.currentUserId -> repository._collection -> selectedPersona -> _personas._collection -> _sku -> clubs._collection`，User、Persona、SKU 身份匹配，Club 年份为 2027、平台为 PSN。探针只输出匹配布尔值、年份和平台，不输出账号/Persona ID。内部 provider 的作用域同时包含账号、Persona、平台、SKU 与赛季；不调用可能隐式选择 Persona 的 `getSelectedPersona()`。
- 枚举实际为 `ItemType.PLAYER="player"`、`ItemRarity.NONE=0/RARE=1`、`LimitedUseType.NONE=0`、`ItemPile.CLUB=7`，不能把 ItemType 强制当成数字。需求 scope 实际为 `GREATER=0/LOWER=1/EXACT=2`；OVR 的 min/max 决定单卡比较，scope 决定命中人数比较。
- 后续专用会话的缓存只有 16 个条目、8 个球员，但自有 EA 请求取得 41/41 Club 球员。先读服务器统计，再读球员页及明确空终页，再读统计，最后定向复核两张卡，共 5 次请求；连续两次检查通过。两张卡的 item ID、definition ID 和安全指纹均一致。41 张卡的评分、稀有度和 active-trade 判定可读；读取后缓存仍为 16/8，没有将 fresh 实体注入或删除 EA Club Repository。

脱敏回放见 `tests/fixtures/fc27-native-sbc-observation.json`；真实 GET 槽位另存 `fc27-in-progress-squad.json`。截图事实另存 `fc27-a-brace-ui.json`，不混入虚构的账号、卡片或运行时身份。

完整 Club 与定向读取的聚合证据另存 `tests/fixtures/fc27-fresh-club-observation.json`，没有真实卡 ID、账号信息或完整库存。41 是当时的 Club 球员数量，不包含其它 pile，也不是永久数量。

## 公共脚本核对

从真实页面的 `script[src]` 中白名单读取官方 `/web-app/js/*.js` 地址，剔除 query/hash，再无凭证下载公开静态资源。原文件只留在忽略的 `artifacts/fc27-browser/`，不将 EA 源码提交进仓库。

| 资源 | 本次 SHA256 |
| --- | --- |
| `compiled_2.js` | `8EF7D4415E8BD61B39114808866C831A3EC40301F1BCACF5E5FC170F6D0DC00F` |
| `compiled_4.js` | `69FAADEA7B91056D47DD2D6D9663AA3141572085BA562A5301C1B1E7F382CB13` |

当前静态实现的重要边界：

1. `UTSquadBuildingChallengeDAO.loadChallenge(id, true)` 读取 `/sbs/challenge/{id}/squad`；第二参为 false 时改走 POST 初始化挑战。不能直接调用 `services.SBC.loadChallenge()` 遍历所有挑战来声称只读。
2. `UTSquadEntity.getAllBrickIndices()` 合并 `simpleBrickIndices` 与 `customBrickIndices`；人数为 `FIELD_PLAYERS` 扣除全部 brick。后续 Adapter 必须验证两种 brick，不能只减 simple brick。
3. `UTItemEntity.isTradeable()` 读取 `tradable`；`isLimitedUse()` 使用 `limitedUseType`；academy enrolled 读取 `upgrades.enrolled`。这些是静态映射证据，不替代账号内的真实实体和提交前定向复核。
4. `rating` 与 `rareflag` getter 会考虑 `upgrades`。只有明确 `upgrades === null` 的实体才从 `_rating/_rareflag` 映射普通卡；有升级或升级信息未知时不把基础值伪装成最终值。`pile` getter 会把 Evolution pile 映射为 Club，因此新读取器保留 `utasPile` 证据，不把 Evolution pile 当普通 Club 候选。
5. FC27 `UTClubDAO.getClubItems()` 使用 POST `/club`，body 是 `type/start/count/defId` 等查询条件，不是账号写操作；DAO 返回值可能合并整个缓存。统计 GET `/club/stats/club` 原始响应使用 `stat[].type/typeValue`，球员查询使用 `itemData`。新只读适配器创建独立原生 `UTHttpRequest`，只接受该请求自身 Observable 的回调，不复用队列中其它调用者的请求或 DAO 缓存；凭证由 EA 自己设置，脚本不读取、记录或导出凭证。
6. `UTAuctionEntity.tradeState` 对应 `_tradeState`。普通 `free` 实体且明确 `inactive` 才映射 `activeTrade=false`，明确 `active` 映射 true；未知值仍保留 null。普通 Common/Rare 的 `rarity` 也进入安全指纹，不能仅比较 special 布尔值。

## 本轮实现边界

- `src/adapters/ea/fc27-sbc-read.js` 只允许同一账号/Persona/SKU 下的精确进行中 Challenge；核对当前 DAO 方法源码 SHA256 后，显式传 `true` 进入 GET 分支。方法变动、身份切换、状态变化、超时或未知 brick 均停止，不重试或回退到通用 load。允许的函数 SHA256 为 `04f9ea36c9d79e8ce1f0b0f5e27c10deffb576aafbde4b33e905b99751c3e87e`；它是当前诊断读取的版本约束，不是后续 Live 合同。
- `src/adapters/ea/fc27-local-read.js` 只读 own data descriptor，读取账号上下文和当前 Club 缓存；返回 `kind=cached-club-inspection,status=partial,complete=false`。锁卡、Active Squad 和显式 protected 状态未知时保留 `null`，active trade 仅按上述明确字段映射。传统规划器拒绝把这种缓存快照当作完整 normalized inventory。
- `FSU_mod/src/runner-support/native-provider.js` 将真实 EA 字段与受注入的同步 `GM_getValue` 接到独立 core，只读取当前作用域 key，不自动激活旧 build/set/lock_26。GM 必须来自 FSU userscript sandbox；专用原生浏览器没有用假 GM 伪装安装验证。
- 独立 FSU core 现为 10 个白名单模块，增加索引、native provider、只读 EA Adapter、分页校验器和共享 `player-rarity` 判定。它仍不进入 `26.09_mod` 或 FC26 Runner 生产入口，没有带入旧 Rolling/Swap/Provisions/交易逻辑。主 Preview 仍为原 4 模块、约 5.7 KB。
- 原生浏览器实际执行了这份新 core 的有界诊断投影：`contextMatched=true,cachedEntries=29,cachedPlayers=21`，21 个球员的基础评分/稀有度与普通 Club 属性可读；仍输出 `gmPolicyVerified=false,targetedValidationVerified=false,liveExecutionEnabled=false`。报告仅含计数，不包含实际 refs、fingerprint 或账号 ID。
- 新增 `fc27-club-read.js` 与 `runner-support/club-inventory.js`。原生方法必须匹配审查过的 SHA256；固定 endpoint/body、800ms 请求起始间隔、单请求 15 秒网络超时和 16 秒外层超时，不重试、不自动重新认证，HTTP 304/401/429/500 和未知载荷均停止。超时只取消自己的请求。没有全局 XHR hook、`hasAllItems` 覆盖、Repository 清空或旧缓存恢复。
- 全量扫描最多 20,000 名球员、每页最多 250，前后 Stats 必须一致，分页 item ID 唯一且总数相符。结果仍为 `kind=fresh-club-inspection,status=provisional`：分页不是原子快照，不能凭数量关闭提交前定向复核。定向最多 50 个 refs，精确匹配两个 ID 和安全指纹，缺卡/变化/账号切换后废弃本地快照，不静默换卡。真实 GM/保护策略未确认前不生成 normalized inventory；新 `readFreshClub()` 可独立完成只读冷启动，不需要伪造已批准策略。

## 自动检查方式

Agent 首选 `node scripts/browser-inspection/run.mjs --agent`。它复用专用 profile，通过 Playwright pipe 控制自有浏览器，不接管日常 Chrome，不开放调试端口。Agent 通过当前工具会话发送受限的 `inspect`、`provider`、`club`、`sbc`、`set <id>`、`squad <set-id> <challenge-id>`、`q` 命令；没有任意 JavaScript 或账号写操作命令。

- 默认禁用扩展建立原生基线；只有显式 `--with-extensions` 才允许已有扩展加载，此时不自动导航，避免未知插件把导航改成写操作。
- `inspect` 自动保存本地 JSON，Agent 直接读取，不要求用户复制控制台或导出 HAR。诊断 helper 可以在同一登录会话中更新；结束时 Agent 发送 `q` 关闭自有浏览器。
- 自动导航仅允许已经确认的原生 Home -> SBC，以及通过实时 Set ID/名称唯一匹配的原生 tile；未知首页、弹窗、多标签、名称歧义均停止导航。不会自动打开未开始的 Challenge。
- `squad` 在原生 Challenge 列表执行上述有界 GET；`provider` 只执行仓库白名单构建的本地读取代码，并只返回聚合诊断。扩展开启时两项均禁用。最多保留 10 次带时间戳的阵容读取摘要；后续 `inspect` 不覆盖这些记录，历史记录不作为当前执行授权。
- `club` 显式执行 fresh Club 扫描，再选至多两张刚取得的卡做定向复核；只返回计数/已知字段数量，不返回卡片。扩展开启、登录/遮罩/页面状态未确认时禁止执行；最多保留 10 次独立 `clubReads` 摘要。`provider` 仍为零网络的被动缓存检查。
- 无人值守短时采集使用 `--auto --duration-seconds 120`，窗口限制 1 至 600 秒，每 3 秒采集，最多保留 20 个变化样本；默认可做一次已确认的原生首页到 SBC 导航，结束后关闭。
- 原 `--interactive` 保留人工调试用途，不作为要求用户反复操作的正常流程。
- 报告位于忽略的 `artifacts/fc27-browser/agent-*.json` 或 `inspection-*.json`。本地报告不上传；不导出 cookies、token、请求头、账号 ID、完整库存或整个 DOM。
- 网络部分仍只是最多 200 个响应/失败事件的摘要，不是完整 HAR，也不能证明 readiness。公开静态脚本 URL 与认证/API URL 分开处理，仅前者可以进入报告。

## 下一步与人工边界

2026-09-17 已新增专用扩展安装工具 `scripts/browser-inspection/fsu-setup.mjs`；按用户指定支持 `--proxy http://127.0.0.1:1080`，亦支持 SOCKS5，并绕过 localhost。初次 TLS 握手失败后用户恢复了代理，本日后续真实安装和独立 GM 自检已通过，详情见本页最新记录。代理只作用于自有浏览器，不改变系统设置；没有修改保护策略或 EA 阵容。

Agent 下一步负责：重开专用浏览器、核对实际 FSU 安装版本，沿原价格和填阵函数只读复现问题；不要求先完成历史 Preview 的新增策略/锁卡界面。价格请求成功与卡面显示、Challenge 规则与原配阵候选均需独立证据。之后核实 Controller 和保存行为，真实填阵仍需单独批准。已有原生账号作用域、进行中 Challenge、fresh Club 与两卡定向回读证据不需要用户重新收集 HAR。未开始 Challenge 的初始化仍必须单独声明为写操作。

用户只需在专用浏览器要求时完成登录/验证码；首次真实消耗前确认具体目标、卡片上限和次数。如果浏览器策略确实要求人工批准扩展安装，再提出该单项操作。不得让用户承担运行命令、复制报告、枚举字段、截图插件版本或收集 HAR 等 Agent 能完成的工作。

现阶段不能把“允许继续 1-5”扩展成任意材料消耗授权；也不能为了凑齐测试阵容，临时绕过 FSU 或 Evolution、特殊卡、Only Untradeable 等保护。所有规划输出仍为 `liveExecutionEnabled=false`。

## 2026-09-17 历史验证与发布边界

以下是 fresh Club 研究批次的历史记录：当时不升版本、不提交或推送、不解除正式发布阻断。应用为 `0.8.65`，FC27 首个正式版本规划为 `27.0.0`；当时 FSU Local `26.09.6` 及 immutable origin 未改。当前阶段提交及 Local `26.09.7` 状态以上文为准。

前一轮完整验证通过 217 个测试文件、2,106 项测试。本轮新增覆盖请求归属、实现指纹改变、超时/限速、304/401/429/500、完整/空/多页库存、数量漂移、重复 ID、同版本不同副本、逐卡属性变化、账号切换与扩展隔离。最新验证结果在本节收尾记录，不以 Node 测试替代真实页面验证。

本轮最终 `npm run verify` 通过 219 个文件、2,141 项测试，syntax/undef/config/profiles/architecture/FSU patch replay/build/dist/FSU release 检查均通过。`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 16 个文件、163 项测试及真实 Chrome 离线 smoke；`git diff --check` 通过。新 core 约 50 KB，主 Preview 仍为 5,665 bytes；生产脚本、package 版本和 FSU 发布产物无差异。验证日志保存在忽略的 `artifacts/fc27-browser/verify-fresh-club.log` 与 `verify-fc27-fresh-club.log`。

实机报告为本地忽略文件 `artifacts/fc27-browser/agent-2026-09-17T13-32-09.872Z.json`（阵容 GET/缓存）和 `agent-2026-09-17T14-11-42.982Z.json`（fresh Club/定向回读），不含完整卡库或账号身份。专用实机浏览器已由 Agent 发送 `q` 正常关闭，未影响日常浏览器。Node 测试与原生页面读取都不替代 Live 事务验收。
