# FC Automation Tool 改名记录

发布前剩余边界、FSU Local 版本问题与浏览器实机步骤见 [收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)。2026-09-18 用户已确认按全新身份发布 `27.0.0` 只读首版，取代下方先前的全部 Release 阻断。Live 仍关闭，结果见 [发布记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-只读首版发布授权)。

## 2026-09-18 正式身份完成

- npm 包名为 `fc-automation-tool`，package/lock 版本同步为 `27.0.0`。
- 默认构建改用 `src/fc27/production-entry.js`；`@name FC Automation Tool`，`@namespace https://github.com/ShatteredLancer/FCAutomationTool`。旧 FC26 源保留冻结回归，不进入新 bundle。
- 根目录和 dist 的 `FCAutomationTool.user.js`、`.meta.js`、manifest 已同步；更新指向新仓库同名 Release 资产。FSU Local 仍为原名/namespace，版本 `26.09.8`，本次没有改 FSU。
- 真实 Tampermonkey 已验证新身份安装、与 Acceptance 的 GM 隔离、刷新持久化及双标签互斥。FC27 不迁移旧安装数据。
- 旧 `FCAutomationToolHotReload.user.js` 仅支持 FC26，已阻止在 FC27 执行或误载新版 bundle。FC27 必须直接安装到 Tampermonkey，不能通过页面 eval 代替 GM 隔离。
- 新名 Release `v27.0.0` 已正式发布并成为 latest，七项资产与 Runner/FSU 四个更新下载地址均实下载校验通过。真实低价值 SBC 验收按用户要求延期，`FC27_LIVE_ACCEPTANCE_PENDING` 只表示业务 Pending，Live 仍关闭。已发布 FC26 资产保持不变，不为新安装提供旧名别名。见 [发布与交付结果](FC27_LIVE_ADAPTATION_ZH.md#发布与交付结果)。

以下 2026-09-14 的过渡身份状态是历史记录，由本节取代；更新渠道证据边界以[最新记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-正式入口与发布资产准备)为准。

2026-09-14：仓库为 `ShatteredLancer/FCAutomationTool`。执行改名的工作机曾将本地目录和工作区切换至 `C:\Workspace\FCAutomationTool`；该绝对路径不是其它电脑或 clone 的强制位置，判断当前工作区应以 Git remote、branch 和 HEAD 为准。

- 当前文件：`FCAutomationTool.loops.json`、`FCAutomationTool.user.js`、`FCAutomationToolHotReload.user.js`。
- 开发服务入口：`StartFCAutomationToolDevServer.ps1`；metadata 与 Profile 资产也使用新文件名前缀。
- README、AGENTS、开发文档和相关构建、测试、CI 引用同步更新。
- 本次只改名称与路径，不表示 FC27 已兼容；当前完整脚本仍是 FC26 业务。正式 `27.0.0` 是用户明确选择的全新安装，不要求旧配置迁移。安装时必须禁用旧脚本并重新确认保护配置。
- FC26 安装显示名称、内部存储 key、协议标识、历史 CHANGELOG 和 FSU 上游身份不作全仓替换。FSU 名称与 namespace 必须保留。
- 当前未发布源码保留旧 Runner `@name`，但已改用新 Runner namespace 和新名更新资产。这是尚待批准及 Tampermonkey 实测的过渡身份，不属于已完成的安装迁移；正式发布继续由收尾清单中的总门禁阻断。
- 尚未发布新名 Release 资产；README 的新名下载入口须在发布后验收，不能把 GitHub 仓库重定向当作资产文件重定向。

本记录优先于旧迁移计划中尚未更新的改名时间安排；旧季历史基线仍指向原提交及原文件名。

改名提交阶段验证：`npm run verify` 通过（209 个文件、2,023 项测试）；后续收尾验证结果以[收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)为准。`node scripts/verify-fc27-prelaunch.mjs` 通过，新名根目录脚本与 dist 字节一致。未进行真实 Web App、Tampermonkey 热加载或正式 Release 下载验收。
