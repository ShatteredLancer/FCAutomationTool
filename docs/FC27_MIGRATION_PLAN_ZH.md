# FC27 迁移评估与实施计划

调研日期：2026-09-14。仓库基线：`0558f7b`，Runner `0.8.64`。

状态：评估提案，尚未实施。本文不授权更改当前 FC26 安全合同、发布身份或执行账号操作。引用的线上信息以调研日可访问版本为准；FC27 Web App 的真实接口验收尚未发生。

## 1. 结论与路线选择

建议：**同一仓库、同一产品延续，冻结 FC26，面向 FC27 做一次有边界的大版本迁移。复用通用安全组件，重做积分 SBC 业务，不把旧 Rolling 整体搬过去。**

| 方案 | 优点 | 主要代价 | 判断 |
| --- | --- | --- | --- |
| 另建仓库，从零实现 | 可以完全摆脱旧结构 | 丢失或重新实现库存身份、提交对账、开包确认、Pick、保护和测试，容易重踩线上问题 | 不推荐 |
| 在当前入口与 Rolling 上不断增加 FC27 分支 | 初期看似改得少 | 两套 SBC 规则、旧活动恢复链和配置迁移永久混杂，继续扩大入口与测试组合 | 不推荐 |
| 同仓库冻结旧季，提取可复用部分，新增 FC27 运行入口和业务引擎 | 保留已验证经验，可真正停止加载旧业务，可分阶段验证 | 需要先明确边界、迁移配置，再接实时接口 | 推荐 |

这不是要求同时维护 FC26/FC27 双运行时。FC26 最终版本留在 Git tag/维护分支；FC27 默认发布包不导入 FC26 专用业务。迁移过程中可以短期并存源码与测试，完成替换后从主开发路径移除旧业务，历史由 Git 保留。

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

建议保留仓库、更新渠道和产品历史，FC27 稳定版可使用 `1.0.0`，但只在真实验收后升版。`package.json` 继续是唯一版本来源。

最少迁移风险的首发方案是暂时保留现有 Tampermonkey `@name`、namespace 和 URL，在面板标题与 description 标注 FC27。当前 `@name` 含 FC26，长期改成中性 `Daily Loop Runner` 很合理，但那是单独的安装身份迁移，不能仅改 metadata 后假定 GM 数据会自动继承。

测试渠道可以单独分发、显式安装，但必须禁止旧版与测试版同时操作账号。正式升级前提供迁移说明并先完成赛季门禁；不把未验收测试包推到现有生产更新地址。冻结 FC26 是代码归档，不代表旧脚本在 FC27 页面运行安全。

FSU 必须继续保留 `【FSU】EAFC FUT WEB 增强器` 与 `https://futcd.com/` 身份。Runner 与 FSU 的发布生命周期分开，普通 Runner 更新不应被迫重建/升级 FSU 补丁。

### 8.4 上游缺席期间：本地 FSU FC27 最小兼容版

目标不是在开服前自行升级 FSU 的全部功能，而是尽快交付“足够支撑新版 Runner 的 FSU”。不维护第二套积分 Solver，不要求价格、Evo 预览、模拟开包、原版 One-click Fill 全部可用。

#### 已观察到的启动耦合

本地 `26.09_mod.user.js` 有以下实际依赖，决定了不能只把字符串 26 全部替换为 27：

- `futweb()` 内直接读取、覆盖大量 `UT...prototype`。例如约 1786 行集中读取旧页面方法，约 10875 行改写 `UTSBCService.loadChallengeData`，约 14159 行包装 `submitChallenge`。某个旧类不存在就可能在加载阶段抛错，影响与该功能无关的 Runner 支持。
- `unsafeWindow.info/events` 在约 18040 行才导出。后面的全局对象不存在，不必然表示 FSU 未安装，也可能是前面的无关页面增强中断了初始化。
- `events.init()` 把设置/锁卡初始化、导航栏、旧市场历史、第三方数据与 Club 加载连在一起；`info.base.year = APP_YEAR_SHORT` 在约 347 行，但 `lock.init()` 在它之前调用。
- `lock.init/save` 仍硬编码 `lock_26`；启动远程数据仍有 `api.fut.to/26/updata.json`、`meta.json`、`fast.json` 等，市场请求仍有 `/ut/game/fc26/`。这些地址不应自动猜成 `/27/` 后作为启动必需依赖。
- `events.validateClubPlayers` 在 `events.reloadPlayers()` 的内部才建立，后者同时包含 scoped capture、分页、缓存和大量诊断。不能简单跳过 `reloadPlayers` 就认为定向校验仍然存在。
- Runner 当前 `src/adapters/ea/fsu.js` 以旧 `info.build/base` 推断 readiness，并没有 FC27 能力握手。仅放一个空 `info.build` 或把 `base.state` 设为 true，不是适配。

这些是源码风险，不是已经在 FC27 实机复现的报错。

#### 首发能力边界

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

#### 解耦方式与拟改文件

1. 在本地 FSU 维护输入中引入小型独立的 bootstrap/core 入口，先安全读取运行年份与账号、加载 GM 策略，再建立桥接。FC27 分支不调用旧的完整 `futweb()`；FC26 旧实现继续留在冻结版本，避免逐个旧 prototype 打补丁成为首发前提。
2. 把设置、锁卡、Club 读取/定向验证和必要日志从旧闭包抽成少量可测试维护模块，例如 `FSU_mod/src/runner-support/*`。逐项复用现有算法与 fixture，不为减少行数丢弃真实请求归属或 missing 检查，也不另造通用插件框架。
3. 增加显式只读桥，例如 `FSULocalRunnerBridge`，版本化暴露 `describe()`、`getPolicy()`、`getClubState()`、`refreshClub()`、`validateClubPlayers(refs)`。方法名是拟议合同；桥只暴露所需数据/操作，不向页面开放通用 GM 存储读写或凭证。
4. `describe()` 至少含 bridge schema、支持赛季、实际账号 scope、状态、策略/锁卡/库存/定向校验能力。桥可以先以 not-ready 暴露进度，但只有成功加载的能力才标为可用。Runner 优先识别该桥；旧全局发现仅用于对应已支持环境，不会因桥失败自动降级到更弱校验。
5. `src/adapters/ea/fsu.js`、`src/config/fsu-compat.js`、`src/sbc/fsu-runtime-access.js` 及对应 fake/contract tests 接入能力协议。新积分流程不使用 FSU 原版填阵，因而不必为了接口“齐全”伪造 `beginProvisionalClubAccess`；确实需要该能力的传统调用方仍须显式检查。
6. `FSU_mod/fsu-mod.config.json` 继续管理 origin、维护输入和 Local version；按需扩展构建步骤以组装维护模块。`scripts/generate-fsu-patch.mjs`、`check-fsu-patch.mjs`、`build-fsu-release-assets.mjs` 同步验证可重放补丁、真实来源和发布身份。只编辑维护输入，不手工编辑 `dist`。

核心初始化不能再依赖旧导航栏/市场/全量增强成功。可选 hook 在探测真实对象与方法后才安装，且需验证语义，不以“函数存在”代替兼容证明。核心失败应给出具体 capability/error，不吞异常后宣称 ready。挂载和卸载保持幂等；若后续接回增强模块，只恢复自己仍拥有的 wrapper，不覆盖别的插件新安装的函数。

#### 开服前与开服后的分工

| 阶段 | 可完成事项 | 验收 |
| --- | --- | --- |
| F0，Web App 未开放 | 提取最小 core、设计桥、赛季/账号 key、冻结旧增强入口、构建与 fake tests | 删除模拟环境中的旧 SBC/市场/Evo Controller 后 core 仍能初始化；核心读取能力缺失则明确 not-ready；零 EA mutation |
| F1，FC27 Web App 可登录 | 在未启用旧 FSU 增强的页面只读观测 EA Item/Club Service、DTO、factory、分页与响应；适配最小读取路径 | 取得真实脱敏 fixture；准确区分 Gold/Special/Holo/Evo/loan；无旧 `/fc26/` 业务请求；无猜测 `/27/` 数据源依赖 |
| F2，与 Runner 联调 | 读策略、锁卡、库存与定向校验；验证准确实体交给 Runner | 缺失/属性变化阻断；无关旧 UI 类缺失不影响；FC26 缓存不会进入 FC27；FSU 不自行提交 |
| F3，首发稳定后 | 依证据恢复持久缓存或少量常用增强 | 不改变桥合同；新增缓存需恢复 provisional 和完整失效测试；不以功能数量替代可靠性 |
| F4，上游 FSU 27 发布后 | 在独立分支对新 origin 重新适配桥与必要补丁，完整对比与实机验收 | 用上游实现替换已解决的本地 workaround；通过验证再升级，不因检测到上游新版本立即热切换 |

F0 可与 Runner P1 一起推进，F1/F2 是 Runner P2/P3 的依赖。先让最小 FSU core 读取与验证成功，再开放 Runner 的写操作，不能两个未经验证的适配层互相作“成功证据”。

工期增加主要在提取闭包依赖、桥合同与新 EA 库存读取，暂估额外 5-8 人日，部分与 P1/P2 重合。若 FC27 保留熟悉的 Service/DTO，可争取开放后数日内完成最小只读与联调；若改为新接口，不承诺当天可写。**可以摆脱等上游发布，但不能摆脱取得并验证 FC27 真实接口这个条件。**

#### 版本与后续接回

过渡版仍标注真实来源 `upstreamVersion: 26.09`，Local version 按本地序列递增，例如从 `26.09.6` 到 `26.09.7`，同时由独立字段/说明声明“FC27 minimal compatibility”。这个例子不锁定未来版本号；不能把 upstreamVersion 改成尚不存在的 27 来表示兼容，也不能通过版本字符串推断支持年份。

上游 27 到达后新建其不可变 origin，再生成对应 Local 版本和补丁。同一 FSU `@name/namespace` 维持 GM 设置，用户使用原安装的本地维护更新渠道，避免同时安装官方与本地两个 FSU 实例。回接上游仍保留桥作为窄兼容层；上游新增的 Common/Rare 替代字段、锁卡存储和库存策略需重新映射，不能直接恢复全部旧 settings。

最终收敛为“上游 FSU 27 + 少量必要 Local 修复 + 稳定 Runner bridge”，删除已经没有必要的临时兼容模块。若上游长期不更新，最小模式本身也必须可独立维护，不靠无限期扩大本地 FSU 功能维持 Runner。

## 9. 分阶段交付

估算按熟悉本仓库的一名开发者计算，为开发与验证工作量，不包含等 Web App、FSU 或账号测试窗口；EA 接口变化可能扩大估算。先完成前两阶段，再用真实证据校准后续工期。

| 阶段 | 工作 | 交付与验收门禁 | 粗估 |
| --- | --- | --- | --- |
| P0 冻结与设计收口 | 确认 FC26 tag/维护分支；记录当前测试与 bundle；锁定首版范围、数据迁移和安装身份 | 完整基线验证；列出 FC26 专属依赖；得到用户对减法范围的确认 | 1-2 人日 |
| P1 瘦身骨架 | 新 FC27 composition；独立构建入口；Trade/Builder/FC26 业务不进入默认 import；赛季/账号与配置 schema；启动 FSU F0 | 未识别赛季零 EA mutation；新默认包没有旧业务；FC26 回归基线不被改坏；FSU core 不依赖旧 UI 类 | Runner 2-3 人日，FSU 另列 |
| P2 上线只读勘察 | 读取 FC27 item、SBC、积分预览、奖励、pile；完成 FSU F1/F2；采集脱敏 fixture | Streamlined/Traditional/unsupported 精确识别；积分与页面预览一致；本地 FSU 策略/库存/定向校验可用；未知条件禁用；零 mutation | Runner 2-4 人日，需 Web App |
| P3 积分 MVP | 单挑战 Preview、单次/分批贡献、材料保护、超额预算、journal 与重载恢复 | 小额受控测试确认消耗/进度；模拟丢响应不重交；同 definition 多实体与高价值卡保护通过 | 4-6 人日 |
| P4 奖励与连续循环 | Pack/Pick 处理、单步补料、容量预留、保守预算、Stop/Start 续跑 | 先覆盖已确认奖励，再多轮循环；手动领 Pick 后可续跑；没有未对账状态就开下一包的路径 | 3-5 人日 |
| P5 传统能力与发布收口 | 只开放已支持传统合同；精简配置/Profile；文档、架构、体量与真实页矩阵 | 全验证通过；未知化学/条件保持 unsupported；升级/跨账号/插件组合测试完成 | 3-5 人日 |
| P6 按需求扩展 | Trade、新 Builder、Gallery 只读信息、长期 Player SBC 目标规划、更多奖励类型 | 每个独立设计、预算、验收，不为“功能对齐 FC26”默认全部恢复 | 另估 |

Runner 核心原估 15-25 人日；加入本地 FSU 首发支持并考虑重叠工作后，组合工程暂按约 20-30 人日、4-6 周有效工作时间安排，P2 后重估。不是“开服当天全功能可用”的承诺。可以先交付 P2 只读兼容组合，再交付 P3 小范围可提交组合，最后开放连续运行；不需要等上游 FSU 27 才开始。

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

先补脱敏 fixture 和失败测试，再实现对应行为；完整执行 `npm run verify` 与 `git diff --check`。逐步添加 points oracle/differential、transaction replay、workflow 和 build dependency tests，直接 EA 写调用继续集中在 Adapter。

真实页先验证少量低价值材料和单次操作，经用户确认后才测多轮。不为测试主动提交高价值卡，也不为复现网络异常冒险重复发送真实请求。离线故障注入覆盖不能替代真实页确认，但可减少账号风险。

以下任一未解决就不能发布自动连续模式：积分来源不确定、超额结算不明、实体不能精确定位、部分提交无法对账、奖励会重复领取/遗漏、新特殊卡保护不完整、账号/赛季身份未知时仍可写入。

## 12. 当前可立即开展与必须等待的工作

现在可做：确认首版减法范围、冻结 FC26 基线、分析构建依赖、建立 FC27 入口与只读能力门禁、提取本地 FSU Runner-support core 并建立桥协议、设计契约和脱敏 fixture 格式、配置迁移测试、移出默认不需要的功能。

必须等待真实 Web App：积分表与资格来源、贡献 API/返回时序、允许的提交 pile、partial/overflow/repeat 语义、奖励链、Holo/Evo 实体身份、新 FSU/Enhancer 并发行为。

EA 已公布 Community API，但本次官方说明只列 FUT.GG、FUTBIN、FUTWIZ 三个获准合作方，并表示暂不开放更多网站 [S4]；没有公开 SBC 写 API 的证据。因此不能把“改用官方 API”作为当前可执行方案，也不能因第三方得到访问权就假定 Runner 得到授权。自动化仍需用户了解 EA 规则与账号风险，不作无风险保证。

推荐下一步只批准 **P0 + P1 + FSU F0**，再在 FC27 Web App 开放后进行 P2 与 FSU F1/F2。关键方向是“保留可靠底座、减少默认业务、自行解决 FSU 首发时间差、按真实积分合同重建”，不是再扩展旧三阵预测。

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

访问方式：EA 页面直连成功；Greasy Fork 直连超时后使用用户指定的 `http://127.0.0.1:1080` 代理，FUT.GG 同样通过该代理读取。本次未取得精确积分表，不引用未验证的社交媒体传闻补齐未知规则。

### 本地审计入口

- [AGENTS.md](../AGENTS.md)、[REFACTORING_MILESTONES.md](REFACTORING_MILESTONES.md)、[FSU Club 集成合同](../FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)。
- [入口与运行时桥](../src/userscript-entry.js)、[物品与库存契约](../src/domain/contracts.js)、[策略注册](../src/domain/strategies.js)。
- [持久 key](../src/config/runtime.js)、[SBC Adapter 与 cacheScope](../src/adapters/ea/sbc.js)、[构建脚本](../scripts/build-userscript.mjs)。

本文只新增迁移方案；没有修改运行逻辑、版本、配置或发布资产，没有创建分支/tag，也没有执行 FC27 账号操作。
