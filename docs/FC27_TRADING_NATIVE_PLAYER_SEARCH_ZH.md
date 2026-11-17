# 交易姓名搜索复用 EA 控件

2026-11-17，保持 27.0.110，姓名界面实现及验证完成；版本读取的自动续期缺口另列于下文。

用户要求交易选卡的姓名搜索与 EA 原生、Enhancer Trader 一致。Enhancer 27.0.0.4 的 83067 模块继承 `UTMarketSearchFiltersViewController`，保留原生 `UTPlayerSearchControl`；40778 模块另加阵容标记。FCAT 直接实例化 EA 运行时控件，不复制整套 Trader 或替换交易规则；沿用 EA 输入、清空、姓名/评分双列、整行点击和展开收起逻辑。Shadow DOM 内补入对应原生样式，并仅在实例上适配外部点击的 composedPath。

姓名选择仍接现有精确版本页（每页五张、每次最多读取二十张、总上限一百），用于固定名单和统一排除名单。原有有限姓名结果、账户边界、取消及迟到响应检查保留；不引入新报价、买卖请求或自动保存。原生控件不可用时保留可操作的紧凑姓名列表，不将回退称作原生。蓝色阵容标记属于 Enhancer 额外功能，不据 Club 持有状态伪造。

步骤及验收：

1. 原生控件适配及姓名→版本接线；清空/返回/关闭后再打开不残留旧响应。
2. 固定名单添加精确版本、全部版本排除与单版本排除、分页、无匹配和读取失败；同输入比对原生行顺序/姓名/评分。
3. 桌面和 390px 浏览器验证、完整 verify 与 FC27 prelaunch；构建安装并全文回读核对，实机只读检查，不保存或启动交易。

证据来源：`artifacts/fodder-research/enhancer-27.0.0.4-readable.js`，公开 EA 方法与 CSS 在 `artifacts/fc27-browser/player-control-public.json`（不含账号数据）。最终结果与剩余缺口在文末追加。

## 实施及验证结果

- EA 控件直接复用，原生 500ms 输入处理、生成的姓名/评分行、整行选择、清空和关闭不另造一套；只在实例适配 Shadow DOM 外部点击，样式仅注入 FCAT 的 shadow。
- 实机首轮发现登录前初始化失败后一直停在备用列表。改为打开选卡窗口时初始化；新增“EA 类在面板初始化后才可用”的浏览器回归。登录后确认 `native=true`，Raya 搜索依序显示 88/86/81/79/73 五个身份，桌面及 390px、清空、重开均通过。
- 冻结实际公开 `UTPlayerSearchControl` 全部方法，真实 DOM 事件贯通姓名→版本→添加→保存/重开，以及排除全部版本、分页、取消迟到响应。控件依赖为合成 widget；另用独立无登录 EA 页面实际控件复验（版本数据合成），区分于下面实机结果。
- `npm run verify`：513 文件 / 6702 测试通过；最终 `verify-fc27-prelaunch.mjs --browser`：103 文件 / 1942 测试和完整离线 Chrome 通过。追加检查器 ESLint 通过。首轮新增回归把两个关闭编辑按钮写成唯一选择器而失败，已精确选择关闭按钮；未放宽生产断言。实机窄屏检查器初次未恢复无显式 viewport 的窗口，触发 EA Resize Window；现取实际初始宽高恢复，已复验。
- 最终 root/dist 3038291 字节，SHA256 `8eacba96cfcd07dc4a6cc1d4b9251b602af3e181f9e2bd4559659ddcc417f04d`，专用检查器 31163 已安装全文回读一致并刷新。未升版、提交或交易；保留其他 WIP 与私人 `.tmp`。
- 日志：`artifacts/native-player-verify-final.log`、`native-player-prelaunch-final.log`、`native-player-public-final.log`。实机截图：`artifacts/fc27-browser/market-player-native-live-desktop.png`、`market-player-native-live-mobile.png`。结果：`market-player-final-ui-result.json`。

## 这次版本读取 401 的调查（用户追问）

真实 `/defid` GET 在时间戳 1794930354942 返回原始 HTTP401，约 614ms；此前最后一次观察到的 UTAS 认证成功为 1794930133849，仅间隔 221093ms（3分41秒），不能归因为长时间空闲或确定服务器 TTL。姓名搜索是已加载资料，不需要这一请求。

代码事实：`fc27-market-read.js` 的 GET 关闭 `doReauth` / `doRetry`；此前新增 `renewFc27MarketSession` 只在任务 `session-check` 分支调用，`fc27-market-player-picker.js` 没有接入。原生 `UTHttpRequest._handleFail` 会在401时进行 UTAS authenticate，成功后经 telemetry 重发；FCAT 版本读取直接退出。这是明确的恢复处理缺口，不代表已经知道 EA 为何首次拒绝该 SID。

受控实机验证：同一专用页面、不刷新或手动重登，复用已审查 renewal adapter（原生共享锁、同账号守卫），1794930713289 开始认证、1794930718387 完成、1794930719156 telemetry 完成；随后只读取同一 Raya 版本页一次成功，得到 220901/88、50552549/89、67329765/89。证据 `artifacts/fc27-browser/market-player-session-recovery-result.json`。无任务启动、买卖或移卡。证明这次401可通过原生续期恢复；生产选卡读取尚未自动接入该恢复，不能宣称缺口已修复，也不自动解除交易暂停或重放交易。

下一步：把同一有界续期接入交互式只读版本获取，保留原账号/页面取消/请求上限；只对明确401重建一次只读请求。先补首次401→续期→同查询成功、续期失败/第二次401/关闭窗口/账号变化等贯通测试，再扩展到其他只读调用。不要全局打开买卖写请求重试。

## 双浏览器对照与最终实机结果（2026-11-18）

上段首次续期成功后，正式选卡又失败。被动资源时间线明确：`defid` 1794930719162/200，随后再次认证200，1794930778675/401。因此没有把一次恢复成功当成持续稳定，也没有继续要求用户反复登录。

用户明确确认日常 Chrome 同时登录此账号，随后按询问暂停并关闭日常 Chrome 的 EA 页面，仅保留专用窗口。1794931062373 开始一次原生续期，1794931064931 telemetry 完成；相同只读版本查询成功。随后已安装最终源码的正式选卡入口成功展示 Raya 的 88、89 两个可选版本（原目录返回三版本，既有进化/装饰过滤保留），桌面/390px/清空/重开仍通过，无任务保存/启动或买卖。两分多钟后不续期、不使用 picker 缓存的独立同接口读取再次成功。

这一对照强烈支持双浏览器会话相互干扰；没有读取/导出 SID，也没有观察日常浏览器的认证请求，因此不把它写成服务端所有401的唯一原因。保持单一 EA 会话是本次环境恢复的关键条件；不承诺两个浏览器反复续期能同时稳定运行。

最新证据：`market-player-final-ui-result.json`（正式 UI 成功）、`market-player-single-browser-renewal.json`、`market-player-single-browser-fresh-read.json`，均位于 `artifacts/fc27-browser/`。最终脚本哈希不变。生产自动恢复仍仅覆盖此前的交易保活分支，交互式版本读取的自动恢复尚未开发；本轮是 UI 实施和401现场调查，不把环境恢复冒充该代码缺口已修复。
