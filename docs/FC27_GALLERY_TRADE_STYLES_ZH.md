# Gallery 购卡去向与 Fodder 风格实施计划

日期：2026-10-07。基线提交 `702afb4` / 27.0.12，Streamlined SBC 暂停。

## 已确认合同

- Settings 增加账号级 Gallery 购后去向 Club / Unassigned，默认 Club；新批次冻结去向，旧记录缺省 Club，恢复不得采用新默认去向。
- Settings 增加 Enhancer / Fodder 交易界面风格，默认现有风格。现有购买核心源于 FSU 并已按用户要求变更报价政策，不能称其后台与 Enhancer/Fodder 完全相同。
- 用户再次确认两套独立 UI：Fodder 单独组件与 `.fcat-fodder` 样式，原 `fc27-bulk-list-view.js` 不改动；共同交易底层必须保持默认流程兼容。
- 用户确认完整复现 Fodder 本批操作：买价百分比区间、尝试次数、Market/Bought for 挂牌基准、累加百分比调整及仅发送 Transfer List。这些本批操作不改账号默认配置；公共报价选源、已批准上限、EA 相邻价格档位合同保留。不得把外观切换当新交易授权。
- 未确认成交、移动或挂牌结果仍保留精确实体 Journal；收集计分和购后位置分开，不把 Unassigned 当 Club，也不把购入当作 EA 已计分。
- 不要求用户反复购卡以查看样式，提供离线浏览器场景；真实交易留到最后由用户点击。

## 参考证据

截图：用户桌面 `fodder.png`（购卡）与 `fodder2.png`（挂牌）。本地公开客户端下载于 2026-10-06，`artifacts/streamlined-research-2026-10-06/fodder-client.js`，版本 1.3.3。可读格式 `artifacts/fodder-research/fodder-oct06-readable.js`，不作为发布依赖。

Fodder `nc/ei` 是购卡标签与 75–200%、5% 步进、1–5 次输入；`VI/jI/FI/UI` 是挂牌执行与 EA 档位；`GC/KC/Dt` 是模态框结构。挂牌逐卡 `Item.list`、缺价格范围查询 `requestMarketData`；价格下限/上限可能调整。FCAT 的已批准购买上限和显示报价不得因该参考自动放宽。具体 UI/调用边界在实施时继续核对。

## 阶段与验收

1. 去向与恢复：账号存储、UI、冻结 Journal、Unassigned 精确定位、收集独立状态、会计与挂牌来源兼容。
2. 挂牌准备与转移事务：Club/Unassigned/Transfer 精确身份、容量、移动未知回执、直接挂牌与仅移入 Transfer List 两个独立动作、重复点击和恢复。普通挂牌不增加预先 move。
3. Fodder 两套界面：按参考布局/控件接共同事务，本批价格/次数参数冻结，停止/失败卡重试/窄屏/长列表。
4. 回归与安装：完整 verify、离线浏览器、最新产物/安装哈希。实机只读由 Agent；真实买入、移动、挂牌由用户集中验证。

场景矩阵必须覆盖：旧记录迁移、账号切换、设置读写失败、中途变更去向、明确拒绝/未知成交、已购不重买、收集 pending 不阻断已确认 Unassigned 交易、原 Club 流程不变、转移失败/容量不足/已转移后恢复、仅转移不挂牌、价格来源禁用、缺价、按买入价不影响采购上限、本批重试不改默认、两套风格操作等价、长列表底栏可见。

## 当前恢复点

2026-10-07 用户要求升版提交：当前累计修改整理为 **27.0.13**，完整 verify（391 / 4273）、全套离线浏览器和产物一致性通过。构建 SHA256、提交范围及实机待验收边界见 [27.0.13 说明](releases/27.0.13.md)。下文 27.0.12 的安装记录均为升版前历史证据；后续实机验证须重新安装当前版本并核对源码。

### 2026-10-07 重试空白与 waiting 无继续入口

本轮最终验证：完整 `npm run verify` 391 文件 / 4273 项通过，双风格离线 Chromium 交互检查通过。当前 27.0.12 生产构建 root/dist/专用 Chrome 安装源码 SHA256 均为 `0e53133574dfe8017b0a02d92065f17f0328454de381391bf2c331d1195b93d9`，1581396 bytes；安装证据在 `artifacts/fc27-browser/agent-2026-10-07T09-36-17.144Z.json` 对应检查会话。安装后尚未刷新核验运行时，真实重试买入仍由用户验证。下方 Settings 的 `3191402c…` 为本轮修复前历史构建，不代表当前安装。

用户实机反馈 `捕获.PNG` 的重试空白窗口，以及 `捕获1.PNG` 的三张 waiting/0 failed、刷新无效。根因：重试入口销毁结果组件但仍隐藏初始布局，进度只写到隐藏节点；结果组件只提供失败重试和未知回执恢复，遗漏尚未处理 waiting 的继续入口。另外 execute 异常返回的简化 results 缺少 reference/attempt，原 UI 未合并 inspect 的持久记录，因此可能将真实失败显示为普通 waiting、报价留空。

用户随后明确：重试必须回到原 Fodder 双栏购卡进度界面。最终修复保留结果编辑状态并在执行期间隐藏它，显示原双栏球员列表、已完成数量、花费和进度条；恢复进入没有原列表时，从本批持久记录重建列表。完成或停止后再返回结果视图，未处理卡可以继续，失败卡仍单独显式重试，未知回执仍先核对。最终显示优先采用已核对 Journal 的报价和尝试详情，读取失败保留可见错误。仅修改 Fodder 组件，Enhancer、交易事务和价格授权规则未改；此修复不构成 Fodder 原插件完整交互等价的验收。

新增离线 Chromium 可信点击回归：400 改 450 后重试，等待中列表/上限/进度可见，停止后恢复失败操作，异常提示可见，简化响应后恢复持久报价，waiting 通过 Continue pending 续购且不创建新 retry grant。原两套样式隔离、长列表、窄屏、停止、挂牌仅转移检查一并通过。复现阶段新断言在修复前稳定失败（`retry must retain a visible player/progress screen`）；修复后通过。截图 `artifacts/fodder-research/gallery-fodder-retry-progress.png` 使用合成数据，无真实买入/移动/挂牌。

阶段 1–3 已接入生产，阶段 4 自动回归及实机设置/空列表检查已完成，真实交易等待用户集中验收。Fodder 结果/重试视图修正后完整回归 **391 文件 / 4273 项**通过；随后 Settings 布局将安装检查与 Gallery 交易设置并列，报价设置单独放在底部。布局调整后的生产构建已安装，27.0.12 源码 SHA256 为 `3191402cb32a16c676f159d65b68b4ef580db6284d44977d57728a48aa114ab5`；安装源已精确核对，尚未刷新后实机验收本次布局。离线 Chromium 核对 1340px 同行、390px 自动单列及报价区域始终在底部；截图 `artifacts/fc27-browser/settings-layout-{1340,390}.png`，相关回归 24 项通过。保持 27.0.12，不提交或发布。

### 实现与参考行为

| 功能 | 当前行为 |
| --- | --- |
| 默认兼容 | 未设置时 Enhancer + Club；未修改原 Enhancer 挂牌组件，Fodder 风格只在选择后创建 |
| 购后去向 | 新 Journal 冻结 Club/Unassigned；Unassigned 精确确认持有后完成，不发 Club move；切换设置不改变续购 |
| 挂牌来源 | 已购回执和当前实体分开；Club/Unassigned/Transfer 均按精确 item/definition 复核，可售卡扫描合并三处当前实体 |
| Fodder 购买 | 双滑块 75–200%（5% 步进）、1–5 次；单次用最低比例，多次线性插值；每次仍受冻结公共报价上限约束；已成交卡显示实际去向与花费 |
| Fodder 挂牌 | Duration、Market/Bought for（无购入价回退市场）、−5/+5/+10/+20 累加与重置、同版本未手填项继承、Shift 范围选择、2–15 秒 Wait |
| 手动价格 | EA 相邻价档；手填覆盖不被百分比重置，同版本已手填副本不覆盖；EA 价格范围仍在计划和执行时复核 |
| 仅移入 Transfer List | 独立 action Journal，不查执行价、不调用 list；容量明确拒绝为失败，未知移动只按精确位置恢复，不重移 |
| 卡面 | 购买窗口使用 Gallery 已加载 EA 原生实体/DTO 与原生 renderer，不为缩略图追加卡池请求；缺图保留姓名/评分文字 |
| 失败/停止 | Enhancer 保持通用结果编辑器；Fodder 购卡完成后切换到独立 Fodder 结果/重试视图，不把通用结果列表追加到初始双栏购卡窗口下方。失败卡以 Fodder 表格显示，可勾选、编辑本次 Buy Now 上限、刷新报价并重试；恢复不改冻结去向/次数 |

公开价格仍由 FCAT FUT.GG/FUTBIN 设置决定，不调用 Fodder 私有服务。失败卡重试继续采用已批准的 FCAT 编辑上限合同；没有把样式切换当作提升上限的权限。参考 UI 已适配现有 DOM/原生 renderer，并非复制运行整个 Fodder React 应用；不能宣称所有环境、所有行为已与参考插件完成实机等价验收。

### 自动验证证据

- 完整 `npm run verify`：390 文件 / 4264 项通过；FSU 26.09.9 补丁、版本、root/dist 检查通过。
- `node scripts/verify-fc27-prelaunch.mjs --browser`：84 文件 / 1414 项及全套离线浏览器通过。
- 新场景覆盖 Unassigned 无 move/收集 pending、冻结去向与中断恢复、Fodder 三次价格范围恢复/上限不涨、直接 Unassigned 挂牌、仅转移未知回执恢复/容量拒绝、报价部分刷新时独立失效、账号隔离和持久化失败。
- 离线浏览器可信点击覆盖两套独立窗口、默认 Enhancer 在 Fodder 挂载前后样式一致、双滑块、次数、同版本箭头联动、报价错误、停止、仅转移、30 行列表和 390px 底栏可见。截图位于本地 `artifacts/fodder-research/gallery-fodder-{buy,list}.png`。
- 专用浏览器安装精确源码，root/dist/Tampermonkey SHA256 均为 `6716f540b6645f94ac9081b25b6d0e1c97ba8a9b95c049b2d682c321a7d26538`，运行时 27.0.12。真实 Settings 两选项、两风格分别打开、窗口尺寸与设置恢复通过。当前账号没有 Gallery 购买记录，Arsenal 可售列表为 0；这仅确认空列表准备，不冒充非空交易验收。证据在本地 `artifacts/fc27-browser/agent-2026-10-07T07-26-23.799Z.json` 与 `current-install.json`。

### 留给用户的一次集中验收

1. Settings → Gallery 交易选择 Fodder / Unassigned 并保存；从缺卡集合打开购买窗口，先核对卡面、区间与封顶价。
2. 用户主动购买 1–2 张低价卡，确认花费和 Unassigned 实体；再打开“挂牌已购卡”，核对 Bought for、百分比及单卡箭头。
3. 用户选择“仅发送 Transfer List”或实际挂牌；前者确认没有拍卖，后者核对原生起拍/BIN 与回执。不要将这两步视为 Agent 已执行。
4. 切回 Enhancer / Club；核对原界面正常。停止/失败/续购如果自然出现，确认已购不重买、去向沿原批；无需人为制造异常或重复买卡。

剩余 gap：真实 Unassigned 计分时序、实购/移动/挂牌回执和真实非空卡面视觉验收。无需更多开发决策；用户反馈具体实机差异后继续修正，不重开 Streamlined。
