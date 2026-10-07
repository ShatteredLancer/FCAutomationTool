# Puzzle 购买记录生命周期修复（2026-10-07）

用户已批准：正常收尾解除活动标记；SBC 完成/下架后停止旧续购并保留历史；未知成交/入库做有限只读核对，仍未知则归档为未确认，不自动重试、不全局阻断其他功能。真实购买、移动、填阵、贡献仍由用户明确操作。

## 实施与恢复顺序

1. 验证账号和记录结构，将历史记录与共享执行锁分开；修正 Puzzle/Gallery/Streamlined 的全局 marker 阻断。同目标未归档记录继续走原恢复路径。
2. 共享锁内维护 pending 生命周期：正常结束、目录确认退休、未知结果一次有界核对；先持久化原记录和收尾原因再清活动标记。未知不伪装成功，保留不可自动重试的旧 operationId。
3. 新一次用户购买从当前原生阵容建立独立批次，不自动沿用已归档价格授权。旧批次相同授权重放禁止；历史记录完整保留，存储失败明确报错。
4. 修正贡献前失败留下的全 waiting Streamlined Journal。仅从未发出且进度未变的记录允许新的明确批准替代；未知回执、已发生贡献不覆盖。
5. 全回归、最新构建精确安装、专用浏览器自动核对旧记录归档和贡献预览；真实贡献仍留给用户。

## 场景矩阵

覆盖正常/部分购买收尾、Set 完成/缺失/目录未就绪、未知成交查到 Club/未分配/均未找到/查询失败、旧授权重放、新授权当前阵容、账号切换、并发锁、归档/标记写入或回读失败、刷新恢复、跨 Gallery/Puzzle/Streamlined 不阻断及同目标恢复。未知结果保留精确原记录，不以缓存缺失推断从未成交，不自动消费或移动卡片。

当前实现已接入生产入口。原现场 Set21/Challenge48：ready、club2、waiting4、applied0，目录22项不含Set21；该旧批次只读核对后归档，不会继续购卡。当前源码构建为 27.0.12，root/dist/Tampermonkey SHA256 `80851bd9084ba289310178f61a34e92daca7a77c76a14f678269d864b6b5ce69`，已通过 `install-current.mjs` 精确安装核对。完整 `npm run verify`：386 个测试文件、4229 项通过；Puzzle/Streamlined 定向测试和离线浏览器 smoke 通过。真实买卡、移动、贡献、提交仍未由 Agent 执行，须由用户最后主动验收。

### 2026-10-07 收尾修正

- 部分购入但仍有 waiting 卡的批次不再误判为 settled；只有所有槽位均为已确认 Club 实体且与 applied 完全一致才跳过目录读取并归档。
- 已完成旧批次在同一 Set/Challenge 创建新当前阵容批次前，先写入不可重试历史，避免新 operationId 覆盖旧记录。
- 生命周期维护在 Acceptance Session 的一次操作入口统一执行，避免同一次购买重复做只读维护；Streamlined、Gallery 与新 Puzzle 仍不被无关历史批次全局阻断。

正常购买完成后，完整回执仍保存在当前目标记录，活动 marker 按原流程解除；未来同目标新批次覆盖前才把旧回执另存到 history。不是清 marker 后靠后台扫描寻找该记录。过期/未确认的活动批次则先写 history 和 closure，成功回读后才解除 marker。

### 最新验证与恢复点

- 完整回归：`artifacts/puzzle-purchase-lifecycle-final-current-2.log`，386 文件 / 4229 项通过；全部离线浏览器检查通过：`artifacts/puzzle-purchase-lifecycle-browser.log`。
- 专用浏览器安装：`artifacts/fc27-browser/current-install.json`；实际运行时 27.0.12 与上述精确源码一致。
- 实机只读报告：`artifacts/fc27-browser/agent-2026-10-07T05-34-33.941Z.json`。Set48/Challenge85 的当前积分仍为20/6750；生产窗口生成19张/6740分/1批，贡献按钮由原先 disabled 变为 enabled，不再显示旧 Puzzle 阻断。独立库存抽样17张/6760分的定向复核通过（16 Club＋1 Storage），不冒充窗口19张方案的执行验收。
- 未发生购买、移动、贡献或提交。旧批次 history/marker 的 GM 内容尚未独立回读；设置导出检查命令本轮返回 `FC27_INSPECTION_COMMAND_FAILED`，不能仅凭按钮 enabled 宣称真实归档已核对。后续补该记录只读核对；真实贡献和故障恢复仍由用户主动验收。
- 代码未提交、未升版或发布。浏览器检查进程已关闭；恢复检查时先复核当前构建哈希，再使用专用 profile，不沿用旧安装证据验收新改动。
