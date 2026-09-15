# FC27 上线前收尾与开服接续

2026-09-15。范围是离线准备收尾，不是 FC27 业务兼容验收。不自动登录 EA、不运行旧业务，不创建 Release。

## 收尾清单

| 项目 | 状态 | 证据与边界 |
| --- | --- | --- |
| 仓库、文件与构建链更名 | Complete | 远程仓库、新文件及构建链已采用 `FCAutomationTool`；本地绝对路径按工作机分别记录，不作为全局完成条件 |
| Runner 安装身份与显示名 | **Pending（发布阻断）** | 完整脚本仍为 `FC26 Daily Loop Runner`，但 namespace 和 update/download URL 已改为新仓库/新资产。必须明确 FC26 升级与 FC27 全新安装的身份组合并完成 Tampermonkey 实测后，才能把审计标为 Complete |
| npm 包名 | 保留 | `fc26-daily-loop-runner` 当前仍供 FC26 构建；正式新入口切换时同步 package/lock，不以改包名代替赛季适配 |
| Release 门禁 | Complete（离线） | `check-release-readiness.mjs` 暂停全部正式资产发布；>=27 通道门禁继续保留，Preview artifact 不受影响 |
| FSU 改地址未升版本 | 已识别，发布阻断 | 既有改名提交更改了维护源 metadata，但 Local 仍为 `26.09.6`。不得按相同版本发布；实际发布前独立升 Local 版本、重建 patch/manifest、验收更新。不可变 origin 和上游身份不动 |
| Preview CI | Complete（配置） | main push 和 PR 执行；完整历史供冻结检查使用；统一专项验证入口。远程运行成功与否须另看 Actions |
| 浏览器参数 | Complete（离线） | 缺失路径、未知参数、重复/冲突模式在启动前拒绝；无参数只显示帮助 |
| 浏览器与插件组合 | Pending（人工） | 本地 headless smoke 不能证明 Tampermonkey/FSU 扩展加载成功，不启动交互登录替代用户验收 |
| 全新安装决定 | Complete（范围） | FC27 不继承旧 journal、库存、授权或凭证；白名单 preferences 模块保留为可选能力，不要求旧版导出桥 |

远程核对：改名提交 `a2b2882c3a3121a3f2ff9699335d13cb9215e524` 已进入 `origin/main`，此前“改名提交尚未推送”的状态已过时。这里记录稳定的改名提交身份，不把会随每次提交变化的 `origin/main` 头部哈希写成长期事实。本轮没有创建 Release tag。

旧名称清单：历史 Git blob 路径、CHANGELOG、旧季安装名、内部协议和存储 key、FSU 上游身份均允许保留。不能为了搜索结果为零而修改历史证据或清空配置。README 中的误写 `FC26 FC Automation Tool` 已纠正。

## 浏览器预演

离线命令：

```powershell
npm ci --prefix tools/browser-inspection
node scripts/verify-fc27-prelaunch.mjs --browser
```

交互验收需用户明确启动：`node scripts/browser-inspection/run.mjs --interactive`。使用专用 profile，不使用日常浏览器目录、不公开 CDP 端口。用户检查能否安装/启用 Tampermonkey；受管理 Chrome/Edge 如限制扩展，先解决浏览器策略，不能绕过安全限制。禁止启用旧 Runner 或旧 FSU 26 自动化来测试 FC27。

当前 Enter 报告只包含固定根对象字段存在性与赛季，以及采集瞬间的有界网络状态计数；不代表完整登录网络轨迹。输出不含请求头、响应体和账号信息。`artifacts/fc27-browser/self-test.json` 仅是离线 fixture 报告，不是 EA 证据。安装扩展、GM 隔离和页面注入能力须人工记录插件版本及结果，不能从普通页面的根对象缺失判定扩展一定未安装。

## 开服后接续

1. B1：用户手动登录专用浏览器，只读确认真实赛季、平台、页面根对象。首份报告记录工具 commit、浏览器版本、插件版本；不上传 profile、cookies、token 或未经脱敏的 HAR。
2. B2-B5 / F1：按所需字段逐项扩充采集白名单，核实 EA 库存实体、SBC 条件、积分预览、奖励与响应时序。原始证据本地保管，脱敏 fixture 入库；未经证实的 SBC 积分规则不写入业务模型。
3. F2：独立实现最小 FSU provider，真实 readiness、保护配置、item/definition 定向验证全部通过；不要求全部旧 FSU 增强功能恢复。
4. P2 上线只读勘察：汇总 B1-B5 与 F1/F2 证据，建立真实快照和失败 fixture；积分、资格、特殊卡条件未知则停止，不执行账号写操作。
5. P3 积分 MVP：先用纯规划器和只读 Dry Run 与 EA 页面核对，再经用户确认执行低价值单次/分批贡献；覆盖超额预算、journal、响应丢失、部分成功、重复实体、Stop 与重启。禁止通过跳过最后 submit 来假装 Dry Run，因为 save、move、open 已有副作用。
6. P4 奖励与连续循环：在单次事务对账稳定后接入 Pack/Pick、容量预留、单步补料和有界续跑；证据不足不重试，也不进入下一奖励或提交。
7. P5 传统能力与发布收口：只开放已证实的传统合同，以新身份全新安装并人工禁用旧脚本；确认保护、GM、资产更新、异常停止和实机合同后发布 `27.0.0`。解除发布阻断必须有文档证据与测试，不因开服自动解除。

建议首版范围：只读检查、库存/保护、明确支持条件的单次 SBC 与奖励对账；连续 Rolling、补给规划、交易和定时调度分别验收，不自动继承旧季支持声明。此范围是建议而非新增业务授权，正式实现前结合接口证据与用户优先级确认。

## 验证记录

2026-09-15：`npm run verify` 通过，210 个测试文件、2,032 项测试；`node scripts/verify-fc27-prelaunch.mjs --browser` 通过，54 项专项测试与真实 Chrome 的离线 fixture smoke 通过。未访问 EA。生产 bundle 未改业务。正式 EA、扩展组合和发布渠道验收保持 Pending。
