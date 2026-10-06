# Streamlined SBC：Fodder / Futto 行为核查

日期：2026-10-06。任务为研究与规划，不是生产实现或提交验收。

## 1. 样本与证据

Fodder 官网 loader `https://fodder.gg/fodder.user.js` 仍叫 FC26、版本 0.4.0，但加载当前 FC27 客户端 1.3.3。专用浏览器实际加载的 `/client.core.js` 为 1,000,405 bytes，SHA256 `607d9cec03fea57da2215311f908273574b0f2d5230a0b8aa5abdc8ed3fed820`，与本轮静态分析样本完全相同。loader 安装源码精确比对通过，SHA256 `7f8cd32875cd2a42fa4f63fbef8794e3ed323f9213df6aa0eac91769aa4986d6`。

只启用 Fodder，临时关闭 FCAT/FSU/Futto，沿用已有 EA 登录；未登录 Fodder 账号、未购买 Gold。83+ Upgrade 当前为 Set 31 / Challenge 61、目标 2500、已提交 0。研究导航可以用名字定位样本，生产必须动态识别类型/身份/需求。

本机证据在忽略目录 `artifacts/streamlined-research-2026-10-06/`：`fodder-install.json`、`fodder-live-bundle.json`、`fodder-settings-detail.json`、各 `fodder-solve-*.json`、`fodder-coins/balanced/cards/partial/multi.json` 及对应截图。预览仅展示方案，原生选择数量一直为 0、已提交一直为 0；没有买卡、移动、提交或领取奖励。五次求解由原插件正常调用其服务，不绕过权限；这些研究请求不表示 FCAT 获得该服务的集成授权。

## 2. 实际操作流程

1. 进入原生 Streamlined 页面，工作区出现 **Solve Challenge**，不跳到 Fodder 导航页。
2. 点击后在原页面弹出同一个设置窗口，分 **This SBC / All SBCs**。
3. 点击 **Solve** 后同一窗口变成可停止的规划进度，完成后替换成批次结果。
4. 结果每批可勾选，展示卡片缩略图、评分、球员、来源、逐卡报价、批次积分和估值；底部 **Cancel / Submit**。这是插件自有预览，未把材料预先选到 EA 的 30 张工作区里，也没有传统 SBC 的“保存 11 人阵容”步骤。
5. 含待购材料的代码路径先展示 **Auto Buy N**，购买回执替换计划中的占位身份，补齐批次才成为可提交批次；仍有独立提交动作。当前账号市场求解受 Gold 权限限制，未实测买卡或付费求解。
6. 达不到目标时显示 Partial、奖励目标/截止日、本次积分和剩余缺口，按钮写明 **Submit 400 of 2,500**；不是简单报无解，也不会因为求解成功就自动贡献。

设置项：

| 范围 | 实际选项 | 本次观察 |
| --- | --- | --- |
| 当前 SBC 目标偏好 | Lowest coins / Balanced / Fewest cards | 三种均可生成预览 |
| 库存来源 | SBC Storage / Unassigned / Club / Market | 前三项默认选中，Market 未选中且为 Gold 锁定 |
| Storage 优先级 | None / Normal / High | 本次为 Normal |
| 材料 | 可交易 Yes/No；特殊卡 None/All/Selected；评分范围；单卡最大价格 | 本次初始可交易 Yes、特殊 None、47–96、最大价格 Any；不能当作 EA 原生要求或永恒默认值 |
| 完成次数 | 数字/快捷次数，受重复次数和订阅能力约束 | 83+ 本次只允许 1 次，界面隐藏次数行 |
| 全局设置 | 通用金币/积分偏好、Storage/特殊、Evolution、Active Squad、锁卡、排除国籍/联赛/俱乐部 | 当前 SBC 的三态 Streamlined 偏好与全局传统金币/积分偏好不是同一字段 |
| 设置持久化 | Save/Update settings；当前 SBC / 全局 | 本次只改临时选项，未保存 |

## 3. 同账号五种真实预览

所有行待购卡为 0，新增购买花费为 0；金币列是 Fodder 对**消耗材料**的估值。

| 场景 | 材料/批次 | 积分 | 后端 totalCost | 窗口显示 | 结果 |
| --- | --- | --- | --- | --- | --- |
| Lowest coins，初始范围 | 3 张 84＋1 张 64，1 批 | 2510 | 2400 | 2.4k | 达标，超额 10 |
| Balanced | 85＋83，1 批 | 2510 | 2830 | 2.9k | 用更少卡，材料估值较高 |
| Fewest cards | 1 张 86，1 批 | 4100 | 3960 | 4.4k | 卡最少，但超额 1600 |
| 最高 64、Lowest coins | 20 张铜卡，1 批 | 400 | 4500 | 4.5k | Partial，仍差 2100 |
| 最高 74、Lowest coins | 80 张，30＋30＋20 | 1050＋1050＋400＝2500 | 47100 | 47.1k | 一次完成目标，分三次贡献 |

后四次从点击 Solve 到求解响应分别约 5.3s / 0.5s / 5.9s / 2.2s（含当次前置读取，首次完整冷读取未计时），不是后端算法纯耗时，也不是 FCAT 的性能保证。

重要解释：

- “Lowest coins”不等于“最低待购金额”；只用自有卡仍显示估值。不能把 2.4k 告诉用户成“需要再花 2400”。
- Bronze/Silver 比较低分，不等于每积分更便宜。该账号样本中，3 张 84＋铜卡的材料估值远低于 80 张铜银卡。不能擅自把所有 Streamlined 都限制为铜银卡；用户显式材料保护仍优先。
- 同一预览后端估价与前端缓存报价存在差别：Balanced 的两张界面价为 2200＋700，而后端为 2830；Fewest 为界面 4400 / 后端 3960。源码 `ng()` 不覆盖已有报价缓存，`Nr()` 又按前端逐卡报价汇总，证据支持两套报价快照可能不一致；没有证据断言哪一份更接近成交价。FCAT 必须使用同一冻结报价快照生成、展示和制定购买上限。
- Fodder 后端 `prices[].pts` 提供预览积分，客户端 `itemPoints` 缓存用于展示；本次与原生 `sbsScore` 交集 86 张，0 个差异。样本普通卡 83/84/85/86 对应 410/830/2100/4100；不是所有稀有度的完整积分规则，FCAT 使用当前 EA 实体分值，不靠售价或评分猜分。

## 4. 调用链及不能直接推断的内容

公开浏览器发布包可读，服务端求解器仍不可见。下面是本次样本函数名，升级后可能改变：

`GF → Ui → fL → aO → oO → /api/solve-streamlined → Nr → iO`

- `rO` 读取原始 eligibility kvPairs，通过原生 `UTEvolutionEligibilityVO.meetsRequirements` 按 AND/OR 检查；不支持的规则明确停止。只有可序列化的规则子集用于市场候选。
- `Fe` 维护 Club 快照，合并 Storage/Unassigned、去重，查询数量变化并监听增删更新。`Cu` 过滤借用/概念/交易列表/活跃阵容等，再转换候选。当前全量 Club 快照 483 张，不等于每次重新拉 483 张。
- 重复 Unassigned 与主卡的处理不是把 signal 当提交实体；候选按来源与真实身份映射。`allowCopies:true` 不表示同一个 item ID 可以重复消费。
- `oO` 请求包含剩余目标、完整下一轮目标、候选池、filters、platform、perSubmit、times、prefer、allowPartial、allowCopies。客户端发送实体与卡片属性；FCAT 独立规划器不应依赖此上传。
- `nO` 读取 EA setting，非正值回退 30；本次原生 ViewModel 也返回 30，仅证实该场景一致。
- `Nr` 将缺卡映射为计划占位，购买后替换为真实 item。整套预览/买卡复用通用窗口；逐卡换人按钮依赖传统 solveCtx，不能看到通用组件就声称 Streamlined 支持任意换人重算。
- `iO` 串行调用 `initiateOneClickChallenge`（如未开始）、处理已购 Unassigned 移入 Club，再 `submitOneClickChallenge(challenge,set,itemIds)`。按完成响应更新数量并判断 Set 完成。
- 同一次 `aO` 将规划好的批次串行执行，并非每批都重新调用求解器；新一次 Solve 才按当前已提交积分计算剩余值。之前计划中“每批一定重新求解”的概括应收窄。
- 通用 `Oo/Vk` 对限流退避，对 401/timeout 有有限重试；Partial 结束 UI 在模型未更新时可用预计积分补显示。FCAT 的未知写回执规则禁止不对账重试或把推算当服务器成功，此处必须列为差异，而非宣称完整相同行为。

没有研究其私有后端实现、没有绕过 Gold、没有实际提交，因此无法证明：全局最优性、balanced 权重、真实批次上限、所有 pile 可提交、跨刷新恢复、超额结转、奖励到账、多轮自动提交成功率或失败重试的安全性。

## 5. 合并参考结论

| 能力 | EA 原生 | Futto 实测/源码 | Fodder 实测/源码 | FCAT 建议 |
| --- | --- | --- | --- | --- |
| 页面操作 | 原生积分工作区 | 原位置保护按钮/报价 | 原位置 Solve → 设置 → 批次预览 | 以 Fodder 为主交互基线，不跳 Tools |
| 选材 | 当前页顺序自动选 | 在原生选卡上拦截贵重材料 | 全库存服务端规划，三种目标 | 本地有界规划；默认成本含义实施前确认 |
| 保护 | EA 资格条件 | 阵中卡、无价格、同评分价格比≥2 | 全局与单 SBC 过滤/保护 | 保留 FSU/FCAT 既有授权设置，不替换为第三方宽松默认 |
| 积分 | sbsScore / 当前 Challenge | 沿原生选择积分 | 后端 points，样本与 EA 一致 | 当前 EA 数据作权威，概念版本分值须可验证 |
| 多批/部分 | 原生逐批 | 未证实新增规划 | 30＋30＋20 与 Partial 已展示 | 同目标分批纳入首版；重复完成循环后置 |
| 缺卡 | 原生库存选择 | 未证实此积分页补卡 | Gold 市场求解＋购买再贡献代码 | 后续接现有公共报价/批量购买；保持缺卡与已拥有分离 |
| 报价 | EA 参考字段 | 私有价、EA 均价回退 | 私有后台价/前端缓存 | FUT.GG/FUTBIN/Both，冻结统一快照，沿用账户设置 |
| 提交/恢复 | 原生事务 | 本轮未提交 | 有串行提交链，真实副作用未测 | 新 Streamlined Journal，精确实体对账，不复用传统 squad save |

Enhancer 仍只有旧样本，不把“未找到”写成最新版不支持。该缺口不阻止使用已实测 Fodder/Futto 规划。

## 6. 恢复与未完成项

本轮只修改研究脚本与文档。临时评分/偏好修改未保存；没有点击 Submit/Auto Buy。结束已关闭 Fodder、按本次 `fodder-plugin-state-before.json` 恢复 FCAT/FSU 开关、保持 Futto 关闭，并将 EA 页面导航到空白卸载 Hook；结果为 `fodder-plugin-state-restored.json`。市场按钮额外点击探测未成功，未取得 Gold 购买窗口；Gold 锁定结论来自已保存的按钮属性与源码分支，不把超时当作服务器拒绝或付费流程实测。

未完成项：真实市场求解/购买被当前订阅能力限制；真实贡献/奖励不在本次授权内；Enhancer 最新版、EA 干净运行时及服务端回执继续待采集。不得伪造后端结果来冒充付费功能实测。下一步按 [综合实施计划](FC27_STREAMLINED_SBC_PLAN_ZH.md) 确认产品差异后落地 S0–S2，再串接单目标完整贡献。
