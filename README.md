# FC Automation Tool

当前完整脚本仍为 FC26 业务，FC27 仅有离线 Preview。新名 Release 资产尚未发布，下方新名安装链接须待发布后使用。详见 [改名记录](docs/RENAME_STATUS_ZH.md)。

[![Verify](https://github.com/ShatteredLancer/FCAutomationTool/actions/workflows/verify.yml/badge.svg)](https://github.com/ShatteredLancer/FCAutomationTool/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

FC Automation Tool 是运行在 EA FC Web App 中的 Tampermonkey 自动化工具，用于编排 SBC、开包、Unassigned 处理、Player Pick、动态 SBC 扫描和可复用 Workflow/Profile。

项目优先保证材料和库存安全：身份、材料要求、库存去向或提交状态无法确认时会停止，而不是继续猜测。

> 本项目与 Electronic Arts 无关联，也不受 EA 认可。自动化可能违反服务条款并带来账号风险，使用者自行决定是否运行。

## 安装

需要：

- Chrome 或兼容浏览器
- Tampermonkey
- FSU `26.09`，或本仓库维护的 [FSU Local](FSU_mod/README.md)
- FC26 Enhancer 可选；Runner 支持与其共存，但核心安全策略来自 FSU

安装最新正式版：

<https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FCAutomationTool.user.js>

Tampermonkey 首次显示权限确认时，检查脚本来源、版本和网络域名后再安装。旧的 `FC26 FC Automation Tool - Validation` 与生产版属于不同脚本；安装生产版前请禁用或删除旧脚本。

进入 EA FC Web App 后等待启动扫描完成。面板日志出现 `Ready v...` 后才能运行 Loop。首次扫描可能需要读取当前 SBC Challenge；后续 Incremental scan 会复用仍有效的逐 SBC 缓存。

## 自动更新

正式版通过 GitHub Release 提供：

- `FCAutomationTool.meta.js`：Tampermonkey 版本检查
- `FCAutomationTool.user.js`：完整脚本
- `SHA256SUMS`：发布资产校验和

Tampermonkey 按自身的更新检查间隔读取 `releases/latest`。只有 `@version` 增加且 Release 完整发布后才会更新；也可以在 Tampermonkey 中手动检查脚本更新。

## 快速开始

1. 确认 FSU 已加载，并等待 Runner 显示 Ready。
2. 在 `Profile` 中选择 Built-in 或需要的官方/用户 Profile。
3. 在 `Loop` 中选择流程。
4. 根据当前 Loop 设置数量；Daily 和受 EA 限次控制的流程可能不显示数量输入。
5. 第一次运行新配置时，在 Builder 中启用对应 Loop/Profile 的 Dry Run 并检查规划。
6. 点击 `Start`；需要停止时点击 `Stop`，Runner 会在下一个安全点结束。
7. 出错后保持当前 Unassigned 状态，使用 Options 中的 `Save log` 导出完整日志。

## 主要能力

- One-click Daily、Provision、库存耗尽和评分型 Upgrade 工作流
- 只读 Dynamic SBC 扫描和逐 SBC Challenge 缓存
- 动态 Player Pick 与安全材料条件解析
- 动态 My Packs Catalog 和 Batch Open fixed/all 队列
- Unassigned、Storage、Transfer、Club 去向确认和恢复策略
- 可视化 Workflow/Loop Builder、Profile、Draft/Saved/Active 状态
- Rare Gold/Special recap、价格查询和可选 Reward Alerts
- FSU Lock（可选）以及不可交易、联赛、Evolution、高分和特殊卡保护兼容
- Trade Scheduler：受保护的 Buy、Club Listing、Transfer Reprice 和 EA 原生 Re-list All，支持秒级调度、Request Pacing、有限授权、可恢复时间片与跨任务公平执行

详细界面和 Loop 行为见 [用户手册](docs/USER_GUIDE_ZH.md)。`10x85+` 的开包、材料消耗和恢复流程见 [Rolling Loop 使用与流程指南](docs/10X85_ROLLING_LOOP_GUIDE_ZH.md)。Builder 的图示操作见 [Workflow/Loop Builder 中文指南](docs/WORKFLOW_LOOP_BUILDER_GUIDE_ZH.md)。手机、平板和触摸屏布局见 [响应式与触摸界面](docs/RESPONSIVE_UI_ZH.md)。

## 官方 Profile

- `Built-in`：当前内置配置，One-click Daily 运行四个 Daily 阶段。
- `Default`：可编辑、跟随当前内置基线的 Profile。
- `Bronze/Silver Inventory Only`：Daily Bronze、Silver、Common 等铜银材料阶段只使用库存。
- `Daily + Rare Pack Recycling`：四步 Daily 后追加 Rare Pack 回收，优先使用当前 Rare Gold Premium，否则使用 Rare Gold Baseline。
- `Daily + Rare Pack to 5x80+`：四步 Daily 后追加 quantity-first Common Gold Premium 回收，但只允许 Rare Gold 填阵；当前目标是允许不限稀有度金卡的 `5x 80+ Upgrade`。

未修改的官方 Profile 会随新的内置基线安全更新；用户修改过的同字段冲突必须在 Builder 中明确选择保留哪一侧。

## 安全和网络

Runner 不包含遥测。以下功能会按需访问第三方服务：

- FUT.GG、FUTBIN、FUTNext：球员 ID 或价格查询
- ntfy.sh：用户显式启用后的远程 Reward Alert
- GitHub Release：由 Tampermonkey 检查和下载更新

ntfy token 保存在 Tampermonkey 的 GM 隔离存储中，不写入 EA 页面 localStorage。生产 Runner 不具有 localhost 网络权限；本地开发权限仅存在于独立的 Hot Reload 脚本中。

提交前的核心边界包括：材料类型和评分检查、特殊卡限制、protected/locked identity、重复 definition 检查，以及 FSU provisional Club 实体的定向 EA 校验。完整工程约束见 [AGENTS.md](AGENTS.md)。

## 问题反馈

先阅读 [故障排查指南](docs/TROUBLESHOOTING_ZH.md)，再使用仓库的 Bug report 表单。报告中至少包含：

- Runner 和 FSU 版本
- Enhancer 是否启用
- Active Profile 和 Loop
- 起始 Unassigned/Storage/My Packs/SBC 状态
- 完整 Save log，必要时附 FSU diagnostics JSON

上传前删除认证信息和 ntfy token。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。

## 文档

- [用户手册](docs/USER_GUIDE_ZH.md)
- [10x85+ Rolling Loop 使用与流程指南](docs/10X85_ROLLING_LOOP_GUIDE_ZH.md)
- [10x85+ Rolling Loop 设计与实施追踪](docs/10X85_ROLLING_LOOP_IMPLEMENTATION_ZH.md)
- [故障排查](docs/TROUBLESHOOTING_ZH.md)
- [开发与发布](docs/DEVELOPMENT.md)
- [Workflow/Loop Builder 中文指南](docs/WORKFLOW_LOOP_BUILDER_GUIDE_ZH.md)
- [Builder 模型和边界](docs/WORKFLOW_LOOP_BUILDER.md)
- [响应式与触摸界面](docs/RESPONSIVE_UI_ZH.md)
- [Trade Scheduler 设计与实施跟踪](docs/TRADE_SCHEDULER_DESIGN_ZH.md)
- [Trade Scheduler v2 设计与实施跟踪](docs/TRADE_SCHEDULER_V2_DESIGN_ZH.md)
- [Trade Scheduler 操作、安全与故障排查](docs/TRADE_SCHEDULER_OPERATIONS_ZH.md)
- [FSU Local 使用说明](FSU_mod/README.md)
- [FSU Club Cache 集成](FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)
- [重构里程碑](docs/REFACTORING_MILESTONES.md)
- [变更记录](CHANGELOG.md)

## 开发

使用 Node.js 22：

```powershell
npm ci
npm run verify
```

修改 `src/` 后运行 `npm run build`。不要手工编辑根目录生成的 `FCAutomationTool.user.js` 或 `dist/`。贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

FCAutomationTool 使用 [MIT License](LICENSE)。FSU 上游和本地修改保留其独立 MIT 声明，详见 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。

