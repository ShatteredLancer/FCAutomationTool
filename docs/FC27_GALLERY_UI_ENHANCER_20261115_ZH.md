# Gallery 大类与 Set 展示对齐 Enhancer（2026-11-15）

## 追加：大类首页顺序纠正

提交授权补记：用户随后明确要求提交并合并本次首页排序修正。fetch后origin/main与本地均为08c0faf；本轮在独立fix分支提交并快进整合到本地main，范围仅以下Gallery排序实现、回归、文档与生成脚本。版本保持27.0.110，保留已提交Trading及两个私人.tmp；不push/tag/Release，未安装到浏览器。下文“未提交”描述的是授权前验收状态；合并后按仓库规范复跑verify。

用户对照“捕获.PNG”和“捕获1.PNG”：FCAT将Rarities放首位，Enhancer依次为Premier League、LALIGA、Bundesliga、Ligue 1、Serie A、Leagues、Rarities、ROSHN、MLS、NWSL。当前FUT.GG原目录确实以Rarities开头；上轮验证了Leagues内部12个Set的排列，却错误地把两个来源的大类顺序也视为相同，现撤回该结论。

参考Enhancer27.0.1.8的M5t→Dy→o4e调用链：大类直接展示其categories接口返回的顺序，没有前端额外排序。当前截图是这10类的直接顺序证据；FCAT继续使用既有公共目录，不请求其私有接口。

计划：仅在首页展示层按已确认分类slug排列这10类，未知新分类在后方保留源序；不修改原目录、revision、内部Set顺序、计分或规划输入，不清缓存/加请求。旧缓存亦立即适用。先用截图顺序建立失败控制，再检查缓存与刷新源序变化、未知分类/不同来源、点击进入与返回、桌面/390px；最后完整verify与prelaunch/browser。现基于08c0faf/27.0.110，保留已提交Trading后台执行及两个私人.tmp，不自动升版或提交本次修正。

实现与专项已完成：`browse.js`增加纯展示排序函数，view仅在构建首页按钮时调用。截图顺序的浏览器控制先红复现Rarities首位，修后10类顺序、旧缓存/新源逆序、进入NWSL16个Set/返回、内部Set原序、1280/390px与零请求检查通过。原Gallery整套专项亦通过；27项相关单元测试验证未知分类源序、跨来源slug及冻结输入不被修改。证据 `artifacts/gallery-category-order-browser-red.log`、`gallery-category-order-browser-green.log`；离线首页截图仅用公开名称/数量与合成Set，不包含图标/账号进度，不冒充实机验收。

最终完整检查：verify504文件/6504项、prelaunch103文件/1941项及完整离线Chrome全部通过，日志 `artifacts/gallery-category-order-verify.log`、`gallery-category-order-prelaunch.log`；无重试或放宽断言。root/dist均2932261字节，SHA256 `556c78ee61025fdc8de18e4855a1451239aa0c0973ad30d28781f8ec97696209`，FCAT27.0.110/FSU26.09.10，构建一致性与发布资产检查通过。未安装、升版提交或EA写；安装新版脚本后旧缓存即可显示修正顺序。08c0faf的Trading后台执行源码未改，私人.tmp保留。

用户随后授权升版提交并合并，明确只纳入Gallery，Trading留本地。已在独立worktree准备27.0.110，以下27.0.109记录属于先前组合工作区的实现验收；正式提交范围与最终产物以[27.0.110发布说明](releases/27.0.110.md)为准。

## 已确认需求与边界

用户要求参照 Enhancer 展示大类内部的 Set 信息，并补全 NWSL 等缺失图标。沿用上轮已完成的计分与加载改进；本轮调整目录顺序、卡片信息与图标。版本仍为 27.0.109，不升版、提交或发布，不修改交易授权和历史。工作区并行 Trading 改动及私人 `.tmp` 保留。

参考已安装 Enhancer 27.0.1.8 的 Tqt/Aqt/o8/dAe/ND/X6 与 ITe/o3t/a3t 调用链，以及用户“捕获3.PNG”。公开目录顺序与截图的 12 个联赛顺序一致；此前 FCAT 按字符串 ID 排序导致排列不同。Enhancer categories 匿名接口返回 403 后未继续请求，不依赖其私有接口。

## 实施计划与当前状态

1. 已完成：保留公开目录原始分类与 Set 顺序。旧缓存仍可展示，下一次正常加载不附条件头，取得一次 200 后恢复五分钟缓存与条件请求；失败保留旧快照及原退避，不丢弃卡池/账号缓存。
2. 已完成：Set 采用单徽标、名称、D/C/B/A/S 五段进度、紧凑门槛、已收集/所需张数、总分（+加成）及代币奖励。已收集显示最多 requiredCards，完整数量在提示中保留；未知分数仍保留区间与待核说明。
3. 已完成：整卡进入详情，键盘可触发；原关注星标独立保留其语义，不冒充 EA 完成标记。五档菱形原来已有颜色，本轮补齐进度条、未达档文字与当前档强调；曾用已有菱形颜色作控制不成立，改用原先确实相同的进度条颜色先红后绿。
4. 已完成：NWSL 2221、MLS 39、沙特 350 和 Ligue 1 实际 slug；扩充 POTM、Ultimate Scream、Icons、Hall of FUT、TOTW shell，Starter 使用原生铜银金 shell。俱乐部名称未命中时可用公开队徽奖励的准确 teamEaId。继续复用 EA 已加载资源路径，不新增 EA 定义或卡池请求；Set 图片失败使用中性占位。
5. 已完成：十二联赛离线视觉与交互回归、完整 verify 与 prelaunch/browser、产物校验全部通过。

## 参考行为对照

| 项目 | Enhancer | 本轮 FCAT |
| --- | --- | --- |
| 分类内部排列 | category.sets 原顺序 | 保留公开源原顺序，十二联赛与截图一致 |
| 卡片头 | 单张原生徽标/卡壳、名称 | 单张原生资源、名称；保留原关注入口 |
| 等级 | 五档菱形、对应颜色和阶段进度 | 相同五档及阶段进度，门槛紧凑展示 |
| 统计 | Collected、总分、(+bonus)、奖励 | 中文已收集，计分所需数量上限，总分与加成同时更新 |
| 点击 | 整卡打开 | 整卡与键盘打开，关注不触发详情 |
| 响应式 | 一/二/三列 | 窄屏一列、平板二列、桌面三列 |

FCAT 继续使用既有公开目录来源及候选阵容估分标识，不把本地值称为 EA 已保存阵容分数；首任不明时不伪造确定值。颜色、间距和信息结构参照原版，保持宿主 FCAT 面板的中文和整体主题。

## 场景矩阵与证据

| 场景 | 预期 | 验证 |
| --- | --- | --- |
| 新公开目录 / 缓存往返 | 分类和 Set 原序不变 | catalog 单元回归 |
| 旧排序缓存在线 | 一次无条件正常加载，随后恢复缓存/304 | provider 回归 |
| 旧缓存离线 / 重复打开 | 可继续显示并遵守原退避 | provider 回归 |
| NWSL/MLS/沙特/法甲、稀有度、Starter、俱乐部队徽 | 未加载池前即可解析准确 EA 资源参数 | 生产入口 VM 回归 |
| 十二联赛 / 35 张已收集、30 张所需 | 30/30，完整数量提示、总分与加成、奖励 | 新 set-cards 离线 Chrome 场景 |
| 关注、整卡、键盘 Enter、返回、分数更新 | 独立关注，正确进入/返回，总分与加成一起变更 | 新 set-cards 离线 Chrome 场景 |
| 图片失败、桌面/平板/390px | 占位，3/2/1 列、无横溢出 | 新 set-cards 离线 Chrome 场景与截图 |
| 首任未知、旧详情/选择/规划流程 | 区间与原行为保留 | 既有完整 Gallery 浏览器场景 |

十二联赛视觉样本仅使用公开名称/排列和合成分数、合成收藏、离线徽标替身，不包含账号数据；真实资源 ID 由生产入口回归独立验证。不能把离线图标替身截图当作 EA CDN 或实机账号验收。

追加覆盖：对当前公开目录全部198个Set逐项运行实际生产图标解析器（空TeamConfig、合成原生资源URL和Rarity定义），所有Set和大类均有映射，不需要球员池。该控制证明映射覆盖，不证明每张EA图片当前在线可达。脚本 artifacts/gallery-icon-coverage.mjs。

已查看1280/900/390px截图，确认3/2/1列、无横向溢出，底部NWSL/MLS/沙特也覆盖。图片为 gallery-set-cards-{width}.png 与 gallery-set-cards-last-{width}.png。完整Gallery专项见 artifacts/gallery-ui-cards-final.log。

首轮完整检查发现新增浏览器脚本的六处隐式浏览器global被ESLint阻断，已改为globalThis真实入口；另旧sync/responsive测试仍要求收集数无前缀或总分尾随“分”，已按新展示结构改为精确数量与总分字段校验，原同步次数/缓存复用/心跳上限不变。独立同步与响应式复验通过，127集合×100版本的最大心跳间隔285ms，见 artifacts/gallery-ui-sync-check.log。原始失败日志保留，不将失败轮写成通过。

全量unit首轮6498通过/2失败：mapping持久化原断言期待字符串ID排序，改为输入目录32、31原序，仍只补读新32；压缩缓存的零网络控制改用orderVerified=true的新式目录，确保gzip往返保留标记且仍无请求。旧排序缓存的一次无条件刷新、恢复304、离线保留与退避由provider新增控制覆盖。对应47项专项通过，未修改同步或压缩生产逻辑。

## 恢复点与未验证项

代码实现与离线验收完成。专用实机浏览器仍归原检查进程持有，没有重启或抢占；本轮新产物未专用安装，真实页面视觉仍待安装后核验。继续时先核工作区和本文件，不回退并行 Trading 或上轮计分工作。

## 最终结果

- `npm.cmd run verify`：504文件、6500项通过，语法/ESLint/配置/架构/打包全部通过。日志 `artifacts/gallery-ui-verify-complete.log`。
- `node scripts/verify-fc27-prelaunch.mjs --browser`：103文件、1941项与完整离线Chrome通过，退出码0。日志 `artifacts/gallery-ui-prelaunch-final.log`。本次最终全套无需放宽或重跑旧Puzzle断言。
- `git diff --check`通过。root/dist内容与版本核验通过，均2928537字节，SHA256 `9aea2a832097bfbc79a270c986e837a4d72e93c3cadeea6661e1e648a5f4a76f`。FCAT27.0.109，FSU26.09.10。
- 上轮乱码交接段已按会话、日志与产物记录修复，原损坏文档留在ignored artifacts备查；没有覆盖此前正常证据。
- 本轮未升版、提交、push、Release或真实EA写；保留并行Trading工作和两个私人.tmp。安装后应核对大类顺序、NWSL等真实图片、分数/加成及整卡返回；离线图片替身不充当实机验收。
