# Gold Material Consumption Model

本文档定义 FC Automation Tool 对普通金卡、稀有金卡和特殊卡的统一分类，以及不同 SBC/Loop 应如何决定资格和消耗顺序。目标是避免把“EA 接受什么卡”和“Runner 想优先消耗什么卡”混成一个字段。

## 1. 为什么 Common/Rare Bug 反复出现

过去有两个独立问题叠加：

1. EA 实体的 rarity 数据可能出现在顶层、`_data`、`_staticData`、方法返回值或标准化 boolean 中。库存适配器、运行时选材、Pack 处理、诊断和 recap 曾分别读取不同位置，因此同一张卡可能在一条路径被判为 Rare，在另一条路径被判为 Common。
2. `requirement.rarity` 同时承担了 EA 配方资格和 Runner 消耗偏好。动态扫描遇到“任意 Gold”配方时，有的路径为了表达 Common-first 把它改写成 `rarity: common`，导致 Rare fallback 被错误禁止；另一些路径又根据来源包或 Loop 名称猜测 Rare，导致不该使用 Rare 的 SBC 消耗 Rare。

重构后，两类问题分别由 `player-rarity.js` 和 `gold-consumption.js` 处理。

## 2. 卡片分类

所有业务代码必须调用 `src/domain/player-rarity.js`：

| 分类 | 标准 | 选材含义 |
| --- | --- | --- |
| Common normal card | `rareflag === 0` | 可满足 Common 或 unrestricted eligibility |
| Rare normal card | `rareflag === 1` | 可满足 Rare 或 unrestricted eligibility |
| Special card | `rareflag > 1` | 独立于普通 Rare；默认被 `allowSpecial: false` 排除 |

读取器会保守合并 EA 实体的所有已知 rarity 来源，任何来源表明更高 rarity 时采用更高值。这样可以避免顶层默认值 `0` 覆盖 `_staticData.rareflag: 1` 等延迟元数据。

Bronze/Silver 也可以有 Common/Rare 外观，但 Gold 材料策略只在 `tier: gold` 时生效。Bronze/Silver Loop 是否区分 rarity 由 EA requirement 明确决定；当前通用升级流程通常不区分。

## 3. 两层 Requirement

### 3.1 EA eligibility

`requirement.rarity` 只描述扫描确认的 SBC 硬条件：

- `rarity: common`: EA 只接受 Common。
- `rarity: rare`: EA 只接受 Rare。
- 不设置 `rarity`: EA 接受 Common 和 Rare。

动态扫描必须保留这个事实，不得根据 Loop 名称、来源包名称、奖励名称或消耗偏好改写。

### 3.2 Runner consumption

`requirement.goldConsumption` 描述 Runner 在 EA 允许范围内如何选材：

| 模式 | 行为 |
| --- | --- |
| `eligibility` | 不增加 Common/Rare 消耗约束，只遵守 EA eligibility 和通常的评分/FSU 排序 |
| `common-only` | 只消耗 Common；可用于 EA unrestricted Gold SBC，但不会使用 Rare fallback |
| `rare-only` | 只消耗 Rare；可用于 EA unrestricted Gold SBC，但不会用 Common 补位 |
| `common-first` | 先遍历全部 pile 的 Common，不足时从第一个 pile 重新遍历 Rare |
| `rare-first` | 先遍历全部 pile 的 Rare，不足时从第一个 pile 重新遍历 Common |

`common-first` 和 `rare-first` 只有在 EA eligibility 同时接受 Common/Rare 时才合法。严格 Common-only 或 Rare-only 配方直接由 `requirement.rarity` 限制，不需要 fallback。

旧 `preferCommon` 和 `activityBinding.selectionMaterial` 只在读取旧 Profile/JSON 时转换为新模式，不再由 Builder、动态扫描或内置配置生成。

## 4. 库存与 Duplicate 顺序

每个 phase 都按配置的 pile 顺序执行，通常是：

`Unassigned -> Storage -> Transfer -> Club`

Unassigned/Transfer 中不能直接提交的 duplicate signal 会解析到 Storage/Club 中对应的可提交实体。当前运行明确要求处理的 signal 优先于普通 fallback，但必须继续满足：

- EA tier/rarity eligibility
- `goldConsumption` 的 strict 模式
- `allowSpecial` 和特殊卡条件
- 启用 `Protect FSU locked players` 时的 FSU Lock，以及始终生效的 Only Untradeable、排除联赛和 Evolution
- low-rated 或 rating-constrained 数值上限

因此“优先清理 Unassigned”不等于可以用 Rare 代替严格 Common，也不等于可以绕过特殊卡和高分卡保护。

## 5. 场景矩阵

| 场景 | EA eligibility | Runner consumption | 是否区分 Common/Rare |
| --- | --- | --- | --- |
| Daily Rare Gold Upgrade 输入 | `rarity: common` | `eligibility` | 严格 Common；Rare 永不补位 |
| Gold Upgrade / Common recovery | `rarity: common` | `eligibility` | 严格 Common |
| Common Provision/Exhaustion，扫描到的 SBC 本身要求 Common | `rarity: common` | `eligibility` | 严格 Common |
| 动态 Pick 明确要求 Common 数量 | `rarity: common` | `eligibility` | 严格 Common |
| Rare Gold baseline/premium，扫描到的 SBC 本身要求 Rare | `rarity: rare` | `eligibility` | 严格 Rare |
| Provision rare stage | `rarity: rare` | `eligibility` | 严格 Rare |
| 动态 Pick 明确要求 Rare 数量 | `rarity: rare` | `eligibility` | 严格 Rare |
| Common Gold exhaustion 使用 unrestricted premium SBC | 无 `rarity` | `common-only` | 只消耗 Common，不允许 Rare fallback |
| Rare recycling 使用 unrestricted premium SBC | 无 `rarity` | `rare-only` | 只消耗 Rare，不用 Common 补位 |
| Low-rated Gold exhaustion | 无 `rarity` | `common-first` | 先 Common，库存 Common 全部不足才用 Rare |
| Daily Rare Pack to 5x80+ | 无 `rarity` | `common-first` | 当前 Unassigned duplicate signal 优先，然后 Common-first，最后 Rare fallback |
| 动态 Pick 未声明 rarity 比例 | 无 `rarity` | `common-first` | 先 Common，必要时 Rare fallback |
| Bronze/Silver Daily/Upgrade | Bronze/Silver tier | 不适用 | 默认不按 Gold Common/Rare 策略区分 |
| 84x10/85x10/87x7 等评分 SBC普通填料 | Gold/评分模型，通常无普通 rarity 条件 | `eligibility` | 不按 Common/Rare 分阶段；按评分解、特殊卡条件和卡片上限选材 |
| 评分 SBC 的 TOTW/TOTS/FOF 条件 | 特殊卡结构化条件 | 独立特殊卡选择 | 不把 Special 当作普通 Rare Gold |

## 6. 容易误解但不能作为输入规则的信息

- 来源包名包含 `Rare Gold`，只说明包的产出，不说明目标 SBC 必须消耗 Rare。
- SBC 奖励名包含 `Rare Gold`，只说明奖励，不说明输入资格。
- Loop 名称包含 `Rare Pack`，描述来源流程，不应改变扫描得到的 requirement。
- `common-gold-material-upgrade` / `rare-gold-material-upgrade` 是候选分类和 Baseline 比较语义，不得覆盖候选 SBC 的实际 eligibility。
- FSU 的 rarity 排序只影响同一 selection phase 内部排序，不能改变 `common-first`/`rare-first` phase 顺序。

## 7. 新增或修改 Loop 的规则

1. 先从 EA Challenge 元数据记录真实 eligibility。
2. 只有 EA 明确限制时才设置 `requirement.rarity`。
3. 再根据业务目的选择 `goldConsumption`；没有额外意图时使用默认 `eligibility`。
4. 需要 fallback 时确认扫描到的 SBC 没有 rarity 限制。
5. 用跨 pile 测试锁定顺序，并至少覆盖 Common、Rare、Special 以及延迟 `_data`/`_staticData` rarity 元数据。
6. 日志同时输出 eligibility 和 consumption，不能只打印一个模糊的 `rarity`。

## 8. 兼容与迁移

现有用户 JSON 不会立即失效：

- `preferCommon: true` 读取为 `goldConsumption: common-first`。
- `selectionMaterial: common-gold` 读取为 `common-only`。
- `selectionMaterial: rare-gold` 读取为 `rare-only`。
- `selectionMaterial: low-rated-gold` 读取为 `common-first`。

兼容解释集中在 `src/domain/gold-consumption.js`。运行时选择器只调用该统一 helper；动态扫描输出、新 UI 和新内置配置均以 `goldConsumption` 为唯一消耗策略字段。
