# Android Companion APK 备用方案

记录日期：2026-09-15。状态：备用路线，默认不启用。用户要求在 Web App 完全无法满足需求时再考虑；若只是部分核心 SBC 缺失，也须由用户明确决定是否值得转向 Android。本文不表示已经支持 FC27，不启动模拟器、不修改安装包、不授权账号操作。

## 1. 触发与停止条件

先以官方公告和只读实测确认网页能力，再由用户决定是否启动调查。从只读原型进入真实账号写操作前，以下条件必须同时满足：

1. EA 官方确认或实测证明 Web App 无法执行首发所需 SBC；
2. FC27 Android Companion 能读取目标 SBC 的条件、进度和库存；
3. App 的提交接口能提供可验证的成功、部分成功、重复提交和奖励状态；
4. 修改版能在隔离 Android 设备上稳定安装和运行；
5. 用户认可客户端修改和自动化的维护、条款与账号风险；方案不依赖绕过登录、TLS、完整性检查、设备安全或服务端权限。自有测试签名不等于伪造官方签名。

任一条件不满足，停止 APK 自动化，保留只读调查结果。不能因为 APK 能重新签名或界面能显示，就声称具备安全提交能力。

### 1.1 公告证据的范围

用户提供的 `Screenshot 2026-09-15 202918.png` 展示 EA [FC27 Launch Update](https://www.ea.com/games/ea-sports-fc/fc-27/news/pitch-notes-fc27-launch-update) 中的原文：

> Streamlined SBCs will be available on console and PC at launch and are intended to release in the Companion App later in Season 1.

这里的 PC 指游戏客户端，不是浏览器。该段仅说明新式 SBC 首发在主机/PC、计划第一赛季稍后进入 Companion，没有承诺 Web App 支持，也没有宣布 Web App 永久取消全部 SBC。手机首发也不保证已有新式 SBC。不能仅凭这张截图触发 APK 开发。

## 2. FC26 APK 静态基线

调查文件由用户提供，存放于本机 `C:\Workspace\ea-sports-fc-26-companion-26-7-1-10821.apk`。绝对路径仅是本次取证位置，跨工作机以 hash 识别；安装包、提取资源和原始截图不提交仓库。

- 文件：`ea-sports-fc-26-companion-26-7-1-10821.apk`
- 版本：`26.7.1.10821`，versionCode `26071`
- 包名：`com.ea.gp.fifaultimate`
- SHA-256：`874AD15EF8AD55C65163CDFBEC9E3DB9A5EC13CD548DC051E62D847A2A5E880A`
- 大小：100,987,862 bytes（约 101 MB）
- Android：minSdk 29，targetSdk 36
- ABI：此包仅观察到 `arm64-v8a` 原生库，分别为 `libRevenueSDKLib.so`、`libeadpsdklib.so`
- 结构：`classes.dex`、`classes2.dex`、`assets/www/`、Cordova plugins
- 页面配置：`eafc26.content.easports.com`、`fut_year = "2026"`

从 `META-INF/EAMKEYST.DSA` 读取到的证书主体为 `CN=EAM, OU=EAM, O=EAM, L=LA, S=CA, C=US`，证书 SHA-256 为 `5BFF7D614E1BA11A566ABB589C863B013F79AA747BD2146733366C5625A5F0D2`，证书签名算法显示 `sha1DSA`。这是证书读取结果，不是完整 APK 签名校验结论，也没有与可信官方安装的签名作独立比对，不能单凭主体名称认证来源。后续需使用 Android SDK `apksigner verify --verbose --print-certs` 核验实际签名方案及完整性；本次未执行。

修改已签名内容会使原签名无效，自有密钥重签将产生不同安装签名；不能假设官方更新、登录或完整性检查仍然接受修改版。Android App 签名证书与 HTTPS 服务证书是两件事，不应混淆。

## 3. 已确认的技术可行性信号

这是 Cordova/PhoneGap 混合应用，`assets/www/index.html` 加载 `cordova.js`、`cordova_plugins.js`、`compiled_1.js` 至 `compiled_7.js`、`ocompiled.js` 和 `Main.js`。顶层 JS 文件合计约 5.24 MB（不含 plugins 子目录），其中存在大量可辨认的业务名称，另有混淆代码；并非所有逻辑都已分析。它不是纯原生界面，存在以下符号：

- `UTItemRepository`、`UTItemEntity`、`UTItemDomainRepository`；
- `UTSBCRepository`、`UTSBCService`、`UTSBCChallengeEntity`；
- `UTSBCPlayerRequirementDTO`、`UTSBCEligibilityDTO`；
- `UTSquadBuildingChallengeDAO` 和 `UTSquadBuilderViewController`。

FC26 中观察到的调用关系是：

```text
UTSBCService.submitChallenge
  -> saveChallenge
  -> UTSquadBuildingChallengeDAO.submitChallenge
  -> /ut/game/{GAME_NAME}/sbs/challenge/{challengeId}
```

该传统 SBC 调用链位于 `assets/www/js/compiled_4.js`；`Main.js` 中还存在 `getAppMain()` 与 `deviceready` 启动流程。以上只证明静态代码存在，不能证明服务端当前仍开放、每个方法可调用或所有安全字段齐全。尤其不能证明 FC27 保留相同对象、路径、字段或新式 Streamlined SBC 语义。

本次使用 ZIP 目录检查、`adbkit-apkreader@3.2.0` 解析 Manifest、系统 CMS 解析器读取证书和静态文本定位。分析依赖与解包副本仅位于临时目录，没有运行 APK 内的业务脚本，没有用 JADX 完成 DEX 反编译。没有安装、重打包、签名、登录或执行任何 SBC；未确认是否存在证书固定、Play Integrity、反调试、模拟器限制或资源完整性检查，不能把未发现当作不存在。

## 4. 推荐改造边界

保持现有 FCAutomationTool 的纯模块边界：

```text
Android Adapter / Cordova bridge
        -> serializable FC27 snapshot
        -> existing selection/protection planner
        -> user-confirmed plan
        -> Android submission adapter
        -> refreshed snapshot and reconciliation
```

优先修改内置 JS 业务层；只有 JS 无法实现系统通知、持久化或受控页面通信时，才增加最小 Cordova 原生桥。不要一开始复制整个 Web App Runner，也不要把 EA 原生 SDK 当作可调用的公共 API。

首个 PoC 应是 APK 内的独立、本地只读模块和小面板，不直接加载完整 `FCAutomationTool.user.js` 或 FSU `26.09_mod`。初始化须等待已确认的页面/Cordova 生命周期，支持重复进入页面时幂等挂载、卸载和会话切换停止；不得通过关闭 CSP 或开放远程任意脚本来实现热更新。桌面规划器加本地通信是后续可选方案，不能一开始同时维护两套规划引擎。

可以复用：

- `src/domain` 的快照、身份合同；旧评分公式仅用于仍成立的传统 SBC，不用于新式积分；
- `src/selection` 的保护和候选过滤；
- `src/inventory` 的账本、delta、容量未知语义；
- `src/sbc` / `src/workflows` 的事务安全原则及经合同测试确认可复用的代码；仅替换 Adapter 不足以把传统阵容事务改成分批积分贡献；
- 诊断、停止、重启恢复和测试约束。

必须重做或重新确认：

- FC27 Companion 的页面模型、对象名称和注入时序；
- Streamlined SBC 的积分、资格、分批提交和完成语义；
- Android 端库存、Unassigned、Storage 和奖励接口；
- 提交成功证据、重试边界和原生 WebView/Cordova 生命周期。

Tampermonkey 的 `unsafeWindow`、`GM_*` 权限和存储隔离在普通 Cordova 页面中不存在，必须经注入 Adapter 显式替换。不能把凭证降级存入页面 localStorage；Android 凭证存储按 Keystore 与应用私有存储单独设计。App 内保护策略应由用户重新确认，不自动读取网页 FSU 的 GM 存储或跨季锁卡数据。可复用的 FSU 最小核心仍需真实 provider，合同见 [FSU 集成说明](../FSU_mod/FSU_CLUB_CACHE_INTEGRATION.md)；无需把完整旧 FSU UI 搬入 APK。

## 5. Windows 模拟器验证

模拟器用于快速重复安装、日志和 UI 检查；最终仍需 ARM64 真机对照。当前 APK 含 ARM64 原生库，Windows 常用 x86-64 模拟器镜像必须确认能实际执行这些库，不能假设 Android Studio 或第三方模拟器一定具备所需转译能力。安装成功也不能代表登录 SDK 可运行。Android SDK/ADB/logcat 可与模拟器或真机配合使用；不预先采购或安装指定模拟器。

ADB 可提供安装、崩溃日志、截图和生命周期测试。`chrome://inspect` 只有在 App 的 WebView 允许调试时才可见，不能由 Cordova 或模拟器的存在推断已启用。Playwright 的浏览器检查工具不能直接当作 Android App 控制器；若需要 UI 测试再评估 Appium。模拟器快照、ADB 备份和日志可能包含登录态，不能上传或入库，也不要开放公网 ADB/CDP 端口。

### A0：官方包基线

1. 核验官方包来源、完整签名、版本与 ABI；若为 split APK，收集同一版本的全部必要分包，不能拿本次单 APK 假设后续分发形式。
2. 使用兼容的隔离模拟器或备用设备，先安装未修改官方 APK，不登录账号，记录启动、WebView 与可见的生命周期/崩溃日志；`deviceready` 仅在可观测时记录，未观测不假定通过。
3. 若模拟器失败，用真实 ARM64 Android 设备复核，区分 ABI/模拟器问题和 APK 问题。
4. 记录 Android 版本、模拟器镜像、GPU 模式、WebView 版本和 APK SHA-256。

FC26 服务若因停服拒绝登录，不能据此判定 FC27 改包失败；其无账号启动结果只能作为旧版基线。

### A1：只读页面与接口调查

1. 用户明确授权后，手动登录自有测试账号，确认官方 App 能否打开目标 SBC、库存和奖励页面。手机新式 SBC 尚未开放时等待，不猜端点或修改年份强开。
2. 记录页面是否由 `assets/www` WebView 承载，以及对象/事件是否可观察。
3. 通过官方 App 可见的调试日志或系统网络诊断记录接口形状；不得导出 token、Cookie、请求头或完整账号数据。
4. 只保存脱敏字段、接口路径类别和时序，不把原始 HAR、profile、数据库或 APK 放入 Git。

### A1R：最小重打包试验

在用户另行授权安装包修改后，从 hash 锁定的原包副本开始。先验证仅重打包、自有测试签名、无业务修改的包能否启动，再验证只增加本地静态诊断标记的包；分开定位重打包与新增 JS 导致的失败。保持原业务资源、权限、网络安全配置和认证路径不变。是否允许在候选包登录需另行确认，不能沿用官方包只读登录的授权。

每次记录输入/输出 hash、工具版本、改动文件清单、签名指纹和测试结果。可评估 Apktool、Android SDK zipalign/apksigner，但不承诺某种重打包方式可保留资源布局及原生库要求。此阶段不做 SBC、不移动库存、不自动更新。

### A2：只读规划 PoC

1. 让 App 内显示库存摘要和规划结果，不移动、不保存、不提交。
2. 用固定低风险 fixture 对比 App 显示的资格、积分和库存数量。
3. 任何未知字段、动态资格、特殊卡、Evolution、loan 或 pile 身份都默认保护并停止。

### A3：单次人工确认事务

只有 A0、A1、A1R、A2 全部通过后，且用户明确授权该次真实消耗，才在自有测试账号/低价值目标上验证一次：

- 用户明确确认后选材；
- 如接口有保存阶段，保存与提交各自取得结果；新式贡献不能强套传统阵容 save/submit 链；
- 服务器进度、消耗实体、奖励和库存重新读取并对账；
- 超时、部分成功、重复点击、进程被杀和恢复均停止或可恢复；
- 不能通过重发请求“试试看”。

连续循环、自动开包、自动领取、Rolling、交易和定时调度属于后续阶段，不得从一次提交成功直接开放。

各阶段都必须验证稳定 item ID、definition/版本、pile、loan、Evolution、特殊卡和可交易性；库存未加载完整或关键属性未知时停止。Unassigned/Transfer duplicate signal 不能未经实体确认直接提交。新式 SBC 的重复版本规则、每批上限、积分溢出和完成次数以 FC27 实测为准；超时只对账，不因没有收到响应就重发消耗。

## 6. 重打包与签名风险

经授权的本地 PoC 可在隔离设备上使用自有测试签名验证资源修改是否能启动，但是否符合条款和分发许可仍需单独评估，不因用户持有 APK 就推定可公开分发。需要记录：

- 修改前后 APK 签名和安装包身份；
- 是否能覆盖安装、卸载重装和恢复官方版本；
- 登录、推送、原生 SDK、WebView 存储和应用更新是否仍工作；
- FC27 每次更新是否需要重新分析和重打包。

同包名、不同签名通常不能覆盖官方安装；不得为了测试默认卸载用户原 App 或清除数据。优先用独立设备/模拟器。另改包名也可能破坏深链、OAuth 回调、Provider authority、SDK 注册，不是无成本的共存办法。恢复官方包也不能撤销服务端已经发生的材料消耗。

不能把绕过证书固定、完整性校验、设备认证或 EA 访问控制作为实现步骤。若官方服务拒绝自有签名版本，路线应停在只读辅助或外部规划器，不再扩大改包范围。

## 7. 工期与维护成本

以一名熟悉 Android/Cordova、协议建模和现有 Runner 的工程师估算：

| 阶段 | 估算 | 产出 |
| --- | ---: | --- |
| APK/FC27 版本调查 | 3-7 天 | 技术栈、接口、签名和可行性报告 |
| JS 只读 PoC | 2-4 周 | 规划展示、固定字段和诊断 |
| 单次可验证事务 | 从路线启动累计约 1-2 个月 | 提交、奖励、对账和异常恢复 |
| 连续自动化 | 额外 1-2 个月以上 | 补料、容量、循环和重启恢复 |
| 后续维护 | 每次 App/服务更新重复 | 重新分析、回归和签名发布 |

这些是讨论阶段的量级估算，不是完成承诺，也不代表本次静态调查已用完相应预算。等待 EA 开放的时间另计；A1R 结束后必须按证据重新估算。若严重混淆、修改版被拒绝，或服务端虽计算积分却不给出足够的资格/预览/结果信息，估算失效，可能只能保留人工辅助。服务端计算积分本身不是不可行的证据。

每次官方更新都要重新锁定 APK hash、比较 Manifest/JS/原生依赖、校验补丁锚点并回归。未知版本默认不注入、不自动提交；不要在 UI 更新后仍悄悄沿用旧材料规则。

## 8. 触发后的实施顺序

1. 保存 FC27 官方 APK 的 hash 和版本，完成 A0。
2. 将 FC26/FC27 JS 资源和 Manifest 做差异报告，不先复制旧代码。
3. 完成 A1 的 SBC、库存和提交证据；脱敏 fixture 入库并添加失败测试。
4. 经授权完成 A1R 的无业务改动重打包和诊断标记试验；未通过不得扩大改动尝试掩盖原因。
5. 在独立实验分支评估 `src/adapters/android-companion` 与独立 composition/build，只返回序列化快照和明确能力状态；这些目录目前没有创建。复用纯规划与保护逻辑，完成 A2 Dry Run。
6. 经用户确认完成 A3 单次事务；记录 partial completion 和恢复合同。
7. 重新评估是否值得实现连续循环；若不值得，保留单次辅助功能即可。
8. APK 分支独立验收安装、更新、签名和分发许可，不使用网页 userscript CI 直接发布 APK，也不因 APK PoC 成功解除现有 Release 阻断。`27.0.0` 仍是产品首个 FC27 正式版本目标，Android versionCode、本地修改序号和官方 App 版本分别管理，启用时再制定发布合同。

仓库只维护原创模块、必要的补丁规则和脱敏测试，不提交或公开分发整份官方 APK、提取的 EA 业务源码、私钥或会话数据。第三方工具应独立锁定版本，不加入 Runner 运行依赖；没有许可审查，不发布含 EA 代码的修改安装包。

## 9. 当前结论

| 步骤 | 状态 | 证据 |
| --- | --- | --- |
| FC26 只读静态检查 | Complete（限定范围） | 第 2、3 节的 hash、Manifest、Cordova 文件与符号定位；不是 FC27 验收 |
| FC27 包与官网/网页能力核实 | Pending | 尚无对应新版实测 |
| A0 官方包设备基线 | Pending | 未安装模拟器或 App |
| A1 官方 App 只读登录检查 | Pending | 未登录账号 |
| A1R 重打包与诊断标记 | Pending | 未修改、重签或安装候选包 |
| A2 只读规划 | Pending | 没有 Android Adapter 或 PoC |
| A3 单次事务 | Pending | 未授权/执行真实消耗 |
| 连续自动化与分发 | Deferred | 由前述结果及用户需求另行决定 |

FC26 APK 的 Cordova/JavaScript 结构使 APK 备用路线**技术上值得保留**，但当前没有 FC27 APK、没有真实 FC27 SBC 接口证据，也没有生产签名/更新可行性证明。因此本路线只作为 Web App 不可用时的候选，不改变当前仓库的默认 Web/Preview 路线，不把修改版 APK 作为仓库发布资产。

恢复工作时可使用指令：“Web App 已确认无法满足 SBC 需求，启用 Android APK 备用方案；先核验我提供的 FC27 安装包，执行静态差异分析，不安装、不登录、不重打包。”每步通过后在本表追加日期、输入 hash、设备/工具版本、结论和未通过项，不将代码存在、APK 签名成功或页面能打开等同于提交安全。

文档交付验证（2026-09-15）：59 个本地文档链接与 `git diff --check` 通过；`npm run verify` 通过，210 个测试文件、2,032 项测试。仅新增备用方案和关联入口，版本仍为 `0.8.65`，未改业务源码、APK、FSU 或发布门禁；这些回归结果不计为 Android 验收。
