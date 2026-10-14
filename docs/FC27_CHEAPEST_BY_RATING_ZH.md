# 按评分廉价卡公开接口调查与报价平台

## 2026-10-14 当前范围

用户要求 FUTBIN 默认使用 PS 参考价，并可在 Settings 改为 PC；同时调查
FUT.GG 的 cheapest-by-rating 页面是否存在可调用的批量接口。
不改变 EA 交易平台、选材目标、市场池审批、单卡上限或交易节奏；不执行真实交易。

实施步骤：

1. 完成 FUTBIN 账号级平台设置、单卡/批量读取、缓存与失败冷却平台隔离。
2. 保持旧购买审批/Journal 原样，新报价记录独立的 FUTBIN 参考平台。
3. 验证 FUT.GG 公开接口的实际响应，记录能力与限制，不自动接入采购执行。
4. 运行设置浏览器 smoke、报价/审批回归、完整 verify 和 FC27 浏览器套件。

## FUT.GG 实际接口

页面：<https://www.fut.gg/cheapest-by-rating/>

客户端路由与实际匿名 GET 均确认：

```text
https://www.fut.gg/api/fut/market/27/cheapest-by-rating/v2/overview/?platform=ps
https://www.fut.gg/api/fut/market/27/cheapest-by-rating/v2/overview/?platform=pc
```

2026-10-14 13:08 UTC 经本地 SOCKS5 代理 `127.0.0.1:1080` 请求，PS/PC 均为
HTTP 200、JSON、无账号登录、无 EA 凭据或预先传入的 Cookie。当前环境页面直连曾
返回 Cloudflare 403，因此代理成功不能证明所有网络都能直连或接口永远可用。
本地调查原始响应仅保存于被忽略的 `artifacts/futgg-cheapest-{ps,pc}.json`。
不把服务器下发的 Cloudflare Cookie 放入文档或 fixture。

返回结构为 `data[rating] = [{ price, eaId, name, overall, position, url, ...imagePaths }]`。
当前 PS 和 PC 都覆盖 81–93 分，多数评分段各有 11 个候选；92/93 分不足 11 张。
本次 PS 共 135 条、PC 共 134 条，逐条验证 overall 与评分组相符、正整数价格、
组内无重复 eaId，以及 URL 中的版本 ID 与 eaId 相同。
两平台数据不同，例如采样中 84 分最低 PS 700、PC 1000；这些是即时调查样本，
不是产品固定价格。`eaId` 与 URL 的精确版本信息应与本地目录再次匹配，不能从
同名、同评分或头像推断可提交身份。返回字段不包含全部 EA 提交资格/保护属性。

HTTP 响应为 `Cache-Control: public, max-age=5`，页面客户端 overview 查询另外设有
24 小时 staleTime；两者不是同一概念。响应未给每张卡提供报价更新时间，因此
接入时只能记录实际 fetchedAt，不能伪造 sourceUpdatedAt 或沿用 24 小时作为购买价 TTL。

## 接入边界与下一步

本轮只验证接口，尚未作为生产候选或估价 Provider 接线。后续可用于 Streamlined
按评分发现多张低价备选，减少逐版本报价；不能为任意库存或 Gallery 集合提供完整
报价，也不是全市场最优证明。未返回的版本不能当作零价或无货。

接入前需保留：来源开关、实际平台、精确版本目录映射、有效报价 TTL、缺价排除、
共享队列/取消与失败冷却、冻结候选池及用户审批。EA 原生市场只用于执行时确认
真实挂牌，不作为公共估价回退。FUTBIN-only 不得因该接口可用而请求 FUT.GG 报价。
候选版本仍不得在同一提交批次重复；廉价同版本的重复采购仍须跨确认消耗批次。

FUTBIN cheapest 页面本次通过同一代理仍返回 HTTP 403，不能声称已经取得该页面
全部廉价候选。现有生产 FUTBIN 使用 FSU 的 filtered/minimal 公开价格路径；本轮
仅为这些已有请求增加 PS/PC 设置，未新增第三个 FUTBIN endpoint 或改候选目录。

## 验证与恢复点

代码与定向回归已完成，平台默认/切换、单卡/批量请求、缓存隔离、冷却隔离、
旧审批不改写与新审批参考平台冻结已覆盖。设置浏览器与完整回归结果记录到版本说明。
真实 EA 登录后的 Settings 操作待验收；不需要买卡、献祭或清理旧 Journal。
恢复检查：先核对最新生产构建/安装哈希，切换 PS/PC 后仅生成新方案；旧授权不改写。
