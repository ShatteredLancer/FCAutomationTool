# Streamlined 外部卡贡献被旧记录阻断

2026-11-02 用户日志（27.0.85）显示：当前外部选择准备了 8 张库存材料，目标 6750；点击贡献却在 preflight 被目标 5500、已贡献 3860 的旧记录以 RECOVERY_REQUIRED 阻断，未进入材料验证/移动/贡献。日志不能区分旧记录的 waiting 与 pending/unknown，不据此认定所有旧请求已确认。

实施顺序：

1. 先用独立合成回归复现跨目标已确认＋未发送余批挡住外部选卡的情况，并覆盖未知请求不放行。
2. 核对后为可结束的异目标旧任务提供“结束旧贡献余批并归档”，由用户显式点击。仅完整已确认的纯 Club/Storage 历史及真正未发送余批可结束；完整原记录写入既有 history 键并复读，活动记录保存 validated retired 标记及递增 revision，避免丢回执或后续历史键冲突。旧采购/外部移动流程、无可靠回执、未知请求仍阻断。同目标仍核对精确积分，不以新计划替代未核实进度。
3. 阻断提示和原诊断环显示旧目标、确认批次数、未发送批次数、未知请求数，避免误报 Transfer 卡本身不可贡献。恢复不得把别的目标/改变门槛的旧方案装入当前窗口。
4. 运行针对性、全量及离线 Chrome 检查并构建。真实账号重新安装后，由用户点击贡献验证；不清除历史、不代用户贡献。

Club 同版本先贡献、确认后才移入 Transfer/Unassigned、达到目标停止的原顺序保持；FSU/锁卡/主阵容、精确材料读回、共享锁、购买预算与 Journal 未知状态保护保持。

## 实施与证据

采用显式结束余批，没有自动清除旧记录或自动归档。首次贡献遇到不同 set/challenge/门槛的旧记录时，返回 OTHER_TARGET_RECOVERY_REQUIRED 并附上公开目标与批次数；核对恢复也比较目标门槛，避免同 ID 更新规则后恢复旧计划。

结束操作必须经过当前页面的真实点击、会话上下文与共享锁核对，再次读取原记录、未决移卡和购卡记录。只接受有可靠已确认回执的纯 Club/Storage 旧任务，且剩余批次完全未发送；旧外部材料与任何未知结果不走此入口。归档写入和复读成功后才设置 retired，保留原回执和递增 revision；后续新任务继续递增，旧写不能覆盖归档，也不会碰撞历史键。没有新网络请求或 EA 写方法。

先红验证记录见 `artifacts/streamlined-history-red.log`。针对性贯通测试见 `artifacts/streamlined-history-integration.log`，覆盖显式归档后重新规划、不同目标 ID、同 ID 不同门槛、历史快照不变，以及生产 Provider/Materializer 中 Club 确认 → Transfer 移入贡献 → Unassigned 移入贡献顺序。另覆盖 pending/unknown、缺回执、进度冲突、过期快照和归档冲突不放行。

当前日志没有旧记录的逐批状态，因此不能声称这份历史一定可归档。更新后先点击“核对并恢复”：符合条件会出现“结束旧贡献余批并归档”；若没有，保留并显示具体旧目标和未知数量，再按新的诊断处理，不能删除 GM 记录绕过。

## 验证记录

- 全量 `npm run verify` 最终通过：454 文件、5563 测试，构建、root/dist 一致性与 FSU 资产检查成功。首轮两项失败是恢复目标新增 targetScore 后的旧严格参数断言，更新为同时检查 ID 与门槛后完整重跑通过。日志：`artifacts/streamlined-history-verify-final.log`。
- 根脚本仍为 27.0.85，本次构建 SHA256 为 `ded400ae2e4839b37e4fe6e38d31e2bb2077e2449c03761ec51662c4a0d051c5`。此前合并报告中的哈希仅代表该合并完成时刻。
- `node scripts/verify-fc27-prelaunch.mjs --browser` 退出码 0，定向测试及完整离线 Chrome 通过，日志：`artifacts/streamlined-history-browser.log`。新增真实点击/拒绝合成点击、390px 归档入口、归档后刷新外部列表验证。截图：`artifacts/fc27-browser/streamlined-foreign-history-mobile.png`，没有调用真实 EA 买卡、移动或贡献。
- 真实验收：重装本次构建，当前外部卡窗口点击“核对并恢复”；若出现可结束余批入口，由用户显式归档，再刷新、重新选择卡并准备预览。只有用户点击“按顺序贡献”才执行。原诊断缺旧批次细节，仍需确认实际旧记录是否符合该入口条件。
