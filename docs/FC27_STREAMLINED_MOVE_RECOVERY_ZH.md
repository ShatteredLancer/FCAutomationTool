# Streamlined 外部卡移动与部分贡献恢复（2026-11-12）

## 事实与目标

用户 .101 日志确认先贡献 7 张 Club 卡，1490→5680/6750；随后两张外部卡所在批次在 materialize 被 move 的 success:false 阻断。未记录具体移动回执，不认定两张均失败，也不认定服务端已收到移动请求。窗口仍显示初始积分。

现有已审查 EA move 源码（tests/fixtures/fc27-buy-method-observation*.json）会按 isDuplicate()/duplicateId 查询旧实体，然后只保留可交换的卡。旧 Club 实体已消耗而外部 duplicateId 未失效时，可在未发 DAO move 的情况下返回 false。此为可复现代码缺陷，现场是否完全同因仍需新诊断。

## 实施计划

1. 先以捕获的原生 move 函数回放旧 duplicateId 导致的拒绝；覆盖 Club 前置贡献→外部移动→贡献、后续卡失败→恢复。
2. 仅在现有实时 Club 同版本查询完整成功、无同版本实体、材料保护通过后，同步当前外部实体可写的 duplicateId。继续调用原服务 move，不调用交换、不放宽身份/保护/未知回执规则；未知字段形态停止。
3. 在既有诊断环记录公开版本、来源、批内序号和数值响应码；无原始回复、私有实体 ID、额外持久化。诊断失败不影响交易。
4. validation 阶段阻断带回同一计划的已持久化记录；界面及时显示已确认积分、剩余积分及移卡错误，恢复仍跳过 confirmed，不自动重试或重贡献。
5. 定向回归、完整 verify、prelaunch/离线 Chrome；本地版本暂维持 27.0.102，重建根目录和 dist。真实移动和贡献由用户点击。

## 场景矩阵与恢复点

| 场景 | 预期 | 状态 |
|---|---|---|
| Club 已消耗，Transfer/Unassigned 留旧 duplicateId | 实时核空后原生正常移动，不交换旧卡 | 捕获 EA decoded move 回放与完整 selection→contribution 链通过 |
| Club 仍有同版本 / 读取失败 / 账号或保护变化 | 零移动，不清标记 | 回归通过 |
| 未知 duplicateId 形态或 predicate 仍重复 | 阻断，不猜测内部字段 | 只读字段、未知 predicate 回归通过；无 pending 写入 |
| 原生明确拒绝，HTTP/EA code/诊断 sink 异常 | 保留错误信息和 rejected；诊断不改交易结果 | 401/403/429/500、throw/reject/getters 及生产导出通过 |
| 部分外部移动成功、后续失败 | 已移卡不重移，已贡献不重投，核对后显式继续 | 两卡 materializer 回归及跨批贡献恢复通过 |
| 未知/超时/回读失败 | pending 保留，只读恢复，不自动重发 | 既有未知/缺 ID/缺回读及只读恢复回归通过 |
| 第一批成功、第二批移卡失败 | 窗口保留已确认/剩余分，贡献按钮不可直接再次执行 | 离线 Chrome 通过，汇总同时改为实际已确认＋待贡献 |

当前未操作真实账号、未移动或贡献。旧私有诊断文件不入 Git；不删除或清空旧 Journal。

## 实现与证据

- EA adapter 仅在原完整 Club 查询返回空且材料保护通过后修改当前实体的可写整数 `duplicateId`，并要求原生 `isDuplicate()` 回读为 false；其余情况不猜字段、不交换、不发移动。原始 move 方法指纹不变，未新增 DAO 写入口。
- 原生回放先证明未修复 `success:false/status:0/itemIds:[]`，真实 DAO move 次数为 0；修正后只调用一次原 DAO move，并独立核 Club。测试使用已提交的公开源码及虚构身份，不包含用户库存。不同于真实账号逐字段复现。
- 原 transaction 在 validation 抛错时丢了 record，现只带回匹配当前 plan fingerprint 的记录；不改变交易状态或再次执行权限。窗口显示实际积分/剩余、当前来源/版本/序号及 HTTP/EA code；已贡献卡标记仍保留。
- 诊断沿既有 materializer→provider→execution→导出白名单传播；只存公开版本 ID、来源、序号、数量、数值码，无原始回应/实体 ID；不扩大持久化环。
- 完整 `npm run verify`：476 文件 / 6118 项通过。prelaunch：89 文件 / 1696 项通过；完整离线 Chrome 退出码 0。最后汇总文本调整另跑完整 Streamlined 离线页面检查、定向 ESLint、build/check:dist 及 diff 检查通过。
- 证据：`artifacts/fc27-browser/verify-streamlined-move-20261112.log`、`verify-streamlined-move-browser-20261112.log`、`streamlined-move-final-ui-20261112.log` 与 `streamlined-materialize-partial-failure.png`。版本仍 27.0.102，本轮不提交、不升版。
- 最终根目录/dist 产物均 2,609,630 字节，SHA256 `93586af82b82df1011b8143fcd1b7a63d76d4309195ffd6db47fcce8896f7c38`；FSU Local 26.09.10 发布产物未改变。

## 真实验收与恢复

2026-11-12 后续用户授权拉取远程、解决冲突并升版提交。已合并远程 27.0.107 的采购恢复与 Puzzle 优化，本修复将随 27.0.108 提交；上文“不升版、不提交”和 27.0.102 产物是合并前的历史状态。合并后的独立验证与最终产物见 [27.0.108](releases/27.0.108.md)，不沿用旧测试结果充当合并验收。

当前专用浏览器仍由旧检查进程持有，未重启或安装本轮构建；不能把离线 Chrome 当作真实 EA 移动验收。用户应更新根目录最新生成脚本并刷新，在原 SBC 点击“核对并恢复”：应显示已确认进度及未发送余批。继续贡献由用户显式点击；成功前置批次必须跳过，剩余卡移动后再贡献。若期间账号进度已改变，以新回读为准，不固定声称仍为5680。

若仍被拒，新日志应含 `contribution-materialize-response` 与具体 HTTP/EA code/公开版本。未知移动仍先只读核对，不能清除记录再重发。现场原始 duplicateId 未采集，故不能认定此修复解释了用户日志中每一次拒绝；后续沿新证据追查其余原因。
