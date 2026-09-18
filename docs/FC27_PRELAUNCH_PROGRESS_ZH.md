# FC27 上线前实施记录

2026-09-18 发布范围更新：用户确认 `27.0.0` 只读首版，允许发布精确验收产物，Live 和真实业务门禁不变。最新状态及发布结果见 [发布记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-只读首版发布授权)；以下各批次未发布/阻断记录仅代表当时状态。

2026-09-18 正式入口已切换：当前本地 `27.0.0` 采用全新 `FC Automation Tool` 安装身份，精简产物及实际 Tampermonkey 安装/受控更新通过。真实业务按用户要求等库存充足再验收，Live 和正式发布继续阻断；下文是上线前历史记录，当前状态见 [最新验收](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-正式入口与发布资产准备)。

2026-09-18 最新：原 FSU `26.09.8` 已修复 Controller 迟到漏初始化；自然冷启动及两次刷新成功，两卡 fresh 复核与原 FutNext 两条报价通过，报价赛季/显示仍待验收。无手动 init、无账号写操作，详见 [本批记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-自然重启与初始化竞态定位)。Runner 面板此前 Gold 5/11 缺料与布局通过；下表 4 模块为上线前历史，当前隔离 Preview 为 14 个只读模块，不含旧 Rolling/Trade。

2026-09-18 缺卡期间续验：原 FSU 两卡 fresh 精确身份/安全属性检查实机通过；11 人正向规划、两阵不重复用卡与库存补充后重规划仅合成库存离线通过。未改 FSU 或消耗材料，整个 Club 仍为 provisional；价格显示、真实事务及发布仍 Pending。见 [最新结果](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-缺卡期间的原-fsu-抽样验证)。

2026-09-18 登录后续验：铜/银 74 分及获批金卡 83 分只读预览均已执行，分别有 5/7/5 张安全缓存候选，11 人阵均按策略正常停止。原 FSU 未改，缓存不等于全量库存；完整配阵、精确复核和 Live/发布仍待验收，见 [当前实机记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-获批-83-分金卡只读预览)。

2026-09-18 Runner 发布准备续验：旧 FSU 冻结误阻断已修正，保留 FC26 Runner 和上游原版严格检查，并对 Local 维护版执行升版/身份/权限/配置与 patch replay 验证。完整验证 230 文件、2213 项测试通过，专项 26 文件、233 项及 browser smoke 通过。原 FSU Runner 输入只读检查已接入专用浏览器；实际安装 `26.09.6` 已确认，登录后的库存/配阵与全部 Live 仍待验收，见 [当前发布准备表](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-runner-发布准备续验)。以下阶段提交时的冻结失败保留为历史记录。

2026-09-18 历史批次 FSU `26.09.7`：沿既有 mod 完成最小价格兼容修复。随后本地版本已升至 `26.09.8` 并修复 Home Controller 延迟初始化。FUT.GG 价格查询和登录探测不再写死 `/26/`，统一按当前 EA 赛季生成路径，未知赛季直接停用该请求；12 项 FSU 回归通过，patch/manifest/Release 资产已重建。未改变一键填阵和任何库存/提交语义，真实 FC27 登录后价格与一键填阵验证仍待完成。

2026-09-18 FSU 实施方向以 [原版增量路线](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md) 为准：历史维护基线为 `26.09.6`，原版运行时在 FC27 初始化与 Club ready 通过，但实际安装版本未独立确认；不能用当前本地产物版本替代。原设置/界面/功能作为维护基线，独立 Preview 不再扩展或默认安装。以下独立核心实施状态保留历史参考，不是必须继续完成的路线。

2026-09-17 最新上线后增量：独立 FSU Preview .2 在真实 Tampermonkey 的安装、GM 自检键跨刷新保留、面板/桥、41 人 Club 与首屏 EA 均价均已通过。策略/锁卡业务持久化、只读配阵和实际写操作仍未验收；以 [上线后适配记录](FC27_LIVE_ADAPTATION_ZH.md) 的最新记录为准，下文历史状态不自动关闭这些门禁。

2026-09-17 上线后已开始执行只读适配，当前五步状态与真实证据见 [上线后适配记录](FC27_LIVE_ADAPTATION_ZH.md)。原生 SBC 列表、`A Brace` 真实槽位、账号作用域已读取；独立 native provider 现已实机读取 41/41 fresh Club 球员，并通过两卡定向复核。真实 GM/完整保护策略、库存到规划器的接线和 Live 提交仍未通过。以下上线前历史 Complete 不代表这些上线后门禁完成。

2026-09-15 收尾状态以 [收尾与开服接续](FC27_PRELAUNCH_CLOSEOUT_ZH.md) 为准：仓库和目录已改名；FC27 为全新安装，旧版导出桥不再是首发前置任务；下文原准备阶段的未改名描述仅为历史记录。发布新增显式阻断，不能把改名后的同版本资产直接发布。

范围：用户已确认先实施 P0、P1、FSU F0、浏览器 B0。每项通过对应测试后才标记 Complete；离线准备完成不等于真实 FC27 兼容。

| 步骤 | 状态 | 已交付与证据 | 剩余边界 |
| --- | --- | --- | --- |
| P0 基线冻结 | Complete | 本地 `archive/fc26-0.8.64` tag、`maintenance/fc26` 分支，均指向 `43f64c2da9ddb5210034c7afe16a77ddc25231b0`；基线检查和完整回归通过 | 仅本地归档，未 push |
| P1 独立入口与上下文 | Complete | Preview 仅 4 个模块；赛季/账号/平台/schema 隔离，所有路径禁止 Live；14 项相关测试通过 | 无真实 EA 账号发现；无 SBC 业务实现 |
| P1 配置迁移与发布隔离 | Complete（离线） | 白名单导入、保护待确认、并发阻断、幂等和单值 last-known-good 存储；发布通道单测；独立只读 Preview CI | 真实旧安装导出/导入界面和 GM 验收属于 P5；GitHub workflow 未实际触发 |
| FSU F0 最小核心 | Complete（离线） | 独立构建、旧设置只读 review、新季锁卡 key、能力桥、精确 refs/fingerprint 校验、有界读等待与并发隔离、幂等挂载/卸载；9 项测试通过 | provider 仅 fake 验证；尚未接入实际 EA/GM、旧 mod 启动或生产 FSU 发布包 |
| 浏览器 B0 | Complete（工具准备） | 专用持久浏览器进程、固定字段采集、无请求体/凭证的网络计数；Chrome 151.0.7922.76 离线 smoke 通过 | 未登录 EA；未在真实 Tampermonkey/FSU 组合验证扩展加载；B1-B6 待上线 |

## 基线与版本

现有 `package.json` 仍是应用版本唯一来源，本批准备工作升为维护版本 `0.8.65`，历史归档保持 `0.8.64`。Preview 使用相同构建版本，明确命名为 Preview，目标赛季另记为 27；这不是 `27.0.0` 首发，也不伪造 FSU 27 上游版本。本段最初记录的是改名前准备边界；其后仓库、文件、Runner namespace 和更新地址已经变更，但没有发布。当前安装身份偏差与发布阻断以[收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)为准。

FC26 历史使用 Git 引用保留，不在主目录复制一整套源码。基线检查：`node scripts/check-fc26-baseline.mjs`。新工作区可按记录的 commit 恢复归档引用，不依赖未推送的本地 tag 才能验证产物。

## 验证记录

### 2026-09-18 FSU 最小增量修复

沿既有 `26.09.6` mod 升至 `26.09.7`，仅修复 FUT.GG 价格查询和登录探测的赛季路径绑定；未知赛季不请求旧季 FUT.GG 地址，原 FutNext fallback 不变。一键填阵、库存、保护和提交语义未改变。已重建 patch、manifest 与 FSU Local 资产；阶段提交前 `npm run verify` 通过 228 个测试文件、2187 项测试。独立 FC27/上游测试通过 24 文件、207 项，三项隔离构建、FSU core lint 和 Chrome 离线 smoke 均通过。

`node scripts/verify-fc27-prelaunch.mjs --browser` 本次在旧冻结检查失败，原因是 FSU 工作配置已经升为 `26.09.7`，而检查仍要求 `26.09.6` 原样冻结；后续需显式调整维护边界并补回归，当前未放宽检查，推送后的 FC27 offline CI 也会被阻断。最近专用浏览器检查未登录，随后已关闭；安装版本、FC27 价格显示和一键填阵仍待真实验证。本次仅提交阶段成果，不推送、不创建发布 tag；以下专项门禁成功记录仅属于各历史批次。

- 2026-09-14：`fc27-prelaunch-contract` 与 `fc27-preview`，2 个文件、14 项测试通过。已先观察到 8 项失败，覆盖初稿的身份宽松、假 readiness 与不安全采集问题，再修实现。
- 2026-09-14：专门验证扩展到 6 个测试文件、45 项测试，全部通过；FSU core 和 Preview 均有依赖白名单与无 EA 环境执行测试；增加跨 tag 全局串行发布约束，避免旧任务较晚发布覆盖 latest。
- 初次实现 `npm run verify` 通过：208 个文件、2,019 项测试，syntax/undef/config/profiles/architecture/FSU patch replay/build/dist/FSU release 全通过。本机 Node `24.16.0`，CI 配置仍使用 Node 22。
- `node scripts/verify-fc27-prelaunch.mjs --browser`：通过。Chrome `151.0.7922.76`，仅 `about:blank` 本地合成页面，网络路由禁用；未访问 EA。报告位于被 Git 忽略的 `artifacts/fc27-browser/self-test.json`。
- FC26 冻结脚本 Git blob SHA256：`3a2ac4b4f38947431dd7c16cb2414b919636bb604cf7645933c837b7404fdca1`，2,974,229 bytes（Git LF 口径）。工作区 CRLF 大小可能不同；基线检查仅归一化换行，并允许 metadata 与 package 构建版本两行同步更新为当前 `0.8.x` 维护版本，其余内容仍严格比较。新增 4 项测试覆盖精确版本投影、非版本内容保持、异常字段和跨主版本拒绝。
- GitHub CLI 本机未安装，未执行 Release 或远程 CI；通道算法已单测，workflow 真正运行仍须在发布验收中确认。
- `git diff --check` 与文档本地链接检查通过。Release 使用全局 concurrency；GitHub 可能替换排队中的 pending run，未发布的 tag 需手动重新触发，不会通过覆盖已有 Release 补发。

## 实施文件与使用方式

| 边界 | 文件 |
| --- | --- |
| Preview entry、上下文与只读门禁 | [entry](../src/fc27/userscript-entry.js)、[contract](../src/fc27/prelaunch-contract.js)、[runtime](../src/fc27/runtime.js)、[浏览器 Adapter](../src/adapters/browser/fc27-inspection.js) |
| 偏好迁移 | [preferences](../src/fc27/preferences.js)：仅接收 `fcat-preferences` schema 1，不把旧 Runner 的任意 JSON 当等价配置 |
| FSU core | [core](../FSU_mod/src/runner-support/core.js)：通过注入的 `readContext`、同步 `storage.get` 和 `inventory` provider 工作，复用既有锁卡/设置解析；不直接依赖旧 `futweb()` |
| 构建与门禁 | [Preview build](../scripts/build-fc27-preview.mjs)、[FSU core build](../scripts/build-fc27-fsu-core.mjs)、[基线检查](../scripts/check-fc26-baseline.mjs)、[预发布验证](../scripts/verify-fc27-prelaunch.mjs)、[Release policy](../scripts/release-channel.mjs) |
| CI | [Preview workflow](../.github/workflows/fc27-preview.yml)、[Release workflow](../.github/workflows/release-assets.yml) |
| 浏览器工具 | [启动/采集](../scripts/browser-inspection/run.mjs)、[probe](../scripts/browser-inspection/probe.mjs)、[独立依赖](../tools/browser-inspection/package.json) |

首次安装开发工具依赖（固定版本在独立 lockfile，不改根应用依赖）：

```powershell
npm ci --prefix tools/browser-inspection
node scripts/verify-fc27-prelaunch.mjs --browser
```

独立构建输出到被 Git 忽略的 `dist/fc27-preview/`，不覆盖根目录生产脚本，不生成可自动更新的 FC27 `.meta.js`：

```powershell
node scripts/build-fc27-preview.mjs
node scripts/build-fc27-fsu-core.mjs
```

上线前 Preview 约 5.7 KB，FSU core 约 23.6 KB；2026-09-17 接入本地/fresh 读取、分页校验与共享卡种判定后，core 约 50 KB、10 个白名单模块。它们仍是受限只读能力，不能与完整 FC26 产品比较为“已完成 99% 瘦身”。依赖白名单只证明旧业务不进入新构建；旧功能仍在冻结的生产路径，待新功能验收后再删除。

上线后用户需要检查浏览器时，明确启动交互模式（本次没有执行）：

```powershell
node scripts/browser-inspection/run.mjs --interactive
```

它使用 `用户目录/.fcat-browser-inspection/profile`，不使用日常浏览器 profile；通过 Playwright pipe 控制自有进程，不监听公网/局域网 CDP 端口。用户自行打开 Web App、登录和安装/启用已验证的插件；Enter 仅采集唯一 Web App 标签页的字段存在性，`q` 关闭进程。不会自动导航、刷新、点击、开包或提交，不采集页面正文/完整 DOM/账号信息/请求头/响应体。更多字段、连续网络时序与截图须在 B1-B5 按新白名单逐项添加，不能把当前存在性报告当完整接口证据。

离线 smoke 使用新的临时 profile，结束后关闭浏览器，临时目录暂保留以便检查；不包含 EA 登录态。交互 profile 则为后续会话复用保留，严禁提交 Git 或分享。

## 明确未完成的发布接线

- 本批提交版本为 `0.8.65`，同步 lockfile 并重新构建生产脚本；生产 userscript `@name` 仍为旧名。后续改名提交修改了远程仓库、Runner namespace、更新地址和资产文件名，但没有创建正式 Release tag，因此不代表安装迁移已完成。
- 未将独立 FSU core 拼入当前 `26.09_mod`。改名时曾调整 FSU Local 的维护地址但保留 `26.09.6`；现已因最小价格修复升为 `26.09.7` 并重建 patch/资产，仍未完成真实安装/渠道/业务验收，不能据此发布。
- 未启用正式 FC27 发布。现有 Release 增加 prerelease/latest 策略，并明确拒绝主版本 >=27，直到 P5 安装/资产/版本迁移门禁完成后才能解除；Preview 只生成隔离的 CI artifact。
- 配置迁移当前是可测试的存储/校验模块，保护字段仅保存在 `protectionReview`；不自动把缺省值当生效策略。旧安装导出桥、确认 UI 和真实 GM 行为仍须 P5 验收。

## 上线后门禁

P2/FSU F1-F2/B1-B6 保持 Pending：真实账号/平台读取、EA 积分/资格/贡献接口、库存加载与定向校验、奖励和消耗对账、Tampermonkey/FSU 联调都需要实机证据。不得把模拟 provider 或页面类名存在当作兼容证明。
## 上线后 FSU 接续

2026-09-17 后续批次：独立 FSU Preview 的 GM 注入/策略与锁卡 UI、冷启动 bridge、传统只读规划与价格表已实现；Club 和 39/41 EA 均价有实机读取证据，实际填阵、卡面价格和真实 GM 安装仍未验收。完整验证 225 文件/2,163 测试，FC27/browser 22 文件/185 测试通过。不回改上线前验收结论，当前事实见 [FSU FC27 支持记录](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。
