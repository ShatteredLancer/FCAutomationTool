# FC Automation Tool 用户手册

## 1. 启动状态

Runner 安装面板后会恢复本地配置、读取缓存并扫描当前 SBC/Pack 元数据。扫描期间主操作区显示进度，运行按钮保持不可用。

常见状态：

- `Refreshing SBC index`：读取当前 Set 和 Category。
- `Checking ...`：验证变化或未缓存的 Challenge。
- `Updating Loops and Pack Catalog`：物化动态 Loop 和来源包引用。
- `Ready v...`：启动完成，可以运行。

Incremental scan 会逐个比较 SBC 结构指纹，只重新读取变化项。首次运行、清除缓存或 EA 大量更新后会更慢。扫描只读，不会提交 SBC、领取 Pick 或开包。

## 2. 主面板

紧凑模式显示 Profile、Loop、数量、Start、Stop 和最新日志。展开 Options 后可以访问运行设置、缓存/扫描、Builder、Batch Open、Reward Alerts 和完整日志。

- `Profile`：选择内置、官方或用户配置。
- `Loop`：选择当前 Profile 提供的可运行流程。
- 数量：由 Loop 的 `runtimeQuantity` 定义；限次 Daily/Pick 通常读取 EA 剩余次数。
- `Start`：开始当前流程。
- `Stop`：请求在下一个安全点结束。
- `Save log`：下载当前完整日志。
- `View recap`：重新打开最近一次有效 recap。

## 3. 全局运行设置

### Open reward packs

作为顶层 Workflow/Loop 的默认奖励策略向子 Loop 传播。子 Loop 或 step 可以通过 `rewardFlow.open` 显式覆盖；后续阶段必须消费的奖励仍可由 `forceOpenRewardPacks` 强制打开。

它不控制 Player Pick 领取、Batch Open 或手动开包。

### Inventory only

作为支持该能力的 Loop 的全局默认值：

- Daily Bronze/Silver 使用库存，不打开来源和最终奖励包。
- Supply-and-Craft 跳过 shortage/source packs，只从允许的库存 pile 选材。
- Provision、Rare Pack 和 Batch Open 不会被静默改写。

Loop 的 `inventoryMode: inherit | inventory-only | normal` 可以继承或覆盖该值。

### Pick 设置

- `Automatic-use max rating`：独立的评分保护设置，影响默认评分优先策略和 Rolling 材料使用范围。
- `Selection mode`：统一控制普通 Pick Loop、Rolling 恢复和 Provisions 预处理 Pick。
- `Open Picks at end`：Pick Loop 完成目标后集中领取；父 Workflow 默认可被子 Pick 覆盖。

| Selection mode | 行为 |
| --- | --- |
| `Rating first` | 保留旧行为：先按评分，再按特殊卡、重复状态和价格处理；不超过自动使用上限时可自动选择。 |
| `Rating first, review protected ties` | 仍按评分优先，但不使用阈值绕过受保护特殊卡的人工确认。 |
| `Special price first` | 所有特殊卡始终排在普通卡前；特殊卡跨评分按实时价格从高到低排序，价格相同时优先非重复卡。 |
| `Always review specials` | 只要候选中出现特殊卡就暂停等待人工选择；全是普通卡时仍可按评分自动选择。 |

`Special price first` 下，如果高价重复特殊卡挤掉了非重复特殊卡，会显示候选并等待人工确认；竞争中的特殊卡缺少价格时也会暂停。特殊卡数量不超过可选数量时不会无意义地暂停。价格依次使用 FUT.GG 和 FUTNext，价格不可用只在确实影响排序时触发人工确认。

这些设置不会删除 SBC 本身的业务评分和特殊卡约束。

### Reward Alerts

命中最低评分的 Special 卡时可以显示页面高亮、桌面通知，或向 ntfy.sh 发送通知。ntfy topic/token 存在 Tampermonkey GM 隔离存储中。生产版只支持 `https://ntfy.sh`。

## 4. Profile

Profile 保存完整 Workflow、Loop 和 Recovery 配置。

- `Built-in`：直接使用当前内置定义。
- `Default`：可编辑的内置基线副本。
- `Bronze/Silver Inventory Only`：只将需要铜银材料的相关 Loop 固定为库存模式。
- `Daily + Rare Pack Recycling`：One-click Daily 后追加 Rare Pack 回收，优先使用当前 Rare Gold Premium，否则使用 Rare Gold Baseline。
- `Daily + Rare Pack to 5x80+`：One-click Daily 后追加 quantity-first Common Gold Premium 回收，当前使用 `5x 80+ Upgrade`。EA 资格保持 unrestricted Gold，选卡先用 Common Gold，不足时才用 Rare Gold；自己的 5x80+ 奖励包不会被当作来源包。

Builder 将每个 Profile 分为：

- `Draft`：正在编辑并自动保存的草稿。
- `Saved`：完整校验通过的保存版本。
- `Active`：当前运行时使用的 Saved/last-known-good。

只修改 Draft 不会改变正在运行的配置。必须 Save，再 Activate。

未修改的官方 Profile 会随内置基线更新。用户和内置同时修改同一字段时，Profile 保持 blocked，必须选择 `Use built-in` 或 `Keep mine`。

## 5. Workflow/Loop Builder

Builder 的主要页面：

- `Workflows`：有序编排子 Loop。
- `Loops`：材料、来源包、数量、奖励和运行策略。
- `Recovery`：Unassigned 恢复 recipes/policies。
- `Dynamic SBCs`：当前扫描得到的 Pick 和 Upgrade。
- `JSON validation`：兼容旧 JSON、诊断、导入和导出。

内置对象默认只读。使用 Override 创建当前 Profile 的覆盖，Duplicate 创建独立对象，Reset 回到当前版本内置值。

Workflow step 只引用 `loopId` 并保存 step 级奖励上下文。需要不同材料、次数或评分规则时，应复制一个子 Loop 变体再引用，不把业务参数伪装成通用 step 字段。

详细图示见 [WORKFLOW_LOOP_BUILDER_GUIDE_ZH.md](WORKFLOW_LOOP_BUILDER_GUIDE_ZH.md)。

## 6. Dynamic SBC 扫描

扫描模式：

- `Incremental scan`：刷新索引，复用 24 小时内且结构未变化的 Challenge 快照。
- `Full rescan`：重新验证候选；EA 临时失败时可保留身份仍兼容的旧快照。
- `Clear cache + scan`：删除当前账号缓存后全量重建，没有缓存降级能力。

扫描采用自适应节流。`426/512/521` 会有限重试并降速；`429` 会停止当前 pass 的后续 Challenge 网络读取。若仍有 Challenge 元数据暂时不可用，单次 `Scan SBCs` 操作会最多执行 3 个 pass；后续 pass 只增量补扫失败项，不会重复清空缓存或全量读取。3 个 pass 后仍没有可信缓存的新 SBC 会保持 unavailable，而不是根据名称猜测条件。

动态 Loop 只在以下证据完整时生成：

- 当前 Upgrades Category/Set 身份明确。
- Challenge 人数、评分、稀有度、特殊卡和未知条件可安全解析。
- Reward Pack 或 Player Pick 身份明确。
- 多 Challenge Upgrade 的每个 Challenge 都能独立验证。

## 7. My Packs 和 Batch Open

Batch Open 每次打开时读取当前 My Packs：

- `Add 1`：固定加入一份。
- `Add all (N)`：保存动态 `all`，运行前按实时数量物化。
- 固定数量超过现存数量时只处理可用实例，并记录不足。
- 已不存在的记忆项保留为 unavailable；动态数量为零时安全跳过。

启动后会捕获每个 Pack 实例，按队列处理。每包必须确认物品进入 Club、Storage、Transfer、Unassigned recovery 或当前 crafting 流程后才继续。

出现容量不足、无法确认的新实体或阻塞 Unassigned 时，会停止后续包并保留现场。

## 8. 常用内置流程

### One-click Daily

Built-in 默认依次运行 Daily Bronze、Silver、Common、Rare，并按 EA 当前剩余次数执行。`Daily + Rare Pack Recycling` 追加当前 Rare Gold Premium/Baseline；`Daily + Rare Pack to 5x80+` 则追加 quantity-first Common Gold Premium，按 Common-first、Rare-fallback 方式处理 Daily Rare 来源包。两个 Profile 都只在第五步改变消耗方式。

### Gold Inventory Exhaustion

`Common Gold Premium Exhaustion Loop` 只消耗 Common Gold。`Low-rated Gold Premium Exhaustion Loop` 使用当前动态扫描到的 unrestricted-Gold Premium Upgrade（当前为 `5x 80+ Upgrade`），先跨 `Unassigned -> Storage -> Transfer -> Club` 消耗所有符合上限的 Common Gold，然后才使用符合上限的 Rare Gold。特殊卡不会被使用；不足一套时停止。奖励包延迟到阶段结束后再按 `Open reward packs` 设置处理，不会在同一阶段反复投入自身。

### Provision Crafting

打开 Provision 来源包并按材料类型清理：Common Gold 优先进入当前动态 Pick，再进入 Common Gold Premium Upgrade；Rare Gold 进入当前动态 Rare Gold Premium 或 Baseline。所有路径保持 `Unassigned -> Storage -> Transfer -> Club` 的优先级和 Common-first 规则。

### Inventory Exhaustion

按阶段耗尽 Bronze、Silver 和 Common Gold 库存。每个阶段只运行当前动态绑定且条件完整的 Upgrade。

### 10x85+ Rolling Loop

动态扫描确认当前 `10x 85+ Upgrade` 的主阵、10 张 85+ 奖励和单一 Required Special 条件后，会生成独立的 `10x 85+ Upgrade Rolling Loop`。它每轮只开一包主奖励，将安全的重复卡回填下一套主 SBC，并在缺 Required Special、普通材料或 Storage 空间时调用对应恢复流程。

`SBC completions = 0` 表示不限轮数；该 Loop 必须启用 `Open reward packs`。普通评分 SBC 的单卡上限不适用于 Rolling，自动使用范围由 Selection Policy 中的 `Automatic-use max rating` 控制。主动 Provisions/TOTW 余量制作和 `Storage pressure recovery` 均默认关闭。Storage pressure 可使用自动模式，也可显式选择动态扫描到的高评分 Player Pick 或直接球员 SBC；显式选择只验证该 Set，不会深扫所有球员 SBC。

完整开包矩阵、材料路由、恢复优先级、流程图和 Stop/Resume 行为见 [10x85+ Rolling Loop 使用与流程指南](10X85_ROLLING_LOOP_GUIDE_ZH.md)。实现边界和验收记录见 [设计与实施追踪](10X85_ROLLING_LOOP_IMPLEMENTATION_ZH.md)。

### Dynamic Pick/Upgrade

有限次数按 EA remaining 运行；不限次流程使用用户输入数量。多 Challenge Upgrade 只有完成最后一个 Challenge 并观察到真实 Set reward 后才计为一轮。

## 9. Recap

普通 Loop 和 Batch Open 在本次至少获得一张 Rare Gold 或 Special 时显示逐卡 recap，每页 15 项。Player Pick 使用包含候选、选择和库存去向的专用 recap。

Recap 保留来源包、停止原因、卡片 tier、重复/可交易状态和可用价格。只有 Bronze、Silver、Common Gold 或没有实际开包时不会弹出 recap，日志会说明跳过原因。

## 10. 材料和库存安全

默认 pile 优先级由每个 Loop 声明，常见顺序是：

```text
Unassigned -> Storage -> Transfer -> Club
```

同一层优先使用满足要求的低价值 Common；只有 Common 不足且 SBC 允许任意 Gold 时才使用 Rare。Only Untradeable、排除联赛、Evolution、高分和 Special 保护在最终保存和提交前仍会重新检查。FSU Lock player 和 Active Squad 冲突保护位于 `Selection Policy -> Submission guards`，两个开关默认关闭。

- `Protect FSU locked players` 开启后，Runner 不会把 FSU/Enhancer Lock player 中的卡选入 SBC，并会在最终提交前再次检查；发现锁卡已经进入阵容时停止。关闭时不增加这层 Lock player 保护，其他 FSU 过滤仍保持原行为。
- `Protect Active Squad players` 关闭时，Rolling 保留原有的严格校验后单次 `skipValidation:true` 确认逻辑。开启后，普通冲突卡按精确 item ID 在本次 Rolling 中排除并自动重规划；合法特殊卡显示 `Use this card` / `Replace card`；违反既有特殊卡保护或 Required Special 角色约束时直接报错。缺少合法 `itemViolations` 时无论开关状态都不会强制提交。
- TOTS/FOF/FUTTIES 正常可以作为来自 Unassigned、Storage 或 Transfer 的 Required Special 材料，但它们不属于 Active Squad 确认候选。若 EA 对它们返回 `409/itemViolations`，说明 EA 实体身份或规划状态与库存来源矛盾，直接报错，不发送确认提交；`Protect all Club non-TOTW specials` 不改变这一点。该选项关闭时只允许其它 Club 非 TOTW 特殊卡作为最后 fallback，并在 Active Squad 冲突时询问用户。所有排除和批准仅在当前 Rolling 运行期间有效。
- `Allow Club current-pool specials for Provisions` 默认关闭。开启后，仅普通 Provisions 缺料恢复可在普通材料不足时使用当前 live matcher 精确认可、评分位于 `Provisions reserve max` 范围内的 Club 非 TOTW 色卡；`Protect all Club non-TOTW specials` 开启时该放宽自动失效。FSU Lock、Evolution、Active Squad、Automatic-use 上限及其它提交保护仍会再次检查。

FSU Local 的 Club 快速缓存属于 provisional 数据。使用 Club 球员时，Runner 必须在保存前按 item/definition identity 向 EA 定向验证；失败时重新选材或停止。
