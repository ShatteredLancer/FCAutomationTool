# FC Automation Tool 改名记录

2026-09-14：仓库为 `ShatteredLancer/FCAutomationTool`，用户已将本地目录和工作区切换至 `C:\Workspace\FCAutomationTool`。

- 当前文件：`FCAutomationTool.loops.json`、`FCAutomationTool.user.js`、`FCAutomationToolHotReload.user.js`。
- 开发服务入口：`StartFCAutomationToolDevServer.ps1`；metadata 与 Profile 资产也使用新文件名前缀。
- README、AGENTS、开发文档和相关构建、测试、CI 引用同步更新。
- 本次只改名称与路径，不表示 FC27 已兼容；当前完整脚本仍是 FC26 业务。正式 `27.0.0` 是用户明确选择的全新安装，不要求旧配置迁移。安装时必须禁用旧脚本并重新确认保护配置。
- FC26 安装显示名称、内部存储 key、协议标识、历史 CHANGELOG 和 FSU 上游身份不作全仓替换。FSU 名称与 namespace 必须保留。
- 尚未发布新名 Release 资产；README 的新名下载入口须在发布后验收，不能把 GitHub 仓库重定向当作资产文件重定向。

本记录优先于旧迁移计划中尚未更新的改名时间安排；旧季历史基线仍指向原提交及原文件名。

验证：`npm run verify` 通过（209 个文件、2,023 项测试）；`node scripts/verify-fc27-prelaunch.mjs` 通过。新名根目录脚本与 dist 字节一致。未进行真实 Web App、Tampermonkey 热加载或正式 Release 下载验收。
