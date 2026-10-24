# Streamlined 外部库存选卡

## 当前需求与计划（2026-10-24）

用户确认：原生 Streamlined 工作区增加一个合并的 `Transfer / Unassigned` 入口，不拆两个页签；保留原生 Club / SBC Storage。展示当前缓存中的两处球员卡、来源、官方积分及不可选原因，用户勾选后复用现有批次预览和贡献执行链。

同 definition 的 Club 卡存在时，必须把该精确 Club 实体作为前置材料，先贡献并独立确认消耗，再将外部实体移入 Club 后贡献。没有 Club 同版本时可以先移入；同版本多张外部实体分批。选择和预览无移动/献祭/购买副作用，只有可信执行点击才进入现有事务。达到本轮目标即停止，不为清外部库存继续消耗。Only Untradeable、评分、进化/特殊、锁卡/主阵容、拍卖状态和历史预留不放宽。

### 实施步骤

1. 纯选卡模型：精确身份、排除原因、Club 前置依赖与分批；不调用经济 Solver 舍弃用户选卡。
2. Session：只读浏览快照、重新读取后冻结所选材料和依赖；上下文/材料变化时要求重选。共用 execution.prepare / contribute / recover，不增加写 Adapter 或 Journal schema。
3. 页面：合并入口，分页卡片和合规状态，选中汇总与批次预览；关闭/切换释放卡面和临时选择。
4. 单测和离线 Chrome 贯通，完整 verify、生成产物一致性、同步 main 后提交推送。真实账户移动和贡献由用户最后验收。

### 场景矩阵

| 前置/动作 | 预期 | 验证 |
| --- | --- | --- |
| 无 Club 同版本，选择外部卡 | 计划包含所选精确实体，预览不移动 | 单测/离线 Chrome |
| Club 同版本及两张外部副本 | Club 在前，外部逐批；不换成其他版本 | 单测/离线 Chrome |
| Club 前置被锁/主阵容/政策排除或历史预留 | 外部不可选，显示前置原因 | 单测 |
| 已挂牌/售出/状态未知、可交易而仅不可交易开启 | 不可选，显示原因 | 单测 |
| 选择后材料/政策/账号/挑战变化 | 不执行旧选择，重新读取/选择 | 单测 |
| 超过一页，分页、关闭、导航 | 选择可跨页，卡面正确释放，无真实写请求 | 离线 Chrome |
| 执行 Club 及两张同版本外部卡 | `contribute Club → confirmed → move Transfer → contribute → confirmed → move Unassigned → contribute → confirmed`，再次执行无新增写请求 | 生产模块贯通通过；真实验收待执行 |
| Club 确认后停止，重建事务并恢复 | 恢复只读；继续时跳过已确认 Club，随后才移外部卡 | 生产模块贯通通过；真实验收待执行 |
| 响应 accepted 但 Club 实体仍在 | unknown，阻止外部移入与重复贡献；精确实体消失后只读恢复，再由新点击继续 | 生产模块贯通通过；真实验收待执行 |
| Club 前置已达目标 | 后续外部卡不入计划，显示省略数量 | 单测通过 |
| 准备执行器时关闭/停止 | 不恢复已关闭预览、不准备或执行事务 | Session 单测通过 |
| 桌面/移动端与程序点击 | 分页/固定底部可读，无横向溢出；非可信点击不执行 | 离线 Chrome 通过 |

## 证据边界和恢复点

2026-10-24 开始实施，基线 main 27.0.58 / 66675d8，工作区干净。现有 materializer 已提供外部卡→Club 的精确移动、独立读回和未知恢复；现有 splitter 提供 Club 前置与重复版本跨批。

浏览使用 EA 当前已加载缓存，不代表全库存鲜读；空列表应提示先在 EA 原生转会列表/未分配页加载后返回，不自动重复拉库。Club 的缺失缓存不能作为移入许可，执行仍用原生鲜读最终检查。未核实重复提示或前置卡不可用时停止该卡，不修改保护。

代码实现完成。新增 `src/streamlined/external-selection.js`、独立选择视图及 Session/Panel 接线；共享执行 Adapter、采购、Puzzle/Gallery 和 FSU 源码均不改。恢复从既有冻结计划识别手选外部序列，不新增 Journal 字段。

自动证据：

- 定向 5 文件 / 58 项通过（模型、Session、materializer、Provider、生产贯通），`lint:undef` 通过。
- `tests/workflows/streamlined-external-selection.test.js` 使用生产读取、计划、事务、Journal、Provider、materializer 和 validator/reconciler；只有原生响应、方法 hash 和共享锁为合成依赖，不是服务器实测。
- `scripts/browser-inspection/run.mjs --self-test` 完整离线 Chrome 通过；记录 `artifacts/external-browser-check.log`。新增检查包含保留原生 Storage、27 张外部卡、分页/跨页选择、不可选原因、无写预览、顺序审批、可信点击和卡面资源释放。
- 已目视核对 `artifacts/fc27-browser/streamlined-external-selection-desktop.png` 和 `streamlined-external-selection-mobile.png`。合成卡面不证明真实 EA 卡图可用。
- 升版 27.0.59；完整 `npm run verify` 通过（428 文件、5,172 项），含 952 文件语法检查、lint、配置/架构/FSU patch 与 release 检查、构建及 root/dist/版本一致性。日志 `artifacts/external-full-verify.log`。
- `node scripts/verify-fc27-prelaunch.mjs --browser` 通过（87 文件、1,549 项，全部离线 Chrome 检查通过），日志 `artifacts/external-prelaunch-verify.log`。本轮浏览器也通过新增外部选卡检查；未连接 EA 账号。
- root/dist 27.0.59 字节一致，SHA256 `4358a11f2011b600620dc93393458da6b2491aaf153ae4c2a16cc85d183a90c0`。FSU Local 仍为 26.09.10，源码/生成资产无变化。`git diff --check` 通过。

真实账号仍未操作。需安装精确 27.0.59 构建后验收：原生底部入口布局、真实卡面/不可选原因；先 Club 后外部移入/贡献；目标达到提前停止；手动停止与核对恢复。真实交易/贡献由用户点击。旧 Journal 原样保留，未知回执仍先只读恢复，不能重新选卡覆盖。

当前恢复点：main 27.0.58 / 66675d8 上实现，最终再次 fetch 并确认远程无新增；完整自动检查通过，提交推送 27.0.59。未使用真实账号浏览器、未买卡/移卡/贡献。下一步按上文真实账号场景验收；后续不必为重复自动检查要求用户登录。用户追问的 SBC Storage 为 EA 原生入口，本次保留。

## 27.0.60 验收反馈修正

用户反馈外部入口单独占一行、Transfer 中已到期未售出卡不可选。基线 27.0.59 / b5d5f23，工作区干净。

已核对匿名 EA 11414 公开源码：WorkArea 底部为 `.ut-one-click-sbc-work-area-view--tabs .menu-container`，原生按钮使用 `.ea-filter-bar-item-view`；`isExpired()` 精确判断 EXPIRED，`isSold()` 为 tradeOwner + CLOSED，原生 UNSOLD 区包括 expired 或有效 inactive。现有共享快照仅将 inactive + free 映射为 activeTrade=false，因此 expired 在 Streamlined 被误拦；截图本身未导出实际实体字段，不把代码复现当作现场逐字段证明。

计划：入口移至原生菜单容器并沿用原生按钮类，不注册伪 EA tab、不修改 Club/Storage 选择；只在 Streamlined 的 Transfer 投影认可明确 EXPIRED、本人拥有、无出价且 free 的实体，准备/移动前复用同一投影复核。未知/已售/仍挂牌继续停止，Only Untradeable、保护、Journal 与贡献顺序不改。

验收矩阵补充：原生三个入口同排/同高（桌面、窄屏、底部菜单重建及导航清理）；expired 未售出从读取→选择→预览→Club 前置贡献→移入→贡献贯通；预览后变 active/closed/unknown、有出价、所有权/枚举/state 缺失均不移动；普通 Puzzle/Gallery 共享快照行为不改。先失败复现再修正，完整 verify/FC27 离线 Chrome 后提交推送；真实账号按钮和移卡贡献由用户验收，本轮不发真实写请求。

实现与证据：

- 修正前 3 个回归失败（读取 activeTrade=null、materializer 不能移入、外部选卡生产链不能生成有效计划），其余边界通过；`artifacts/external-feedback-red.log`。不是用账号库存推断结果。
- `fc27-streamlined-read.js` 仅在 Streamlined Transfer 投影补明确到期未售出；材料物化复用此投影，未修改共享快照或写 Adapter。`fc27-streamlined-panel.js` 删除独占行容器，把原生 CSS 类按钮放入原生 menu-container。
- 三文件定向 70 项通过后，补 Only Untradeable/其他 pile 不豁免场景；完整 `npm run verify` 通过：428 文件、5,189 项，含 lint/架构/构建、27.0.60 root/dist 一致性及 FSU 26.09.10 原资产检查，日志 `artifacts/external-feedback-full-verify.log`。
- Streamlined 定向离线 Chrome 通过，含 1280/390 宽下三个按钮同排同高、菜单重建、可信点击及原贡献/市场/恢复界面回归；`artifacts/external-feedback-browser.log`。目视核对 `artifacts/fc27-browser/streamlined-external-native-tabs.png`，使用公开 EA CSS 的合成页面，不冒称真实登录页面。
- 公开原生 auction 方法及合成 expired 行保存在 `tests/fixtures/fc27-streamlined-expired-transfer-2026-10-24.json`；未知/有出价/非本人/非 free 仍不能借此选卡。用户启用 Only Untradeable 时，可交易卡显示对应禁选原因，不自动改变设置。
- FC27 专项 `node scripts/verify-fc27-prelaunch.mjs --browser` 通过：87 文件 / 1,549 项及全部离线 Chrome；`artifacts/external-feedback-fc27-verify.log`。root/dist SHA256 一致：`5ae3cfc92fd9bee5503de7f9cb4512cb7fba7c74e1a66a95599174704c237b35`；`git diff --check` 通过，FSU 源码/资产无变化。

恢复点：代码、完整 verify、FC27 专项及全部离线浏览器完成；fetch 后远程无新提交，提交推送 27.0.60。实际账号布局及截图卡是否具备全部字段仍待更新验收；未登录账号或移动/贡献真实卡。旧 Journal 不清空，未知结果仍先核对恢复。
