# FC27 迁移评估与实施计划

调研日期：2026-09-14。初始调研基线：`0558f7b`，Runner `0.8.64`。当前实施状态不绑定一个会随提交立即过期的 `main` 哈希，以 Git HEAD、`package.json`、[改名记录](RENAME_STATUS_ZH.md)和[上线前收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)共同为准。

更新：用户已选择 FC27 全新安装，不要求旧配置迁移。仓库、目录和文件已经历改名；不同工作机的本地目录可以不同，实际状态以 [改名记录](RENAME_STATUS_ZH.md) 为准。下文仍保留的旧迁移顺序属于历史设计，不表示步骤尚未执行。

状态：已按用户确认实施上线前 P0/P1/FSU F0/B0 的离线准备；逐项结果、文件与剩余边界见 [上线前实施记录](FC27_PRELAUNCH_PROGRESS_ZH.md)。正式版本仍规划为 `27.0.0`，产品和远程仓库已更名为 `FC Automation Tool` / `ShatteredLancer/FCAutomationTool`；完整脚本仍执行 FC26 业务，新名 Release 尚未发布。当前生产 metadata 处于“旧 `@name`、新 `@namespace`/更新地址”的未批准过渡状态，必须在发布前完成安装身份决策和实测。2026-09-17 已开始真实 FC27 原生只读验收，SBC 与 fresh Club 的部分证据见 [上线后适配记录](FC27_LIVE_ADAPTATION_ZH.md)；真实 GM/完整策略、账号写操作与产品兼容验收仍未完成。

## 1. 结论与路线选择

建议：**同一仓库、同一产品延续，冻结 FC26，面向 FC27 做一次有边界的大版本迁移。复用通用安全组件，重做积分 SBC 业务，不把旧 Rolling 整体搬过去。**

| 方案 | 优点 | 主要代价 | 判断 |
| --- | --- | --- | --- |
| 另建仓库，从零实现 | 可以完全摆脱旧结构 | 丢失或重新实现库存身份、提交对账、开包确认、Pick、保护和测试，容易重踩线上问题 | 不推荐 |
| 在当前入口与 Rolling 上不断增加 FC27 分支 | 初期看似改得少 | 两套 SBC 规则、旧活动恢复链和配置迁移永久混杂，继续扩大入口与测试组合 | 不推荐 |
| 同仓库冻结旧季，提取可复用部分，新增 FC27 运行入口和业务引擎 | 保留已验证经验，可真正停止加载旧业务，可分阶段验证 | 需要先明确边界、迁移配置，再接实时接口 | 推荐 |

这不是要求同时维护 FC26/FC27 双运行时。FC26 最终版本留在 Git tag/维护分支；FC27 默认发布包不导入 FC26 专用业务。迁移过程中可以短期并存源码与测试，完成替换后从主开发路径移除旧业务，历史由 Git 保留。

产品名统一规划为 **FC Automation Tool**，简称 FCAT，不在品牌名中写死年份。Runner 是其中的工作流执行能力，产品还覆盖 SBC、Packs/Picks、Inventory 与后续可选 Trade；本文提到旧源码、合同或历史行为时仍使用 Runner/Daily Loop Runner 原名。更名不扩大首版范围，也不表示交易模块已经完成 FC27 适配。

遵守现有里程碑的“禁止 Big Bang 重写”：每一步都有独立测试、可观察结果和停止点。回退 FC27 版本不意味着能回退服务器上已经消耗的材料。

## 2. FC27 已确认变化

以下主要来自 EA 2026-08-02 的 FUT Deep Dive [S1]，FUT.GG 的专题用于交叉核对 [S5][S6]。

| 官方事实 | 对 Runner 的直接影响 |
| --- | --- |
| 大部分 Player/Upgrade SBC 使用 Streamlined SBC，不再要求围绕阵容总评、位置、化学构造完整阵容 | 新建积分计划与提交事务，不再把所有提交表示成 11 人 `SquadPlan` |
| 每张物品按 OVR 与 rarity 贡献分数，使用 Gallery 的单物品评分系统 | 不是“卡面分完全无用”，而是“不再按旧阵容总评公式凑阵”；OVR 仍影响积分与资格 |
| 支持分批提交、累计进度，之后回来继续完成 | 已提交材料不能当作仍在库存；恢复依据必须包括服务器进度与确切消耗实体 |
| 可以提交同一物品的多个版本，包括重复卡 | 新制不能沿用同 definition 一阵最多一张的全局规则；同一 item 实体仍绝不能重复消费 |
| 可能只有总积分要求，也可能附加每张卡最低 OVR，例如 75+ | 读取实时资格条件，不预设所有积分 SBC 都接受铜银金任意材料 |
| Traditional SBC 仍保留，面向解谜式 Challenge SBC | 不能直接删除全部传统引擎；应隔离并按已支持条件开放，复杂化学当前仍不承诺自动求解 |
| 基础铜、银、金不再分 Common/Rare；包也不再声明保底 Rare 数量 | 普金/稀有金筛选、Daily Common/Rare、旧材料家族比较、奖励解析和相关 UI 都需替换 |
| Holographic 有 Regular/Pristine，比赛属性与对应普通版本相同，但稀有度与收藏评分更高 | 仅按 OVR 保护不够；需要独立版本身份、特殊卡保护、价格和 Pick 展示规则 |
| Gallery 记录曾持有的物品，售出/提交后仍可贡献收藏 | Gallery 不是当前库存，不能将收藏记录作为可提交材料 |
| Gallery 有组合 Tags；Evolution 在 Gallery 以原始基础物品表示 | 不得把 Gallery 组合加分套到 SBC，也不能从 Gallery 展示推断 Evo 实际 SBC 积分 |
| Evolution 增加 Pathways 与链式预览 | 重验进化/外观字段与保护，不把新分支卡误当普通卡 |
| 奖励增加直接金币和可交易包占比，Event Tokens 延续 | 奖励建模不能只有 Pack/Pick，也不能默认都是不可交易 |

补充边界：官方写的是从 Club 中选择合格物品，并允许 duplicates；**尚不能据此认定 Unassigned/Storage/Transfer 都能直接向同一接口提交**。FUT.GG 对清理 Unassigned 的描述属于玩法说明，不足以证明具体 pile 与提交 API 合同。

截至调研，官方 Web App 页面明确显示正在为 FC27 维护 [S2]。官方 9 月 3 日文章列出游戏全球发行日为 9 月 25 日、最多提前 7 天访问 [S3]；这不是 Web App 开放日期。本次未取得可用的 FC27 登录后页面证据。

### 2.1 目前不能写死的规则

本次查阅资料没有给出以下可执行细节，必须等真实 Web App 或后续官方说明：

| 未知项 | 未确认前的处理 |
| --- | --- |
| 精确单卡积分表、公式、整数/小数、版本与挑战差异 | 不用 OVR 猜积分；没有权威积分的卡不进入自动积分计划 |
| 超额积分是否丢弃、结转、退还，是否可一次跨越多个重复完成 | 不承诺精确找零或跨轮抵扣；结算语义不明时不自动执行越过目标的提交 |
| 每批最大人数、是否有最低批量、进度上限 | 不继承固定 11 人，不猜接口限额 |
| duplicate 从哪些 pile 提交，是否要先存储/移动 | 按实际能力决定路由；不能为了删除 Swap 放宽实体确认 |
| 部分投入后是否可撤销、过期如何处理、重复次数何时重置 | 按不可逆投入设计；只向用户选定目标投入，不自动分散到多个长期 SBC |
| 完成是否自动发奖，是否另需领取，Pick/套组/可重复挑战如何关联 | 实测并分别保存进度、完成轮次与奖励状态 |
| 新 Holo/Evo/rarity/loan/tradeability 字段 | 未识别类型默认保护；FC26 字段解释只是待复验假设 |
| Web App 与主机是否同步上线同一套功能 | 以当前 Web App 能力为准，不从游戏介绍推断浏览器接口已就绪 |

没有证据表明这是可自由转移、购买或通兑的“SBC 积分钱包”。应先建模为某个挑战的累计进度。

## 3. FSU 的 FC25 到 FC26 迁移

### 3.1 版本历史

Greasy Fork 同一脚本页面的历史 [S7]：

| 版本 | 日期 | 与迁移相关的说明 |
| --- | --- | --- |
| 25.23 | 2025-08-24 | 修复 Storage 优先、重复版本导致填充不满、阵容创建等 |
| 26.01 | 2025-10-01 | 明确“适配 FC26”，同时调整头像、脸型与加速类型展示 |
| 26.02 | 2025-11-25 | 插件兼容、SBC 奖励预览、批量开包等继续修正 |
| 26.03 | 2025-11-26 | 继续修正 Only Untradeable 填充、奖励模拟开包等 |

本次页面最新上游为 `26.09`，没有观察到 FC27 适配版本。用户补充 FC26 Web App 在 2025-09-17 已上线，和上述 FSU 26.01 发布相差约两周。因此计划必须按“上游可能迟到数周，甚至更久”设计，不能安排“FSU 27 必须首日就绪”这一外部依赖；本地 FSU 最小兼容版纳入首发关键路径，详见 8.4。

### 3.2 历史源码核对

实际比较 `25.23` 与 `26.01` 的发布源码 [S8][S9]，不是只根据版本号推断：

- `@name` 均为 `【FSU】EAFC FUT WEB 增强器`，namespace 均为 `https://futcd.com/`，主要 Web App match 保持相同。
- 两版均从 `APP_YEAR_SHORT` 读取运行年份；`set`、`build` 继续使用原 GM key，锁卡从 `lock_25` 改为 `lock_26`。即保留通用偏好，隔离赛季卡片身份。
- 一个市场请求由 `utas.mob.v4.../ut/game/fc25/...` 改成 `utas.mob.v5.../ut/game/fc26/...`；FUTBIN 价格路径从固定 `/api/25/` 改成使用 `info.base.year`。
- 若干可交易判断由 `untradeable` 改为 `untradeableCount`；阵容摘要 DOM、模拟开包 Controller 和第三方页面集成有调整。
- 旧源码 12,969 行，新源码 12,732 行；按文本行对齐有 12,213 行未变，约占新文件 95.9%。这包含空白、样式和内联资源，**不是“业务逻辑复用率”或 FC27 工时预测**。

结论：FSU 采用同一产品持续升级、复用主体、修正运行时与页面变化，同时隔离部分赛季数据。值得学习的是发布连续性与赛季边界，不是照搬其单文件体量。FC27 改变 SBC 交易模型，迁移范围明显超过简单的年份、端点和 DOM 调整。

## 4. 当前体量与真正需要瘦身的位置

以下为本次磁盘实测，源码行数含空行与注释，不包含测试和生成脚本：

| 范围 | JS 文件数 | 行数 |
| --- | ---: | ---: |
| 全部 `src` | 203 | 68,984 |
| `src/userscript-entry.js` | 1 | 22,914 |
| `src/trade` | 52 | 9,411 |
| `src/config` | 23 | 8,447 |
| `src/ui` | 28 | 7,861 |
| `src/adapters` | 20 | 4,162 |
| `src/selection` | 9 | 3,019 |
| `src/inventory` | 9 | 2,854 |
| `src/workflows` | 12 | 2,644 |

Runner 单个生成脚本为 **2,974,255 bytes**，根目录与 `dist` 是同一产物的两份副本，不代表浏览器加载两倍。FSU Local 为 1,016,538 bytes，应单独计算。仓库有 202 个测试文件。

当前 esbuild 使用 `minify:false`；不能拿未来压缩后的大小与当前未压缩大小比较，声称架构已瘦身。必须先减少实际导入的业务、配置与 UI，再考虑可选压缩。

入口中已有大量 Rolling Swap、库存恢复、Provisions 预测、Storage sink 和奖励 journal 编排，同时静态导入 Trade Scheduler 与完整 Builder。把这些函数机械搬进几个大文件，不会减少默认运行包的功能面或维护负担。

`REFACTORING_MILESTONES.md` 的 M0-M8 完成结论描述的是当时的边界收敛，不代表现在没有赛季业务债务；其中约 7,202 行的入口数据已经过时。M9 动态发现仍为 In Progress，化学/复杂条件与部分 FSU 真实页矩阵存在明确边界，不能把 FC26 的完成记录当 FC27 已验收。

### 4.1 功能与文件处理清单

| 现有模块/能力 | FC27 处理 | 说明 |
| --- | --- | --- |
| `inventory/ledger.js`、`deltas.js`、`ledger-coordinator.js` | 保留原则，升级契约 | 保留精确实体索引、confirmed delta、drift 与定向复核；加入赛季与新物品身份 |
| `pack/open-transaction.js`、`unassigned/*`、`reward/*` | 选择性复用 | 保留响应不明对账、pending 奖励和 bounded recovery；重验 EA DTO/导航，不搬未经验证的 fallback |
| `domain/contracts.js`、`player-rarity.js`、`gold-consumption.js` | 重建 FC27 物品与资格模型 | 新制不强塞进 Common/Rare boolean，旧输入只由离线迁移器解释 |
| `domain/rating.js`、`selection/rating*.js`、`sbc/submit-attempt.js` | 隔离传统 SBC 引擎 | 仅已验证 Traditional 合同调用；积分提交不复用阵容保存语义 |
| `config/rolling-upgrade.js`、`workflows/rolling-upgrade.js`、`inventory/rolling-policy.js` 与入口对应桥 | FC26 归档，不进入 FC27 默认构建 | 不继承 85/86x10、87/88 Reserve、Required Special 来源特例、95+ 的 89/88 sink 等赛末业务 |
| `forecastRollingPrimaryRunway`、Provisions 预测及专用恢复链 | 重做为库存预算与单步补料决策 | 不继续扩展“三阵评分预测” |
| `inventory/duplicate-materialization-transaction.js`、`sbc/untradeable-duplicate-swap.js` 与入口 Swap 编排 | FC26 专用实现归档 | FC27 初期不启用实验 Swap；若新制仍需实体移动，只按已证实能力实现最小路由，不照搬大状态机 |
| `config/activity-discovery.js`、`upgrade-discovery.js`、`player-pick-discovery.js`、`sbc/dynamic-sbc-cache.js` | 复用发现边界，替换解析规则 | 区分 Streamlined/Traditional；沿用身份校验、限流和只读缓存原则 |
| `config/loops.js`、`recovery.js`、外部 JSON、`profiles/*` | 重建小规模 FC27 配方集 | 清除失效 Daily Common/Rare、Provisions/旧活动 fallback；不把旧名称改成新名字继续执行 |
| `src/trade/*`、Trade UI 与入口初始化 | 从默认 SBC/Pack 构建移出，后续单独适配 | Rare Gold Buy 和固定 season=26 也需要重验；不是宣称交易功能永久删除 |
| `config/builder-*`、`ui/workflow-loop-builder*` | 完整 Builder 延后 | 首版只保留目标选择、保护设置、数量、Preview/Start/Stop、恢复与日志；高级编辑不阻塞核心 |
| 主面板、日志、Stop、通用 recap、保护设置 | 复用交互基础，精简内容 | 删除旧三套评分/Reserve/Swap 专用选项，展示当前挑战积分与实际停止原因 |
| `FSU_mod` | 保留 26 origin，先做本地 FC27 最小兼容版；上游 27 发布后再接回 | 首发不依赖上游发布，也不把一整套旧补丁强行打到新上游 |

删除必须在新路径达到对应门禁之后执行，并检查 imports、strategy registry、dispatch、schema、profiles、测试与构建，不以隐藏按钮代替移出代码。

## 5. FC27 目标结构

保留当前分层，不另造插件框架或通用工作流语言。以下为拟议模块名，不代表当前文件已存在：

```text
FC27 entry: metadata + dependency composition + lifecycle
  |
  +-- season/capability detection + account-scoped settings
  +-- FC27 item/protection policy + inventory ledger
  +-- SBC discovery
  |     +-- Streamlined: points planner -> contribution transaction
  |     +-- Traditional: isolated squad planner -> squad transaction
  +-- reward queue: packs / picks / other verified reward types
  +-- rolling workflow: one action -> reconcile -> replan
  +-- compact operational UI

EA/FSU/DOM/GM effects remain in adapters.
FC26 legacy / Trade / full Builder are not default imports.
```

建议新增 `src/domain/sbc-contract.js`、`src/selection/points.js`、`src/sbc/contribution-transaction.js`、`src/workflows/points-rolling.js`，并在 Adapter 内区分赛季能力。精确目录在第一阶段依赖审计后确定，不把整理所有目录作为交付前置条件。

`format: streamlined | traditional | unsupported` 必须来自服务器结构/受验证的运行时模型，不按活动名称、年份或有没有某一个字段猜测。两个事务共享保护、实体复核、日志与对账基础，不共享错误的“保存 11 人阵容”前提。

## 6. 积分选材与连续运行

### 6.1 数据模型

- 物品：稳定 item ID、definition/resource、真实 pile、OVR、基础等级、特殊类型、Holo 变体、Evo 状态、tradeability、保护身份、权威单物品积分与来源版本。缺失信息保持 unknown，不写成 0 或 false。
- 挑战：format、精确 Set/Challenge、到期时间、重复/重置身份、已投入积分、目标积分、完整资格条件、提交批量限制、积分结转规则、奖励合同。
- 计划：具体 item refs、预期积分增量、预期完成状态、超额/损耗、保护预算、输入库存版本与合同指纹。积分计划不含虚构阵型或 squad rating。
- 多目标资源分配：同一 item 只能分配给一个计划。多个同 definition 的不同 item 在已确认支持重复的新制中可用；Traditional 仍遵守自身合同。

积分数据优先取当前 EA 物品/挑战模型；若由页面配置表计算，则保存配置版本并与真实预览、提交结果进行差分验证。不能使用第三方报价当积分，也不能用一个硬编码 OVR 表先上线再等反馈。

### 6.2 防止浪费的规则

先通过全部硬保护，再在允许的材料中优化。默认不自动投入特殊/Holo/Evo；需要特殊材料的 SBC 首版可标记不支持，后续按精确合同与明确授权开放，不恢复 FC26 赛末来源例外。

顺序建议：资格与保护 -> 用户目标及已承诺材料 -> 不超过损耗/价值预算 -> 在预算内优先解决重复和真实容量压力 -> 降低使用成本与不必要的请求次数。不能为了清 Storage 无限增加材料价值。

OVR 上限、材料价值上限、积分损耗上限分别表达，不能把旧“目标阵容 +1”换个名字继续使用。若积分不结转，按 `本批积分 - 当前剩余积分` 计算终结批次的超额；允许多少损耗须在真实积分表可见后确定，并提供明确配置。超预算时不提交，不静默改用更珍贵材料。

示例仅解释决策，不是 FC27 积分表：剩余需 100 分，安全组合只有 110 分，损耗预算为 5 时应保留材料；已有补料奖励可按政策先处理并重算，没有则报告“超出损耗预算”。不能为了追求 100 精确值无界开包，也不能直接投入 150 分。

确认积分为可加的离散值后，再选择合适的有界规划算法。只在资格、保护和积分等价的桶内聚合；小型实例用穷举 oracle 做差分验证，正式路径不枚举海量实体组合。算法预算耗尽应报告 planning-limit，不能冒充材料不足或擅自放宽保护。

### 6.3 替代“三阵预测”

新机制跟踪四类资源：当前真实可用材料、已经投入的服务器进度、明确保留给后续目标的材料、已存在但尚未兑现的奖励。

1. 每次开包、Pick 确认、提交、移动或发现手动库存变化后，更新账本并使旧计划失效。
2. 用最新库存计算当前目标缺口；对之后 2-3 次完成可以显示保守预算，但不要求未来三次全部可行为当前一次的门禁。
3. 未开随机包的具体卡片/积分不计入确定性可用资源。奖励保底只有在资格与积分都可证明时才作下界，否则保持未知。
4. 首次消费前检查是否会用尽已授权补料路径的关键材料；需要补料时，在关键材料被花掉前先计划。没有用户授权的补料路径，不能凭空永久 Reserve 一组卡。
5. 先处理已确认属于当前流程的 pending Pick/奖励；必要时开已有且获准使用的补料包。仍不足才考虑提交当前扫描确认的补料 SBC，随后领取/开其奖励，再重读库存。
6. 所谓“补料”必须在结果中区分 `open-existing-pack` 和 `craft-supply-sbc`，后者确实消耗库存，不能笼统写成“做一次 Provisions”。

FC27 不一定还需要靠低分卡拉低整阵评分，所以不会默认重建旧 Provisions 链。只有真实存在、用户选定且能够改善当前缺口的补料活动，才加入恢复候选。

### 6.4 调度与停止语义

每次只执行一个动作，再回统一决策点：恢复未决事务 -> 处理当前流程已确认奖励 -> 处理库存容量 -> 规划当前投入或必要补料 -> 提交 -> 对账。奖励与容量有依赖时一起校验，不通过递归调用其它 Loop 绕过队列。

进展指纹包含库存版本、待处理 item IDs、挑战进度/完成轮次和奖励状态。相同状态下的失败动作不能无限重复；每轮恢复请求与动作均有上限。容量预留必须考虑接下来的奖励，不能只看本次提交释放了几张卡。

正常材料不足、超预算、没有合适活动应返回可读的 `insufficient`/`unavailable`；未知实体、未知提交结果为 `blocked`；需要手选的 Pick 为 `manual-required`；网络退避显示截止时间。不能让所有结果都以一个“Rolling 卡住”呈现。

这能减少旧评分配平造成的假性阻塞，**不能保证随机奖励循环永远不缺料**。当保护范围内确实没有材料或服务器不可用时，正常停止仍是正确行为。

## 7. 部分提交事务与恢复

新制最重要的风险不是“凑不满一阵”，而是**材料已消费、积分已增加，但客户端未确认结果**。

建议持久 journal 保存有界、可序列化数据：schema、赛季/账号/平台、操作 ID、Set/Challenge/重复轮次身份、提交前进度、精确 item refs、预期贡献、状态和奖励关联。真实 token、Cookie、EA 对象和完整原始响应不得写入诊断。

事务顺序：

1. 读取当前能力、挑战与库存；以一次性执行计划绑定保护策略和合同指纹。
2. 定向复核所选实体、积分、资格、pile、到期状态和进度，避免其它页面操作使计划过期。
3. 写入计划与 mutation boundary，再发出一次贡献请求；Stop 不能中断后续必要的结果对账。
4. 对账具体材料消耗与服务器积分/完成轮次；若支持服务端操作 ID，再结合该证据。不能只看到进度增加就断言是自己的请求成功。
5. confirmed 后原子更新本地材料与挑战进度；奖励进入独立队列。不将“部分贡献成功”计作“完成一个 SBC”。
6. 超时、500 或回调丢失时，先重读目标与实体。确认已生效则继续原奖励链；确认未生效才能进入有界重规划；无法区分就停止，不能盲目补交一次。
7. F5、Stop 后重新 Start，或用户手动领完 Pick 后，先恢复同赛季/账号的未决记录并刷新库存；不能重做已完成贡献或已发奖挑战。

重复 SBC 完成后可能进度归零，因此 `before/after progress` 不足以单独确认；必须结合当前轮次、完成计数、消耗与奖励。用户手动并发操作、多标签页和别的插件都纳入 drift 检查；Runner 自身保持单一操作协调，不能承诺控制第三方未接入的写请求。

部分进度只是服务器保存，不代表可退款。默认连续 Upgrade 以可完成当前目标为意图；“仅把重复卡投入、暂不完成”的模式后续显式开放，并展示未完成投入和到期风险，不向任意长期 Player SBC 自动倾倒库存。

## 8. 赛季、配置、FSU 与发布迁移

### 8.1 数据隔离

当前动态 SBC cache 已附加 `eaSbcAdapter().cacheScope()`，但该方法取账号/persona 类 ID，缺失时返回 `default`，未显式绑定年份/平台；不能描述成“完全没有账号隔离”。部分 Rolling journal 则使用固定 key，其 payload 未带赛季。Trade 初始化仍有 `season: '26'`。这些都需要专项迁移。

FC27 所有库存相关 cache、journal、动态绑定和价格记录统一使用 `schema + season + persona/account + platform` 上下文。身份无法确认时只读展示，不使用 `default` 启动账号写操作。账号标识不进入公开日志。

| 数据 | 迁移策略 |
| --- | --- |
| 面板位置、语言、日志偏好 | 白名单继承 |
| OVR 上限、Only Untradeable、排除联赛、FSU Lock/Evo 等保护 | 显示迁移差异并重新确认有效策略；不能因新 schema 静默变宽 |
| 旧卡片 ID、锁卡实体、SBC/Pack ID、动态缓存、三阵预测状态、Swap journal | 隔离为 FC26 历史，不作为 FC27 可执行输入；未决事务不跨季重放 |
| 用户 Workflow/Profile | 保留原始备份，只迁移可证明等价字段；不兼容项列出，不伪装迁移成功 |
| Trade armed jobs、批准、lease、continuation | 不导入可执行权限，FC27 初始锁定；旧 circuit/未知恢复信息保留审计，不因升级自动解除风险 |
| Reward Alert 凭证 | 保持 GM 隔离，不通过普通 JSON 导出或改存 localStorage；若安装身份改变须单独设计迁移 |

### 8.2 FSU 集成

第一阶段只读识别 FSU 版本和能力，不因存在 `window.info` 就认定兼容。读取设置、锁卡、Club readiness、定向验证分别协商能力，不能把可显示 UI 当作实体已验证。

短期主路径调整为：**本地 FSU FC27 最小兼容版 + FC27 Runner，不等待上游 FSU 27**。仍保留 FSU 策略来源，不把“关闭 FSU”当默认解决办法。将来若希望没有 FSU 时也能使用 Runner，应另外提供用户明确选择的 Runner 保护配置与经过验证的 EA 库存加载/定向复核。后一项不是首发前提，也不允许当前代码静默降级或绕开 FSU 策略。选中 FSU 模式而关键保护接口不可用时必须阻止 Live。

FSU Local `26.09` origin 保持字节不变，但维护实现可以基于它演进出本地 FC27 兼容模式。等 27 上游可用后另建 origin，逐项判断哪些修复仍适用；先做 patch check，冲突时按新上游实际实现重做对应小补丁并测试，不按行号强贴或改 manifest hash。

优先迁移：精确请求归属、缓存 provisional 状态、精确 item+definition 定向验证、stale 清理、安全属性比较。暂缓迁移：启动大规模缓存加速及其它对正确性没有必要的全局 hook。没有缓存加速仍可发布；不能以失去定向校验换取首发。

同时验证 Runner 单独、Runner+FSU、Runner+FSU+Enhancer 三种已声明支持组合。FC26 的成功并发记录只是测试设计参考，不能证明 FC27 控制器/XHR/DAO 未变化。

### 8.3 发布与安装身份

#### 版本：以 `27.0.0` 开启 FC27

采用 `赛季.功能版本.修复版本`，不再采用此前的 `1.0.0` 提案。这是赛季版本约定，不宣称严格遵循以不兼容变更驱动主版本的 SemVer；同季出现不兼容配置或桥协议变更时，仍须独立升级 schema/API 并提供迁移说明。

| 发布阶段 | 版本约定 | 边界 |
| --- | --- | --- |
| FC26 归档 | 历史基线 `0.8.64`；离线准备 `0.8.65` | `0.8.65` 尚未发布，不能把改名后的过渡 metadata 当作已批准维护版 |
| FC27 隔离测试 | `27.0.0-alpha.N`、`27.0.0-beta.N`、`27.0.0-rc.N` | 显式安装测试渠道；按阶段开放能力，不覆盖稳定渠道 |
| FC27 首个正式版 | `27.0.0`，tag `v27.0.0` | 达到首版范围及真实页面验收后发布，不因 Web App 开放就直接宣称稳定 |
| FC27 后续更新 | 修复如 `27.0.1`，功能如 `27.1.0` | 同一产品持续升级，发行说明列出已支持与未支持模块 |
| 下一赛季 | FC28 从 `28.0.0` 开始 | 重新通过赛季能力验收，不仅更换版本号 |

`package.json` 继续是应用版本唯一来源；实施升版时同步 `package-lock.json`，由构建注入运行时版本并生成 userscript/meta，不手写第二份版本号。FSU 的 upstream/local version、FSU bridge API、配置 schema 和当前运行赛季各自独立，不能用 `27.0.0` 代替能力握手。上线前准备提交使用 Runner 维护版 `0.8.65`，历史归档仍为 `0.8.64`，FSU Local 保持 `26.09.6`。

原 `.github/workflows/release-assets.yml` 的无条件 `--latest` 已由上线前准备中的通道校验替代：预发布不进入 latest，旧季维护版不能夺取较新稳定版的 latest。当前 `check-release-readiness.mjs` 进一步阻断全部正式 Release，直到安装身份、新旧资产、FSU Local 版本和 P5 门禁完成。新增 Preview workflow 仅上传隔离 artifact，没有发布权限。通道算法已单测；远程 Actions 的实际结果另行核对。Tampermonkey 对预发布版本的排序、测试转正式的安装/更新行为仍要实测，不能以 npm 的版本比较替代。

#### 更名范围、已执行状态与剩余决策

仓库已在保留 Git 历史和所有者的前提下更名为 `ShatteredLancer/FCAutomationTool`，文件与构建链也已采用新前缀。改名不等于 FC27 兼容或安装迁移已验收。MIT 许可证和第三方归属保持不变；Runner userscript namespace 的最终选择仍是发布前待批准事项。

| 层面 | 目标 | 实施时核对位置 |
| --- | --- | --- |
| 产品展示 | `FC Automation Tool`；版本/赛季单独展示 | 面板、通知、日志导出、README 与使用文档 |
| GitHub 仓库 | `ShatteredLancer/DailyLoopRunner` 改为 `ShatteredLancer/FCAutomationTool` | 原仓库 Settings、各 clone 的 `origin`、`package.json` repository、README 徽章、Issue/Security 链接与发布地址 |
| 本地工作目录 | 各工作机可自行改名，不规定唯一绝对路径 | 编辑器工作区、终端、热加载服务、快捷方式和自动任务中的绝对路径；不重新初始化 Git |
| 生产 userscript | FC27 目标 `@name FC Automation Tool`；namespace 最终决策待批准 | `src/userscript-entry.js` 或新 FC27 entry 的 metadata，`scripts/check-dist.mjs` 的身份断言 |
| 包与资产 | 新文件名已采用 `FCAutomationTool.user.js`、`FCAutomationTool.meta.js`；npm 包名仍为 `fc26-daily-loop-runner` | `package.json`、lockfile、`scripts/build-userscript.mjs`、构建/校验与 Release workflow |
| 开发与可选配置 | 热加载、Profile 和配置下载名称已采用新产品前缀 | `FCAutomationToolHotReload.user.js`、`StartFCAutomationToolDevServer.ps1`、Profile 构建和发布清单、安装链接 |
| 历史与内部标识 | 仅在有必要时迁移，不全仓机械替换 `DLR` | 持久 key、旧 fixture、历史文档、FSU 桥与兼容合同；修改处有明确映射与测试 |

生产新资产使用新文件名，旧安装的更新地址不得静默改发新身份脚本。过渡期默认在后续稳定 Release 中继续提供冻结的 FC26 旧名 `.user.js/.meta.js` 资产，保持旧 `/releases/latest/download/DailyLoopRunner.*` 链接可解析；这是附带旧季归档资产，不是把旧业务打入 FC27。若后续停止附带，须先由旧身份维护版本迁往长期可访问的旧季地址并验收，不能直接删链接。已发布 Release 不覆盖，所有调整通过新版本/tag 交付。

#### 仓库改名、链接兼容与历史执行顺序

以下六步保留为改名审计记录：步骤 1、2、4 和文件/构建侧改名已经执行，步骤 3 的 FSU Local 版本迁移和步骤 6 的正式发布验收仍未完成。本节描述执行逻辑，不应再被解读为当前待办清单。

改名采用 GitHub Rename，不另建空仓库搬源码，不转移所有者，不重写提交/tag 历史。GitHub 官方说明仓库网页与旧地址的 clone/fetch/push 会重定向，Issues、Stars 等随原仓库保留 [S13]；仍须主动更新当前维护的链接，不能把重定向当作所有外部集成都兼容的证明。

需要区别三类标识：仓库 URL 是当前位置，userscript `@namespace` 是安装身份，GM/配置 key 是数据身份。主页、反馈、下载和更新地址已经改用 `https://github.com/ShatteredLancer/FCAutomationTool`；同时，改名提交也把 Runner `@namespace` 从旧仓库 URL 改成了新仓库 URL，而 `@name` 仍为 `FC26 Daily Loop Runner`。这偏离了初始“保留旧 namespace”的设计，当前由 Release 总阻断保护，不能视为已批准安装迁移。发布前必须明确选择并实测旧 FC26 升级或 FC27 全新安装的身份组合，再同步 metadata、`check-dist.mjs`、README 和资产。FSU 的原始名称与 `https://futcd.com/` namespace 均不变。

1. **准备基线与迁移窗口。** 在 P0 记录 FC26 最终 tag、分支、Release 资产及 SHA256，检查目标仓库名可用；清点硬编码 URL、外部集成与旧下载入口。需要仓库管理员明确执行/授权远程 Rename；本文记录计划不等于已授权改名。
2. **先准备代码和兼容资产。** 更新新入口的主页/反馈/更新地址、`package.json` repository、构建与发布校验、README 徽章及安装说明、`.github/ISSUE_TEMPLATE/config.yml` 的安全报告链接。同步检查 `.github/workflows/*` 中的名称、资产清单和仓库限制，预发布渠道仍不得进入 latest；旧名 FC26 资产按上一节保留。
3. **同步 FSU Local 更新渠道。** 检查 `FSU_mod/fsu-mod.config.json` 指向的维护输入及 `scripts/build-fsu-release-assets.mjs` 中的 URL 校验，迁往新仓库但保持 `FSU-Local.user.js/.meta.js` 文件名与上游安装身份。如发布 URL 发生变更，按独立 Local version 发布并重建 patch、manifest 和资产；不改不可变 `26.09` origin，不覆盖既有 Release，也不能仅修改构建校验而遗漏维护输入。
4. **执行远程改名并更新本地连接。** 准备项通过后将原仓库重命名为 `FCAutomationTool`，各 clone 使用 `git remote set-url origin https://github.com/ShatteredLancer/FCAutomationTool.git` 更新连接；以 `git remote -v` 和只读远程引用检查核对分支/tag。更新下载说明后保留旧入口兼容，不创建同名 `DailyLoopRunner` 占位仓库，因为复用旧名会破坏重定向 [S13]。
5. **按需更名本地目录。** 先停止引用旧路径的本地开发/热加载进程并关闭相关工作区，确认新路径不存在且范围准确后再移动目录；保留 `.git` 和全部未提交文件。重新打开新目录并调整相关本机路径，不全仓替换历史文档中的旧路径；完成前继续使用旧本地目录也不影响远程改名。
6. **完成独立验收后发布。** 验证新仓库主页、Issues/Security、CI 和 Release 权限；逐一检查旧仓库旧资产、新仓库旧资产、新仓库新资产及 FSU 下载/更新入口的最终响应与 metadata。再测 Tampermonkey 版本发现、安装、配置迁移、GM 保留边界和热加载，执行 `npm run verify`，全部通过后才发布 `27.0.0`。新稳定资产发布前应先在 draft/预发布验证内容；稳定发布后再复验真实 latest 地址。

重定向只改变仓库路径，不会把 `DailyLoopRunner.meta.js` 自动转换成 `FCAutomationTool.meta.js`。Release 资产路径、raw 下载与脚本管理器跟随重定向的行为需要分别验收；新仓库页面能打开不是通过标准。如使用 GitHub Pages 或将仓库作为 Action 供外部调用，它们还存在官方列出的重定向例外，必须专项迁移，不能假设当前仓库已经使用这些功能。

任何关键更新入口或身份迁移未通过时暂停正式发布，保留已发布资产与用户配置，不通过覆盖 Release、删旧资产或再次改 namespace 补救。必要回退先核对新旧仓库名占用、重定向和外部引用，再由管理员执行；不能保证把仓库改回旧名就自动恢复所有外部状态。

#### 历史方案：安装与配置迁移顺序

用户后来选择 FC27 全新安装，因此旧版配置导出/导入不再是首发前置条件。以下顺序仅保留为历史设计及未来可选迁移参考；正式安装仍必须禁用旧脚本、重新确认保护配置，并证明新旧实例不会并发写入。

改变 `@name` 可能被脚本管理器识别为新安装，不能保证原 GM 数据自动继承。按一次显式迁移设计，并实测全新安装、旧版升级、重复导入、中断恢复和测试版转正式版：

1. 停止旧 Runner，记录未决事务并保留原配置备份。冻结 FC26 是代码归档，不代表旧脚本可安全运行在 FC27；旧季未知状态不在新季重放。
2. 通过旧版导出入口导出可迁移配置；若现有入口不足，在独立旧季维护版提供最小导出能力。新脚本不能假定可以读取另一脚本的 GM 隔离存储。
3. 禁用旧脚本，再显式安装新版；新版本默认只读且交易未授权。新旧/测试脚本应有重复实例检测及写入互斥，但旧版不一定遵守新锁，所以不能省略人工禁用与页面确认。
4. 按 8.1 白名单导入。展示保护规则差异并确认，不导入旧卡片/SBC 身份、缓存、未决 journal 或 Trade armed 权限；不兼容项保留报告，原备份不删除。
5. 迁移记录绑定源/目标 schema，导入幂等且保留 last-known-good。中途失败时不写入半份配置、不自动开始运行；回退只恢复配置，不声称撤销 EA 已发生的操作。
6. Reward Alert 等凭证不进入普通导出文件，优先在新安装中重新填写并存入 GM；专门的安全迁移通道需要独立设计，禁止借页面 localStorage 中转。
7. 确认赛季/账号身份、有效保护、FSU 能力和旧脚本禁用状态后，再由用户开启已验收模块。新旧渠道分离、GM 保留/迁移和互斥检查全部通过才发布 `27.0.0`。

FSU 必须继续保留 `【FSU】EAFC FUT WEB 增强器` 与 `https://futcd.com/` 身份。Runner 与 FSU 的发布生命周期分开，普通 Runner 更新不应被迫重建/升级 FSU 补丁。

### 8.4 上游缺席期间：基于既有 FSU 的最小兼容补丁

2026-09-18 用户修正路线：原 `26.09.6` 大部分功能已经可用，应直接在原版上查漏补缺，优先原有一键填阵与价格显示。实机已确认未修改原版在 FC27 初始化成功、Club ready、原功能函数及设置存在。独立 Preview 停止扩展并退出默认安装；不以另写界面、策略和库存服务替代兼容修复。执行状态以 [FSU FC27 本地支持](../FSU_mod/FC27_LOCAL_SUPPORT_ZH.md) 为准。

目标是保留已经可用的功能、设置和用户习惯，仅修复实际观测到的 FC27 差异。Runner 自身的 FC27 精简架构继续推进，但不能把 Runner 重构扩展成重写 FSU。实际填阵/保存/提交仍按各自风险单独验收。

#### 已观察到的启动耦合

本地 `26.09_mod.user.js` 有以下实际依赖，决定了不能只把字符串 26 全部替换为 27：

- `futweb()` 内直接读取、覆盖大量 `UT...prototype`。例如约 1786 行集中读取旧页面方法，约 10875 行改写 `UTSBCService.loadChallengeData`，约 14159 行包装 `submitChallenge`。某个旧类不存在就可能在加载阶段抛错，影响与该功能无关的 Runner 支持。
- `unsafeWindow.info/events` 在约 18040 行才导出。后面的全局对象不存在，不必然表示 FSU 未安装，也可能是前面的无关页面增强中断了初始化。
- `events.init()` 把设置/锁卡初始化、导航栏、旧市场历史、第三方数据与 Club 加载连在一起；`info.base.year = APP_YEAR_SHORT` 在约 347 行，但 `lock.init()` 在它之前调用。
- `lock.init/save` 仍硬编码 `lock_26`；启动远程数据仍有 `api.fut.to/26/updata.json`、`meta.json`、`fast.json` 等，市场请求仍有 `/ut/game/fc26/`。这些地址不应自动猜成 `/27/` 后作为启动必需依赖。
- `events.validateClubPlayers` 在 `events.reloadPlayers()` 的内部才建立，后者同时包含 scoped capture、分页、缓存和大量诊断。不能简单跳过 `reloadPlayers` 就认为定向校验仍然存在。
- Runner 当前 `src/adapters/ea/fsu.js` 以旧 `info.build/base` 推断 readiness，并没有 FC27 能力握手。仅放一个空 `info.build` 或把 `base.state` 设为 true，不是适配。

这些是源码风险，不是已经在 FC27 实机复现的报错，更不能作为原版整体不可用的证据。原 `getPriceForUrl` 与网络探测还写死 `player-prices/26/`，应作为具体排查点；不可把全部远程 `/26/` 地址盲目换成未经证实的 `/27/`。

#### 当前修复顺序

1. 原版基线：专用浏览器使用原维护包，记录实际可用功能、具体异常和网络响应，不先替换实现。
2. 价格与一键填阵：沿原 UI -> 原函数 -> EA/第三方接口定位，先补失败 fixture/测试，只改失效字段、条件或请求；保持原保护与缓存不变量。
3. Runner 支持：优先映射既有 `info/events`、策略、readiness 和定向验证；确有缺口时再增加小接口，不再整套提取/复制 FSU 服务。
4. 生成与回归：修改维护源后递增 Local version，生成可重放 patch/manifest/资产，验证 FC26 原行为及 FC27 对应实机场景。上游 origin 不变，正式发布阻断不因局部修复自动解除。
5. 上游更新：取得新 immutable origin，逐项判定本地修复为“上游已解决 / 仍需保留 / 合同已变化”，删除重复修复，再重放和验收剩余小补丁。工具检查不等于自动语义合并。

下面的独立最小模式是**已停止执行的历史设计**，保留用于解释既有研究文件来源；“首版不安装原填阵”“FC27 不调用 futweb”“重做设置/库存核心”等决定均已被本节当前修复顺序替代，不能继续据此扩大 FSU 重构。

#### 历史首发能力边界（已替代）

| FSU 功能 | FC27 最小模式 | Runner 的对应职责 |
| --- | --- | --- |
| FSU GM 设置、Only Untradeable、排除联赛、OVR 保护输入 | 保留并做新 schema 映射，未知/冲突配置明确提示 | 显示有效政策，候选和提交前一致执行 |
| 锁卡 | 使用 FC27/账号隔离的锁卡集合，提供基本查看/锁定/解锁入口 | 继续按配置的 Lock 保护开关检查精确身份，不跨季复用 `lock_26` |
| Club 读取、readiness、定向验证 | 必须适配；先正确读取，再谈快速启动 | 消费快照，提交前重验，处理 drift |
| Storage/Unassigned/Transfer | 保留与 EA/Runner 库存契约兼容的读取支持 | 路由、容量、duplicate 和消费由 Runner 管理 |
| Provisional 持久缓存 | 首次可暂不启用；开启后必须保留精确校验 | 不把缓存等同于最新库存 |
| 原版填阵、Fast SBC、模板、旧 `submitChallenge` wrapper | 首版不安装 | 新积分选材/提交只由 Runner 事务实现；传统能力单独验收 |
| 市场买卖、价格、Meta、Evo 页面、包动画、其它页面增强 | 首版不安装，不阻塞核心初始化 | 缺价不触发自动买卡，不绕过高价值物品保护 |

FSU 最小模式不执行 SBC 提交、开包、交易或自动移动实体。EA 读取可能正常更新页面 Repository，但不可伪造实体或 broad capture 其它插件响应。拥有准确完整的当前库存并非一定要有持久缓存；冷启动的可靠读取可以先于缓存加速交付。

#### 历史解耦方式与拟改文件（不再执行）

1. 在本地 FSU 维护输入中引入小型独立的 bootstrap/core 入口，先安全读取运行年份与账号、加载 GM 策略，再建立桥接。FC27 分支不调用旧的完整 `futweb()`；FC26 旧实现继续留在冻结版本，避免逐个旧 prototype 打补丁成为首发前提。
2. 把设置、锁卡、Club 读取/定向验证和必要日志从旧闭包抽成少量可测试维护模块，例如 `FSU_mod/src/runner-support/*`。逐项复用现有算法与 fixture，不为减少行数丢弃真实请求归属或 missing 检查，也不另造通用插件框架。
3. 增加显式只读桥，例如 `FSULocalRunnerBridge`，版本化暴露 `describe()`、`getPolicy()`、`getClubState()`、`refreshClub()`、`validateClubPlayers(refs)`。方法名是拟议合同；桥只暴露所需数据/操作，不向页面开放通用 GM 存储读写或凭证。
4. `describe()` 至少含 bridge schema、支持赛季、实际账号 scope、状态、策略/锁卡/库存/定向校验能力。桥可以先以 not-ready 暴露进度，但只有成功加载的能力才标为可用。Runner 优先识别该桥；旧全局发现仅用于对应已支持环境，不会因桥失败自动降级到更弱校验。
5. `src/adapters/ea/fsu.js`、`src/config/fsu-compat.js`、`src/sbc/fsu-runtime-access.js` 及对应 fake/contract tests 接入能力协议。新积分流程不使用 FSU 原版填阵，因而不必为了接口“齐全”伪造 `beginProvisionalClubAccess`；确实需要该能力的传统调用方仍须显式检查。
6. `FSU_mod/fsu-mod.config.json` 继续管理 origin、维护输入和 Local version；按需扩展构建步骤以组装维护模块。`scripts/generate-fsu-patch.mjs`、`check-fsu-patch.mjs`、`build-fsu-release-assets.mjs` 同步验证可重放补丁、真实来源和发布身份。只编辑维护输入，不手工编辑 `dist`。

核心初始化不能再依赖旧导航栏/市场/全量增强成功。可选 hook 在探测真实对象与方法后才安装，且需验证语义，不以“函数存在”代替兼容证明。核心失败应给出具体 capability/error，不吞异常后宣称 ready。挂载和卸载保持幂等；若后续接回增强模块，只恢复自己仍拥有的 wrapper，不覆盖别的插件新安装的函数。

#### 历史独立核心分工与估时（不再执行）

| 阶段 | 可完成事项 | 验收 |
| --- | --- | --- |
| F0，Web App 未开放 | 已完成离线 core/桥、赛季/账号 key、独立构建与 fake tests；旧增强不进入新核心依赖图 | 无旧 Controller 环境可初始化；精确校验、属性变化、并发/超时/账号切换有测试；实际 EA/GM 接线仍在 F1/F2，当前生产 mod 不改 |
| F1，FC27 Web App 可登录 | 在未启用旧 FSU 增强的页面只读观测 EA Item/Club Service、DTO、factory、分页与响应；适配最小读取路径 | 取得真实脱敏 fixture；准确区分 Gold/Special/Holo/Evo/loan；无旧 `/fc26/` 业务请求；无猜测 `/27/` 数据源依赖 |
| F2，与 Runner 联调 | 读策略、锁卡、库存与定向校验；验证准确实体交给 Runner | 缺失/属性变化阻断；无关旧 UI 类缺失不影响；FC26 缓存不会进入 FC27；FSU 不自行提交 |
| F3，首发稳定后 | 依证据恢复持久缓存或少量常用增强 | 不改变桥合同；新增缓存需恢复 provisional 和完整失效测试；不以功能数量替代可靠性 |
| F4，上游 FSU 27 发布后 | 在独立分支对新 origin 重新适配桥与必要补丁，完整对比与实机验收 | 用上游实现替换已解决的本地 workaround；通过验证再升级，不因检测到上游新版本立即热切换 |

F0 可与 Runner P1 一起推进，F1/F2 是 Runner P2/P3 的依赖。先让最小 FSU core 读取与验证成功，再开放 Runner 的写操作，不能两个未经验证的适配层互相作“成功证据”。

工期增加主要在提取闭包依赖、桥合同与新 EA 库存读取，暂估额外 5-8 人日，部分与 P1/P2 重合。若 FC27 保留熟悉的 Service/DTO，可争取开放后数日内完成最小只读与联调；若改为新接口，不承诺当天可写。**可以摆脱等上游发布，但不能摆脱取得并验证 FC27 真实接口这个条件。**

#### 保留的版本与上游原则

过渡版仍标注真实来源 `upstreamVersion: 26.09`，Local version 按本地序列递增，例如从 `26.09.6` 到 `26.09.7`，同时由独立字段/说明声明“FC27 minimal compatibility”。这个例子不锁定未来版本号；不能把 upstreamVersion 改成尚不存在的 27 来表示兼容，也不能通过版本字符串推断支持年份。

上游 27 到达后新建其不可变 origin，再生成对应 Local 版本和补丁。同一 FSU `@name/namespace` 维持 GM 设置，用户使用原安装的本地维护更新渠道，避免同时安装官方与本地两个 FSU 实例。回接上游仍保留桥作为窄兼容层；上游新增的 Common/Rare 替代字段、锁卡存储和库存策略需重新映射，不能直接恢复全部旧 settings。

最终收敛为“上游 FSU 27 + 少量必要 Local 修复 + 稳定 Runner bridge”，删除已经没有必要的临时兼容模块。若上游长期不更新，最小模式本身也必须可独立维护，不靠无限期扩大本地 FSU 功能维持 Runner。

### 8.5 自动浏览器检查与证据采集

2026-09-17：已增加原生自动采集与 Agent 持续会话，用户不再需要反复执行命令、按 Enter 或转贴报告。当前实机结果、传统 SBC 优先顺序和未完成门禁统一见 [上线后适配记录](FC27_LIVE_ADAPTATION_ZH.md)；下表的阶段划分继续有效，历史“未登录”描述不代表最新进度。

主路径是 **专用可见浏览器配置目录 + 用户登录 + 自动检查同一会话**，而不是只让用户反复导出 HAR。可选用 Playwright 持久上下文，或通过 CDP 连接专用 Chrome/Edge；实施时选定一种可用工具链，先验证浏览器和 Tampermonkey/FSU 的组合，不默认安装全部工具。浏览器控制器是开发诊断工具，不进入生产 userscript 或默认运行依赖。

#### 登录与会话边界

- 用户在本机浏览器完成账号密码、二次验证和必要的人机验证；不要求把密码/token 发到聊天或写入项目，不绕过登录挑战。
- 登录态有效时，自动化可以复用该专用会话继续检查；失效或出现验证时暂停并交回用户，不承诺永久无人值守登录。
- 不复制日常浏览器 profile 或提取其中的凭证。CDP 使用独立 `user-data-dir`，调试监听仅限本机回环地址，不开放到局域网/公网；检查结束关闭监听。Chrome 136 起默认数据目录的远程调试行为受限，须按官方要求使用非默认目录 [S12]。
- 持久 profile 包含登录与扩展敏感数据，保存在仓库外的专用本机目录，不同步或提交。Playwright 的 `storageState` 不是完整 profile，不能假定它包含全部 sessionStorage、扩展 GM 设置或设备会话状态 [S10]。
- 首轮优先可见浏览器，方便用户登录、确认页面和插件是否真正加载。验证可见/无头模式的会话、扩展、页面能力一致后，才把稳定的只读回归移至 headless；不是认定无头浏览器不能运行扩展。Playwright 的扩展支持有 persistent context 与浏览器发行版限制，应按当前官方支持方式配置 [S11]。

#### 开服后的执行流程

| 步骤 | 自动检查内容 | 产出与停止条件 |
| --- | --- | --- |
| B0 环境准备 | 已建立独立 Playwright 工具、专用目录、固定只读探针和网络摘要；Chrome 离线 smoke 已通过 | 未登录 EA；真实扩展组合与旧任务禁用须上线后执行交互检查，不能以离线 smoke 声称已兼容 EA |
| B1 用户登录后建基线 | 确认真实 Web App 已就绪、运行赛季、账号上下文与页面版本 | 脱敏环境摘要；维护页、身份未知、登录过期立即停止，不尝试提交探测 |
| B2 原生页面只读检查 | 按白名单查看库存、挑战列表/详情和已确认无写副作用的预览；读取 DOM、可见积分及运行时对象结构 | EA 原生基线：item/pile/eligibility/积分/奖励字段、Repository/DAO/Controller 的存在性与来源；未知字段保持未知 |
| B3 请求与模型关联 | 观察上述操作自然产生的请求/响应、时间和页面状态；比对积分预览与对应 DTO、实体 | 精确 request/response 关联和最小字段样本；不靠时间接近把其他插件请求归属给 FSU |
| B4 分层加载本地兼容版 | 原生基线通过后，依次测试最小 FSU、FSU+新版 Runner 只读模式，最后才加入经验证的 Enhancer | 每层独立 capability 报告；策略、readiness、定向复核语义不符即停，不把两个错误适配层互相印证 |
| B5 固化证据与离线回归 | 将必要字段脱敏为 fixture，与页面预览作差异对比，再测试 Adapter/Planner | 记录已确认、推测、缺失能力及拟改文件；仅方法存在或 HTTP 200 不能证明业务合同 |
| B6 单独授权的低价值实测 | 经用户确认目标、材料/金币上限与次数后，验证单次贡献、奖励、移动或交易的必要场景 | 操作前后精确对账；部分成功或结果不明立即停止，不为取证盲目重复操作；通过后才能扩到多轮 |

“只读”按实际副作用判断，不是按 HTTP 方法或按钮名称判断。不得遍历调用未知 getter/service 方法、自动点击可能保存的预览入口，或把直接修改 Repository 当成读取。先检查描述符/已知字段与被动网络证据；只有确认无写副作用的读取/导航才进入白名单。刷新和扫描也应有界、串行且限速，遇到登录挑战或 429 停止，不能持续轮询制造压力。

#### 采集范围、脱敏与降级

优先导出有界的能力 JSON、请求阶段摘要、必要截图和最小 replay fixture；每份注明采集时间、Web App/浏览器/FSU/应用版本与启用组合。只截取相关区域，清除账号名、余额等无关私人信息；不导出完整卡库或任意页面全局对象。

Cookie、Authorization、会话 token、密码、真实账号/persona 标识不得进入共享日志、fixture、HAR 或 Git。物品身份使用一一对应的替代 ID，保留跨快照关系和 duplicate 指向；必要时连同可识别账号的库存组合进一步裁剪。网络采集按字段白名单过滤，不把完整请求头/响应体先打印到终端或交给模型再脱敏。默认不录制全量 trace/HAR；确有必要的原始采集需另行限定范围，保存在私有本机目录，脱敏检查后才共享。

HAR 是请求/响应证据的补充或浏览器控制不可用时的备用路径；它不能完整表示页面内方法、FSU GM 设置、DAO 状态和回调时序，也不能单独证明一次消耗是否完成。无法连接自动控制时，由用户提供已脱敏 HAR、相关截图及有界诊断导出，仍按同一证据标准分析，不因缺工具猜测接口。

已新增离线证据合同 `src/fc27/prelaunch-contract.js` 及单元测试，只投影固定白名单字段，不再遍历任意对象做通用脱敏。`scripts/browser-inspection/` 已具备专用浏览器启动和只读探针，开发依赖单独锁定于 `tools/browser-inspection/`；实际 Chrome 的本地合成页面验证通过，未登录 EA。真实 DTO、积分字段、接口时序仍必须等 FC27 Web App 可访问后确认。

## 9. 分阶段交付

Android Companion APK 备用路线见 [备用方案](ANDROID_COMPANION_APK_FALLBACK_ZH.md)。它仅在 Web App 无法满足需求、用户确认转向且 FC27 Companion 提供对应能力后评估；当前只记录 FC26 静态证据，不改变主路线或解除 `27.0.0` 发布门禁。最新截图仅承诺 Streamlined SBC 首发主机/PC、计划第一赛季稍后进入 Companion，未承诺 Web App 同步支持；P3/P4 的网页实施以前述能力核实为前提，不能靠客户端改包补出未开放的服务。

估算按熟悉本仓库的一名开发者计算，为开发与验证工作量，不包含等 Web App、FSU 或账号测试窗口；EA 接口变化可能扩大估算。先完成前两阶段，再用真实证据校准后续工期。

| 阶段 | 工作 | 交付与验收门禁 | 粗估 |
| --- | --- | --- | --- |
| P0 冻结与设计收口 | FC26 本地归档 tag/维护分支、基线检查、功能处理与迁移清单 | Complete（原实施工作区）；归档 refs 未 push，仓库改名已在后续步骤完成 | 1-2 人日 |
| P1 瘦身骨架 | 独立 Preview composition/build、依赖白名单、上下文/schema、白名单配置迁移、发布隔离、FSU F0/B0 | Complete（离线骨架）；未知身份及所有 FC27 Live 操作仍阻断；生产入口保持不变，实际账号/GM 与安装 UI 在 P2/P5 接线验收 | Runner 2-3 人日，FSU 另列 |
| P2 上线只读勘察 | 用户登录后执行 B1-B5；读取 FC27 item、SBC、积分预览、奖励、pile；完成 FSU F1/F2；采集脱敏 fixture | 2026-09-17 进行中：已读取原生 Set/Challenge、阵容 brick、账号作用域和 41/41 fresh Club，两卡定向回读通过；尚缺真实 GM/完整保护策略、其它 pile 和事务证据，见上线后适配记录 | Runner 2-4 人日，需 Web App |
| P3 积分 MVP | 单挑战 Preview、单次/分批贡献、材料保护、超额预算、journal 与重载恢复 | 等网页实际提供积分 SBC 再实施；不阻塞传统 SBC 只读和受控单次验证；积分未观测时不得猜模型 | 4-6 人日，能力开放后重估 |
| P4 奖励与连续循环 | Pack/Pick 处理、单步补料、容量预留、保守预算、Stop/Start 续跑 | 先覆盖已确认奖励，再多轮循环；手动领 Pick 后可续跑；没有未对账状态就开下一包的路径 | 3-5 人日 |
| P5 传统能力与发布收口 | 只开放已支持传统合同；精简配置/Profile；文档、架构、体量与真实页矩阵；完成安装身份与资产验收后发布 `27.0.0` | 全验证通过；旧链接、新资产和 FSU 更新渠道可用；未知化学/条件保持 unsupported；全新安装/预发布转正式/跨账号/插件组合测试完成；新旧实例不并发写入 | 3-5 人日 |
| P6 按需求扩展 | Trade、新 Builder、Gallery 只读信息、长期 Player SBC 目标规划、更多奖励类型 | 每个独立设计、预算、验收，不为“功能对齐 FC26”默认全部恢复 | 另估 |

Runner 核心原估 15-25 人日；加入本地 FSU 首发支持并考虑重叠工作后，组合工程原暂按约 20-30 人日、4-6 周有效工作时间安排。本次增加安装迁移、渠道隔离和浏览器采集工具，暂留额外 2-4 人日，合计约 22-34 人日，在 P0/P2 按真实依赖重估。不是“开服当天全功能可用”的承诺。可以先交付 P2 只读兼容组合，再交付 P3 小范围可提交组合，最后开放连续运行；不需要等上游 FSU 27 才开始。

### 9.1 首版功能优先级

必须有：动态挑战列表、当前/目标积分、确切材料预览、保护规则、单次完成与部分贡献对账、Pack/Pick 奖励确认、明确停止状态、F5/Stop 后恢复、日志导出、受控连续 Upgrade。

首版不做：旧 FC26 85/86x10 Rolling、旧 Provisions/Required Special/Storage sink 配方、实验 Swap、全自动复杂化学求解、自动买卡补分、完整 Trade Scheduler、全功能可视化 Builder、Gallery 自动收藏/代币兑换、自动 Evo 路径执行。

Player SBC 长期部分投入默认仅手动预览/明确批准，不让重复卡自动清理选择任意 Player 目标。新奖励类型先做到正确识别与保留，只有领取合同验证后才自动化。

## 10. 瘦身验收指标

这些是实施目标，不是已经取得的收益；P1 应根据 esbuild metafile 明确默认包的真实依赖成本。

- FC27 entry 最终只保留 composition、生命周期与命令绑定，目标不超过 800 行；不能通过另建一个 2 万行 `runtime.js` 达标。
- 默认包对 FC26 专用 Rolling、Trade Scheduler、完整 Builder 的依赖数为零，以构建依赖图和 architecture tests 证明，不只靠 UI 隐藏。
- 使用与当前相同的未压缩构建条件，默认 Runner 目标不超过 1.8 MB，相对当前 2.97 MB 约减少 40%。若必要安全组件导致超标，应公开模块成本再调整范围，不删验证逻辑凑数字。
- FC27 默认运行路径对应的活动源码目标控制在约 4 万行内。该口径排除测试、生成物、归档和可选构建；不得与上面全 `src` 行数混算成已实测下降比例。
- 每个新业务模块有明确责任；超过约 800 行触发边界复查，但不机械拆分纯表格或适配映射。
- Telemetry 不运行选材 solver，不克隆完整库存；日志、journal、recap、计划缓存保持有界。用 10,000 物品和长时间多轮模拟验证内存不随轮数无界增长。
- 库存能力只做线性计数；真实积分规划只在决策点执行。P2 固定真实积分规模后设置性能预算，超时不报成材料不足。
- 不为可选功能引入远程动态代码加载；若将来提供高级构建，默认互斥安装并共享同一核心源码，不能在两个脚本里复制提交事务。

压缩只能是第二步的下载/解析优化，许可证与发布可审计性仍须保留。第三方开源归属、FSU origin、历史 fixture 不能为了数字变小而删除。

## 11. 验证矩阵与发布阻断项

复用现有测试基础，但区分“跨季仍成立的安全不变量”和“FC26 专属玩法断言”。不是把旧测试期望统一改成 FC27 就算通过。

| 场景 | 必须证明 |
| --- | --- |
| 积分精确达标、超额、无法达标、单卡最低 OVR | 计划与实时预览一致，不多花保护预算，不用旧 squad rating 代算 |
| 相同 definition 多张实体、不同 Holo/Evo 版本 | 重复实体不消费两次；可重复版本按新合同处理；特殊版本不被合并 |
| 部分提交后 F5、响应丢失、完成后进度归零 | 根据实体/进度/轮次/奖励对账，不重复投入、不漏奖励 |
| pending Pick、已领取但路由失败、用户手动领取 | 已完成结果保留，重启刷新后继续；无精确奖励身份不猜领 |
| Storage 满/容量未知、全重复包、Transfer 满 | 不扩大阻塞，不牺牲保护卡；直接 pile 提交只在真实能力允许时使用 |
| 缓存 stale、定向缺卡、FSU loading/provisional | 保存/贡献前拒绝过期实体；重规划由统一边界触发 |
| 人工更改库存、换账号、跨季旧 journal、多标签并发 | 旧计划失效，账号数据隔离，未决操作不能被覆盖 |
| HTTP 409/429/500、callback 丢失、延迟 Repository | 区分拒绝、冷却与结果不明；不重试已生效 mutation |
| 新 Traditional、未知 eligibility、活动到期/每日重置 | 不走错引擎、不复用旧活动身份，未支持条件停止 |
| Dry Run、Stop、Preview、日志异常 | 零写副作用或在当前不可中断对账结束后停；诊断不改变业务 |
| 更名安装、配置导入中断、重复导入、旧版/测试版并存 | 原数据保留，迁移幂等，保护不变宽，凭证不进普通导出，新旧实例不同时写入 |
| alpha/beta/rc 转正式、旧季维护发布、旧安装更新地址 | 预发布不进入 latest；`27.0.0` 安装/更新路径可用；旧链接不失效、不静默改发新身份 |
| 仓库改名、本地目录变更、新旧资产 URL 与 FSU 渠道 | 历史与工作区数据保留；remote/CI/热加载可用；重定向后的资产内容正确；namespace 不误改；旧仓库名不复用 |
| 自动浏览器采集、登录失效、原生/插件组合与 headless 差异 | 只读白名单不产生业务写入；凭证不泄漏；验证挑战暂停；不把另一组合的结果当兼容证据 |

先补脱敏 fixture 和失败测试，再实现对应行为；完整执行 `npm run verify` 与 `git diff --check`。逐步添加 points oracle/differential、transaction replay、workflow 和 build dependency tests，直接 EA 写调用继续集中在 Adapter。

真实页先验证少量低价值材料和单次操作，经用户确认后才测多轮。不为测试主动提交高价值卡，也不为复现网络异常冒险重复发送真实请求。离线故障注入覆盖不能替代真实页确认，但可减少账号风险。

以下任一未解决就不能发布自动连续模式：积分来源不确定、超额结算不明、实体不能精确定位、部分提交无法对账、奖励会重复领取/遗漏、新特殊卡保护不完整、账号/赛季身份未知时仍可写入。

## 12. 当前可立即开展与必须等待的工作

已经确定并记录的方向：产品和远程仓库已更名为 `FC Automation Tool` / `ShatteredLancer/FCAutomationTool`，FC27 首个正式版本为 `27.0.0`；主取证流程为用户登录专用浏览器后自动检查，HAR 仅作为补充/备用。上线前离线准备和改名已经完成，具体状态见[实施记录](FC27_PRELAUNCH_PROGRESS_ZH.md)与[收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)；EA 账号操作、真实 FC27 接口验收和正式 Release 尚未执行。

已实施：FC26 本地基线归档、新入口/只读门禁与依赖白名单、独立 FSU Runner-support core、配置迁移存储与保护 review、发布通道隔离、B0 浏览器探针及相关测试。旧季业务不进入 Preview，但尚未从生产源码删除；真实功能替换验收后才清理旧路径。

必须等待真实 Web App：积分表与资格来源、贡献 API/返回时序、允许的提交 pile、partial/overflow/repeat 语义、奖励链、Holo/Evo 实体身份、新 FSU/Enhancer 并发行为。

EA 已公布 Community API，但本次官方说明只列 FUT.GG、FUTBIN、FUTWIZ 三个获准合作方，并表示暂不开放更多网站 [S4]；没有公开 SBC 写 API 的证据。因此不能把“改用官方 API”作为当前可执行方案，也不能因第三方得到访问权就假定 Runner 得到授权。自动化仍需用户了解 EA 规则与账号风险，不作无风险保证。

下一实机步骤是在 FC27 Web App 开放并由用户登录后进行 P2、FSU F1/F2 与浏览器 B1-B5；B6 的真实消耗须另行明确授权。上线前可继续维护这些离线门禁和 fixtures，不需要再在“离线准备”和“未上线的完整业务适配”之间二选一。

## 13. 资料与审计入口

### 在线资料

- [S1 EA FC27 FUT Deep Dive，2026-08-02](https://www.ea.com/games/ea-sports-fc/fc-27/news/pitch-notes-fc27-fut-deep-dive)：SBC、Gallery、Holographic、Item Rarity、Evolution、奖励规则的主要一手来源。
- [S2 EA Web App 官方页面](https://www.ea.com/ea-sports-fc/ultimate-team/web-app/)：调研时显示为准备 FC27 维护。
- [S3 EA FC27 Closed Beta Feedback Update，2026-09-03](https://www.ea.com/games/ea-sports-fc/fc-27/news/fc-27-closed-beta-feedback-update)：发行日期与后续 FUT Launch Update 预告，不提供新积分细表。
- [S4 EA Community API Update，2026-07-27](https://www.ea.com/games/ea-sports-fc/fc-27/news/pitch-notes-fc26-community-api-update)：当前合作方与开放范围；标题为 FC26，位于 FC27 news 路径。
- [S5 FUT.GG Streamlined SBCs，2026-08-02](https://www.fut.gg/news/what-are-streamlined-sbcs-in-ea-fc-27-new-ultimate-team-feature-explained/)：对积分、重复、部分提交的独立解读，不作为接口证据。
- [S6 FUT.GG Holographic Cards，2026-08-02](https://www.fut.gg/news/what-are-holographic-cards-in-ea-fc-27-new-ultimate-team-rarity-explained/)：Holo 变体与 Gallery 的补充解读。
- [S7 FSU 版本历史](https://greasyfork.org/zh-CN/scripts/431044/versions)。
- [S8 FSU 25.23 历史源码，version=1648415](https://greasyfork.org/zh-CN/scripts/431044/code?version=1648415)。
- [S9 FSU 26.01 历史源码，version=1669985](https://greasyfork.org/zh-CN/scripts/431044/code?version=1669985)。
- [S10 Playwright Authentication](https://playwright.dev/docs/auth)：登录状态复用与敏感状态文件保护。
- [S11 Playwright Chrome Extensions](https://playwright.dev/docs/chrome-extensions)：持久上下文、扩展加载与 headless 支持条件。
- [S12 Chrome Remote Debugging Changes](https://developer.chrome.com/blog/remote-debugging-port)：Chrome 136 起默认 profile 限制与独立数据目录要求。
- [S13 GitHub Renaming a Repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)：仓库重命名、Git/网页重定向、旧名复用风险及 Pages/Action 例外。

访问方式：EA 页面直连成功；Greasy Fork 直连超时后使用用户指定的 `http://127.0.0.1:1080` 代理，FUT.GG 同样通过该代理读取。本次未取得精确积分表，不引用未验证的社交媒体传闻补齐未知规则。

### 本地审计入口

- [AGENTS.md](../AGENTS.md)、[REFACTORING_MILESTONES.md](REFACTORING_MILESTONES.md)、[FSU Club 集成合同](../FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)。
- [入口与运行时桥](../src/userscript-entry.js)、[物品与库存契约](../src/domain/contracts.js)、[策略注册](../src/domain/strategies.js)。
- [持久 key](../src/config/runtime.js)、[SBC Adapter 与 cacheScope](../src/adapters/ea/sbc.js)、[构建脚本](../scripts/build-userscript.mjs)。
- [应用版本来源](../package.json)、[发布身份校验](../scripts/check-dist.mjs)、[Release workflow](../.github/workflows/release-assets.yml)、[热加载脚本](../FCAutomationToolHotReload.user.js)。
- [FSU Local 发布校验](../scripts/build-fsu-release-assets.mjs)、[FSU 维护配置](../FSU_mod/fsu-mod.config.json)、[Issue/Security 入口](../.github/ISSUE_TEMPLATE/config.yml)。

本文同时维护方案和实施状态。上线前准备新增了隔离代码、测试、浏览器开发工具、本地归档引用与 CI 通道门禁；仓库和文件已改名，应用版本已升至未发布的 `0.8.65`，但完整脚本的 FC26 业务逻辑未被替换。当前没有正式 Release 或 EA 账号操作，Runner 安装身份与 FSU Local 升版仍由发布门禁阻断，后续状态以[收尾清单](FC27_PRELAUNCH_CLOSEOUT_ZH.md)为准。
