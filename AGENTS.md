# FC Automation Tool AI Agent Engineering Guide

2026-10-26 Puzzle 27.0.62：.61 新日志仍无方案，gold覆盖生效但普通第三页仍是silver+league19。只读缓存确认当前6开放槽为GK/RB/CB/CB/LB/ST、最高85；匿名9安全材料与实际公共目录回放复现原三页完整验算0。普通有安全库存的混合品质化学分支，在必需品质查询后用跨品质国籍+开放位置最大匹配排序剩余页，查询需求最多品质；没有可靠联系仍旧联赛回退。原身份/俱乐部上限/repair、FSU/锁卡/主阵容、品质配比、价格授权/预算、三页/50k、写事务与Journal不变；不得硬编码国家/球员或将查询锚点强制入阵。Session在合成报价下五金一银/化学16，原始报价未捕获，不宣称精确重放8591节点/已买/已提交/全市场最优。见 docs/FC27_PUZZLE_CHEMISTRY_AFFINITY_ZH.md。

2026-10-26 Puzzle 27.0.61：.58 现场 Set 73/Challenge 113 三页均 silver（普通/联赛19/13），9安全库存、54可用公共版本、4155组合节点且摆阵/验算0；截图确认六人/五金/最低银/化学16及联赛最多5、同俱乐部至少2、国家最多4。普通缺料 route 原只按品质数量缺口查询，再用亲和页填满；数量足不证明现有卡能满足其它约束。仅此普通分支先保留缺少品质，再覆盖其余明确必需品质，最后用剩余页做亲和查询；保留专用身份/俱乐部上限/repair分支。合成双向 Session 先失败后通过：缺银但旧金卡国籍组合不适配、缺金但旧银卡联赛不适配；不冒称实际账号逐卡根因。六人配比仍五金一银，锁卡/主阵容/个人上限、材料总价值/价格授权、三页/50k、所有写事务/Journal不变，不清缓存或历史，不做游标持久化。基于 ad 27.0.60 同步后实现，Streamlined外部选择/过期未售出卡不改。见 docs/FC27_PUZZLE_QUALITY_COVERAGE_ZH.md，真实市场待升级验收。

2026-10-24 Streamlined 27.0.60：.59 用户截图反馈入口独占行及未售出 Transfer 禁选。匿名 EA 11414 公开源码核对原生 tabs/menu-container/ea-filter-bar-item-view，入口现直接放同一栏并保留原生 Club/Storage 状态；原生菜单重建后重挂，不新增行或注册伪 tab。共享 Club 快照仅认可 inactive/free，Streamlined Transfer 单独认可 EXPIRED＋本人拥有＋currentBid=0＋free；相同投影在移入前复核，active/closed/未知/有出价或缺字段仍挡。普通 Puzzle/Gallery 共享快照不变，FSU Only Untradeable/锁卡/主阵容、材料顺序和 Journal 不变；开启仅不可交易时可交易卡仍不可选。先失败复现，再读取/选卡/移卡与生产贡献贯通、离线 Chrome 验证，真实账号截图对应字段/移动贡献待更新验收；不把公开源码与合成回归冒称现场逐字段根因。见 docs/FC27_STREAMLINED_EXTERNAL_SELECTION_ZH.md。

2026-10-24 Streamlined 27.0.59：新增合并 Transfer / Unassigned 入口，保留 EA 原生 Club/SBC Storage。只展示当前缓存，选择/预览不查价、不买、不移动或贡献；冻结所选精确实体及 Club 同版本前置，复用原 splitter、materializer、execution/Journal。先独立确认 Club 消耗，再逐批移入外部副本；达标即停，恢复跳过 confirmed。前置被保护/预留、重复提示未核实、交易状态不明时不可选；准备前重读上下文/政策/材料和预留。完整顺序执行不允许单独跳过前置，不新增写 Adapter/Journal schema，不清历史；FSU/Only Untradeable/锁卡/主阵容、预算和未知回执保护不变。合成生产贯通及离线 Chrome 覆盖选择、顺序、停止/恢复和读回失败，真实账号入口位置、移卡贡献与恢复待升级验收；证据见 docs/FC27_STREAMLINED_EXTERNAL_SELECTION_ZH.md。

2026-10-24 Puzzle 27.0.58：.57 现场 Set 59/Challenge 99 的三页都是铜卡，可用公共候选24、50k节点停住；补充截图确认整队至少75分/化学26、4联赛、同俱乐部最多4、指定两俱乐部至少2人，无品质限制。generic 查询原按低品质排序，两条身份锚点和补位占满三页，漏掉评分所需品质。只调整补卡只读查询排序：在明确品质/数量优先与个人上限内，优先覆盖可达整队最低/精确评分的品质；不把整队评分变为单卡下限，不删低品质混搭或安全库存。旧路由在同形合成 Session 中失败，新路由完整规则/评分/化学验算通过；不声称实机可买或全市场最优。FSU/锁卡/主阵容、材料总价值目标、限价/预算、三页/50k与所有交易/恢复合同不变，不清缓存/Journal，不新增持久化搜索游标；重复点击仍本地重新求解。证据及验收见 docs/FC27_PUZZLE_RATING_ROUTE_ZH.md，真实账号待升级后验收。

2026-10-23 Gallery 27.0.57：成功挂牌后的回读、显式恢复和旧批次核对共用 listing-readback；暂时不可见/读异常最多三次只读刷新，退避 1/2 秒，不调用 list/move/permit。closed 仅在精确物品/definition/pile、冻结价格、有效拍卖 ID 及持久化成功 2xx 挂牌回执同时成立时确认已挂牌，不宣称售出/销售收入；无回执的 closed/缺失/冲突仍保留 unknown，不重发。保留限流/会话停止和原挂牌节奏/定价/锁/存储。增加固定 mismatch/次数/HTTP 诊断和可见只读核对进度，不暴露身份。原日志缺少具体匹配字段，两条缺陷已独立失败复现，不声称唯一账号根因。计划与验收见 docs/FC27_GALLERY_LISTING_READBACK_ZH.md，真实旧记录恢复待升级后验收。

2026-10-23 Storage 27.0.56：Streamlined Journal 的完整活跃/history/retired 对象无损 gzip，所有调用通过原 Journal 读取边界解码；不删除/过期任何交易记录，不更改 pending/unknown、预算、选材或恢复语义。启动迁移复用 fca-fc27-traditional-sbc-v1 Web Lock，锁忙/不支持时延后，写前比较/写后复读。Gallery score/mapping 每键 2 MiB UTF-8、合计 8 键/8 MiB，仅淘汰可重算检查点；collection/曾拥有/首任、锁卡、设置、凭证全部排除。公开快照 gzip 阈值 32 KiB。私有备份副本 58.55→16.64 MiB，59 变更值逐字段还原、10429 值字节不变；不是精确 Chrome 消息测量。更新后其他 EA 标签也应刷新；不回退到不识别压缩格式的旧脚本。计划/验收见 docs/FC27_STORAGE_MAINTENANCE_ZH.md，实机升级验收待执行。

2026-10-22 Puzzle 27.0.55：.54 新日志在 Set 65/Challenge 105 报 SAFE_MATERIAL_SHORTAGE（初筛0），两页共40公共版本后1195组合节点无方案，未耗尽预算、未保存/购买；原日志未导出库存排除原因，不能断言全库为空或全被主阵容保护。纯测试复现空安全库存时只生成金/银两页；现以安全公共候选的联赛支持，使用原三页上限的第三页补互补品质，不重新纳入受保护库存。增加缓存库存数、排除总数与固定原因计数，不导出物品身份。Sam 同次明确要求优化整体方案成本：Puzzle 的新规划按库存卡公共估值＋新增购卡支出比较，现金支出仍独立；纯库存可行解先作20k节点有界价值细化，再以原采购预算比较更低总价值混合路线，读失败/无更优仍保留原可行解，不动已保存/未决记录。新报价只估值、不是采购授权；限价/预算/精确回执/保护均保留。最多估值250个安全版本（优先原方案），未知价不补0，现有可行阵容的估值缺失时保留并提示；混合路径估值不完整时明确退回新增支出目标以保留可行性。范围/节点有限，不宣称全市场最优；合成12000→2200只说明离线优化能力。真实账号待更新验证。

2026-10-22 Puzzle 27.0.54：另一账号的 Set 65/Challenge 105 截图显示主阵容 LB 被选入解题；.53 Puzzle 政策原为 protectFsuLockedPlayers/protectActiveSquad=false，Club 快照对应单卡字段又是 null。Puzzle 现复用 Streamlined 的已核验 FSU item-ID 锁卡及当前 EA 主阵容全 23 槽读取，规划、概念阵容保存、填阵事务读回均带精确名单复核；名单缺失、旧方案政策漂移时 fail closed。传统 Runner 的旧政策不改。保护读取抽成只读叶模块，维持浏览器 probe 的依赖白名单。补卡 UI 的 2850 等金额仅为新增购卡成本，不含库存卡市值；50k/20k 有界搜索及公共报价覆盖均不证明全市场最低，不能拿它与 Futnext 的全队市场价值直接同口径比较。未改求解目标、搜索上限、目录/报价或实际购买合同；既有已保存 SBC 阵容不会自动清空。离线验证见 27.0.54，真实账号待更新验收。

2026-10-22 Puzzle 27.0.53：.52 现场 Set 65/Challenge 105 仍是 123 安全候选、50,000 节点（组合45,748、完整组合上界4,252、站位/验算0），耗时约284秒；repair 三页缓存目录59版本/44可用，20,000 本地检查无方案。计数改变但未解，不证明实际安全池必有解。发现.52部分上界把池中未选卡也当作已选卡的身份组支持，且多个兼容位置高度重叠的卡按可同时得分估算；遍历又偏爱高频同组，可能耗尽节点。现按已选卡＋后缀可选卡的身份组人数给必要上界、对已选卡求最大位置匹配数，均只会高估真实化学；另将稀缺阵型位置作为非过滤排序提示，Storage和完整材料/EA验算保持。合成同形123卡/已知22化学阵容在旧策略下50,000节点未进入摆阵；新策略4,925节点完成完整验算。性质测试覆盖部分选卡、稀疏后缀和多位置；不扩大50,000/20,000上限或目录页，不改变FSU/锁卡/主阵容、价格/采购/保存/提交合同。离线验证见27.0.53，真实账号仍待更新验收。

2026-10-22 Puzzle 27.0.52：.51 实机同一 Set 65/Challenge 105 两次仍是 123 安全候选、50,000 节点、45,193 组合/4,807 完整组合上限、站位/验算 0，说明 .51 剪枝未改善现场，但日志未导出化学 profile，不能单凭此断言具体开关。发现部分组合剪枝要求所有 EA 化学 profile 均为普通模型；EA 已观察配置同时包含与普通卡无关的特殊卡 profile，因此会整体跳过剪枝。只对当前安全候选 rarity 实际解析到的 profile 按完整评估器同一规则检查；相关 profile 非普通或快照缺失仍跳过。普通卡/特殊 profile 并存的合成 123 卡同形回归先复现 50,000 节点阻断，修复后在上限内完成解题。安全候选、完整化学验算、50,000/20,000 上限、FSU/锁卡/主阵容、目录与交易合同不变；现场是否有解仍待更新验收。验证见 27.0.52。

2026-10-22 Puzzle 27.0.51：.50 现场 Set 65/Challenge 105 仍在 123 安全候选、50,000 节点停住；细分为组合 45,193、完整组合上限 4,807、站位/验算均 0，五次遍历仍未进完整验算。三页目录已包含新银卡页（20条）、合计59版本/44可用，repair 累计20,000检查无方案；不能宣称现场安全池必有解。合成123卡、同形规则、已知合规22化学阵容复现旧算法43,451组合节点/6,549完整组合上限、站位0并达上限；加入普通化学模型的必要上界，在部分组合阶段用全安全池身份组上限＋选定卡独占槽位＋剩余卡按槽的乐观上限提前剪枝。该上界只可能高估，不筛掉卡；普通模型未获验证就跳过新剪枝。合成同形回归在上限内找出完整验算阵容；纯函数性质测试验证各部分深度上界不低于完整真实化学。FSU/锁卡/主阵容、EA完整规则与化学验算、节点/目录预算、买卡/保存/提交合同均不变。离线验证见27.0.51；真实账号待更新验收。

2026-10-22 Puzzle 27.0.50：Set 65/Challenge 105 的 .49 现场再次耗尽 50,000 库存搜索节点（123 安全候选，80.6 秒）；repair 补卡仅复用三页金卡目录（59 版本/44 可用），20,000 检查仍无方案。这证明旧搜索未成功，不证明现场有合规安全解或银卡必能解。合成 5 银/6 金、化学差 1 的近解证明一张同联赛适配位置银卡可完成，但旧三页均选多数金卡，漏掉银卡。保持三页上限，预留一页给最低化学的次要品质与其联赛；无有效次要查询则仍用三页原品质。库存搜索诊断修复嵌套 plan.search 读取并导出阶段计数/策略尝试，供下一次现场判断瓶颈。完整规则、FSU/锁卡/主阵容、报价/预算、买卡/保存/提交/回执合同不变。真实账号待更新验收，验证见27.0.50。

2026-10-22 Puzzle 27.0.49：Set 65/Challenge 105 的 .48 诊断显示 123 安全候选耗尽 50,000 节点，三页金卡目录后补卡搜索亦未成；未导出实际安全卡池，不认定现场必有解。截图确认同联赛最多4、同国家至少3、至少3联赛、最低银、至少6金、化学22。合成123卡/已知合规阵容复现旧搜索耗尽；有化学下限时把适配阵型位置的候选提前遍历，仍保留非本位置卡、Storage/必需组优先和完整EA规则/化学验证。节点、目录页、FSU/锁卡/主阵容、报价/预算、买卡/保存/提交合同不变。真实账号待更新验收；公开解法只证明全市场可行，不证明本地安全卡池可行。验证见27.0.49。

2026-10-20 Streamlined 27.0.48：.47 现场41,000分纯库存方案141张/5批，前四批已独立确认37,020分；最后21张在贡献前被FRESH_ENTITY_UNVERIFIED挡住，日志未包含字段级冲突，不能断言单一现场原因。合成生产贯通复现 Club 定向查询额外返回非选中卡版本/非Club pile 时被全行pile检查误拦；确认后的精确实体读回也有同类误拦。仅选中实体必须符合冻结pile/定义/保护；额外行仍校验ID、定义和factory一致性，不用于替代选材。读回仍要求每张已贡献精确ID不存在、回执和独立积分成立；选中实体仍在任何pile均挡。仅导出固定计数诊断。Viva的5x80+ FSU_NOT_READY 截图只能证明FSU当前赛季/初始化/库存缓存三项之一未就绪，增加中文操作提示，不放宽FSU门禁；具体原因待诊断JSON。完整单测420文件/5,021通过（39跳过），离线浏览器证据见27.0.48；真实账号待更新验收。不改FSU、Gallery、普通Puzzle、采购预算/限价或已确认批次恢复。

2026-10-20 Streamlined 27.0.47：.46现场纯库存128张/5批最终115,000分完成，中间下一批鲜读进度426/512/512，人工恢复后继续；没有再次授权到期，旧9/24已结清且忽略。仅已审查进度GET增加这两个现场可恢复码的3/6秒退避，最多3次共用原15秒截止；其它瞬时码保留1.5/3秒，认证/429/未知native码/坏元数据/方法或账号漂移仍挡，不作全局错误码解释。Provider在已确认批次后冷却3秒再鲜读，结合当前root内存及durable confirmed updatedAt，不延长15秒材料lease。等待轮询只查本地上下文/Stop，不发请求；跨Provider恢复仍守冷却，confirmed批次跳过。采购Stop显式传到内层事务，提交前waiting-only正证据才清外层意图；已dispatch不取消核对，confirmed后外层只收尾一次，未知/回执失败保留。新等待/退避倒计时与固定脱敏诊断，保留30分钟授权/预算/单卡限价/报价与.45全部保护，不修改Gallery/普通Puzzle/FSU。定向267项，完整与Chrome见27.0.47；真实账号待更新验收。

2026-10-20 Streamlined 27.0.46：.45实机在110,950/115,000分触发10分钟PURCHASE_APPROVAL_EXPIRED，恢复后完成115,000分，花费58,400/61,180，待核对与未处理采购均0。按用户明确要求，仅将采购执行默认授权延长到固定30分钟。预算、单卡限价、报价有效期、请求超时、短期显式expiresAt、未知回执保护和恢复语义不变，不因搜索或成交自动续期。生产执行/采购组合时钟测试覆盖11分钟、30分钟前后、搜索跨过期限、短授权、超价拒绝及剩余预算降cap，保留.45全部修复。验证见27.0.46，真实账号新时限待更新验收。

2026-10-20 Streamlined 27.0.45：.44现场报价及115,000分方案成功，但新采购被9/24、1,250分旧记录拦截；.42–.44纯库存隔离不解决新市场采购。增加独立可信点击“退出并归档旧任务”：仅另一目标、无buy/move pending，完整验证旧范围；若内层pending/unknown存在，只允许精确冻结批次匹配的旧贡献一同保留归档，其它当前未知仍挡。共享锁内复查完整外层/内层快照，先保存完整历史再写独立retired索引并回读；原记录不伪造成功、不改spent/consumed/receipt，不触发EA请求。精确匹配的已归档内层不再作为活动Journal；新可信执行才按原revision增写，未知证据仍在索引完整保留。原目标未知贡献仍挡，新目标独立预算；旧ready/已购/贡献实体在规划排除、Journal保存、采购前及native贡献dispatch复核，同definition其它实体不误锁。索引坏数据/归档失败/状态变化不绕过；上限50不自动删证据。保留.42–.44、锁卡/主阵容/FSU、预算与全部普通Puzzle/Gallery逻辑，真实账号待更新验收。验证见27.0.45。

2026-10-18 Streamlined 27.0.44：.43实机4库存/1,250分响应、回执、独立读回均确认完成；之后新轮INITIATION_UNVERIFIED、恢复CONTEXT_CHANGED及preflight PURCHASE_CONTRIBUTION_RECOVERY_REQUIRED。不把上一轮成功当失败，也不凭日志推断50,000分任务完成。生产贯通复现同一可重复SBC编号下，历史采购marker与新库存批次冻结指纹/实体不同却强制收尾，以及同编号漏旧预留复核。收尾仅认完整绑定的batchPlan＋精确实体；不同指纹且全保留范围与已完成库存批次不重叠则不触碰旧marker，新可信库存执行仍校验旧预留并在native dispatch再查。同编号历史可只读隔离恢复，真实匹配采购仍走原恢复；坏范围、重叠/未知请求不清、不猜成功。完整已确认完成回执可显示上一轮完成，页面归零不作当前轮成功/新轮启动授权；NOT_STARTED仍须EA原生进入，不增init/buy/move/claim能力。增加固定重叠诊断，不输出实体/账号。定向225项通过；最终完整/Chrome证据见27.0.44，实机新轮待更新验收。

2026-10-17 Streamlined 27.0.43：现场.42已多次验证历史9/24隔离成功，当前60/100仍确认11,680/50,000；之后旧方案校验POLICY_CHANGED，新方案preflight RECOVERY_REQUIRED。日志未导出变化字段，不断言是哪项设置。生产贯通复现无关锁卡/主阵容名单变化被完整policy相等误判，以及部分confirmed＋waiting无法重新规划的死循环。保护名单改为live证据，不再因无关实体变化拒绝整份旧方案；真实选材设置变化仍拦，当前锁卡/主阵容实体仍在校验与dispatch前拒绝。新可信执行仅可从相同账号/目标/已确认积分替换纯Club/Storage等待余批：已确认回执完整、无pending/unknown/progressChanged/采购回执/外部移动，且新材料不含已确认消耗实体；先在共享锁内完整归档旧Journal并回读成功，再写新计划，正常独立进度/材料校验后才发贡献。旧采购历史和.42保护/隔离保留，未知请求或缺证据不清、不重发，不改Gallery/Puzzle/FSU或旧预算；真实账号待更新验收。验证见27.0.43说明。

2026-10-17 Streamlined 27.0.42：Sam明确没有同时做另一SBC；9/24是本地历史未收尾标记，不是正在运行的证据，也未证明旧请求成功/失败。修正.41把旧标记当全局锁的过严恢复：共享锁内核验当前原贡献Journal，仅无采购/回执/外部移动的Club/Storage剩余批次，且精确实体ID与旧任务保留材料及贡献范围完全不重叠时恢复。旧contribution.batchPlan与material须完整绑定；同一实体、坏范围、当前未决或缺记录仍停止。材料校验和native dispatch回调再次读取核验，恢复本身不发EA写请求，新可信点击才继续原未完成批次，confirmed跳过。旧采购Journal原样保留，不算结清、不重买/重跑，不更改schema/预算或旧授权；界面明确历史记录及可继续状态，普通Puzzle解题目标、Gallery/FSU与全部材料保护不变，实机验收待更新。

同轮补查生命周期：普通Puzzle清空当前页后的释放索引会被保留的terminal concept draft在兄弟Challenge迁移时重新填回；改用既有schema的空itemRefs条目持久标记已释放，新确认保存正常替换，不删除终态证据或放松pending save/服务端baseline。积分采购在内层已确认、外层未收尾时切换新Journal会丢旧证明；新替换钩子在原共享锁内仅用精确内层已确认回执结清外层，明确未发送/拒绝才清意图。未知/缺回执/范围变化/写入失败仍保留并阻止覆盖；不为已丢证明的历史记录补造成功。定向235项、完整verify 420文件/4918项（39跳过）及全部离线Chrome通过，已视觉核对历史隔离恢复提示。普通Puzzle只改预留释放生命周期，原解题与全部保护不改。

2026-10-17 Streamlined 27.0.41：.40现场新方案34库存/2批补38,320分，原11,680分已确认；执行在preflight因旧贡献Journal阻止，恢复两次被其他目标采购抢先返回。旧诊断未导出对方目标/状态，不认定它实际已结清。外目标采购改用既有needsRecovery而非completed布尔判定：无贡献在途且仅waiting/rejected/consumed的历史原样保留、不挡当前贡献恢复；buy/move/contribution未知及已购未处理仍拦截，completed也不豁免。真实外目标阻挡时只读恢复当前贡献供显示分数，不创建可执行preview、不授权重买/移动/投入；固定目标/待核对数量补中文与脱敏诊断。恢复原冻结计划跳过confirmed批次，新点击才复核剩余材料，不清Journal、不把部分执行计划自动替换成新计划。保留.36-.40、全部材料/预算保护，实际账号验收待更新。

2026-10-17 Streamlined 27.0.40：现场 .35 日志首批30张已独立读回确认11,680/50,000分，第二批发送前进度GET失败；旧日志无HTTP/native状态，不认定具体网络/限流/服务器原因，也不是完成归零失败。仅该已审查GET对明确瞬时状态有限重试：最多3次、1.5/3秒退避、共用15秒截止；认证/429/未知业务码/304/坏响应/上下文或方法变化仍停止，不重发任何写请求。后续发送前读取失败返回最后已确认Journal供界面显示，完成批次禁用、恢复跳过；不清空旧记录或猜测本批成功。补固定HTTP/native码和次数脱敏诊断，保留.36-.39普通Puzzle修复、材料保护/库存优先/预算/未知回执和全部原事务合同。离线回归不代替真实账号验收，证据见27.0.40说明。

2026-10-16 Puzzle 27.0.36：截图确认 Set 45/Challenge 79 为俱乐部 OR 最少一人、最多四俱乐部、至少三银、最低铜及化学14；旧日志仅证明17库存与28可用目录候选无方案，未导出实际查询，不能声称已还原现场三页。已用同形条件/合成材料复现两页查询同一 OR 条件、仅余一页填充导致结构剪枝。限定混合品质＋俱乐部上限＋指定俱乐部的 shortage 路由：先一个未满足身份查询，已有安全匹配则跳过，空页/缺价可在剩余页内换 OR 俱乐部，再按同一密集俱乐部覆盖主要/次要品质。每轮仍三页、每页20，累计50000节点；只复用原缓存，不清交易记录。新增公开查询筛选/数量与库存缺口脱敏日志，无原始库存/账号/回执。8铜3银来自既定材料策略，不放宽品质/保护、不改报价和买卡/保存/提交合同；合成采购/概念规划不等于真实账号填阵验收。当前验证与恢复点见 Puzzle 稳定性记录和27.0.36说明。

2026-10-16 Streamlined 27.0.35：Viva .34 日志执行方案为 4 张库存（3×83=1230 分+63 铜=20 分，含两张 Storage），市场数量 0；200 是铜卡参考价，不是本次买断证据。响应/持久回执通过后卡在 CYCLE_RESET_UNVERIFIED，现场没有具体计数值，不能宣称已确定是缺失还是未递增。新增完成归零证明：精确匹配且达到目标的完成回执 + 独立完整库存读回确认原实体消耗 + 同 SBC/规则的新鲜已完成或已知可重复的归零状态；子 Challenge 计数未变/缺失不再作为唯一否定条件。原有 +1 证明保留，已知回退/跳增、坏计数、部分/未知回执、目标变化和卡仍存在仍停止。不猜 +1，不启动下一轮，不领取奖励，不改旧 Journal schema/计划；无页面的旧记录可只读恢复。原生 factory/枚举/归零方法匿名核对并用公开源码 fixture 重放；交易诊断补固定证明类别/冲突类型和非负计数，不导出账号/实体/原始响应。普通 Puzzle/Gallery/FSU、选材、预算、买断与材料保护不改，真实账号验收待更新。

2026-10-15 Streamlined 27.0.34：用户确认 .33 SBC 实际完成；诊断响应/回执/独立读回均成功，仅本地收尾 SET_CHANGED。公开 EA Set factory 每次用剩余秒数与本地四舍五入时钟重建到期时间，已重放一秒漂移导致的同码误拦截；现场旧日志没有字段级证据，不把这一复现当作唯一根因。完成后的 hub 同步只复制权威计数，不比较正数到期时间逐秒相等，也不复制或延长冻结到期授权；真实重复规则变化、缺失/坏计数及到期类型变化仍拦截并用固定码区分。已通过独立读回而仅收尾失败时，单独展示“贡献已确认/SBC 已完成，仅本地同步待完成”；贡献/采购 Journal 仍保留未知收尾状态并阻止下批，不把显示信息用于结清/重买/重复贡献。采购桥接、恢复与 UI 一并回归，未知回执/读回失败绝不显示成功，FSU/材料保护/预算/选材和 ad 原主逻辑不改。

2026-10-15 Streamlined 27.0.33：27.0.32 现场在含 Storage 的贡献前校验报 METHOD_UNREVIEWED，未提供具体方法指纹；匿名 EA 当前原生代码可独立复现 Storage search/query 两个旧指纹不匹配，共享请求、进度、贡献方法核对不变。新增仅 Storage 只读 Adapter 使用的精确兼容 hash，保留旧实现及未知替换拦截，不放宽共享写事务许可。公开源码 fixture 用真实 SHA256 和合成依赖重放 GET storagepile/skuMode、缓存 304/本地过滤；生产贯通覆盖混合库存校验、贡献、读回与恢复。失败诊断补传固定方法路径/观测及预期 hash，不导出源码、账号、物品/成交或凭据。保留 27.0.32 Storage → Club → 缺口补卡默认和全部材料保护/预算/Journal；未操作真实账号，实际贡献仍待用户更新验收。

2026-10-15 Streamlined 27.0.32：Sam 明确要求积分 SBC 参照普通 SBC 的库存消耗逻辑，覆盖此前最低总材料价值默认。新规划默认 `inventory-first`：合规 Storage → Club → 显式启用的外部库存 → 仅对剩余积分补卡；每层不足时冻结该层材料，已足够则不再读市场目录或库存报价。库存估值未查保持 null/未知，不冒称零价值，也不因缺估值排除合规现有实体。原最低总价值/最低购卡额/最少张数仍可显式选择；schema 1/2 旧默认仅在读取新设置时映射，新保存 schema 3 可保留显式经济目标，旧冻结 plan/Journal/已购待核对记录不改写。保留 Only Untradeable、评分/特殊/进化/锁卡/主阵容、精确身份、预算与未知回执保护；普通 Puzzle/Gallery、FSU 和交易 Adapter 不改动，不在真实账号购买/移卡/贡献代替验收。

2026-10-15 Streamlined 27.0.31：修复贡献诊断原因丢失，不宣称 27.0.30 的实际贡献卡住已修好。分别保留校验、发送异常、规范化响应/HTTP、回执、读回、本地收尾与恢复的固定阶段/错误码；失败记录进入原有 40 条事务摘要，避免报价/重新规划冲掉证据。不输出原始响应、物品/成交/账号身份或自由异常文本，诊断抛错/拒绝必须隔离。不改 Journal、请求/重试/恢复决策、锁卡/主阵容、预算与最低材料成本；同版本单批限一张、确认消耗后跨批复购的规则保留。旧未决记录不清空、不猜成功、不重发；更新后由用户核对恢复并导出新诊断定位底层失败。

2026-10-15 公共报价 27.0.30：用户批准 FUTBIN 批量数据为默认公共基准，仅未保存设置的账号默认 FUTBIN/PS；已有选源、禁用来源与冻结审批/Journal 不改写。公共用途共用原评分分页/精确版本缓存，同评分至少 12 个冷版本才扫描最多 8 页，小批仅复用有效整页缓存，缺失或空价按原同源单卡补查。Both 先读选定参考源，不缺价换源、不补零/续时间。FUT.GG overview 仍为调查而非生产 Provider；不改 EA 执行平台、交易节奏、保护或授权，不以模拟提速宣称真实账号完成。

2026-10-14 Streamlined 27.0.28：用户首次提供完整实机闭环，27.0.27 最后纯补卡路线库存选材 0，7 次买断/入库，积分 34,000，花费 23,200 / 批准 26,565，随后恢复也完成；这证明该次闭环，不证明奖励已领取、全市场最优或所有环境稳定。协作规划默认优先 scheduler.yield，再用自己创建并关闭的 MessageChannel，缺少 API 才沿用 timer；不得改交易节奏、搜索/报价/10 分钟期限或用保活规避浏览器冻结。新增计算/调度等待计时、实际初始/目标/计划分数和已确认批次/未决请求/未消耗购卡计数；缺字段保持未知，诊断失败不能改变规划，禁止导出原始库存/成交身份。现场低 nodes 的时间上限尚不能单凭日志判定后台节流；用新字段确认。完成旧目标到新目标的独立审批/归档回归保留，FSU、原解题目标、锁卡/进化/主阵容与未知回执保护不变。

2026-10-14 Streamlined 27.0.27：用户新诊断在预算尚余 28,950 时停于 PURCHASE_OFFER_CHANGED。已复现跨批已结清挂牌再次被选择的同码路径；原生选单增加仅 Streamlined opt-in 的排除回调，只排除 Journal 中同版本、同 item ID、同 trade ID 且 rejected/consumed 的完整匹配。不得把部分身份匹配、未知买断/移动/贡献或未结清实体当作普通缺货；不得再次付款。其他 Gallery/Puzzle 调用未启用该回调，原 FSU 价格步进、原生节奏/指纹、预算/单卡上限、库存范围和保护仍保留。诊断新增已过滤数量及固定 mismatch 原因，不输出实体/交易 ID；日志原本只有通用错误码，不能把离线复现声称为现场身份已经逐项确认。

2026-10-14 Sam 明确确认积分解题新方案默认预留 15% 替代总预算（覆盖本轮先前 10% 选择）。只在执行前展示建议额度，用户可编辑并经可信点击批准；不是目标花费、不提高单卡上限、不扩大库存物品/市场池许可。旧 Journal 预算不变；需要更改时生成新方案，新明确审批替换前先保留/归档已结清记录，未知回执仍核对。27.0.26 跳过本批已经没有可继续加入版本时的固定部分等待；等待不搜卡也不补材料，不能凭空耗尽授权时限。真实缺货有限重试、原生节奏、单次 10 分钟、报价刷新、容量、锁卡/进化/主阵容、精确回执和跨账户保护保留。诊断仅新增实际批准/剩余预算数字，禁止凭估算金额认定现场预算或全市场无货。

2026-10-14 Sam 最新语言要求：积分解题界面改回简体中文，覆盖下方 27.0.24 的英文界面要求；设置 key、错误码、原生球员/SBC 名称和交易合同不随翻译改变。27.0.25 修正新增采购池的 Club 持有核对：认证且由当前请求拥有的 `/club` 响应允许原生 factory 的缺失 pile/ANY 投影，仅按精确 definition ID 判断持有；额外版本过滤、不授权消耗，满页必须继续分页才能判断缺失，重复物品/矛盾 pile/未完成读取仍停止。每页显示进度，未产生未知写回执的读取失败可直接重试；已购实体仍绑定精确 item ID/版本/成交回执。最低材料成本、冻结池/预算、锁卡/主阵容、Gallery/Puzzle 与 FSU 原流程保留，真实账号闭环仍待更新后验证。

2026-10-14 Sam 对本项目明确建立默认发布方式：修改完成并验证、整体复查、同步审查 ad 最新 main 后，提交并推送 main，除非 Sam 特别说明不要。不自动创建 tag/GitHub Release，不操作真实账号购买、移动或献祭来代替验收。原生主体购买/计分逻辑与 Gallery/Puzzle 仍独立回归。

2026-10-14 Streamlined 27.0.24：默认目标仍为最低总材料价值，Sam 接受更多批次/等待，不改成最快完工。新一次授权覆盖目标、总预算、冻结市场候选池/单卡上限及所选库存物品 ID；同意后才允许池内最低成本重算。购得的廉价同版本先确认消耗再重复，不为填满批次自动溢价。普通缺货最多自动等待 15 秒重试两次，可直接继续，不要求恢复按钮；未知成交/移动/贡献仍核对、不重发。schema 2 采购 Journal 的运行候选/需求严格绑定 plan 范围；旧 schema 1 不扩池或改写。无未决交易的旧方案允许新明确授权替换，先归档原记录；已有未消耗成交或未知请求仍拦截。新池通过已有原生只读 Club 查询核对版本持有（每次至多 50 defId），不把部分/过期 Club 缓存视作持有证据、不凭持有自动消耗。部分报价覆盖告知合并到可信执行按钮，不新增勾选；直接 API 仍需明确 acknowledge。Points Solver 全英文，原 FSU、Gallery/Puzzle 原生交易 Adapter 和经济目标不变；实机验收 Pending。

2026-10-14 国际用户语言要求：Sam 对话继续用中文，产品面向用户的界面、按钮、设置、进度、警告和错误解释使用英文。当前先完整迁移 Streamlined Points Solver，保持设置 key、错误码、方案/Journal 指纹及交易规则不变；球员/SBC 原生名称不强制翻译。后续新功能默认英文，不以群内中文用户作为唯一目标用户。此语言改动不表示购买执行闭环已经修复或新版已发布。

2026-10-14 Streamlined 27.0.23：用户明确批准报价失败隔离与待确认部分报价方案。规划公共报价共用 90 秒截止时间（不是整次生成/执行时限）；到期返回已验证快照但不释放共享队列/同版本 pending。保留原批量/单卡路线、并发和来源熔断；局部截止不污染 provider cooldown。失败/缺失/过期卡排除，不换源、不补零、不续旧时间；有限覆盖明示不保证全局最低价，quoteLimited 冻结到指纹/Journal，重新选择/恢复需确认后再点击执行。目录/身份失败、禁用来源和上下文变化仍停止。锁卡/主阵容、买价上限/预算及采购/贡献/恢复主流程不变，Gallery/Puzzle 默认不使用新截止选项；真实账号验收 Pending，见 27.0.23 说明。

2026-10-14 Streamlined 27.0.22：现场 .21 日志将失败缩小到 protection-active-id/mismatch:number，但未导出实际编号。原检查误排除 EA 可用的 Squad ID 0，已用完整启用的 0 号阵容复现并修正；0 同时是 service 初始化默认值，不能仅凭数字 0 放行。须有同 Persona 原生实体、_id 匹配、_isActive===true 和完整卡位/物品核验；缺失/异常仍停止，绑定后的缓存复用仍只限同账号/阵容且 FSU 名单未变。锁卡、替补/预备和请求前保护不变；真实账号是否因此恢复仍待用户更新确认。

2026-10-14 Streamlined 27.0.21：用户打开主阵容后仍在规划前报 PROTECTION_UNVERIFIED，现有 JSON 缺字段级原因，真实失败点仍待新诊断确认。仅补固定阶段/类型/数量的脱敏证据与中文操作提示，不放宽保护、不改读取路径或新增 EA 调用，不把诊断增强称为实际运行修复。未知/缺失状态继续停止；不能将缓存缺失猜作本次已确认根因。

2026-10-14 Streamlined 27.0.20：用户单独批准启用 FSU 手动 Lock 与当前 EA 主阵容（首发/替补/预备）保护，覆盖此前该流程 false/false 的默认；不是所有历史保存阵容。名单未知或不完整停止，规划/材料核对/请求前复查；同账号/主阵容且 FSU 名单未变的已核验名单可跨本次原生缓存清除复用。旧 Journal 不改写，只有按当前保护重新核验才继续，其他政策不放宽。执行进度固定在按钮上方，库存消耗清单只读展示已选批次/冻结路线，不凭计时或计划积分宣称成交/贡献。Gallery/Puzzle、报价/优化/预算及 FSU 脚本保持原合同；真实账号验收仍 Pending，见 27.0.20 说明。

2026-10-12 Gallery 市场比价兼容修正：`FC27_MARKET_METHOD_10_CHANGED` 先用当前匿名公开原生源码复现，再独立审查查询、精确版本/价格过滤和原生 identification 请求/响应合同。Market-only 新指纹按精确方法登记，旧指纹保留，不传播到写事务许可；未知替换和运行中 binding 变化仍停止。方法失败诊断仅导出固定方法名和 SHA256，不包含源码、账号、header/challenge 值或凭据。此修复不改变 ad 原计分/选队/采购/挂牌或缓存压缩主逻辑，FSU 保持 26.09.10。匿名公开源码验证和离线回归不替代账号内实际比价验收；工程证据见 27.0.19 说明。

2026-10-09 Gallery 历史收集语义修正（覆盖旧“Unassigned 精确持有后才完成”的规则）：画廊记录曾经获得的精确卡版本，取得方式不限，售出或 SBC 消耗不撤销收集资格；实际分数仍只读 EA `isCollected/gradingScore`，不可用当前库存代替。Gallery 已确认买入与购后去向、计分同步分开：明确匹配的成交回执使 Unassigned 购买完成，不再查卡是否仍持有；Club 仍执行原入库路径。旧已确认 Club 买入实体确实不在两处可入库位置时，保留 `acquired` 历史并显示去向未确认，不假报 Club、不重买。未知成交/未知移动、歧义或不完整读取保持原恢复保护；计分 pending 不再作为已完成购买的全局 Pending。原计分公式、选队、价格、挂牌条件和其他购买/SBC 主流程不得顺手改变；共享 Adapter 的 absent 返回仅在 Gallery 对已确认成交显式 opt-in 时启用。设置只作用于新批次，原批次冻结去向不变。

2026-10-07 Gallery 交易风格与去向：用户要求 Enhancer/Fodder 两套独立 UI，Fodder 必须使用独立组件和限定选择器，不能通过修改原 Enhancer 组件/CSS 实现。默认 Enhancer + Club；Settings 的 Club/Unassigned 只影响新购买批次，恢复沿用已冻结去向。用户明确批准 Fodder 本批价格区间/尝试次数、Market/Bought for、累加价格调整与“仅发送 Transfer List”操作，公共报价选源、冻结购买上限及 EA 相邻价档继续有效。Unassigned 成交、当前持有位置和 EA 收集计分必须独立核对；只移入 Transfer List 不能发挂牌请求，普通挂牌按参考直接 Item.list。旧 Enhancer 行为须回归，真实交易仍由用户点击；实施证据及待验收项见 [Gallery 交易风格计划](docs/FC27_GALLERY_TRADE_STYLES_ZH.md)。

2026-10-05 专用浏览器最新构建约束：用户要求每次实机验收均安装当前工作区的最新生产构建，不得使用旧版本或中间构建。验收前核对当前源码构建、根目录/dist 产物和 Tampermonkey 已安装源码的版本及 SHA256（同版本改动也须重装），刷新后核对页面运行时版本；保存安装证据，再进行功能检查。`--with-extensions` 仅启用已有扩展，不表示已更新；旧更新演练、旧会话及版本号本身不能替代精确源码核对。当前自动安装入口为 `node scripts/browser-inspection/install-current.mjs`。

2026-10-05 设置与重挂界面精简：用户要求购买和挂牌共用一个价格参考；账号旧配置以购买 `source` 为准同步 `listingSource`，FUTBIN 更新选项移除，旧 `force` 不再导致新方案强制读取，有效缓存默认复用，显式刷新按钮保留。冻结方案/购买授权不改写，溢价仍仅用于购买。Gallery 自动重挂采用范围下拉（默认本批）、紧凑间隔和单个启动按钮；选择不触发任务，保留停止/恢复、两轮有限授权及原价重挂合同。本条覆盖下文独立挂牌基准和每次方案强制更新的历史约束。

2026-10-05 价格箭头统一授权：用户明确要求将挂牌与购买重试箭头统一为 EA 相邻合法价档，覆盖 Bulk List 起拍/BIN/单卡价格、Gallery/Puzzle 重试上限和 Settings 补卡单卡报价上限。此为对 Enhancer `stepper=250` 的明确变更；每次点击只移动一档，不长按自动连发，跨档向下使用前一档。不得将出售四舍五入套用于购买上限，不因调整输入自动交易或放宽已批准上限。百分比随机定价、手动覆盖和其它参考行为不变；总预算、固定溢价、百分比及次数不视作单卡价格。

2026-10-05 报价来源三态设置（覆盖旧 FUTBIN 开关）：账号级 `readSources` 支持 FUT.GG、FUTBIN、Both，默认 Both；旧 `futbinEnabled:false` 迁移到 FUT.GG。单源时购买/挂牌基准只能为该源；Both 时独立配置 `source`（购买）与 `listingSource`（挂牌，默认 FUT.GG），不得缺价自动换源或把采购溢价用于挂牌。Gallery 卡片、方案和 Bulk List 共用公共报价缓存与来源许可；Puzzle/购买仍只请求单一购买基准。禁用源不得因旧方案、缓存或强制刷新重新联网，旧授权不改写。FUT.GG 集合目录/卡池请求不属于报价开关。Bulk List 按用户截图恢复纵向 Duration/Price/Wait 分组、弹窗整体滚动、六列表格与右上角 ×，不得恢复三列设置和列表嵌套滚动。

2026-10-04 公共报价读取约束：Settings 的 FUTBIN 价格更新默认复用有效缓存，也可只对新方案强制刷新；Puzzle/购买只请求当前选定来源，Gallery 默认保留双源展示。按用户要求移除 FC27 Settings 的 FUT.GG HTTPS forwarding 配置及运行时转发，旧配置不再读取。Tampermonkey 不能把 `127.0.0.1:1080` SOCKS 绑定到单个请求；按域名分流须由浏览器或代理客户端配置。诊断 `route:direct` 仅表示请求原始服务地址，不能证明底层没有走代理。
2026-10-04 公共报价读取开关：Settings 新增账号级“读取 FUTBIN 报价”。默认开启以兼容旧配置；关闭并保存后，新的 Gallery/Puzzle/购买报价请求只允许 FUT.GG，FUTBIN 在结果中标为“未读取”，不得因强制刷新、旧缓存或旧方案再次发起 FUTBIN 请求。若旧方案原本选择 FUTBIN，必须明确提示重新生成 FUT.GG 方案；已冻结的旧购买授权不被静默改写。

2026-10-04 购买/挂牌价格计划授权：用户已采纳 [价格修复计划](docs/FC27_BUY_LIST_PRICE_REPAIR_PLAN_ZH.md) 的账号级 FUT.GG/FUTBIN 选源、默认 FUT.GG＋固定溢价 0、默认每卡 3 次购买尝试（含首次），及 §4.3 原结果窗口编辑本次失败卡重试上限。此为对原 FSU 价格行为的明确需求变更：EA 挂牌只能作为执行报价，不能作为估价/缺失回退；同批授权上限不能自动增加。挂牌仍单独按 FUT.GG 基准和 Enhancer 行为，不继承采购溢价。P1/P2/P3/P4 已接入生产源码并通过离线验证；真实 EA 买入和挂牌仍待用户主动小批验收，不能把离线测试称为实机完成；最新阶段/恢复点见该计划 §12。

2026-10-04 Gallery Journal 解耦最新约束：方案“批量购买”只读取当前购买 Journal，不读取、不核对也不被上一批 Gallery Bulk List Journal 阻断；旧挂牌记录只保留审计用途。挂牌入口“挂牌已购卡”只处理当前购买 Journal 中已确认入 Club 的实体，只有恢复同一批挂牌时才读取挂牌 Journal。购买 Journal 的读取/格式/写回/成交/入库/收集失败必须显示明确购买恢复提示；底层读取失败、写入失败和回读不一致不得降级为可重试成功。挂牌 Journal 的读取、上下文、回执或写回/归档失败必须在 Bulk List 原位置显示明确挂牌恢复提示。历史段落中“购买前挂牌核对”描述已被本条覆盖。

2026-10-03 FC27 Gallery Bulk List 授权：新 FCAT Gallery/Transfer Bulk List 按用户选中的全部卡处理，不继承旧 Scheduler 的四张、单卡 2000 或总预算 8000 限制；仍逐卡遵守 EA price limits、可交易与精确身份、容量、一次明确批准、Journal、互斥锁、未知回执停机和恢复规则。该授权只适用于新 Bulk List，不扩大旧 Scheduler 或自动任务。新 Bulk List 使用当前已接通的 FUT.GG 公开报价，并在 UI 标明来源；不得声称与 Enhancer 私有后端同源。报价缺失必须显式未知并跳过，不能当作零价。

2026-09-28 购买业务修复进展（覆盖旧购买描述）：新购买从当前 `getPlayers()` 概念槽开始，独立使用 FSU 的 FUTBIN 参考价、原生搜索模型、默认 5 次可配置查价、concat/降序末项选单、PIN 和原等待区间；不以余额或估价作为起搜价格。EA 明确 `success:false` 的查价、买断或入库结果按原版单卡处理并继续其它卡，不能只看 HTTP 401/403/429 就结束整批或误报登录；未知扣款/移动回执、账号或进行中的阵容身份变化仍保留既有事务保护。新流程不额外发送 squad GET/PUT、不预查 Club 自动复用；旧未决保存记录才走兼容对账。去掉购买入口新增的总预算折叠菜单；账号显式单卡上限保留，查价次数在设置保存。原生替换尚未确认时不得宣称已保存，保留成交回执防重复购买。真实买断、旧账号续购及手机专用导航仍未完成实测；证据见 [修复验收与恢复点](docs/FC27_FSU_BUY_PARITY_AUDIT_ZH.md#本轮修复验收与恢复点)。FSU 原文件未改，不得把这些证据表述为全环境与原版完全等价。

2026-09-28 参考插件代码的强制行为一致规则（最新优先）：当用户要求“参考 FSU”或其他插件代码时，含义是完整复现其行为，不是仅借鉴思路、接口顺序或界面。未经用户明确同意，不得自行发挥、简化、替换或修改原逻辑。参考实现已有实际使用验证，自行改写会重新引入逐层测试和实机验证成本；不能以自认为更安全、更优雅、更通用为由擅改。此规则覆盖下文“交互尽量一致”等较宽松表述，具体执行见 §8.0 第 7 条。当前购买实现已发现价格来源与错误处理等未批准差异，之前“与 FSU 一致”的表述不能作为验收结论，见 [购买行为差异核查](docs/FC27_FSU_BUY_PARITY_AUDIT_ZH.md)。

2026-09-28 工程过程约束更新：所有功能开发与修复必须遵守 [8.0 需求、计划恢复与场景验收](#80-需求计划恢复与场景验收)。需求有歧义先澄清，明确后再制定实施计划；计划中断必须记录恢复点，偏离计划必须说明 gap 和补齐路径；测试场景随需求、缺陷和真实运行证据持续补充，不得把局部通过等同于功能完成。

2026-09-28 Puzzle 批量购买最新合同：直接参考 FSU Local `26.09.9` 的 `buyConceptPlayer` / `readAuctionPrices` 重构独立实现，不调用或点击 FSU 按钮，不依赖 FSU 加载或 FCAT 解题记录。原生 SBC 右栏一次可信点击，以当前已保存阵容的概念版本为准，串行查价、买断、确认回执、入 Club、精确替换保存；价格查询沿用 FSU 的有界涨降价与不重复报价逻辑，保留上游 MIT 归属。单卡无挂牌或明确已失效继续其余卡；认证失效、429、未知成交和账号/阵容变化停止并保留 Journal。整批预算可选，留空按可用金币，估价不能变成隐含预算；账号显式单卡上限继续有效。允许任意子集的已确认购入实体先被 EA 自动替换，不允许同版本错误副本或手动改阵混入。购买不重新解题、不以完整 SBC 合法性或 FSU 选材策略为前置，既有材料选取与提交保护不变；不得将购买授权当作 SBC 提交授权。完整回归和离线浏览器已通过；新版本的真实买断及旧两张记录续购仍待用户主动点击验收，详见稳定性计划。

2026-09-27 Puzzle 缺卡交互澄清：最终流程是一次“FCAT 解题填充”联合规划库存与市场候选，将已有实体和缺失版本的概念卡填入同一原生阵容；用户在当前 SBC 侧栏点击批量购买，购后按回执把概念槽位替换为真实实体并复核保存，提交仍为独立动作。不得把手动逐张购买、只有采购文字建议或库存不足后停止作为已完成产品。概念卡可作为规划/阵容展示，不能作为已拥有材料提交；库存 Only Untradeable 不得全局关闭，本次明确购买的实体使用范围需要独立绑定 Challenge 和精确回执。开发及只读检查不授权 Agent 自行消费金币。FSU 模板导入与批量购买源码已核对，Fodder GG 完整购买流程尚未实测。

2026-09-27 Puzzle 选材规则更新：读取当前原生 Challenge 的品质条件，Puzzle 未保存个人上限时默认最高 82，可手动设置，既有显式更低上限继续有效，且仍受 FSU 金卡范围和材料保护约束。存在最低品质要求时，填充保持该品质，只为原生品质数量条件使用必要的更高品质卡；例如最低银卡＋至少 2 金固定按 2 金（默认每张 ≤82）＋其余银卡求解，不能因缺卡、评分或化学不足自动增加金卡。该额外选材限制独立于 EA 原始条件，规划与保存前后均复核；无解需说明策略或材料缺口，不得篡改原生 min/exact 语义。传统 Runner 的 74/83 合同不变。

2026-09-26 同类功能交互规则：实现其他插件已有的类似功能时，默认尽量保持相同的界面位置、按钮含义、交互方式和操作步骤；只有用户明确指令要求差异化时才采用不同流程。开发前先核对参考插件的实际行为，不因内部架构、校验或日志需要而自行增加菜单跳转、重复选择、预览页或二次确认。材料保护、身份复核、事务锁、日志和恢复由后台执行；无法完成时在原操作位置说明原因。用户本次明确要求原生 SBC 的“FCAT 解题填充”与 FSU 一键填充类似：一次可信点击即授权当前 Challenge 的一次解题、复核、填阵保存，不自动打开 Tools 面板、不再要求选择或确认，不授权提交 SBC 或消费金币。此更新优先于下文要求 Puzzle 在面板二次确认的历史说明，传统 Submit 的确认流程不变。

2026-09-26 正式版本开发标准（优先于下文历史阶段限制）：用户明确要求“把这些限制都去掉，我们目前就是按发布版本来做标准”。取消 production/acceptance 固定体积上限、逐文件构建许可、27.0.0 专属只读/hash 发布批准、固定安装 fixture 发布阻断、全局业务 Pending 和禁止新增联网功能的工程限制。生产构建按正常源码依赖扩展，manifest 记录实际能力与依赖；`releaseEligible:true` 只代表正式产物可进入发布流水线，不代表所有功能实测完成。发布统一检查完整回归、浏览器交互、FSU 补丁重放、产物/版本/hash 一致性、tag 和不可覆盖既有资产。材料保护、精确身份和当前规则复核、一次确认、锁/Journal/写后对账及凭证隔离继续作为正式版质量要求；没有实现的 Provider/事务不得通过删除停止码伪装可用。实际 EA 验收如实记录，本次未授权 Agent 消费材料或硬币，也未要求立即推送/tag/发布。详见 [最新门禁实施](docs/FC27_GATES_AUDIT_ZH.md)。

当前文件与目录更名状态见 [改名记录](docs/RENAME_STATUS_ZH.md)。文件名与安装身份应区分；FC26 运行时仍保留原显示名，FC27 首版为用户明确选择的全新安装。FSU 身份不变。

本文件是 AI agent 和维护者处理本仓库任务时的首要工程说明。它描述当前真实实现，而不是最终理想状态。

2026-09-18 Live 授权更新：用户明确要求“打开 live 限制”，本地 `27.0.1` 默认入口开放现有单次传统 SBC 执行；下方 `27.0.0` 硬关闭约束只描述已发布版本。构建通过 `__FCAT_LIVE_ENABLED__` 将同一执行模式注入入口并写入 manifest，不能出现运行时/manifest 不一致。每次必须先生成并 fresh 校验计划，再由用户在面板确认一次；不开放 Rolling、开包、移动、Pick 或交易，不放宽任何材料/事务保护。允许本地执行不代表真实业务已验收或获准公开发布；历史只读发布许可不可复用，`releaseEligible:false` 和业务 Pending 保留。当前任务不授权 Agent 代用户消费卡片，也不修改已发布 tag/资产。

2026-09-18 发布结果：`v27.0.0` 已在提交 `40463dc` 正式发布为只读 latest，FSU Local `26.09.8` 随附；CI、七项资产及四个 latest 下载地址已通过校验。不得重写 tag 或替换已发布资产；Live 与真实 SBC 验收仍 Pending。证据见 [发布与交付结果](docs/FC27_LIVE_ADAPTATION_ZH.md#发布与交付结果)。

2026-09-18 首版发布授权：用户明确确认将 `fc-automation-tool@27.0.0` 按只读首版发布，取代此前阻断全部 Release 的安排。`liveEnabled:false` 必须保留，真实 SBC 验收继续延期。`scripts/fc27-readonly-release.json` 只授权精确版本和 Runner/FSU SHA256 组合；`check-release-readiness.mjs` 验证安装/更新证据、FSU 重放和产物一致性，未来版本、改动后的脚本或 Live 均不能沿用此批准。默认入口为 `src/fc27/production-entry.js`，全新身份 `FC Automation Tool` / 新仓库 namespace；旧源、Loops/Profile、Rolling、交易仅作 FC26 回归，不表示新版支持。范围见 [27.0.0 说明](docs/releases/27.0.0.md)，证据见 [验收记录](docs/FC27_LIVE_ADAPTATION_ZH.md)。

2026-09-18 FSU 路线修正：用户确认原 `26.09.6` 在 FC27 大部分功能可用；专用浏览器已观察到原版运行时初始化且 Club 为 ready，但该观察未独立确认实际安装版本，不能用本地产物版本替代安装证据。FSU 后续必须基于既有 mod 查漏补缺，优先原有一键填阵/价格函数的最小修复，保留界面、设置与已验证缓存合同。当前本地修订为 `26.09.9`，包含 FUT.GG 价格季节绑定、Home Controller 延迟初始化和 FC27 对话框按钮兼容修复；一键填阵仍需登录后的真实 Challenge 验证。独立 FC27 FSU Preview 降为历史研究原型，不再默认安装、扩展或作为 Runner 适配前置条件；不得以静态耦合风险推断原版整体不可用。新 Runner 的 FC27 架构计划不因此取消，实际填阵/保存/提交仍需相应验证与授权。最新边界见 [FSU 本地支持](FSU_mod/FC27_LOCAL_SUPPORT_ZH.md)。

开始任何代码任务前，先读取：

1. 本文件。
2. 用户提供的完整日志和截图。
3. [REFACTORING_MILESTONES.md](docs/REFACTORING_MILESTONES.md) 中相关 Milestone 和已知缺口。
4. 涉及 FSU Club 加载、缓存、Runner FSU Adapter、运行时库存 readiness 或提交前定向校验时，必须读取 [FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md](FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)。
5. `git status --short`、最近提交和当前 diff，避免覆盖未提交的正确行为。

## 1. 项目目标与安全原则

FC Automation Tool 是 EA FC Web App 的 Tampermonkey 自动化脚本，运行时依赖 EA 页面模型、FSU 和 FC26 Enhancer。它处理高价值账号库存，因此正确性优先于继续运行。

必须遵守：

- 无法确认 SBC、Challenge、奖励或材料身份时停止。
- 不得为了让流程通过而放宽高分卡、特殊卡、Only Untradeable、联赛或 Evolution 保护。FSU Lock player 和 Active Squad 冲突保护是 Selection Policy 中明确的 opt-in 开关，默认关闭；开启后必须在候选/提交前保护锁卡，或在 EA 返回 item conflict 时停止。
- 不得把 Transfer/Unassigned duplicate signal 当成可以直接提交的实体；必须解析到 Club/Storage 中真实可提交的对应卡。
- 开下一包、提交下一阵或进入下一阶段前，必须确认当前 Unassigned 和页面状态已经取得进展。
- 修复当前状态时，优先保证用户更新脚本后可以重新点击同一个 Loop 继续，而不是要求清空状态重来。
- 共享底层改动必须评估全部调用方；越靠近 Adapter、Selection、Pack、Unassigned、SBC Transaction，修改越慎重。
- 没有测试覆盖的线上 Bug，应先添加最小 fixture 或失败测试，再修实现。
- 新功能开发阶段允许新功能自身出现尚未发现的 Bug，但影响必须局限在新增行为内；新增代码不得破坏任何现有功能或扩大已有事务的风险边界。
- 需要确认 EA 页面、DAO、Controller、Repository、实体字段或响应时序时，可以先增加有界、脱敏且可定位调用阶段的诊断日志，以真实运行证据指导实现；不得用猜测替代观测，也不得让诊断开关改变业务或安全语义。
- 对现有代码的任何修改原则上实行零回归：修改前识别调用方和现有行为，先补或同步运行相关回归测试，修改后执行与影响面相称的完整验证。只有用户与维护者已经明确决定重构相关功能时，才允许重构期间出现范围清楚、风险较低的暂时回归；发现后必须立即添加失败测试锁定原行为或新的明确合同并完成修复，已知回归不得进入可发布版本。
- Node 自动测试不能替代真实 Web App 验证。

已经在真实页面确认、不得回退的运行时事实：

- FSU 是普通金材料策略的权威来源。Only Untradeable、排除联赛、Exclude Evolution、Golden Player Range 和 Storage 优先仍必须跟随；FSU Lock player 由 `Selection Policy -> Submission guards -> Protect FSU locked players` 控制，默认关闭。开启时候选和提交前检查都必须保护锁卡，发现已进入阵容的锁卡则停止；评分型 SBC 可以不使用 FSU 页面一键填充，但启用该开关时候选仍必须经过锁卡检查。
- EA/FSU 的 `loans === -1` 表示无限使用的普通卡，不是 loan。`loans === 0` 或正数才表示受限使用；真实 loan、limited-use、concept、academy enrolled 和 active trade item 都不能提交。
- FSU Lock 不能只匹配单一 `item.id`。身份匹配必须覆盖 item、resource、definition、asset 和 guid 类字段，以及 EA 对象常见的嵌套数据容器。
- FSU Club 实体缓存恢复后属于 provisional 数据。Runner Live SBC 使用 Club 卡时，必须在保存前按 item ID 和 definition ID 向 EA 定向校验；发现缺失或属性变化时停止并重新选材。不得以 Club 数量、缓存年龄或 fingerprint 代替该校验。
- FSU 全量 Club payload 必须绑定到确切 XHR。不得恢复 broad capture fallback，不得把 Enhancer 或其它插件的 Club 响应归属给 FSU；`clubRepo.hasAllItems()` bypass 只能影响当前 FSU criteria 并立即恢复。
- 同一 SBC squad 的 `definitionId` 必须唯一；Unassigned/Transfer duplicate signal 只能解析到 Club/Storage 中真实可提交的对应卡。
- EA Unassigned 的清理身份 `duplicate/duplicateId` 以同版本 Club 主卡为准。Club 主卡提交后，即使 Storage 或 Transfer 仍有同版本卡，也不能继续把该 Unassigned 卡规划成 duplicate；下一次 Inventory snapshot 必须将清理身份降级为 non-duplicate 并移入 Club。EA 原始信号必须独立保存在 `duplicateSignal/duplicateSignalId`，选材仍可据此解析到 Storage/Club 中真实可提交的同版本实体；不得再次用单一 `duplicate` 字段混合清理路由和 SBC signal 两种语义。
- 84x10 只能使用 Challenge 要求数量和类型的 requirement special。额外特殊卡、错误特殊卡、超出提交上限的卡和 protected id 必须在保存前、保存后和提交前拦截。
- 动态 SBC 的 EA eligibility group（例如 `PLAYER_RARITY_GROUP=83`）必须按原始 group id、values 和 count 保存。不得把动态 group 展开或固化为 TOTW/TOTS/FOF/FUTTIES 等卡种名称；运行时优先使用当前 Challenge requirement 的 `meetsRequirements(item)`，在当前 DAO 没有该方法时使用注入的精确 EA item-group matcher；两者都不可用时停止提交。
- Rolling 主 SBC 的 Required Special 还必须执行来源限制：Unassigned、Storage 和 Transfer 接受 live eligibility matcher 命中的卡；Club 只接受 TOTW。Club 中的 TOTS、FOF、FUTTIES 以及其它命中该 live matcher 的非 TOTW 卡必须硬保护，不能作为主 SBC 特殊槽或普通材料。唯一的恢复例外是用户显式开启 `pickOptions.rollingAllowClubCurrentPoolSpecialsForProvisions=true`、同时未开启 `rollingProtectAllClubNonTotwSpecials` 时，普通 Provisions shortage recovery 才可把当前 live matcher 精确批准、评分位于配置 Provisions 范围且通过全部保护检查的 Club 非 TOTW 实体作为最后候选；授权必须绑定稳定 item ID，不得扩展到同 definition、其它恢复 SBC、duplicate-reserve、Storage pressure 或主阵。Transfer 延续 duplicate signal 语义，只能解析到 Club/Storage 中真实可提交的对应副本。该限制必须同时存在于候选过滤、Inventory Ledger 分类和提交前验证，不能只依赖优先级。
- 多 Challenge SBC 默认在第一阵提交前完成跨阵联合规划。规划在不可变 Inventory snapshot 上按较难阵容优先，逐阵扣除 item 和 duplicate signal，并拒绝 item、definition 或 signal 身份重叠。EA 不支持跨阵原子事务；第一阵提交后必须对账并再次验证下一阵，失败时记录 partial completion，不得声称回滚。Rolling 的 95+ Storage sink 是明确例外：它按 89 后 88 顺序独立规划和提交，允许 89 已完成、88 待后续 Storage 压力恢复。
- Rolling 的 95+ Storage sink 是可选动态 capability，只能在 Storage 压力时触发。压力缓解由 `pickOptions.rollingStorageRecoveryPriority` 的三个互斥值控制：`storage-pressure-only` 只执行 Storage Pressure、`provisions-only` 只执行紧急 Provisions、`provisions-then-storage-pressure` 在同一连续压力事件中最多先执行一次 Provisions，重新对账仍有压力时才执行 Storage Pressure；默认值为 `storage-pressure-only`，旧 `storage-pressure` 迁移到该值，旧 `provisions` 迁移到混合策略。Storage sink 还必须由用户通过 `pickOptions.rollingStorageSinkEnabled` 显式启用，默认和旧配置迁移值均为 `false`；关闭时只允许扫描和展示 capability，不得规划或提交 88/89 阵。实验交换开启时，89 阵只允许当前主包中不高于 Automatic-use 上限的 Unassigned duplicate signal 及 Storage 材料，且这些可用 signal 必须优先消耗；实验交换关闭时，待存 Unassigned duplicate 必须继续硬保护，Storage pressure 阵只能通过净消费足够的真实 Storage 卡取得容量。88 阵先使用 Storage，不足时最多加入三张安全普通 Club 卡。89 提交后必须对账并重新读取 Challenge；88 暂不可行时返回可恢复进展，下次只续做 88。它允许紧急消耗当前配置的 Provisions Reserve，但仍永久排除 Required Special、保护高于 Automatic-use 上限的卡，并在每阵提交前为剩余待存卡、最终 Pick 可能产生的重复卡预留 Storage 空间。其它动态 Storage Pressure capability 只有在用户显式开启 `pickOptions.rollingStoragePressureClubBoostersEnabled` 且本次要求净消费真实 Storage 卡时，才可突破通用三张 Club filler 上限；新增 filler 只允许普通 Club 金卡 `87` 至当前 Provisions 上限，数量必须为本次要求释放的 Storage 卡保留阵容位置，并继续执行 FSU、Lock、Evolution、Active Squad、Automatic-use protection 与提交前验证。
- `rollingDuplicateSwapEnabled=true` 时，Rolling 主 `10x85+` 奖励刚开出的可用普通重复卡具有最高普通材料优先级：低于 Automatic-use 上限且不是 Required Special 的 85-89 重复卡必须优先作为下一套主 SBC 材料，不得仅因评分位于 Provisions 范围而送入 Storage、85+ Pick 或 5x80+。只有主阵最低评分仍超过目标时，才按评分从高到低逐张放宽，并把被 Storage 低分卡替换出的主包重复卡存入 Storage；高于上限的重复卡和额外 Required Special 仍必须存储。该实验开关关闭时，所有新 Unassigned duplicate 先整体进入 Storage，不保留 transient primary/provisions signal。
- `pickOptions.rollingSurplusCraftingEnabled` 默认和旧配置迁移值均为 `false`。关闭时不得主动执行 `duplicate-reserve` Provisions 或主阵后的 Storage Provisions/TOTW 维护，87/88 及可选 89 不作为主阵 Reserve，主阵缺料、Required Special 缺失和真实 Storage 压力恢复仍可执行。开启时才恢复 Provisions Reserve：默认严格限制为 87/88，可由 `pickOptions.rollingProvisionsMaxRating` 扩展到 89/90/91；当前主包完整四张 Reserve 优先做 Provisions，余数进入 Storage，主阵后允许主动 Storage 维护。动态扫描得到的 EA 最低评分要求不能放宽业务上限；Required Special 和其它受保护卡必须在选材合同及保存前后 validator 中双重拦截，只有上一条定义的显式 Club current-pool 普通 Provisions shortage 例外可按精确 item ID 放宽。`pickOptions.rollingOpenDuplicateProvisionsRewards` 默认 `false`：主动 `duplicate-reserve` 奖励保留到主阵缺料时开启；设为 `true` 才立即开启。缺料和紧急恢复奖励仍立即处理。
- 只有奖励最低评分为 85 或 86 的动态 `high-rated-x10` 才能进入 Rolling 计划，并且当前会话最多只发布一个 Rolling Loop。无限 86x10 优先且不再发布 85x10 Rolling；限次 86x10 只有在剩余次数可确认且存在无限 85x10 时才生成 `86 -> 85` 复合阶段，86 确认耗尽且其待开奖励处理完成后才能切换；没有可用 86 时只允许无限 85x10。次数未知、身份不完整、候选重复、85x10 限次或缺少无限回退时必须 fail closed。10x84+ 等其它扫描结果只保留通用 Upgrade Loop，不得复用 Rolling 恢复链。
- `pickOptions.rollingDuplicateSwapEnabled` 是默认关闭且旧配置缺失时仍为 `false` 的实验开关。关闭时所有新 Unassigned duplicate 必须先整体路由 Storage；容量未知或不足时禁止任何交换、新 journal 和主 SBC 提交。已显式启用的 Storage-pressure recovery 可以先提交，但必须净消费足够的真实 Storage 卡，且不得消费这些待存 Unassigned signal；否则保持 `DUPLICATE_SWAP_DISABLED_STORAGE_BLOCKED`。遗漏到提交前的 signal 仍必须硬阻断。开关只禁止新交换，不得跳过已有 duplicate materialization journal 的启动取消和精确 protected Club ID 恢复。
- Unassigned/Transfer duplicate signal 只在当前主阵临时授权其 `duplicateId` 指向的真实提交实体；受保护 signal、缺少稳定对应实体或 signal 消失时必须 fail closed。确认提交后，transport、Inventory Ledger 登记和 duplicate 同步属于同一提交临界区，用户 Stop 只能在该区结束后生效。
- EA `409 itemViolations` 必须保留每个 warning name 与其 item IDs 的对应关系，不能先压平成无关联数组。只有明确的 `ACTIVE_SQUAD` warning 可以进入 Active Squad 替换/人工确认；已观察到的 `Evo` warning 属于 EA validation confirmation，不得误判为 Active Squad。Rolling 只允许在重新读取同一 saved squad、重跑 pre-save/post-save/final validators，并确认 warning 指向精确的非 Evolution Storage item ID 后执行一次 `skipValidation:true`；同 definition 的 Club EVO 不能改变该 Storage 实体判断，实际 Evolution/属性变化、未知或无名 warning 在 Active Squad 保护开启时必须 fail closed。强制确认失败不得再次强制提交。
- `diagnostic` 只能控制日志，不得改变导航、刷新、身份确认或事务安全语义。Pack open 的 HTTP/DTO 状态与业务提交结果必须分开判断：同一次 `pack.open()` 回调中的非空奖励 item 数组是已提交的强证据，即使外层 DTO 为 500 也必须沿原 Loop 的专用奖励策略处理并保留 transport warning，不得重试。对于该响应中的重复奖励，必须依次等待所有可用 Unassigned Repository `reset()`、标记 `ItemPile.PURCHASED` dirty、调用 `requestUnassignedItems()`，并从 Repository getter、公开集合和 DAO 集合合并读取 live 实体；每张响应卡只能通过精确 item ID，或相对开包前基线新增且数量一一对应的同版本实体确认。Controller 跳转只允许作为两次强制刷新之间的一次有界触发，Controller 未切换不能否定已经完整的实体证据；304/空缓存、部分实体、旧基线实体或歧义映射必须 fail closed。直接载荷缺失的 response-lost 恢复没有可匹配 DTO，仍必须要求已确认 Unassigned Controller、相对基线新增实体和强制刷新后的包数量变化等组合证据；证据不足绝不能重开下一包。

## 2. 运行环境与依赖

### 2.1 浏览器运行时

- Tampermonkey userscript。
- EA FC Web App 页面及其 `unsafeWindow` 中的 repositories、services、controller 和模型对象。
- FSU，用于材料过滤、Lock player、Golden Player Range、Storage 等兼容行为。
- FC26 Enhancer，部分页面和运行环境会与其共同存在。
- Tampermonkey API：`unsafeWindow`、`GM_xmlhttpRequest`、`GM_notification`、`GM_getValue/GM_setValue/GM_deleteValue`。Reward Alert 凭证使用 GM 隔离存储；本地 Hot Reload 通过受控 userscript bridge 转交这些 API，不能改回页面 localStorage。
- 外部价格服务：FUT.GG，失败时回退 FUTNext。

FC27 metadata 位于 `src/fc27/production-entry.js`；旧季 metadata 保留在 `src/userscript-entry.js`。FC27 授予 `unsafeWindow`、`GM_getValue`、`GM_setValue`、`GM_xmlhttpRequest`；默认 `@connect` 限于 `www.futbin.org`（购买参考价）、`www.fut.gg` 与 `fodder.gg`（Gallery 公开目录）。FUTBIN 传输只允许两个公开价格路径，Gallery 使用固定的匿名目录、精确集合卡池及公共报价接口，不发送 EA 凭证。FC27 已移除 HTTPS forwarding 设置和运行时转发，旧配置不再读取。Tampermonkey 不提供 per-request 浏览器/SOCKS 代理；`127.0.0.1:1080` 应配置在浏览器或代理客户端，检查器 `--proxy` 为浏览器级代理而非自动按域名分流。不能直接继承旧季网络权限。

### 2.2 开发工具

- Node.js 22：本地建议与 CI 保持一致。
- npm：使用 Node 自带版本即可。
- esbuild：将多文件源码打包为单个 IIFE userscript。
- Vitest：Node 环境下的 unit、workflow、contract 和 architecture tests。
- PowerShell：Windows 开发和启动本地服务。
- Python `http.server`：仅用于本地热加载静态文件服务。

### 2.3 环境搭建

仓库的直接 npm 开发依赖只有：

```json
{
  "esbuild": "^0.28.1",
  "vitest": "^4.1.10"
}
```

所有间接依赖已经锁定在 `package-lock.json`。不需要全局安装 esbuild、Vitest 或其它 npm 包，也不要手工选择间接依赖版本。

推荐从干净环境执行：

```powershell
node --version
npm --version
npm ci
npm run verify
```

要求：

- Node 22，至少应使用与当前依赖兼容的现代 Node 版本。
- `npm ci` 必须基于已提交的 `package-lock.json` 安装精确依赖。
- 如果修改 `package.json` 依赖，必须同步更新并提交 `package-lock.json`。
- Python 不是 npm 依赖，也不是构建和测试必需项；只有运行 `StartFCAutomationToolDevServer.ps1` 热加载时才需要 `python -m http.server`。
- Tampermonkey、FSU 和 FC26 Enhancer 是浏览器运行时依赖，不由 npm 安装。

主要 npm 命令：

```powershell
npm ci
npm test
npm run lint:undef
npm run test:contracts
npm run test:architecture
npm run build
npm run verify
```

`npm run verify` 是提交或交付前的最低完整验证。

## 3. 源码、配置与发布产物

### 3.1 真正的源码

```text
src/fc27/production-entry.js (FC27 default build)
src/userscript-entry.js
src/**
```

`src/fc27/production-entry.js` 复用 FC27 只读准备、隔离 Journal/锁和单次事务基础设施；依赖白名单由构建强制校验，本地 `27.0.1` 按最新授权开放用户逐次确认的单次 Live，真实业务验收仍 Pending。`src/userscript-entry.js` 是保留的 FC26 入口，包含 Runtime Adapter 组合、命令实现、页面编排和仍未完全拆出的 helper。内置 `LOOP_DEFS`、配置展示和 schema 校验已经迁入 `src/config`；这些旧季源和测试不因新默认构建而删除。

不要假设入口已经完全薄化。当前它仍约数千行，是主要集成层，修改前必须搜索调用方和架构测试基线。

### 3.2 外部配置

`FCAutomationTool.loops.json` 是 FC26 的可选外部配置，不进入 FC27 Release，包含：

- `loops`
- `recoveryRecipes`
- `unassignedRecoveryPolicies`
- `defaultUnassignedRecoveryPolicyIds`

内置配置和外部 JSON 的 Loop id 与顺序必须一致。新增或修改内置 Loop 时通常需要同步修改外部 JSON，并更新 `tests/contracts/loop-config.test.js` 或 fixture coverage。

### 3.3 生成文件

以下文件由构建生成：

```text
FCAutomationTool.user.js
dist/FCAutomationTool.user.js
dist/FCAutomationTool.meta.js
dist/FCAutomationTool.manifest.json
dist/FSU-Local.user.js
dist/FSU-Local.meta.js
dist/profiles/*
```

禁止手工编辑生成文件。构建链路：

```text
src/fc27/production-entry.js metadata
        +
FC27 entry body and allowlisted modules
        |
        v
scripts/build-userscript.mjs -> scripts/build-fc27-production.mjs
        |
        v
esbuild, bundle=true, format=iife, target=chrome120
        |
        +--> FCAutomationTool.user.js
        +--> dist/FCAutomationTool.user.js
        +--> dist/FCAutomationTool.meta.js
```

`scripts/check-dist.mjs` 验证：

- metadata 与生产身份、更新地址和许可证约束一致。
- `package.json`、`package-lock.json`、完整脚本和 `.meta.js` 版本一致。
- 根目录和 `dist` 产物字节一致。
- 生产脚本不包含 localhost 网络权限。

`package.json` 是当前 Runner 版本的唯一来源。FC27 入口 metadata 的 `__DLR_VERSION__` 和运行时 `__FCAT_VERSION__` 均由构建注入；禁止手写第二份版本号。升级时同步 `package-lock.json` 并重建。`scripts/build-fc26-regression.mjs` 只在内存构建历史源，并读取冻结提交的 package 输入供 baseline 回归；不会生成第二个生产安装包。

`FC26 Daily Loop Runner` 的生产 `@name`、GitHub namespace、update/download URL 和 MIT `@license` 从 `0.7.0` 起属于稳定安装身份。除非明确设计并记录一次新的安装迁移，不得随重构、仓库移动或开发脚本改名而改变。生产 metadata 只允许已审查的远程域名；`127.0.0.1` 和 `localhost` 仅允许出现在 `FCAutomationToolHotReload.user.js`。

`0.8.65` 的混合身份过渡已由 FC27 全新入口替代，旧源和历史资产不作迁移。`27.0.0` 已获用户明确的只读发布批准；默认发布检查和 `--packaging` 均校验精确授权、绑定版本/SHA256 的安装证据及 FSU 资产。`FC27_LIVE_ACCEPTANCE_PENDING` 仍是业务状态，不再阻止这次限定的只读交付；不得据此开放 Live，或把离线成功当作真实业务验收。

FSU Local 的维护输入是 `FSU_mod/fsu-mod.config.json`。上游 `26.09` 原文件必须保持字节不变，`upstreamVersion` 不得因本地修改变化；本地改动只提升独立的 `localVersion`，并重新生成 patch、manifest、`FSU-Local.user.js` 和 `FSU-Local.meta.js`。`npm run check:fsu-patch` 必须证明 patch 可从 immutable origin 重放到 manifest 记录的 modified SHA256；直接编辑 manifest hash 或发布产物不算修复。

FSU 修改版必须保留上游脚本身份：`@name` 固定为 `【FSU】EAFC FUT WEB 增强器`，`@namespace` 固定为 `https://futcd.com/`。Tampermonkey 以脚本身份隔离 GM 存储；不得为了显示 Local 品牌、切换发布地址或区分本地版本而修改这两个字段，否则会重置 `build`、`set`、Lock 和其它用户配置。维护版只允许通过独立版本号、description、homepage/support URL 和 GitHub update/download URL 表明来源。

FCAutomationTool、仓库内原创文档/脚本和 FSU Local 修改均按 MIT 发布。第三方代码必须保留其原始作者、许可证和 notice；不得仅因为仓库采用 MIT 就删除第三方归属，也不得把第三方商标或在线服务描述为本项目资产。许可证边界以 `LICENSE`、`FSU_mod/LICENSE` 和 `THIRD_PARTY_NOTICES.md` 为准。

新增或删除 Loop strategy 时，禁止只修改 schema 或只在 entry 注入 runner。`src/domain/strategies.js` 是 strategy 清单来源，必须同步贯通 `src/config/loop-schema.js`、`src/workflows/dispatch.js`、entry runner 注入、strategy dispatch 测试、架构 runner-map 测试和对应 Workflow/contract coverage。凡是 schema 接受但 dispatch 无法执行的 strategy 都属于发布阻断错误。

## 4. 架构和依赖方向

期望依赖方向：

```text
Loop configuration
        |
        v
Workflow orchestration
        |
        v
Selection / Pack / Unassigned / SBC / Reward services
        |
        v
Adapters
        |
        v
EA / FSU / DOM / Tampermonkey runtime
```

稳定数据流：

```text
EA objects
-> Adapter
-> serializable Snapshot / Ref
-> pure Planner or Workflow
-> Plan / Result
-> entry integration
-> Adapter side effect
-> refreshed Snapshot
-> progress validation
```

边界规则：

- `domain`、`selection` 和 `workflows` 不得访问 `window`、`document`、`unsafeWindow`、`W`、EA repositories 或 services。
- `config`、`pack`、`sbc`、`unassigned` 和 `ui` 共享模块也不得直接访问运行时全局。
- `trade` 中的合同、Provider、Planner、Transaction 和 Scheduler 必须保持运行时无关，只能通过注入的 HTTP、Storage 和 Trade Adapter 工作；不得读取 Enhancer/FSU 私有全局或设置。
- 低层 EA 调用应集中在 `src/adapters/ea`。
- Workflow 通过回调编排行为，不直接 import EA Adapter 实现。
- Selection 只决定材料计划，不打开页面、保存或提交 SBC。
- Submission 可以拒绝实际保存后发生变化的阵容，但不能静默重新选择另一套材料。

`tests/architecture/module-boundaries.test.js` 和 `tests/architecture/direct-call-sites.test.js` 锁定这些规则。

## 5. 模块职责与影响面

### 5.1 `src/config`

文件：

- `runtime.js`：应用 key、本地配置 URL、UI storage key、运行默认值和 FSU fallback。
- `loops.js`：内置 `LOOP_DEFS`；顺序、id 和关键行为必须与外部 JSON 保持一致。
- `loop-schema.js`：Loop、recovery recipe/policy 的归一化、引用检查和错误信息。
- `loop-presentation.js`：MVP/hidden 可见性和 `disabledPiles` 投影。
- `run-limits.js`：Live guard、One-click 阶段执行策略和安全上限摘要的纯计算；安全上限不得伪装成业务 rounds。
- `routine-steps.js`：One-click 子 Loop 查找、继承、校验、disabled pile 投影，以及 EA 实时剩余次数到子步骤完成数的投影。
- `runtime-options.js`：Dry Run、奖励开包、rounds、Pick 82/90 阈值、是否显示 rounds 和延迟集中开启 Pick 的运行时配置投影。
- `builder-profile.js`：Builder Profile、Draft/Saved/Active、last-known-good、内置三方 rebase、动态 Pick 绑定和 JSON import/export 的纯配置模型。
- `builder-descriptors.js`：所有已注册 Loop strategy 的可视化字段描述；新增 strategy 时必须同步 descriptor contract。
- `builder-editor.js`：Workflow step、Step Variant、Loop/Recovery 引用重命名和结构化字段更新的纯编辑操作。
- `batch-open.js`：Batch Open 持久化计划规范化、稳定包类型 identity、`fixed/all` 数量模式和当前可用数量投影/启动时物化。
- `player-pick-discovery.js`：从标准 SBC Set/Challenge/Reward 快照保守生成临时 `playerPickSbc` 配置；条件不完整时只返回诊断，不从名称猜测。
- `fsu-compat.js`：FSU/Enhancer 嵌套设置、Storage 配置和锁卡身份的纯兼容解析。
- `selection.js`：把 Loop 与 requirement 级别的保护字段规范化为选材输入。
- `recovery.js`：默认 Unassigned 恢复配方和按卡种匹配的恢复策略。

风险：中等。恢复配置会影响所有发生容量溢出的 Loop；运行默认值会影响 UI 或全局行为。

修改要求：

- 配置仍需在 `src/config/loops.js` 内置定义或外部 JSON 中正确引用。
- 修改 schema 时保持现有错误信息和旧数组/对象容器兼容，并更新 `tests/unit/loop-schema.test.js`。
- recovery recipe 必须消费当前 blocked duplicate，不能只是提交无关 SBC。
- 修改恢复顺序时更新 contract tests，并列出需要真实页面验证的容量场景。

### 5.2 `src/domain`

文件：

- `contracts.js`：`ItemRef`、`ItemSnapshot`、`InventorySnapshot`、`InventoryDelta`、`SelectionPlan`、`SquadPlan`、`SubmissionResult`、`OpenPackReceipt`。
- `objects.js`：Loop 配置克隆和 plain object 判断。
- `rating.js`：EA squad rating 公式。

风险：很高。Contract 字段或评分公式影响多个模块和 fixture。

修改要求：

- 数据结构保持可序列化和不可变语义。
- 新字段需更新 Adapter、fake、tests 和可能的 fixture。
- 评分公式变更必须有 characterization 和 differential tests。

### 5.2.1 `src/inventory`

文件：

- `ledger.js`：四个 pile 的纯内存索引、item/definition/rating 索引、分类、confirmed delta 原子应用、drift 对比和本地对账。
- `deltas.js`：把 Pack receipt、Move result、Submission result、Pick confirmation 和 Capacity observation 投影成统一 `InventoryDelta`。
- `ledger-coordinator.js`：初始 readiness 门禁、周期/异常对账、provisional FSU Club 定向验证和有界诊断事件。
- `capabilities.js`：按 ledger 实例、`inventoryVersion` 和 policy key 缓存 `specialSlots`、`provisionsBatches` 和 Storage 指标。实时 Telemetry 只能执行 ledger 线性计数；`directCycles` 与 `totwRecoveries` 保持 `null`，禁止为了 UI 数量调用评分 Solver。主阵和 TOTW 的真实可行性只在 Workflow 到达对应决策点时计算。
- `mutation-observers.js`：把共享事务已有的可选回调形状适配到 coordinator。未显式创建并注入 coordinator 时不得改变普通 Loop。
- `rolling-policy.js`：Rolling 开包分类、受保护/储备卡 Storage 路由、主阵 role-aware selection policy，以及恢复 SBC 的硬保护/Club Other Special 软保护 policy；只处理卡片分类与引用，不执行 move、开包或提交。

风险：高。错误的乐观更新会让后续 Solver 使用不存在或已移动的卡；错误的能力模拟会高估可执行次数。

核心不变量：

- 初始索引只读当前本地 EA/FSU Repository，禁止为了统计触发 Club 网络分页。
- FSU loading/not-ready 必须拒绝初始化；provisional cache 可以建索引，但每次提交前必须定向验证选中的 Club refs。
- 只有 confirmed mutation 可以改变账本；ambiguous mutation 只标记 stale，并立即或在下一次提交前完成本地对账。
- Delta 必须先完成全部 identity/pile 预检再原子应用。move 目标冲突、重复 ref、缺失 ref 或无稳定 identity 时不得部分更新。
- 容量按已确认 observation 或 pile 增量维护，未知上限保持 `null`，不得伪装成零。
- 每十次主 SBC 做一次本地 Repository 对账；外部 drift、item 缺失、目标校验变化或 mutation 不匹配立即重建或停止重规划。
- Capability 不得调用通用 Solver，也不得克隆并反复扣减完整 Snapshot；它只能从 Inventory Ledger 的 classified entries 计算低成本计数。
- 诊断只保存有界事件、计数、pile、耗时和 drift 摘要，禁止保存完整卡对象。
- Rolling 仅在动态扫描确认完整实时 contract 后生成的 `rollingUpgrade` 中创建 coordinator；普通 Loop 不创建 coordinator，不得因本模块出现而增加扫描或改变选材/提交行为。该动态 Loop 可以进入主列表，但启动仍须通过 capability、Open rewards 和运行时 preflight 门禁。
- Storage 容量未知时不得假设有空间。高于 Protection rating 的重复卡、额外 Required Special 或当前配置的 Provisions Reserve 需要 Storage 且容量未知/不足时，Rolling 必须以 `PROTECTED_STORAGE_BLOCKED` 停止。

### 5.2.2 `src/runtime`

- `telemetry.js`：通用、可序列化且有界的 Runtime Telemetry snapshot，以及按 animation frame 合并更新的 controller。

Telemetry snapshot 只能保存 phase、cycle、资源计数、Storage 容量、`inventoryVersion`、刷新状态和时间；禁止保存 EA item、selection、receipt、错误对象或日志文本。`null` 表示未知，不能归一化成零；重新计算期间必须保留上一次可信指标并显示 `calculating`。controller 只负责有界状态和合并发布，不读取 Inventory、不解析日志、不访问 DOM。

### 5.3 `src/adapters`

文件：

- `ea/inventory.js`：统一读取四个库存 pile（含 Storage/Transfer 旧模型 fallback），把 EA Item Repository 转换为库存快照，并提供容量读取、pile 刷新、Item move、枚举解析、实时对象查找和 purchased item 准备；Unassigned 强制刷新必须覆盖 Repository/DAO 的全部已知缓存失效入口，并可输出各 live Repository 源的独立数量和 item ID 诊断。
- `ea/pack.js`：统一读取/刷新 My Packs、按 ID/名称解析实例，并且是唯一允许直接调用 pack model `open()` 和 `Store.getPacks()` 的位置。
- `ea/sbc.js`：SBC Set/Challenge/DAO/formation 读取、Squad Controller 构造、后台提交设置和底层 save/submit Adapter；同时提供只读 Player Pick discovery snapshot，未知字段保持为空交由纯解析层拒绝。
- `ea/player-pick.js`：Player Pick 待领取物品读取、跨 pile 重复检查、领取与确认选择。
- `ea/rarity.js`：只读 EA `repositories.Rarity`，按 `rareflag` 尝试取得特殊卡 card color map；只返回可序列化颜色候选，不决定 UI tier 或直接访问 DOM。
- `ea/trade.js`：Trade Access、金币、Transfer 容量、`UTSearchCriteriaDTO` 和 Item price limits 的白名单诊断边界；后续所有 `searchTransferMarket`、`bid`、`list`、`requestMarketData` 和交易对账调用只能在该 Adapter 内增加，并必须同步 Fake Adapter、contract 和 architecture tests。
- `ea/fsu.js`：按 `window.info`、命名/动态 window root、localStorage、sessionStorage 的既有优先级发现 FSU 策略，并合并所有来源的锁卡信息；同时投影 FSU Club 的 loading/provisional/ready 状态，转发定向 Club 校验和 scoped provisional access。完整契约、安全边界及与 Enhancer 的交互见 [FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md](FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)。
- `browser/dom.js`、`browser/storage.js`：DOM 查询/创建/事件构造和浏览器存储接口适配。
- `browser/http.js`：GM/fetch GET transport、Cookie/Header/timeout 和本地热加载 fallback。
- `browser/page-runtime.js`：EA Controller 链、名称、导航 Controller、DOM root、loading/popup shield、popup 候选、`gotoUnassigned` fallback、origin 和 FUT readiness；不决定页面导航顺序、奖励业务规则或点击策略。
- `browser/wait.js`：通用 predicate/FUT readiness/loading shield/EA observable 等待，保留 Stop、稳定窗口和超时语义。
- `browser/user-effects.js`：Clipboard、textarea fallback 和日志下载副作用。
- `fake/*`：Node 测试中的副作用替身。
- `index.js`：Adapter 集合工厂。

风险：最高。EA 模型字段变化、ID 解析、容量或 duplicate 状态错误会影响所有 Loop。

修改前必须：

1. 保存真实 EA 对象字段或日志证据。
2. 检查 fake adapter 和 contract tests。
3. 列出依赖该 Adapter 的所有共享事务和 Loop。
4. 不在 Adapter 中加入具体 Loop 名称或业务策略。

Trade Scheduler 的详细边界、阶段状态和真实页面验证顺序见 [docs/TRADE_SCHEDULER_DESIGN_ZH.md](docs/TRADE_SCHEDULER_DESIGN_ZH.md)。逐卡挂牌只能由 EA Trade Adapter 的单一 `services.Item.list()` 调用点执行，且必须经过 Prepared Plan、一次性 token、结构化显式批准、item ID 重解析、价格限制二次刷新和逐项回执。当前逐卡手动门禁只允许同一来源的 1-4 张 Club 卡，或 1-4 张 Transfer `inactive` 卡；Transfer reprice 必须在 Prepare 和每次 mutation 前刷新 Transfer、复核同一 item ID/definition ID/pile，挂牌后按同一 item 和精确价格回读 Active。混合来源和超过四张仍不得开放。Listing diagnostics 不得导出确认 token、原始 EA runtime 对象或原始错误 response。
Scheduled Transfer reprice 只接受 Transfer-only、`expiredPolicy=reprice`、`maxListings=1..4` 且 schedule 为 `once/daily/interval/window` 的 Job。单 Job 和多 Job 都必须显示与 schedule、数量、授权次数和精确 Job ID 集合一致的结构化摘要，并只接受 `approved: true`；不得要求或校验用户输入文字。执行器必须在授权消费前排除未知 Journal，按最多两项的 chunk 运行 transaction、逐张 heartbeat、同一 item 身份与价格回读；当前 Job 授权耗尽后只撤销该 Job，最后一份授权耗尽才全局回锁。混合来源、超过四张和 `next-login` 仍必须 fail-closed。

Re-list All 只能由 EA Trade Adapter 中唯一的 `services.Item.relistExpiredAuctions()` 调用点执行，不得由 UI、Scheduler、domain、Enhancer 或 FSU 直接调用。Preview 和执行前都必须刷新 Transfer；确认必须绑定最多 100 项的完整 Unsold item ID、definition ID、trade ID、Bid/Buy Now fingerprint。EA Transfer repository 中没有原拍卖 trade ID 和 Bid/Buy Now 的 Available Items 即使显示为 `inactive` 也不属于 Unsold，不能触发 aggregate mutation。手动非空执行要求 Scheduler paused/live-disabled；定时执行要求独立、有限且绑定 Job fingerprint 的授权。两者都必须在全局 Recovery 空闲、Operation Coordinator 和 Lease 可用时只获取一个 action-bound `bulk-relist` permit并发送一次聚合 mutation；空 Unsold 必须二次确认后以 `skipped-empty` 零 mutation 结束。成功必须逐项回读相同 item 为 Active；accepted 后刷新失败、partial 或无法确认必须保留 `unknown` 聚合 Journal并全局阻止新 Trade mutation，显式拒绝才可写终态 `failed`。该 Job 不提供卡片/价格/数量筛选，也不替代 Transfer Reprice；只允许 `once/daily/interval/window`，Interval 不低于 60 秒，最多读取 100 个 Unsold。mutation 前 pacing 或已有 429 cooldown 必须保存同一 occurrence continuation；mutation 已发送后的 429 不得自动重试。diagnostics、Journal、History、metrics、Audit 和 correlation 必须有界脱敏。V2-5 手动空列表和 19 项真实 Unsold，以及 V2-6 定时空/非空、Interval 去重和 Buy continuation 公平调度，均已于 2026-08-13 通过真实页面验证；F5 中途恢复是非阻塞补充项，不得据此放宽未知 Journal、授权或 mutation 门禁。

Trade Scheduler v2 的已确认目标、迁移顺序和验证门禁见 [docs/TRADE_SCHEDULER_V2_DESIGN_ZH.md](docs/TRADE_SCHEDULER_V2_DESIGN_ZH.md)。V2-1 至 V2-6 已完成：精确文字确认已由结构化风险摘要、明确选择、复选框和按钮替代；固定 `30/5 分钟`最坏路径预留已由可配置动作节流及 429 自适应冷却替代；Interval 已统一为秒级持久化，Buy/List 已支持可恢复时间片和跨类型公平轮转；手动及定时 Re-list All 已通过空/非空、Interval 去重和 Buy continuation 公平调度的 EA 页面验证。V2-7 只负责文档、完整验证和发布候选收口，不得借收口继续扩大交易边界。

EA Trade mutation 返回 HTTP/status `427` 时，必须分类为原因未知的 `auction-operation-blocked`：立即停止当前 Run，不重试，并在 GM storage 打开持久 Circuit Breaker。该熔断必须阻止后续 list/relist/bid/buy 等 Trade mutation，不能按普通 cooldown 自动 half-open；只有明确的人工 UI/API reset 才能清除。诊断仅允许记录 action、endpoint、status/code、安全 message、Job/Run ID、Trade Access 和容量摘要，不得记录请求头、Cookie、Token、原始 response body 或 EA 对象。

Trade Scheduler 必须默认 paused、`liveExecutionEnabled=false`，导入 Job 必须解除 armed。受保护调度最多允许 3 个 enabled+armed Job，每个 Job 都有独立、有限、带 fingerprint 和 expiry 的授权；`once/window` 授权 1 次，`daily/interval` 授权 2 次。所有 Job 共用一个 Operation Coordinator、Web Lock、持久 Lease 和 Request Pacer，全局同时只能有一个 Trade mutation Run。配置变化、Circuit、未知恢复证据或最后一份授权耗尽时必须原子回锁；一个 Job 授权失效时只撤销该 Job，仍有效的其它 Job 可以继续。混合 Listing 来源、`next-login`、非 Rare Gold Buy、单价超过 2000、总预算超过 8000、单 Run 超过 4 项和超过 3 个 armed Job 仍不得开放。单元/Fake/soak 测试不能替代有序实机验证。

Trade Scheduler v2 时间片约束：正常 Request Pacing 等待必须在 mutation permit 和 Journal mutation boundary 之前结束为有界 continuation；必须持久化同一 `runId`、`scheduledFor`、Job fingerprint、cursor、已完成数量和 `resumeAt`，释放 Lease/Operation Coordinator，不写 History、不推进 schedule、不重复消耗授权。授权必须两阶段执行：开始时 reserve，终态才 consume；异常必须清理未完成授权，deferred 才保留授权。`deferred` Journal 是同类型独占保留，只允许匹配 continuation Run 恢复，不能被手动交易、新 Job 或不同 run 覆盖；未知 mutation Journal 仍必须进入 Recovery。Continuation 等待期间允许另一种 Job 运行，同类型 Job 必须等待；相同 due 时间按持久化的 Buy/Listing/bulk-relist 三类型轮转。Interval 经过多个 occurrence 时只保留一个 pending occurrence，终态只增加一次 `runCount`，不得补跑历史 occurrence。

TS2c/TS3 的单卡和 TS8 的双卡约束是历史验证阶段；当前 Listing/reprice 单 Run 上限为 4，来源仍必须严格为 Club 或 Transfer 单一来源，misfire 仅允许 skip 或不超过 15 分钟的 grace-window。`once/window` 摘要包含一次 Run，`daily/interval` 摘要必须明确 2 Runs；多 Job 激活的结构化批准必须绑定当前全部 armed Job 的精确 ID 集合和总授权次数。不得扩展到混合来源、`next-login`、批量 relist 或超过 4 项。

Trade Scheduler 回锁必须通过 Job Store 的单次 `relock()` 同时完成 paused、`liveExecutionEnabled=false`、全部授权清理和所有 Job disarm；不得分别写入而留下可恢复的中间状态。Live Execution 开启期间的 Job 新增、编辑或删除必须先回锁，不得提供绕过结构化批准的通用 Resume。Scheduler 外层、Journal 和 Trade Transaction 必须共用同一 `runId` 与 `scheduledFor`；过期 Lease 和人工恢复只能写入脱敏 History/Audit，不得保存 Lease token。

Trade Scheduler tick 的恢复、授权、Circuit、Job 选择和 mutation 前置门禁必须全部位于同源独占 Web Lock 内；未获取锁时只能返回 busy，不得读取 active Journal 后回锁。无 Web Locks 时必须保留页面内 tick 互斥，GM storage lease 继续作为跨重载持久层。与当前未过期 Lease 的 `runId/jobId` 完全匹配的 active Journal 属于正常 in-flight 状态，不得显示 Recovery 或全局回锁；不匹配、无 active Lease 或 Lease 过期的未知 Journal 仍必须 fail-closed。Guarded Listing 在每个 `services.Item.list()` 前必须重新 heartbeat/验证 lease，验证失败时不得发出该次写请求；写请求一旦已接受或结果不明，仍必须完成原有 Transfer 对账，不得因后续 lease 状态跳过对账。

过期 lease 真实页验证只能通过显式 `approved: true` 和 `riskAccepted: true` 准备一条已过期的测试 lease；准备入口必须要求 Scheduler 已暂停、live execution 已关闭、恰好一个合规 armed 单次 Job、当前无任何 lease 且没有 Runner 操作。该入口只允许写测试 lease，不得开启 Scheduler 或调用 EA；随后仍必须通过结构化 Job 激活摘要触发，并以回锁、blocked History 和零 EA mutation 为唯一合格结果。

Scheduler diagnostics 必须保留当前页面生命周期内有上限的脱敏 tick 事件时间线，至少能区分 interval、startup、manual、focus、online、visibility 触发，以及 browser-lock-held、waiting-operation、waiting-session、completed、missed 和 blocked 状态。事件只能保存时间、状态/原因、Job/Run 与 runtime 摘要，不得保存 lease token、EA 原始响应或任意输入字段；后续 tick 不得覆盖掉用于判断双标签竞争和 Loop 占用的最近证据。

Club Listing 的 Prepare 必须先刷新 Transfer，并排除同时出现在 Unassigned、Storage 或 Transfer 的同一 item ID；Transaction 在每次 `services.Item.list()` 前必须再次刷新 Transfer 并复核该 item ID 尚未进入 Transfer。刷新失败、pile 冲突或实体位置不明确时必须在 EA 写请求前阻断。该约束同时适用于手动和定时 Listing，不得依赖 FSU Club 缓存是否声明 fully validated。

Guarded Listing 页面恢复时，如果检测到 FSU，`loading/not-ready` 必须保持 `waiting-session`。`trusted-provisional`、`validating` 或 `validation-failed` 是 FSU 的定向校验模式，不得等待其自动变成 fully validated；Prepared 选出 1-4 个 Club 候选后，必须在创建 Listing Transaction 前通过注入的 FSU Adapter 按 item ID + definition ID 一次性定向校验全部候选。接口不可用、请求失败、缺任意卡或未返回任一同一实体都必须阻断且不得调用 `services.Item.list()`。FSU 未检测到时仍通过 EA Trade Adapter 独立运行。Scheduler diagnostics 必须记录脱敏的 page/FSU readiness、Prepared/scan/blockers 和定向校验摘要，即使 Transaction 从未创建。

Auto Buy 必须按精确评分通道和单个 definition ID 搜索，不得跨评分或跨 definition 比价后购买。每个 EA 市场响应最多购买 `maxPurchasesPerSearch=1..4` 张，每张都必须重新校验 definition、rating、card class、Buy Now、剩余预算、金币、ownership、目标 pile 和 Transfer 容量；EA 活对象只能保存在 `src/adapters/ea/trade.js` 的当前响应闭包中，新搜索必须废弃旧引用。每次搜索和 Buy Now 前都要重新检查共享 circuit。Buy 响应不明确时不得重试；只有精确 item ID 已物化且金币扣减与 Buy Now 完全一致才能继续路由，否则以 `ambiguous` 停止。购买状态刷新失败、路由无法验证、Transfer 满或 EA `427` 都必须在下一次市场操作前停止。

手动真实购买门禁要求 Job enabled、unarmed、manual、Rare Gold、最多四个连续评分、`quantity=1..4`，单卡价格不得超过 2000，总预算不得超过 8000，Scheduler 必须保持 paused 且 `liveExecutionEnabled=false`。用户必须核对结构化风险摘要并直接批准，执行前重新生成只读 Preview，并在同一 Operation Coordinator 与跨 Tab lease 下运行；每次批准最多调用 N 次 `buyNowItem()`，每次 Buy 前必须 heartbeat lease。竞争失败会消耗一次 mutation attempt；lease 丢失、circuit 变化或任何不明确结果都必须停止整个 Run，保留之前的部分成功，且不得以同一批准重试。该门禁不得扩展到不连续或超过四个评分、数量大于 4、Common/Special、单卡超过 2000 或总预算超过 8000。

手动 Buy 可以提供仅作用于本次批准的预期去向 `Auto/Club/Transfer`，但不得写入 Job 或改变自动路由规则。`Club` 只能搜索当前 Club 未持有的 definition，`Transfer` 只能搜索当前 Club 已持有的 definition；每次搜索前和 Buy 前必须重新核对 ownership。没有匹配 definition、ownership 变化或 ownership 检查不可用时必须在 Buy 前阻断。选择 Transfer 且 Transfer List 容量不足时必须在下一次市场 mutation 前停止。

手动 Buy 的 History 和 diagnostics 必须各保留最终脱敏回执，包括搜索次数、`buyAttempts`、价格、金币变化、目标 pile 和停止原因；不得导出 lease token、EA 原始 response 或活动实体。一次批准只能写入一条 History Run，UI 关闭、重复点击和错误处理不得重复记账。

定时 Buy 允许作为最多 3 个 enabled+armed Job 之一，schedule 只允许 `once/daily/interval/window`，并继续限定 Rare Gold、最多四个连续评分、`quantity=1..4`、单卡不超过 2000、总预算不超过 8000；misfire 仅允许 skip 或不超过 15 分钟的 grace-window。激活前必须显式持久化全局 `minimumRetainedCoins`，不得提供静默默认值；Job 局部值只能提高有效底线，不能降低全局值。单 Job 和多 Job 都必须使用绑定 schedule、数量、保留金币、授权次数和精确 Job ID 集合的结构化批准。执行器必须在 Preview、搜索或 Buy 前验证并消费当前 Job 的独立授权；Scheduler 继续拥有跨 Tab lease，Buy 执行器不得另取第二条 lease。每次 Run 最多 N 次 `buyNowItem()` 且每个 chunk 最多两项，写 History 前必须走 Buy allowlist sanitizer。`next-login`、不连续或超过四个评分、其它 card class 和更高价格/预算仍必须 fail-closed。

Trade Scheduler 长期指标必须由 Job Store 在写入脱敏 History 的同一操作中累计，不得重新读取 EA 实体或增加网络请求。指标 schema 必须可从现有有界 History 回填，累计计数不得随 History 淘汰而丢失；status/job type 使用固定桶，停止原因必须截断、合并并限制条数，禁止持久化原始 response、错误对象、卡片详情或无界事件数组。UI 和 diagnostics 只读取这一脱敏快照。

Trade Job 配置导入/导出必须使用独立版本化格式，只包含 `id/name/type/enabled/schedule/misfirePolicy/policy` 等可移植 Job 字段。不得导出或接受 `armed`、History、metrics、runtime、paused/live 状态、批准状态或授权。导入必须限制文本大小和 Job 数量，拒绝未知字段、重复 ID 和不兼容 schema；所有 Job 完整验证成功后，才能通过 Job Store 单次原子替换，且该写入必须回锁 Scheduler、解除全部 Armed，同时保留本地 History、metrics 和全局设置。UI 必须先验证当前文本，再明确执行替换；文本变化后原验证立即失效。

Trade Provider 健康 UI 和 diagnostics 只能调用 Provider 自身的无网络 `inspect()`，不得通过 Preview、报价加载、球员目录加载或 EA Adapter 探测健康状态。健康快照只允许聚合 cache 状态、TTL、条目/通道数量、来源/平台计数和最近一次脱敏加载摘要；不得导出 definition ID、价格、URL 或原始错误。显式清除 Player Catalog 或 Price Quote cache 前必须先通过 Job Store `relock()` 暂停、关闭 live execution 并解除所有 Armed；清除本身不得发网络请求、写 Trade History 或改变 metrics。

所有 EA Trade 网络调用必须位于 `ea/trade.js` 的唯一调用点，并通过跨标签页共享 Request Pacer。Market Search、Buy、Listing 的 Job 间隔和 Buy 周期暂停必须可配置；429 使用共享、持久、带上限的自适应 cooldown，且不得打开 427 Circuit。Mutation 必须先取得绑定 action、一次性消费的 permit，再写 Journal mutation boundary，随后由 Adapter 消费 permit 并调用 EA；未取得 permit 时不得写 mutation boundary 或调用 EA。Buy 已确认后发生的路由/对账 429 必须保持 `ambiguous` 并触发 Recovery，不得自动重试。诊断只允许输出动作、`nextAllowedAt`、周期状态、cooldown 级别/恢复时间和锁支持状态，不得输出持久请求明细、卡片/definition、价格、URL 或原始响应。

Scheduler 公平选择状态必须持久化且保持有界，只记录最后实际 dispatch 的 Job ID/type/time 和累计次数。先按最早 `nextRunAt` 选择；只有 due time 相同时才优先选择与上次 dispatch 不同的 Buy/Listing 类型，同类型内按稳定 ID 排序。Lease 未取得、misfire advance、waiting/cooldown 不得计为 dispatch。每个候选必须使用自身 Request Pacer 状态评估 429 cooldown，不能用第一个 armed Job 的状态代表其它 Job。

Listing 和 Buy live Run 都必须写入各自的持久 bounded Journal，保存 Run/Job ID、最多 4 个 item 的 Prepare、mutation boundary、脱敏 EA response、reconciliation 和 terminal phase。Journal 不得保存 token、Cookie、原始 EA 对象或 response body。任一 Buy/Listing Journal 已跨 mutation boundary 且结果不确定时，必须全局阻止所有新 Trade 写操作，并在授权消费前停止。不得自动 acknowledge 或重试；Recovery UI 必须展示 `runId`、阶段、数量和 evidence hash，要求 Scheduler 锁定、Runner 空闲、无 active Lease、明确选择固定 resolution，并勾选默认关闭的风险确认。人工批准只允许归档 Journal、写有界本地 Audit 和同 `runId` 的脱敏 blocked History，不调用 EA。

过期 Lease 必须使用两阶段接管：`acquire()` 发现过期记录时不得覆盖；先按相同 `runId` 检查终态 History 和未知 Journal，再显式清理旧 Lease，最后为新 Run 获取 Lease。未知 Journal 继续由对应 Recovery 项处理；没有 Journal/History 的 mutation 前崩溃显示 `LEASE Recovery`，要求固定 resolution 和默认关闭的风险确认，只写 Audit/blocked History，不直接清理 Lease或调用 EA。只有匹配终态 History 且无未知 Journal 时才允许下次 Scheduler 清理过期 Lease。History、Journal、Audit、Scheduler events 和 diagnostics correlation 都必须有界、脱敏并按 `runId` 关联。

Trade card class 必须保持明确：`common-gold` 只匹配非特殊普金，`rare-gold` 只匹配非特殊稀有金，`normal-gold` 匹配两者但排除特殊卡，`special` 只匹配特殊卡；兼容别名 `gold` 等同 `normal-gold`，不得借此把特殊卡混入普通金卡规则。

### 5.4 `src/selection`

文件：

- `index.js`：统一入口 `selectInventoryPlayers()`；根据 `mode` 分发 requirements 或 rating。
- `inventory.js`：按 requirements、pile、FSU 和保护策略选择普通库存材料。
- `rating.js`：评分型 SBC 最低可行评分向量和同向量来源选择。
- `rating-policy.js`：归一化评分选材的 required/preferred/protected item、exclusive role、Protection rating、Provisions 储备和 Club Other Special 软保护；只输出可序列化分类、计数和评分直方图。
- `rating-model.js`：动态 Challenge eligibility 到评分模型的纯解析，以及保存前后阵容的评分/人数/唯一性/特殊卡校验。
- `rating-candidates.js`：通过注入的安全过滤、pile 读取和快照函数构建评分候选，并将纯评分计划回解到实时对象。
- `transient-signals.js`：合并开包响应中尚未稳定出现在 Repository 的 Unassigned signal。

风险：最高。

影响范围：

- requirements 模式：Daily Common/Rare、Player Pick、Provision stages、Rare Pack 2x84+、Unassigned recovery、普通 fill-and-verify。
- rating 模式：84+ TOTW、84x10、自动 TOTW、未来评分 SBC。
- transient signal：Rare Pack、Provision 和任何开包响应早于 UI/Repository 的流程。

核心不变量：

- 同一阵容不能重复使用相同 `definitionId`。
- consumed、protected、loan、limited-use、concept、academy 和 active trade 必须排除；FSU Lock 在 `protectFsuLockedPlayers` 开启时必须排除。
- Unassigned/Transfer 只作为 duplicate signal，最终必须解析到真实 submission item。
- requirements 模式严格保持 count、tier、rarity、special 和评分上限。
- rating 模式先基于实时评分桶构造最低可行评分配方，再按配方比较 pile；不能因 Storage 优先而选择不必要的高分卡。
- rating 模式必须从当前 Challenge 读取人数、TEAM_RATING 和可识别的球员条件；遇到 chemistry 或未知 eligibility key 时停止。
- role-aware rating 模式必须通过 `constraintId`/`constraintIndex` 复用候选构建阶段执行过的 live EA matcher；Required Special 的 `minCount/maxCount` 必须在计划和保存后验证中均为一，不能把第二张匹配卡当普通评分材料。
- `requiredItems` 必须进入计划，`protectedItems` 必须排除，`preferredItems` 只用于同一最低评分向量内的确定性排序。非 Required Special 的当前配置 Provisions Reserve 和高于 `maxOrdinaryRating` 的卡不能进入普通候选。
- Club Other Special 只能通过显式 `softProtectSpecialPiles` 进入最后候选层；允许 Other Special 作为普通材料还必须显式设置 `allowOtherSpecialAsOrdinary`。这些字段缺失时必须走原评分选择路径并保持 differential 输出不变。
- role-aware 失败必须使用 `PLAYER_COUNT_SHORTAGE`、`SQUAD_RATING_SHORTAGE`、`REQUIRED_SPECIAL_SHORTAGE`、`RESERVED_FODDER_BLOCKED` 或 `LIVE_REQUIREMENT_UNAVAILABLE`，诊断只能包含有界计数、评分直方图、最高可达评分和角色数量，禁止输出完整卡对象。
- 高评级 xN Upgrade 可以有多个 Challenge，但每个 Challenge 都必须独立通过同一套人数、评分、特殊卡和未知条件校验。运行时必须按当前未完成 Challenge 物化策略；中间 Challenge 提交只推进 Set 进度，不计为一轮且不得开 Set 奖励，最后 Challenge 必须观察到真实奖励后才能计为完成并继续下一轮。
- rating 配方规划不得枚举卡实例组合。候选构建只允许 O(N) 安全过滤和评分建桶；正常规划必须在评分直方图上按单调可行性构造最低精确目标向量，状态规模只依赖当前实际存在的 `47..99` 评分档和最多 11 个阵容位置。只有该向量无法满足 live 角色物化或评分出现不连续跳跃时才允许进入完整评分桶兜底；不得在普通 4,000+ 卡场景触发兜底。相同截断直方图必须复用有界 LRU 配方缓存；库存从数百张增长到数万张不得扩大配方状态图，并必须由 4,000+ 实体和完整评分档性能测试锁定。
- EA Inventory Adapter 合并 `repository.club.items` 与 `services.Item.itemDao.itemRepo.club.items` 时必须按稳定 item ID 去重；两个 Repository 可能在页面切换后同时暴露同一批 Club 实体，禁止把双源拼接结果直接交给 Ledger。无 item ID 的对象只能按同一对象引用去重，不能按 definition ID 合并真实重复卡。
- `ratingSbcFill.maxSearchNodes`、`maxSearchMs` 和 `yieldEveryNodes` 已废弃。不得重新引入节点上限/超时作为正常不可行结果；最高评分配方不足时返回 `SQUAD_RATING_SHORTAGE`，配方无法满足 live 角色/条件时输出评分桶、配方尝试数和物化诊断。
- 评分型 Live 使用 EA SBC DAO 的后台 Challenge/Squad/submit 集成路径，避免创建可视 squad controller 触发 FSU/Enhancer 页面增强；这不允许绕过 FSU 候选过滤。

修改后至少运行 selection unit、characterization、differential tests 和所有相关 workflow tests。

### 5.5 `src/pack`

文件：

- `open-transaction.js`：统一开包事务、重试、响应标准化和 receipt。
- `opened-item-policy.js`：把已开物品分为 reserved、routed、pending。
- `upgrade-duplicate-routing.js`：升级包重复卡分类。

风险：最高。

影响范围：Daily Bronze/Silver、Daily Common shortage pack、Daily Rare source pack、Rare Pack、Provision、TOTW reward、自动 fodder reward 等所有开包路径。

核心不变量：

- 开包前先处理或明确保留已有 Unassigned。
- 每个开包调用必须提供 opened-item policy。
- 可选 `onReceipt` observer 在最终 receipt 形成后、事务返回前执行；observer 失败必须由 `onReceiptError` 隔离，不能覆盖已经成功的 EA 开包结果。
- response item 与 Repository 延迟必须被 receipt/transient signal 覆盖。
- EA pack response 经常早于 Unassigned cache。成功开包后必须先标准化 response items，并可直接移动已确认的非重复卡；默认情况下，response duplicate 只用于恢复迟到的 duplicate metadata、通知和后续确认，不得直接作为重复卡移动实体。可交易重复、不可交易重复、swap 和当前 stage 保留材料必须等待 live Unassigned Repository 实体出现后再按 policy 路由，然后刷新 recent reward/Repository 状态，才允许下一次选材或开下一包。唯一例外是 Batch Open 的有界最终兜底：必须已经完成主动打开 Unassigned、连续稳定读取、通用 resolver 和全部 settlement retry，确认没有新增 live Unassigned 实体，并按开包前 baseline 验证目标 pile 新实体；同时必须聚合检查 Storage/Transfer 容量，其中 swap 也计入 Transfer 占用。任何条件不满足都必须 preserve 并停止后续包。
- 全重复包可能没有任何 direct move 来触发 EA 的 Purchased/Unassigned 页面模型；当 response 全是 duplicate 且 Repository 仍为空时，必须主动打开 Unassigned 页面并进行连续空读确认，再让通用 resolver 处理 live 实体。若 Pack Controller 的第一次进入请求无动作，恢复流程必须先主动刷新 Unassigned 以物化 live 实体，并在离开 Pack 前重试；仍失败时只允许经 Home 再刷新和重试一次，最终仍未确认 Unassigned Controller 就必须停止。pending settlement 的后续尝试也必须执行页面同步，不能只重复调用 Item service。
- 不得把“先清理旧 Unassigned”和“开包成功后的 response materialization”混为同一步。开包后的 response 处理必须先于该奖励产生的残留 Unassigned cleanup，否则下一轮会误报缺料或遗留重复卡。
- EA/FSU 丢失实时 `duplicateId` 时，Inventory Adapter 只允许从 Club/Storage 中 `definitionId`、评分和 `rareflag` 都一致的同版本卡回补 latent duplicate；同 `definitionId` 但评分或卡型不同的动态异版本必须保持非重复并路由到 Club。
- 471、500、404 和 stale pack 的重试必须有界。
- `open-transaction.js` 必须显式标准化 `items`、`response.items`、`data.items` 和 `response.data.items`；`undefined`/`null` callback、成功但缺少 items、Observable timeout 和 transport exception 必须有独立 reason，禁止统一压缩为无诊断价值的 `unknown`。
- 默认开包恢复只允许一次有界重试。`471/500/512/521` 和空响应、缺失 items、transport error/timeout 可以在完成 Unassigned、导航和 Pack Repository 同步后重试；`404` 仅在调用方允许 gone 语义时作为 stale；`429` 不得立即增加请求压力，必须保留明确 blocked reason。
- 空响应、缺失 items、transport error/timeout 和未知响应属于 ambiguous Pack instance；重试前必须排除当前对象引用并重新解析同类型 live instance，不能直接再次调用同一对象。
- 开包故障处理必须由 `tests/fixtures/packs` 中的脱敏响应矩阵覆盖。新增生产响应形状或错误码时，先增加 fixture 和失败测试，再修改标准化或重试策略。
- 开第二包前必须重新检查 Unassigned 和容量。

任何共享事务改动都需要 pack unit tests、受影响 workflow tests，并在真实页面验证多包流程。

### 5.6 `src/unassigned`

文件：

- `plan.js`：纯规划，按非重复、可交易重复、可 Swap、Storage 的顺序返回动作或 blocked。
- `resolve.js`：执行规划、检查指纹进展、调用 overflow resolver、限制迭代和递归。
- `recovery.js`：把 blocked item 与恢复策略、Selection 和 SBC recipe 连接。
- `navigation.js`：纯导航状态机，区分“请求已发出”和“目标控制器已确认”，并记录每个有界 fallback 的前后控制器。
- `runtime-navigation.js`：通过注入的 Page/DOM effects 编排 Store Pack、Home 和文本入口恢复；不读取运行时全局。

风险：最高。几乎所有 Loop 的开始、开包后、提交后和最终收尾都会经过 Unassigned。

核心不变量：

- `plan` 不写具体 SBC 或 Loop 名称。
- Loop 专属保留通过 `reserveItem` 回调注入。
- `supplyAndCraft` 的 primary piles 包含 Unassigned 时，符合当前 SBC requirements 的 duplicate signals 必须在 pre-selection cleanup 中保留，先交给当前阵容消费；不得先移动到 Storage，也不得在这些信号未参与 fallback 选材前继续开 shortage pack。
- 容量 fail-safe 通过配置化 overflow resolver 注入。
- action 或 resolver 报告 progress 后，Unassigned fingerprint 必须变化。
- EA move/swap 返回 success 后 Repository 可能仍短暂保留旧 Unassigned 实体；必须有界重读并确认 fingerprint 变化，不能立即对同一实体规划第二次 move，也不能无限等待。
- `gotoUnassigned()`、按钮点击或 recovery 返回 `true`/`requested:true` 只表示请求已发出；只有观测到 `UTUnassigned*` 控制器后才可读取 Unassigned 或继续下一包。
- action description、日志文本和 SBC 显示名称不得作为 duplicate/non-duplicate、destination 或导航成功状态；执行分支必须读取结构化字段。
- 导航恢复策略只允许位于 `src/unassigned/navigation.js` 和 `runtime-navigation.js`；不得在 `userscript-entry.js` 重新按 Home/Store/Pack 控制器名称追加分支。
- 必须有最大迭代和递归保护。
- 无进展时安全停止，不能继续开包扩大阻塞。

修改时必须覆盖空、非重复、可交易重复、不可交易重复、Swap、Storage 满、Transfer 满、两者满、recovery 无进展，以及连续两轮从不同控制器进入 Unassigned。导航测试必须包含“请求返回成功但控制器不变”。

### 5.7 `src/sbc`

文件：

- `submit-attempt.js`：统一 Challenge 获取、Squad Provider、保存前/后 validator、保存、提交和结果。
- `fsu-runtime-access.js`：纯化 provisional Club 定向校验结果的匹配、关键属性对比、实体替换和顺序保持。

风险：最高。

`submitSbcAttempt()` 被 Inventory、Rating、FSU fill 和 Existing Squad Provider 复用。修改会影响 Daily、Player Pick、Provision、Rare Pack、84+ TOTW、84x10 和恢复 SBC。

核心不变量：

- Challenge 不可用返回 `unavailable`，不提交旧 Challenge。
- Squad Provider 只提供计划，不绕过 validator。
- Dry run 返回 `planned`，不保存或提交。
- 保存后重新读取实际阵容并运行 post-save validator。
- Submit 不 ready 时停止。
- provisional FSU 只校验 `pile: club`；必须按 item ID 与 definition ID 同时匹配，缺失或关键属性变化时停止，不得静默重选。
- 定向校验通过后，Club 位置必须替换为新 EA 实体且保持原阵容顺序；FSU 可视填充已先保存旧实体时，最终提交前只在确有 refreshed Club 实体时补一次保存。
- 成功提交后才标记 consumed 和处理奖励。
- 可选 `onResult` observer 必须在 confirmed result 形成后、`afterSubmit` 打开奖励前执行；observer 失败由 `onResultError` 隔离，不能把 EA 已提交成功改写为失败。

### 5.8 `src/reward`

文件：

- `sbc-claim.js`：编排有限 Claim Rewards 等待，并通过 Pack 计数或 SBC 进度判断奖励是否已经发放。
- `player-pick.js`：Player Pick 候选排序和人工介入原因。
- `player-pick-recap.js`：把 Pick 结果投影为统一单卡 recap model，并提供 23 条本地 Preview。
- `loop-recap.js`：普通 Loop 的 Pack receipt 投影、球员/tier/special 识别和 Rare Gold/Special 展示门槛；不负责运行时 session 或 UI。
- `batch-open-recap.js`：把 Batch receipt 投影为统一单卡 recap model；复用 `loop-recap.js` 的卡片资格判断，保留 pack/tier 汇总、特殊卡价格和 23 条本地 Preview，不再聚合普通球员行。
- `recap.js`：Player Pick、普通 Loop 与 Batch Open 共用的单卡排序、固定 15 条分页、颜色解析、对比度和 tier theme 纯模型。
- `player-prices.js`：FUT.GG 价格解析、FUTNext fallback 和结构化诊断。
- `pack-highlight.js`：从通用 Pack receipt 识别达到阈值的特殊卡，并生成本地/远程通知模型；不执行 DOM 或网络副作用。
- `rolling-recap.js`：Rolling 专属流式 Recap 聚合器和模型。只保存有界的可序列化卡片摘要、计数、评分直方图、重复卡去向、停止点和最终资源；top cards 默认上限 50，Alert-qualifying Special 摘要默认上限 100。不得把完整 EA item、Pack receipt 或响应对象放进长期会话状态。

Reward 模块不直接访问 EA Service 或 DOM。Claim Rewards 通过注入的 Overlay、Page shield、Pack/SBC 快照、Wait 和输入事件回调保持 25 秒上限及提前确认规则；价格 HTTP transport 由 Browser HTTP Adapter 注入，FUT.GG/FUTNext URL、解析和 fallback 在 Reward service 中。待领取 Pick 名称/Loop 别名分类位于 `src/reward/player-pick.js`；真实待领取物品读取、跨 pile 重复检查、领取和确认选择通过 `src/adapters/ea/player-pick.js`；人工选择弹窗位于 `src/ui/player-pick-modal.js`。

Player Pick 候选先按评分、Special、非重复排序；同组价格完整时再按价格排序，任一价格缺失时随机打散同组。只有并列最高评分的 Special 数量超过 `pickCount` 时才进入人工选择；可选名额足以覆盖全部并列最高 Special 时必须自动选择，普通卡或非最高优先级的缺价并列不得阻塞流程。`Auto-pick below N` 命中时继续跳过人工歧义检查。

### 5.9 `src/workflows`

Workflow 是无 EA/DOM 依赖的状态机：

- `recycle.js`：重复卡、奖励包和 seed SBC 循环。
- `supply-and-craft.js`：库存选择、补货包、fallback 和重复提交。
- `pack-and-craft.js`：源包、恢复状态和有序 crafting stages。
- `player-pick.js`：pending Pick 优先、Challenge 提交、即时领取或达到上限后集中领取，以及 Pick 计数。
- `repeated-submission.js`：重复提交型流程。
- `reserved-duplicate-crafting.js`：Provision/Rare Pack 共用的重复材料 crafting 迭代、Dry Run 和停止状态。
- `sequence.js`：One-click 等有序子流程。
- `validation-round.js`：Bronze Upgrade Validation 的 Dry/Live 共用编排。
- `batch-open.js`：独立批量开包状态机；按配置顺序执行，每次打开前重新解析实时 pack 实例，记录 opened/skipped/blocked/stopped 和回执。
- `rolling-upgrade.js`：10x85+ 主循环状态机；只编排注入的 preflight、库存索引、包查找/开启、分类、Storage 路由、单步恢复、主阵规划/提交和对账，不直接访问 EA/FSU/DOM。
- `dispatch.js`：strategy 到 runner 的统一分发，以及标准/Player Pick 收尾回调顺序。

风险：中高。通常影响同一 strategy 的全部 Loop，但不应直接影响其它 strategy。

Workflow 返回结构化状态：`completed`、`planned`、`unavailable`、`insufficient` 或 `blocked`。不要用异常代替正常的材料不足和活动已完成；不可恢复的运行时错误才抛异常。

Rolling 的正数 completion 只统计主 10x85+ 提交，`0` 表示运行到 Stop、资源/Storage/安全门禁阻断。Dry Run 使用同一 planner，并在第一个未知随机奖励或提交边界返回 `planned`。恢复链每次只执行一个动作并回到统一规划点，不得从 Workflow 内递归调用恢复 Loop；每个动作必须改变 Inventory Ledger 进度指纹，并受每主周期恢复预算约束。

Rolling 每轮先查找并开启已有主 `10x85+` reward。`rollingSurplusCraftingEnabled=false` 时，本轮主包的 85-89 可用重复卡直接进入主 Solver，不处理 `duplicate-reserve`，也不运行主阵后的 Storage Provisions/TOTW 维护；若精确 84 阵无法容纳全部重复卡，必须按评分从高到低放宽并将放宽卡存入 Storage。开启余量制作后，完整 Reserve 组才先执行 `duplicate-reserve`。缺料或紧急恢复刚提交的 Provisions reward 以及 5x80+ reward 必须由 `pendingRecoveryReward` 精确驱动并立即开启；主动 `duplicate-reserve` Provisions reward 默认保留在 My Packs，只有 `rollingOpenDuplicateProvisionsRewards=true` 才立即开启。库存启动时不得仅因 My Packs 中存在历史 Provisions/5x80+ reward 就抢在可行主阵前开启；只有主 Solver 明确返回普通材料不足后，才进入 leftover sweep，清空遗留包并重新规划，仍缺料才允许新做一套 Provisions。缺 Required Special 时先开已有 TOTW reward，再做一套动态 TOTW Upgrade；TOTW 阵缺料时允许 Provisions -> Gold drain -> TOTW -> 主 SBC。恢复阵容默认硬排除 Required Special；仅普通 Provisions shortage 且显式开启 `rollingAllowClubCurrentPoolSpecialsForProvisions` 时，可把通过 live matcher、评分范围和全部安全门禁的精确 Club current-pool item 作为最后候选。

关闭余量制作时，Provisions 只有两种必要恢复来源：主 Solver 返回普通材料不足，或 Storage 压力阻止受保护卡安全路由。开启余量制作后才增加当前主包完整 Reserve 的 `duplicate-reserve` 和主阵后的 Storage 维护来源。每次 Provisions/TOTW 提交后必须重新读取 ledger 并重新规划，不得复用旧库存决策。

Rolling 开启任何主包、TOTW、Provisions 或 5x80+ reward 时只能使用 EA `My Packs` Repository 中当前存在的真实 pack 实例。Store catalog/`lastStorePacks` 只能用于展示和发现，不得作为可开启对象；同 ID 多个真实实例必须逐个消费，已消费对象不得被 catalog fallback 重新选中。

### 5.10 `src/ui`

当前已模块化：

- `log-renderer.js`：简洁/完整日志投影和批量刷新。
- `main-panel-view.js`：主面板 HTML/CSS 和幂等挂载。
- `main-panel-geometry.js`：Options/Hide、`L`、拖动、resize、默认/最小尺寸和位置保存。
- `main-panel-bindings.js`：选项回填和 UI command 事件转发。
- `main-panel-commands.js`：刷新、配置加载、Stop、复制和下载日志等主面板 command 编排。
- `main-panel-state.js`：Loop 列表、rounds、recap 和 disabled 状态投影。
- `selection-policy-settings.js`：按 Standard SBC、Rolling/Player Pick 和 Pick redemption 作用域编辑选材策略；主面板只显示摘要，不并排暴露多个容易混淆的评分阈值。
- `runtime-telemetry.js`：Runtime Telemetry phase 文案、指标、Storage 压力和 ARIA 的纯 DOM 投影。
- `responsive-layout.js`：共享 Desktop/Tablet/Mobile 布局与 pointer/touch 输入判定、持久化覆盖和 viewport 监听。
- `responsive-dialog.js`：Batch Open、Player Pick、recap、Reward Alert 和 Help 共用的移动全屏、安全区与触摸目标样式。
- `workflow-loop-builder-view.js`：全屏 Builder 的结构化 Workflow、Loop、Recovery、Dynamic SBC、Preview 和 JSON validation UI。
- `workflow-loop-builder.js`：Builder Profile 生命周期、Undo/Redo、事件编排、持久化和经过验证的 runtime activation。
- `player-pick-modal.js`：人工 Player Pick 选择。
- `player-pick-recap.js`：Player Pick recap 汇总、卡片列表、价格展示和关闭。
- `loop-recap.js`：普通 Loop recap 的共享 UI 入口；只调用通用 card renderer。
- `reward-celebration.js`：Pick recap 与 Pack Highlight 共用的烟花动画。
- `reward-highlight.js`：靠近主面板显示的非阻塞 Pack Highlight Toast。
- `reward-alert-settings.js`：Reward Alerts 独立设置弹窗及 Preview/Desktop/ntfy 测试入口。
- `batch-open-dialog.js`：My Packs 扫描、Add 1/Add all 下拉菜单、记忆列表、数量编辑、Preview 和 Start 命令弹窗。
- `batch-open-recap.js`：批量开包汇总弹窗；不负责开包、通知或库存处理。
- `card-recap.js`：Player Pick、普通 Loop 与 Batch Open 共用的单卡列表、reason、分页、Close 和 Stop 关闭 renderer；不访问 EA Repository。
- `sbc-reward-overlay.js`：Claim Rewards 控件、奖励 Controller/DOM 覆盖层识别和关闭。

风险：

- `log-renderer.js`：中等，影响日志刷新性能和简洁/完整日志显示。
- `main-panel-*`：中等，容易产生简洁模式回归、重复日志栏、尺寸无法恢复或 command 未转发等问题。
- `runtime-telemetry.js`：中等，高频重绘可能卡住日志，错误的未知值或 Storage 比例会误导用户。
- `player-pick-modal.js`：中等，影响人工 Pick 的选择数量、Stop 中断和弹窗清理。
- `sbc-reward-overlay.js`：中高，影响页面型 SBC 奖励覆盖层识别和关闭；25 秒等待、Pack 增量和 SBC 进度确认位于 `src/reward/sbc-claim.js`。

UI 修改要检查简洁模式、Options 模式、`L`、拖动、resize、长文本、日志高频更新和 Pick recap。Options 展开后设置控件可以在独立区域滚动，但日志必须始终保留独立的可视滚动区域，不能因为配置变长而被 flex 压缩或裁掉。

Selection Policy 的三个评分概念必须保持作用域清晰：`lowRatedGoldMaxRating` 只限制非评分普通 SBC 的 Gold；`ratingSbcMaxCardRating` 只限制普通 Rating SBC；`protectionRating` 使用包含边界的 `<=` 语义，只供 Rolling 自动回填和 Player Pick 自动处理共享。Rolling 主阵与恢复阵不得被普通 Rating SBC 上限再次压低。旧 `autoPickThreshold` 只作迁移输入，不能重新出现在主面板。

Rolling Runtime Telemetry 只能渲染 workflow/entry 发布的结构化 snapshot，不得解析日志或自行扫描 EA 库存。能力计算按 ledger `inventoryVersion` 串行合并，旧版本结果不得覆盖新版本；只允许对已有 classified entries 做 O(n) 计数，`Direct cycles` 和 `TOTW recoveries` 显示未知，严禁在 Telemetry 中调用评分 Solver。Telemetry 仅在 Rolling 运行时显示，普通 Loop、Batch 和 Trade 保持隐藏；Desktop 预留稳定高度，Mobile Run 使用受限内容高度，icon-only 必须隐藏。高频 phase/capability 更新必须合并到至多每个 animation frame 一次，并用 10,000 次更新测试锁定。

Rolling Recap 只在 `rollingUpgrade` 会话启用；生产 workflow 传入 `retainReceipts:false`，普通 Loop、Batch 和 Pick 的既有 Recap retention 不得被改变。Pack Reward Alert 仍由共享 `openPack()` transaction 发送一次；Rolling 85+ Pick 确认后如需通知必须复用 `publishPackHighlight()`，Recap 构建、价格查询和 FUTBIN 补全不得再次发送 Desktop、ntfy 或 Toast。任何 retention 上限、省略计数或恢复/路由计数变更都必须增加纯单元测试和长跑边界测试。

响应式 UI 必须遵守以下约束：

- 布局只能由可视区域、pointer/hover media query 和用户保存的 `Auto | Desktop | Mobile` 覆盖决定；禁止使用 User-Agent 分叉实现。
- `layout` 与 `input` 是两个独立维度。Desktop 可以使用 touch target，Mobile 也可以由精确 pointer 操作；不得用其中一个暗示另一个。
- 用户手动覆盖必须优先于自动断点。旧 `@media(max-width)` 规则不得绕过 `data-dlr-layout` 重新启用另一套主面板或 Builder 结构。
- Desktop、Tablet 和 Mobile 必须共享同一个 runtime、Profile、日志和 command 状态；resize、旋转和 Layout 切换不得重建或停止运行会话。
- Mobile 使用独立底部面板几何，不能覆盖保存的 Desktop 位置、尺寸或完整日志高度。Mobile 底部面板禁止拖动和 resize，但折叠图标必须可拖动、限制在可视区域并使用独立持久化位置；运行开始后必须回到保留 Stop 的紧凑 Run 控制器。
- 触摸输入的交互目标最小 44px；文本输入在触摸布局中不得低于 16px，避免移动浏览器自动缩放。
- Mobile 面板和对话框必须使用 `dvh`、`env(safe-area-inset-*)`、稳定滚动区域和不被底部手势区域遮挡的操作栏。
- Builder Mobile 必须保持 Library、Editor、Details 单视图导航，选择对象进入 Editor、选择 Workflow step 进入 Details；Save、Activate、Close 在长表单中始终可达。
- Batch Open、Player Pick、通用 recap、Reward Alert、Help 和 Pack Highlight 必须读取共享响应式状态，不得分别引入宽度判断或另一套业务状态。
- 移动浏览器后台/锁屏可能暂停页面，UI 不得声称后台可靠运行；相关限制必须保留在用户文档和发布验收中。

Workflow/Loop Builder 的完整设计与阶段状态见 `docs/WORKFLOW_LOOP_BUILDER.md`。Builder Profile、草稿、override、冲突和动态绑定只能存在于 `src/config/builder-*` 与 `src/ui/workflow-loop-builder*`；runner、workflow 和 EA Adapter 仍只接受 `loop-schema.js` 的物化配置。Raw JSON 只允许验证、导入和导出，不得恢复主面板直接执行 JSON 的入口。Draft 可以处于暂时无效状态并跨重载保留，但启动和 Activate 只能使用完整验证的 last-known-good。Dynamic SBC 持久化后必须先标记 unavailable，只有本次只读扫描按稳定 Set/Reward identity 刷新成功才可物化；禁止把上次快照作为静态 Loop 静默执行。

Dynamic SBC 缓存只能缓存只读 Challenge 快照，不能缓存“可运行”结论。启动时可以先解析缓存用于恢复面板和 Builder 展示，但 live Set/Category 校验完成前必须保持运行入口禁用。每次启动/手动扫描必须刷新当前 Set/Category 索引，并逐个按 Set ID、名称、时间、repeat、Category、Challenge ID 和奖励身份计算结构指纹；`timesCompleted`/complete 只作为 live progress 合并，不能让所有 SBC 因进度变化失效。只有本次索引验证成功、指纹未变且未过 TTL 的条目可直接复用 Challenge 快照；当前 Set 未完成时，空 Challenge 快照不是有效 cache hit，必须重新读取，避免把此前已完成状态下保存的空快照跨每日/活动重置复用。若当前索引只是从缺失 Challenge ID/Category 细节补全为与缓存 Challenge 快照一致的身份，而 Set ID、名称、repeat、时间、Upgrade Category 结论和奖励身份未变，应归一化为 `compatible-hit`，不得因非语义补全重读全部 Challenge。parser 版本变化可以重解析仍符合 cache schema 的原始快照，不得仅因 parser 升级丢弃全部 Challenge 数据。新建、真实结构变化、TTL 过期的 SBC 必须尝试重读 Challenge；加载失败不得把空快照写回覆盖好缓存。只有当前 Set 索引已验证，且 Set、奖励、Category、repeat、时间和已暴露 Challenge ID 与缓存兼容时，才允许以 `load-failed-compatible-cache` 降级继续使用此前验证的非空 Challenge 快照；真实身份变化、没有缓存或只有空快照的未完成 SBC 必须保持 unavailable。Full rescan 也遵守该降级规则，不得因为 EA 临时限流删除兼容的有效 Loop；Clear cache 后没有可降级缓存。Challenge 读取遇到 `429` 必须立即打开当前 pass 的扫描级熔断，不再请求后续候选；`426/512/521` 每个候选最多额外重试一次，禁止无界重试。一次 Scan 操作最多自动执行 3 个 pass，后续 pass 必须关闭 `forceFull`/`clearCache` 并只通过增量缓存机制重试 unresolved SBC；pass 之间保持退避，第三次仍失败则结束并保留 unavailable，不得无限等待。熔断后的兼容对象使用缓存，新对象或不兼容对象保持 unavailable，并在汇总日志记录 cache fallback、熔断次数和跳过请求数。所有 Incremental、Full 和 Clear-cache 扫描共用账号级 Challenge 请求健康度：记录实际请求数、错误码和失败率，以最近 24 小时的指数平滑结果选择至少 800-3000ms 的请求起始间隔；本轮出现 `426/512/521` 后立即放慢到至少 2500ms，出现 `429` 后记录 3000ms 建议值并熔断，连续健康扫描才逐步恢复。该健康度只调节读取频率，不允许改变缓存身份校验或安全 parser 结论。扫描前可用 Set 索引排除解析器明确不支持的多 Challenge/非 Pack Upgrade，但已识别的高评级 xN、TOTW、2x84、Player Pick，以及当前 Loop/Recovery `activityBinding` 声明的 SBC 名称候选必须保留；名称在这里只允许决定是否请求 Challenge，不能代替 Category/requirements 做 family 判定。仅在没有持久化 Set 快照的冷扫描中，EA Repository 已包含完整人数和 eligibility 时才可直接复用且不得再加载 squad，已有缓存过期或真实结构变化时仍必须 live DAO 校验。direct DAO 请求失败后不得立即通过标准 Service 重复请求同一 endpoint。Upgrade 发现必须由 EA 权威 Category 明确证明属于 `Upgrades`，禁止从名称猜 Category；只允许白名单家族，安全上限和高卡/特殊卡保护必须来自受审查的通用 family policy/Profile，禁止从奖励评分推导提交保护。

主面板 Profile 选择器只能激活 Profile 的 Saved/last-known-good，不得隐式保存或应用 Draft。内置 Starter Profile 在 Store 归一化时只补缺，不得覆盖同 ID 的现有用户 Profile。旧版缺失 `preset`、名称仍为 `Default`、没有动态绑定且 Draft/Saved/last-known-good 均严格等于其旧 base 的 Default 可以先补齐官方标记再随当前 built-in rebase；任何内容被修改过的同名旧 Profile 必须保持冲突保护。Built-in、Default 和 `Bronze/Silver Inventory Only` 的 `One-click Daily Loop` 固定为 Daily Bronze -> Daily Silver -> Daily Common -> Daily Rare 四步，不得隐式追加 Rare Pack 回收；`Daily + Rare Pack Recycling` 可以追加 Rare Gold Premium/Baseline 第 5 步，`Daily + Rare Pack to 5x80+` 可以追加 quantity-first Common Gold Premium、Rare-only 填充的第 5 步，两者都必须保持 `useRoundsAsCompletions:false` 与最多一次库存 fallback，且不得互相覆盖。独立 Rare Pack Loop 在所有配置中仍保留。旧 Starter 的稳定 ID/preset 保留兼容；只有名称和配置均未被用户修改的旧官方 `Daily + Rare Pack to 2x84+` Profile 才能自动迁移显示名，自定义副本不得覆盖。`Bronze/Silver Inventory Only` Starter 只能把使用铜/银 `targetDuplicate` 或 requirements 的 supported Loop 设为 `inventory-only`，并把其余 supported/container Loop 显式设为 `normal`，使它与主面板全局 `Inventory only` 区分；不得给 unsupported/intrinsic strategy 写入非法配置。旧 `starter-inventory-only` 仅在保持原始名称、preset 和未修改配置时自动迁移，用户自定义副本必须保留。主面板不得恢复 `Dry run` 或 `Show MVP loops` 控件；Dry Run 仅由 Builder/Profile 中的 Loop 配置启用，MVP/验证 Loop 保留在配置和 Builder 中但始终从主 Loop 下拉列表隐藏。主面板保留 `Refresh caches` 和 `Scan SBCs` 作为库存缓存恢复与 Dynamic SBC 绑定刷新入口；`Scan SBCs` 必须提供 Incremental、Full rescan 和 Clear cache 三种只读模式。JSON 验证/导入和 recap 模拟预览只放在 Builder/开发入口，不恢复为主面板按钮。

旧季 Profile 的源目录固定为 `profiles/`。每个 `*.profile.json` 文件名必须与 kebab-case `id` 一致，且只能二选一引用官方 `preset` 或提供完整 `config`；新增文件必须通过 `npm run check:profiles`，并由 `npm run build:profiles` 生成 `dist/profiles/*.loops.json` 和 manifest。禁止上传带 `discovered`、`discoveryIdentity` 或 `discovered-player-pick-*` 的动态 Pick 快照。FC27 Release 不包含这些旧季配置或 Profile zip；CI 保留构建仅作历史回归。已发布 Release 不得因 Profile-only 合并而覆盖资产。

Reward Alerts 的三个测试入口必须保持解耦：Preview 只展示本地 Toast/烟花，不调用 `GM_notification` 或网络；Desktop test 实际调用本机系统通知；ntfy test 实际发送远程测试消息。不要为了减少按钮数量把真实通知副作用合并进 Preview。

Player Pick、普通 Loop 与 Batch Open recap 必须共用同一套单卡列表、分页和 tier 主题，不得分别维护颜色判断。每页固定最多 15 条，Preview 和 stopped/preserved/blocked reason 都必须走真实通用 renderer。普通卡配色是稳定产品约束：Bronze 黄铜 `#B7793E` 配红棕背景 `#45281C`、Silver 银灰 `#AEB7C2` 配冷灰蓝背景 `#46515F`、Common Gold 暗金 `#A88638` 配旧金背景 `#302B22`、Rare Gold 85 及以下亮金 `#D6AA35` 配橄榄金背景 `#493B15`、Rare Gold 86-88 琥珀金 `#F0C34E` 配琥珀背景 `#604A12`、Rare Gold 89+ 象牙金 `#F3D98B` 配香槟背景 `#5F563A`。每行评分必须使用对应 accent 的实色徽标和自动高对比文字，不能只依赖深色行背景或左侧细边表达 tier。特殊卡可通过只读 EA Rarity/card color map 获取强调色，但必须校验颜色格式和文字对比度，不得把 EA Repository 依赖放进纯 UI/model；EA 色不可用时按当前产品层级回退：94 及以下虹彩紫 `#8E7CFF` 配高阶靛紫背景 `#324A7A`、95-97 宝石青 `#2FC6C4` 配深青背景 `#153F42`、98-99 紫红 `#B45BD2` 配暗莓紫背景 `#421F39`。特殊卡三档必须同时通过强调色和整行背景保持可辨识，不能统一按同一低比例混入深灰。禁止把 89+ Rare Gold 和 98-99 Special 都做成白金色，也禁止使用“颜色 A/颜色 B”这种未决 tier 定义。

Player Pick 在 EA `confirmSelection` 成功后就属于已完成结果，必须在任何 Unassigned 刷新、Storage/Transfer/Club 清理之前写入本次 Pick recap。后续清理失败时工作流必须返回保留 partial `pickResults` 的 `blocked`/`stopped` 结构化结果，并展示原因；不得因为异常抛出而回退到普通 Pack recap，也不得把尚未确认的 Pick 计入结果。Provision 的 pre-craft Pick 必须遵守同一规则。

所有普通 Loop 的真实奖励 recap 必须从唯一共享 `openPack()` 返回的成功 receipt 收集，不能让各 strategy、子 Loop 或奖励处理函数复制一套收集逻辑。Session 只在顶层 `Start` 建立并在顶层 `finally` 收尾，因此 workflowRoutine/Daily 子 Loop 必须继承同一 session；Batch Open 保留独立 recap，不能被普通 Loop session 重复收集。只有 session 中至少一张 Player 是 Rare Gold 或 Special 时才创建和展示普通 Loop recap；Common Gold、Silver、Bronze、Dry run 和纯库存提交不展示。Pick/Provision 已有专用 Pick recap 时不得再弹内容重复的普通 Loop recap。停止或阻塞时已经成功打开的 receipt 必须保留，并把 status/reason 带入 recap。Special 价格查询和 EA rarity theme 仍由 entry 注入，Reward model/UI 不直接访问网络或 EA Repository。

Batch Open 是独立 operational tool，不是 Loop strategy。主面板只保留一个入口，详细配置在独立弹窗中。运行时必须调用共享 entry `openPack()`，每次打开前重新按 `packId + packName` 解析新的 live pack instance，并提供 `createMaterializeAndResolvePolicy()`；禁止直接调用 Adapter `open()`、复制 Unassigned 清理路径或为 Batch Open 生造专用物品路由。Preview 只显示本地 recap，不得发布 Reward Highlight、Desktop 或 ntfy 副作用。

Batch Open 的 Unassigned 容量阻塞使用 `blockedPolicy: 'preserve'` 和显式 `enableRecovery: true`：先尝试现有通用恢复配方，仍无法处理时保留 Unassigned。已经成功打开的包必须保留 receipt 并进入 recap，后续包停止，不能再调用一次通用 final cleanup 覆盖结果。下一次 Batch 启动前也必须先执行同样的 preserve preflight；现有 Unassigned 未解除时不得打开新包。不要通过放宽高分、特殊卡、FSU 或 Lock 规则来强制腾出 Storage。

Batch Open 的 response duplicate 直接结算只能作为上述流程全部耗尽后的最终 fallback，且不得扩散到其它 Loop。目标确认优先使用精确 item ID；ID 被 EA 重建时，只允许把开包前 baseline 中不存在、静态签名一一对应的新目标实体作为 alias。仅相同 `definitionId`、无法一一对应、容量不足或仍出现 live Unassigned 时都不能判定成功。

Batch Open 的 `Add all` 必须持久化为 `quantityMode: 'all'`，不能只保存点击时的数量快照。弹窗展示使用当前 My Packs 数量，Start 前再次刷新并通过 `materializeBatchOpenPlan()` 物化执行数量；实时数量为 0 的 all entry 不进入执行计划。旧配置没有 `quantityMode` 时按 `fixed` 兼容。

Pack open 返回 `471` 时，重试恢复必须排除刚失败的 Pack 对象，完成 Unassigned 同步并尝试刷新 Store Packs 后重新解析 live instance；禁止第二次直接调用同一个失败对象。`500` 可以保留同实例重试语义。所有有界重试耗尽时必须把最终错误码、attempt 数和 Batch blocked reason 写入日志/recap，不能只输出无原因的 `blocked`。

### 5.11 `src/userscript-entry.js`

入口当前负责：

- Userscript metadata 和版本。
- 从 `src/config` 导入内置 `LOOP_DEFS`、展示/运行参数规则和 schema 校验，并保留当前测试/API 所需的薄代理。
- Runtime state、日志和主面板业务状态计算；command 编排已迁入 UI 模块。
- Runtime Adapter 组合；entry 不再直接访问 `W.*`、EA Repository/Service 或 EA enum。
- 缓存合并和页面导航顺序；奖励确认循环位于 Reward 模块，通用 predicate/loading/observable 等待位于 Wait Adapter。
- FSU manual override、2 秒缓存和日志格式化；runtime discovery 与锁卡来源合并已位于 FSU Adapter。
- shared module 到真实页面副作用的连接。
- 为共享 Workflow、strategy dispatcher 和服务注入真实页面副作用回调。
- 尚未完全迁出的评分候选安全策略桥、Player Pick 刷新/重试编排和页面语义 DOM helper。

风险取决于修改位置。任何看似局部的 helper 都必须先搜索全部调用点。

## 6. Strategy 与 Workflow 映射

当前 strategy 分发位于 `src/workflows/dispatch.js`，`runConfiguredLoop()` 只注入 runner 和收尾回调：

| Strategy | Entry runner | Shared workflow / scope |
| --- | --- | --- |
| `validationBronzeUpgrade` | `runValidationBronzeUpgrade` | `runValidationRoundWorkflow` |
| `dailySingleCardRecycle` | `runRecycleLoop` | `runRecycleWorkflow` |
| `supplyAndCraft` | `runSupplyAndCraftLoop` | `runSupplyAndCraftWorkflow` |
| `inventoryMixedUpgrade` | compatibility mapping | `runSupplyAndCraftLoop` |
| `commonGoldToRareUpgrade` | compatibility mapping | `runSupplyAndCraftLoop` |
| `provisionPackCrafting` | `runProvisionCraftLoop` | `runPackAndCraftWorkflow` plus configured stages |
| `provisionPackDualCrafting` | compatibility mapping | same Provision flow |
| `rarePackTo84Upgrade` | `runRarePackCraftLoop` | `runPackAndCraftWorkflow` |
| `playerPickSbc` | `runPlayerPickLoop` | `runPlayerPickWorkflow` |
| `dailyRoutine` | `runDailySequence` | `runSequenceWorkflow` |
| `workflowRoutine` | `runWorkflowRoutine` | `runSequenceWorkflow` over referenced child Loops |
| `fillAndVerifySbc` | `runFillAndVerifyLoop` | shared selection and submission transactions |
| `inventoryExhaustion` | `runInventoryExhaustionLoop` | configured ordered exhaustion stages |

旧 strategy 名仍用于外部配置兼容。不要新建更多兼容 strategy，优先用现有通用 Workflow 和参数表达需求。

新增 strategy 的最低完整性要求：

- 加入共享 `LOOP_STRATEGIES` registry。
- Schema 能验证该 strategy 的必要字段。
- `STRATEGY_RUNNER_KEYS` 映射到真实 runner。
- `runConfiguredLoop()` 注入同名 runner key。
- dispatch 测试真实调用该 runner，并覆盖正确 finalizer。
- 架构测试验证 schema registry 与 dispatch registry 相等，且 entry 注入了每个 runner key。

### 6.1 配置层级与继承

配置分为全局运行设置、父 Loop、子 Loop 和 step 上下文四层：

- 全局运行设置适合用户本次运行意图：是否打开奖励、Pick 高分保护阈值、自动 Pick 阈值、Open Picks at end 和 Inventory only；它们是可被父/子 Loop 显式覆盖的最低优先级默认值。Dry Run 不属于主面板全局设置，只能由激活的父/子 Loop 或 Profile 配置启用。
- 父 Loop 负责组合级语义：step 顺序、组合名称、父级 `pickOptions`、父级 `inventoryMode`、奖励/recovery 默认和父级禁用 pile。
- 子 Loop 负责真实业务：strategy、SBC/Pack identity、requirements、评分/特殊卡要求、priority piles、`runtimeQuantity`、`pickOptions`、`inventoryMode`、阶段和自身 reward/recovery 默认。
- step 只允许 `loopId`、可选 `name` 和上下文 `rewardFlow`。不要在 step 发明跨 strategy 的通用 `maxCompletions`；Provision 的 `rounds`、有限 Pick 的 EA remaining、Inventory Exhaustion 的 stage limits 和普通重复提交的 `maxCompletions` 不是同一语义。需要不同参数时定义或修改子 Loop，再由父 Workflow 引用。

配置对象先按父 Loop 默认 -> 子 Loop 配置 -> step 上下文合成，再施加适用的全局运行意图。不要用单一的“最具体层总是覆盖”规则实现所有字段。以下规则分别锁定：

- Only Untradeable、联赛/Evolution过滤、高分/特殊卡保护和提交前校验不能被任意层级关闭。FSU Lock player 与 Active Squad item-conflict protection 在全局 Selection Policy 中默认关闭，并按 `pickOptions` 的 global -> parent -> child 逐字段合同继承；缺失表示继承，显式布尔值才允许覆盖，不能用 `||` 吞掉显式 `false`。
- 父子 `disabledPiles` 取并集，更具体层级不能重新启用父级禁用来源。
- recovery 默认允许 step > 子 Loop > 父 Loop，但只能引用已验证 policy，不能绕过 blocked condition。
- 可继承偏好按 global UI -> parent Loop -> child Loop -> step context 合并；缺失表示继承，显式 `false`、`normal` 或 `never` 表示覆盖。不得用 `||` 合并布尔值，否则 child `false` 无法覆盖 parent `true`。
- reward open 为 `forceOpenRewardPacks` > step `rewardFlow` > 子 Loop `rewardFlow` > 父 Loop/global checkbox。`forceOpenRewardPacks` 表示后续阶段的供应依赖，不能被 `never` 关闭。旧 `openRewardPacks` 字段保持兼容，不把它重新解释成新的显式 override；新覆盖必须使用 `rewardFlow.open`。
- Dry Run 向所有子 Loop传播；不得出现父 Workflow 为 Dry Run、子 Loop实际提交的路径。主面板不得把隐藏或已删除的 UI 状态再次注入 `dryRun`。
- Pick 设置通过 `pickOptions` 逐字段继承，高分保护、阈值、自动选择和 Open Picks at end 都允许父/子 Loop覆盖全局默认。运行期生成的高分上限不得覆盖或删除 requirement 原始 `maxRating`；最终上限取业务上限与保护上限的更严格值。
- Inventory only 使用 `inventoryMode: inherit | inventory-only | normal`。支持范围必须登记在 `LOOP_STRATEGY_CAPABILITIES`；`dailySingleCardRecycle` 和 Supply-and-Craft family 支持，Pick/Fill/Inventory Exhaustion 本身是 intrinsic，Provision/Rare Pack/Batch Open 不支持。unsupported strategy 显式配置必须 schema 报错。

Builder 激活必须先物化当前 Profile：静态 configured loops 经过内置三方 rebase，动态 Pick 再按本次扫描结果替换绑定定义。刷新扫描后应重新应用 Active Profile；绑定不可用、内置冲突或 schema/reference 校验失败时保留 last-known-good 或回退 built-ins，不得清空 Draft，也不得把缓存 Pick 降级为普通静态 Loop。JSON import 只更新 Draft，不得直接调用 runtime activation。

### 6.2 现象到代码定位表

| 现象 | 首先检查 | 关键符号 |
| --- | --- | --- |
| Loop 不显示、MVP 可见性错误 | `src/config` 和 UI 投影 | `loops.js`、`loop-presentation.js`、`renderLoopSelect()` |
| 外部 JSON 加载失败或行为不同 | 配置 schema 和 contract | `loop-schema.js`、`scripts/check-loop-config.mjs`、`tests/contracts/loop-config.test.js` |
| SBC 名称找不到 | entry 的 SBC Set 查找和 Loop aliases | `findSbcSet()`、`sbcNames` |
| Daily 完成次数判断错误 | Daily sequence/preflight | `runDailySequence()`、daily progress helpers |
| 选材数量、稀有度或来源错误 | Selection input 与纯 selector | entry `selectInventoryPlayers()` bridge、`src/selection/inventory.js` |
| 评分 SBC 选择高分卡或卡死 | Rating model/candidates/solver | `runFillAndVerifyLoop()`、`src/selection/rating.js`、`src/domain/rating.js` |
| Unassigned/Transfer duplicate 无法提交 | signal materialization | `prepareInventorySelection()`、`src/selection/transient-signals.js` |
| Storage/Transfer 满时失败 | Unassigned plan/recovery | `resolveRuntimeUnassigned()`、`src/unassigned/*`、`src/config/recovery.js` |
| 开包 471/500 或打开下一包过早 | Pack integration/transaction/policy | entry `openPack()`、`src/pack/open-transaction.js`、opened-item policy |
| SBC 保存后人数不对或重复提交 | Submission transaction/EA Adapter | `submitInventorySbcAttempt()`、`src/sbc/submit-attempt.js`、`src/adapters/ea/sbc.js` |
| Claim Rewards 空等或奖励判断错误 | reward claim and navigation sync | `src/reward/sbc-claim.js`、entry reward/navigation helpers |
| Player Pick 已生成但不能领取 | pending Pick identification | `findUnassignedPlayerPick()`、`src/reward/player-pick.js`、`src/adapters/ea/player-pick.js`、`pickItemNames` |
| Pick 选择或价格不符合预期 | Pick ranking/price/manual UI | `src/reward/player-pick.js`、`src/reward/player-prices.js`、`redeemAndSelectPlayerPick()` |
| Provision stage 顺序或 partial Pick 错误 | Provision orchestration/config | `runProvisionCraftLoop()`、`runProvisionPreCraftPlayerPick()`、`craftingUpgrades` |
| One-click 阶段跳过或恢复错误 | Sequence Workflow | `runDailySequence()`、`src/workflows/sequence.js` |
| 日志卡顿、重复日志栏 | UI renderer/entry panel | `src/ui/log-renderer.js`、`installPanel()` |
| 热加载使用旧代码 | 构建和本地服务 | `scripts/build-userscript.mjs`、`StartFCAutomationToolDevServer.ps1`、Hot Reload userscript |

## 7. Loop 配置规则

每个 Loop 至少包含：

```json
{
  "id": "stable-id",
  "name": "Display Name",
  "strategy": "playerPickSbc"
}
```

常用字段：

- `hidden`、`mvp`：默认可见性。
- `sbcNames`：SBC Set 名称别名；运行时动态取得 Set/Challenge id。
- `requirements`：材料条件数组。
- `challengeRequirements`：多 Challenge 各自不同的材料条件。
- `priorityPiles`、`primaryPiles`、`clubFallbackPiles`：来源顺序。
- `shortagePacks`：Supply and Craft 的补货来源。
- `sourcePackIds`、`sourcePackNames`：Pack and Craft 源包。
- `craftingUpgrades`：Provision 的有序后续 SBC stages。
- `pickItemNames`：Player Pick 奖励精确别名。
- `challengesPerPick`、`pickCount`：Pick 子阵数和最终选择数。
- `maxCompletions`：单次调用的完成上限；对 Daily Routine，EA 返回明确剩余次数时必须由实时值覆盖本地旧值。
- `maxPacks`：来源包异常保护上限，不等于用户 rounds，也不应作为 Daily 业务目标展示。
- `useRoundsAsCompletions`：仅用于明确由用户指定本次完成数的独立可重复 Loop。
- `runtimeQuantity`：数量输入的声明式合同。`mode` 可为 `user`、`ea-remaining`、`exhaust`、`fixed`；只有 `user` 显示输入。`target` 明确投影到 `maxCompletions`、`rounds`、`maxPacks` 或 `validationRounds`，并由 Loop 自身定义 `default/min/max/label`。旧 `useRoundsAsCompletions`、Provision strategy 和 Validation `maxRounds` 只作为兼容回退。
- `consumeAllSourcePacks`：要求有限来源工作流先处理完所有匹配来源包；它可以与独立 Loop 的 `rounds` 完成目标并存，两个终止维度不得互相替代。
- `sourceExhaustedFallbackLoopId`、`sourceExhaustedFallbackMaxCompletions`：来源耗尽后的可配置库存兜底及其边界。
- `exhaustSbcSet`、`setCompletionSafetyLimit`：限次 Pick 使用 EA Set 当前剩余次数执行到耗尽；元数据不可读时只使用内部安全上限，不读取 UI `rounds`。
- `openRewardPacks`：历史奖励开包兼容字段；新的父/子覆盖使用 `rewardFlow.open` 三态。
- `pickOptions`：可继承的 Pick/Rolling 偏好，负责 `autoSelect`/`autoSelectBelow90`、`protectionRating`、`openAtEnd`/`openPicksAtEnd` 和默认关闭的 `rollingStorageSinkEnabled`；旧 `autoPickThreshold` 仅作迁移输入。`protectionRating` 只投影到 Pick 和 Rolling，现有 rating SBC 材料上限仍由 `sbcFodderPolicy` 管理。
- `sbcFodderPolicy`：可从全局到 Workflow、Loop 和嵌套 stage 继承并由子级覆盖的统一材料策略。`mode` 可为 `inherit`、`auto`、`low-gold`、`rating-constrained`；默认 `lowRatedGoldMaxRating: 82`、`ratingSbcMaxCardRating: 88`。
- `inventoryMode`：可继承的库存模式，值为 `inherit`、`inventory-only` 或 `normal`；只能配置在 strategy capability 为 supported/container 的 Loop。
- `openRewardPacksAtEnd`：`inventoryExhaustion` 等阶段式 Workflow 延迟奖励开包；阶段提交期间保持关闭，仅在全部阶段正常结束且 UI `Open reward packs` 已开启时批量打开匹配奖励。blocked/stopped 后不得执行最终开包。
- Stage 级 `openRewardPacks` / `forceOpenRewardPacks`：仅当同一组合 Workflow 的后续 stage 必须立即消费该奖励时使用，例如库存耗尽 Loop 的 Bronze -> Silver -> Common Gold 供应链；不得把父 Loop 的最终延迟奖励名传播给 stage。
- Loop 级 `forceOpenRewardPacks`：仅当同一流程的后续步骤必须立即消费该奖励时才可强制开包，例如 84x10 的 TOTW 前置；普通独立/兜底 2x84+ 和最终 FOF 奖励必须服从 UI `Open reward packs`。
- `maxRating`、`allowSpecial`：单条 requirement 的业务条件，不得代替统一材料策略。
- `ratingSbcFill`、`requiredSpecialCount`、`requiredSpecialKind`：评分 SBC 参数。
- `dynamicChallenges[].eligibilityRequirements`：动态扫描保存的 EA eligibility 快照，只用于绑定当前 Challenge 和诊断；`PLAYER_RARITY_GROUP` 等聚合分组的真实选卡必须在运行时重新绑定当前 EA requirement matcher，或在 DAO 缺少 matcher 时使用来自当前 EA item payload 的精确 group membership adapter，不能按卡名猜测或固化成业务卡种。
- `activityBinding`：内置/自定义 Loop、嵌套 stage、自动恢复和 Recovery recipe 对当前动态 SBC family 的声明式绑定。扫描只可覆盖 Set/Challenge/Reward identity、当前显示名、requirements 事实和剩余次数；不得覆盖高卡/特殊卡/可交易卡保护、pile 顺序、评分策略、fallback、Workflow 顺序或运行上限。每个嵌套消费者和 Recovery recipe 必须显式声明自己的 binding，不能依赖父对象名称或顶层 binding 传播。
- `preCraftPlayerPick`：Provision 显式动态前置 Pick 引用兼容字段，使用稳定 `sbcSetIds` / `pickItemResourceIds` 匹配扫描会话 Loop；扫描缺失时跳过该 stage，不得回退到过期活动。内置轮换优先使用语义 selector。
- `preCraftPlayerPickSelector`：Provision 内置活动轮换的语义选择器。当前仅支持 `material: "common-gold"`，只接受所有 Challenge 都已证明为全 Gold、无 Rare 最低要求且可按 Common-first 填充的当前扫描 Pick；无匹配时跳过，多匹配时停止并记录歧义，不得猜 Set ID。
- `preCraftPlayerPickLoopId`：历史自定义 JSON 的静态前置 Pick 引用兼容字段；内置活动轮换不得依赖它保留过期 Pick。
- `unassignedRecoveryPolicyIds`：当前 Loop 允许的恢复策略。

`rounds` 契约：

1. `dailyRoutine` 和正式 Daily SBC 子步骤不得读取 UI `rounds`；EA 能提供 Daily 剩余次数时直接执行该剩余次数，进度暂不可用时运行到 Challenge 不可用并受内部安全上限保护。
2. `mvp: true` 的 Daily 验证步骤可以保留明确的单次上限，这是测试入口，不代表正式 Daily 业务上限。
3. 新 Loop 必须用 `runtimeQuantity` 声明是否显示数量输入及其目标；旧 `useRoundsAsCompletions` 仅作兼容。
4. Provision 的 quantity target 为 `rounds`，表示本次打开的来源包数；Validation target 为 `validationRounds`，只表示测试轮数。
5. `maxPacks` 等内部安全上限用于防止异常无限循环，达到时应安全停止并记录原因，不能在 UI/日志中描述成已完成的业务 rounds。
6. 同时配置 `consumeAllSourcePacks` 与 `useRoundsAsCompletions` 时，必须先处理完所有来源包，再用库存补足 `rounds - 已完成数`；来源包重复卡清理允许完成数超过目标，库存兜底不得超额。Daily Routine 可通过 `stepOverrides` 关闭子步骤的 rounds 投影并配置有限兜底。
7. 限次 Player Pick 配置 `exhaustSbcSet: true`，不得同时配置 `useRoundsAsCompletions`。运行目标是“已有同类型 pending Pick 数 + EA Set 剩余完成次数”；pending Pick 必须先处理，但不能消耗 Set 的剩余次数预算。
8. 动态 Pick 扫描中，EA `repeats > 0` 表示有限 Set，按实时剩余次数耗尽并隐藏 UI `rounds`；`repeats: 0` 且 Set/Challenge 仍可用表示不限次，必须配置 `useRoundsAsCompletions: true`。只有 Set 明确完成或有限剩余数为 0 时才使用单次 runtime probe。
9. Challenge 已证明所有球员必须为 Gold、但没有 rarity 条件时，生成不带 `rarity` 的 Gold requirement；不得因缺少 common/rare 比例拒绝，也不得猜测比例。
10. EA eligibility 与 Runner 消耗偏好必须分开：`requirement.rarity` 只表示 EA 已确认的 Common-only/ Rare-only 硬条件；无 rarity Gold requirement 必须保持无 `rarity`。需要控制消耗时使用 `goldConsumption`，不得为了表达偏好改写 eligibility。
11. `goldConsumption` 支持 `eligibility`、`common-only`、`rare-only`、`common-first`、`rare-first`。`common-first`/`rare-first` 要先按配置的全部 pile 顺序完成第一阶段，再从第一个 pile 开始 fallback；必须优先处理本轮指定的 Unassigned duplicate signal，但 signal 不能绕过 EA eligibility、Special 或评分保护。
12. 所有运行时实体、库存快照、诊断、Pack/Pick/Loop recap 必须通过 `src/domain/player-rarity.js` 判定 Common、Rare 和 Special。不得在业务模块新增直接读取单一路径 `rareflag`、`_data.rareflag`、`_staticData.rareflag` 或自行组合 `rare`/`special` boolean 的逻辑。
13. `preferCommon` 与 `activityBinding.selectionMaterial` 仅允许读取旧 Profile/JSON；内置配置、动态扫描、Builder、导出 JSON 和新测试不得继续生成。旧字段只能由 `src/domain/gold-consumption.js` 的统一兼容 helper 解释，其他业务模块不得直接基于旧字段新增分支。

`sbcFodderPolicy` 契约：

1. 没有 `TEAM_RATING` 条件的 SBC 使用 `low-gold`；上限只保护普通 Gold，默认允许到 82。Special、Bronze、Silver 不受这个数值上限影响，但仍受 requirement 和其他保护约束。
2. 包含 `TEAM_RATING` 条件的 SBC 使用 `rating-constrained`；上限应用于所有卡，包括普通 Gold、Special、TOTW、TOTS、FOF，默认允许到 88。
3. 动态模式推断必须来自扫描到的 `TEAM_RATING` 元数据或等价的结构化 rating model，不得根据 SBC 名称、奖励名或硬编码 family 猜测。
4. FSU Gold rating range 只在 `low-gold` 模式生效，并与 `lowRatedGoldMaxRating` 取更严格的交集；`rating-constrained` 必须忽略 FSU Gold range。
5. Only Untradeable、Exclude Evolution、Excluded Leagues 等非 Gold range 保护在两种模式都必须生效。FSU locked player 保护由 `protectFsuLockedPlayers` 控制，默认关闭，开启时在两种模式都必须生效；`protectActiveSquadPlayers` 开启时，EA `409 + itemViolations` 必须停止，不能发送 `skipValidation:true` 确认提交。
6. Pick、Pack、动态 Upgrade、自动 TOTW/材料恢复、Provision stage 和 Unassigned recovery 必须共享同一策略解析及 `Unassigned -> Storage -> Transfer -> Club` 来源语义，不得维护彼此分离的数值保护逻辑。
7. 继承优先级为全局 < Workflow < Loop/嵌套 stage；子级只覆盖显式配置字段，`inherit` 保留父级，`auto` 由当前实际 SBC 条件确定模式。
8. `protectHighGold`、`highGoldThreshold`、`maxNormalGoldSubmittedRating`、`maxSubmittedRating` 仅用于旧配置读取兼容；内置 Loop、动态扫描、Profile、Builder、导出 JSON 和新测试夹具不得继续生成这些字段。

新增静态 Player Pick 时：

1. 已确认稳定身份时优先配置精确 `sbcSetIds`；完整活动名称 `sbcNames` 只作为兼容回退，不使用宽泛名称猜测目标 SBC。
2. 材料比例写入 requirements，并由 contract test 锁定。
3. 已确认稳定身份时优先配置精确 `pickItemResourceIds`；`pickItemNames` 使用实际 Unassigned 奖励名或稳定 localization key 作为回退。
4. 不使用过宽别名，例如只有 `84+ Player Pick`；否则可能误领其它 Pick。
5. `pickCount` 是最终选择数量，`pickCandidateCount` 是候选数量；动态发现只允许从奖励显式字段或官方奖励描述开头的 `X of Y` 读取，禁止从 SBC 名称推断。
6. 更新内置配置、外部 JSON、fixture coverage、contract test 和 README。

自动扫描当前可用 Dynamic SBC 的设计记录在 M9。Player Pick 扫描必须先加载 Challenge squad 得到 brick 后的真实人数，禁止从 formation 槽位数猜测。完全支持且不与静态配置重复的 Pick/新评分 x10 只作为当前会话 Loop 合并到列表，成功重扫会替换旧会话结果。83+/84+ Pick 已完成动态覆盖 Dry Run/Live 验证并删除静态活动配置，今后只由扫描生成。主面板不得重新加入 `Use scan data for static Picks`；内部 `preferScannedMetadata` 仅作为旧 Profile/用户 JSON 的兼容字段保留。

所有 EA 明确归入 `Upgrades` Category 的 Set 都可进入增量扫描候选，但可运行授权仍按 family parser 分层：84+ TOTW 和高评分 xN 解析评分/特殊卡条件；Daily Bronze/Silver/Common/Rare、Bronze/Silver/Gold 和材料消耗 Upgrade 必须是单 Challenge、单 Pack reward，并且全部资格条件可完整转换。基础 family 默认通过 `activityBinding` 物化现有内置 Loop/嵌套 stage/Recovery，不自动生成新的独立 Loop。运行时查找顺序必须是扫描得到的 `sbcSetIds` 优先，完整 `sbcNames` 只作兼容 fallback。固定 `common-gold-crafting-upgrade` 与 `2x84-upgrade` 只作为旧配置兼容别名；新内置消费者必须使用 `common-gold-material-upgrade` 或 `rare-gold-material-upgrade`。

材料消耗 family 的 Baseline 固定为 Common Gold `11 common -> 2 rare gold, 75+` 与 Rare Gold `10 rare -> 2 rare gold, 85+`。只有需求数量严格少于 Baseline 且奖励在保证数量、最低评分和 rarity 上整体不差并至少一项严格更好时才是 `premium`；不劣于 Baseline 但未同时严格改善需求和奖励的是 `baseline`；被 Baseline 支配的是 `sub-baseline`，交叉取舍或奖励事实不完整的是 `incomparable`。默认消费者只能显式选择 Premium/Baseline，Sub-baseline 必须由 Profile 明确授权。多候选先按 Premium -> Baseline 和 Pareto layer 排序，再应用 `reward-first`、`quantity-first` 或 `cost-first`；没有 preference 且顶层候选不可比较时必须判歧义。未知奖励、混合材料、Team Rating、化学、特殊卡要求、多 Challenge 或多/非 Pack reward 不得进入材料 family。扫描必须原样保留 EA eligibility，并把 consumer 的材料意图物化为 `goldConsumption`；明确 Common-only 的 SBC 不得用于 Rare consumer，需要 Common/Rare fallback 的 consumer 只能绑定无 rarity 限制的 SBC。Common Provision/Exhaustion 只接受 Premium；Common Recovery 顺序是 Daily-specific -> Premium -> Gold Upgrade Baseline；Rare Provision/Recovery/高评分自动补料和 Rare Pack Recycling 接受 Premium 后 Baseline。所有 `required` 材料绑定必须在任何开包或 SBC 操作前完成本次扫描物化，否则返回 unavailable；Rare Pack 的库存 fallback 必须复用本次已选中的同一个语义活动。详细语义和场景矩阵见 [GOLD_MATERIAL_CONSUMPTION.md](docs/GOLD_MATERIAL_CONSUMPTION.md)。

## 8. Agent 接到任务后的标准流程

### 8.0 需求、计划恢复与场景验收

以下为所有功能开发与修复的强制流程，适用于首次实施、临时插入的修复、用户调整方向以及中断后续做。

1. **先澄清需求，再制定实施计划。** 先核对会话中已确认的要求与现有文档，写清用户入口、操作顺序、输入与默认策略、预期结果、失败后的行为、授权边界和验收标准。凡会影响这些内容的歧义或冲突，必须提出具体问题，必要时反复澄清，直到能够写出明确的预期行为；不得自行选择一种产品含义后开始相关实现。已确认事项直接沿用，不让用户重复确认；可继续不依赖待答问题的调查。EA 接口或运行时事实由 Agent 尽量自行取证，不把技术调查转嫁为用户需求问答。
2. **计划必须覆盖完整用户流程。** 需求明确后，在对应功能文档中维护当前有效计划，列出步骤、依赖、完成条件和验证场景，并将需求映射到实现与验收。简单修复可用短清单，但不得省略受影响的前后步骤、恢复行为和再次操作。功能缩减、分阶段交付或交互变化必须明确记录；改变已确认产品需求时先与用户澄清，不能用内部架构或临时实现困难替代产品决定。
3. **中断必须有恢复记录，续做必须先对账。** 切换任务、等待登录或外部条件、因错误暂停、交接或结束未完成工作时，在相关文档记录当前目标、已完成项及证据、未完成项、失败与未验证项、工作区及浏览器/事务状态、阻塞条件、下一步和恢复前检查。突发中断来不及记录时，恢复后的第一步就是重建这些事实。收到“继续”时先核对最新指令、计划和实际状态，再从明确恢复点继续；不盲目重做已有工作、不丢弃原目标、不重复执行结果未确认的副作用。
4. **偏离计划必须记录 gap 和补齐路径。** 发现实际实现、交互或验证与计划不符时，及时更新对应计划并向用户说明：原定结果、当前事实、偏离原因、受影响需求/步骤、剩余差距、纠正或替代方案、依赖和下一项验收。保留旧结论被修正的原因，明确当前有效结论；不得把缺口静默改成“已完成”，也不得用新增下游功能掩盖前置流程未通过。范围内的实现调整可自主执行；改变产品目标或需要新增授权的动作必须先澄清。
5. **场景覆盖必须充分且持续增长。** 实现前按需求和风险建立场景矩阵，至少覆盖适用的正常路径、边界、失败、恢复、重复操作及跨模块组合。每项记录前置状态、用户动作、预期界面/服务端结果、副作用次数、验证层级、结果与证据；不适用项说明原因。Puzzle 至少考虑库存足够/不足、品质与保护组合、搜索路线失效与回退、无挂牌/报价过期、空阵/已有阵容/全部清空/部分修改、切换子阵或账号、刷新/重启、请求失败或回执丢失后的再次操作。每次用户报告、新需求或新运行时事实都必须检查相邻场景并补入矩阵；线上缺陷先补失败测试或脱敏复现，再修实现，不能只覆盖最后一个错误码。
6. **完成结论必须与证据范围一致。** 分别记录代码实现、单元/集成回归、离线浏览器和真实页面验收状态。跨模块流程必须有贯通测试；真实页面需要核对用户可见结果、服务端状态及后续再次操作，而非只看请求成功。测试数量、单个 Challenge 成功或一次完整回归通过不能代替场景覆盖。未执行、失败或因授权/环境受阻的场景保留为明确 gap，并说明继续条件；不得宣称整个功能可用。Agent 在授权范围内自动完成可执行检查，仅把登录、必要产品选择或必须由用户执行的动作交给用户。
7. **参考插件代码必须完整复现行为，差异须事先获得用户同意。** 用户说“参考 FSU”或其他插件代码时，必须沿用原实现的完整行为，包括入口和操作步骤、数据/价格来源、默认参数、查询条件与顺序、排序与选取、调价与重试、等待节奏、错误分类、单项失败后继续或整批停止、写入与收尾、再次点击和结果反馈；不能只复用底层 API 后自行重写业务。开发前读完整调用链及相关依赖，逐项建立原版/本地行为对照；优先直接复用或提取原代码，仅作不改变行为的模块化和环境适配，并保留作者/许可证。未经用户明确同意，不得擅自增加或修改价格/预算规则、候选过滤、前置校验、停止条件、确认步骤、恢复流程，也不能把这些改动包装成内部重构、保护或日志需要。确有兼容性或现有约束冲突时，先说明原行为、拟议差异、原因及影响并取得同意，再实施该差异；已明确批准的差异沿用，不重复询问，也不得扩大批准范围。“独立实现、不依赖原插件加载”只授权解除运行依赖，不授权改变行为。验证必须用同一输入和响应序列对照原版与本地的请求、参数、选单、价格和继续/停止结果；仅有本地测试通过不能证明行为一致。发现既有未经批准差异时，明确记录为未完成项，不得宣称已经对齐。

对应功能文档至少保留以下当前状态记录，可与已有计划/验收表合并，不要求重复建文档：

- 已确认需求与待澄清项。
- 当前计划步骤、依赖、完成条件和状态。
- 中断/偏离原因、实际状态、gap 与补齐方案。
- 场景矩阵、测试/实机证据及未验证项。
- 恢复前检查、下一步及所需用户操作（如有）。

### 8.1 先确认事实，不先改代码

1. 读取用户最新指令，确认是分析、计划还是要求直接实现。
2. 检查工作目录和 Git 状态。
3. 读取完整日志，不只看最后一行。
4. 标记版本、Loop、Dry run/Live、FSU settings、SBC/Pack/Unassigned 状态。
5. 找到第一处偏离预期的日志，而不是最后抛错的位置。
6. 对照最近提交，若用户怀疑回归，使用 `git log`、`git show` 和 `git blame` 找到引入点及原提交目的。

### 8.2 将问题归类到正确层

优先判断：

- 名称、数量、顺序、保护阈值变化：配置层。
- 单个 strategy 的循环、partial 状态或阶段顺序：Workflow。
- 选错卡、比例不对、signal 解析不全：Selection。
- 开包 471/500、response/UI 延迟、第二包决策：Pack transaction/policy。
- Storage/Transfer 满、保留或恢复路径：Unassigned。
- 保存后阵容变化、重复提交、Challenge 状态：SBC transaction/Adapter。
- EA 字段读取错误、缓存缺失：Adapter 或 entry integration。
- 面板、日志、recap：UI/entry。

先尝试用配置或现有 callback 表达需求。不要为了一个 Loop 复制共享底层函数，也不要为了避免局部参数而修改所有 Loop 的共享行为。

### 8.3 做影响面分析

修改前回答：

- 这个函数/字段被谁调用？
- 是一个 Loop、一个 strategy，还是全部 Loop 共用？
- Dry run 和 Live 是否共用路径？
- 是否影响 pending 状态恢复？
- 是否影响 Unassigned、容量或下一包决策？
- 是否会改变 FSU/高分/特殊卡保护？
- 是否修改 Adapter、Contract 或生成文件？
- 需要哪些 Node tests 和真实页面验证？

使用 `rg` 搜索符号、strategy、配置 id、日志文案和底层调用。不要只根据函数名推测影响范围。

### 8.4 定义不变量和恢复要求

实现前写下：

- 正常路径。
- 边界条件。
- 必须停止的条件。
- 当前失败状态更新脚本后如何继续。
- 不允许改变的保护规则。
- 预期新增日志。

例如修 Player Pick 名称时，不修改材料选择和提交；只补实际观测到的限定别名，并保证 pending Pick 在新提交前被领取。

### 8.5 先补测试，再最小修改

优先测试层级：

- 纯函数 Bug：`tests/unit`。
- 状态机顺序或恢复：`tests/workflows`。
- 配置、Adapter 或 userscript 集成契约：`tests/contracts`。
- 运行时全局或直接调用点变化：`tests/architecture`。
- 真实 EA/FSU/Pack 数据：`tests/fixtures` 中新增脱敏 fixture。

Bug 回归测试应描述原始失败场景，不要只把旧断言改成新结果。

- `npm run lint:undef` 是和语法检查同级的发布门禁。不得用关闭 `no-undef`、扩大 ignore 范围或添加虚假 global 的方式掩盖作用域错误；新增 browser、Node、Tampermonkey 或 EA global 必须有真实运行时来源并在 ESLint 配置中最小声明。
- 诊断日志不得成为业务控制流的失败源。关键提交、开包、移动和恢复路径中的诊断字段读取及格式化必须使用异常隔离 helper；诊断失败最多丢失该条日志，不得阻止真实操作。
- 多步骤生产 Bug 必须增加跨步骤 workflow test，至少覆盖前一步副作用、阶段处理/清理和下一次动作的顺序；只测试单个纯函数不足以证明流程回归已锁定。
- 用户日志中首次出现的新 EA/FSU/Pack 响应形状必须脱敏后保存到 `tests/fixtures`，并加入 unit、workflow 或 contract replay。fixture 中不得包含账号、token、完整卡库或可识别用户的数据。

### 8.6 实现和验证

实现顺序：

1. 修改源码和配置。
2. 运行最小相关测试。
3. 运行 `npm run verify`。
4. 运行 `git diff --check`。
5. 检查生成的 userscript 版本和目标配置是否存在。
6. 根据影响面列出建议用户执行的真实页面验证场景。

不要在必要测试仍失败时只交付“理论上可行”。

## 9. 测试框架

Vitest 运行在 Node 环境，配置见 `vitest.config.js`。

### 9.1 Unit tests

目录：`tests/unit`

覆盖：

- Domain contracts 和评分公式。
- requirements/rating selection。
- FSU、保护和 duplicate signal characterization/differential。
- Pack transaction 和 opened item policy。
- Unassigned plan、resolver 和 recovery。
- Submission transaction、SBC reward claim 和 Player Pick reward planning。
- Inventory Ledger、delta projectors、mutation observers、FSU readiness/定向验证、外部 drift、周期对账、10,000 卡索引和 capability 缓存失效。
- Log renderer。

Characterization test 锁定当前已验证行为；differential test 对比重构前后或两种实现的结果。修改它们时要确认是修 Bug 还是改变规则。

### 9.2 Workflow tests

目录：`tests/workflows`

使用回调和 fake result 测试状态机，不启动 EA 页面。覆盖 recycle、supply-and-craft、pack-and-craft、Player Pick、repeated submission、reserved duplicate crafting、validation round 和 sequence。

Workflow 测试应检查调用次数、顺序、结构化状态和恢复，不测试 DOM。

### 9.3 Contract tests

目录：`tests/contracts`

- `loop-config.test.js`：配置合法性、内置/外部关键行为和安全上限。
- `fixture-coverage.test.js`：每个内置 Loop 都有 normal/recovery 场景说明。
- `inventory-adapter.test.js`：EA Item 到 Snapshot 的转换。
- `effect-adapters.test.js`：fake/EA 副作用契约。

新增 Loop 后必须更新 `tests/fixtures/workflow-scenarios.json`，否则 fixture coverage 会失败。

### 9.4 Architecture tests

目录：`tests/architecture`

- 禁止共享模块访问 runtime globals。
- 禁止 Workflow import Adapter 实现。
- 锁定 pack.open、SBC save/submit 的直接调用点。
- 锁定已删除的旧专用 runner 不重新出现。

架构 baseline 变化不能机械更新数字；必须解释为什么新增直接调用是合理的。一般应修改实现保持 baseline，而不是放宽测试。

### 9.5 Userscript integration harness

`tests/helpers/load-userscript.js` 使用 esbuild 打包源码，在 Node `vm` 中安装 fake window、repositories、services 和 test exports。它用于测试 entry 对配置模块的兼容代理、选择桥和 runtime helper；配置 schema 本身另由纯模块测试直接覆盖。

如需测试新的 entry helper，可谨慎加入 `W.__FCLoopRunnerTest` export；不要将测试专用逻辑带入正常运行路径。

### 9.6 Fixtures

目录：`tests/fixtures`

保存脱敏、可重复输入：

- Challenge 进度和评分要求。
- FSU selection policy。
- Inventory/Storage overflow。
- My Packs 实例。
- 每个 Loop 的 normal/recovery 行为描述。

真实 Bug 的 fixture 应保留决定性字段，例如 item id、definition id、duplicateId、rating、rareflag、tradeable、pile、capacity 和 Challenge 状态。

## 10. 按改动类型选择验证范围

### 配置或名称别名

- `npm run check:config`
- `tests/contracts/loop-config.test.js`
- `tests/contracts/fixture-coverage.test.js`
- 目标 Loop 真实页面验证
- 最终仍运行 `npm run verify`

### 单个 Workflow

- 对应 workflow tests
- 该 strategy 的所有配置 contract
- 目标 Loop 和同 strategy Loop 的真实页面验证
- `npm run verify`

### Selection

- selection unit、characterization、differential
- Player Pick、Provision、Daily、Rare Pack 或 Rating 等全部相关 workflow tests
- 视修改范围至少验证一个 requirements Loop 和一个 rating Loop 的真实页面流程
- `npm run verify`

### Pack

- open-pack transaction、opened policy、transient signal tests
- 所有受影响 pack workflows
- 真实页面验证正常包、stale/471/500、response 早于 UI 和容量边界
- `npm run verify`

### Unassigned

- plan、resolve、recovery tests
- Daily、Rare Pack、Provision、Player Pick 收尾场景
- 真实页面验证 Storage/Transfer 满和当前状态恢复
- `npm run verify`

### SBC Submission 或 EA Adapter

- submit-attempt、SBC/Player Pick reward、adapter contracts、architecture tests
- Inventory SBC、Player Pick、Rating SBC 各至少一个相关测试
- 真实页面提交、奖励、重复点击和恢复验证
- `npm run verify`

### UI

- log renderer tests
- 简洁/Options/`L`/resize/drag/recap 人工检查
- 高频日志刷新检查
- `npm run verify`

## 11. Dry run 与 Live

Dry run 和 Live 应尽量共享：

- Challenge 定位和要求解析。
- Inventory snapshot。
- Selection 和 rating solver。
- validator 和 diagnostics。
- Workflow planning。

Dry run 必须在副作用前停止：

- 不移动物品。
- 不清理真实 Unassigned。
- 不开包。
- 不保存阵容。
- 不提交 SBC。
- 不兑换 Pick。

不能简单运行完整 Live 然后跳过最后提交，因为前面的开包、移动、保存和恢复 SBC 本身已经改变账号状态。

## 12. 日志分析方法

分析日志时按时间线分层：

1. `Ready v...`：确认运行版本。
2. `FSU settings sync`：确认实际保护策略。
3. `Loop selected`：确认 strategy。
4. Challenge/Pack preflight：确认目标和剩余次数。
5. Selection：确认数量、pile 和 diagnostics。
6. 保存与 `submit ready`：确认实际阵容状态。
7. 提交与 reward claim：确认是否已经成功。
8. Unassigned confirmation：确认奖励和重复卡状态。
9. 第一条偏离预期的日志。
10. 最终异常堆栈只用于定位调用链，不一定是根因。

常见例子：

- `unrelated unassigned Player Pick`：通常是奖励别名不匹配，不代表 SBC 提交失败。
- `SBC storage has only ...`：根因可能是前一步不该清空 Unassigned，而不是容量检查本身。
- `selected M/N`：先看 diagnostics 和 FSU settings，再判断库存不足。
- `Open pack failed: 471/500`：先检查上一包响应是否已经完成 duplicate materialization、Unassigned settlement 和逐卡 destination confirmation。`471` 常表示仍有服务端待处理物品，不能直接推断当前 Pack 实例已经失效；Batch 对同 ID 多包使用启动时捕获的实例队列，普通奖励包可按自身 resolver 获取刷新模型。`500` 仍按有界重试处理。
- 开包响应中的 `isDuplicate()`/`duplicateId` 可能晚于响应返回。通用开包路径必须先用 Club 相同 definition 恢复迟到的 duplicate signal，再等待 live Unassigned 实体执行 duplicate move/swap；不得把响应卡当 non-duplicate 移动后仅凭一次空 repository 继续下一包。Batch Open 的 response duplicate 最终 fallback 必须满足 Pack 模块不变量中列出的页面同步、baseline、容量和确认条件，其它路径仍不得直接移动 response duplicate。
- `pendingItemRefs` 表示开包响应卡尚未确认进入 Club/Storage/Transfer，也没有被明确 reserved。任何自动开包流程都必须停止后续包或 SBC 动作；reserved 与 pending 不得混淆。
- `Pack #N marked gone for this session after 404`：同一 pack id 已按 404 拉黑，本会话不再重复尝试（例如僵尸 TOTW Provision Refresh）。
- `background submit returned 409/429; reloading challenge before retry`：评分 SBC 后台提交冲突，脚本会有限次重载 challenge 并重放阵容后重试；仍失败再停。
- `rating shortage before automatic 2x84+ recovery: ...`：84x10/评分 SBC 主求解失败原因；出现在自动 2x84+ 恢复之前。先读这行区分“评分桶确实不足/角色或条件无法物化”与后面的 fodder 不足。
- `deterministic rating squad ... live range:A-B, levels:N, recipe attempts:M, planner transitions:P, cache:hit|miss`：评分规划只处理实时存在的评分桶。连续运行通常应出现 `cache:hit`；候选卡数量增长但评分桶和截断数量不变时，`levels` 与 `planner transitions` 必须保持不变。
- `unknown eligibility key` 或 chemistry：当前动态条件无法安全解释，应记录 Challenge 模型并停止，不得忽略条件提交。
- `reward pack not found`：先确认 SBC 进度和奖励是否已经发放，再刷新 Packs；不要盲目重复提交同一个 Challenge。
- 材料已经开出却立即报缺料：优先检查是否先处理 pack response、再清理残留 Unassigned 和刷新 recent reward；不要直接放宽材料保护。
- 长时间无日志：区分 EA 请求等待、页面 loading、同步计算或日志 renderer 阻塞。

## 13. Git、远程更新与冲突

仓库可能存在未提交改动。Agent 必须：

- 不还原不属于当前任务的改动。
- 不使用 `git reset --hard` 或类似破坏命令。
- 远程更新后先检查 diff、最近提交目的和行为覆盖范围。
- 冲突不能只按文本解决；必须确认双方行为意图。
- 特别检查内置配置、外部 JSON、README、tests 和生成产物是否被旧版本覆盖。
- 合并后运行 `npm run verify`，并验证受影响的真实页面流程。

怀疑回归时：

1. 找到最后正常版本和首次失败版本。
2. 用 `git log --oneline`、`git show`、`git diff old..new`。
3. 确认引入提交的原始目的。
4. 恢复旧的正确行为，同时保留该提交真正需要的修复。
5. 添加同时覆盖“旧正确行为”和“新修复目的”的测试。

## 14. 本地热加载与发布

启动服务：

```powershell
powershell -ExecutionPolicy Bypass -File ".\StartFCAutomationToolDevServer.ps1"
```

开发循环：

```powershell
npm run build
# FC27: 直接在 Tampermonkey 重装生成脚本，再刷新 Web App
```

发布前：

```powershell
npm run verify
git diff --check
```

共享底层修改不得仅凭 Node tests 宣布完成；Agent 应根据影响面列出真实页面验证场景，由能够访问账号和 Web App 的用户执行。

CI 位于 `.github/workflows`，Windows + Node 22 执行 `npm ci` 和 `npm run verify`，并检查生成的根目录 userscript 已提交。`verify.yml` 同时构建 Profile preview artifact；`release-assets.yml` 负责 GitHub Release 资产打包和上传。

旧 Hot Reload 仅支持 FC26，赛季不符或下载到 FC27 bundle 时必须在 destroy/eval 前拒绝；不得把 FC27 GM API 暴露到页面以绕过隔离。正式 Release 只能由与 `package.json` 完全匹配的 `v<version>` tag 或指向该既有 tag 的手动触发创建。发布 workflow 必须先通过当前精确只读发布许可及完整验证，按 `scripts/package-fc27-release.mjs` 的显式清单构建 Runner/FSU script、meta、manifest 和 SHA256，再从 draft 发布；旧 Loops/Profile/Preview 不得混入。已发布 Release 不得覆盖或替换；新增 Live 需真实业务验收、独立批准、升版及新 tag。

## 15. 交付报告要求

Agent 完成任务时应说明：

- 根因。
- 修改了哪一层和哪些文件。
- 为什么没有扩大到其它层，或共享改动影响哪些 Loop。
- 新增/修改了哪些测试。
- `npm run verify` 结果。
- 是否执行真实页面验证；没有执行时明确列出待验证场景。
- 当前失败状态是否可以直接重新运行恢复。
- 版本和生成产物是否同步。
- 对照当前计划的完成项、偏离及剩余 gap；未完成时说明明确恢复点、下一步和继续条件。

不要只说“已修复”。对于高风险共享修改，必须给出影响面和剩余风险。

## 16. 当前架构边界与后续项

FC27 历史准备另见 [实施记录](docs/FC27_PRELAUNCH_PROGRESS_ZH.md)。当前正式入口只包含经过依赖白名单审查的 FC27 模块和少量共享纯逻辑/事务模块；`FSU_mod/src/runner-support` 独立原型仍不进入生产，也不替代既有 FSU。修改 FC27 除完整 `npm run verify` 外，执行 `node scripts/verify-fc27-prelaunch.mjs --browser`（先安装 tools/browser-inspection 依赖）。真实 EA Provider/GM 只读与安装证据已取得，正式只读 `27.0.0` 已发布；真实 SBC 业务验收及 Live 开放仍待完成，不得混淆。

核心架构重构已在 `0.5.12` 收尾。以下是明确保留的运行时边界和独立后续功能，不应误判为需要机械拆分的未完成工作：

- `src/userscript-entry.js` 仍包含运行时 composition、缓存合并、评分候选安全策略桥、真实页面副作用回调和页面语义 helper；内置 Loop、schema、展示/运行参数规则、strategy 分发、SBC 导航同步、Unassigned 确认、Claim Rewards 编排以及评分候选构建/计划回解已迁出。
- Inventory/Pack/SBC/Player Pick/FSU/Localization 与 DOM/Storage/HTTP/Page Runtime/Wait/User Effects 已通过统一 Runtime Adapter 工厂获取；entry 已无直接 `W.*`、EA Repository/Service、enum、Clipboard 或 download API 访问，但仍保留通过 Adapter 执行的页面副作用顺序。
- FSU 嵌套设置、Storage 和锁卡身份纯解析位于 `src/config/fsu-compat.js`；窗口根对象发现、来源优先级和跨来源锁卡合并位于 `src/adapters/ea/fsu.js`。entry 只保留 manual override、2 秒缓存和运行日志。
- Reward 的纯判断、Player Pick 待领取名称分类、排序/recap 和价格 fallback 已迁出；待领取物品读取、跨 pile 重复检查、领取/确认在 EA Adapter，人工选择在 UI 模块。
- 旧 strategy 名仍保留外部配置兼容。
- Player Pick SBC 动态发现已完成保守的纯解析、EA 快照、只读扫描、当前会话列表合并、稳定身份去重、成功重扫替换和可选的静态配置会话覆盖；83+/84+ 动态 Dry Run/Live 已通过并删除静态配置，82+ 多 Challenge/Provision 动态覆盖及其它新 Pick 仍需实盘验证，复杂评分/化学/特殊卡条件仍保持 unsupported，见 M9。

是否删除旧路径或继续物理拆分，以 [REFACTORING_MILESTONES.md](docs/REFACTORING_MILESTONES.md) 为准，不因单个功能任务顺带扩大重构范围。
