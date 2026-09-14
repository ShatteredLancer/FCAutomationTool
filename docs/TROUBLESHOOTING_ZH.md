# FC Automation Tool 故障排查

## 1. 出错后的第一步

1. 点击 Stop，不要继续手动移动当前 Unassigned 卡。
2. 保留 Storage、Transfer、My Packs 和当前 SBC 页面状态。
3. 展开 Options，点击 `Save log`。
4. 记录 Active Profile、Loop、Runner/FSU 版本和 Enhancer 状态。
5. FSU Club/加载问题同时导出 `FSU Club diagnostics` JSON。

不要只截取最后一条错误。根因通常位于之前的 Pack response、Unassigned materialization、Profile restore 或 SBC scan 记录。

## 2. 启动扫描时间较长

首次扫描、Clear cache 和大量 SBC 更新需要读取更多 Challenge。观察进度和扫描摘要：

- `cached/reused` 较多：Incremental 正常工作。
- `426/512/521`：Runner 会有限重试并降低请求频率。
- `429`：EA 已限流，本轮会停止继续请求；等待后使用 Incremental 重试。
- 新 SBC unavailable：没有兼容缓存且当前请求失败，不能安全生成 Loop。

不要连续执行 Full rescan；它会增加 EA 请求压力。

## 3. Dynamic SBC 没有出现在列表

在日志中查找该 Set 名称及 `status`：

- `supported`：应生成或更新动态 Loop。
- `unsupported`：后续 diagnostic 会指出评分、化学、特殊卡或未知条件。
- `ignored`：不属于当前支持的 Upgrades/Pick family。
- `unavailable`：当前 Challenge 请求失败且没有可信缓存。

Builder 只显示本次扫描存在的 Dynamic SBC。Profile 绑定的动态 SBC 到期后会阻止 Profile 激活，不会自动猜测同名替代。

## 4. Profile 恢复失败

常见日志：

```text
Active Builder profile ... built-in conflict(s) require resolution
```

程序会使用 Built-in 配置，Profile 专属阶段不会运行。打开 Builder 查看冲突：

- 未修改的官方 Profile 应自动更新基线。
- 用户修改过的同字段冲突需要选择 `Use built-in` 或 `Keep mine`。
- unavailable dynamic binding 需要重新扫描并确认目标仍存在。

运行日志中的实际 `running N step(s)` 是最终执行步骤的权威记录。

## 5. Daily 提前结束

检查每一步的 preflight、EA remaining 和结束状态：

- `completed`：该阶段已达到本次目标。
- `unavailable`：Set/Challenge 或来源包不可用。
- `blocked`：材料、Unassigned、容量、导航或提交确认失败。
- `stopped`：用户停止或上层 Workflow 停止传播。

父 Daily Workflow 不应在 blocked 子阶段后继续运行，也不应输出全部完成。提交前 Store/Pack 导航后必须重新加载 SBC Challenge。

## 6. 奖励包没有被打开

先确认实际 Profile 和步骤。Built-in One-click Daily 只有四步，不处理最终 Daily Rare packs；使用 `Daily + Rare Pack Recycling` 会以 Rare Gold Premium/Baseline 回收，使用 `Daily + Rare Pack to 5x80+` 会以 quantity-first Common Gold Premium 回收，先用 Common Gold，不足时才用 Rare Gold。

日志应同时显示：

- 来源包的动态/兼容 ID 和名称。
- 当前 My Packs 中的实例数量。
- 目标 Upgrade 的动态 Set/Challenge。
- `Open reward packs`、step override 或强制消费策略。

如果包被识别并记录 `left unopened`，通常是后续消费步骤没有进入 Workflow，而不是 Pack Catalog 失败。

## 7. Unassigned 阻塞或 Pack 471

Runner 会刷新 Unassigned、恢复迟到 duplicate metadata、确认新实体并运行 Recovery。仍无法确认时会停止，避免重复移动同一物品。

不要把 `471` 单独理解为 Pack 实例失效。需要结合：

- 开包前实例队列。
- response item IDs。
- live Unassigned IDs。
- Club/Storage/Transfer destination snapshot。
- 二次清理和稳定空状态确认。

已购买但未处理的卡也会阻塞开包；先人工处理该卡，再重新运行。

## 8. Storage 或 Transfer 已满

`Enable experimental native duplicate swaps` 默认关闭，因此新出现的 Unassigned 重复卡需要先整体进入 Storage。容量不足时返回 `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED`；不会交换 Club 卡、写新 journal 或提交主 SBC。

若已启用 Storage pressure SBC，Runner 会先尝试紧急 Provisions，再让选定的 Storage pressure SBC 净消费足够的真实 Storage 卡；待存的 Unassigned 重复卡不会进入恢复阵，即使它是 87/88/89 Provisions Reserve 也继续受保护。安全 Provisions 无法成阵时会继续尝试 Storage pressure SBC。确认容量后自动重试路由。未启用、恢复阵不可行或无法证明净释放容量时，手动释放容量后重新运行；Runner 会先检查现存 Unassigned，不会直接跳过阻塞。

## 9. Rolling 同版本重复卡身份保护

先在 `Selection Policy -> Rolling` 检查 `Enable experimental native duplicate swaps` 和 `Duplicate swap scope`。建议保持关闭；首次灰度只能选择 `special-only`，且每次最多一个 pair。关闭时正常日志应把重复卡路由到 Storage；出现 `DUPLICATE_SWAP_DISABLED` 表示提交前防线拦截了一条遗漏路由。Storage 有空间后重新运行即可。受控模式遇到未知 fingerprint、交易性或特殊分类时也会安全留在 Storage，不应手工改成 `all-eligible` 规避。

开关关闭不会删除或忽略旧 journal。若上一版本已经交换过 A/B，新启动仍先恢复或分类精确的原 Club ID B，再清理旧 journal；这是恢复动作，不代表新交换仍被启用。

只有显式开启实验开关时，以下交换事务日志才是预期行为。

当日志出现 `from:unassigned | submitFrom:club` 时，Unassigned 卡 A 和原 Club 卡 B
即使 `definitionId` 相同，也必须当作两个不同资产。Runner 会先持久化事务，再执行
交换：A 物化成 Club 实体 A'，B 暂时进入 Unassigned；旧阵容立即作废，并在同一个
Set/Challenge 内重新规划。只有精确的 `A' itemId + definitionId` 获得本次提交权限。

正常日志顺序应包含：

- `planned`：记录 consume A 和 protect B，以及交换前库存版本。
- `verified` / `materialized`：记录 A' 和被移到 Unassigned 的 B，旧计划失效。
- 保存前、保存后和 transport 前均通过同一份 exact-item manifest。
- 提交确认后 B 原样返回 Club，事务进入 `completed` 并清除 journal。

下列结果会停止而不是猜测另一张同版本卡：

- `DUPLICATE_MATERIALIZATION_IDENTITY_CHANGED`：A'、B 或库存版本发生漂移。
- `DUPLICATE_SUBMISSION_OUTCOME_AMBIGUOUS`：transport 超时后无法确认 A' 是否已提交。
- `DUPLICATE_JOURNAL_WRITE_FAILED` / `DUPLICATE_JOURNAL_CLEAR_FAILED`：事务无法可靠写入或清除。
- `DUPLICATE_REQUIREMENTS_REPLAN_UNSUPPORTED`：Requirements Recovery 无法证明仍绑定原 Challenge。

发生上述错误时点击 Stop，不要手动移动 A/A'/B。同一次运行内仍按严格事务执行：
能确认未提交时补偿，提交结果不明时 fail closed。刷新页面或重新安装脚本后的新一次
启动不会续交旧 squad，也不要求 A/A' 继续存在；它只逐项核对原 Club 卡 B 的精确
item ID。B 在 Club 时保留，在 Unassigned 时移回 Club，在 Storage/Transfer 时保留
当前位置，全部 pile 缺失时只告警，随后清除旧 journal 并按当前库存重新规划。库存
无法可靠对账、Ledger 不可用或返回未知 pile、精确 B 实体无法取得、移动失败、恢复后未在 Club 对账或 journal 无法
删除时才阻断并保留 journal。任何场景都不能仅按球员名称或 `definitionId` 替代 B。

真实页面验收应使用两张低价值同版本卡：A 放 Unassigned，B 放 Club，可让 B 带不同
化学样式或外观。确认提交的是交换后的 A'，B 未进入保存阵容且最终原样回 Club；再分别
触发 Stop、Active Squad 换卡和网络超时，确认同一次运行内完成补偿或明确停在 ambiguous；
随后刷新页面，确认新启动只核对原 Club item ID、清理旧意图并重新规划。自动测试
不能替代这一步。

## 10. FSU 加载较慢

FSU upstream 首次登录会全量加载 Club。FSU Local 首次成功后建立实体缓存，后续未检测到库存变化时可以快速恢复并在后台校验。

FSU Local 日志应区分：

- `trusted-provisional`：缓存可读，Club 提交仍需定向验证。
- `ready`：全量校验完成。
- `validation-failed`：缓存或实体证据不一致，不能继续使用 Club 卡。

完整排查见 [FSU Club Cache Integration](../FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)。

## 11. Recap 没有出现

Recap 只在本次会话实际获得 Rare Gold 或 Special 时显示。以下情况会跳过：

- 只有 Bronze、Silver 或 Common Gold。
- Dry Run。
- 没有实际开包/Pick 领取。
- 会话在创建 recap 前被页面刷新销毁。

日志会记录 `recap skipped` 及原因。

## 12. 提交 Issue 的最小信息

- FCAutomationTool 版本。
- FSU upstream/local 版本。
- Enhancer Enabled/Disabled。
- Active Profile 和 Loop。
- 精确复现步骤及开始库存状态。
- 完整 Save log。
- 涉及 FSU Club 时附 diagnostics JSON。

上传前删除认证 header、cookie 和 ntfy token。不要修改或重新排版日志时间顺序。

## 13. EA 错误码参考

`446`、`471`、`429`、`409` 和 `REQUIRED_ITEM_UNAVAILABLE` 的含义不同，不能只看
最后一个数字判断原因。完整的已确认映射、当前 build、诊断证据和安全处理原则见
[EA FC Web App 错误码记录](EA_ERROR_CODES_ZH.md)。
