# FSU Local 26.09.7

## FC27 开发状态

2026-09-18 用户明确以现有 `26.09.6` 为主查漏补缺，优先原有一键填阵与价格显示。未修改原版已在 FC27 实机完成初始化、Club ready 和功能入口检查；不等于全部业务已验收。`26.09.7` 仅修正价格查询/探测的赛季绑定，未知赛季不请求旧赛季地址；一键填阵尚待登录后的真实 Challenge 验证。后续只做有证据的局部兼容修复，不另建 FSU。独立 Preview 停止扩展并降为研究原型，专用浏览器已换回原版；详见 [FC27 本地支持与上游同步](FC27_LOCAL_SUPPORT_ZH.md)。下文历史完整验证记录仍指 FC26。

阶段提交复核：上述原版运行时观察未独立确认实际安装版本，不能证明 `26.09.7` 已安装或实机通过。本地完整验证通过 228 文件、2187 项测试；FC27 预发布总检查仍被旧 FSU 冻结规则阻断，当前不发布。默认安装工具提供维护版，历史 Preview 不作为默认方案。

本目录维护基于上游 FSU `26.09` 的本地版本 `26.09.7`。上游原版保持字节不变，本地版本通过可重放 Git patch 生成并保留原作者和 MIT 许可证。普通用户只需要阅读本文；修改缓存、XHR capture、状态机或 Runner 集成时，继续阅读同目录的 [FSU_CLUB_CACHE_INTEGRATION.md](FSU_CLUB_CACHE_INTEGRATION.md)。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| `【FSU】EAFC FUT WEB 增强器-26.09_origin.user.js` | 未修改的 FSU `26.09` 上游基线 |
| `【FSU】EAFC FUT WEB 增强器-26.09_mod.user.js` | 已完成真实页面验证的优化版 |
| `FSU-26.09-club-cache-optimization.patch` | 从原版生成优化版的标准 Git patch |
| `fsu-mod.config.json` | 固定上游版本、本地版本、来源、许可证和 Release 文件名 |
| `fsu-mod-manifest.json` | 版本、文件名和 SHA256 基线 |
| `Apply-FsuOptimization.ps1` | 对原版或后续上游版本安全尝试应用补丁 |
| `LICENSE` | 上游和本地修改共同保留的 MIT 许可证 |

补丁由 `scripts/generate-fsu-patch.mjs` 生成。不要手工同时修改 patch、manifest 和优化版脚本。

## 直接安装

从最新 GitHub Release 安装：

```text
https://github.com/ShatteredLancer/FCAutomationTool/releases/latest/download/FSU-Local.user.js
```

维护版保留原版的 `@name` 和 `@namespace`，必须作为原版 FSU 的就地更新安装。Tampermonkey 中只应存在一个启用的 `【FSU】EAFC FUT WEB 增强器`；安装确认页应显示版本升级到 `26.09.7`，而不是新增第二个 FSU 脚本。

本地版本使用 DailyLoopRunner GitHub Release 的独立 `@downloadURL` 和 `@updateURL`，不会被上游 Greasy Fork 自动覆盖。上游更新不会自动进入本地版本；必须先更新不可变基线、重放或重建补丁并完成真实页面验证。

`@name` 和 `@namespace` 不得改成 Local 专用值。Tampermonkey 会为不同脚本身份分配独立的 GM 存储，导致排除可交易、排除联赛、Gold Range、Lock 等设置恢复默认。曾安装过旧 `【FSU Local】` 身份的用户，需要先迁回原版身份后再安装本维护版；仅更新版本号不能把已经分叉的内部 UUID 合并回来。

第一次登录会执行一次完整 Club 扫描，用于建立新的实体缓存、Storage/Transfer 指纹和全量校验时间。第一次成功日志应包含：

```text
[FSU club load] completed ... Club player(s)
[FSU club cache] saved ... Club player payload(s)
```

随后在未移动、购买、挂牌或提交球员的情况下刷新登录，预期进入快速路径：

```text
[FSU club cache] fast startup accepted ... cached Club player(s)
[FSU club cache] cached Club players remain provisional ...
```

此时不应再出现 `Club.search page 1/N` 到 `N/N` 的完整分页扫描。

## 本地维护模型

- `26.09` 表示不可变上游版本。
- `26.09.7` 的最后一位表示本地修订号；本地行为变化必须递增。
- 上游升级到新版本时新增对应 origin/mod 基线，不直接覆盖已发布的 `26.09` 文件。
- `fsu-mod.config.json` 是维护输入，`fsu-mod-manifest.json` 是生成后的 hash 证明。
- Release 中使用稳定文件名 `FSU-Local.user.js` 和 `FSU-Local.meta.js`，Tampermonkey 按本地版本号更新。

## 应用到更新后的 FSU

不要直接覆盖新上游文件。使用 PowerShell 生成一个新的输出文件：

```powershell
.\FSU_mod\Apply-FsuOptimization.ps1 `
  -InputPath 'C:\Path\To\New-FSU.user.js'
```

默认输出到输入文件同目录，文件名增加 `_mod.user.js`。也可以明确指定：

```powershell
.\FSU_mod\Apply-FsuOptimization.ps1 `
  -InputPath 'C:\Path\To\New-FSU.user.js' `
  -OutputPath 'C:\Path\To\New-FSU_mod.user.js'
```

脚本执行顺序：

1. 检查输入文件 SHA256。
2. 在临时目录运行 `git apply --check`。
3. 只有上下文全部匹配才应用补丁。
4. 执行 `node --check`。
5. 原版 hash 完全匹配时，再校验输出必须等于已验证优化版 hash。
6. 全部通过后才写入输出文件。

新上游 hash 与 `26.09` 基线不同时会显示警告。即使补丁可以自动应用，也只能作为迁移预览；必须建立新的 origin/mod 基线、更新配置、人工审阅 diff，并重新验证首次全量登录、第二次快速登录和 Runner Live SBC 定向校验。

## 重新生成补丁

确认 `_origin` 和 `_mod` 文件内容正确后，在仓库根目录执行：

```powershell
npm run build:fsu-patch
```

生成器会：

- 生成统一目标名为 `FSU.user.js` 的 Git patch。
- 在临时目录对原版重放补丁。
- 执行 JavaScript 语法检查。
- 验证重放结果 SHA256 与 `_mod` 文件完全一致。
- 更新 `fsu-mod-manifest.json`。

日常只读检查使用：

```powershell
npm run check:fsu-patch
```

该命令不会修改仓库文件，已经纳入 `npm run verify`。

## 与 Daily Loop Runner 的关系

- 优化版 FSU 可能返回 `trusted-provisional` 状态。
- Runner 将该状态视为可读取但未全量验证。
- Live SBC 使用 Club 球员时，Runner 会在保存前调用 FSU 的定向验证接口。
- Storage、Transfer、Unassigned-only 阵容不需要 Club 定向验证。
- 原版 FSU 不产生该状态，Runner 仍兼容原来的 `state/ready` 行为。

## 回滚

出现无法解释的加载、库存或提交问题时：

1. 禁用优化版 FSU。
2. 重新启用未修改的上游 FSU。
3. 不要删除原版脚本或覆盖其文件。
4. 导出 `FSU Club diagnostics` JSON，记录 FSU、Runner 和 Enhancer 是否启用。

缓存优化不得放宽 FSU Lock、Only Untradeable、排除联赛、Evolution、高分卡或特殊卡保护。任何提交前实体不一致都应停止，而不是继续使用缓存卡。
