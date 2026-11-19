# Trading 挂牌耗时与出售顺序（2026-11-19）

## 当前有效需求

用户在首轮优化后明确要求：移除 FCAT 额外的逐卡鲜读和挂牌后回读，对齐 Enhancer 的原生挂牌回执；挂牌间隔设为0；先挂 Unassigned、Transfer List 的可售卡，再挂 Club 可交易卡。本记录覆盖此前“保留3秒底线与所有鲜读”的中间实现。

范围为市场交易 Trading，包括手动选卡出售和按评分持续出售。不改变 Gallery 的挂牌界面/价格，也不改变买卡、搜索的频率设置。

## 现场证据与原生行为

`2026-11-19T12-15-59-008Z` 日志27.0.114去重后18次list、18次HTTP200。相邻发送中位21.048秒、最小21.001秒、最大60.111秒；原生list自身耗时中位1.2825秒、最小1.163秒、最大4.788秒。截图按评分88出售，共55张候选、已挂牌18张。

原流程认领读U/T、准备读U/T、读价格范围、list、回读Transfer，共七步分别受3秒pace限制，构成每卡约21秒。最大60秒间隔还可能包含其他准备工作，不能全部归于这一原因。

完整查阅 Enhancer 27.0.1.8 的 `$Te → R6e/A6e → OGe → services.Item.list`：串行处理，有价格范围则使用，没有才requestMarketData；按原生响应显示结果，每张结束只等待一次listingDelayRange。默认3–5秒，用户截图为1–1秒；本次按明确要求设0秒，不声称0是Enhancer默认。

2026-11-19公开EA源码确认：`UTItemService.list`在成功后给传入item写入auctionIds[0]，完成自身refreshAuctions后才notify带`data.itemIds`的成功DTO。已审查的原生move同样先更新实体/仓库，再通知成功itemIds。因此无需FCAT再请求一次Transfer来确认同一张挂牌。公开list方法SHA256为`fa1214fdba6f6e07cfe7955045f73dd14bdafa6f95fca8d9c78d53724772b0a5`，公开方法fixture保留在tests/fixtures，无账户数据。

## 实施与边界

1. **选单顺序**：Transfer List → Unassigned → Club。两个外部仓库都优先于Club；先处理已在Transfer的卡，不用先移卡占新槽。手动选单、自动评分扫描、旧Club持仓恢复均使用此顺序。已完成移卡的持仓优先收尾，不重复移动；新一轮自动扫描仍需完整读取一次库存，之后原五分钟周期发现新卡。
2. **逐卡准备**：sell认领、挂牌及sell任务的移卡使用当前原生实体，不重复读U/T或定向读取Club。手动Club选卡合并现有原生缓存与扫描缓存，扫描实体优先；这只作用于Trading局部视图，不改Gallery适配器。价格范围有缓存直接用，仅缺失时请求。
3. **发送与回执**：list以及sell任务内的move串行执行、无人工等待。list依据成功HTTP/DTO、精确itemIds、同一实体上新tradeId确认；sell move依据原生成功精确itemIds确认。保留原move/list两条日志及成本，利于中途暂停后继续。未知/缺ID/矛盾/旧auctionId不伪造完成，不自动重复发送，仍可用显式恢复读取核实。
4. **调度**：共用锁、最后发送前取消/账号/价格与保护检查、持久化记账仍有效。只有Trading list和sell移卡跳过人工nextWriteAt等待；其发送仍更新该时间戳，后续普通买卡、移卡、旧Gallery挂牌遵守原节奏。不是并行突发请求，也没有自动解除EA错误限制。
5. **后续生命周期**：售出/到期的定期查询、首次库存扫描、未知交易手动恢复仍存在。移除的是每卡挂牌前后冗余读取，不是关闭后续销售状态监测。网络和EA原生内部refreshAuctions仍耗时，不能将“0秒间隔”解释为瞬间完成。

原已批准Trading行为仍保留：明确挂牌拒绝暂停当前任务；未知回执保留pending；原价格档位/缺价阻止、预算和保护规则不变。此次对齐的是原生请求与间隔、缓存价限使用，不宣称与Enhancer所有错误策略完全相同。

## 场景矩阵与验证

| 场景 | 预期与证据 |
| --- | --- |
| 十张Transfer连续挂牌 | 旧版207秒人为等待；中间版27秒；最终0秒。10个confirmed/10个listed，0额外库存读取，已有范围无价限请求 |
| 55张生产完整组合 | scheduler/store/coordinator/provider/native/共用traffic，55次list串行、55条confirmed，0秒人为等待 |
| 原生公开方法回放 | 实际list方法control flow：POST→原生refreshAuctions→DTO；FCAT不提前确认，也不追加GET |
| Enhancer同输入对照 | 10相同ID、650/700/3600、range[0,0]，原函数与FCAT相同发送参数及0间隔；仅合成有效卡，不冒充实盘/全错误策略一致 |
| 混合仓库/保存旧顺序 | Transfer与Unassigned先于Club；移卡、挂牌都无额外鲜读/等待 |
| 旧Club持仓恢复 | 保留原持仓成本，先挂未处理外部卡，再完成旧Club；自动重建后先扫描再选择 |
| 连续按评分出售 | 初次扫描T/U/Club，过滤不可售/保护/其他任务持仓；按新顺序挂牌，五分钟后发现新卡，无重复挂牌 |
| 手动Club缓存 | 无扫描缓存也能精确解析已选原生卡；无每卡Club读取 |
| 缺价格范围 | 只补缺失范围，仍缺失则不发送；再次获得范围才挂牌 |
| 未知或矛盾回执 | 错ID/缺ID/缺tradeId/旧tradeId保持pending，不回读后当成功、不盲目重发 |
| 最后异步检查 | checkpoint期间保护改变，最终native调用前阻止，0次写 |
| 全局协调 | 两调用者仍串行；list后普通buy/move/旧list仍等待；停止状态不能被0秒选项绕过 |

定向先红证据：`artifacts/listing-zero-before.log`；最终定向、全量与浏览器结果见后续验证记录。分析及同输入回放：`artifacts/listing-latency-analysis.json`、`artifacts/listing-enhancer-compare.json`。

## 验收状态与恢复点

最终 `npm run verify` 516文件/6804项全部通过；`node scripts/verify-fc27-prelaunch.mjs --browser` 106文件/1986项及完整离线Chrome通过。新增两浏览器标签页0间隔挂牌仍互斥、普通move仍等待的实际Web Lock检查通过。55张Transfer及55张混合仓库均通过生产调度/原生适配/共享流量组合测试，仅开始时一次会话健康检查，无逐卡鲜读、人为等待或重复写。

首次全套暴露旧组合fixture仅提供success而没有真实原生itemIds，现按捕获的原生响应补齐；新55张测试原先误把调度器首次会话检查算成逐卡鲜读，已明确断言仅这一次检查。原交易/停止断言不放宽，最终全套复跑通过。日志`artifacts/listing-zero-verify-final.log`、`artifacts/listing-zero-prelaunch.log`。

根目录与dist脚本一致：3,059,335字节，SHA256 `d47318ad23023df2e70797b1300dbfb4b18e81382deb308384d502cdc95f5abd`。没有安装/刷新专用浏览器，没有启动用户任务或真实移卡/挂牌；真实网络时延、账号最终库存状态仍需用户原环境验证。下次重新安装当前构建并刷新后，验证混合库存的先后顺序、连续挂牌速度、暂停与继续；不要把离线模拟时长等同实盘时长。

保留此前保活失败仅告警的所有WIP；版本保持27.0.114，无升版、提交或推送。私人.tmp不纳入Git。最终构建是否安装须另记，不能把本地构建当作浏览器已更新。
