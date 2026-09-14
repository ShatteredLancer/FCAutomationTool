# 10x85+ Rolling Loop 设计与实施追踪

> 文档状态：RL-0 至 RL-7 已完成，RL-8 和 RL-9 进行中
>
> 最后更新：2026-08-17
>
> 规划基线：FCAutomationTool `v0.7.91`，Git `0be883d`
>
> 实施基线：Git `c533519`
>
> 当前候选：FCAutomationTool `v0.8.19`
>
> 功能可见性：动态扫描成功后作为可选 Loop 显示；真实页面验收和最终发布门禁仍由 RL-8 跟踪

## 1. 文档目的

本文档是 `10x85+ Rolling Loop` 的设计、实施顺序和验收状态来源。后续实现、测试、真实页面验证和问题修正都应更新本文档，不在聊天记录或临时日志中维护另一套进度。面向使用者的实际开包、材料消耗和恢复说明见 [10x85+ Rolling Loop 使用与流程指南](10X85_ROLLING_LOOP_GUIDE_ZH.md)。

目标是基于当前不限次数的 `10x 85+ Upgrade` 建立可持续滚卡流程，同时：

- 动态读取 SBC 和 Challenge 事实，不写死 Set ID、Challenge ID、84 评分、11 人或特殊卡数量。
- 开启 `10x85+` 奖励并复用现有 Reward Alerts。
- 安全处理重复卡、Storage 压力和多个恢复 SBC。
- 严格保护特殊卡角色，避免把要求卡当作普通评分填料。
- 实时维护库存账本并在 UI 显示当前资源能力。
- 长时间运行时保持日志、Recap 和内存有界。
- 复用现有 Pack、Unassigned、Selection、SBC、Reward 和 Pick 底层能力，不复制事务实现。

本文档中的状态只使用：

- `Not started`
- `In progress`
- `Blocked`
- `Complete`

除纯文档步骤外，一个 Milestone 只有同时满足实现、对应自动测试、完整 `npm run verify`、文档记录和规定的真实页面验证后才能标记为 `Complete`。

## 2. 范围与非目标

### 2.1 本轮范围

- 动态发现并运行奖励最低评分恰好为 85 的 `high-rated-x10` Rolling Loop；10x84+ 等其它结果只保留为通用 Upgrade Loop。
- 主 `10x85+` SBC 的启动、提交、奖励开启和重复卡回填。
- 特殊卡恢复：`84+ TOTW Upgrade`。
- 普通材料恢复：`Repeatable FUTTIES Provisions Upgrade`。
- Provisions 重复卡清理：动态不限次数 Rare Gold Player Pick，再到 `5x 80+ Upgrade`。
- Protection rating 与现有 Pick 阈值合并。
- 资源库存账本、容量估算、实时 Telemetry 和紧凑 Recap。

### 2.2 非目标

- 不为这些 SBC 写死当前活动 ID。
- 不远程读取或保存 EA Challenge 模型之外的固定评分要求。
- 不新增第二套开包、提交、Pick 或 Reward Alert 实现。
- 不把 Rolling 专属策略写入通用 Pack、Unassigned 或 SBC Transaction。
- 不承诺预测随机奖励之后的最终可运行总次数。
- 不为了继续运行而丢弃、快速出售或绕过受保护卡。
- 不改变现有 `84+ TOTW`、`84x10` 等 Loop 的默认评分上限。

## 3. 术语和事实来源

### 3.1 主 SBC

`Primary SBC` 指动态扫描得到的 `10x 85+ Upgrade`。当前业务事实是不限次数、84 评分阵容，并要求一张 TOTW/TOTS/FOF/FUTTIES，但实现只能信任当前 EA Challenge metadata：

- 球员数量来自 Challenge。
- 目标评分来自 Challenge。
- 特殊卡数量、group id 和 values 来自 Challenge。
- `PLAYER_RARITY_GROUP` 特殊卡资格使用运行时 EA item-group membership matcher；即使个别 DAO 对象暴露更宽的 `meetsRequirements(item)`，也不能让不含目标 group 的卡继承授权。其它动态条件仍优先使用 live matcher。
- 两种 live matcher 都缺失或失效时 fail closed。

### 3.2 Required Special

`Required Special` 是满足主 SBC 当前特殊卡 eligibility group 的球员。TOTW/TOTS/FOF/FUTTIES 是当前业务描述，不得在底层展开成永久静态卡种列表。

已确认规则：

- `Unassigned -> Storage -> Transfer` 中命中 live eligibility matcher 的 TOTW/TOTS/FOF/FUTTIES 可以作为主 `10x85+` 的特殊卡槽；Transfer 仍是 duplicate signal，提交时解析为 Club/Storage 中真实可提交的对应副本。
- 主阵只扫描 Club TOTW 作为 Required Special。Club 中 TOTS/FOF/FUTTIES 以及其它命中 live matcher 的非 TOTW 卡不得进入主特殊槽或普通槽；恢复 SBC 默认同样排除。唯一例外是普通 Provisions shortage recovery 在用户显式开启 `rollingAllowClubCurrentPoolSpecialsForProvisions`、严格 Club 色卡保护关闭时，可把 live matcher 精确批准且评分位于配置 Provisions 范围内的 Club 非 TOTW item 作为最后候选。
- 当前 live `PLAYER_RARITY_GROUP=83` 是 EA 扩展后的特殊卡合同，存在可用 group-83 候选时最多可使用整队数量的 matcher-approved 特殊卡。这里只放宽数量，每张卡仍必须包含 group 83；其它 player group 仍保持原 count 上限。
- 不得作为主 SBC 的普通评分填料。
- 不得投入 TOTW Upgrade、Rare Gold Pick 或 5x80+。Provisions 也默认排除；只有上一条的显式普通 shortage 例外可按精确 item ID 授权，且不扩展到 duplicate-reserve、Storage pressure 或 maintenance。
- Required Special 即使评分落在当前 Provisions Reserve 范围内，也不进入普通储备池；Storage pressure 下只对 Storage 中实时 matcher 精确批准的实体开放既有例外并允许多张按批次释放。普通 shortage 的新例外只接受显式设置批准的 Club 精确 item，并保持最后候选层。
- 选择时遵循来源顺序，并在同一来源中优先重复、低评分和低保护成本球员。
- 高于 Protection rating 的重复 Required Special 必须进入 Storage，不能因为能够满足特殊卡槽而提交。
- Club TOTW 可以作为特殊卡槽使用；Club TOTS/FOF/FUTTIES 是硬保护，不存在最后回退。

提交前、保存后和最终提交前都必须验证 Required Special 数量恰好为一，并再次执行 live matcher。

### 3.3 Other Special

`Other Special` 是特殊卡，但不满足当前 Required Special matcher。

- Unassigned、Storage 和 Transfer 中评分不高于 Protection rating 的 Other Special 可以作为普通评分材料。
- Club 中普通 Other Special 使用软保护：普通材料无法组成合法阵容时才进入最后候选层。Club TOTS/FOF/FUTTIES 不属于该回退层，始终硬保护。
- `rollingProtectAllClubNonTotwSpecials=true` 时关闭该软保护回退：所有实际提交来源为 Club 的非 TOTW Special 都硬保护。候选、Ledger 分类和提交前 validator 必须使用实际 `submissionPileName`，不能使用 Unassigned/Transfer duplicate signal 的表面来源绕过。
- Other Special 不能满足 Required Special 槽位。
- 高于 Protection rating 的重复 Other Special 必须进入 Storage。

### 3.4 Regular

`Regular` 指普通金、银、铜球员。主 SBC 和恢复 SBC 仍须遵守 loan、concept、Evolution、active trade item 和其他既有安全过滤；FSU Lock 由默认关闭的 `Protect FSU locked players` 控制，开启后同时作用于候选和提交前复核。

### 3.5 Automatic-use max rating

现有 `Auto-pick below` 和 Rolling Loop 的 `Refill max rating` 合并为一个共享设置，UI 命名为 `Automatic-use max rating`。该值使用包含边界的语义：`<=` 阈值可自动处理，`>` 阈值受保护。

当设置为 `95` 时：

- 评分 `<=95` 的普通候选可按 Pick 或 Rolling 策略处理。
- 评分 `>95` 的重复卡视为受保护卡并进入 Storage。
- Required Special 的角色隔离优先于评分阈值；低于阈值也不能作为普通材料。
- `rollingSurplusCraftingEnabled` 默认关闭。关闭时 85-89 的可用重复卡都优先进入下一套主 SBC，87/88 及可选 89 不再因为 Provisions Reserve 身份占用 Storage；主阵缺料、Required Special 缺失或真实 Storage 压力时仍可执行恢复 SBC。开启后才恢复主动余量制作：Provisions Reserve 默认是 87/88，可选扩展到 87/88/89；本轮 `10x85+` 奖励若自身凑齐四张 Reserve，则立即做一套 Provisions，余数进入 Storage；主阵提交后的维护阶段会把 Storage 中完整 `87/88 x4` 批次做成 Provisions，并把 `<=86` 和 89 的目标余量用于 TOTW Upgrade。
- 该共享值只接入 Pick 和新 Rolling Loop；现有其他评分 SBC 保留自己的 `ratingSbcMaxCardRating`。Rolling 主阵和恢复阵不得再被普通评分 SBC 的单卡上限压低。
- 旧 Pick 阈值必须迁移，不能静默重置用户设置。

主面板不再并排显示多个相似阈值。首页仅显示 `Selection policy` 摘要，弹窗按作用域分为：普通非评分 SBC Gold 上限、普通评分 SBC 单卡上限、Rolling/Pick 共享自动使用上限，以及四种 Player Pick 选择策略。

Player Pick 通过 `pickSelectionMode` 统一表达选择策略，并兼容旧 `autoSelectBelow90`：

- `rating-auto`：默认兼容模式，保留原评分优先和阈值内自动选择行为。
- `rating-review`：评分优先，但保留受保护特殊卡的人工确认。
- `special-price`：特殊卡整体优先于普通卡，特殊卡按实时价格降序；同价优先非重复卡。若高价重复特殊卡挤掉非重复特殊卡且选择位不足，必须人工确认；竞争价格缺失时同样停止自动决定。
- `special-manual`：候选中有任意特殊卡就人工确认；全为普通卡时沿用评分自动选择。

规划器先生成候选排序，再生成 `manualReason`，执行层只根据该原因决定是否打开人工 Pick 窗口。所有调用 `redeemAndSelectPlayerPick()` 的普通 Pick、Rolling 恢复和 Provisions 预处理路径共享该行为。

## 4. 已确认产品决策

1. 只有显式开启 `rollingSurplusCraftingEnabled` 时，当前配置的 Provisions Reserve 才优先于“不高于 Protection rating 即可回填”；默认范围为 87/88，可选 87/88/89。关闭时这些评分段的可用重复卡与其它 85-89 重复卡一样优先回填主阵；Required Special 始终只能进入特殊卡槽。
2. 高于 Protection rating 的重复特殊卡必须存入 Storage。
3. Required Special 不能作为主阵普通材料；恢复 SBC 默认同样排除。仅普通 Provisions shortage 可在 `rollingAllowClubCurrentPoolSpecialsForProvisions=true`、严格 Club 色卡保护关闭、live matcher/评分范围/全部安全门禁均通过时，授权精确 Club item 作为最后候选。
4. Storage 中不高于 Protection rating 的 Other Special 和普通卡可以合理消耗。
5. Rare Gold 重复卡优先进入动态不限次数 Rare Gold Pick，Pick 立即开启并使用现有自动选择；剩余 Gold 再进入 `5x80+`。
6. 没有现成 `10x85+` 奖励包时，允许从库存完成一套主 SBC 启动循环。
7. 不新增 Rounds 控件，复用现有 `SBC completion`；Rolling Loop 默认 `0`，表示运行到用户停止或安全停止条件。
8. 选择 Rolling Loop 时默认勾选 `Open reward packs`。用户随后可以手动取消，但启动时必须拒绝不能开包的 Rolling Run，不暗中覆盖设置。
9. Reward Alert 继续使用现有最低评分、Toast、Desktop 和 ntfy 设置，不新增专用 98+ 通知链。
10. 实时资源信息放入主面板内部的透明 Runtime Telemetry，不新增独立悬浮窗。
11. `rollingProtectAllClubNonTotwSpecials` 默认 `false` 以保持现有行为；开启后，严重缺料也不得消耗 Club 非 TOTW 色卡。`rollingAllowClubCurrentPoolSpecialsForProvisions` 默认 `false`，只在前者关闭时允许普通 Provisions shortage 使用配置评分范围内、live matcher 精确批准的 Club non-TOTW item，且只作为最后候选。Storage/Transfer/Unassigned 色卡继续按现有角色、评分和保护规则使用，Club TOTW 仍只允许进入 Required Special 槽。

## 5. 材料资格矩阵

| 材料 | Unassigned | Storage | Transfer | Club |
| --- | --- | --- | --- | --- |
| Required Special | 未扩展时每套最多一张；扩展时可多张但必须命中同一 live matcher | 未扩展时每套最多一张；Storage pressure 扩展时可多张且必须是精确批准实体 | 未扩展时每套最多一张；按 duplicate signal 解析并重新执行 matcher | 主 SBC 仅 TOTW；其它 Club 非 TOTW 特殊卡默认硬保护。显式开启普通 Provisions shortage 例外后，配置范围内的精确 matcher-approved item 才可作为最后候选 |
| Other Special `<= Protection rating` | 可作普通材料 | 可作普通材料 | 可作普通材料 | 默认普通 Other Special 软保护、TOTS/FOF/FUTTIES 硬保护；严格 Club 色卡保护开启后全部非 TOTW 硬保护 |
| Regular `<= Protection rating` | 优先处理重复 | 可作普通材料 | 可作普通材料 | 可作普通材料，仍遵守 FSU 过滤 |
| 非 Required Special 且评分位于可配置 Reserve 范围 | 默认与其它 `<= Protection rating` 材料相同并优先回填主阵；开启余量制作后，完整四张组做 Provisions、余数进 Storage | 默认可作主阵材料；开启余量制作后，87/88 完整组做 Provisions，`<=86` 和 89 可进入 TOTW 维护 | 默认可作主阵材料；开启余量制作后保留为 Provisions 储备 | 默认可作主阵材料但 Other Special 仍遵守 Club 软保护；开启余量制作后保留 Reserve |
| 重复卡 `> Protection rating` | 必须存入 Storage | 保持受保护 | 不作为回填材料 | 不作为回填材料 |

任何表格规则都不能绕过以下已有保护：

- 开启 `Protect FSU locked players` 时的 FSU Lock 和身份别名匹配。
- loan、limited-use、concept、academy/evolution 和 active trade item。
- 同阵容 definitionId 唯一性。
- Unassigned/Transfer duplicate signal 的真实可提交实体解析。
- provisional Club cache 的 EA 定向验证。

## 6. 主循环状态机

Rolling Loop 使用专用 Workflow 状态机，但通过注入调用共享能力。禁止在 Workflow 中直接访问 EA Repository、FSU 私有对象或 DOM。

```text
PREFLIGHT
-> INDEX_INVENTORY
-> BOOTSTRAP_OR_FIND_REWARD
-> OPEN_X10
-> CLASSIFY_OPENED_ITEMS
-> RESOLVE_PROTECTED_STORAGE
-> RECOVER_CURRENT_PACK_RESERVE_IF_BLOCKING
-> DRAIN_PENDING_RECOVERY_REWARDS
-> PLAN_PRIMARY_SQUAD
-> RECOVER_NORMAL_FODDER_IF_REQUIRED
-> RECOVER_REQUIRED_SPECIAL_IF_REQUIRED
-> DRAIN_RECOVERY_DUPLICATES
-> SUBMIT_PRIMARY
-> RECONCILE_LEDGER
-> OPEN_X10
-> repeat
```

状态机不通过递归调用恢复流程。每个恢复结果回到统一评估点，并使用进度指纹避免以下循环：

```text
Provisions -> Pick -> reward -> duplicate -> Provisions
TOTW Upgrade -> reward -> duplicate -> TOTW Upgrade
Unassigned resolver -> same resolver -> no inventory change
```

每次状态转换至少返回：

```js
{
  status: 'progressed' | 'ready' | 'planned' | 'blocked' | 'completed' | 'stopped',
  phase,
  receipts: [],
  inventoryDelta: null,
  reason: null,
}
```

## 7. 主 SBC 选材

### 7.1 通用 Solver 合同扩展

评分 Solver 增加可选合同，不新增 Rolling 专用选材器：

```js
selectInventoryPlayers({
  inventorySnapshot,
  requirements,
  priorityPiles,
  requiredItems,
  preferredItems,
  protectedItems,
  exclusiveRoles,
  maxOrdinaryRating,
  protectionPolicy,
  mode: 'rating',
})
```

`exclusiveRoles` 用于表达：

- 某 matcher 的卡只能进入指定角色。
- 指定角色要求最小和最大数量均为一。
- 同一张卡不能同时满足普通评分材料和 Required Special 两种角色。

当前实现的角色使用 `constraintId` 或 `constraintIndex` 指向 `rating-model` 中的动态 eligibility constraint。live EA matcher 或运行时 EA item-group adapter 只在候选构建阶段针对实时对象执行一次，纯 Solver 接收对应布尔向量；提交前 validator 再对保存后的实时对象执行同一 matcher。无法解析 matcher 时返回 `LIVE_REQUIREMENT_UNAVAILABLE`。

`protectionPolicy` 当前支持：

- `reserveRatings`：排除非角色的 Provisions 储备评分；当前 Rolling 默认传入 87/88，用户启用 89 时传入 87/88/89。
- `softProtectSpecialPiles`：把指定 pile 的 Other Special 放入最后候选层，当前 Club 使用该策略。
- `allowSoftProtectedFallback`：普通候选不可行时是否允许使用软保护层，默认允许。
- `allowOtherSpecialAsOrdinary`：是否显式放宽旧的特殊卡总量策略；仅 Rolling role-aware 调用可启用。
- `liveRequirementsAvailable`：上游 metadata/matcher 健康门禁；为 `false` 时不进入配方规划。

不传新字段时，现有评分 SBC 行为必须保持不变。

### 7.2 求解目标顺序

1. 满足 EA 实时球员数量、评分和 eligibility 条件。
2. Required Special 恰好一张。
3. 消耗当前必须处理的普通重复卡。
4. 排除 Provisions 储备和受保护卡。
5. 最小化目标评分之上的浪费。
6. 遵循 `Unassigned -> Storage -> Transfer -> Club`。
7. Club 普通 Rare Gold 优先于 Club Other Special。
8. 使用稳定身份进行确定性 tie-break。

Solver 不预设“84 阵应该平均使用 83/84”。如果已有高评分重复卡，它可以自然得到“一两张高分加多张低分”的最低合格组合；如果平均组合成本更低，也可以选择平均组合。

评分规划不枚举 Club/Storage 中的卡实例组合。运行时先对候选做一次安全过滤并建立实时评分直方图，再把每档数量截断到当前阵容最多还需要的人数。配方规划只处理实际存在的 `47..99` 评分档、必选重复卡评分、阵容人数和目标评分；库存从数百张增长到数千张不会扩大配方状态图。相同截断直方图使用有界 LRU 缓存，连续 Rolling 周期在关键评分桶未跌破需求时直接复用配方。

旧的 `maxSearchNodes`、`maxSearchMs` 和 `yieldEveryNodes` 不再参与运行。配方先固定评分向量，再按 requirement/exclusive role/pile 物化具体卡，并在保存前后继续执行 live validator。

### 7.3 不可行原因

“缺普通低分填料”统一改为“当前阵容不可行”，并细分：

- `PLAYER_COUNT_SHORTAGE`：合法候选数量不足。
- `SQUAD_RATING_SHORTAGE`：当前最高可行组合仍达不到目标评分。
- `REQUIRED_SPECIAL_SHORTAGE`：没有可用 Required Special。
- `RESERVED_FODDER_BLOCKED`：只有受保护或 Provisions 储备材料能够解锁阵容。
- `PROTECTED_STORAGE_BLOCKED`：必须存储的高分重复卡没有安全位置。
- `LIVE_REQUIREMENT_UNAVAILABLE`：EA matcher 或 Challenge metadata 不可用。

诊断必须记录候选数量、评分直方图、最高可达评分、缺失角色和被各保护规则排除的数量，但不能输出完整 Club 卡片对象。

## 8. 开包后路由与 Storage 压力

### 8.1 分类

开包后按以下顺序分类：

1. 高于 Protection rating 的重复卡：受保护，等待 Storage。
2. Required Special：进入专用特殊卡队列，只能每套主 SBC 消耗一张。
3. 非 Required Special 且位于当前 Reserve 范围：普通库存进入 Provisions 储备；刚开启的 `10x85+` 主包每凑齐四张就立即做一套 Provisions，完整组不进入 Primary，不足四张的余数进入 Storage。
4. 其他不高于 Protection rating 的主包重复卡：下一套主 SBC 的 requiredItems；只有评分超过目标时才按评分从高到低逐张放宽，并将被替换的卡送入 Storage。
5. 非重复卡：沿现有 Pack settlement 路由。

### 8.2 Storage 有空间

- 受保护高分重复卡进入 Storage。
- 当前轮用不到的 Required Special 进入 Storage。
- 只有开启余量制作或发生必要恢复时，Provisions 储备才按该角色进入 Storage；默认关闭时可用的 85-89 重复卡优先回填主阵。
- 不要求把即将提交的普通重复卡先移动到 Storage。
- 默认关闭余量制作时，主包 85-89 可用重复卡全部保持 required/preferred 身份并优先进入下一套主 SBC。若阵容超过目标评分，按 `89 -> 88 -> 87 -> 86 -> 85` 从高到低逐张放宽，被放宽卡退出 required/preferred 并进入本次规划的 protected 集合，使 Solver 换入 Storage 低分卡，主阵提交后再把放宽卡移入 Storage。开启余量制作时，当前配置的完整 Reserve 组才优先进入 Provisions，余数进入 Storage。

### 8.3 Storage 无空间

依次尝试：

1. 使用当前 Unassigned 普通重复卡完成主 SBC。
2. 主 SBC 补卡优先从 Storage 选择可消耗材料，主动释放位置。
3. 从 Unassigned/Storage 直接执行 Provisions，不要求先移动当前配置的 Reserve。
4. 立即处理 Provisions 产生的重复 Gold。
5. 多张 Required Special 重复卡同时阻塞时，可以预做多套主 SBC，每套只使用一张，并暂存奖励包而不继续开包。
6. 仍无法为受保护卡腾出位置时安全停止。

不允许将第二张 Required Special 塞入同一主 SBC，也不允许将它降级为 Provisions 或普通材料。

### 8.4 通用 Storage pressure SBC

当紧急 Provisions 无法释放足够空间时，Rolling 可以使用动态扫描得到的高评分 Player Pick 或直接球员 SBC 作为第二级 Storage sink。该能力是可选 capability，缺失或规则变化不会阻止 Rolling 启动，只会让 Storage 压力路径保持 `PROTECTED_STORAGE_BLOCKED`。

该恢复路径由 `Selection Policy -> Rolling -> Storage pressure recovery` 控制，支持 `Off / Automatic / Selected SBC`。旧版 `rollingStorageSinkEnabled:true` 迁移为 `Automatic`，缺少该字段仍为 `Off`。`Selected SBC` 持久化稳定 Set ID；选中的 Set 不可用时不允许静默回退。

扫描分为两级：`requestSets()` 的轻量索引用于下拉目录；Challenge 评分和约束只对现有动态候选及用户显式选中的 Set 深度加载并缓存。这样可以覆盖球员 SBC，同时避免为下拉框全量请求 Challenge 元数据。

通用动态身份合同：

- Set 奖励必须是 Player Pick 或直接球员；奖励评分不参与筛选，纯 Pack SBC 和没有 87+ 阵容的低成本 SBC 不进入候选。
- 至少一个 Challenge 的 live 目标评分为 87+，并且人数、Set ID、Challenge ID 和奖励身份可验证。
- 支持 Team Rating 和现有评分规划器支持的球员品质、稀有度、评分、Club、League、Nation 条件；Chemistry 等未知条件 fail closed。
- 最后一阵前为 Player Pick 或可能重复的直接球员预留一个 Storage 槽位；子阵 Pack 不自动开启。

兼容的 `1 of 3 95+ FOF or FUTTIES T1-T3 Player Pick` 仍保留旧身份合同和专用 89/88 来源策略，避免配置迁移改变已验证行为。其它候选进入通用逐阵执行器。

95+ 专用路径在每次 recovery 开始时一次性加载当前未完成的 89/88 Challenge squad，提交 89 阵并完成库存对账后复用已加载的 88 阵上下文重新规划材料。不得在两阵之间重复调用 `loadChallenge`；EA 可能对刚提交同 Set 后的重复 Challenge squad 加载返回 466。若 Run 已在两阵之间停止，再次启动时优先复用 Set Repository 中同 Challenge ID 的已加载 squad，同时保留本次请求得到的最新要求元数据。

提交门禁：

1. 启动时先检查并处理配置 capability 对应的已有待领取 Pick。
2. 通用执行器重新加载 Set 和所有 live Challenge，只考虑 87+ 且可解析的未完成阵容。
3. 每次选择评分最高的一阵，按 `Unassigned -> Storage -> Transfer -> Club` 规划；Club 最多 3 张，Unassigned 当前阻塞项优先设为必选。
4. 每阵计划必须证明 Storage 实际释放量足以容纳当前待存卡；最后一阵额外预留一个奖励槽位。
5. 提交一阵后立即对账并返回真实进展，不在一次 recovery 中连续提交任意数量的球员 SBC 阵容。
6. 最后一阵完成后，Player Pick 立即选择；直接球员通过通用 Unassigned 路由处理；Pack 奖励保留。
7. Automatic 模式可尝试下一个已验证 capability，但任何已经提交的部分进展都禁止回退到另一 Set。

legacy 95+ 两阵继续执行原门禁：89 阵只用 Unassigned/Storage，88 阵纯 Storage 优先并允许最多 3 张 Club；89 已完成、88 不可行时保留 `STORAGE_SINK_88_DEFERRED`。

## 9. 恢复策略

### 9.1 Required Special 恢复

顺序如下：

1. 使用当前 Unassigned 中合法且未受高分保护的 Required Special。
2. 使用 Storage。
3. 使用 Transfer。
4. 使用 Club 中低成本 TOTW。
5. 打开已存在的 TOTW Upgrade 奖励。
6. 动态定位并完成一次 `84+ TOTW Upgrade`。

Club 中 TOTS/FOF/FUTTIES 不参与恢复，也不存在主 Solver 的最后回退；前六步均不可行时返回 `REQUIRED_SPECIAL_SHORTAGE`。

TOTW Upgrade 自身的普通材料池必须排除全部 Required Special。新产出的 TOTW 加入 Required Special 队列。

### 9.2 Provisions 恢复

当前目标为动态定位 `Repeatable FUTTIES Provisions Upgrade`。Challenge 事实以 EA metadata 为准；当前业务需求是四张 87+。

触发条件：

- 主 SBC 因候选数量或评分不足而不可行。
- 当前主 `10x85+` 奖励中位于当前 Reserve 范围的非 Required Special 重复卡自身凑齐四张并阻塞 Unassigned。
- Storage 压力阻止受保护卡或 Required Special 安全存储。

选择策略：

- 严格限制在当前配置的 Reserve 范围，默认 87/88，可选 87/88/89；优先低评分。
- Reserve 不足一套时不放宽到 90-95，返回材料不足并交由上层重新规划。
- Required Special 永远排除。
- Storage 中位于 Reserve 范围的 Other Special 可以使用。
- Club Other Special 保持最后候选软保护。
- `rollingAllowClubCurrentPoolSpecialsForProvisions=true` 且严格 Club 色卡保护关闭时，普通 shortage 可把 live matcher 精确批准、评分位于当前 Reserve 范围、具备稳定 item ID 的 Club 非 TOTW Required Special 加入同一最后候选层。普通材料先尝试；该授权不作用于 duplicate-reserve、Storage pressure、maintenance 或其它恢复 SBC。
- 严格 Club 色卡保护开启时，Club Other Special 不得进入候选或 fallback；Provisions 只能使用其它 pile 的合格色卡或普通材料。
- 不消耗下一套主 SBC 唯一可用的 Required Special，因为它根本不进入候选池。

默认关闭 `rollingSurplusCraftingEnabled` 时，不执行主包 `duplicate-reserve` Provisions，也不执行主阵后的 Storage 维护。只有实验性的 `rollingDuplicateSwapEnabled=true` 时，85-89 的可用 Unassigned 重复卡才直接进入主阵候选；默认关闭交换时它们先整体进入 Storage。显式开启余量制作后，至少一套主 SBC 成功提交并完成账本对账，Storage 维护才允许逐套消耗 Storage 中完整的 `87/88 x4`，这些维护奖励默认留在 My Packs；同时开启交换时，当前主包完整四张 Reserve 也可即时制作 Provisions。无论开关状态，主 Solver 明确缺料时才处理已有 Provisions/5x80+ 奖励；已有 Provisions 按 `rollingShortageProvisionsPackLimit` 分批处理，默认每次缺料最多两包并在每批后重新规划，仍缺料才制作新的 Provisions。Required Special 缺失和真实 Storage 压力恢复同样保留。

### 9.2.1 主阵后的 Storage 维护

该阶段仅在 `rollingSurplusCraftingEnabled=true` 时运行。每次只提交一个恢复 SBC，刷新账本后重新规划，不复用旧 Storage 快照：

1. Storage 中非 Required Special、未受保护的 87/88 每满四张，优先完成一套 Provisions；只允许从 Storage 取这四张，奖励默认保留。
2. 87/88 不足一套后，统计 Storage 中非 Required Special、未受保护的 `<=86` 和 89。至少达到一套阵容人数才尝试 TOTW 维护，避免仅为一张低分卡频繁制作 TOTW。
3. TOTW 维护至少强制消耗一张上述 Storage 卡，并把全部目标 Storage 卡设为首选；允许从 Transfer/Club 取不高于 89 的安全低分卡补成准确 84 阵。Storage 中其它评分段保持保护，87/88 Reserve 和全部 Required Special 不得进入该阵。
4. 已存在的 TOTW 奖励先逐个打开；维护提交产生的新 TOTW 奖励立即打开。若评分规划不可行，本阶段安静结束并继续主循环，不放宽保护。
5. 只有 `PROTECTED_STORAGE_BLOCKED` 可以进入紧急 Storage 恢复。`OPENED_DUPLICATE_NOT_MATERIALIZED` 等物化或路由错误必须原样停止，禁止误触发 Provisions。

所有 Rolling 奖励包查找只接受 EA `My Packs` Repository 中的真实实例。Store catalog 缓存只用于展示和发现，不能在真实实例已消费后以同 ID 再次被开启；同 ID 有多个真实奖励包时逐个开启直到 Repository 中不再存在。

### 9.2.2 缺料奖励的预开容量门禁

所有缺料奖励共用 `openRollingRecoveryReward()` 的 pre-open Unassigned 事务。打开包之前必须先证明当前 Unassigned 已安全路由；`PROTECTED_STORAGE_BLOCKED` 表示包尚未打开。

1. 已有 Provisions/5x80+、显式 `pendingRecoveryReward` 和 Required Special/TOTW 奖励都先执行同一门禁。
2. 若门禁因 Storage 满而阻塞，Workflow 只允许先执行已启用的 Storage pressure SBC，不得打开另一个恢复包扩张 Unassigned。
3. Storage pressure 成功并产生可验证库存进度后，回到统一评估点并重试同一个 pending/leftover reward。
4. Storage pressure 未启用、不可用或未释放足够容量时，保留 My Packs 奖励并返回 `PROTECTED_STORAGE_BLOCKED` 或具体恢复错误。
5. 该流程不得通过放宽 Club 非 TOTW 色卡保护来制造容量。

### 9.3 Provisions 重复 Gold 清理

清理链必须配置化，不在 Unassigned 底层写死 SBC 名称：

```text
Rare Gold duplicate
-> dynamic unlimited Rare Gold Player Pick
-> immediate Pick redemption
-> remaining Gold to 5x80+

Common Gold duplicate
-> 5x80+
```

要求：

- Pick 使用现有动态 Pick metadata 和自动选择策略。
- Pick capability 只接受明确 `unlimited`、单 Challenge、单选、全 Gold 且至少要求一张 Rare 的活动。有限次数和 repeatability unknown 的 Pick 不参与 Rolling。
- 候选先按 minimum Rare Gold cost、再按 total Gold cost 升序，然后按 reward minimum rating 和 candidate count 降序；完全同级保持 ambiguous。首选 live Challenge 不可用时按顺序尝试备用候选。
- Pick 立即开启，不使用“全部做完再开”的延迟模式。
- 所有恢复 SBC 都再次排除 Required Special。
- 每次提交后回到统一 Unassigned 状态重新评估。
- 路径不可用或没有取得库存进展时停止，不无限重试。

### 9.4 恢复依赖

如果 TOTW Upgrade 自身也缺普通材料，允许依赖链：

```text
Provisions
-> drain Gold duplicates
-> 84+ TOTW Upgrade
-> 10x85+ Upgrade
```

状态机每次只执行一个已验证动作，动作完成后重新规划，不预先假定随机奖励内容。

## 10. SBC completion 和开包设置

### 10.1 SBC completion

- 复用现有 quantity 控件，不新增 Rounds。
- Rolling Loop 默认值为 `0`。
- `0` 表示直到用户 Stop、资源不可恢复、Storage 保护阻断、动态 SBC 失效或安全门禁失败。
- 正整数只统计主 `10x85+` 提交次数。
- TOTW、Provisions、Rare Gold Pick 和 5x80+ 不计入主完成数。
- 状态机内部仍需有进度指纹、恢复预算和停止点，不允许字面上的无保护无限循环。

### 10.2 Open reward packs

- 用户选择 Rolling Loop 时，将 `Open reward packs` 默认设为开启。
- 只在选择行为中设置一次，不在每次 render 时覆盖用户随后进行的修改。
- 启动时如果该项关闭，预检失败且不提交任何 SBC。
- Workflow 不得绕过该设置强制开包。

### 10.3 Dry Run

Dry Run 和 Live Run 使用同一规划器和状态机，只替换副作用执行器。

- 可以验证当前库存下的启动、选材、特殊槽、Storage 和恢复决策。
- 不保存、提交、移动或开包。
- 不伪造未来随机奖励；规划到第一个未知奖励边界后返回 `planned`。
- Dry Run 不维护一套独立业务规则。

## 11. 库存账本

### 11.1 初始索引

启动时建立 `Inventory Ledger`，至少按以下维度索引：

- item identity 和 definition identity。
- pile：Unassigned、Storage、Transfer、Club。
- rating。
- duplicate 状态。
- Required Special eligibility。
- Other Special/Regular 分类。
- 当前 Provisions Reserve 范围资格，默认 87/88，可选 87/88/89。
- FSU 和 Runner 保护状态。

初始索引只能读取当前已加载的 EA/FSU Repository。禁止为了统计主动触发几十页 Club 网络扫描。

性能目标：

- 对约一万张 Club 球员进行本地聚合应保持在亚秒级目标内。
- 记录数据来源、球员数量和实际耗时。
- Repository 未就绪时等待或 fail closed，不能用 23 张之类的不完整缓存冒充完整库存。

### 11.2 增量更新

Runner 已确认的每次操作都产生 `InventoryDelta`：

- 开包：新增 reward 和 Unassigned 项。
- 移动：来源 pile 扣除，目标 pile 增加。
- SBC 提交：扣除最终保存并验证过的球员。
- Pick：增加最终选择结果。
- Storage 操作：更新使用量和空余位置。

只有 EA 已确认的 mutation 才提交到账本。超时、歧义响应或保存后不一致必须先对账，不能乐观永久扣除。

### 11.3 对账

- 每次提交前验证被选 item refs。
- 每次开包后刷新 Unassigned。
- 进入 TOTW/Provisions 恢复时核对相关 pile。
- 每十次主 SBC 做一次完整的本地 Repository 对账。
- 检测到外部手动操作、数量不匹配或 item 缺失时立即重建索引。
- provisional FSU Club 实体继续执行 EA 定向验证。

### 11.4 当前能力计算

账本按 `inventoryVersion` 缓存以下派生值：

- `specialSlots`：当前允许用于主特殊槽的 Required Special 数量。
- `storagePressureSbcCount`：本次运行已明确提交的 Storage Pressure SBC challenge 数量。
- `provisionsBatches`：当前材料可完成的 Provisions 数量。
- `totwSbcCount`：本次运行已明确提交的 TOTW SBC 数量。
- `storageUsed/storageCapacity`。

已知资源值会竞争相同材料，不能相加。主阵和 TOTW 的准确可行性只在 Workflow 到达对应决策点时求解，不根据 Telemetry 预测随机奖励之后的总循环上限。

Runner 自己造成的变化应在对应 EA receipt 确认后实时反映；外部手动变化最迟在下一次提交校验或周期对账时发现。

### 11.5 提交前实体交换与 EA 警告确认

Rolling 的主 `10x85+`、评分恢复阵和 Storage pressure SBC 共用同一套提交事务门禁。普通 Loop 不接入以下放宽行为。

`pickOptions.rollingDuplicateSwapEnabled` 是默认关闭的实验开关，旧配置缺失该字段时也归一化为 `false`。关闭时，开包和启动恢复的路由规划把全部 Unassigned duplicate 归入 Storage，清空 `reservedItems` 和即时 duplicate-Provisions 提交；只有全部卡具有确定 Storage 容量时才执行批量移动。容量未知或不足返回 `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED`，零交换、零新 journal、零主 SBC 提交。Workflow 将该状态接入既有 Storage-pressure recovery：先尝试紧急 Provisions，再尝试用户显式启用的 Storage pressure SBC。恢复规划把全部待存 Unassigned duplicate 保持为 protected，包括评分落在 Provisions Reserve 范围内的 signal；Reserve 消耗授权只能作用于真实库存材料，不能传递给待存 signal 或其 Club counterpart。候选阶段之后，提交前 validator 还会直接检查 selection signal，防止保护列表回归。安全 Provisions 不可行时返回 unavailable，让 Workflow 继续 Storage pressure SBC；两条路径都只允许通过净消费足够数量的真实 Storage 卡满足 headroom。对账后重新读取这些精确 ID，只有完整容量成立才批量移入 Storage。提交事务中的 `preparePlayers` 再次检查该开关；任何漏入阵容的 Unassigned -> Club duplicate signal 返回 `DUPLICATE_SWAP_DISABLED`，不得退化为提交原 Club B。

开关只禁止新事务，不参与启动取消。`cancelPriorRunRollingDuplicateTransaction()` 始终先处理已有 journal，按精确 protected ID 恢复/分类并清理旧意图；否则关闭开关本身会把已经发生的交换留在中间状态。显式开启后才执行下述交换协议。

当 Unassigned duplicate signal 是不可交易卡，而 Solver 解析到的可提交 Club 同版本实体具有已确认的交易状态时，事务在最终校验前运行 `preparePlayers`。Club 实体可以是可交易或不可交易；未知交易状态禁止交换：

1. 只处理 selection 中来源为 Unassigned、目标为 Club 且目标交易状态已确认的实体。
2. signal 与目标必须通过 definition、评分、rareflag、Evolution 和 cosmetic/version 同版本检查；signal 的 duplicate ID 必须指向该目标实体。
3. 移动前持久化 `planned` journal，分别记录 A 和 B 的精确 item ID、definition ID、价值指纹、Set/Challenge 和 Inventory Ledger 版本；journal 无法写入时禁止交换。
4. EA move 响应必须提供等长且无歧义的 `clubDuplicates -> itemIds` 映射。缺失、重复、非法或未覆盖预期目标的映射全部 fail closed。
5. 交换后刷新 Repository，验证新 Club 实体 A' 与 A 的价值身份一致且不可交易，同时验证 B 已原样进入 Unassigned；随后持久化 `materialized` journal。写入失败时立即物理补偿并停止。
6. 交换前阵容永久失效。事务必须在相同 Set/Challenge 内重新规划，要求 A' 成为 exact required item，并把 B 加入 protected；同 definition 的其它实体不继承授权。重规划 resolver 产生的 B -> A' 反向 duplicate signal 只在 signal ID、target ID、definition 和 pair 数量与当前 journal 完全一致时作为 no-op 提交桥，不执行第二次原生 move；任何偏差 fail closed。
7. 重规划后创建 exact-item manifest，在保存前、保存后和 transport 前按 item ID、definition ID 和库存版本校验；transport 只使用最后一次从 Challenge 回读的阵容。
8. 提交确认后将 B 原样恢复到 Club并校验其交易状态、Evolution、化学样式、外观和其它价值指纹；提交前失败、Stop 或有界重规划失败则补偿交换。恢复时 Repository 返回的 pile 位置是位置权威，实体内部滞后的 pile scalar 不覆盖 Repository 证据；item ID、definition 和全部价值指纹仍严格。transport 结果不明且 A' 已消失时进入 `ambiguous`，禁止自动重试。
9. 同一次运行内，journal 写入、交换、重规划、提交和补偿保持严格事务语义；提交结果不明且 A' 已消失时 fail closed。journal 写入或清除失败必须返回 blocked，不能声称事务 completed。
10. journal 在新一次启动时先于 Pick、Unassigned 和开包处理，但启动不会续跑旧事务。每个 B 的精确 item ID 通过已对账 Ledger 独立分类：Club 直接保留；Unassigned 必须取得同 ID live EA 实体、移回 Club 并再次对账；Storage/Transfer 保留外部新位置；全部 pile 缺失则记录 missing；混合状态逐项处理。完成后清 journal，并从当前库存重新规划；不要求 A/A' 继续存在，不按 definition 替代 B，也不复用旧 squad 或 Challenge。
11. malformed、未知状态、跨 pair 身份复用或重复 protected ID 的 journal 在任何库存刷新前删除；删除失败才 blocked。有效 journal 必须使用刚对账完成的 Ledger 分类；Ledger 不可用、解析抛错、对受保护 ID 返回另一 item ID 或未知 pile、Unassigned live 实体不可用、移动失败或恢复后未在 Club 对账时保留 journal 并 blocked。

实机 trace 已确认 EA 页面手工交换直接调用 `Item.move(A, CLUB)`：第一个参数是单个 `UTItemEntity`，第二个参数是 Club pile，没有第三个 `allowStorage` 参数；成功响应为 `status:200`、`untradeableSwap:false`。旧的 `Item.move([A], CLUB, true)` 会进入另一条 `untradeableSwap:true` 路径并返回 `status:0`、空映射及库存零变化。生产重复卡交换因此使用独立的双参数单实体 Adapter，不改变其它通用批量 move 调用，也不经过 Storage。多对交换严格串行，每成功一对就刷新、校验 A/B 精确身份与价值指纹并持久化新 Club ID；后续失败或重启只回滚已经发生的交换。响应映射、部分进度或恢复候选存在歧义时保持 fail-closed。`window.__FCLoopRunner` 继续暴露可卸载的 `startNativeDuplicateSwapTrace()`、`stopNativeDuplicateSwapTrace()` 和 `getNativeDuplicateSwapTrace()`，并保留响应中的有界 `itemIds/clubDuplicates` 标量以供后续 EA 合同漂移诊断。恢复规划使用 Repository 查找返回的规范 pile 名，不再把 EA 数字 pile `6/7` 误判为未知。

EA 对包含现有阵容球员的 SBC 可能返回 `409` 和 `data.itemViolations`。`Protect Active Squad players` 默认关闭；关闭时 Rolling 只在以下条件全部成立时执行一次官方确认语义的 `skipValidation:true` 重试：

- 当前调用点显式设置 `allowItemViolationOverride:true`。
- 首次响应确实是 `409`，且 `itemViolations` 是非空数组。
- 每条 violation 都包含有效、非空的 `itemIds`，所有 ID 都属于本次已保存并提交的阵容。
- 首次提交没有已经使用 `skipValidation:true`，并且重试预算尚未耗尽。

确认提交复用同一个 Challenge 和同一组已保存球员，在 Challenge reload 之前立即执行一次。确认失败是终止结果，不再换阵容、重新加载后尝试另一组卡或连续绕过验证。无 `itemViolations` 的 `409`、阵容外 ID、未知响应结构及普通 Loop 继续走原有诊断和有界重试，不会被静默强制提交。

开启 `Protect Active Squad players` 后，首次 `409 + itemViolations` 先严格提取 violation item ID，并验证每个 ID 都属于本次保存阵容；随后按实际提交来源和角色分类：

- 普通卡：把精确 item ID 写入当前 `runRollingUpgradeLoop()` 的临时排除集合，返回 `replan`。不得扩展为 definition ID 排除。
- TOTS/FOF/FUTTIES：正常可以来自 Unassigned/Storage/Transfer 并占用 Required Special 槽，但它们永远不进入用户确认分支。若 EA 对它们返回 `409/itemViolations`，这是 EA 实体身份或规划状态矛盾，立即 fail closed；该结果不因库存来源、Required Special 角色或 `rollingProtectAllClubNonTotwSpecials` 开关改变。
- 其它特殊卡（包括合法 TOTW）：显示 `Use this card` / `Replace card`。其它 Club 非 TOTW 特殊卡在严格保护开启时属于规划回归；严格保护关闭时是合法最后 fallback，因此进入确认。
- `Use this card` 只允许对同一个已保存阵容发送一次有界 `skipValidation:true`；`Replace card` 和点击弹窗外部均按精确 ID 排除并重规划。

来源判断同时保留 selection 的逻辑 `sourcePile` 和实际 `submissionPile`。`from:unassigned | submitFrom:club` 的重复交换不会改变普通卡的 Unassigned 逻辑来源；但对其它 Club 非 TOTW 特殊卡，保护开关按实际提交实体的 `submissionPile` 判断。TOTS/FOF/FUTTIES 则不允许进入 Active Squad 确认，无论来源和角色如何。

临时排除 ID 和用户批准 ID 只存在于当前 Rolling runtime，不写入配置或持久化存储。`replan` 不登记 Inventory Ledger submission、不增加完成次数、不重复开主包，也不计入 recap receipt。重新启动 Rolling 后重新评估所有 Active Squad 实体。

### 11.6 Rolling requirement recovery 的统一提交 transport

Rolling 的库存型 requirement recovery（包括 Provisions、5x80 和 Required Special/TOTW 恢复）统一通过 `submitInventorySbcAttempt()` 的显式 `submissionMode: 'background'` 执行。该模式的顺序是：

1. 通过 `sbcDAO.getChallengesForSet()` 和 `sbcDAO.loadChallenge()` 直接加载当前 Challenge，不调用 `openSbcSet()`，也不把页面导航到 SBC Squad。
2. 通过 `prepareFsuRuntimeAccess()` 获取当前 Club 实体。
3. 执行不可交易 Unassigned duplicate 与可交易 Club 同版本卡的交换，并刷新实际实体。
4. 运行 pre-save validator，保存 Challenge 阵容，再读取保存后的阵容并运行 post-save validator。
5. 用 `challenge.canSubmit()` 判断 EA Challenge 是否可提交。
6. 调用 `submitRatingSbcInBackground()`，由 EA SBC Adapter 执行 DAO submit、奖励观察、409/429 诊断和有限确认重试。

这项统一只改变 Rolling requirement recovery 的提交 transport；普通配置 SBC 和需要用户选择的 Player Pick 不被隐式迁移。后台 DAO 的目的只是绕开前台 SBC 页面中 FSU 的价格确认弹窗，不是绕过业务保护。`Protect FSU locked players` 仍由选材和最终保存阵容 validator 独立执行；`Protect Active Squad players` 决定是沿用严格受限的单次确认，还是执行精确换卡、特殊卡复核和保护回归检查。

## 12. Runtime Telemetry UI

### 12.1 位置和布局

Telemetry 位于现有主面板的 Running 状态下方、最新日志上方，仅在 Rolling Loop 运行时显示。它继承面板背景，不创建第二个悬浮窗，也不使用多张卡片。

```text
Running - 10x85+ Rolling       Cycle 4 / No limit
Building 10x85+ squad

Special ready       7    Direct cycles       -
Provisions          3    TOTW recoveries     -
Storage        83 / 100  [===============-----]
```

规则：

- 两列稳定网格，Storage 独占最后一行。
- 数字使用 tabular numerals，异步更新不改变布局尺寸。
- Storage 低于 80% 使用中性色，80%-94% 警告色，95% 以上危险色。
- 容量标题带 tooltip，说明这些路径共享库存且数字不可相加。
- 初始化或重新计算时保留上次可信值并显示 `Refreshing`，未知值显示 `-`，不显示误导性的零。
- `Direct cycles` 和 `TOTW recoveries` 显示 `-`。这两项无法仅靠数量准确推导，Telemetry 不再克隆 4,000+ 卡库存并反复运行评分 Solver；真实 Workflow 到达主阵或 TOTW 恢复决策时仍会执行一次完整规划。
- Desktop 面板为 Telemetry 预留稳定高度；Mobile Run 视图改为内容驱动的受限高度。
- icon-only 模式隐藏 Telemetry，避免在 EA 页面形成额外遮挡。
- 运行结束后最终值进入 Recap，运行 Telemetry 隐藏。

### 12.2 Phase

状态行支持：

- `Indexing inventory`
- `Opening 10x85+ reward`
- `Clearing duplicates`
- `Building 10x85+ squad`
- `Crafting Provisions`
- `Recovering TOTW`
- `Redeeming Rare Gold Pick`
- `Crafting 5x80+`
- `Reconciling inventory`
- `Stopping`

### 12.3 数据合同

UI 只渲染结构化 snapshot，不解析日志：

```js
{
  visible,
  phase,
  completedCycles,
  cycleLimit,
  specialSlots,
  storagePressureSbcCount,
  provisionsBatches,
  totwSbcCount,
  storageUsed,
  storageCapacity,
  inventoryVersion,
  calculating,
  updatedAt,
}
```

Workflow 发布 snapshot，entry 负责接线，`src/ui` 只负责纯渲染。UI 刷新应合并到 animation frame 或限制为每 100-200ms 最多一次，避免重复出现日志刷新卡顿。

## 13. Reward Alerts 和紧凑 Recap

### 13.1 Reward Alerts

- 所有主包、TOTW 包、Provisions 包、5x80+ 包和 Pick 结果继续走现有 highlight 归一化流程。
- 只按现有 `minimumRating + special` 规则发送 Toast、Desktop 和 ntfy。
- 不重复发送同一 item 的通知。
- 价格查询失败不阻断 Loop。

### 13.2 流式 Recap

长时间 Rolling Run 不得保存每个 receipt 和所有 EA item 对象。Recap 使用有界聚合器：

- 主循环、主包和总开包数量。
- TOTW、Provisions、Rare Gold Pick 和 5x80+ 完成次数。
- 评分直方图。
- Common/Rare/Special 和 duplicate 数量。
- 重复卡进入主 SBC、Storage 和恢复路径的数量。
- 最终资源快照和停止原因。
- 最多保留评分最高的 50 张卡摘要。
- 最多保留 100 张达到 Reward Alert 条件的特殊卡摘要。
- 明确显示被省略的记录数量。

聚合器只保存可序列化摘要，不保存 EA 活对象、完整响应或无限增长的日志副本。

## 14. 停止条件

以下任一条件成立时停止，并保留可恢复状态：

- 用户点击 Stop。
- 达到正数 `SBC completion`。
- `Open reward packs` 在启动时关闭。
- 主 SBC 或关键恢复 SBC 不存在、过期或 metadata 不受支持。
- live Required Special matcher 不可用。
- 当前阵容不可行且所有恢复路径均不可用。
- 必须存储的高分重复卡无法获得 Storage 位置。
- 多张 Required Special 阻塞，且不能存储或继续预做主 SBC。
- mutation 结果不确定且只读对账仍无法确认。
- 同一库存版本和状态连续执行恢复却没有取得进展。
- FSU/EA 库存服务未就绪或候选实体验证失败。

停止结果必须包含稳定 reason code、用户可读原因、当前 phase、库存版本和安全的资源摘要。

## 15. 模块边界和计划文件

计划新增或扩展的模块如下，最终文件名可在实施时按现有目录结构微调：

| 模块 | 计划职责 |
| --- | --- |
| `src/config` | Rolling policy、动态 capability 绑定、默认 quantity 和设置迁移 |
| `src/domain` | item role、ledger snapshot/delta 和 stop reason 合同 |
| `src/runtime/telemetry.js` | 有界 Telemetry snapshot 和 animation-frame 合并发布 |
| `src/selection` | required/preferred/protected/exclusive role 评分求解 |
| `src/workflows/rolling-upgrade.js` | 纯状态机编排，不访问运行时全局 |
| `src/unassigned` | 接受配置化恢复链和保留角色，不认识具体 SBC 名称 |
| `src/reward` | 有界流式 Recap 聚合 |
| `src/ui/runtime-telemetry.js` | Telemetry 纯渲染和响应式状态 |
| `src/userscript-entry.js` | Adapter 注入、动态 SBC 接线、InventoryDelta 和 UI 发布 |

共享模块的默认合同不得变化。Rolling 行为必须通过显式 policy/strategy 启用。

## 16. 风险与影响面

| 变更 | 风险 | 控制方式 |
| --- | --- | --- |
| 评分 Solver exclusive role | 高，可能影响全部评分 SBC | 新字段 opt-in；characterization 和 differential tests 锁定旧行为 |
| Unassigned/Storage 压力恢复 | 高，涉及重复卡和高价值卡 | 纯规划、进度指纹、提交前多阶段 validator、真实页面边界验证 |
| Required Special 动态 matcher | 高，活动规则会变化 | 保留原始 group；live matcher；不可用即停止 |
| Inventory Ledger | 中，可能与外部操作或 provisional cache 不一致 | EA receipt 后提交 delta；周期和异常对账；定向验证 |
| 动态 SBC capability 绑定 | 中，名称和奖励可能变化 | family + live metadata 双重验证；不写死 ID |
| Protection rating 迁移 | 中，影响 Pick 用户设置 | 向后迁移测试；其他评分 Loop 不接入共享阈值 |
| Runtime Telemetry | 低到中，可能引起 UI 卡顿或重叠 | 纯渲染、节流、稳定尺寸、桌面/移动测试 |
| 紧凑 Recap | 中，影响普通 Loop recap | Rolling opt-in retention policy，旧 Recap 默认行为锁定 |

## 17. 自动测试矩阵

### 17.1 Config 和 discovery

- 动态识别当前 `high-rated-x10` 主 SBC。
- Challenge 评分、球员数或特殊卡 count 改变时使用实时值。
- 名称近似但 family/奖励不匹配时拒绝绑定。
- 主、TOTW、Provisions、Pick、5x80+ capability 缺失时返回准确预检结果。
- `SBC completion=0` 只对 Rolling 表示无业务上限。
- 选择 Rolling 默认勾选 Open rewards，但不覆盖用户之后的手动修改。
- 旧 Auto-pick 阈值迁移为 Protection rating。

### 17.2 Selection

- Required Special 在四个 pile 中都不能进入普通槽。
- 主 SBC 恰好选择一张 Required Special。
- 多张 Required Special 重复卡不会进入同一主阵容。
- TOTW、Provisions、Pick 和 5x80+ 都排除 Required Special。
- Required Special 即使位于当前 Reserve 范围也不进入 Provisions 储备。
- Other Special 在 Storage 可用；Club 普通 Other Special 可作为最后候选，但 Club TOTS/FOF/FUTTIES 始终硬保护。
- Required Special 来源规则为 Unassigned/Storage/Transfer 接受 live matcher，Club 只接受 TOTW；候选过滤、ledger 分类和提交前验证结果一致。
- 高评分重复卡受 Protection rating 保护。
- 高分重复必用卡配低分材料可以得到最低合格阵容。
- 平均评分方案更合理时不会强行使用额外高分卡。
- 不传 exclusive role 时，现有 rating tests 和 differential tests 结果不变。

### 17.3 Workflow

- 有现成主包的正常循环。
- 无主包时从库存启动一次。
- 库存已有两套以上 Reserve 时仍先规划并提交可行主阵，不在启动阶段主动做 Provisions。
- 可行主阵不会因 My Packs 中存在历史 Provisions/5x80+ 奖励包而延迟或被抢占。
- 主阵明确缺料后才进入 leftover recovery。历史 Provisions 默认每批最多开启 2 包，可在 Selection Policy 的 `Provisions packs per shortage` 中配置为 1-30；每批结束必须重新规划主阵，只有仍然明确缺料时才开启下一批。每个 Provisions 包产生的重复 Gold 在继续恢复前走 Rare Gold Pick/5x80+ 清理链；历史奖励耗尽且主阵仍缺料时，才新做一套 Provisions。
- 缺料或紧急恢复刚提交的 Provisions 以及 5x80+ 只由显式 `pendingRecoveryReward` 立即领取，不与历史遗留包扫描混用。`duplicate-reserve` 和 Storage-pressure Provisions 默认保留奖励到主阵缺料时再由 batched leftover recovery 开启；用户可显式恢复 duplicate-reserve 奖励立即开启。TOTW 恢复保持逐包决策：一次只开一个已有 TOTW 奖励并重新规划，不受 Provisions 批量设置影响。
- 恢复奖励中的 Reserve 不会被误判为本轮主包的 `duplicate-reserve`。
- Store catalog 中同 ID 的已消费包不会被当作真实 My Packs 实例再次开启。
- 一张和多张 Required Special 重复卡。
- 缺 Required Special 后打开现有 TOTW reward。
- 无 TOTW reward 后提交 TOTW Upgrade。
- TOTW Upgrade 缺材料时先走 Provisions。
- Provisions Rare duplicate 先走 Pick，剩余 Gold 走 5x80+。
- Storage 满但有可消耗材料时成功腾出空间。
- Storage 满且无安全恢复路径时保留高分卡并停止。
- 恢复奖励再次产生重复卡时不递归失控。
- Stop 在每个 mutation 边界都生效。
- Dry Run 和 Live 使用同一决策结果，Dry Run 无副作用。

### 17.4 Ledger 和 Telemetry

- 开包、移动、提交、Pick 的 delta 正确更新每个 pile。
- 未确认 mutation 不永久更新账本。
- 外部变化和 item 缺失触发重建。
- 一万张合成库存索引保持线性、无网络调用和可接受耗时。
- capacity 按 inventoryVersion 缓存并在 delta 后失效。
- 未知/刷新状态不显示错误零值。
- Telemetry 在普通 Loop 中隐藏。
- Desktop、Mobile、touch 和 icon-only 不重叠、不截断。
- 高频 snapshot 被合并，不造成日志或主面板刷新卡顿。

### 17.5 Recap 和长期运行

- 一万次模拟循环后 retained rows 仍有固定上限。
- rating/type/duplicate/recovery 计数准确。
- top cards 和 qualifying Special 排序稳定。
- 省略数量准确。
- Reward Alert 不因紧凑 Recap 重复触发。

## 18. 真实页面验收

自动测试通过后按风险递增验证：

1. Dynamic SBC scan 能发现并校验当前主 SBC 和恢复 SBC。
2. Dry Run 显示特殊槽、普通材料、Protection rating 和当前能力，不产生 mutation。
3. 从已有主包完成一轮，无重复卡。
4. 从库存 bootstrap 一轮。
5. 一张 Required Special 重复卡进入主特殊槽。
6. 两张以上 Required Special 重复卡只允许每套一张，并正确 Storage 或预做下一套。
7. 缺 Required Special 时完成 TOTW 恢复。
8. 缺普通材料时完成 Provisions，并处理 Rare/Common duplicate。
9. Storage 接近满时成功释放空间。
10. Storage 无法安全恢复时停止且高分卡仍存在。
11. `SBC completion=0` 可持续运行并响应 Stop。
12. 正数 completion 精确停止，恢复 SBC 不计数。
13. Toast、Desktop 和 ntfy 在符合现有 Reward Alert 条件时各触发一次。
14. 长运行 Telemetry 持续更新，日志可滚动，最终 Recap 有界。
15. 原版 FSU 与 FSU Local 至少各完成一次预检；FSU Local provisional 实体继续定向验证。

每次真实验证应保存：

- Runner 版本和 Git commit。
- Loop 配置和 Protection rating。
- Runner 日志。
- 必要的截图或 diagnostics。
- 起止 Storage、特殊卡和完成次数。
- 结果、偏差和对应修复提交。

## 19. Milestones

### RL-0：基线与 Characterization

状态：`Complete`

- 锁定现有 high-rated x10 discovery、rating selection、Pick threshold、Unassigned 和 recap 行为。
- 为主流程及恢复流程建立最小 fixture。
- 记录所有现有调用点和影响面。
- 不改变运行时行为。

验收：相关 characterization tests 和完整 `npm run verify` 通过。

RL-0 调用点审计（2026-08-16）：

| 能力 | 当前事实来源 | 运行时接线 | 主要回归面 |
| --- | --- | --- | --- |
| high-rated xN 发现 | `src/config/upgrade-discovery.js`、`src/config/upgrade-policies.js` | `src/userscript-entry.js` 的 Dynamic SBC scan、activity merge 和 Challenge materialization | Dynamic Pick、TOTW、2x84+、84x10 和其他 high-rated xN |
| 评分模型与候选 | `src/selection/rating-model.js`、`rating-candidates.js`、`rating.js`、`inventory.js` | entry 的 candidate bridge、FSU/EA 实体转换和 `fillSbcSquadRatingOptimized()` | 所有 rating-constrained SBC、FSU 保护、duplicate signal 和 pile priority |
| Pick 阈值 | `src/config/runtime-options.js`、`loop-schema.js` | 主面板 bindings、Builder 和 Player Pick redemption | 全部静态/动态 Pick 和旧本地设置迁移 |
| Unassigned | `src/unassigned/plan.js`、`resolve.js` | entry 的 `resolveRuntimeUnassigned()`、配置化 overflow resolvers 和 Pack settlement | 所有开包、Daily、Provision、Batch Open 和恢复路径 |
| 普通 Loop Recap | `src/reward/loop-recap.js`、`src/ui/loop-recap.js` | entry 的 session receipt recorder、`beginLoopRecapSession()` 和 `finalizeLoopRecap()` | 普通 Loop 开包、价格补全、FUTBIN 和 Reward Alerts |
| 发布产物 | `src/userscript-entry.js` 和上述模块 | `scripts/build-userscript.mjs` | 根目录/`dist` userscript 一致性 |

RL-0 锁定的当前行为和已确认缺口：

- 不限次数的普通 dynamic high-rated x10 当前仍投影为 `default:3`、`min:1`、`max:50`，不支持 `SBC completion=0`。
- 普通 dynamic high-rated x10 当前默认 `openRewardPacks:false`，缺料恢复仍绑定 `rare-gold-material-upgrade`，不能表达 Rolling 的 Provisions 链。
- Pick `autoPickThreshold` 与 rating SBC 的 `ratingSbcMaxCardRating` 当前相互独立。
- Rating Solver 支持 EA constraint、最大特殊卡数量和 pile priority，但没有 required/preferred/protected item 以及 exclusive role 合同。
- Generic Unassigned Resolver 已支持有序回调、递归保护和进度指纹；Storage 满且未注入 resolver 时保持 blocked。Rolling 应注入策略，不复制 Resolver。
- Generic Loop Recap 当前保留全部 receipt、row 和 item 对象。Rolling 必须 opt-in 使用有界聚合，不能改变普通 Loop 默认 Recap。
- 当前主面板没有结构化 Runtime Telemetry；运行状态只能通过日志和 Mobile run summary 观察。

新增基线证据：

- `tests/fixtures/challenges/rolling-10x85-baseline.json`
- `tests/contracts/rolling-upgrade-baseline.test.js`
- 覆盖动态策略、Pick/评分阈值独立性、特殊条件与 pile priority、Storage blocked 和普通 Recap 全量保留。

实施结果（2026-08-16）：没有修改运行时行为。新增 1 份 fixture 和 5 个跨模块 characterization tests；完整 `npm run verify` 通过，169 个测试文件、1,126 个测试全部成功，Runner/FSU 生成产物和版本检查通过。

### RL-1：配置、动态 capability 和 UI 设置合同

状态：`Complete`

- 定义 Rolling strategy/policy/schema。
- 动态绑定主、TOTW、Provisions、Pick 和 5x80+ capability。
- 合并 Protection rating 设置并迁移旧 Pick 配置。
- 接入现有 `SBC completion`，Rolling 默认零。
- 选择 Rolling 时默认启用 Open rewards，并增加启动预检。
- 功能仍保持 hidden/MVP。

验收：schema、discovery、migration、quantity 和 command tests 通过；旧 Profile 仍可加载。

实施结果（2026-08-16）：

- 新增专用 `rollingUpgrade` strategy、schema 和 dispatch slot；动态生成的 Rolling Loop 使用独立 ID，不修改或替换现有通用 high-rated x10 Loop。
- 只对实时扫描确认 `high-rated-x10`、10 个奖励且恰好一个 Required Special 槽的主 SBC 生成 Rolling Loop。
- 主 SBC、TOTW、Provisions、Rare Gold Player Pick 和 `5x80+` 均由本次扫描的 metadata 动态绑定，不包含静态 Set、Challenge、Pack 或 Pick resource ID。
- `Repeatable FUTTIES Provisions Upgrade` 从 `PLAYER_MIN_OVR` 和实时人数解析；`5x80+` 使用独立 `5x80-upgrade` family，避免被其他更高奖励的 Gold material sink 替换。
- 运行时设置以 `protectionRating` 为规范字段；旧 `autoPickThreshold` 继续读取并迁移，现有 rating SBC 上限不变。
- `runtimeQuantity.allowZero` 只允许 `rollingUpgrade` 使用；Rolling 的 `SBC completions` 默认 `0`，通用 Loop 仍保持最小值 `1`。
- 选择 Rolling 时仅在 selection command 中默认勾选 Open rewards；普通 render 不覆盖用户随后取消的值。启动预检会先拒绝关闭奖励的请求。
- Rolling 仍为 `hidden/MVP`，Builder 不提供新建入口，`rollingWorkflowEnabled:false` 使其在 RL-4 状态机落地前无法执行副作用。
- 新增 RL-1 unit tests，并更新 discovery、schema、migration、quantity、command、Builder、dispatch 和基线测试。完整 `npm run verify` 通过，170 个测试文件、1,136 个测试全部成功。

### RL-2：角色化评分选材

状态：`Complete`

- 扩展通用 SelectionPlan 合同。
- 实现 Required Special exclusive role 和 exact-one validator。
- 实现 required/preferred/protected inputs。
- 实现 Provisions 储备和 Protection rating 规则。
- 保持旧评分 SBC 默认结果不变。

验收：新增 selection tests、现有 differential tests、全部 rating SBC tests 和 `npm run verify` 通过。

实施结果（2026-08-16）：

- 通用 rating selection 新增可选 `requiredItems`、`preferredItems`、`protectedItems`、`exclusiveRoles`、`maxOrdinaryRating` 和 `protectionPolicy`；字段全部缺失时直接走原有路径。
- `exclusiveRoles` 可通过 `constraintId`/`constraintIndex` 复用候选构建时执行的 live EA matcher；求解状态同时维护角色最小/最大数量，Required Special 无法作为第二张普通材料进入同一阵容。
- `requiredItems` 转换为 exact-one item role；`preferredItems` 只影响同一最低评分向量的确定性选择；`protectedItems`、Protection rating 上限和当前非 Required Special Reserve 在评分建桶前分类。
- Club Other Special 默认进入软保护层；只有普通候选不可行且显式允许 fallback 时才使用。`allowOtherSpecialAsOrdinary` 只在 role-aware policy 明确启用时放宽旧的特殊卡总量策略。
- 保存前后的 validator 支持同一 exclusive role min/max 复核。live matcher/metadata 缺失时 fail closed。
- 新增五类 Solver 结构化失败原因和仅含数量、评分直方图、最高可达评分及角色汇总的诊断；`PROTECTED_STORAGE_BLOCKED` 仍由 RL-4 开包后 Storage 路由产生，不由纯 Solver 伪造。
- userscript bridge 已验证 live `PLAYER_RARITY_GROUP` matcher、exact-one Required Special、Club Other Special 软保护和 fallback；Rolling workflow 仍保持 `rollingWorkflowEnabled:false`，本阶段不执行 SBC 或开包副作用。

### RL-3：Inventory Ledger 和能力计算

状态：`Complete`

- 建立初始本地库存索引。
- 定义 InventoryDelta 和 mutation confirmation 边界。
- 接入开包、移动、提交、Pick 和 Storage 更新。
- 实现周期/异常对账和 provisional Club 定向验证。
- 实现五项 Telemetry 派生指标。
- 添加性能诊断日志。

验收：合成大库存测试、mutation/reconciliation tests 和原版/Local FSU compatibility tests 通过。

实施结果（2026-08-16）：

- 新增纯内存 `Inventory Ledger`，按 item、definition、pile 和 rating 建立索引，并保存 Required Special、Other Special、Regular、Provisions reserve 和 protection 分类。10,000 张合成 Club 球员的本地索引测试稳定低于一秒，索引过程不调用网络。
- 新增不可变 `InventoryDelta` contract 及 Pack、Move、SBC Submission、Player Pick、Capacity 五类 projector。confirmed delta 在全部 identity/pile 预检通过后原子更新；ambiguous delta 不修改库存并要求对账。
- 容量同时支持 EA confirmed observation 和 pile 增量更新；未知容量保持 `null`。外部 added/removed/moved/changed/capacity drift 均可检测并重建索引。
- 新增 coordinator readiness 门禁。原版/未检测到 FSU 直接使用 EA 本地 Repository；ready FSU 正常使用；loading/not-ready fail closed；provisional FSU 允许索引，但提交前按 item ID + definition ID 定向验证 Club 卡及关键属性。
- confirmed Runner mutation 实时更新账本；歧义/不匹配 mutation 和显式 anomaly 立即执行本地对账；每十次主 SBC 自动对账。诊断事件最多保留 100 条且不包含完整卡对象。
- 新增按 ledger 实例、`inventoryVersion` 和 policy key 缓存的 capability calculator。真实页面验证发现，即使限制为 4 套，克隆 4,000+ 卡库存并反复运行评分 Solver 仍可占用 5-49 秒，因此实时能力值继续保持 classified ledger 的 O(n) 计数；已执行的 Storage Pressure/TOTW 提交次数由成功提交边界直接记录。
- `openPackTransaction()` 和 `submitSbcAttempt()` 新增 opt-in receipt/result observer；Player Pick 复用现有一次性 confirmation callback，Move/Capacity 通过统一 mutation observer adapter 接入。observer 未注入或失败时，旧 Loop 行为和已确认 EA 结果保持不变。
- Rolling workflow 仍保持 `rollingWorkflowEnabled:false` 和 hidden/MVP；普通 Loop 不创建 coordinator，本阶段不增加运行时扫描或执行副作用。
- 新增 30 项测试，完整 `npm run verify` 通过：176 个测试文件、1,177 项测试；Runner `v0.7.91`、FSU Local `v26.09.6`、root/dist userscript 和 release assets 均已重建并校验。

### RL-4：主 Rolling 状态机

状态：`Complete`

- 实现 bootstrap、主包开启、分类、主阵容提交和重复循环。
- 处理普通重复、当前配置的 Provisions Reserve、Required Special 队列和高分 Storage。
- 支持多张 Required Special 每套只消耗一张。
- 支持正数 completion、零上限、Stop 和 Dry Run。
- 不在本阶段自动制作恢复 SBC；不可行时返回结构化 reason。

验收：主路径、Storage 压力、Stop、Dry Run 和无进展测试通过。

实施结果：

- 新增无 EA/FSU/DOM 依赖的 `runRollingUpgradeWorkflow()`，显式编排 preflight、本地库存索引、已有包/库存 bootstrap、开包、分类、Storage 路由、主阵规划、提交和对账阶段。
- `maxCompletions:0` 保持无完成次数上限，但受 Stop 和 10,000 次内部安全边界保护；正数只统计主 SBC 提交。
- Dry Run 与 Live 共用同一状态机和通用评分 Solver；已有主包时停在未知奖励边界，无包时可完成当前库存主阵规划后停在提交边界。
- 新增 Rolling 库存 policy：高于 Protection rating 的重复卡和额外 Required Special 先进入 Storage；普通库存中的当前配置评分仍是 Provisions reserve，默认 87/88。后续 RL-8 实机修正进一步规定：当前主包完整四张 Reserve 立即进入 Provisions，余数进 Storage，其它可用主包重复卡进入下一套主 SBC。Storage 容量未知或不足时返回 `PROTECTED_STORAGE_BLOCKED`。
- 动态 `PLAYER_RARITY_GROUP` matcher 作为 exact-one exclusive role 传入通用 Solver。当前 Unassigned 普通重复作为 required item，其他普通重复作为 preferred item，Club Other Special 保持软保护。
- 每次 Rolling 创建独立 Inventory Ledger coordinator；开包后本地对账，提交前验证 item refs，provisional FSU Club 卡继续执行 EA 定向验证，confirmed 主提交更新账本并每十次对账。
- 动态 Rolling 配置已设置 `rollingWorkflowEnabled:true`，但仍为 `hidden:true`、`mvp:true`。普通 Loop 不创建 coordinator，也不接入 Rolling selection policy。
- RL-4 不要求恢复 capability 可用，也不会自动提交 TOTW、Provisions、Rare Gold Pick 或 5x80+；主阵不可行时保留 Solver 的 `REQUIRED_SPECIAL_SHORTAGE`、`PLAYER_COUNT_SHORTAGE`、`SQUAD_RATING_SHORTAGE`、`RESERVED_FODDER_BLOCKED` 等结构化原因，恢复编排留给 RL-5。

### RL-5：TOTW、Provisions 和 Gold sink 恢复

状态：`Complete`

- 接入 TOTW reward/Upgrade 恢复。
- 接入 Provisions 常规、紧急和 Storage 压力触发。
- 接入 Rare -> dynamic Rare Gold Pick -> 5x80+ 路径。
- 实现恢复依赖和统一重规划。
- 加入恢复预算和进度指纹。

验收：每条恢复链、嵌套重复、缺失 capability 和安全停止测试通过。

实施结果：

- `runRollingUpgradeWorkflow()` 新增恢复奖励、重复 Gold 清理、Provisions 和 Required Special 阶段；每次只执行一个已验证动作，动作完成后回到同一个 Storage/奖励/重复卡/主 Solver 评估点，不递归调用其他 Loop。
- Required Special 缺失时先打开已存在的动态 TOTW reward；没有现成奖励时只提交一次动态 `84+ TOTW Upgrade`。TOTW 阵容材料不足时返回 Provisions 依赖，再从统一规划点重试 TOTW 和主 SBC。
- Provisions 的必要恢复触发为主 Solver 明确材料不足和 Storage 压力。显式开启 `rollingSurplusCraftingEnabled` 后，才增加当前主包完整 Reserve 的 `duplicate-reserve` 和主阵后的 Storage 维护；每次提交后重新读取 ledger 和重跑主规划。
- Provisions 奖励产生的 Rare Gold duplicate 优先进入动态不限次数 Rare Gold Pick 并立即选择；剩余普通 Gold duplicate 进入动态 `5x80+`。主 `10x85+` 奖励产生的重复卡绝不加入这条 Gold drain 链：默认全部作为主阵 required/preferred 候选并按高分优先放宽；开启余量制作时完整 Reserve 组进入 Provisions。每次提交或开包后重新读取实时库存，不预判随机奖励。
- 新增一次性 Rolling 运行时适配器，复用共享 `submitSbcAttempt()`、`submitInventorySbcAttempt()`、`openPack()`、Player Pick 和 Inventory Ledger；不调用旧 `runFillAndVerifyLoop()` 的递归补料编排。
- 恢复 SBC 默认硬排除 Required Special 和受保护卡。TOTW 恢复额外保留当前配置的 Reserve；Pick/5x80+ 也不消耗 Provisions 储备。Provisions 每次严格只选四张当前范围内的卡，默认 87/88、可选扩展到 89/90/91；超出范围的卡即使低于 Protection rating 也不得进入。Club Other Special 只在普通材料不足后回退；普通 shortage 还可在显式开关、严格保护关闭、live matcher 精确匹配及全部保护检查通过时，把范围内的 Club current-pool non-TOTW item 加入最后候选层。
- Unassigned/Transfer duplicate signal 只对本次主阵临时授权其 `duplicateId` 指向的真实 Club/Storage 提交实体；signal 受保护、缺少稳定实体或消失时保持 fail closed。确认提交后的 transport、ledger 登记和 duplicate 同步使用不可中断临界区，Stop 请求延迟到同步完成后的安全点执行。
- 每个主 SBC 周期有独立恢复预算：总动作 100、奖励开包 30、Gold drain 40、Provisions 20、Required Special 10；主提交成功后重置周期预算，全局结果保留有界计数。
- 每个恢复动作比较 Inventory Ledger `inventoryVersion` 进度指纹。动作声称成功但库存版本不变时以 `RECOVERY_NO_PROGRESS` 停止；预算耗尽时以 `RECOVERY_BUDGET_REACHED` 停止。
- Dry Run 使用同一恢复决策，在恢复 SBC 提交或未知奖励开包边界返回 `planned`。功能仍保持 `hidden:true`、`mvp:true`，等待 RL-8 真实页面验收。

### RL-6：Runtime Telemetry

状态：`Complete`

- 添加通用 Runtime Telemetry snapshot 和 renderer。
- 接入 Rolling phase、cycle 和五项资源指标。
- 完成 Desktop、Mobile、touch、resize 和 icon-only 布局。
- 合并高频 UI 更新，保持日志流畅。

验收：UI unit tests、响应式 screenshot/DOM 验证和长时间刷新测试通过。

实施结果（2026-08-16）：

- 新增 `src/runtime/telemetry.js`，统一归一化可序列化 snapshot，并把高频 publish 合并到一个 animation frame；字段和文本均有界，未知指标保持 `null`，刷新期间保留上一次可信值。
- Rolling workflow 的 phase 事件接入结构化 Telemetry；恢复 callback 可以通过受控 `reportPhase()` 发布 `Redeeming Rare Gold Pick` 和 `Crafting 5x80+` 等细分阶段，不需要 UI 解析日志。
- entry 按 Inventory Ledger `inventoryVersion` 串行请求能力计算并丢弃过期结果。Capability 只线性统计 Required Special、Provisions reserve 和 Storage；Storage Pressure/TOTW 指标不再运行估算 Solver，而是显示本次运行已确认的提交计数。相同版本复用 capability cache，不额外触发 EA Club 网络分页或评分 Solver。
- 主面板在 Running 与最新日志之间显示两列稳定资源网格和 Storage 进度条；未知值显示 `-`，80%-94% 使用 warning，95% 以上使用 danger。Desktop 预留稳定高度，Mobile Run 使用受限内容高度，icon-only 隐藏 Telemetry。
- 普通 Loop、Batch Open 和 Trade 不发布 visible snapshot，原有日志、运行状态和业务行为不变；Rolling 仍保持 `hidden:true`、`mvp:true`。
- 新增 6 项测试，覆盖 snapshot 有界/未知语义、10,000 次更新合并、phase adapter、指标/ARIA/Storage 压力渲染，以及 Desktop/Mobile/touch/resize/icon-only DOM/CSS 合同。完整 `npm run verify` 通过：376 个 JavaScript 文件语法检查、179 个测试文件、1,211 项测试，以及 ESLint、配置/Profile、架构、FSU patch、userscript 构建、root/dist 一致性和 FSU 发布资源检查全部成功；真实 EA 页面视觉和运行验收留在 RL-8。

### RL-7：有界 Recap 和通知集成

状态：`Complete`

- 实现 Rolling 流式聚合器和 retention limits。
- 接入现有 Reward Alerts 和价格补全。
- 显示恢复次数、评分分布、top cards、停止原因和最终库存。
- 保持普通 Pick、Batch 和 Loop recap 默认行为不变。

验收：一万次模拟运行内存有界，Recap/Alert 回归测试和 `npm run verify` 通过。

实施结果（2026-08-16）：

- 新增 `src/reward/rolling-recap.js`。聚合器只保存计数、评分直方图、路由计数和有界卡片摘要；top cards 上限为 50，达到 Reward Alert 阈值的 Special 摘要上限为 100，并明确记录两类省略数量。
- Rolling 生产接线使用 `retainReceipts:false`，不再在 workflow result 或会话中保留完整 Pack receipt 和 EA item；普通 Loop 仍使用原有 receipt-based recap。
- 主循环开包、TOTW、Provisions、5x80+ 和 Rare Gold Pick 的完成次数、重复卡进入 Primary/Storage/Recovery 的数量均进入聚合结果。Pick 结果通过同一个 `publishPackHighlight()` 入口发送通知，紧凑 Recap 只读取摘要和价格，不重复触发 Alert。
- 复用现有 Special 价格补全和 FUTBIN ID 解析；Recap 增加恢复、评分、Retention、停止点和最终库存指标区，页面仍使用现有分页和卡片主题。
- 新增 5 项测试，覆盖 10,000 次记录的固定上限、类型/评分/恢复/路由计数、价格和最终资源、Recap UI，以及 workflow 关闭完整 receipt retention。普通 Recap 回归通过。

### RL-8：集成、文档和真实页面门禁

状态：`In progress`

- 完成 entry Adapter 接线和生成 userscript。
- 更新用户指南、AGENTS 和必要的 Profile/Builder 文档。
- 运行完整 `npm run verify`。
- 完成第 18 节真实页面验收。
- 记录发现的问题、修复提交和最终版本。
- 动态扫描成功后将 Rolling Loop 加入可选列表，使用现有启动预检和动态 capability 门禁控制执行安全。
- Selection Policy UI 按作用域拆分普通 SBC 单卡上限、Rolling/Pick 自动使用上限、主动余量制作、Provisions Reserve 范围、普通恢复来源顺序、Club current-pool Provisions 最后候选、duplicate-reserve 奖励开启时机和 Pick 模式，旧配置 key 保持兼容。`rollingSurplusCraftingEnabled` 默认关闭；`rollingProvisionsMaxRating` 默认 88、允许 88/89/90/91；`rollingAllowClubCurrentPoolSpecialsForProvisions` 默认关闭并受严格 Club 色卡保护覆盖；`rollingRecoveryStorageFirst` 默认关闭，使普通 Provisions 与 Required Special/TOTW 恢复保持 Unassigned-first。待处理 Unassigned 重复卡不受该开关影响并始终 Unassigned-first，Storage pressure 与 maintenance 始终使用专用 Storage-first；`rollingOpenDuplicateProvisionsRewards` 默认关闭。

自动验证结果（2026-08-16）：候选版本 `0.7.94` 完成完整 `npm run verify`；388 个 JavaScript 文件通过语法检查，186 个测试文件、1,251 项测试全部通过，配置/Profile、架构、FSU patch、root/dist userscript 和版本一致性均通过。本轮修复 Runtime Telemetry 阻塞、主包重复 Reserve 的独立 Provisions 路由和 Primary 精确评分放宽。RL-8 仍需完成第 18 节真实页面验收与结果记录。

自动验证结果（2026-08-16）：候选版本 `0.7.95` 完成完整 `npm run verify`；388 个 JavaScript 文件通过语法检查，186 个测试文件、1,255 项测试全部通过，配置/Profile、架构、FSU patch、root/dist userscript 和版本一致性均通过。4,800 卡评分直方图测试把旧实现的 354,275 次状态转移约束到 100 次以内；4,096 个完整候选的角色化选材测试、4,000 张 Club 双 Repository 去重合同和 Provisions hard-block 控制流测试均已锁定。RL-8 仍需完成真实页面验收。

自动验证结果（2026-08-16）：候选版本 `0.7.100` 完成完整 `npm run verify`；389 个 JavaScript 文件通过语法检查，187 个测试文件、1,268 项测试全部通过。启动阶段的普通 Reserve 阈值触发已删除；当前主包 `duplicate-reserve`、可行主阵不扫描历史恢复包、主阵缺料后 leftover recovery、本轮 pending reward 隔离和恢复奖励来源隔离已有 workflow 测试。Inventory Adapter 另有同 definition 异评分/异 rareflag 卡保持非重复并路由 Club 的真实日志回归测试。Rolling 主包及恢复包仅使用真实 My Packs Repository 实例，Store catalog fallback 隔离已有 userscript 接线测试。RL-8 仍需完成真实页面验收。

自动验证结果（2026-08-17）：候选版本 `0.7.114` 完成完整 `npm run verify`；400 个 JavaScript 文件通过语法检查，193 个测试文件、1,387 项测试全部通过。新增 shortage Provisions 批量默认值、1-30 配置/schema/UI 投影、每批后重新规划及仍缺料才开启下一批的 workflow 回归测试。实机日志确认 Storage-pressure Provisions 奖励继续留在 My Packs，历史 Provisions、TOTW 和 5x80+ 均未被无条件开启；Storage 恢复可从 Provisions 安全回退到 95+ 双阵 Pick 并继续主循环。

发布候选验证（2026-08-17）：版本提升为 `0.8.0` 后再次完成完整 `npm run verify`；400 个 JavaScript 文件、193 个测试文件和 1,387 项测试全部通过，配置/Profile、架构、FSU patch、root/dist userscript、metadata 和版本一致性检查均成功。`0.7.114` 的实机证据作为同一实现的发布前页面验证保留。

自动验证结果（2026-08-18）：`0.8.0` 的提交安全修复完成完整 `npm run verify`；404 个 JavaScript 文件、195 个测试文件和 1,423 项测试全部通过，配置/Profile、架构、FSU patch、root/dist userscript 和版本一致性检查均成功。新增测试锁定不可交易重复卡的同版本交换、EA move 身份映射、交换后强制保存与账本对账，以及仅三条 Rolling 路径可对完全匹配当前提交阵容的 `409/itemViolations` 执行一次确认重试。仍需在真实 EA 页面复现“球员属于现有阵容”场景，确认服务端接受 `skipValidation:true` 后正常完成提交和库存清理。

自动验证结果（2026-08-18）：Rare Gold Pick capability 不再绑定固定 `85+/1 of 3/6 Rare` 模板。扫描结果新增 `unlimited/bounded/unknown` repeatability 事实；Rolling 只接受 live `repeats:0`、单 Challenge、单选、全 Gold 且至少要求一张 Rare 的 Pick，并按 minimum Rare cost、total Gold cost、reward minimum rating、candidate count 排序。运行时按序尝试备用候选，全部不可用才回退到 `5x80+`。完整 `npm run verify` 通过：404 个 JavaScript 文件、195 个测试文件、1,425 项测试，配置/Profile、架构、FSU patch、root/dist userscript 和版本一致性检查全部成功。

自动验证结果（2026-08-22）：候选版本 `0.8.40` 修复实验交换关闭时的紧急 Provisions 授权泄漏。待存 Unassigned Reserve signal 在候选和提交前两层保持硬保护；安全 Provisions 不可行时继续 Storage pressure SBC，并要求真实 Storage 净消耗。完整 `npm run verify` 通过：413 个 JavaScript 文件、199 个测试文件、1,746 项测试，配置/Profile、架构、FSU patch、root/dist userscript 和版本一致性检查全部成功。仍需用当前被阻塞的真实 Unassigned 批次重新运行一次，确认页面实际走安全 Provisions 或 Storage pressure fallback 后完成整体 Storage 路由。

当前工作区修正：Rolling requirement recovery 改为显式后台 DAO 提交；保留 FSU runtime access、不可交易重复卡交换、保存前后 validator、Active Squad 409 保护和后台提交诊断。新增架构测试锁定该入口不再调用前台 `submitSbcAndGetAwardPackId()`，事务单测锁定交换后的最终玩家必须经过保存、保存后校验和 transport。普通 Loop 提交路径保持不变。

验收：实现、自动验证、生成产物、文档和真实页面证据全部完成。

### RL-9：95+ 双阵 Storage sink

状态：`In progress`

- 动态识别 `1 of 3 95+ FOF or FUTTIES T1-T3 Player Pick`，不维护静态 ID。
- 在紧急 Provisions 不可用后接入第二级 Storage-pressure recovery。
- 按 89 后 88 的顺序独立规划：89 阵使用 Unassigned + Storage，88 阵先使用 Storage、必要时最多补三张普通 Club 卡。
- 提交 89 阵后重新对账并读取 live Challenge，再规划 88 阵；记录并可恢复非原子 partial completion。
- Pick 立即领取，复用统一 Pick 选择、通知、Recap 和 Unassigned 处理。
- 在 Selection Policy 增加默认关闭的用户 opt-in；扫描与 capability 展示不受开关影响，实际 workflow 执行必须显式启用。
- 增加 capability、schema、顺序规划、headroom、workflow budget/no-progress 和架构测试。

自动测试结果（2026-08-16）：完整 `npm run verify` 通过；384 个 JavaScript 文件通过语法检查，183 个测试文件、1,237 项测试全部成功，配置/Profile、架构、FSU patch、userscript 构建、root/dist 和 FSU 发布资源检查均通过。真实页面需验证默认关闭、显式启用、动态扫描、双阵材料充足、headroom 不足、第一阵后第二阵失效及 Pick 重复结果七类边界。

验收：完整 `npm run verify`、userscript 构建和第 18 节新增实机场景全部通过后标记 `Complete`。

## 20. 进度总览

| Milestone | 状态 | 自动测试 | `npm run verify` | 真实页面 | Commit |
| --- | --- | --- | --- | --- | --- |
| RL-0 基线与 Characterization | Complete | 5 个新增基线测试通过 | 169 files / 1,126 tests | N/A | pending |
| RL-1 配置与动态 capability | Complete | 10 个净新增测试通过 | 170 files / 1,136 tests | N/A（hidden/inert） | pending |
| RL-2 角色化评分选材 | Complete | 11 个净新增 selection/rating 测试通过 | 171 files / 1,147 tests | N/A（hidden/inert） | pending |
| RL-3 Inventory Ledger | Complete | 30 个净新增 ledger/delta/capability/observer 测试通过 | 176 files / 1,177 tests | N/A（hidden/inert） | pending |
| RL-4 主 Rolling 状态机 | Complete | 17 个净新增 workflow/inventory policy 测试通过 | 178 files / 1,194 tests | 待 RL-8（hidden/MVP） | pending |
| RL-5 恢复链 | Complete | 11 个净新增 recovery workflow/policy 测试通过 | 178 files / 1,205 tests | 待 RL-8（hidden/MVP） | pending |
| RL-6 Runtime Telemetry | Complete | 6 个新增 telemetry/workflow/UI 测试通过 | 179 files / 1,211 tests | 待 RL-8（hidden/MVP） | pending |
| RL-7 有界 Recap 与通知 | Complete | 5 个新增 recap/retention 测试通过 | 181 files / 1,216 tests | 待 RL-8（hidden/MVP） | pending |
| RL-8 集成与实机验收 | In progress | Selection Policy/visibility/Reserve routing/large-inventory performance tests passed | 193 files / 1,387 tests | `0.7.114` 实机日志验证主循环、缺料批次和恢复包隔离 | pending |
| RL-9 95+ 双阵 Storage sink | In progress | capability/sequential-plan/partial-resume/opt-in/workflow tests passed | 193 files / 1,387 tests | `0.7.114` 实机验证 Storage-pressure Provisions 回退和双阵 Pick | pending |

## 21. 实施记录

每完成或阻塞一个 Milestone，在此追加记录：

| 日期 | Milestone | 状态变化 | Commit | 测试/证据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-16 | Planning | - -> Not started | `0be883d` | 设计讨论完成 | 尚未修改运行时代码 |
| 2026-08-16 | RL-0 | Not started -> Complete | pending | `npm run verify`：169 files / 1,126 tests | 仅增加 fixture、characterization tests 和影响面审计 |
| 2026-08-16 | RL-1 | Not started -> Complete | pending | `npm run verify`：170 files / 1,136 tests | 配置、动态 capability、Protection rating、零数量、UI command 和启动门禁；功能仍 hidden/inert |
| 2026-08-16 | RL-2 | Not started -> Complete | pending | `npm run verify`：171 files / 1,147 tests | role-aware 纯选材、live matcher bridge、exact-one validator、结构化失败诊断；功能仍 hidden/inert |
| 2026-08-16 | RL-3 | Not started -> Complete | pending | `npm run verify`：176 files / 1,177 tests | 本地 Inventory Ledger、confirmed delta、对账、provisional FSU 定向验证、capability cache 和 opt-in mutation observers；功能仍 hidden/inert |
| 2026-08-16 | RL-4 | Not started -> Complete | pending | `npm run verify`：178 files / 1,194 tests | 主 Rolling 状态机、开包分类/Storage 路由、库存 bootstrap、exact-one Required Special、Stop/Dry Run、运行时 coordinator 接线；功能仍 hidden/MVP，恢复链留待 RL-5 |
| 2026-08-16 | RL-5 | Not started -> Complete | pending | `npm run verify`：178 files / 1,205 tests | 动态 TOTW/Provisions/Pick/5x80+ 单步恢复、Storage 压力、统一重规划、每主周期预算和 Inventory Ledger 进度指纹；功能仍 hidden/MVP |
| 2026-08-16 | RL-6 | Not started -> Complete | pending | `npm run verify`：179 files / 1,211 tests | 有界 snapshot、串行 capability refresh、phase/cycle/五项指标、animation-frame 合并和响应式 DOM/CSS；功能仍 hidden/MVP |
| 2026-08-16 | RL-7 | Not started -> Complete | pending | `npm run verify`：181 files / 1,216 tests | Rolling 流式有界 Recap、50/100 retention、恢复/路由/评分聚合、Pick Alert 统一入口、价格补全和 Recap 指标；功能仍 hidden/MVP |
| 2026-08-16 | RL-8 | Not started -> In progress | pending | `npm run verify`：182 files / 1,222 tests | `0.7.92` 已构建；Rolling 扫描后可选，Selection Policy 按作用域分组；待真实页面验收 |
| 2026-08-16 | RL-9 | Not started -> In progress | pending | `npm run verify`：183 files / 1,237 tests | 动态 95+ Pick capability、默认关闭的用户 opt-in、DAO item-group matcher fallback、89+88 联合预检、Storage headroom、非原子 partial completion 和即时 Pick 接线；待真实页面验收 |
| 2026-08-16 | RL-8 | Runtime performance/routing fix | pending | `npm run verify`：186 files / 1,251 tests | `0.7.94`：Telemetry 改为 O(n) ledger 计数；主包完整四张 87/88/89 通过 `duplicate-reserve` 立即做 Provisions，余数才存 Storage；Primary 放宽卡显式排除并保持 exact-target 规划 |
| 2026-08-16 | RL-8 | Large-inventory planner/identity fix | pending | `npm run verify`：186 files / 1,255 tests | `0.7.95`：评分配方改为评分直方图单调可行性规划，4,096 候选性能测试锁定；EA 双 Club Repository 按 item ID 去重；普通 Provisions 的 hard block 不再被主规划掩盖 |
| 2026-08-16 | RL-8 | Startup recovery priority fix | pending | `npm run verify`：187 files / 1,259 tests | `0.7.96`：普通 Reserve 不再抢占主阵启动；当前主包完整 Reserve 优先解阻；Provisions/5x80/TOTW 和主 reward 只开启真实 My Packs 实例 |
| 2026-08-16 | RL-8 | Required Special source restriction | pending | `npm run verify`：187 files / 1,261 tests | `0.7.97`：Unassigned/Storage/Transfer 接受 live matcher；Club 仅允许 TOTW，Club TOTS/FOF/FUTTIES 由候选、ledger 和提交前校验共同硬保护 |
| 2026-08-16 | RL-8 | Provisions range and transient identity fix | pending | `npm run verify`：389 files / 187 test files / 1,264 tests | `0.7.97`：Provisions 严格限定 87-89；修复 duplicate signal 对应实体被重复保护造成的库存误判；Rolling 仅生成于 10x85+；确认提交期间延迟 Stop 直到 ledger 和 duplicate 同步完成 |
| 2026-08-16 | RL-8 | Leftover recovery reward priority fix | pending | `npm run verify`：389 files / 187 test files / 1,265 tests | `0.7.98`：本轮 pending reward 与历史 leftover 分离；可行 bootstrap 不再清理遗留 Provisions/5x80+；主阵缺料后才进入 leftover recovery |
| 2026-08-16 | RL-8 | Latent duplicate version guard | pending | `npm run verify`：389 files / 187 test files / 1,266 tests | `0.7.99`：Club/Storage latent duplicate 回补要求 definition、评分和 rareflag 同版本；同 definition 的异版本非重复卡保持 Club 路由 |
| 2026-08-16 | RL-8 | Provisions frequency controls | pending | `npm run verify`：389 files / 187 test files / 1,268 tests | `0.7.100`：Reserve 默认收窄为 87/88，可选 87/88/89；`duplicate-reserve` 奖励默认留在 My Packs，主阵普通材料不足时才由 leftover recovery 开启，可选恢复立即开启 |
| 2026-08-17 | RL-8 | Shortage reward batching | pending | `npm run verify`：400 files / 193 test files / 1,387 tests | `0.7.114`：主阵真实缺料时历史 Provisions 默认每批开 2 包、可配置 1-30；每批后重新规划，仍缺才继续；TOTW 保持一次一包；Storage-pressure 奖励继续留在 My Packs |
| 2026-08-17 | RL-8 | Surplus crafting opt-in | pending | targeted tests：7 files / 108 tests | `0.7.105`：主动 `duplicate-reserve` 与主阵后 Storage Provisions/TOTW 维护默认关闭；85-89 可用重复卡优先回填主阵，精确 84 阵按 89 到 85 顺序放宽；缺料与 Storage 压力恢复保留 |
| 2026-08-17 | RL-8 | Storage recovery ownership fix | pending | `npm run verify`：193 files / 1,349 tests | `0.7.106`：恢复 SBC 确认提交后按 `consumedItemRefs` 清理 opened-item Routing 所有权；Storage-pressure Provisions 可消费已存 Reserve 并继续保存延后高分卡；同 definition 的其他实例不受影响；同一恢复提交只登记一次 ledger delta |
| 2026-08-18 | RL-8 | Background submit confirmation and untradeable swap | pending | `npm run verify`：404 JS files / 195 test files / 1,423 tests | `0.8.0`：Rolling 三条评分提交路径支持严格限定的 `409/itemViolations` 单次确认；提交前把选中的 Club 可交易重复卡交换为 Unassigned 不可交易同版本，并锁定身份、保存、对账和 fail-closed 回归测试 |
| 2026-08-18 | RL-8 | Dynamic unlimited Rare Gold Pick capability | pending | `npm run verify`：404 JS files / 195 test files / 1,425 tests | `0.8.0`：用不限次数、全 Gold 且含 Rare 最低要求的动态合同替代固定 85+ Pick；按 Rare/总 Gold 成本排序、支持备用候选和 live repeatability 复核，有限或 unknown Pick 保持 standalone-only |

## 22. 完成定义

本功能只有满足以下全部条件才算完成：

- 所有已确认业务规则均由结构化 policy 和测试表达。
- Required Special 在所有提交路径中都不能被当作普通材料。
- 所有 SBC 身份和要求均通过动态 metadata 校验。
- Dry Run 和 Live Run 共用决策逻辑。
- Storage 满、重复卡阻塞和恢复路径均能安全取得进展或明确停止。
- Inventory Ledger 对 Runner 自身变化实时更新，并能对账外部变化。
- Telemetry 不依赖日志解析，不造成 UI 卡顿或重叠。
- Recap 和运行内存有界。
- `npm run verify` 完整通过。
- 真实页面验收完成并记录证据。
- 生成的 `FCAutomationTool.user.js` 与源码一致。
- 本文档的 Milestone、提交和验收记录已更新。
