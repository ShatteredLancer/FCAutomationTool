# FC27 本地 FSU 支持与上游同步

2026-09-18 一键填阵导入弹窗修复：FC27 EA `EADialogViewController` 不再读取旧 `dialogOptions`，导致 FSU 导入方案弹窗缺少确认/取消按钮。`26.09.9` 在共用 `events.popup` 同时传递 `continueOption`/`cancelOption` 与旧字段，并兼容额外 FSU 动作按钮；输入、空值默认方案、选材与提交路径未改。Node 回归覆盖 FC27 两按钮、三按钮、Escape 和 FC26 旧视图，仍需登录后的真实页面确认按钮可见性。

2026-09-18 启动竞态修复：实际安装原 `26.09.8`，新增 Home 专用有界 readiness 等待，修复 Controller 迟到时的一次性漏触发。自然冷启动及连续两次刷新均未手动 init、无启动警告/page error，并进入 `initialized` 与 `trusted-provisional`；设置保留、2/2 fresh 定向复核通过。FutNext 报价赛季归属和卡面显示仍未验收，见 [修复证据](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-自然重启与初始化竞态定位)。

2026-09-18 抽样续验：原 `26.09.6` 定向查询实机通过两张卡的精确身份和安全属性复核，仍为 provisional，不代表整个 Club ready。只修了诊断工具对原 FSU 延迟初始化 capture 集合的误判，没有改 mod。价格仅被动检查：当前 FutNext provider，运行函数仍含 FUT.GG 26 分支，未发价格请求；`26.09.7` 安装和真实价格显示仍 Pending。充足库存下 11 人规划及后续重规划仅离线通过，不要求用户补卡。见 [本轮证据与边界](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-缺卡期间的原-fsu-抽样验证)。以下各批记录保留当时状态。

2026-09-18 金卡续验：获批的 83 分只读检查保留原 FSU 上限交集和联赛保护，Gold Upgrade 安全缓存候选为 5/11，正常停止。此批没有修改 FSU 源、patch、资产或 GM 设置，没有调用原 FSU 填阵/定向校验；不将缓存不足当作完整库存不足。见 [最新记录](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-获批-83-分金卡只读预览)。

2026-09-18 登录后续验：原 FSU `26.09.6` 的上下文、设置和 provisional Club 可读；Runner 已用原缓存完成铜/银升级只读选材检查，分别 5/11、7/11，按保护策略正常停止。没有修改 FSU 或其 GM 设置，没有调用填阵/保存/提交，正向完整配阵和精确复核仍待验收。见 [实机续验记录](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-登录后原-fsu--runner-只读续验)，下文未登录状态为前一批历史记录。

更新：2026-09-18。用户明确：现有 `26.09.6` 在 FC27 大部分功能可用，只在原有功能上查漏补缺。当前路线改为既有 mod 的最小兼容补丁，优先 **原版一键填阵、价格显示**；市场工具和 Evo 延后。独立 Preview 停止功能扩展，不再默认安装或作为产品前置条件，以下相关记录仅为历史研究结果。

2026-09-18 Runner 续验：旧冻结误阻断已修正为“FC26 Runner/FSU origin 严格冻结 + 同上游 Local 修订维护”，仍验证 metadata/config/hash 与 patch replay；专项门禁已恢复通过。Tampermonkey 管理页本次明确显示实际安装 `26.09.6`，不是本地产物 `26.09.7`。页面停在登录页，Runner 原 FSU 输入检查返回 `FC27_CONTEXT_UNAVAILABLE`，没有账号写操作。当前验收表和完整结果见 [Runner 发布准备续验](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-runner-发布准备续验)。

## 原版增量路线

- 专用浏览器曾从 Preview .2 切回既有 Local FSU 路线，历史维护基线为 `26.09.6`；同一 FSU 身份和 GM 存储保留，不清空 build/set/lock。维护源的 manifest 校验不等于浏览器已安装该版本。
- FC27 实机观察：`info/events` 存在、`initialized=true`、`clubReady=true`、`clubCacheStatus=ready`，原价格/填阵函数和开关存在。没有触发填阵、保存、提交、开包或交易。证据为 `tests/fixtures/fc27-fsu-local-baseline-observation.json`；该记录曾把本地产物版本 `26.09.7` 当成已安装版本，现改为未知并保留来源说明。它只证明观察时原版运行时 ready，不能证明 `26.09.7` 已安装或功能完整验收。
- 先在原调用链复现失败，再补最小测试并修改对应函数；保留原设置/UI/选材/缓存，不新建第二套策略或库存服务。价格查询和登录探测已改为读取当前 EA 赛季；未知赛季不请求 FUT.GG，避免把 FC26 价格当成 FC27 价格。`api.fut.to/26`、`lock_26` 等其它旧季路径仍未改动，待各自有实机证据后再处理。
- Runner 必需合同尽量通过既有 `info/events` 和窄 Adapter 映射，缺能力时再添加最小接口。上游更新后重放小补丁并做行为回归，不合并两套 FSU 实现。
- 先前批准的 Preview 默认 74 分策略未保存，独立配阵未执行；不把该批准扩大为修改原 FSU 设置或写 EA 阵容的授权。

当前不可变 origin 仍为 `26.09`，本地 mod 已递增为 `26.09.9`，并已重新生成 manifest、patch 和 `dist/FSU-Local` 资产；其它生产功能未改动。FC26 冻结检查已按本地维护路线调整并增加启动回归：origin 逐字节不变，同上游 Local 版本不可降级，未升版时仍冻结实现，已升版时 metadata/config 仍受限制，patch replay 必须通过。不可变 origin 和历史 FC26 归档继续保留，正式发布门禁没有解除。

价格季节回归、patch replay 和资产已完成本地验证，完整结果见下方“当前增量修复”。原版实机尚未在登录后的真实 Challenge 中验证卡面价格请求或一键填阵写入，未执行填阵、保存、提交、开包、移动或交易。原版 FutNext fallback 没有改动，不能把 FUT.GG 的赛季绑定修复描述为所有价格来源都已完成赛季校验。

## 历史 Preview 状态

| 功能 | 已完成 | 尚未完成 |
| --- | --- | --- |
| 独立启动 | 真正 Tampermonkey 5.5.0 安装及 FC27 面板/只读桥加载通过；不执行 FC26 `futweb()` | 旧安装保留/升级矩阵与正式渠道验收 |
| 设置与锁卡 | 账号/Persona/SKU/赛季隔离；策略确认、精确 item 锁定/解锁；独立 GM 自检键写后回读和刷新持久化实机通过 | 真实策略/锁卡业务 key 的确认及保留验收；旧 `lock_26` 不导入 |
| Club | 自有只读请求，完整分页/前后统计；桥可从冷启动刷新；两卡定向复核再次实机通过 | Storage/Unassigned/Transfer 和 Active Squad 保护读取；不是全 pile readiness |
| 一键填阵 | 真实 Challenge 结构解析、保护策略、fresh Club、规划、精确复核接线，提供 `Preview squad` | **没有实际写阵/保存/提交**；仅支持已进行中、全员 OVR min/max 条件，不支持化学/联赛组合/积分等未知条件 |
| 价格 | 真实 Preview 库存首屏 25 张 EA 均价显示通过；FUT.GG 27 真实 GM 请求返回 403 时保留 EA 均价 | 卡面挂钩和 FUT.GG 成功报价验收；403 不能当作第三方价格已恢复 |
| 上游同步 | 本地检查工具、候选下载/身份与 hash 检查、旧补丁试套、独立 CI 检查 workflow | workflow 尚未推送/启用；当前网络未成功取得最新上游，不能声称已确认最新版本或已自动同步 |

价格不是可执行交易报价。EA 均价、FUT.GG 报价来源分开；没有价格显示 `N/A`，不使用 FC26 价格或赛季不明确的 FUTNext fallback。只有用户或已授权的检查工具显式点击 `Load prices` 才发送第三方请求，最多当前页 25 个公开 definition ID，不发送账号、item ID、认证信息或完整库存；403/429/异常后冷却 30 分钟，不自动买卡。

保护策略默认 Maximum OVR 74、Only untradeable、Exclude Evolution，Lock 与 Active Squad 开关仍默认关闭。开启 Active Squad 保护而未取得真实成员证据时返回 `FSU_ACTIVE_SQUAD_UNVERIFIED`，不把它误称为库存缺卡。Storage first 作为策略保留，但当前 Preview **只读取 Club**，不宣称已使用 Storage。特殊卡、Evolution、cosmetic、loan、limited-use、concept、academy、active trade 及未知安全字段仍禁止用于预览。

## 历史 Preview 构建与安装边界

```powershell
node scripts/build-fc27-fsu-preview.mjs
node scripts/verify-fc27-prelaunch.mjs --browser
```

输出：`dist/fc27-preview/FSU-FC27-Preview.user.js` 与 `fsu-preview-manifest.json`。历史原型版本为 `26.09.6.27.2`，由冻结 Local 基线 `26.09.6` 加 Preview revision 生成，只是开发安装版本，不是 FSU 上游版本，也不是 Runner 的 `27.0.0`。以下是当时的原型边界，不是当前默认部署方案。

- `@name` 和 `@namespace` 保持原 FSU 身份，因此在同一管理器中替换现有 FSU，而不是安装一个独立 GM 存储副本。原 `build/set/lock_26` 保留但不自动激活。
- Preview 的 `@updateURL`、`@downloadURL` 为 `none`，不冒充稳定渠道，不被旧 latest 资产覆盖。正式发布前必须独立批准渠道和安装验收。
- 只匹配 EA Web App，只有 `www.fut.gg` 的跨域权限；无 lodash `@require`、旧 26 远端配置、市场/Evo/提交 wrapper。
- 不与旧 FSU、旧 Runner 或未知自动化同时运行。发现旧 `info/events`、重复 UI 或已被其它实例持有的 bridge 时拒绝初始化。
- 当时未修改 origin、`26.09_mod`、原 patch/manifest 和正式 `FSU-Local.user.js`；此后 Local `26.09.7` 已修改维护源并重建 patch/资产，immutable origin 仍未改动。安装 Preview 不等于维护版 FSU 已完成升版验收。
- Agent 可自动完成构建、界面和只读检查；需要人工时只要求登录/验证码、浏览器扩展安装确认、真实保护策略确认。不能把离线模拟 GM 当成真实 Tampermonkey 验收。

## 安装与上游检查

### 专用浏览器安装

```powershell
node scripts/browser-inspection/fsu-setup.mjs --proxy http://127.0.0.1:1080
# 若本地代理只提供 SOCKS5：
node scripts/browser-inspection/fsu-setup.mjs --proxy socks5://127.0.0.1:1080
```

安装工具现在默认读取原 `fsu-mod.config.json` 指定的维护源，核对 manifest hash 后只提供 `/FSU-Local.user.js`；仅显式 `--preview` 才构建历史 Preview。复用专用 profile 和 loopback 代理，不更改系统/日常浏览器。`install` 打开对应地址，`confirm-install` 核对官方扩展页、本地来源、FSU 身份和精确版本；从 Preview 还原原版时允许该确切脚本的降级按钮，不操作其它脚本。`baseline` 只输出原 FSU 初始化、Club 状态和功能存在性，不导出账号或卡片；`runtime` 读取脱敏 EA/UI 证据，`runner` 读取原 FSU 的 Runner 接入前提并始终保持 Live 关闭；`runner-support` 被动检查原校验/价格接口，`runner-validate` 只调用原 FSU 最多两卡的有界定向查询，不推广全量 ready；`extension-status` 只读 Chrome 用户脚本权限。历史 `inspect/panel/club/prices` 仅适用 Preview。没有任意 JS、策略保存、锁卡或账号写操作命令，`q` 关闭自有浏览器及服务。

2026-09-17 初次网络检查失败；用户恢复代理后，HTTP `127.0.0.1:1080` 成功打开官方商店。用户完成 Tampermonkey 5.5.0、Preview .2 安装和 Chrome 的“允许用户脚本”。后续 Agent 确认真实 GM 写后回读，刷新后 `previousLoad=true`，面板/桥存在且 season=27。安装自检只使用 `fsu_fc27_preview_installation_v1`，保存固定大小的 schema/版本/随机启动标记；不保存账号信息，不碰策略/锁卡/旧 build/set，也不改变 readiness。未确认策略时仍为 not-ready，不因安装通过而授权选材或提交。

本安装工具批次验证：`npm run verify` 通过 225 文件、2,174 项测试；FC27/browser gate 通过 22 文件、196 项测试及离线 Chrome UI smoke；`git diff --check` 通过。新增 11 项代理参数测试，覆盖默认直连、HTTP/SOCKS5、localhost bypass 和拒绝非法参数/远程代理/凭证。没有修改 Preview 内容或提升版本，未提交/推送；这些测试不代替商店连通性与真实 GM 验收。

### 获取与审查上游

```powershell
# 联网获取配置中登记的官方上游地址，20 秒截止、5 MiB 上限
node scripts/fsu-upstream.mjs

# 已取得官方文件时，离线检查；不会执行该脚本
node scripts/fsu-upstream.mjs --candidate C:\Path\FSU-upstream.user.js
```

工具仅写入忽略目录 `artifacts/fsu-upstream/<version>-<hash>/`，包含 `candidate.user.js`、`report.json`。校验脚本身份、MIT、唯一版本字段、SHA256；版本不变但内容变化也报告。下载只接受已列入白名单的 HTTPS 上游域名，不携带凭证、不接受任意跨域重定向。`git apply --check` 在独立临时目录试套，不改 origin/mod，不执行候选脚本，不自动合并。

`.github/workflows/fsu-upstream.yml` 在推送后支持手动触发和每 6 小时检查；只授予 `contents: read`，保存 14 天审查 artifact，不创建 PR、提交、tag 或 Release。GitHub 定时执行可能延迟或被平台停用，不能保证零延迟。此前本机直连 Greasy Fork 超时、代理 TLS 握手失败，尚无最新上游版本证据；本次代理恢复已验证 Chrome 商店，不等于已重新取得 Greasy Fork 上游。已验证用 immutable origin 作候选可以成功试套旧补丁。

取得上游 FC27 后：

1. 检查来源、许可和 hash，将新版本另存为新的 immutable origin，保留 26.09 origin。
2. 对比上游已修复功能与本地模块。旧 patch 文本试套成功只代表上下文可匹配，不代表 FC27 行为兼容。
3. 先保留独立 Runner bridge；上游已实现同功能时逐项替换并删除过渡实现，不再向旧单文件叠加整套补丁。
4. 复核 GM 身份、账号作用域、保护规则、Club 精确校验，以及一键填阵的真实 Controller/保存行为；上游全功能启动不能覆盖本地 bridge 或重新启用未知自动提交。
5. 运行完整 verify、FC27/browser gate、真实 GM/页面矩阵，递增独立 localVersion 并重新生成可重放 patch/manifest/发布资产；未完成安装和渠道验收前不发布。

## 历史只读证据

- 真实安装聚合 fixture：`tests/fixtures/fc27-fsu-installation-observation.json`。Tampermonkey 5.5.0 / Preview .2，独立 GM 键跨刷新保留；通过面板读取 41 名球员，首屏 25/25 有 EA 均价，FUT.GG GM 请求为 `PRICE_HTTP_403`。没有保存策略/锁卡，没有填阵、保存、提交、开包、移动或交易；不包含账号和卡片身份。

- 实机报告：`artifacts/fc27-browser/agent-2026-09-17T14-56-04.221Z.json`，原生 Chrome、扩展禁用；41/41 Club 球员，5 次只读请求，两卡 item/definition/safety fingerprint 一致；39 张有 EA 市场均价、2 张缺价。
- `UTItemEntity.getMarketAverage()` 与公开 FC27 源码一致，只返回 `_marketAverage`。均价仅用于展示，不进入安全指纹或交易计划。
- 脱敏 fixture：`tests/fixtures/fc27-fsu-price-observation.json`。没有账号 ID、真实 item ID 或完整卡库。
- 真实会话中 Set tile 点击只得到请求发出，没有确认进入 Challenge 列表；没有据此初始化或打开未知挑战。新增诊断保留原生 tile 的按钮摘要，不以点击成功冒充页面成功。
- 离线 Chrome 验证策略确认、锁定、缺价、预览和桌面/移动布局；截图为 `fsu-panel-1280.png`、`fsu-panel-390.png`，均在忽略的 artifacts 目录。这些不替代真实 GM 安装或卡面增强验收。

## 2026-09-18 当前增量修复

- 本地 FSU 从 `26.09.6` 升至 `26.09.7`，只修复价格接口的赛季绑定：FUT.GG 查询和登录探测按 EA 当前赛季生成路径；赛季未知时停用该请求，不回退到 `/26/`。一键填阵、库存、保护和提交逻辑未改。
- 已重新生成 patch、manifest、`FSU-Local.user.js` 和 `.meta.js`；patch 从 immutable origin 回放后的 SHA256 为 `4924EBD4EFD364FBC34607B147A3D50727DA5D7F8E684003064AAE1D044A7995`。
- 阶段提交前重新执行 `npm run verify`：228 个测试文件、2187 项测试通过；485 个 JavaScript 文件语法检查、undef、配置、架构、FSU patch replay、构建、dist 和 FSU Local release 检查均通过。新增测试先复现了安装记录误把本地产物版本当成实机版本的问题，再修正 fixture 与本地安装包版本断言。
- 单独执行三项隔离构建、`FSU_mod/src` lint、`node node_modules/vitest/vitest.mjs run fc27 fsu-upstream`（24 文件、207 项）和 `node scripts/browser-inspection/run.mjs --self-test` 均通过。离线 Chrome 覆盖桌面/移动 Preview，不访问 EA；这不代表预发布总检查通过。重新构建的历史 Preview 版本随 Local 基线生成 `26.09.7.27.2`，没有安装到真实浏览器；原 `.6.27.2` 实机记录只属于历史原型。
- 最近一次专用浏览器检查停在未登录状态，随后浏览器和服务已关闭；尚未独立确认浏览器实际安装版本，不能声称 `26.09.7` 实机通过。继续时先重开专用浏览器并核对安装版本，再进行登录后的价格和配阵只读检查；真实填阵/保存/提交仍需单独授权。
- 阶段提交时专项命令曾在首个冻结检查失败：`FC26 frozen input changed: FSU_mod/fsu-mod.config.json`。后续 Runner 续验已明确拆分归档与 Local 维护边界并补 15 项回归，专项命令恢复通过；没有删除 origin、Runner 冻结或 patch replay 检查。远程 CI 尚未在本轮改动上运行，不把本地通过描述为已推送或已发布。

## 历史 Preview 验证与当前接续

2026-09-17 原型批次验证：`npm run verify` 通过 227 个文件、2,183 项测试；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过 24 个文件、205 项测试及离线 Chrome UI smoke；`git diff --check` 通过。Preview .2 为 85,068 bytes、19 个白名单模块，manifest 包含 SHA256。新增安装身份、独立 GM 键、跨启动持久化、坏记录不覆盖、GM 异常不影响 readiness 和受限安装工具测试。当时生产 Runner 为 `0.8.65`、FSU Local 为 `26.09.6`，patch replay 和 FC26 冻结输入校验通过；这些是历史结果，不代表当前 `26.09.7` 的专项门禁或实机结果。

历史 Preview 的安装/GM 证据保留，但不再沿它扩展功能。下一步直接复现原版价格/填阵的具体失效点，核对原选材保护与真实 Controller 行为，修复原函数并通过对应回归和实机检查。第一次真实保存仍单独列明目标/材料，提交、开包和交易不在当前授权内。
