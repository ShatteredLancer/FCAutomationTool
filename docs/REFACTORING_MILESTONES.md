# FC Automation Tool 架构重构与里程碑

2026-09-18 FSU `26.09.9` 对话框兼容修复：FC27 的 `EADialogViewController` 已从 `dialogOptions` 切换为 `continueOption`/`cancelOption`，导致原 FSU SBC 方案导入弹窗缺少确认/取消按钮。共用 `events.popup` 现在同时兼容新旧字段，并保留三按钮动作、标签和 Escape 语义；5 项回归覆盖 FC27/FC26 合同。未改 FSU Club 缓存、选材、保存或提交路径；真实登录页面按钮可见性仍待验收。

2026-09-18 Live 授权更新：本地 `27.0.1` 按用户“打开 live 限制”开放现有传统 SBC 单次保存/提交，仍要求计划校验和逐次确认，全部材料/事务保护保留。已发布 `27.0.0` 不变，真实业务及新版本发布仍 Pending。进度见 [单次 Live 开放](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-单次-live-开放)。

2026-09-18 发布完成：`v27.0.0` 已在提交 `40463dc` 正式发布为只读 latest，配套 FSU Local `26.09.8`。完整 2,480 项、FC27 专项 500 项及浏览器 CI 通过，七项资产和四个 latest 更新地址实下载 SHA256 一致；Live 继续硬关闭。详见 [发布与交付结果](FC27_LIVE_ADAPTATION_ZH.md#发布与交付结果)，以下为历史过程。

2026-09-18 只读发布授权：用户确认按 `27.0.0` 只读首版正式发布。只允许已实机验收的精确 Runner/FSU SHA256 组合，Live 硬关闭及真实业务 Pending 保留；旧“阻断全部 Release”不再适用于该限定版本。CI 改为构建后验证授权/安装证据、固定范围发布说明和显式资产清单；变更脚本或未来版本不得沿用许可。执行结果见 [发布记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-只读首版发布授权)。

2026-09-18 正式入口准备完成：按用户要求延期真实低价值 SBC，先完成第 2 项。当前 `fc-automation-tool@27.0.0` 默认构建新 FC27 正式身份，22 个白名单模块/130,516 bytes；真实 Tampermonkey 全新安装、GM 隔离、受控本地更新及重启保留通过。旧 FC26 源/测试冻结保留，不混入新资产；发布清单与安装证据校验通过。完整验证 244 文件/2469 项，专项 40 文件/489 项及浏览器通过。Live 固定关闭，Release 仍以 `FC27_LIVE_ACCEPTANCE_PENDING` 阻断；实际 GitHub 交付待发布后核验。见 [最新记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-正式入口与发布资产准备)。

2026-09-18 第 1/2 项实现收尾：真实 EA Provider、submit-only、权威库存/奖励对账、精确缓存清理与显式恢复入口已接通；独立 Acceptance 实际安装，真实 Tampermonkey GM 跨刷新/浏览器重启、双标签及关闭持锁页通过。实机只读 Club 41 人、2/2 fresh、奖励包基线和实际面板缺料路径通过；保存/提交/真实未决恢复仍待一次低价值业务验收，Live 固定关闭，发布门禁不变。完整 verify 241 文件/2463 项、专项 37 文件/483 项及浏览器通过。详见 [本批完成边界](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-ea-provider-与真实-gm-验收)，下文同日旧批次仅为历史记录。

2026-09-18 持久层续接：新增严格作用域 GM Journal、固定同源 Web Lock 和组合 Adapter，接入隔离事务的模拟端到端测试；日志失败不视为空，未决记录不可覆盖，已发出的异步 GM 写入结束前不释放锁。新增持久层 43 项回归，事务套件现为 63 项；真实 Chrome 双标签/刷新/关闭持锁页通过，GM 仍为模拟、未访问 EA。没有接入生产入口、没有启用真实提交，下一步为 EA provider、真实 GM 安装及恢复验收。见 [本批完成边界](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-持久日志与跨标签互斥)。

2026-09-18 实时合同与事务核心：最新 Set/Challenge/奖励读取已在铜、金 Upgrade 上通过，只读命令不含写入口；隔离单次事务复用现有 Planner/submit-attempt，新增精确一次性批准、保存/提交前后复核、未决及损坏终态 Journal 阻断、确认后对账，56 项核心回归通过。真实 EA mutation provider、GM/跨标签锁、未决恢复和真实单次提交尚未接通，不构成可发布 Runner。详情见 [实现及明确边界](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-实时合同与单次事务核心)。

2026-09-18 发布续验：用户确认 Club 确实为 41 人，不再将铜/银/金 Upgrade 的 5/7/5 个安全候选归因于缓存漏加载。实际 FSU `26.09.8` 与 2/2 fresh 抽样复核通过，Catalog 已区分缓存 Set 奖励和本次 Challenge 响应，Live 仍关闭。静态审查确认 EA Service submit 会再次 save；FC27 单次事务与对账仍待实现，不只是缺材料。见 [本次证据及剩余实施顺序](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-用户确认-41-人后的发布续验)。

2026-09-18 自然重启修复：原 FSU `26.09.8` 新增 Home 专用有界 readiness 等待，修复 Controller 迟到漏初始化；自然冷启动及两次刷新均成功，2/2 fresh 定向复核与原 FutNext 两条报价通过。价格赛季及显示不因接口成功而通过，见 [修复证据](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-自然重启与初始化竞态定位)。

2026-09-18 UI 续验（历史批次）：原 FSU `26.09.7` 实际安装与运行时 build/set/lock 设置保留已确认；自动初始化未通过，受控调用原 init 后 Club ready，不把该恢复算作冷启动成功。随后已升至 `26.09.8` 并修复该启动竞态。隔离 Runner 只读面板已实机显示 Gold Upgrade 5/11 安全候选与正常缺料，未执行账号写操作；价格/写阵/事务/发布仍 Pending。见 [升级与面板记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-fsu-升级与-runner-只读面板)。

2026-09-18 抽样续验：原 FSU 两卡 fresh 身份/安全属性实机通过，保持 provisional；只修诊断对延迟 capture 初始化的误判。充足合成库存完成 11 人及后续重规划回归，不代表真实整阵或提交已通过。FSU 维护源、生产资产和发布阻断不变，见 [本轮记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-缺卡期间的原-fsu-抽样验证)。

2026-09-18 金卡续验：用户批准仅只读上限 83，实际 Gold Upgrade 为最低 Gold 品质、11 人无 brick，已最小补齐该条件。缓存中仅 5 张安全候选，36 张按评分/不可交易/联赛检查排除，正常停止且无账号写操作。默认仍为 74，不改 FSU 设置或生产资产；正向配阵及全部事务/发布验收仍 Pending。见 [83 分实机记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-获批-83-分金卡只读预览)。

2026-09-18 登录后续验：实际安装原 FSU `26.09.6`，上下文/策略可读、Club 为 provisional（41 名缓存球员）。新增有界只读 Challenge GET 和基于原 FSU 的低价值预览，补齐实际 Bronze/Silver 的整队品质 `count=-1` / EXACT 规则；铜、银 11 人阵仅有 5/7 个安全候选，正确返回 `SAFE_MATERIAL_SHORTAGE`，入门四阵已完成。没有账号写操作，成功完整配阵与事务验收仍 Pending，详情见 [实机记录](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-登录后原-fsu--runner-只读续验)。

2026-09-18 Runner 发布准备续验：将旧 FSU 工作文件冻结拆为 immutable origin 与独立 Local 维护边界，保留 FC26 Runner 冻结和 patch replay，新增 15 项门禁回归；专项预发布检查恢复通过。增加基于既有 FSU 的零方法调用只读输入检查，不建立第二套策略/库存服务、不修改 FSU 或生产 Runner。完整验证 230 文件/2213 项，专项 26 文件/233 项及离线浏览器通过；真实浏览器确认安装 FSU `26.09.6`，当前停在登录页，`27.0.0` Live 与发布仍 Pending。详见 [接续门禁](FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-runner-发布准备续验)。

2026-09-18 阶段提交：保存原 FSU 最小价格补丁和隔离 FC27 只读工具/研究成果，Runner 保持 `0.8.65`，未启用 FC27 自动执行或正式发布。原 FSU readiness 记录不包含已独立确认的安装版本，已修正 fixture 来源说明；`26.09.7` 仍待实机验收。旧 FSU 冻结检查会阻断当前专项预发布命令，后续需明确维护边界并补回归，不能引用原型时期的通过记录声称现已全绿。具体范围与验证见 [上线后记录](FC27_LIVE_ADAPTATION_ZH.md)。

2026-09-18 FSU `26.09.7` 局部兼容修复：原 mod 的 FUT.GG 价格查询和登录时探测统一读取 `info.base.year`/当前 EA 赛季；赛季未知时不请求旧地址。新增源码回归测试，重放 `26.09` patch 并重建 FSU Local 资产。未修改一键填阵、Club 缓存、选材、保存或提交路径；真实 FC27 价格请求和一键填阵仍待登录后的页面验证。

2026-09-18 价格修复前的路线调整：用户要求基于已有 `26.09.6` 查漏补缺，不另建 FSU。专用浏览器已恢复原版路线，FC27 上初始化及 Club ready 通过，原价格/一键填阵函数和开关存在；实际安装版本证据的限制见上文。独立 Preview 停止功能扩展并退出默认安装；保留研究代码，不作为升级前置条件。该次路线调整只更新检查工具和文档，随后的 `26.09.7` 才修改 mod/patch/版本；具体业务修复必须沿原函数复现后最小实施，见 [FSU 当前路线](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

2026-09-17 最新 FSU 实机增量：Tampermonkey 5.5.0 / 独立 Preview .2 的安装、独立 GM 自检键跨刷新保留、面板/桥及 41 人 Club 读取通过；首屏 25 张 EA 均价正常，真实 FUT.GG GM 请求为 403。策略/锁卡业务验收、只读配阵和写阵仍未完成。完整 verify 227 文件/2,183 测试通过。用户已批准只读配阵，随后提出独立 FSU 实现带来的上游维护风险；本次停在未保存策略的边界，原 FSU/patch/生产资产不变。见 [FSU 当前状态](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

2026-09-17 FSU 后续：独立 Preview 完成策略/锁卡 UI、bridge 冷启动、传统只读预览接线、EA 均价/FC27 FUT.GG 价格表与上游候选检查。真实 GM 安装、实际一键填阵和卡面价格未验收，FC26 生产输入未修改。详见 [FSU FC27 支持状态](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

2026-09-17：FC27 原生只读检查已取得 A Brace 槽位、账号作用域，以及 41/41 fresh Club 球员和两卡精确定向复核。partial 缓存与 provisional fresh 快照保持分离；真实 GM/完整保护策略、规划接线与 Live 未完成。自动化采集与五步状态见 [上线后适配记录](FC27_LIVE_ADAPTATION_ZH.md)。本次只读工具/隔离核心不接入 FC26 生产入口。

FC27 上线前收尾与上线后阶段门禁见 [接续清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)。离线通过不关闭实机 Pending 项。

2026-09-15：新增 [Android Companion APK 备用方案](ANDROID_COMPANION_APK_FALLBACK_ZH.md)，仅记录 FC26 静态检查与后续验证计划。默认不启用，不表示 Android 适配、重打包或 FC27 SBC 已实现。

FC27 上线前独立准备已开始，范围及逐项验证见 [FC27 实施记录](FC27_PRELAUNCH_PROGRESS_ZH.md)。新 Preview/FSU core 使用独立依赖白名单，当前不替换 FC26 生产入口；本文件的 M0-M9 历史状态不表示 FC27 实机兼容。

当前开发修正（2026-09-06）：`error1.txt` 的 17:51 重启已经清空上一轮 consumed 缓存，Unassigned 为 0；实际主阵最低仍为 `87/84`，超过 `+1` 上限，普通 Provisions 仅有三张合规 87–88 材料且没有现成奖励包，最终 `RECOVERY_MATERIAL_SHORTAGE` 属于真实资源不足后的安全停止，不能归因于未领取 Pick 或一概归因于缓存。三阵评分预测此前没有检查补给材料本身能否延续：现在主阵提交前额外用同一不可变快照和 requirements selector 检查提交前后的一组安全 Provisions；从可行变为不足时返回 `PROVISIONS_LAST_BATCH_AT_RISK`，优先开已有补给包，否则按原容量策略制作并立即处理 Provisions，重新对账/选材。该预检不授权新的特殊卡例外、不提高配置评分上限；每主周期仍只允许一次有界 Provisions 预检，不能用未来随机开包结果保证无限 Rolling。已经不足四张的库存不能靠更新脚本恢复材料。

同期 Pick 修正：Storage Sink 包装层现在传递调用方的 `forceFresh`，确实失效 Purchased/Unassigned 缓存后检查精确奖励身份。最终 Challenge 已确认提交但可重复 Set 状态已重置时，仍执行有界、精确匹配的 Pick 检查，不再在观察奖励前提前返回；未匹配奖励不猜测领取，已完成 Storage 消耗不重做。新增测试覆盖缓存延迟、Set 重置后的 selected/missing/blocked、最后一组材料预警与保护排除；真实 Web App 仍需验证这两条恢复链。恢复缺料日志同时输出 selected/required，避免把 `1x` 缺口误读为完整配方。

当前开发修正：Rolling 的三阵 runway 预测本身会在第三阵超过目标 `+1` 时提前触发 Provisions；重复点击 Start 后恢复仍可能失败，是因为全局 `consumedItemIds` 和其派生的待清理 duplicate signal 跨顶层运行保留，令新 Inventory Ledger 把当前 Club/Storage 卡误标为 `consumed-this-run`，随后恢复保护投影又把这些卡转成 `protected-id`。现在每次新的顶层 Loop 启动都会清空这两项仅属于上一轮提交事务的内存身份缓存，再执行 preflight 和 Inventory 初始化；持久化的 duplicate materialization、pending primary reward、pending Required Special reward journal 以及尚待物化的临时 TOTW/recent reward 证据均保留，评分、Required Special、FSU/Lock/Evolution/Active Squad 和显式 protected id 保护不变。若三阵预警触发但当前 Provisions 没有安全候选，当前已完成全部验证且仍在 `+1` 上限内的主阵允许提交一次，之后必须重新开包、对账并预测；这不放宽下一阵的当前评分门槛，下一阵实际超限或缺 Required Special 仍立即停止。

当前开发修正：Rolling 在每套已验证主阵提交前，从不可变 Inventory Ledger snapshot 精确扣除该阵的 item/signal，复用当前 Challenge 的 Required Special matcher、唯一 definition、FSU/Lock/Evolution/Active Squad 和评分 Selection Policy 预演下一阵。只有下一阵最低合法评分明确超过目标 `+1` 时，才在当前阵尚未提交前优先打开已有 Provisions 奖励，否则制作至多一批 Provisions 并重新读取库存；无法组成安全 Provisions 阵时记录 `PROVISIONS_PREFLIGHT_SHORTAGE`，只提交当前已验证合法阵容一次，避免循环恢复或放宽保护。该预测仅在 `rollingProvisionsShortageRecoveryEnabled` 显式开启时运行，不恢复默认关闭的 surplus crafting。

当前开发修正：EA 后台 SBC 提交返回空 `status:0` / `UTServerErrorVO code:0` 时，不再直接按 `unknown` 停止，也不盲目重发。Runner 等待 3 秒后强制刷新 My Packs 与 Unassigned，从新的 Challenge list 读取同一 Challenge，并重新对账 Rolling Inventory Ledger；仅当 Challenge/Set identity 与完成次数未变、没有新增或减少 Pack、全部精确提交 item 仍留在原 pile，且整套提交 validator 重新通过时允许重试一次。任一证据变化、刷新失败、Challenge 已切换或第二次仍为 status 0 都停止，不发送额外提交。

本文档用于追踪 FC Automation Tool 从单文件、流程型实现迁移到可测试、可组合架构的全过程。

当前基线：

- Userscript 版本：`0.8.64`
- Git 基线：`main` Rolling runway preflight + evidence-gated ambiguous background-submit retry
- 运行产物：`FCAutomationTool.user.js`
- 配置：内置 `LOOP_DEFS` 和 `FCAutomationTool.loops.json`

本文档是重构工作的状态来源。实施过程中应更新里程碑状态、验收记录和发现的问题，不在聊天记录或临时日志中维护另一套进度。

当前开发修正：动态 Upgrade 扫描只发布一个 Rolling 入口。无限 86x10 优先于 85x10；
限次 86x10 在剩余次数可确认且存在无限 85x10 时生成单个 `86 -> 85` 复合 Loop，
86 确认耗尽并处理完精确待开奖励后切换；86 已耗尽时只生成 85x10 Rolling。
85x10 限次、次数未知、候选重复或 Set/Challenge/Pack 身份不完整时不生成 Rolling，
10x84+ 等其它 Upgrade 继续保留 generic Loop。运行时每轮重读 Set repeatability，并用绑定
Loop、阶段、Set、Challenge 集合、实际 Challenge、Pack 和时间戳的 pending reward journal
阻止延迟奖励导致提前切换。Node release gate 当前覆盖 202 个测试文件、1908 项测试；
真实 EA Web App 仍需分别验证 86 无限、86 限次切 85、86 已耗尽三种会话状态。

当前开发修正：Rolling 后台提交不再把所有 `409 itemViolations` 当作 Active Squad。
warning 解析保留 name 与 item IDs 的逐条关系；只有 `ACTIVE_SQUAD` 进入既有替换/人工确认，
`Evo` 在重新读取同一 saved squad、重跑全部提交 validator，并确认精确 warning item 是
非 Evolution 的 Storage 实体后，才允许一次 `skipValidation:true`。同 definition 的 Club EVO
只进入有界诊断，不会替换或污染 Storage 身份；实际 EVO、实体/阵容变化及 Active Squad
保护开启时的未知 warning 均停止。Node fixture 覆盖 90 Ronaldo Storage 基础卡与 Club EVO
副本共存、真实 Storage EVO、混合 Active Squad/Evo warning 和一次性确认预算；真实页面仍需
验证该 Ronaldo Provisions 提交及强制确认失败后的停止行为。

当前开发修正：Rolling 评分超目标且准备执行 shortage Provisions 时，Storage pressure
前置判断与 Provisions 恢复统一使用完整材料批次的容量预留。此前 `97/100` Storage 会先按
最终 Pick 的一格预留判为“无压力”，随后又按四格 Provisions 批次预留进入 emergency
模式，最终因恢复阵未消费 Storage 卡以 `MINIMUM_PILE_COUNT_SHORTAGE` 停止。现在该状态会
先运行用户已启用的 Storage Sink，重新对账取得四格容量后再制作并打开 Provisions；关闭
shortage recovery 时仍只保留原有的一格最终 Pick 预留，不会为无后续用途主动运行 Sink。

当前开发修正：Rolling 的 Storage 压力缓解改为三个互斥策略：
`storage-pressure-only` 只执行用户启用并绑定的 Storage Pressure SBC；
`provisions-only` 只执行紧急 Provisions；`provisions-then-storage-pressure` 在同一连续压力
事件中最多先执行一次 Provisions，重新读取库存后压力仍存在才执行 Storage Pressure。
默认值为 `storage-pressure-only`；旧 `storage-pressure` 迁移到该默认值，旧 `provisions`
迁移到混合策略。不同压力来源独立记账，Storage 路由恢复或主阵重新可规划后立即清除事件
状态；Provisions 硬失败不绕过到 Storage Pressure。待存 Unassigned duplicate signal、
Storage 净消费、FSU/Lock/Evolution/Active Squad、Automatic-use 与提交前身份保护均不变。

当前开发修正：Selection Policy 新增默认关闭的
`rollingStoragePressureClubBoostersEnabled`。启用后，动态 Storage Pressure 阵容在仍需
净消耗真实 Storage 卡时，可突破通用的三张 Club filler 上限，使用普通 Club 金卡
`87` 至当前 Provisions reserve 上限补评分；Club 数量受阵容剩余位置和本次要求释放的
Storage 数量共同约束。特殊卡不因该开关获得授权，FSU 过滤、Lock、Evolution、
Active Squad、Automatic-use protection 和提交前验证继续生效；既有 95+ Pick 的
89/88 专用流程与三张 Club fallback 合同不变。

当前开发修正：Selection Policy 新增默认关闭的
`rollingAllowClubCurrentPoolSpecialsForProvisions`。普通 Provisions shortage 在普通材料
无法成阵后，可把当前 primary live matcher 精确批准、评分位于配置 `87-91` 范围内的
Club non-TOTW special 作为最后候选。授权绑定稳定 item ID，不扩展到同 definition、
duplicate-reserve、Storage pressure、maintenance、其它恢复 SBC 或主阵；
`rollingProtectAllClubNonTotwSpecials` 优先覆盖，FSU Lock、Evolution、Active Squad、
Protection rating 和其它提交门禁保持不变。

当前开发修正：Rolling 普通 Provisions 与 Required Special/TOTW 恢复默认恢复为
`Unassigned -> Storage -> Transfer -> Club`；Selection Policy 提供可选的
Storage-first 顺序。待处理 Unassigned 重复卡仍强制 Unassigned-first，Storage
pressure 与 maintenance 仍使用专用 Storage-first 及净释放校验。Provisions reserve
上限可选 `88/89/90/91`，默认 `88`，已有较高保存值继续有效。该修正取代下方
`0.8.20` 发布记录中的全局 Storage-first 和新安装默认 `91` 行为。

`0.8.64` 发布记录：Rolling 会在当前合法主阵提交前预演下一阵，并在明确缺少低分材料时先尝试复用或制作一批 Provisions；若安全 Provisions 阵不可用，则保留当前阵并只提交一次。后台提交遇到无 HTTP/业务错误信息的 `status:0` 时，只有新的 Challenge list、完成次数、Pack inventory、精确 item pile 与 Rolling Ledger 共同确认服务器没有变化，才重试同一阵一次；其余状态继续 fail closed。

当前开发修正：Rolling 主阵提交前的低分材料 runway 从单阵扩展为连续三阵预测。
预测从当前不可变 Inventory snapshot 扣除已验证的当前阵，再逐阵重新构造候选、求解并
扣除精确 item/duplicate signal；不猜测尚未打开的主包内容。主包、Provisions 奖励或其它
已确认库存变更完成对账后，旧预测立即失效并基于新 snapshot 重算。任一预测阵最低评分
超过目标 `+1` 时提前规划 Provisions；没有现成奖励且无法组成安全 Provisions 阵，或一次
有界 Provisions 恢复后仍无法恢复三阵 runway 时，记录 `RECOVERY_MATERIAL_SHORTAGE` 或
`PROVISIONS_PREFLIGHT_RUNWAY_EXHAUSTED`，但只允许提交当前已验证且仍在 `+1` 上限内的主阵一次；
主奖励和库存对账后必须重新预测，下一阵实际超限时仍停止。

`0.8.48` 发布记录：Rolling 主阵评分求解结果高于 EA 目标评分时，只保留规划结果，
不再先清空、保存或改写当前 EA 阵容。当前主阵只有在 Storage 容量已知、无待释放
Storage 压力且最低可行评分不超过目标 `+1` 时，才允许显式兜底保存（例如 84 阵的
85/84）；目标 `+2` 及以上必须保持未保存，并在开启 Provisions shortage recovery 时
进入 Provisions 规划；该恢复开关关闭则安全停止，避免用 87/88 高分卡把低分主阵长期
顶高。若此时 SBC Storage 剩余空间不足以容纳 Provisions
奖励，则把本次缺料恢复升级为 Storage-first 紧急 Provisions：按当前容量计算本次事件
所需释放总量，每个 Provisions 批次至少消耗 1 张真实 Storage 卡；提交并重新读取库存
后，再继续规划剩余释放量，直到奖励空间完整恢复。该增量例外只适用于评分超目标的
恢复路径，普通 Storage Pressure 仍必须一次满足全部待入库容量。Provisions 只额外授权
当前 Challenge 的 live group-83
matcher 精确命中的 Storage 色卡；FSU lock、Evolution、高于 Automatic-use 上限、
待入库 duplicate signal 和 Club 非 TOTW 色卡继续硬保护。运行时捕获的 Provisions
capability 尚未解析时，会先执行一次有界实时扫描再决定是否停止。

`0.8.47` 发布记录：Required Special 继续使用 EA Challenge 的 live
`PLAYER_RARITY_GROUP=83` matcher 和原始最低数量，但 Rolling 主阵可在现有来源限制与
保护规则内使用多张该 matcher 命中的当前卡池色卡；既有 Required Special/TOTW 与
Provisions 奖励会在再次制作恢复 SBC 前优先复用。

`0.8.46` 发布记录：将远程 Manual Player Pick FUTBIN 候选链接和本地 Rolling Recap
卡版本保护合并为同一份可更新 userscript，并同步生成 root/dist 产物。Runner 版本、
CHANGELOG、里程碑和 Tampermonkey 元数据统一为 `0.8.46`。


`0.8.45` 发布记录：Rolling Recap 的 Player Pick 临时卡不再按 `definitionId` 盲目回查
Club 实体；只有评分、稀有度、Evolution、upgrades 和 cosmetics 状态一致时才允许库存
实体补全。找不到同版本实体时保留原始 Player Pick 卡，避免同 definition 的 EVO 卡覆盖
真实 Pick 评分。新增 95 Lukaku 与 98 EVO Lukaku 回归测试；完整 release gate 已通过。

`0.8.45` 发布记录：Manual Player Pick review 使用既有 FSU/FUTBIN 精确 ID 解析与缓存，
将可解析候选人的名字显示为 FUTBIN 直达链接；新标签页打开链接不会同时选中候选卡，
无法可靠解析 ID 时继续显示普通文本，不生成名称搜索链接。


`0.8.44` 发布记录：FUT.GG 价格请求支持可选 HTTPS forwarding proxy；Auto 价格源在
FUT.GG 返回 403、Cloudflare 或 forbidden 错误后进入会话级熔断并回退 FUTNext，
成功请求后恢复。Trade Scheduler Provider 面板显示代理来源和熔断状态，Player Pick
与特殊卡 recap 共用同一价格 Provider、缓存和恢复逻辑。

`0.8.43` 发布记录：持久化的 Required Special/TOTW 奖励 journal 在奖励包不可见、
Storage/Club 没有可用 Requirement Special、且 Inventory Ledger 实时核对成功时，
超过 24 小时后自动过期并从当前库存重新规划。24 小时内或库存核对失败时继续
fail closed；受保护材料仍不计为可用材料且不会被消费。过期本身不提交 SBC，新恢复
仍受用户 Settings 和全部提交保护约束。

`0.8.32` 开发记录：持久 duplicate materialization journal 只用于新启动时恢复
原 Club item ID 的安全不变量，不再用于续跑上一次提交。启动按每个 protected ID
独立分类 Club、Unassigned、Storage、Transfer、missing 和异常状态，只将精确位于
Unassigned 的 live EA 实体恢复到 Club；其它可信位置保留，missing 记录告警，损坏
journal 直接删除。清理完成后从当前库存重新规划。当前运行内的交换、提交和补偿
仍保持严格 fail-closed，不因启动语义改变而放宽。

`0.8.33` 开发记录：`rollingDuplicateSwapEnabled` 作为实验开关加入 Selection Policy，
默认和旧配置迁移均关闭。关闭时所有新 Unassigned duplicate 先整体路由 Storage；
容量不足以 `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED` 停止，提交前遗漏则以
`DUPLICATE_SWAP_DISABLED` 停止，均不执行 EA 原生交换、不写新 journal、不提交 SBC。
已有 journal 的启动取消不受开关影响，仍先恢复或分类精确 protected Club ID。

`0.8.34` 开发记录：关闭实验交换后，Storage 容量不足不再无条件立即停止。
`DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED` 接入原有 Storage-pressure recovery：先尝试
紧急 Provisions，再使用用户已启用并选定的 Storage pressure SBC；恢复阵必须净消费
足够的真实 Storage 卡，待存 Unassigned duplicate 全程保护，容量确认后才重试整体
Storage 路由。当前事务的同 Challenge 重规划只接受 journal 记录的精确 B -> A' 反向
signal 映射并作为 no-op 提交桥，禁止第二次 EA move；补偿恢复以 Repository pile 位置
为权威，EA 实体滞后的 pile scalar 不再覆盖精确位置证据。

`0.8.35` 开发记录：修复紧急 Provisions 对待存 Reserve 重复卡的授权泄漏。实验交换
关闭时，`openRouting.storageItems` 中全部 Unassigned signal 都保持硬保护，不再因为
评分属于 Provisions Reserve 而被解除；提交前 validator 还会独立检查 selection signal，
防止候选保护回归后解析并提交其 Club counterpart。安全 Provisions 不可行时仍返回
unavailable，让 Workflow 继续尝试已配置的 Storage pressure SBC，并只以真实 Storage
净消耗换取容量。

`0.8.22` 发布记录：Manual Player Pick 的候选卡不再把姓名、评分、卡色、重复
状态和价格拼为一段文本。名字与属性各占一行，价格为右侧独立列，长文本截断时
保留 hover 全文；选择数量、候选排序和手动确认规则保持不变。

`0.8.21` 发布记录：共享 Recap 卡片行将球员名设为优先弹性列；来源包名和
属性标签会在宽度不足时优先截断，并分别保留完整 hover 文本。Batch Open、普通
Loop、Player Pick 和 Rolling Recap 复用同一组件，因此行为一致，未改变奖励、
选卡或提交路径。

`0.8.20` 发布记录：Rolling 的 Provisions 与正常 Required Special/TOTW
恢复统一改为从合格 SBC Storage 开始选材，再依次查看 Unassigned、Transfer 和
Club，以便回收也能释放 Storage 压力。由于“消耗待处理 Unassigned 重复卡”是专门
为释放该重复信号设计的路径，它仍然保持 Unassigned-first。Provisions 可配置材料
上限扩展为 `87-91`（新安装默认 `91`，已有本地设置保持原值）；FSU 锁定、筛选、
进化卡、Required Special/TOTW 和超过用户设定上限的卡仍不参与恢复选材。

`0.6.0` 发布记录：将完整 Workflow/Loop JSON 能力迁移为可视化 Builder，支持 Profile、Draft/Saved/Active 生命周期、内置 Override/Duplicate、Workflow Step Variant、Recovery 编辑、Dynamic Pick 绑定、Preview 和 JSON 兼容验证；修正新扫描 Pick 未进入 Dynamic Picks 页的问题，并增加中文图示操作指南。运行时继续使用既有配置校验、strategy dispatch 和安全事务边界。

`0.6.15` 发布记录：将 Dry Run 的安全边界下沉到共享事务。`openPackTransaction()` 在 Dry Run 仅查询并返回 planned receipt；`resolveUnassigned()` 仅返回路由计划且不执行移动或 overflow recovery；`submitSbcAttempt()` 保留保存前校验但不准备运行时访问、不保存、不重载、不提交。入口层将当前 Loop 的 Dry Run 状态传入开包和 Unassigned 路径，避免仅依赖各 Workflow 的分支约定。

`0.6.16` 发布记录：共享 recap model 为每张球员卡生成 FUTBIN 名称搜索链接，Player Pick、Batch Open 与普通 Loop recap 都在 `price:` 后显示新标签 `FUTBIN` 链接。已有的显式 recap URL 保持优先；Runner 没有 FUTBIN 专属 card ID，因此明确使用球员名搜索，不伪造特殊卡详情页。链接采用 `noopener noreferrer`。

`0.6.17` 发布记录：主面板的四个帮助入口统一紧贴所属标题；标题栏的 `?` 从右侧 `Options / L` 操作组移至 `Loop Runner` 标题后，Run options、Config 和 Log 的 `?` 也统一收紧为 18px 圆形按钮。帮助 topic、事件 ID 和弹窗内容保持不变。

`0.6.18` 发布记录：recap 的 FUTBIN 链接改为只使用 FSU 已确认的 `definitionId -> FUTBIN card ID` 映射，直接打开 `https://www.futbin.com/26/player/<id>/1`。不再用球员名称搜索，也不把 EA `definitionId` 当作 FUTBIN ID；映射缺失时不显示链接，避免同名或错误版本误跳转。

`0.6.19` 发布记录：特殊卡 recap 在 FSU 已确认映射缺失时，使用原始 EA 卡片的赛季、平台、国家、联赛、俱乐部、评分和位置查询 FUTBIN 筛选接口，并且只接受返回项 `resource_id` 与 EA `definitionId` 完全一致的 FUTBIN card ID。确认结果按赛季/平台/EA definition ID 缓存到 Runner 本地；查询失败、元数据不完整或无精确结果时继续隐藏链接，不会退回姓名搜索或跳转同名普卡。Player Pick、普通 Loop 和 Batch Open recap 均覆盖。

`0.6.20` 发布记录：精确 FUTBIN card ID 解析从“特殊卡缺失映射”扩大到所有 recap 球员卡。Runner 仍然优先使用 FSU 已确认映射；其余卡片按相同原始 EA 元数据查询，并且只有 `resource_id === definitionId` 时才缓存和显示直达链接。相同 definition ID 在单次 recap 只查询一次，后续 recap 直接读取缓存。

`0.6.21` 发布记录：缺失 FUTBIN 查询元数据的已开包卡不再中断 recap。空或不完整的查询上下文会安全降级为“该卡不显示链接”，其余卡照常解析、缓存和展示；Batch Open、普通 Loop 与 Player Pick 的 recap 继续显示。

`0.6.22` 发布记录：Loop Builder 或旧 Profile 将未填写的可选奖励包别名保存为 `[]` 时，Runner 将其视为未配置，不再阻止 Loop 启动；必填的 SBC 名称、步骤和材料列表仍保持非空校验。

`0.6.24` 发布记录：来源包查找不再以单次 `Store.getPacks` 结果判定耗尽，而是执行有限重试，并在缓存仍为空时进入 Store Packs 强制刷新后再次匹配；最终确认耗尽时记录期望 ID、名称和当前 My Packs 快照。Daily Rare 的 `11x Gold Players Pack` 当前已确认 ID 为 `20060`，其产出的 `5x Max 78 Rare Gold Players Pack` 当前已确认 ID 为 `20059`；ID 不存在时仍回退名称别名。缺料开包和 Rare Pack to 2x84+ 阶段均使用相同恢复路径，避免 SBC 奖励延迟可见时少开或完全跳过来源包。

`0.6.25` 发布记录：新增会话级 Pack Catalog。启动 Dynamic SBC 扫描完成后，Runner 对当前全部 SBC Set 建立轻量 PACK reward 索引，同时刷新 My Packs 的实时 ID、名称和数量；该步骤不扩大 Challenge 读取范围。Loop 新增 `sourcePackRef.rewardOfLoopId`，来源包按动态 Reward ID、动态 Reward 名称、静态兼容 ID、静态兼容名称依次解析。Daily Rare、Daily Rare MVP、对应 shortage source 和 Daily Rare Pack to 2x84+ 已迁移到动态引用，`20060/20059` 继续作为兼容 fallback。Builder 提供 Source reward Loop 下拉框，并在重命名、删除和 schema 校验中维护引用。SBC 实际提交后观测到的 Reward Pack ID 会补充当前会话 Catalog；实时 My Packs 数量不持久化，原有限次重试和 Store Packs 页面恢复保持不变。

`0.6.30` 发布记录：将内置 Daily、基础 Upgrade、Common Gold crafting、2x84、TOTW 和高评分 x10 的当前 SBC Set/Challenge/Reward identity 迁移为会话级动态绑定，并覆盖直接 Loop、嵌套 stage、自动恢复与 Recovery recipe。Provision 前置 Pick 改用 common-gold 语义 selector；运行时按扫描结果优先、静态名称/ID 兼容 fallback 的顺序查找 SBC。动态扫描仍只替换 EA 实时事实，保留既有 Workflow 顺序、选材、保护、库存来源、回退和运行次数策略；歧义 family 匹配会拒绝自动绑定。Builder、schema、诊断、文档和自动化测试同步覆盖该迁移。

`0.6.23` 发布记录：recap 解析 FUTBIN 精确 card ID 前，会先用当前库存中相同实例 ID（再回退相同 definition ID）的完整 EA 球员实体补齐开包回执。这样可复用 FSU 已确认映射，或在其映射尚未写入时使用完整元数据作精确查询；仍只接受 `resource_id === definitionId`，不回退球员名称搜索，也不改动开包、发卡、SBC 或 Unassigned 流程。

## 1. 重构目标

重构完成后，业务依赖必须保持单向：

```text
Loop configuration
        |
        v
Workflow orchestration
        |
        v
Pack / Unassigned / Selection / SBC / Reward services
        |
        v
EA / FSU / DOM adapters
```

目标模块：

| 模块 | 职责 | 禁止事项 |
| --- | --- | --- |
| `config` | 配置加载、规范化、校验、默认值 | 不读取 EA Repository，不执行 Loop |
| `domain` | Item、Pile、Requirement、Plan、Result 等数据契约 | 不访问 DOM、EA、FSU 或全局状态 |
| `selection` | 普通条件选材和评分 SBC 求解 | 不打开 Challenge，不保存或提交阵容 |
| `unassigned` | Unassigned 规划、路由和容量恢复 | 不内置 Bronze、Provision 等 Loop 名称 |
| `pack` | 查包、开包事务、响应物品标准化和路由 | 不决定某个 Daily Loop 的后续步骤 |
| `sbc` | Challenge 读取、阵容保存、复核和提交事务 | 不决定材料来源或是否应开包补料 |
| `reward` | Reward Pack、Player Pick 领取和结果处理 | 不自行提交上游 SBC |
| `workflows` | 组合底层能力，实现各类 Loop 状态机 | 不直接调用 EA Service、Repository 或 DOM |
| `adapters` | EA、FSU、DOM、Tampermonkey、存储接口 | 不包含 Loop 业务策略 |
| `ui` | 面板、选项、日志和 recap | 不实现库存、选材或 SBC 规则 |

## 2. 统一公共入口

重构后的四个关键公共入口如下。公共入口唯一不等于内部只能有一个大函数；每个入口内部仍由纯规划器和副作用执行器组成。

### 2.1 开包

```js
openPackTransaction({
  packSelector,
  preOpenResolver,
  openedItemPolicy,
  retryPolicy,
  rewardMetadataPolicy,
})
```

统一流程：

```text
处理已有 Unassigned
-> 刷新并查找包
-> 检查是否允许开包
-> 调用 EA 开包
-> 标准化响应物品
-> 合并响应和 Unassigned 缓存
-> 按策略保留或路由物品
-> 刷新缓存
-> 返回 OpenPackReceipt
```

允许的策略差异：

- Daily Bronze/Silver 保留目标等级重复卡。
- Daily Common shortage pack 保留当前阵容可消费材料。
- Provision 保留 Pick 和 crafting stages 可消费材料。
- Rare Pack 保留低分稀有金，高分卡走安全路由。
- TOTW 奖励允许补充 assumed TOTW 元数据。
- Player Pick 不是 Pack，不进入本事务。

除 Pack Adapter 外，代码中禁止直接调用 `pack.open()`。

### 2.2 Unassigned

```js
resolveUnassigned({
  reserveItem,
  routingPolicy,
  overflowResolvers,
  stopPolicy,
})
```

统一流程：

```text
读取快照
-> 分类物品
-> 规划 Club / Transfer / Swap / Storage
-> 执行当前可完成的动作
-> 容量不足时依次调用 overflowResolvers
-> 刷新并验证是否取得进展
-> 清空、保留或安全停止
```

`overflowResolvers` 是有序回调，不在 Unassigned 模块中写死具体 SBC。例如 Bronze overflow 可以配置：

```text
可用的单卡 Bronze SBC
-> Daily Common Gold，仅使用现有材料且禁止开包
-> 可用的 11 铜卡 SBC
```

每个 Resolver 返回：

```js
{
  status: 'progress' | 'unavailable' | 'blocked',
  consumedItemIds: [],
  reason: null,
}
```

必须包含递归保护和进度指纹；Resolver 不能再次无限进入同一个 Unassigned 恢复链。

### 2.3 选材

```js
selectInventoryPlayers({
  inventorySnapshot,
  requirements,
  priorityPiles,
  protectionPolicy,
  fsuPolicy,
  consumedItemIds,
  mode,
})
```

该函数是纯函数，不读取全局 Repository。返回不可变的 `SelectionPlan`：

```js
{
  ok,
  entries,
  selected,
  missing,
  pileCounts,
  duplicateSignals,
  diagnostics,
}
```

`mode: 'requirements'` 处理数量、等级、稀有度和卡种要求；`mode: 'rating'` 调用共享评分求解器。两种模式共享输入输出契约，但不强行共用同一个求解算法。

旧的 `selectLoopInventoryPlayers()` 在配置规范化完成后删除。

### 2.4 SBC 提交

```js
submitSbcAttempt({
  sbcRef,
  challengeProvider,
  squadProvider,
  preSaveValidators,
  postSaveValidators,
  submitTransport,
  rewardPolicy,
})
```

统一流程：

```text
定位 SBC 和未完成 Challenge
-> squadProvider 产生 SquadPlan
-> 解析 Transfer / Unassigned duplicate signal
-> 保存前校验
-> 保存阵容
-> 重新读取实际保存阵容
-> 保存后校验
-> 检查 canSubmit / Submit 状态
-> 提交
-> 标记已消耗物品
-> 返回 SubmissionResult
```

支持的 `squadProvider`：

- `InventorySelectionProvider`
- `RatingSelectionProvider`
- `FsuFillProvider`
- `ExistingSquadProvider`

支持的 `submitTransport`：

- 页面标准提交。
- 评分 SBC 后台提交。

Player Pick 高分保护、动态 Challenge 条件和特殊卡校验通过 validator 注入，不复制提交事务。

### 2.5 Selection 与 Submission 边界

两者实现完全解耦，只通过数据契约连接：

```text
InventorySnapshot
-> selectInventoryPlayers()
-> SelectionPlan
-> resolveSelectionPlan()
-> submitSbcAttempt()
-> SubmissionResult
```

- Selection 不访问页面、不保存 Challenge、不提交 SBC。
- Submission 不重新决定选材优先级。
- Submission 可以因为 EA 实际保存结果不同而拒绝提交，但不能静默替换成另一套材料。

## 3. 实施原则

1. 禁止一次性 Big Bang 重写；每个 Milestone 必须可独立发布和回退。
2. 先添加 characterization tests 锁定当前正确行为，再迁移实现。
3. 新旧实现并存时，通过 feature flag 或 shadow plan 对比，不允许同时执行副作用。
4. 每次只迁移一类 Workflow；未迁移 Loop 继续走旧路径。
5. 共享接口发生变化时，必须运行所有 Loop 的测试矩阵。
6. 不把 Provision、Daily Common 等专属规则写进通用底层模块。
7. 发现线上 Bug 时，先保存最小 fixture 并添加失败测试，再修正实现。
8. 不接受有冲突且未经行为审计的合并；远程更新后必须重新跑完整测试。
9. 构建产物必须可重复生成，禁止同时手工维护源码和打包产物中的同一逻辑。
10. 每个 Milestone 完成时更新本文档的状态、提交和验收记录。

## 4. 目标目录

```text
src/
  config/
  domain/
  selection/
  unassigned/
  pack/
  sbc/
  reward/
  workflows/
  adapters/
  ui/
  userscript-entry.js
tests/
  unit/
  workflows/
  contracts/
  architecture/
  fixtures/
scripts/
dist/
  FCAutomationTool.user.js
```

Tampermonkey 继续只安装单个 `dist/FCAutomationTool.user.js`。源码多文件通过 esbuild 打包，不依赖 Tampermonkey `@require`。

## 5. Milestone 总览

| Milestone | 目标 | 状态 | 依赖 |
| --- | --- | --- | --- |
| M0 | 基线、测试设施和行为快照 | Complete | 无 |
| M1 | 多文件源码与可重复 Userscript 构建 | Complete | M0 |
| M2 | Domain Contract、Snapshot 和 Adapter 边界 | Complete | M1 |
| M3 | 统一 Selection API | Complete | M2 |
| M4 | 统一 SBC Submission Transaction | Complete | M3 |
| M5 | 统一 Unassigned Resolver | Complete | M4 |
| M6 | 统一 Pack Transaction | Complete | M5 |
| M7 | 分批迁移全部 Workflow | Complete | M3-M6 |
| M8 | 删除旧路径、完整回归和正式切换 | Complete | M7 |
| M9 | 统一发现当前可用 Player Pick 与 Upgrade SBC | In Progress | M2-M8 |

状态只能使用：`Pending`、`In Progress`、`Blocked`、`Complete`。

## 6. Milestone 详细定义

### M0：基线与测试设施

目标：不改变线上行为，建立后续重构的安全网。

范围：

- 增加 `package.json`、Vitest、esbuild 和统一脚本。
- 建立 `tests/fixtures`，脱敏保存 Item、Pile、Pack、SBC Set、Challenge 和 FSU 设置样本。
- 为当前所有 Loop 建立行为清单和最小 fixture。
- 增加架构扫描，记录当前直接访问 `W`、Repository、DOM 和 EA Service 的位置。
- 增加当前单文件的语法、JSON 和配置一致性检查。

必测行为：

- Daily Bronze、Silver、Common、Rare。
- Daily Rare Pack to 2x84+。
- One-click Daily 的完成跳过、剩余次数和中途恢复。
- Player Pick 单阵、多阵、严格 common/rare 比例、保护阈值和人工选择阈值。
- Provision Pick 前置、FOF、2x84+ 和 partial challenge 恢复。
- 2x84+ Fodder、84+ TOTW、84x10 与自动补料。
- Dry Run 与 Live 产生相同计划但没有副作用。

验收标准：

- `npm test`、`npm run build`、`npm run lint:syntax` 可执行。
- 所有现有 Loop 至少有一个正常路径和一个停止/恢复路径测试。
- 构建前后 Userscript metadata、版本和运行入口保持一致。
- 线上脚本行为不变。

回滚条件：测试框架要求修改业务逻辑或无法在无浏览器环境运行纯测试。

### M1：源码拆分与构建

目标：把开发源码拆成模块，同时输出单个 Tampermonkey 文件。

范围：

- 建立 `src/userscript-entry.js`。
- 先迁移常量、日志、配置和无副作用工具函数。
- esbuild 生成 `dist/FCAutomationTool.user.js`。
- 保留当前热加载方式，但热加载目标切到构建产物。
- 增加构建产物一致性检查，避免忘记重新构建。

验收标准：

- 构建产物可在 Tampermonkey 和热加载流程中运行。
- 构建前后 UI、Loop 列表和日志初始化一致。
- 不引入运行时模块加载或本地服务硬依赖。

回滚条件：打包改变 `unsafeWindow`、GM API、userscript metadata 或执行时机。

### M2：Domain Contract、Snapshot 和 Adapter

目标：业务代码不再直接依赖 EA 模型对象。

范围：

- 定义 `InventorySnapshot`、`ItemRef`、`Requirement`、`SelectionPlan`、`SquadPlan`、`SubmissionResult`、`OpenPackReceipt`。
- 建立 EA Repository、SBC Service、Pack、DOM、FSU、Storage Adapter。
- Adapter 把 EA 对象转换成稳定快照；需要执行操作时用稳定引用回查实时对象。
- 建立 Fake Adapter 和 contract tests。

验收标准：

- 新模块中只有 `adapters` 可以访问 `W`、EA Service、Repository 和 Controller。
- Snapshot 可序列化为 fixture。
- 同一个 fixture 在 Node 测试和浏览器 shadow mode 中产生一致分类结果。

回滚条件：快照丢失 duplicateId、definitionId、交易状态、特殊卡或 Challenge 动态要求等必要信息。

### M3：统一 Selection API

目标：所有库存型和评分型 SBC 使用同一个 Selection Contract。

范围：

- 把当前 `selectInventoryPlayers()` 改为纯函数。
- 配置加载阶段完成 loopDef/requirement 规范化。
- 将评分求解器接入 `mode: 'rating'`。
- 输出统一 diagnostics 和 duplicate signal 信息。
- shadow 对比旧 `selectInventoryPlayers()`、`selectLoopInventoryPlayers()` 与新结果。
- 迁移完成后删除 `selectLoopInventoryPlayers()`。

验收标准：

- 所有当前 Loop fixture 的选卡结果满足现有保护规则。
- 82+、特殊卡、FSU Lock、Only Untradeable、联赛、Evolution 和 Golden Player Range 测试通过。
- 同 definition 不重复、已消耗物品不重选、Transfer/Unassigned signal 正确解析。
- 评分求解器性能测试不低于当前 `0.4.43` 基线。

回滚条件：新旧选择不一致且无法由明确的 Bug 修复或规则变更解释。

### M4：统一 SBC Submission Transaction

目标：所有库存、评分和 FSU 阵容通过同一提交事务执行。

范围：

- 实现 `submitSbcAttempt()`。
- 提供 Inventory、Rating、FSU 和 Existing Squad Provider。
- 提供标准页面和后台评分提交 Transport。
- 统一保存前、保存后和最终提交前校验。
- 统一 consumed item 标记、Challenge 完成检测和 Reward result。
- 先迁移低风险单次 `2x84+ Fodder`，再迁移 Player Pick 子阵和评分 SBC。

验收标准：

- `prepareInventorySelection()` 和 `saveChallengeSquad()` 的能力被事务内部复用，不再由 Workflow 拼装。
- 保存后实际阵容变化会被检测并停止。
- Player Pick 保护、动态评分条件和特殊卡要求仍作为独立 validator 生效。
- Dry Run 复用相同 SquadPlan 和 validator，但不保存和提交。

回滚条件：任何 Loop 出现未校验提交、重复提交、错误 Challenge 或奖励丢失。

### M5：统一 Unassigned Resolver

目标：删除 Loop 专属清理器，统一处理容量、保留和恢复。

范围：

- 实现纯 `planUnassignedActions()`。
- 实现有副作用的 `resolveUnassigned()`。
- 将 `reserveItem`、routing policy 和 ordered overflow resolvers 参数化。
- 实现进度指纹、最大迭代次数、递归保护和结构化停止原因。
- 建立按卡种匹配的顶层 `recoveryRecipes` / `unassignedRecoveryPolicies` 配置；默认覆盖铜、银、普金和稀有金。
- 删除 `clearMixedUpgradeUnassigned()`；迁移完成后删除旧 `clearUnassigned()`。

关键场景：

- Transfer 满、Storage 未满。
- Storage 满、Transfer 未满。
- 两者都满。
- 可交易重复、不可交易重复、可 Swap 重复混合。
- Daily Bronze/Silver 已完成但存在目标重复卡。
- Bronze/Silver overflow 按配置尝试单卡 SBC、Daily Common、11 卡 SBC。
- Resolver 无进展时安全停止，不得死循环。
- 恢复阵容必须消费至少一张当前 blocked Unassigned duplicate；FSU、锁卡、特殊卡和 82+ 保护不得绕过。

验收标准：

- Unassigned 模块中没有任何具体 Loop 或 SBC 名称。
- 当前失败日志中的 Storage `3/8` 场景可恢复或给出明确 blocked result。
- 重启 One-click Daily 能从已有 Unassigned 状态继续。

回滚条件：Resolver 会递归、重复消费、误搬保留材料或继续开包扩大阻塞。

自动化进展：配置化恢复执行器、trigger-priority selection、recipe/policy 引用校验和 Storage `2/4` 铜卡回归测试已完成。真实 EA 页面仍需验证 Daily Bronze/Common 已完成时可回退到 11 卡 Bronze Upgrade，并在提交后由指纹变化继续 One-click。

### M6：统一 Pack Transaction

目标：所有普通 Pack 和 SBC Reward Pack 通过一个公共事务。

范围：

- 实现 `openPackTransaction()`。
- 合并查包、前置 Unassigned、开包重试、响应标准化、物品路由和缓存刷新。
- 将当前 `materializeOpenedPlayerRewards()`、`handleRecyclePackItems()`、`handleProvisionPackItems()`、`handleRarePackTo84Items()` 改为 policy 或 classifier。
- 保留 Player Pick 为独立 Reward 类型。
- 增加 404、471、500、stale pack、响应先于缓存、页面不可见 Unassigned 等 contract tests。

验收标准：

- 除 Adapter 外不存在直接 `pack.open()`。
- 每个 Pack Workflow 都能返回结构化 receipt，包括 opened items、reserved、routed、pending 和 retry 信息。
- 开第二包前必须依据 receipt 和当前容量重新决策。
- 页面 UI 未显示但响应中存在的重复卡不会丢失。

回滚条件：任何现有 Pack 类型无法通过统一事务表达，或统一事务吞掉未处理物品。

### M7：Workflow 分批迁移

目标：Loop 只负责编排和传参，不再实现底层能力。

迁移顺序：

| 子阶段 | Workflow | 状态 | 原因 |
| --- | --- | --- | --- |
| M7.1 | Daily Common / MVP | Complete | 自动化和 One-click Live 完成 |
| M7.2 | Daily Bronze / Silver / MVP | Complete | 自动化和 One-click Live 完成 |
| M7.3 | Daily Rare | Complete | 自动化和 One-click Live 完成 |
| M7.4 | Daily Rare Pack to 2x84+ | Complete | 多包、恢复和 transient signal Live 完成 |
| M7.5 | Player Pick | Complete | 独立/Provision Pick、价格 fallback 和 recap Live 完成 |
| M7.6 | Provision Crafting | Complete | 三轮、partial Pick、FOF 和 2x84+ Live 完成 |
| M7.7 | 84+ TOTW / 84x10 / 2x84+ | Complete | 动态评分、奖励和安全 Stop Live 完成 |
| M7.8 | One-click Daily | Complete | 完成阶段跳过、剩余次数和恢复 Live 完成 |
| M7.9 | Shared crafting / Bronze Validation cleanup | Complete | Provision 和 Bronze Validation 共享路径已复验；Rare Pack 已有多包/恢复 Live 与自动化覆盖，当前源包耗尽仅作为非阻塞补验 |

每个子阶段必须完成：

1. 将旧 Workflow fixture 作为 characterization tests。
2. 新 Workflow 先在 shadow mode 生成计划并与旧逻辑比较。
3. MVP/单次 Loop live 验证。
4. 完整 Loop live 验证。
5. 删除该 Workflow 内已经不再使用的重复底层代码。
6. 更新本文档和 README。

M7 完成后应删除或降级为声明式 Workflow 的旧函数：

- `runInventoryMixedUpgrade()`
- `runCommonGoldToRareUpgrade()`
- `submitReservedDuplicateUpgrade()`
- `runRarePackTo84Upgrade()`
- `runDailySingleCardRecycle()`
- `runProvisionPackCrafting()`

`runPlayerPickSbc()`、`runFillAndVerifySbc()`、`runDailyRoutine()` 可以保留高层 Workflow 名称，但内部只能调用公共服务。

验收标准：所有 Loop 测试矩阵通过，且 Workflow 层无 EA/FSU/DOM 直接访问。

### M8：清理、回归和正式切换

目标：删除旧路径并建立长期防回归门槛。

范围：

- 删除 feature flag、shadow compare 和旧实现。
- 删除重复 Dry Run 路径；Dry Run 使用同一 Planner，只禁用副作用 Executor。
- 全量更新 README、配置文档和函数索引。
- 增加 CI 和发布检查。
- 完成并记录受影响流程的真实页面验证。

验收标准：

- `npm test`
- `npm run test:contracts`
- `npm run test:architecture`
- `npm run build`
- `node --check dist/FCAutomationTool.user.js`
- JSON 配置解析和 built-in/external config 一致性检查
- `git diff --check`
- 所有 MVP、完整 Loop、暂停恢复和容量边界真实页面验证通过

正式切换条件：连续多次真实运行无旧路径回退需求，且远程合并后完整测试仍通过。

### M9：统一 Dynamic SBC 发现与增量缓存

Status: In Progress

目标：插件自动扫描当前 EA 会话中受支持的 Player Pick 与 Upgrade SBC，生成或覆盖临时 Loop，并通过逐 SBC 结构指纹减少重复 Challenge 加载。

范围：

- 从当前 `SBC.repository.sets` 和 Challenge 模型扫描未完成、奖励类型为 Player Pick 的 SBC。
- 动态读取 Set/Challenge id、剩余次数、Challenge 数量和 `eligibilityRequirements`。
- 将可识别的球员数量、金银铜等级、普通/稀有、评分上限和特殊卡条件转换为标准 `requirements` / `challengeRequirements`。
- 从 Set/Challenge reward metadata 提取 Player Pick 的稳定 item/resource 标识、显示名称、候选数和可选数量，避免使用宽泛名称误领其它 Pick。
- 将扫描结果作为只存在于当前会话的 discovered loop 合并到下拉列表，并与内置/外部 JSON loop 按 Set id 和奖励标识去重。
- 提供手动 Refresh；活动过期、Challenge 完成或 EA Repository 更新后移除失效入口。
- 不支持或无法完整解释的动态条件显示为不可运行并输出诊断，不得猜测材料比例或跳过 EA 条件。
- 每次扫描先刷新轻量 Set/Category 索引；逐个 SBC 比较 Set、Category、Challenge ID、奖励和时间指纹，仅重读新增、变化或 TTL 过期的 Challenge。
- EA Challenge 读取采用扫描级限流保护：`429` 立即打开本轮熔断并跳过后续网络请求，`426/512/521` 每个候选最多额外重试一次。只要当前 Set 索引已验证且核心身份与缓存兼容，Incremental 和 Full rescan 都可降级使用此前验证的 Challenge 快照；新建、真实变化或 Clear cache 后的对象保持 unavailable，不从名称或旧快照猜测。实际 Challenge/Challenge-squad 请求健康度按账号保存 24 小时，以指数平滑失败率选择 800-3000ms 最小间隔；扫描汇总输出请求数、失败率、错误码和下一轮建议间隔，连续健康扫描才逐步提速。
- 所有 EA 明确归入 `Upgrades` Category 的 Set 都进入逐 SBC 增量比较，但只有已实现保守 parser 的 family 可物化。84+ TOTW/高评分 xN 解析评分和特殊卡条件；基础 family 解析完整的单 Challenge、单 Pack reward 和球员质量/稀有度条件。
- 通过 `activityBinding` 将基础 family 的当前 Set/Challenge/Reward identity 注入已有直接 Loop、嵌套 stage、自动恢复和 Recovery recipe，不复制其 Workflow、安全策略或选材 policy。
- Provision 前置 Pick 使用语义 selector 匹配当前 Common Gold compatible Pick，不再把某一期 Set/Reward ID 当作内置业务身份。

验收标准：

- 单 Challenge 和多 Challenge Pick 都能生成正确的动态配置。
- 普金/稀有金比例、人数、评分与特殊卡要求和 EA 模型一致。
- 同时存在多个 84+ Player Pick 时能通过稳定奖励标识准确领取目标 Pick。
- 静态 Pick、外部 JSON Pick 和动态发现 Pick 不重复显示。
- Node fixture 覆盖已支持、条件不支持、奖励标识缺失、活动完成和 Repository 刷新场景。
- 动态发现只负责生成配置，实际选材、提交、价格查询、自动/人工选择和 recap 继续复用现有 `playerPickSbc` Workflow。
- 缓存只保存 Challenge 快照，不保存可运行授权；当前会话索引验证失败时动态绑定保持 unavailable。
- 同一 activity family 只允许唯一匹配；无匹配保留迁移期兼容 alias/ID，多匹配拒绝自动选择。扫描 Set ID 在运行时优先于名称 fallback。

回滚条件：无法稳定识别奖励 Pick、动态条件转换不完整，或扫描结果可能导致错误 SBC/奖励被提交或领取。

当前进度（2026-07-28）：

- `84x10`、`2x84+ Upgrade` 和 `84+ TOTW Upgrade` 已迁移为纯动态会话 Loop。扫描器直接把当前 Set、单 Challenge、Pack reward、人数、评分和特殊卡条件与 `src/config/upgrade-policies.js` 的通用安全策略组合，不再要求 `loops.js` / `FCAutomationTool.loops.json` 存在具体活动模板。Daily Rare 的 source-exhausted fallback 改为按 `2x84-upgrade` family 唯一解析；零匹配返回 unavailable，多匹配停止并输出候选。旧 Profile 中的 `2x84-fodder`、`auto-totw-upgrade`、`84x10-mvp`、`84x10` 仍可作为兼容模板被扫描覆盖，但新内置配置不再发布这些 ID。
- 其余 activity-bound built-in 暂不按同样方式删除。Daily Bronze/Silver/Common/Rare、Bronze/Silver/Gold Upgrade、5x80+ crafting 的静态定义承载的是工作流角色、库存路由、来源包、阶段顺序和 recovery policy，不只是当前 EA Set identity；这些对象已经动态覆盖 Set/Challenge/Reward 身份。要继续全动态化，需先引入按业务角色生成 Workflow/Stage 的模型，不能只删除模板。

- 开发快照完成第二阶段内置 SBC identity 迁移：新增 `src/config/activity-discovery.js`，支持 Daily Bronze/Silver/Common/Rare、Bronze/Silver/Gold、Common Gold crafting、2x84、TOTW 和高评分 x10 family；Daily/MVP、Inventory Exhaustion、Provision crafting、84x10 嵌套恢复和 9 个 Unassigned Recovery recipe 均声明 session-only binding。扫描只覆盖 EA 事实，旧名称/ID 暂时保留兼容 fallback。
- Dynamic 扫描候选扩展到全部 EA `Upgrades` Set，并继续使用现有逐 SBC 结构指纹缓存。评分型 parser 与基础 activity parser 分层运行，高评分 xN 的评分/特殊卡 metadata 与嵌套 TOTW/2x84 binding 可同时物化，不会互相覆盖。
- Provision 内置固定 Pick identity 已替换为 `preCraftPlayerPickSelector.material = "common-gold"`。零匹配跳过前置 stage，多匹配停止；旧 `preCraftPlayerPick` / `preCraftPlayerPickLoopId` 继续兼容外部配置。
- Builder、schema、内置/外部配置和结构化扫描日志已接入 activity family、嵌套 binding、Recovery binding 与 Provision selector。自动化测试覆盖基础 family 解析、歧义拒绝、策略字段与 requirement 顺序保留、x10 与嵌套恢复合并、消费者追踪、Set ID 优先级和 Builder 字段；完整 release gate 通过 96 个测试文件、607 个测试、214 个 JavaScript 文件语法检查、19 个 Loop、9 个 Recovery recipe、4 个 Recovery policy、3 个 Profile、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.25` 建立第一阶段动态 Pack Catalog：My Packs 实时库存与 SBC PACK reward 元数据汇总到独立纯模块，Daily 来源包改为 `sourcePackRef` 主解析和 ID/名称 fallback。下一阶段逐步迁移 Provision、Validation 和其它 `sourcePackIds/sourcePackNames`，再评估由 Reward 内容/材料语义生成 Pack 分类，避免把活动名称或 Pack ID 当作永久业务主键。完整 release gate 通过 94 个测试文件、587 个测试、210 个 JavaScript 文件语法检查、19 个 Loop 配置、3 个 Profile、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.24` 来源包耗尽判断增加三次有限刷新、一次 Store Packs 页面刷新兜底和最终 My Packs 诊断；Daily Rare 的 `#20060` 缺料包与 Rare Pack to 2x84+ 的 `#20059` 来源包同时使用当前已确认 ID 和名称 fallback。单元测试覆盖延迟到第二次刷新、仅在 Store 页面刷新后出现，以及真实耗尽三种路径。完整 release gate 通过 93 个测试文件、580 个测试、208 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.23` recap FUTBIN 精确解析会先以库存实体补全简化的开包回执：按 item ID 优先、definition ID 回退，随后优先读取 FSU 映射或使用完整 EA 元数据查询；全程保持 exact `resource_id` 校验，且只是只读库存。回归测试覆盖“开包回执元数据不足、库存实体完整”的特殊卡路径。完整 release gate 通过 92 个测试文件、577 个测试、206 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.22` 修复空的可选 `rewardPackNames` 阻断 84x10 启动：配置校验允许可选字符串列表为空，等同未设置；必填列表仍拒绝空值。完整 release gate 通过 92 个测试文件、576 个测试、206 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.21` 修复 recap FUTBIN 解析的空元数据路径：缓存 key 和 URL 构造均接受 `null` 上下文并安全返回空结果，避免单张未完整 materialize 的开包卡阻断整个 recap。完整 release gate 通过 92 个测试文件、575 个测试、206 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.20` FUTBIN 精确解析覆盖普通金和特殊卡：FSU 缓存缺失的 recap 卡都可按 EA 元数据补齐并缓存；同一张重复卡仅查一次。链接依然只在精确 `resource_id` 匹配时显示，不回退姓名搜索。完整 release gate 通过 92 个测试文件、574 个测试、206 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.19` 特殊卡 FUTBIN 直达链接补齐精确解析与 Runner 本地缓存：缺失 FSU 映射时仅以原始 EA 元数据筛选 FUTBIN，并以 `resource_id === definitionId` 作为唯一接受条件；无精确匹配、元数据不足或请求失败都隐藏链接。该功能仅在 recap 生成前读取公开 FUTBIN 数据，不读取 EA Cookie，也不改变开包、选卡、SBC 或 Unassigned 路径。完整 release gate 通过 92 个测试文件、574 个测试、206 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性。
- `0.6.18` recap 的 FUTBIN 链接只读取 FSU 已确认的 card ID 并直达该卡详情页，不再以球员名称搜索，也不把 EA `definitionId` 伪装为 FUTBIN ID；Player Pick、Batch Open 和普通 Loop recap 均覆盖，缺失映射时隐藏链接。完整 `npm run verify` 通过 91 个测试文件、568 个测试，204 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性均通过。
- `0.6.17`（`f6c038a`）主面板帮助入口改为标题内紧凑布局，并由 `main-panel-view` 单测锁定标题/帮助按钮的同组结构和 18px 样式。完整 `npm run verify` 通过 91 个测试文件、567 个测试，204 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性均通过。
- `0.6.16`（`1dbc7c1`）共享 recap model 增加 FUTBIN 名称搜索 URL，Player Pick UI 覆盖外链的新窗口与 `noopener noreferrer`。完整 `npm run verify` 通过 91 个测试文件、567 个测试，204 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性均通过。
- `0.6.15`（`d03ecf7`）新增 `tests/contracts/dry-run-effects.test.js`。四条契约测试分别锁定 Dry Run 不会执行开包前 Unassigned 处理、开包/奖励处理、Unassigned 移动/overflow recovery，以及 SBC 的 runtime access、保存、重载、提交与后处理。完整 `npm run verify` 通过 91 个测试文件、566 个测试，204 个 JavaScript 文件语法检查、19 个 Loop 配置、FSU patch replay 和根目录/`dist` 产物一致性均通过。
- 本次不改变 Live 提交路径，也未把 FSU 填充误标为无副作用：现有入口层 Dry Run 分支继续在调用可能保存阵容的 FSU provider 前停止。共享事务契约负责兜住开包、Unassigned 和标准提交事务，后续新增 provider 时必须延续该规则。
- Live validation: 本次为事务安全加固，未额外在真实 EA Web App 执行 Dry Run/Live 抽样；后续浏览器回归应确认 Dry Run 日志只出现 planned/inspection，不出现开包、移动、保存或提交。

- `0.6.1` 后续开发新增 `src/sbc/dynamic-sbc-cache.js` 和 `src/config/upgrade-discovery.js`，统一 Player Pick/Upgrade 候选索引、逐 SBC 指纹、24 小时 TTL、账号隔离 GM 缓存和缓存统计。进度变化只合并 live state，不触发结构重扫；Set/Category/Challenge/Reward/时间变化会重读对应 Challenge。
- 主面板入口改为 `Scan SBCs`，提供 Incremental、Full rescan、Clear cache；Builder 页改为 `Dynamic SBCs`，绑定可按 Loop ID、Set ID、Pick resource ID 或 Pack ID 恢复。JSON 导入会保留动态 `playerPickSbc` 与 `fillAndVerifySbc` 绑定。
- Upgrade parser 仅允许 EA `Upgrades` Category 下的单阵、单 Pack 奖励、单 TEAM_RATING 的 84+ TOTW 或高评分 xN；`2x84+` 保留独立 activity family。化学、未知条件、多阵、多奖励和 Category 不明均拒绝。扫描结果直接生成会话 Loop，Set、Pack、人数、评分、特殊需求和 2x84 稀有金人数来自 EA metadata；高卡、特殊卡、可交易卡和 pile 顺序保护来自通用 Upgrade policy，不再依赖内置 84x10/TOTW 实体模板。Challenge 元数据瞬时失败时执行最多 3 次带退避重试，最终失败仍保持 unavailable。

- 新增 `src/config/player-pick-discovery.js` 纯解析层，只接受普通 Set/Challenge/Reward 快照；支持单/多 Challenge、全金卡及精确 common/rare 比例，并生成现有 `playerPickSbc` 配置契约。
- 新增 `src/adapters/ea/sbc.js#snapshotDiscoverySet()` 只读快照转换，识别 EA `awards[].item.isPlayerPickItem()`、缓存 Challenge、formation 人数和 `eligibilityRequirements`；不请求、不提交、不操作 UI。
- 缺少稳定 Set/奖励身份、候选数、选择数、人数、全金卡条件或精确 rarity 比例时返回 `unsupported`；评分、化学、联赛、国家、俱乐部和未知 rarity 编码当前同样拒绝，不从 SBC 名称推断。
- fixture 和 parser unit tests 覆盖单 Challenge、多 Challenge、混合比例、已完成、奖励身份缺失、不支持条件、未知 rarity、稳定身份去重、会话列表替换、旧选择回退和 Custom JSON 选择保留；Adapter contract test 覆盖真实 EA 方法型对象归一化。
- 扫描保持只读；完全支持且不与静态配置重复的结果会作为当前会话 Loop 接入下拉列表，成功重扫会整体替换旧会话结果，完成、过期、不支持或消失的动态入口不会残留。实际运行继续复用现有 `playerPickSbc` Workflow。
- `0.5.08` 在 Options 增加只读 `Scan Picks`：刷新 SBC Sets，按奖励对象识别 Pick，读取 Challenge 元数据，并把稳定 ID、候选/选择数量、人数、eligibility 和 unsupported 原因写入现有日志；结果不合并到 Loop 列表，也不会提交或领取。
- `0.5.08` 实盘扫描确认：83+ Set `#1188` / reward `5004333`，82+ Set `#1202` / reward `5005706`，84+ Summer Set `#1240` / reward `5005726`。EA 用 `PLAYER_RARITY_GROUP=4` 表达稀有组；83+ 初次显示 11 人是未加载 squad 时错误使用 formation 槽位数，不是实际材料要求；84+ 的直接 Challenge DAO 返回 `521`。
- `0.5.09` 支持已确认的 rarity group 4，逐个只读加载 Challenge squad 后用 brick/required-player 信息计算真实人数，禁止从未加载的 11 槽 formation 猜人数；DAO Challenge 列表失败时回退标准请求，并输出奖励对象各层的受控字段摘要继续定位候选数和选择数字段。
- `0.5.09` 实盘诊断确认 EA 奖励对象没有独立候选数/选择数字段，但 `staticData.description` 提供官方 `1 of 5`、`5 of 10`、`1 of 3` 前缀；解析层只从该官方奖励描述或显式字段读取数量，仍禁止从 SBC 名称推断。
- `0.5.10` 在启动后自动扫描，并保留 Options 中手动 `Scan Picks`；完全支持的未知 Pick 以精确 Set/奖励 ID 生成会话 Loop，静态 83+/84+/82+ 按精确 ID 去重。扫描、刷新、加载配置和 Start 互斥，避免扫描重绘列表时启动旧选择。
- `0.5.11` 增加默认关闭的 `Use scanned Pick metadata` 验证选项。启用后立即重扫；完整且只匹配一个静态 Pick 的结果会覆盖当前会话中的 Set/奖励身份、Challenge 数量和材料比例，同时保留静态 Loop ID、名称、运行限制和 Provision `preCraftPlayerPickLoopId`。扫描失败、活动完成、unsupported 或多重匹配时继续使用静态回退；未知支持 Pick 的会话入口逻辑不变。
- `0.5.11` 实盘验证通过：83+ 与 84+ 均先用扫描覆盖完成 Dry Run，严格选择 4 张低分普通稀有金；随后 Live 完成精确 Set/奖励领取、FUTNext 价格、自动 Pick 和 Unassigned 清理。83+ 领取 1/5，84+ 领取 1/3，结束均为空。
- `0.5.12` 从内置和外部 JSON 删除 83+/84+ 的静态活动配置及静态场景登记；两者只在扫描成功且条件完整时生成会话 Loop。82+ 静态配置继续保留，Provision `preCraftPlayerPickLoopId` 不变；其多 Challenge 动态覆盖等待活动重新可用后实盘验证。
- `0.5.13` 为直接运行的 Player Pick Loop 增加可持久化的 `Open Picks at end` 选项。开启后，同类型的已有 pending Pick 计入 `rounds` 上限，后续提交期间通过稳定奖励身份保留，达到上限、活动完成或材料不足后集中领取；其它 pending Pick 继续安全阻断。Provision 前置 Pick 保持原有即时领取流程。
- `0.5.14` 明确区分业务终止条件与 UI `rounds`：One-click/正式 Daily 使用 EA 实时剩余次数；One-click 内部的 Daily Rare Pack 开完全部匹配来源包后最多运行一次 2x84+ 库存兜底，不读取 UI `rounds`。独立 Daily Rare Pack 则以 `rounds` 为 2x84+ 最低目标，先开完全部来源包并累计其提交数，再从库存补足差额；清理来源包重复卡允许超过目标，库存兜底不得超额。Daily MVP 继续保留单次验证上限，独立 Player Pick、2x84+ Fodder、84+ TOTW 等可重复 Loop 仍可用 `rounds` 控制本次完成数，Provision 用它控制来源包数。`Open reward packs` 统一控制 Rare Pack 与独立 2x84+ 奖励。
- `0.5.14` 将静态 `5 of 10 82+ Players Pick` 标记为限次 Set：运行前读取 EA `timesCompleted/repeats`，按“pending Pick + Set 剩余次数”执行到耗尽，移除 `rounds` 与 `maxCompletions` 配置并隐藏 UI 输入。其它显式 `useRoundsAsCompletions` 的不限次/用户限量 Pick 保持原行为。
- `0.5.16` 为所有 Runner 开包路径增加统一 Reward Highlight 事件：默认识别 `94+` 特殊卡，立即显示非阻塞 Toast/烟花，并可选通过 `GM_notification` 或 ntfy 批量通知。通知配置位于独立 Settings 弹窗，凭证使用 Tampermonkey 隔离存储；提示和网络失败不会阻断 opened-item policy 或 Unassigned 清理。Player Pick recap 继续保留，并与开包 Highlight 共用通用烟花模块。
- `0.5.17` 增加独立 Batch Open Packs 工具：扫描 `My Packs`、持久化用户选择的包类型与数量、逐次重新解析 live pack instance，并统一调用现有 `openPack()`、Reward Alerts 和 `createMaterializeAndResolvePolicy()`。结束 recap 逐张列出特殊卡、按评分聚合其它普通金卡并整体降序；Preview 不产生 EA、Desktop 或 ntfy 副作用。配置、Workflow、recap 模型、弹窗、主面板命令和架构调用点均有自动化测试。
- `0.5.18` 修正 Batch Open 在 Storage 满时丢失已开包回执并重复执行 final cleanup 的问题。单包 opened-item policy 会先尝试现有通用恢复配方，仍失败时安全保留无法移动的 Unassigned，高分/FSU 保护不变；已打开包进入 recap，剩余包停止。启动前也会以相同模式检查已有 Unassigned，阻塞未解除时不会打开新包。
- `0.5.19` 将 Batch Open 的 My Packs `Add` 改为单按钮下拉菜单，支持 `Add 1` 和 `Add all (N)`；已加入项可用 `Added v` 快速重设为 1 或当前全部数量，并保持原有 Batch list 顺序和即时持久化。
- `0.5.20` 扩展 Batch Open recap：特殊卡逐张查询并显示 FUT.GG/FUTNext 实时价格；非特殊 Gold、Silver、Bronze 球员按评分、Rare/Common 和卡色分别聚合，同评分不混合。价格失败显示 `price:?`，不影响已完成开包结果或 recap。
- `0.5.21` 将 Batch Open 的 `Add all` 从数量快照改为持久化动态 `all` 模式。弹窗按当前 My Packs 显示实时数量，Start 前再次刷新并物化执行计划；库存增减会自动跟随，当前为 0 的类型安全跳过。旧的固定数量配置保持兼容。
- `0.5.22` 小步安全修复：`protectHighGold` 支持可配置 `highGoldThreshold`（去掉 inventory/entry 硬编码 82）；日志 renderer 默认 HTML escape；主脚本 metadata 移除 localhost `@connect`（仅 Hot Reload 保留）。
- `0.5.23` 修正 `0.5.22` 后续审计项：恢复生产脚本 localhost `@connect`，保证 `Load loops JSON` 可用；显式标记运行时生成的 Pick 高分 cap，关闭保护时清理该 cap 并恢复原有业务 `maxRating`；Provision 前置 Pick 统一使用当前 UI 的高分保护选项。自动测试锁定 metadata、动态扫描阈值切换和 Provision 配置透传。
- `0.5.24` 调整动态 Pick 的 Set 完成状态语义：`completed` 不再在解析 Challenge 前直接过滤；奖励身份、候选/选择数、人数和材料比例完整时生成一次性运行探测 Loop，并保留 `discoveryReportedCompleted` 标记。实际 Challenge 不可用或提交被阻止时明确记录失败并停止，不生成空 recap；缺少 Challenge 元数据的 completed Pick 仍保持 unsupported。EA Adapter 同时禁止把缺失的 repeat counters 从 `null` 误转成 `0/0`。
- `0.5.25` 修正配置化 Unassigned recovery 对混合配方的触发卡覆盖判断：本次期望消耗数改为“阻塞同类重复卡数量”和“与 recovery policy 匹配的 requirement 槽位容量”两者的较小值。Daily Common 因此可先合法消耗 7 张阻塞铜卡中的 5 张，刷新后重新规划剩余 2 张，并在该配方不可用时继续 Bronze Upgrade；容量足够却漏选触发卡时仍会阻止提交并输出诊断。新增纯函数和状态机回归测试锁定部分消费、真实信号丢失及后续 fallback。
- `0.5.26` 修正 `0.5.23` 引入的 Provision 启动回归：Provision 前置 Pick 保持调用共享 `applyPickRuntimeOptions()` 投影当前 UI 的高分保护和自动选择阈值，同时恢复入口缺失的显式 import。架构测试新增 import contract，防止调用仍存在但模块绑定被删除时生成可构建、运行即报 `ReferenceError` 的脚本。
- `0.5.27` 增加持久化 `Daily Bronze/Silver: inventory only` 选项。开启后现有 recycle workflow 禁用 pack branch 和 final reward opening，继续复用原有 target-duplicate 与 seed submission 分支、FSU 填充和提交保护；One-click 只向 Daily Bronze/Silver 子步骤投影该选项，Daily Common/Rare 及其它开包流程不受影响。新增 workflow、runtime option、routine projection 和主面板回归测试。
- `0.5.28` 增加配置化 `inventoryExhaustion` Workflow 和 `Bronze/Silver/Common Inventory Exhaustion Loop`。Loop 按 Bronze Upgrade、Silver Upgrade、Gold Upgrade 顺序复用统一库存选材和提交事务；每阶段在不足一个完整安全阵容或 SBC 不可用时进入下一阶段，保护规则或提交失败时停止。阶段不打开来源包，奖励是否打开继续由 `Open reward packs` 控制，并增加配置、编排、Dry Run、顺序和材料类型回归测试。
- `0.5.29` 为评分 SBC 后台提交增加有界 `409/429` 恢复：重载 Challenge、重放已经验证的阵容并重试；同时按 Pack ID 记录本会话返回 `404` 的僵尸包，避免 Repository 刷新后反复尝试同一奖励包。新增纯 helper、架构约束和单元测试。
- `0.5.30` 集成 FSU provisional Club 实体缓存状态。Runner 在 FSU 后台全量校验期间允许只读选材，并在每次 Live SBC 保存前按 item ID 和 definition ID 定向校验实际选中的 Club 球员；缺失或关键属性变化时阻止保存并要求重新选材。FSU 原生填充只在 scoped provisional access 中临时执行，Dry Run 不发起定向网络校验。
- `0.5.31` 修正 Batch Open 在第三包等后续实例返回 `471` 后复用同一个失败 Pack 对象的问题。共享 Pack retry recovery 现在会排除失败实例、同步 Unassigned、无条件尝试进入 Store Packs 并刷新 Repository，再解析同类型的其它 live instance；`500` 保持有界重试。重试耗尽时日志和 recap 明确记录最终错误码、attempt 数、已开和跳过数量。完整 `npm run verify` 通过 74 个测试文件、386 个测试，并确认根目录与 `dist` 发布文件一致。
- `0.5.32` 扩展动态 Player Pick 扫描：仅要求全部 Gold、未限制 rarity 的 Challenge 生成不带 rarity 的通用 Gold requirement，因此支持 `4 of 10 83+ Player Pick` 这类多阵 Pick；`repeats > 0` 的有限 Pick 自动按 EA 剩余次数耗尽并隐藏 Rounds，`repeats:0` 且 Set/Challenge 可用的不限次 Pick 使用 UI Rounds。扫描日志对不限次 Set 显示 `remaining:user rounds`，避免误报为已完成。完整 `npm run verify` 通过 74 个测试文件、389 个测试，并确认根目录与 `dist` 发布文件一致。
- `0.5.33` 删除已过期的静态 `5 of 10 82+ Players Pick` 及场景登记；Provision 不再通过静态 Loop ID 保留活动，而是使用 Set `#1256` / Reward `#5005713` 的稳定身份解析当前扫描到的 `4 of 10 83+ Player Pick`。扫描结果缺失、不支持或已过期时，Provision 只跳过前置 Pick并继续配置的 crafting stages；历史自定义 JSON 的 `preCraftPlayerPickLoopId` 继续兼容。完整 `npm run verify` 通过 74 个测试文件、390 个测试，内置/外部静态 Loop 均为 18 个，根目录与 `dist` 发布文件一致。
- `0.5.34` 为动态扫描得到的无 rarity Gold requirement 增加显式 `preferCommon` 选材策略。统一库存选材器先按 `Unassigned -> Storage -> Transfer -> Club` 遍历全部合格 Common Gold，Common 总量不足时才从 Unassigned 重新开始使用 Rare Gold 补足；FSU `priorityRareWithinGoldRange` 不得覆盖该阶段顺序。严格 Common/Rare 配方和评分 SBC 不受影响。完整 `npm run verify` 通过 74 个测试文件、393 个测试，并确认根目录与 `dist` 发布文件一致。
- `0.5.35` 合并提交 `7e1b2d1` 的 `FOF Glory Hunters Exhaustion Loop` 与延迟奖励开包能力。新 Loop 严格使用 9 张 81 分及以下 Common Gold，正常耗尽后仅在 `Open reward packs` 开启时批量打开匹配的 `5x 80+` 奖励；移除远程配置中的强制开包覆盖，并禁止 blocked/stopped 后执行 finalize。保留 `0.5.34` 动态 Pick、Provision 动态引用和 Common-first 修复。完整 `npm run verify` 通过 74 个测试文件、396 个测试，内置/外部配置均为 19 个 Loop。
- `0.5.36` 合并提交 `41285b4`，将组合库存耗尽 Loop 的 Common Gold `Gold Upgrade` 阶段替换为 9 张 81 分及以下 Common Gold 的 `FOF Glory Hunters Crafting Upgrade`，独立 FOF-only Loop继续保留。组合 Loop 的 `5x 80+` 奖励同样延迟到全部阶段结束，并继续服从 UI `Open reward packs`；移除远程强制开包字段，blocked/stopped 后不执行最终开包。完整 `npm run verify` 通过 74 个测试文件、396 个测试，内置/外部配置均为 19 个 Loop。
- `0.5.37` 合并提交 `9989b34`，为组合库存耗尽 Loop 增加 stage 级奖励策略：Bronze 和 Silver 每次提交后强制打开各自奖励，使 Silver/Common Gold 继续供给下一阶段；父 Loop 的 FOF `5x80+` 奖励名不传入 stage，仍延迟到全部阶段结束并服从 UI `Open reward packs`。该强制行为仅配置在组合 Loop 的前两个 stage，不影响独立 Bronze/Silver/FOF Loop。完整 `npm run verify` 通过 74 个测试文件、396 个测试，内置/外部配置均为 19 个 Loop。
- `0.5.38` 修正 Options 内容增长后完整日志被父容器裁切且无法滚动的问题。日志区允许在固定面板剩余空间内收缩，保留稳定的纵向滚动条，并对长错误栈和 URL 自动换行；面板默认尺寸、简洁日志和 Loop 执行逻辑不变。新增主面板 CSS 回归断言；完整 `npm run verify` 通过 74 个测试文件、396 个测试，内置/外部配置均为 19 个 Loop。
- `0.5.39` 强化 FSU provisional Club 提交前定向校验，按 item/definition identity 回解最新 EA 实体并在四条 Live 保存路径重放；缺失或关键属性变化时阻止提交。
- `0.5.40` 引入声明式 `workflowRoutine`、完整 Workflow JSON 编辑器和 `rewardFlow`，但初版遗漏顶层 strategy dispatch，并错误地把 `maxCompletions` 当作所有子策略的通用 step 字段。
- `0.5.41` 将可重放的 FSU 26.09 Club cache 优化、patch 工具和文档纳入仓库，并支持 `trusted-provisional` readiness。
- `0.5.42` 修正 Workflow Routine 集成：共享 strategy registry 同时约束 schema 与 dispatch，架构测试检查 entry runner 注入；step 只保留引用/显示名称/reward context，业务次数回归子 Loop 原生参数；全局 Pick、Dry Run、奖励和 Daily inventory-only 设置传播到子 Loop；Workflow 编辑器物化当前动态 Pick 和扫描 override；新增按钮纳入 busy disabled state。配置继承、安全约束和 strategy 完整性规则同步写入 README/AGENTS。完整 `npm run verify` 通过 77 个测试文件、422 个测试，19 个内置/外部 Loop、FSU patch replay、架构审计和根目录/`dist` 产物一致性均通过。
- `0.5.43` 统一运行偏好继承：Pick `pickOptions`、奖励 `rewardFlow.open` 和 `inventoryMode` 按全局 UI -> 父 Loop -> 子 Loop -> step context 解析，子 Loop 显式 false/normal 可覆盖父级；Dry Run、FSU 与材料业务上限保持单向安全约束。Inventory only 泛化到 strategy capability，保留 Daily Bronze/Silver 原行为并支持 Supply-and-Craft 跳过来源包。新增 `runtimeQuantity` 声明数量输入的标签、默认值和目标字段，旧 rounds 字段仅作兼容。Schema、合同测试、README 和 AGENTS 同步更新。

Live validation: `1 of 5 83+ Player Pick` 和 `1 of 3 84+ Summer Tournament Nations Player Pick` 的静态 Workflow 与 `0.5.11` 扫描覆盖模式均已真实提交并领取通过，因此 `0.5.12` 删除两者静态配置。`5 of 10 82+ Players Pick` 已过期并在 `0.5.33` 删除；当前 `4 of 10 83+ Player Pick` 的双 Challenge 元数据已通过真实扫描获取，待补 Dry Run/Live 验证。

`0.5.12` 启动扫描实盘确认：83+/84+ 各输出一条 `added session Loop`，最终为 `2 supported session Loop(s) added`、`0 configured Loop(s) using scanned metadata`、`0 static/discovered duplicate(s) skipped`。两者纯动态入口不重复，静态配置删除后的会话列表行为通过。

Next: M9 继续作为独立功能迭代。先收集真实启动日志确认每个 family 唯一解析到预期 Set/Reward/consumer，并验证 Daily 四类、Common Gold crafting、2x84、Provision selector 和 84x10 嵌套恢复。兼容名称/ID 只有在对应 family 完成真实页面验证后才能逐项删除。后续再迁移 Provision source Pack `20643` 等尚无可靠 Reward 语义的硬编码，并仅在明确 EA 模型、fixture 和安全测试齐备时扩展新的 Upgrade/Pick family；评分、化学和复杂特殊卡 Pick 条件继续保持 unsupported。

## 7. 全量测试矩阵

每个 Workflow 至少覆盖以下维度中适用的组合：

| 维度 | 场景 |
| --- | --- |
| SBC 状态 | 全部未做、部分完成、全部完成、Challenge 暂时不可用 |
| Unassigned | 空、非重复、可交易重复、不可交易重复、可 Swap、缓存延迟 |
| 容量 | 正常、Transfer 满、Storage 满、两者都满 |
| 材料 | 正好、少 1、完全不足、只有 Club fallback、存在已消耗缓存 |
| Pack | 正常、缺失、多包同名、404、471、500、stale cache、响应先于 UI |
| 保护 | 82+、特殊卡、Tradeable、Loan、Evolution、FSU Lock、联赛过滤 |
| 操作模式 | Dry Run、Live、Stop、重新 Start、刷新后恢复 |
| 奖励 | 自动开、保留、未入库、Player Pick 待选择、需要人工介入 |

Loop 最低场景要求：

| 场景组 | Loop | 最低专项场景 | Fixture | Test | Live |
| --- | --- | --- | --- | --- | --- |
| T-DAY-01 | Daily Bronze/Silver | 目标重复、Daily 完成、overflow fallback、最后奖励不打开 | Complete | Complete | Complete |
| T-DAY-02 | Daily Common | 5+5、铜缺、银缺、两者缺、第一包后容量不足、Club fallback | Complete | Complete | Complete |
| T-DAY-03 | Daily Rare | Unassigned/Storage/Transfer 优先、11x Pack、Club 最后 fallback | Complete | Complete | Complete |
| T-RPK-01 | Rare Pack to 2x84+ | 多包连续、5 张重复恢复、页面缓存不可见、高分保护 | Complete | Complete | Complete |
| T-PCK-01 | Player Pick | 严格 rarity 比例、多 Challenge partial、价格缺失、人工选择 | Complete | Complete | Complete |
| T-PRV-01 | Provision | 无重复不做 Pick、部分 Pick、动态 stage、跨 round 恢复 | Complete | Complete | Complete |
| T-RAT-01 | 84+ TOTW | 动态评分、最低评分组合、无 special、奖励必须打开 | Complete | Complete | Complete |
| T-RAT-02 | 84x10 | 动态人数/评分/特殊卡、自动 TOTW、自动 2x84+、奖励保留 | Complete | Complete | Complete |
| T-RTN-01 | One-click Daily | 已完成阶段跳过、剩余次数、阶段失败后重新 Start | Complete | Complete | Complete |

`Fixture` 表示已保存可重复输入，`Test` 表示自动化测试通过，`Live` 表示在真实 Web App 完成对应 MVP/完整流程验证。每次 Bug 修复应在所属场景组下增加更具体的测试用例 ID，例如 `T-DAY-02-007`，不得只修改已有断言来适配新实现。

## 8. 架构测试规则

建议通过 ESLint restriction、依赖图或简单 AST 测试锁定以下规则：

- `workflows` 不得导入 `adapters/ea-*`、DOM 或 Tampermonkey API。
- `selection`、`domain` 不得访问 `window`、`document`、`unsafeWindow`。
- 只有 Pack Adapter 可以调用底层 `pack.open()`。
- 只有 SBC Adapter/Transport 可以调用 `saveChallenge()` 和提交 API。
- 只有 Unassigned Executor 可以执行通用 pile move/swap。
- Dry Run 不得调用任何带副作用的 Adapter 方法。
- UI 不得直接操作 Repository、SBC 或 Pack。

## 9. 进度记录模板

每次实施提交后，在对应 Milestone 下追加：

```text
Status: In Progress | Blocked | Complete
Commit: <hash> <subject>
Scope: 本次迁移内容
Tests: 新增和执行的测试
Live validation: 实际验证的 Loop 和结果
Known gaps: 尚未覆盖的边界
Next: 下一步工作
```

完成一个 Milestone 时必须同时记录：

- 最终提交范围。
- 新增测试数量和覆盖的 Loop。
- 删除或保留的旧路径。
- 实际页面验证结果。
- 回滚点或发布 tag。

## 10. 当前追踪记录

### M0

Status: Complete

Scope: 建立 npm、Vitest、esbuild、VM userscript harness、配置/架构检查和可复用 fixture；登记当前全部 19 个内置 Loop 的 normal/recovery 场景。

Tests: 6 个测试文件、23 个测试；覆盖配置、Daily 编排、比例选材、82+ 和特殊卡保护、FSU Lock/Only Untradeable、duplicate signal、My Packs 数量、Storage `3/8` overflow、Daily set 进度和评分校验。

Live validation: 本阶段不改变线上业务逻辑，因此未要求新的实盘提交；构建产物保留原版本 `0.4.43`。

Known gaps: Workflow 场景目前是 fixture/contract 登记，M2 Fake Adapter 完成后逐步升级为可执行 Workflow 测试。

Next: M1 多文件源码和构建边界。

### M1

Status: Complete

Scope: 建立 `src/userscript-entry.js`，抽出 runtime 配置、对象工具和 EA 评分公式；esbuild 同时生成根目录兼容 userscript 和 `dist` 发布文件。

Tests: `npm run verify` 全部通过；根目录与 `dist` 产物字节一致，metadata 和版本均为 `0.4.43`。

Live validation: 热加载仍使用根目录 `FCAutomationTool.user.js`，路径和 metadata 未改变。

Known gaps: 大部分业务仍在单一 entry 文件内，后续按 M2-M7 迁移。

Next: M2 Domain Contract、Snapshot 和 Adapter。

### M2-M6

Status: Complete

Scope: 建立可序列化 `ItemRef`、Inventory/Selection/Squad/Submission/OpenPack 契约；增加 EA/Fake Adapter；统一 requirements/rating Selection、SBC Submission、Unassigned Resolver 和 Pack Transaction。入口层继续负责把稳定契约解析为当前 EA 实体，并注入页面副作用。

Tests: contract、pure selection、rating、Unassigned、Pack、Submission 和架构测试通过；旧 selector/评分求解器已由固定回归 fixture 取代并删除。Submission Transaction 支持 `planned`、`prepared`、`submitted` 和结构化 blocked/unavailable 结果。

Live validation: 本轮未在真实 EA Web App 执行新的提交；原有线上日志只作为行为基线，不作为本次重构实盘验收。

Known gaps: EA/FSU/DOM 适配桥仍集中在 `src/userscript-entry.js`；只有当新的边界测试和实盘验证覆盖后，才继续拆到专用 adapter 文件。

Next: 验证共享事务在真实页面的行为并记录结果。

### M7

Status: Complete

Scope: Daily Common/Rare 迁移到 `supply-and-craft`；Bronze/Silver 迁移到 `recycle`；Rare Pack/Provision 迁移到 `pack-and-craft`；Player Pick、评分 SBC 和 One-click 分别迁移到 `player-pick`、`repeated-submission` 和 `sequence`。旧专用 runner 已删除，旧 strategy 名只保留为外部 JSON 兼容别名。

Tests: 9 个 Workflow 测试文件覆盖正常、blocked、resume、stale、remaining count、transient signal、validation round、strategy dispatch 和 Dry Run；`0.5.37` 完整验证为 74 个测试文件、396 个测试。`workflows` 无 EA/FSU/DOM 直接访问。

Live validation: 主要生产路径已完成真实页面验证：One-click Daily、Rare Pack 多包恢复、Player Pick、Provision 三轮、2x84+、84+ TOTW、84x10 和安全 Stop 均有成功日志。`0.5.07` 的 One-click Daily、Provision 和 Bronze Upgrade Validation 共享路径已再次验证通过。Daily Rare Pack to 2x84+ 已有多包、恢复和 transient signal 成功日志；当前账号源包耗尽只影响再次抽样，不否定已完成验收。M7.1-M7.9 均为 Complete。

Known gaps: `submitReservedDuplicateUpgrade()`、`runReservedDuplicateUpgradeDryRun()` 和 `runValidationBronzeUpgradeDryRun()` 已删除；Provision/Rare Pack 共用 `runReservedDuplicateCraftingWorkflow()`，Bronze Validation 的 Dry/Live 共用 `runValidationRoundWorkflow()`。历史自定义 JSON 的三个兼容 strategy 名继续映射到新 Workflow；这是明确的兼容策略，不是未完成迁移。后续重新获得匹配源包时可补做 Daily Rare Pack 当前版本抽样，但它是维护回归项，不阻塞 M7。

Next: 无阻塞工作。后续获得匹配源包时按维护回归流程补做 Daily Rare Pack 抽样，遇到新 Bug 时增加对应 fixture/test。

### M8

Status: Complete

Scope: 删除旧 selector、旧评分求解器、重复 Dry Run 调度器、旧命名兼容 helper 和无调用 entry helper；统一 child Workflow 结构化结果与 strategy dispatch；增加模块边界/死代码测试、GitHub Actions、生成产物检查、真实页面验收要求和新架构 README。内置 Loop、MVP/disabled pile 展示规则、One-click 子配置、Live/阶段运行上限、运行时选项及完整配置 schema 已迁入 `src/config` 纯模块。

Tests: `npm run verify`、`npm run test:contracts`、`npm run test:architecture`、构建产物一致性和 `git diff --check` 均纳入本地/CI 流程。

Live validation: 主要 MVP/完整 Loop、暂停恢复和已遇到的容量边界已完成；`v0.4.48` 还验证了页面型 SBC 奖励确认不再固定等待 25 秒。

Known gaps: 兼容 strategy 名暂不删除，以免破坏用户历史 JSON；Inventory/Pack/SBC/Player Pick/FSU/Localization 和 DOM/Storage/HTTP/Page Runtime/Wait/User Effects 已通过 `createRuntimeAdapters()` 接入。Inventory Adapter 负责四个 pile、容量、刷新、move、enum 和 purchased item 准备；Pack Adapter 负责 My Packs、实例解析、`Store.getPacks()` 和 `pack.open()`；SBC Adapter 负责 Set/Challenge/DAO/formation/controller/submission settings/save/submit；Page Runtime/Wait 负责 Controller 状态及 predicate/loading/observable 等待。Reward 纯逻辑及 FUT.GG/FUTNext fallback 已迁入 `src/reward`；评分 Challenge 模型、候选构建、纯搜索和计划回解位于 `src/selection`；strategy dispatch 位于 `src/workflows/dispatch.js`；Player Pick EA 操作位于 Adapter，人工 Pick、recap 和 SBC 页面覆盖层位于 `src/ui`；主面板视图、几何、绑定、command 和状态投影也已迁入 `src/ui`；FSU 纯兼容解析和 runtime discovery 已分别迁入 config/Adapter。entry 已无直接 `W.*`、EA Repository/Service/enum、Clipboard 或 download API 访问，保留 Runtime composition、缓存合并、评分候选安全策略桥和注入共享 Workflow 的真实页面副作用回调。当前架构测试锁定共享模块不得访问运行时全局、锁定所有 EA/页面 runtime 直接调用点，并拒绝无调用顶层 entry helper。

Next: 无阻塞工作。不再为减少 entry 行数机械拆分有副作用的页面回调；后续只在明确职责、测试和实盘证据支持时继续提取模块。

### 2026-07-19 收尾审计

Status: Complete

Scope: 核对重构计划、模块依赖、共享事务调用点、Live 日志和测试框架。所有开包统一经过 `openPackTransaction()`，所有 Unassigned 处理统一经过 `resolveUnassigned()`，requirements/rating 选材统一经过 `selectInventoryPlayers()`，页面/后台/FSU/Inventory 提交统一经过 `submitSbcAttempt()`。旧的 Daily Common、Daily Rare、Daily Single Card、Rare Pack、Provision、Player Pick、Fill-and-Verify 和 Daily Routine 专用 runner 名称已删除。

Tests: `npm run verify` 在 `0.5.37` 覆盖 74 个测试文件、396 个测试；架构边界要求 `config/pack/reward/sbc/unassigned/ui` 与既有 `domain/selection/workflows` 一样不得访问 `window/document/unsafeWindow/W/services/repositories` 或直接导入 adapters，并锁定 Pack、SBC、Player Pick、Inventory、Localization、HTTP、FSU 和 Page Runtime 调用点。新增测试锁定 Wait Adapter 的 predicate/readiness/loading/observable 语义、Clipboard/download fallback、主面板 command guard、Player Pick recap、SBC reward/error overlay、Claim/进度/Pack/AltRight/超时奖励确认、通用 DOM 点击/键盘序列、动态评分模型解析/校验、评分 duplicate signal/definition 去重/stale 回解、Live/One-click 执行策略、Daily 实时剩余次数、MVP 单次上限、运行时 Pick/rounds/openRewardPacks 投影、strategy dispatch、entry 死代码、动态 Player Pick discovery、会话列表替换、静态覆盖/回退/歧义拒绝、Provision 引用保持、扫描互斥、只读扫描编排与配置 schema 的精确错误信息和兼容容器。

Live validation: One-click Daily、Rare Pack、Provision、Player Pick、2x84+、84+ TOTW、84x10、Stop 和 Claim Rewards 提前确认均已通过真实日志验证。`0.5.12` 还确认删除 83+/84+ 静态配置后，两者分别作为唯一动态会话 Loop 加入列表，最终扫描摘要为 2 added、0 override、0 duplicate。

Known gaps: 不能宣称“物理上彻底拆分”。`src/userscript-entry.js` 当前约 7,202 行并承担 composition、缓存合并、评分候选安全策略桥、真实页面副作用回调和页面语义 helper；这是本轮收尾时保留的运行时组合边界。Runtime Adapter 已覆盖 Inventory/Pack/SBC/Player Pick/FSU/Localization/DOM/Storage/HTTP/Page Runtime/Wait/User Effects，entry 已无直接 `W.*`、EA Service/Repository/enum、Clipboard 或 download API 访问。场景 fixture 已登记全部静态 Loop，但不是每个 Loop 都有独立的浏览器级端到端自动化模拟；Node 自动化与真实页面抽样继续共同承担回归验证。

Release conclusion: 核心架构重构在 `0.5.12` 收尾。所有开包、Unassigned、选材和提交分别统一经过公共事务；旧专用 Workflow、重复 Dry Run 和直接 EA/page global 调用已清理或收敛到 Adapter。`0.5.37` 的 `npm run verify` 覆盖 74 个测试文件、396 个测试，19 个内置/外部静态 Loop 配置一致，根目录与 `dist` 发布文件相同。主要生产 Loop、恢复路径和动态 83+/84+ Pick 均有真实页面验证。M7、M8 与本次收尾审计关闭；M9 保持独立 In Progress，只追踪动态 Pick 实盘扩展、Provision 动态覆盖和未来复杂 Pick 条件。
