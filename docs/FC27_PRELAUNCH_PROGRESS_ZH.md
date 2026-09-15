# FC27 上线前实施记录

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

当前 Preview 约 5.7 KB，FSU core 约 23.6 KB。它们只有准备功能，不能与完整 FC26 产品比较为“已完成 99% 瘦身”。依赖白名单只证明旧业务不进入新构建；旧功能仍在冻结的生产路径，待新功能验收后再删除。

上线后用户需要检查浏览器时，明确启动交互模式（本次没有执行）：

```powershell
node scripts/browser-inspection/run.mjs --interactive
```

它使用 `用户目录/.fcat-browser-inspection/profile`，不使用日常浏览器 profile；通过 Playwright pipe 控制自有进程，不监听公网/局域网 CDP 端口。用户自行打开 Web App、登录和安装/启用已验证的插件；Enter 仅采集唯一 Web App 标签页的字段存在性，`q` 关闭进程。不会自动导航、刷新、点击、开包或提交，不采集页面正文/完整 DOM/账号信息/请求头/响应体。更多字段、连续网络时序与截图须在 B1-B5 按新白名单逐项添加，不能把当前存在性报告当完整接口证据。

离线 smoke 使用新的临时 profile，结束后关闭浏览器，临时目录暂保留以便检查；不包含 EA 登录态。交互 profile 则为后续会话复用保留，严禁提交 Git 或分享。

## 明确未完成的发布接线

- 本批提交版本为 `0.8.65`，同步 lockfile 并重新构建生产脚本；生产 userscript `@name` 仍为旧名。后续改名提交修改了远程仓库、Runner namespace、更新地址和资产文件名，但没有创建正式 Release tag，因此不代表安装迁移已完成。
- 未将 FSU core 拼入当前 `26.09_mod` 或伪造 FC27 inventory provider。后续改名提交调整了 FSU Local 的维护地址，而 Local version 仍为 `26.09.6`；该组合不得发布，真正 EA/GM 接线和独立升版仍待 F1/F2 证据与发布验收。
- 未启用正式 FC27 发布。现有 Release 增加 prerelease/latest 策略，并明确拒绝主版本 >=27，直到 P5 安装/资产/版本迁移门禁完成后才能解除；Preview 只生成隔离的 CI artifact。
- 配置迁移当前是可测试的存储/校验模块，保护字段仅保存在 `protectionReview`；不自动把缺省值当生效策略。旧安装导出桥、确认 UI 和真实 GM 行为仍须 P5 验收。

## 上线后门禁

P2/FSU F1-F2/B1-B6 保持 Pending：真实账号/平台读取、EA 积分/资格/贡献接口、库存加载与定向校验、奖励和消耗对账、Tampermonkey/FSU 联调都需要实机证据。不得把模拟 provider 或页面类名存在当作兼容证明。
