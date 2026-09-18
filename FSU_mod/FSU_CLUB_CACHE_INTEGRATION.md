# FSU Club Cache Optimization and Integration Guide

2026-09-18 FC27 单次事务接线：隔离 Acceptance Provider 继续读取原 FSU 策略/Club 缓存，选中整阵通过已有原生只读 Adapter 按 definition 查询再精确匹配 item 与安全属性；原 FSU ready 时的 `cached:true` 不冒充 fresh。未复制全量库存服务，未改 FSU 源码或下文 FC26 合同。提交前使用经源码指纹核验的原 `markClubCacheDirty`，权威消费确认后才按精确 item ID 清理本地 Club entries 并失效 stats；恢复检查本身不清理，明确确认完成后才执行。该写后维护只通过合成回归，实机为 2/2 只读验证，未发生真实消费。见 [实现与验收边界](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-ea-provider-与真实-gm-验收)。

2026-09-18 自然重启修复续验：原 `26.09.8` 通过 Home 专用有界 readiness 等待修复 Controller 迟到漏初始化；自然冷启动及连续两次刷新均成功进入 `initialized`，随后进入 `trusted-provisional`。2/2 fresh 定向复核仍通过，未将 provisional 提升为全量 ready。未修改 Club cache/readiness 合同，见 [修复记录](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-自然重启与初始化竞态定位)。

2026-09-18 原 FSU 抽样实机：安装 `26.09.6` 的 `validateClubPlayers()` 在 FC27 上完成 2/2 fresh 精确身份及安全属性复核，Club 仍为 `trusted-provisional`。诊断先核对原方法指纹、上下文与队列；capture 集合在首次请求时才初始化，属性完全缺失可以是合法空闲状态，但未知形状/getter/活动集合仍阻断。仅修诊断判断，没有改 FSU 源、capture、缓存或 readiness 合同。抽样不代替全量/实际选中整阵复核，也不允许原生填阵绕过 guard。详见 [本轮记录](../docs/FC27_LIVE_ADAPTATION_ZH.md#2026-09-18-缺卡期间的原-fsu-抽样验证)。

2026-09-18 当前方向：用户确认原 `26.09.6` 在 FC27 大部分功能可用，维护改为原版最小兼容修复。未修改原版已实机初始化完成、Club ready，原填阵/价格函数与开关存在。独立 Preview 停止扩展且不再默认安装，下文原 FSU scoped capture、provisional 与提交前精确校验合同继续保留，不用另一套库存服务替代。readiness 实机通过不等于所有选材/写阵/价格功能已验收。

2026-09-17 最新验收：真实 Tampermonkey 5.5.0 / 独立 Preview .2 安装及面板/桥已通过，独立 GM 诊断键刷新后保留，真实面板取得 41 名 Club 球员及首屏 25 张 EA 均价；FUT.GG GM 请求为 403。只验证了安装诊断键，不等于策略/锁卡 key 与全 readiness 已验收；策略仍未保存，桥正确保持 not-ready。后续只读配阵已获用户授权但尚未执行，写操作门禁不变。

2026-09-17 后续：独立 FC27 Preview 已组合真实 GM 注入入口、作用域策略/锁卡 UI、冷启动 bridge 刷新、传统只读规划及价格表。修正 core 原先要求库存 ready 才能 cold refresh 的闭环；全量刷新有独立 180 秒上限，单请求仍有 15/16 秒上限。没有改动下文 FC26 生产源/patch。实机再次取得 41/41 球员、两卡精确复核及 39 张 EA 市场均价；真实 GM 安装、一键填阵写入和卡面价格仍待验收。维护入口、上游检查与明确边界见 [FC27 本地支持](FC27_LOCAL_SUPPORT_ZH.md)。

2026-09-17 FC27：独立 `runner-support/native-provider.js` 已接入真实账号/Persona/SKU、partial 缓存和 fresh Club 读取。自有 EA 请求实机确认 41/41 球员，两卡按 item ID、definition ID、安全指纹定向回读通过；当时缓存仅 16 个条目、8 个球员。fresh 结果保持 provisional，真实 FSU GM/锁卡/保护策略与 Live 仍待验收，不安装全局 bridge。本轮没有修改 `26.09_mod`，不把旧季 readiness 声明为新季已验证。五步状态见 [上线后适配记录](../docs/FC27_LIVE_ADAPTATION_ZH.md)。

FC27 的查询 Adapter 使用经源码指纹校验的独立 `UTHttpRequest`：Stats GET、Club search POST（只读查询），只接受自有请求/Observable 的响应，不使用全局捕获或合并缓存，不读写认证信息。串行、800ms 最小间隔、超时/429 停止；最多 250/页、20,000 人，前后 Stats 与唯一 item 数一致。生成的 fresh 实体不注入 EA Club Repository，也不清除旧实体。此方案仅进入独立 core，不改变下文 FC26 的 scoped XHR、hasAllItems bypass 与缓存清理合同。

FC27 离线 Runner-support core 位于 `FSU_mod/src/runner-support/core.js`，不进入当前 `26.09_mod` 生产构建。它复用锁卡/设置解析并通过注入 provider 测试精确校验与 readiness；EA/GM 接线仍须 F1/F2 实机证据。状态见 [FC27 实施记录](../docs/FC27_PRELAUNCH_PROGRESS_ZH.md)，不能将 fake provider 的成功视作本文件定义的 EA 权威校验。

本文是 FSU `26.09` Club 加载优化、Daily Loop Runner 集成和第三方插件交互的维护事实来源。它记录当前已经实现并验证的行为，也记录仍待验证的风险和未来优化方向。

下文缓存实机证据的历史适用组件（当前维护版本与 FC27 边界见 [本地支持记录](FC27_LOCAL_SUPPORT_ZH.md)）：

- FSU 上游基线：`26.09`
- FSU Local 历史缓存证据：`26.09.6`；当前维护版为 `26.09.8`，Release 资产 `FSU-Local.user.js`
- Daily Loop Runner：`0.5.39` 起支持 `trusted-provisional` 快速缓存状态
- FC26 Enhancer：已观察版本 `26.1.5.7`
- EA FC Web App：2026-07-21 实际页面模型

本文件不是普通用户操作手册。修改 FSU Club 加载、Runner 的 FSU Adapter、库存选材或 SBC 提交事务前，必须先读本文。

## 1. 目标与结论

原始 FSU 会在登录时同步读取整个 Club。Club 接近一万名球员时，这个过程会长时间占用 loading 界面，且每次登录都重复进行。

当前优化采用：

```text
Tampermonkey 实体缓存快速恢复
-> 立即提供 provisional Club Repository
-> 比较 Club 数量、Storage/Transfer 实例指纹、缓存年龄和本地 dirty 标记
-> 信号一致时进入 trusted-provisional，不在本次登录立即全量扫描
-> Runner 提交前仍对实际选中的 Club 卡做 EA 定向校验
-> 信号变化、缓存过期、手动刷新或 dirty 时逐页向 EA 做权威校验
-> 删除过期缓存卡并更新变化卡
-> 全量一致后进入 ready
```

这带来两个明确变化：

1. 页面不再必须被前台 loading 界面阻塞到全量 Club 扫描结束。
2. “页面可操作”不等于“Club 已全量校验完成”。后台校验期间，读取可以使用 provisional 数据，但任何将 Club 卡投入真实 SBC 的流程必须先做定向 EA 校验。

最近一次首次全量建立新缓存的结果：

| 指标 | 结果 |
| --- | --- |
| Club 预期球员 | 9930 |
| 缓存恢复 | 9895 个实体，加上 Repository 初始已有 23 个 |
| 缓存恢复耗时 | 801 ms |
| 全量页面 | 40/40；3 次临时 HTTP 401 均在第 2 次请求恢复 |
| Payload 所有权 | 全部 `scoped`，无 compatibility fallback |
| 精确 EA payload | 9930 |
| 最终 Repository 球员 | 9930 |
| 全量后台校验耗时 | 86.236 s，包含 3 次 401 重试 |
| 缓存写入 | 40 chunks，约 8.04 MiB |
| 最终状态 | `ready` |

紧接着的刷新登录命中快速路径：

| 指标 | 结果 |
| --- | --- |
| 状态 | `trusted-provisional` |
| Club 数量 | 9930 |
| 缓存恢复 | 9907 个实体，加上 Repository 初始已有 23 个 |
| Storage / Transfer | 88 / 18，实例指纹一致 |
| Club 分页请求 | 0 |
| 错误 / 警告 | 0 / 0 |
| 快速可用耗时 | 8.446 s，其中实体恢复 770 ms |

因此，当前优化已经避免“每次登录都立即全量扫描”。快速状态仍不是 EA 权威 ready；Runner Live SBC 使用 Club 卡前必须做定向校验，信号变化或缓存过期时仍回退全量扫描。

## 2. 为什么原始加载很慢

FSU 需要 Club 球员实体来执行筛选、锁卡、SBC 填充和评分计算。原始流程必须：

1. 查询 Club 玩家统计数量。
2. 分页请求 Club 球员。
3. 让 EA 模型构造实体并写入 Repository。
4. 等待所有页结束后才把 FSU 标记为可用。

约 9826 名球员、每页 200 名时需要 50 个串行请求。最近实测每页通常约 0.6 至 0.8 秒，完整扫描约 65 秒。EA 的 `Club.search` 在当前运行时内部串行化，简单增加 Promise 并发并不能线性提速，反而会与其它插件争用请求。

之前尝试过的错误假设：

- 只比较 Club 总数即可判断缓存新鲜：总数相同不代表实体未变化，也无法发现“一进一出”。
- 直接把普通 JSON 放入 Repository：FSU 和 EA 需要真实 EA 实体方法，伪对象会在后续填充或保存时失败。
- 设置 `criteria.cacheable = false`：当前对象该属性只有 getter，会抛出异常。
- 只调用 `repositories.Item.setDirty(ItemPile.CLUB)`：这不能绕过 `clubRepo.hasAllItems()` 的短路。
- 同时大量并发 Club 请求：当前 EA 路径会串行或发生竞争、超时和状态 0。

## 3. 当前架构

### 3.1 分层

```text
Tampermonkey cache
  manifest + double-buffered chunks
            |
            v
UTItemEntityFactory reconstruction
            |
            v
EA Club Repository (provisional)
            |
            +--> FSU native reads, guarded writes
            |
            +--> Daily Loop Runner selection
                         |
                         v
                targeted EA validation
                         |
                         v
                   SBC save/submit

Background full reconciliation
  forced Club requests
  + exact XHR-scoped payload capture
  + add/update/remove Repository entities
  + verified cache rewrite
```

FSU 负责缓存、EA 实体恢复、全量校验和定向校验。Runner 不复制这套网络与实体逻辑，只通过 Adapter 使用 FSU 暴露的状态和校验接口。

### 3.2 缓存格式

当前关键常量：

| 项目 | 值 |
| --- | --- |
| Schema | `2` |
| 每 chunk payload 数 | `250` |
| 最大缓存年龄 | `3 days` |
| 缓存作用域 | FSU 年份 + EA persona |
| 写入策略 | 两个 slot 交替写入，最后切换 manifest |

缓存 key 基础格式：

```text
fsu_club_entities_v2_<year>_<persona>
```

Manifest 至少记录：

- `schema`
- 当前 `slot`
- `chunkCount`
- `expectedCount`
- `serializedCount`
- `skippedCount`
- Club `fingerprint`
- `savedAt`

双缓冲的目的，是避免写到一半就覆盖上一份可用缓存。新 slot 的所有 chunks 写完后才更新 manifest。

### 3.3 缓存恢复

缓存恢复不是把 JSON 当作 EA item 直接注入。FSU 会：

1. 校验 manifest、缓存年龄、chunk 完整性和记录数量。
2. 用 `UTItemEntityFactory.createItem()` 重建 EA 实体。
3. 校验 item ID、definition ID、评分、稀有度、队伍、联赛、国家和交易属性。
4. 通过官方 Club Repository `add()` 加入不存在的实体。
5. 将这些实体标记为 provisional，并在后台继续权威校验。

以下对象当前不会通过普通序列化缓存恢复：

- 无法识别 ID、definition ID 或位置的对象
- limited-use 球员
- 含 upgrades/cosmetics、不能安全重建的对象
- 工厂重建后关键属性不匹配的对象

若不兼容对象超过缓存的 10%，整份缓存被判定为无效，不会冒险部分恢复。

### 3.4 Fingerprint

Fingerprint 包含数量以及 item ID、definition ID、评分、稀有度、队伍、联赛、国家、交易状态和升级/装饰标志的组合摘要。

它用于：

- 记录前后 Club 快照是否变化。
- 已完成权威校验且内容未变时，避免重复序列化同一份缓存。

它不用于替代 EA 权威校验。哈希相同也不能成为无限期信任缓存的理由。

## 4. 状态机

| 状态 | 含义 | Club 读取 | FSU 自动库存动作 | Runner Live 提交 |
| --- | --- | --- | --- | --- |
| `miss` | 没有可用缓存 | 不可靠 | 阻止 | 阻止依赖 Club 的提交 |
| `invalid` | 缓存结构或实体不兼容 | 不可靠 | 阻止 | 阻止依赖 Club 的提交 |
| `validating` | provisional 实体已恢复，后台校验中 | 可读，但非权威 | 默认阻止 | 选中 Club 卡定向校验后允许 |
| `trusted-provisional` | 最近全量校验仍在时限内，Club 数量及 Storage/Transfer 指纹一致，本次登录跳过全量扫描 | 可读，但仍非权威 | 默认阻止 | 选中 Club 卡定向校验后允许 |
| `validation-failed` | 全量校验失败，provisional 实体仍保留 | 可读，但非权威 | 默认阻止 | 选中 Club 卡定向校验后允许；失败即停止 |
| `finalizing` | 全量页面结束，正在处理定向队列和快照 | 已验证 | 允许 | 允许 |
| `ready` | Repository 与 EA 权威结果一致 | 权威 | 允许 | 允许 |

FSU 的总开关是：

```js
events.requireClubReady(action)
```

FSU 原生 squad fill、模板填充、rating fill、Fast SBC 和 Duplicate Fill 调用该 guard。手动 One-click Fill 将 Unassigned 作为 duplicate priority signal，但实际候选来自 Club + Storage，因此同样依赖 Club Repository。仅当 Runner 明确开启 scoped provisional access 时，FSU 才会在 `validating`、`trusted-provisional` 或 `validation-failed` 状态临时允许特定填充调用。

注意：`trusted-provisional` 和 `validation-failed` 都不是 ready。保留 provisional 实体是为了允许 Runner 对实际要提交的少量卡做定向恢复，不代表可以信任整个 Club。

## 5. 全量权威校验

### 5.1 强制网络请求

关键问题是 `clubRepo.hasAllItems()`。当 Repository 看起来已包含整个 Club 时，EA DAO 会直接返回缓存，不发送 `/club` 请求。历史诊断中出现过：

```text
page 31: hasAllItems=false, 发出网络请求
page 32: hasAllItems=true, 没有网络请求，captured=0
```

当前实现的强制请求流程：

```text
requestFreshClubItems(criteria)
-> 临时覆盖 clubRepo.hasAllItems()
-> 只有 candidate === 当前 FSU criteria 时返回 false
-> 调用 clubDao.getClubItems(criteria)
-> 请求创建后立即恢复原 descriptor
```

安全约束：

- 只影响当前 FSU 创建的 criteria 对象。
- 每个请求必须观察到恰好一次 bypass。
- 不全局关闭 Repository 缓存。
- 不修改只读的 `criteria.cacheable`。
- descriptor 必须在请求创建后立即恢复，即使调用抛错也必须走 `finally`。

### 5.2 XHR scoped payload capture

全量校验不能只读取 Repository 的最终集合，因为其它插件可能同时发起 Club 请求。当前 capture 通过 XHR 身份绑定请求和响应：

```text
XMLHttpRequest.open()
-> 记录 method 和 URL

XMLHttpRequest.send()
-> 解析 type/count/start/完整 defId
-> 将匹配的 FSU session 绑定到这个确切 XHR

该 XHR 的 loadend
-> 只解析这个 responseText
-> 提取该响应的 player payload
-> 将结果归属给已绑定 session
```

当前已经删除 compatibility broad capture fallback。没有 scoped payload 时，请求必须失败，不能拿“时间上刚好出现”的其它 XHR payload 顶替。

这样做的原因：

- Enhancer 和 FSU 可能同时请求 Club。
- offset/count 相同仍不代表请求属于 FSU。
- `defId` 必须完整匹配，不能只比第一个 ID。
- Repository 更新事件无法证明某批实体来自哪一个网络响应。

### 5.3 Reconciliation

每一页的 exact payload 经 EA factory 构造后，使用 Club Repository 的官方方法更新。全量结束时：

1. 记录所有服务端 item ID。
2. 更新存在且仍有效的实体。
3. 添加服务端新实体。
4. 删除只存在于 provisional 缓存、不存在于服务端结果的 stale 实体。
5. 检查 Repository 球员数与实时 `Club.getStats` 一致。
6. 进入 `finalizing`，排空定向校验队列。
7. 生成快照，设置 `ready`，后台写入新双缓冲缓存。

一次历史验证发现并删除了 77 张 stale 缓存卡，Repository 从临时的 9903 修正为 9826。这说明只做数量比较或只添加新卡都不够。

## 6. 定向校验

Runner 不需要等整个 Club 50 页扫描完成再提交一个只使用少量 Club 卡的 SBC。FSU 暴露：

```js
events.validateClubPlayers(refs, options)
```

每个 ref 必须包含：

```js
{
  id,
  definitionId,
}
```

定向校验会：

1. 按完整 definition ID 集合创建 Club criteria。
2. 强制发起 EA 网络请求。
3. 要求 fresh scoped payload。
4. 同时按 item ID 和 definition ID 匹配。
5. 用返回实体更新 Repository。
6. 如果缺失，删除 Repository 中对应 stale 实体并返回失败。

只按 definition ID 不够，因为用户可能拥有同一球员卡的多个不同 item；只按 item ID 也不够，因为过期实体可能被错误复用。

后台全量扫描和定向校验共用队列，不允许两个流程同时无序修改 Repository。

## 7. Daily Loop Runner 集成

### 7.1 Adapter 契约

Runner 的 `src/adapters/ea/fsu.js` 暴露：

```js
snapshot()
readiness()
validateClubPlayers(refs, options)
beginProvisionalClubAccess()
endProvisionalClubAccess()
```

`readiness()` 将 FSU 状态投影为：

- `not-detected`：未检测到 FSU，Adapter 本身不把它误报为 loading。
- `loading` / `not-ready`：无可用 provisional 数据。
- `provisional`：`validating` 或 `validation-failed`。
- `ready`：FSU ready 或 finalizing。

未检测到 FSU 不等于完整运行环境安全。Runner 其它启动检查和用户要求仍可以要求 FSU 存在；Adapter 这里只负责避免把“插件不存在”误解为“插件永久 loading”。

### 7.2 Live SBC 提交流程

Runner 的通用 `submitSbcAttempt()` 在 Live 保存前调用 `prepareRuntimeAccess`：

```text
生成 Selection/SquadPlan
-> 检查 FSU readiness
-> 只提取 pile=club 的 refs
-> provisional 时调用 validateClubPlayers()
-> 比较校验前后安全属性签名
-> 通过后用 EA 最新实体替换旧对象
-> pre-save validators
-> save/reload/post-save validators
-> submit
```

比较的关键属性包括：

- item ID 和 definition ID
- rating、rarity、special
- tradeable
- league、Evolution、groups
- limited-use、concept、academy、active trade
- end time

如果卡已不存在或属性变化，Runner 不会在本次尝试中静默重新选材，而是停止并要求重新运行 Loop，让 Selection 基于刷新后的 Repository 重新规划。

### 7.3 Dry Run

Dry Run 继续使用同一套 Squad Provider 和 pre-save validators，但不会调用定向网络校验，也不会保存或提交。

这是有意行为：Dry Run 验证的是当前缓存视图下的选材与约束，不产生账号副作用。它不能证明 provisional Club 卡此刻仍存在于 EA，最终 Live 提交仍必须重新校验。

### 7.4 FSU 页面填充

部分 Runner 流程仍会调用 FSU 原生填充。provisional 状态下，Runner 只在该调用的同步范围内：

```text
beginProvisionalClubAccess()
-> FSU fill
-> endProvisionalClubAccess()
```

这只是允许 FSU 从已恢复 Repository 生成候选阵容。后续 Live SBC 保存仍经过定向校验。访问深度必须在 `finally` 中归零，禁止长期全局绕过 `requireClubReady()`。

## 8. 对各流程的影响

| 流程 | provisional 阶段行为 | 风险控制 |
| --- | --- | --- |
| 只读取 FSU 设置/锁卡 | 正常 | 与 Club 实体权威性无关，但仍需完整识别锁卡身份 |
| 读取 Club 用于候选规划 | 允许 | 结果只是 provisional plan |
| Runner Dry Run | 允许 | 不保存、不提交、不做网络定向校验 |
| Runner Live SBC，不使用 Club 卡 | 正常继续 | Storage/Transfer/Unassigned 实体不走 Club 定向校验 |
| Runner Live SBC，使用 Club 卡 | 保存前逐卡定向校验 | 缺失或属性变化即停止 |
| FSU 手动 One-click Fill | 默认阻止 | Unassigned 只提供 duplicate priority signal；实际 Club/Storage 候选要求 `ready` |
| FSU 原生 Fast SBC/模板/评分/Duplicate Fill | 默认阻止 | 等 `ready`；只有 Runner 的 scoped access 例外 |
| 手动浏览页面 | 可继续 | 页面可用不代表全量验证完成 |
| 手动使用其它插件自动提交 SBC | 取决于该插件自身 | FSU/Runner 的定向保护不会自动覆盖第三方提交代码 |

### 8.1 对 Loop 的总体影响

所有最终复用 `submitSbcAttempt()` 且使用 `prepareFsuRuntimeAccess` 的 Runner Live SBC，都获得相同保护，包括普通库存阵容和评分型阵容。它不是针对某一个 Daily、Provision 或 84x10 的特殊补丁。

仍需注意两类边界：

- 在通用提交事务之外直接保存/提交 SBC 的遗留调用点，必须单独审计。
- 仅调用 FSU 填充但没有进入 Runner 提交事务的第三方操作，不受 Runner 定向校验保护。

修改 `submit-attempt.js`、`prepareFsuRuntimeAccess()` 或 FSU Adapter 时，影响面是所有 SBC Loop，不得只验证一个 Loop。

## 9. 与 FC26 Enhancer 的交互

已确认 Chrome 扩展：

```text
ID: boffdonfioidojlcpmfnkngipappmcoh
Name: FC26 Enhancer | SBC Solver, Trader & Keyboard Shortcuts
Observed version: 26.1.5.7
```

观察到 Enhancer 启动时调用类似：

```text
getAllClubPlayersFast()
page size 90
offset 0, 90, 180, 270, ...
```

早期 FSU 也以 200/page 扫描时，两者请求重叠曾导致约第 4 页 timeout/status 0。

当前 scoped XHR routing 已解决“把 Enhancer 响应误认成 FSU 响应”的正确性问题，但没有解决两者同时占用 EA Club 接口的资源竞争。Enhancer 重新启用后的完整并发测试仍是未完成项。

必须区分：

- Payload ownership：当前已通过 scoped capture 解决。
- Request contention/rate limit：仍需实测和可能的协调机制。

如果并发时再次失败，不能恢复 broad capture fallback。正确方向是协调扫描、退避、限速或检测对方活动。

## 10. 与其它插件和页面代码的边界

FSU 的优化会触碰共享 EA 运行时，必须保持以下边界：

- XHR hook 只观察并绑定匹配请求，不修改其它 XHR 的响应。
- `hasAllItems()` 覆盖只对当前 criteria 对象生效，并立即恢复。
- Repository 更新使用 EA/FSU 已有官方 `add/update/remove` 路径。
- 不替换全局 Club service，不篡改其它插件的 criteria。
- FSU 的 provisional access 只由显式深度控制，正常第三方调用不能自动获得绕过。
- Tampermonkey GM 缓存按脚本隔离；其它扩展不能直接读取该缓存，除非主动桥接。

第三方插件可能直接调用 EA DAO 或 Repository。FSU 无法保证这些插件在 provisional 状态下也执行定向校验，因此“FSU 后台已恢复缓存”不等于所有第三方自动化都安全。

## 11. 故障模式

### 11.1 `cacheable` 只有 getter

历史错误：

```text
TypeError: Cannot set property cacheable ... which has only a getter
```

处理：不再写 `criteria.cacheable`。强制网络只使用 active-criteria `hasAllItems()` bypass。

### 11.2 没有 fresh payload

历史错误：

```text
returned no fresh Club player payloads
```

原因可能是 Repository 短路、请求未发出、XHR 归属失败或网络竞争。当前没有 scoped payload 就失败，不允许用 broad payload 继续。

### 11.3 `setDirty()` 不足以绕过缓存

历史错误：

```text
cannot bypass the Club repository cache because setDirty() is unavailable
```

以及即使 `setDirty()` 存在，`clubRepo.hasAllItems()` 仍可能直接短路。当前 `setDirty()` 只作为状态标记，强制请求依靠 scoped bypass。

### 11.4 缓存数量与 Stats 不同

允许先 provisional 恢复，再后台 reconcile。不能因为数量不同直接把缓存当权威，也不能只因数量相同就跳过验证。

### 11.5 全量校验失败

状态进入 `validation-failed`，保留 provisional 实体用于诊断和 Runner 定向校验。FSU 原生自动库存动作继续被阻止。修复网络或插件冲突后应手动刷新 Club 数据或重新登录。

### 11.6 定向校验发现缺失/变化

Runner 在保存前停止。用户应重新点击相同 Loop，让选材基于新 Repository 重算。不得自动用另一张卡替换后直接提交。

## 12. 诊断与证据收集

### 12.1 导出入口

FSU 通过 Tampermonkey 菜单注册诊断导出命令。导出 JSON 包含：

- script/year/persona/page 信息
- 当前 cache state
- Repository 数量
- 请求序号与每次请求诊断
- `hasAllItems` bypass 记录
- XHR scoped capture 归属与 payload 数量
- 运行时对象、descriptor 和有限方法样本
- 完成或失败原因

诊断上限当前为 6000 entries，方法源码最多保留 6000 字符，单个方法采样最多 4 次。

### 12.2 一份成功日志应满足

1. `requestSequence` 覆盖所有预期页面。
2. 每页状态为 HTTP 200。
3. 每页 `payloadCapture.selected` 为 `scoped`。
4. `scopedCaptured` 与该页实际返回玩家数一致。
5. 没有 `payload-capture-fallback`。
6. 最终 `verified == expected == repositoryPlayers`。
7. `clubCache.status == ready`，`clubState == true`。
8. 缓存保存日志 `fallback:0, skipped:0`，或对 skipped 有明确解释。

### 12.3 失败日志调查顺序

1. 检查 `currentState.clubCache.status`。
2. 检查 expected、restored、verified、repositoryPlayers。
3. 找到第一个失败 request，而不是只看最终 stack。
4. 检查是否记录了 `has-all-items-bypass`，且 count/offset 正确。
5. 检查 XHR session 是否 `claimed`、`completed`，HTTP status 和 parse error。
6. 对比 `scopedCaptured`、broad captured 和 response item 数。
7. 检查同一时间是否有 Enhancer 的 90/page Club 请求。
8. 检查 stale removal、targeted validation 和最终 count mismatch。

### 12.4 已验证诊断样本

| 文件 | 结论 |
| --- | --- |
| `fsu-club-diagnostics-2026-07-21T05-19-10-261Z.json` | 当前成功基线；50/50 scoped、9826 exact、ready |
| `fsu-club-diagnostics-2026-07-21T04-51-19-284Z.json` | 发现并删除 77 个 stale 实体；当时仍使用 compatibility fallback，不能作为最终 capture 基线 |

诊断文件包含账号库存元数据，不应直接提交到公开仓库。需要加入自动测试时，应抽取最小、脱敏 fixture。

## 13. 测试覆盖

Runner 当前自动测试至少覆盖：

- FSU 不存在、loading、provisional、finalizing、ready 状态投影。
- Adapter 调用 `validateClubPlayers()`。
- provisional access begin/end 转发。
- 通用 SBC 提交在 pre-save 前刷新运行时实体。
- 定向校验失败时不保存、不提交。
- runtime access 在成功或失败后释放。
- Dry Run 不执行定向网络校验。

相关文件：

- `src/adapters/ea/fsu.js`
- `src/sbc/submit-attempt.js`
- `src/userscript-entry.js`
- `tests/contracts/fsu-adapter.test.js`
- `tests/unit/submit-attempt.test.js`

FSU 本体仍是外部单文件脚本，目前没有完整 Node 单元测试框架。其网络 hook、EA factory 和 Repository 行为必须继续用真实页面诊断验证，同时逐步抽取纯函数和脱敏 fixture。

## 14. 安全不变量

以下规则不得为了加速而放宽：

1. 不得用 Club 总数代替实体级权威校验。
2. 不得把普通 JSON 当作 EA 实体注入 Repository。
3. 不得在 provisional 状态提交未经定向校验的 Club 卡。
4. 定向校验必须同时匹配 item ID 和 definition ID。
5. 捕获 payload 必须属于确切 XHR；不得恢复 broad 时间窗口 fallback。
6. `hasAllItems()` bypass 只能命中当前 criteria，且必须立即恢复。
7. stale 缓存卡必须删除，不能只添加和更新。
8. 全量校验失败不能设置 `info.base.state = true`。
9. Runner 定向校验发现属性变化后必须重选，不能静默继续提交。
10. provisional access 必须 scoped 并在 `finally` 中释放。
11. FSU Lock、Only Untradeable、联赛、Evolution、高分和特殊卡保护仍由原有安全链执行；缓存优化不改变业务保护。
12. Enhancer 并发问题必须通过协调请求解决，不能通过接受来源不明 payload 解决。

## 15. 发布、补丁和回滚

历史已验证 FSU 文件（以下旧 hash 不代表当前 `26.09.8`；当前产物以 manifest 和 patch replay 为准）：

```text
FSU_mod\【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js
SHA256: 1A35FDD418314AD7AD654C68BE174786BBB431FFC4A2E538D92C5DA193D88656
```

对应未修改上游基线：

```text
FSU_mod\【FSU】EAFC FUT WEB 增强器-26.09_origin.user.js
SHA256: A2E0BEB018921CDD334D68BD4AF9BEE843F9F391A98E01E3B27D67E74D6B9634
```

可重放补丁：

```text
FSU_mod\FSU-26.09-club-cache-optimization.patch
FSU_mod\fsu-mod-manifest.json
FSU_mod\Apply-FsuOptimization.ps1
```

执行 `npm run build:fsu-patch` 会重新生成补丁和 manifest，并在临时目录验证“原版 + patch”的 SHA256 必须与优化版完全一致。迁移到新的 FSU 上游版本时，使用 `Apply-FsuOptimization.ps1` 先做 `git apply --check`，冲突时停止，不能按行号复制或强行三方合并。

主要历史回滚点：

- `backup-20260720-before-club-load-opt`
- `backup-20260720-before-entity-cache`
- `backup-20260721-before-authoritative-cache-validation`
- `backup-20260721-before-club-repository-dirty-fix`
- `backup-20260721-before-club-runtime-diagnostics`
- `backup-20260721-before-hasallitems-bypass`
- `backup-20260721-before-readonly-cacheable-fix`
- `backup-20260721-before-scoped-capture-onloadend`
- `backup-20260721-before-xhr-response-id-routing`
- `backup-20260721-before-club-performance-phase1`
- `backup-20260722-before-club-performance-phase2`

这些是历史调查点，不代表每个中间版本都安全。当前发布候选只认 `fsu-mod-manifest.json` 中记录的原版、优化版和补丁 hash。

## 16. 后续优化路线

### FSU-C1：Enhancer 并发复验

| 字段 | 内容 |
| --- | --- |
| 状态 | Complete |
| 风险 | 高 |
| 目标 | 启用 Enhancer，确认 FSU 全部分页 scoped，且无 status 0/timeout |
| 影响组件 | FSU XHR capture、Club request scheduling、Enhancer startup scan |
| 验收 | `22-56-54` diagnostics 在 Enhancer 开启时 40/40 exact scoped、无 403/status 0/timeout、`verified == expected == 9825`、0 fallback、无错误归属，completed 52.072 秒 |

### FSU-C2：跨插件 Club 扫描协调

| 字段 | 内容 |
| --- | --- |
| 状态 | Monitoring, evidence-triggered |
| 风险 | 高 |
| 目标 | 避免 FSU 200/page 与 Enhancer 90/page 同时压测 EA Club API |
| 候选方案 | 检测活动请求后退避；页面级互斥锁；低优先级调度；仅 FSU 侧指数退避 |
| 禁止方案 | broad capture；吞掉 timeout；无限重试；全局改写其它插件请求 |
| 当前决策 | C1 已证明两插件同时启用可以完成 40/40 exact scoped，当前没有 status 0、timeout、429 或错误归属证据，因此不主动实现跨插件互斥。以后只有出现明确请求竞争证据时才恢复本项 |
| 验收 | 若重新开启实现：两插件同时启用连续多次登录无失败；不会显著拖慢任一插件的正常操作 |

### FSU-P1：降低全量校验时间

| 字段 | 内容 |
| --- | --- |
| 状态 | Complete |
| 风险 | 高 |
| 当前基线 | 约 65 秒，50 页，200/page |
| 已实现 | 正常模式改为轻量请求诊断；深度 Service/DAO/Repository/Network 包装改为 Tampermonkey 菜单按需开启；停止正常路径的 broad payload 深拷贝；增加 network/response parse/local processing/total 分段计时；移除每页为了日志而全量扫描 Club 的 ID/数量计算；`250/page` 已实盘验证并缓存；正常模式不再重复遍历和更新 `services.Club.search()` 返回的近万张 Repository 全视图，只 materialize exact scoped payload |
| 保持不变 | exact scoped XHR capture、实体 factory 构造、Repository reconcile、stale 删除、最终 Stats 数量核对、Runner 定向校验和 provisional/ready 状态机 |
| 验收 | Enhancer 开启时 completed 52.072 秒，较约 65 秒基线下降约 19.9%；40/40 exact scoped，0 payload 丢失，最终数量一致，无更高网络失败率 |

首轮实盘必须记录：

```text
[FSU club load] selected supported page size:...
或
[FSU club load] EA truncated ... selected observed page size:...

[FSU club performance] requests:..., network:...ms, parse:...ms, local:...ms, request-total:...ms

[FSU club load] completed ... Club player(s) in ...ms
```

正常模式的 diagnostics `deepDiagnostics` 应为 `false`，每页 `payloadCapture.selected` 仍必须为 `scoped`。只有需要调查 EA/Repository 内部调用时，才从 Tampermonkey 菜单选择 `Enable deep FSU Club diagnostics for next reload`；调查结束后选择对应 Disable 命令。

#### 抽样验证结论

抽样不能替代全量权威校验，也不能把状态从 `provisional` 提升为 `ready`。抽中卡全部一致仍无法证明未抽中的卡没有被出售、转移、进化、替换或删除。当前第一页 page-size probe 可以作为快速判坏信号和性能采样，但命中后仍继续全量 exact scoped validation。

在 EA 没有 revision、etag、变更 token 或可靠增量游标之前，抽样只允许用于：

- 快速发现缓存明显失效并优先安排全量扫描。
- 比较不同 page size 的网络与本地处理成本。
- 诊断 endpoint 或插件并发异常。

抽样不得用于：

- 设置 `info.base.state = true`。
- 删除未抽中实体。
- 跳过 stale reconciliation。
- 允许 FSU 原生库存填充绕过 `requireClubReady()`。

#### 2026-07-22 首轮性能诊断

诊断文件：

```text
fsu-club-diagnostics-2026-07-21T16-14-04-237Z.json
```

正确性结果：

- 最终状态 `ready`，`clubState:true`。
- `expected == verified == repositoryPlayers == 9825`。
- 40 个分页请求全部使用 exact scoped payload；最后一页为 75 张。
- 缓存保存 `exact:9825, fallback:0, skipped:0`。
- 从旧缓存恢复 9803 张可序列化实体；全量 reconcile 后移除 271 个旧缓存 item ID，最终数量与 Stats 一致。

性能结果：

```text
page size: 250
successful page requests: 40
targeted reconciliation requests: 3
network: 28045ms
response parse: 68ms
measured local materialization: 2106ms
request total: 43767ms
completed: 62895ms
```

本轮总时间只从约 65 秒下降到 62.9 秒，未达到 20% 验收目标。原因不是 250/page 无效，而是首次探测 `400` 和 `300` 都返回 HTTP 403，分别浪费约 8.8 秒和 1.0 秒；后续 `250` 成功。日志还证明 `services.Club.search()` 每次返回约 9826 至 10096 张 Repository 全视图，而 scoped XHR 只返回当前 250 张。第二阶段因此：

- 不再探测已确认返回 403 的 400/300，首次只探测 250；已有 `v2` page-size 缓存时直接使用 250。
- 不再在每页返回后重复过滤、遍历和 `update()` 整个 Repository 全视图。
- 继续按 exact scoped payload 创建和更新当前页实体。
- 保留 3 次 targeted reconciliation。分页 union 不是原子服务端快照，即使数量等于 Stats，也不能仅凭 union 直接删除所有未出现缓存 ID。

第二阶段回滚点：

```text
backup-20260722-before-club-performance-phase2
```

下一次缓存恢复刷新应直接出现 `using cached Club page size:250`，不应再出现 400/300 probe 或 403。目标是保持全部正确性条件，并将 completed 时间稳定降至约 53 秒以下。

#### 2026-07-22 第二阶段复验

诊断文件：

```text
fsu-club-diagnostics-2026-07-21T22-56-54-254Z.json
```

正确性结果：

- 直接使用缓存的 `250/page`，没有 400/300 probe，也没有 HTTP 403。
- 40/40 分页全部 `outcome:resolved`、`payloadCapture.selected:scoped`。
- 最终 `expected == verified == repositoryPlayers == 9825`，状态为 `ready`、`clubState:true`。
- `captured 9825 exact payload(s)`，本轮无 stale：`removed stale:0`。
- Club fingerprint 与上一轮一致。

性能结果：

```text
requests: 40
network: 24587ms
response parse: 72ms
local materialization: 681ms
request total: 42667ms
completed: 52072ms
```

与约 65 秒基线相比，本轮下降约 19.9%；与第一阶段的 62.895 秒相比下降 10.823 秒。脚本侧 measured local processing 从 2106ms 降到 681ms，说明删除每页 Repository 全视图重复处理有效。用户确认本轮是在 Enhancer 开启状态下运行，因此同时关闭 FSU-P1 和 FSU-C1。

第一页请求总耗时约 9.0 秒，其中 XHR network 约 1.1 秒、脚本 measured local 约 25ms；其余时间发生在 EA `services.Club.search()` 内部请求创建或 Observable 完成链路。后续若继续优化该部分，需要先增加纯诊断计时，不能直接绕过 DAO/Repository 行为。

日志中的缓存保存 `3404171ms` 来自用户在 `ready` 后主动等待较长时间才导出/观察完成信息，本轮明确忽略，不作为缓存持久化性能缺陷，也不据此修改 yield 机制。

### FSU-P2：可信缓存快速路径与 freshness policy

| 字段 | 内容 |
| --- | --- |
| 状态 | Implemented; live fast-path verified |
| 风险 | 很高 |
| 目标 | 在明确时限和条件下减少登录后立即全量扫描 |
| 已确认 | EA 未提供可用的 ETag、Last-Modified、revision、cursor、sequence 或增量 token |
| 当前策略 | 12 小时时限 + Club 数量 + Storage/Transfer 实例指纹 + 本地 dirty 标记；Runner 提交前定向校验 Club 实体 |
| 验收 | 首次全量后刷新登录 0 Club 分页、0 错误，8.446 秒进入 `trusted-provisional`；信号变化自动回退全量 |

快速路径是有时限的启发式缓存，不是服务器增量同步。不得将 `trusted-provisional` 改名或等同于 `ready`，也不得删除 Runner 提交前定向校验。

### FSU-P3：后台低优先级校验

| 字段 | 内容 |
| --- | --- |
| 状态 | Proposed |
| 风险 | 中高 |
| 目标 | 页面空闲时推进全量页面，用户/Runner 发生定向请求时让路 |
| 验收 | 定向校验延迟不因后台页显著增加；全量最终仍可完成；Stop/失败状态明确 |

### FSU-D1：诊断体积与脱敏

| 字段 | 内容 |
| --- | --- |
| 状态 | Proposed |
| 风险 | 中 |
| 目标 | 缩小导出文件并移除不必要的球员细节，同时保留请求归属证据 |
| 验收 | 能定位 criteria/XHR/response/repository 问题；默认不输出可识别账号库存详情 |

### FSU-T1：自动测试提取

| 字段 | 内容 |
| --- | --- |
| 状态 | Proposed |
| 风险 | 中 |
| 目标 | 把 FSU 中可纯化的 matching/state/cache 函数移入可测试模块或独立 harness |
| 必测场景 | active criteria bypass、XHR identity、完整 defId、90/page 并发、stale 删除、scoped capture 缺失、双缓冲损坏 |
| 验收 | 每个历史回归都有失败测试；构建后仍可合并为单文件 Tampermonkey 脚本 |

### FSU-I1：Runner 集成矩阵复验

| 字段 | 内容 |
| --- | --- |
| 状态 | Automated complete; live matrix pending |
| 风险 | 高 |
| 目标 | provisional 状态下验证普通 requirements SBC、评分 SBC、FSU fill、Storage-only 和 Dry Run |
| 最小真实页面矩阵 | Daily/普通 Pick 或 Provision、84+ TOTW 或 84x10、无 Club 卡阵容、含 Club 卡阵容、定向 missing 模拟 |
| 已完成代码审计 | 4 个 live `submitSbcAttempt()` 入口全部注入 `prepareFsuRuntimeAccess`；只校验 Club refs；按 item ID + definition ID 匹配；保持阵容顺序；缺失或关键属性变化时阻断且不静默重选；Storage/Transfer/Unassigned-only 跳过网络校验；Dry Run 不调用 runtime access |
| 已完成自动测试 | `fsu-runtime-access.test.js` 覆盖 not-detected/ready/loading/provisional、非 Club 短路、精确双 ID、实体替换、顺序保持和关键属性变化；Adapter 与提交事务测试覆盖 FSU 状态、定向调用、刷新实体进入 validator/save、失败前阻断和 Dry Run 无副作用；架构测试锁定 4/4 提交入口 |
| FSU fill 修正 | FSU 的 `playerListFillSquad()` 会先调用自身 `saveSquad()`；Runner 定向校验后若确实刷新了 Club 实体，最终提交前补一次 `saveChallengeSquad()`，ready、无 Club 卡和 Dry Run 不增加保存 |
| 剩余实盘 | provisional 期间各跑一次普通 FSU fill 与评分 SBC；分别覆盖含 Club 卡和无 Club 卡；用临时移动/出售测试卡制造 targeted missing 后确认提交前停止，并确认重新 Start 可继续 |
| 验收 | 自动测试已完成；上述真实页面矩阵通过后将状态改为 Complete |

## 17. Agent 修改流程

接到 FSU Club、Runner FSU Adapter 或提交前校验任务时：

1. 读取本文、`AGENTS.md`、完整 Runner 日志和 FSU diagnostics JSON。
2. 查看当前 FSU 文件 hash、补丁、备份和 Runner git diff。
3. 先判断问题属于缓存恢复、强制请求、XHR 所有权、Repository reconcile、状态机、Runner Adapter 还是提交事务。
4. 搜索所有共享调用方，特别是 `submitSbcAttempt()` 和 FSU 原生 fill。
5. 对历史线上 Bug 先抽取最小失败测试或诊断 fixture。
6. 只修改对应层；不得为某个 Loop 在 Adapter 中写专属分支。
7. Runner 修改运行 `npm run verify`；FSU 修改还必须重放补丁并真实页面验证。
8. 同时启用 Enhancer 的改动必须额外验证并发，不得只在 Enhancer 关闭时验收。
9. 更新本文的验证证据、状态和路线项，不在聊天记录中维护另一份事实来源。

## 18. 当前未完成结论

截至 2026-07-22：

- FSU-P2 已实现并完成首次真实页面快速路径验证：缓存 manifest 包含 `lastFullValidationAt` 及 Storage/Transfer 实例指纹。12 小时内且 Club 数量、两处库存指纹和本地 dirty 标记均未变化时，启动进入 `trusted-provisional` 并跳过本次全量 Club 扫描；首次升级、手动刷新、过期、任一信号变化或本地库存操作都会保留/触发全量校验。

### 18.1 大规模 stale cache 清理

`fsu-club-diagnostics-2026-07-22T22-56-12-375Z.json` 暴露了一个安全阈值误判：缓存记录 `9930` 个球员，EA 当前统计为 `9232`。37 页 Club 请求全部使用 exact scoped capture，并得到 `9232/9232` 个唯一服务器 ID 和 payload，但旧实现因 `871` 个缓存 ID 超过 5% 定向核对阈值而进入 `validation-failed`。

修正后的全量校验只在以下条件同时成立时直接按服务器集合清理 stale provisional 实体：

1. EA 统计值大于零，并实际完成了覆盖该数量所需的分页请求。
2. 扫描前后的 `Club.getStats` 球员数量不变。
3. scoped capture 得到的唯一服务器球员 ID 数等于该统计值。
4. exact payload 数也等于该统计值。
5. 扫描期间 FSU 的本地库存 dirty marker 未变化，排除用户、Runner 或其它 FSU 操作同时改变库存。

满足五项说明本次分页已经形成完整权威快照，未出现在集合中的 provisional ID 可安全批量删除，不再受 5% 定向核对阈值限制。清理会记录 `authoritative-cache-reconciliation` 诊断事件，并在任一实体删除失败时停止进入 ready。

如果五项中任意一项不成立，仍保留原有保护：小规模差异按 definition ID 分批向 EA 定向核对；差异超过阈值则保留 provisional cache 并进入 `validation-failed`，不会根据不完整快照批量删除。

### 18.2 跨域 response header 控制台警告

Club 分页诊断曾逐个调用 `XMLHttpRequest.getResponseHeader()` 试探 `etag`、`x-revision`、`x-sync-token` 等潜在增量 header。EA 的 `/club` 跨域响应没有通过 `Access-Control-Expose-Headers` 暴露这些名称，因此 Chrome 会为每页输出多条 `Refused to get unsafe header`。该消息不代表 Club 请求失败，但会污染控制台并掩盖真正错误。

当前实现只调用一次 `getAllResponseHeaders()`，解析浏览器实际允许脚本读取的 header，再从其中筛选增量候选。未暴露的 header 不再主动查询；diagnostics 仍保留 `responseHeaderNames` 和可读取的 `deltaHeaders`，不会降低现有诊断能力。

- EA `Club.getStats()` 和 `/club` 响应均未发现 ETag、Last-Modified、revision、cursor、sequence 或其它增量 token，因此快速路径是有时限的启发式缓存，不是服务器增量同步。Runner Live 提交仍必须通过 `validateClubPlayers()` 定向验证所选 Club 实体。
- 单独启用 FSU 时，实体缓存恢复、50 页 exact scoped capture、stale 清理和最终 ready 已验证。
- Runner 的 provisional readiness、4 个提交入口、精确实体匹配、FSU fill 最终刷新保存和 Dry Run 已完成代码审计及自动测试；仍需完整真实页面矩阵收尾。
- Enhancer 并发下的 payload 误归属风险已从架构上消除；请求竞争是否完全可接受尚未验证。
- 全量 exact scoped 扫描仍作为回退路径存在；最近一次 9930 球员、含 3 次 401 重试的首次新格式扫描耗时 86.236 秒。快速缓存复验为 8.446 秒且没有 Club 分页请求。后续优化不能以牺牲实体级正确性为代价。
- FSU-P1 和 FSU-C1 已关闭：Enhancer 开启时 40/40 exact scoped、9825/9825、无 403/status 0/timeout，completed 52.072 秒，较约 65 秒基线下降约 19.9%。C2 转为证据触发的 Monitoring，不在当前成功基线上主动增加跨插件互斥。

### 18.3 定向校验的权威空响应

FSU Local `26.09.2` 修复了 provisional Club 定向校验的一种误判。某张缓存球员已经被出售、转移或删除时，EA 可以对按 definition ID 发起的 Club 查询返回 HTTP 2xx 和明确的空 `items`、`players` 或 `entries` 集合；这表示请求成功完成，但目标 item 已不存在。旧逻辑只看捕获到的玩家 payload 数量，会把该结果误报为 `captured no scoped Club payloads`，导致本来可以安全清理 stale 缓存的 SBC 提交被阻断。

现在只有以下条件全部成立时，定向校验才接受 `scoped-empty`：

1. 当前 capture session 精确 claim 了该 XHR，且已完成。
2. HTTP 状态为 2xx，JSON 解析成功，没有 parse error。
3. 响应明确包含 `items`、`players` 或 `entries` 中至少一个已知 Club 集合，且该集合为空。
4. 响应中没有其它非空顶层数组，避免把未知的玩家集合误当成空结果。

全量 Club 分页没有启用该放宽规则，仍然要求每个非空页面有 scoped player payload；未知响应形状、空字符串、解析失败、非 2xx 或没有已知集合时仍会重试并失败。接受空响应后，Runner 会按 item ID + definition ID 判定请求的缓存实体缺失并移除它，不会静默提交旧实体。该行为由 `tests/unit/fsu-club-response.test.js` 锁定。

### 18.4 One-click Fill 的实际数据源

FSU Local `26.09.4` 更正了对手动 One-click Fill 数据流的判断。`events.getItemBy(type, queryOptions, insertData)` 的基础候选来自 Club + Storage；第三个参数中的 Unassigned 卡只用于把对应 `duplicateId` 提升到排序前部，不会把 Unassigned 实体直接写入阵容。因此 One-click Fill 必须等待 Club Repository ready，且排除可交易、排除联赛、Gold Range、Lock 等 `build`/`set` 设置会过滤真实候选。FSU Local `26.09.5` 将该路径的诊断 API 显式导出到共享 `events` 对象，修复了局部 `reloadPlayers()` 作用域之外调用 `emitClubDiagnostic` 导致所有 SBC 一键填充中断的问题；诊断失败现在不会阻断填充主流程。FSU Local `26.09.6` 进一步防护提交前的珍贵球员判断：价格节点尚未创建时记录 `valuable-player-price-missing`，按非珍贵卡继续原始提交，不再因 `priceItem` 缺失抛异常。

`playerListFillSquad()` 保留共享 Club readiness guard，One-click Fill 在开始选材前也显式检查 readiness，并输出当前 `build`、`set`、Unassigned signal、候选匹配和排除原因到结构化诊断日志。该边界由 `tests/unit/fsu-squad-fill-guard.test.js` 锁定。
