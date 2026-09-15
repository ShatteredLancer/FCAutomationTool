# FC Automation Tool 改名记录

发布前剩余边界、FSU Local 版本问题与浏览器实机步骤见 [收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)。

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
