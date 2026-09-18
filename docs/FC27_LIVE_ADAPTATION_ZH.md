# FC27 上线后适配记录

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
