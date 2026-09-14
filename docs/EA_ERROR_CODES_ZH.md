# EA FC Web App 错误码记录

本文记录从 EA FC Web App 当前客户端脚本中确认过的 `UtasErrorCode` 映射，以及
FCAutomationTool 处理这些错误时应遵循的边界。它不是 EA 官方公开 API 文档；EA
更新 Web App build 后必须重新核对映射。

## 当前确认范围

- 核对日期：2026-08-21。
- Web App build：`10821`。
- 核对脚本：`js/ocompiled.js?_=10821`。
- 获取方式：通过 `http://127.0.0.1:1080` 代理下载。
- 结论来源：客户端 `UtasErrorCode` 枚举的字符串表解码，以及客户端自身的
  HTTP/错误处理分支。

## 关键结论：446

`446` 的确定含义是：

```text
UtasErrorCode.CHEMISTRY_VERSION_MISMATCH
```

在本次 `bug.log` 中，它表现为：

```text
HTTP status: 403
EA error code: 446
type: UTServerErrorVO
reason: null
itemViolations: null
```

因此：

- `446` 不是 `429` 限流。
- `446` 不是 `REQUIRED_ITEM_UNAVAILABLE`，也不是固定的缺卡错误。
- `446` 不是 SBC 次数耗尽；次数耗尽应结合 Set/Challenge 的状态和剩余次数判断。
- HTTP `403` 是客户端对该 EA 语义错误的传输层表现，不能只按普通 HTTP 403
  推断为账号权限问题。
- `chemistryEnabled: true` 出现在失败请求中，但这只能说明该提交启用了化学计算，
  不能单独证明具体是哪一项阵容化学条件失配。

本次日志中，同一个 `10x 85+ Upgrade` Challenge 在此前已经成功提交 8 次，失败前
约 24 秒还有一次成功，失败阵容也通过本地 `84/84`、`special 1/1`、唯一
`definitionId` 和 `challenge.canSubmit() === true` 检查。11 张卡在拒绝后仍然存在，
没有被消耗，包数量也没有变化。因此 `446` 在当前证据下是**状态相关、可偶发的
化学版本不同步**，不是该 SBC 或该评分阵容的必然失败。

## 已确认的错误码

| 十进制 | EA 名称 | 处理含义 |
| ---: | --- | --- |
| 440 | `REGION_MISMATCH` | 区域不匹配 |
| 442 | `ACCOUNT_MISMATCH` | 账号不匹配 |
| 446 | `CHEMISTRY_VERSION_MISMATCH` | 化学版本不匹配 |
| 457 | `EVENT_EXPIRED` | 事件过期 |
| 458 | `CAPTCHA_REQUIRED` | 需要验证码 |
| 460 | `UT_BAD_REQUEST` | EA 请求无效 |
| 461 | `PERMISSION_DENIED` | 权限拒绝 |
| 462 | `STATE_INVALID` | 状态无效 |
| 463 | `NO_BID_TOKENS` | 没有竞价 Token |
| 464 | `NO_TITLE_ID` | 缺少 Title ID |
| 465 | `NO_USER` | 缺少用户 |
| 466 | `NAME_EXISTS` | 名称已存在 |
| 467 | `PROFANITY` | 命中不当词过滤 |
| 468 | `LOGGED_IN_ON_CONSOLE_LEGACY` | 已在旧版主机登录 |
| 469 | `DELETING_LAST_SQUAD` | 不能删除最后一个阵容 |
| 470 | `NOT_ENOUGH_CREDIT` | 余额不足 |
| 471 | `ITEM_EXISTS` | 实体已存在 |
| 472 | `DUPLICATE_ITEM_TYPE` | 重复实体类型 |
| 473 | `DESTINATION_FULL` | 目标容量已满 |
| 474 | `LOGGED_IN_ON_CONSOLE` | 已在主机登录 |
| 475 | `NO_CARD_EXISTS` | 卡不存在 |
| 476 | `CARD_IN_TRADE` | 卡正在交易中 |
| 477 | `INVALID_DECK` | 阵容无效 |
| 478 | `NO_TRADE_EXISTS` | 交易不存在 |
| 479 | `INVALID_OWNER` | 所有者无效 |
| 480 | `SERVICE_IS_DISABLED` | 服务已禁用 |
| 486 | `PLAYER_HAS_RED_CARD` | 球员有红牌 |
| 487 | `REMOVE_WATCH_FAILURE` | 移除关注失败 |
| 488 | `SWAP_ITEM_WITH_ITSELF` | 不能与自身交换 |
| 489 | `DID_CREATE_EXCEEDED` | 创建次数超限 |
| 490 | `DID_LOGIN_EXCEEDED` | 登录次数超限 |
| 491 | `DEVICE_SUSPENDED` | 设备已暂停 |
| 492 | `SBC_EXPIRED` | SBC 已过期 |
| 494 | `LOCKED_TRANSFER_MARKET` | Transfer 市场已锁定 |
| 495 | `SOME_ITEMS_NOT_FREE` | 部分实体不可自由使用 |
| 496 | `UNABLE_TO_APPLY` | 无法应用 |
| 20000 | `ACCOUNT_BANNED` | 账号被封禁 |
| 20001 | `UPDATE_REQUIRED` | 需要更新 |
| 20003 | `GEOIP_DENIED` | GEOIP 拒绝 |
| 20004 | `UNRECOVERABLE` | 不可恢复错误 |

## 与常见日志的区别

### 429

`429` 是 HTTP 层限流信号。它需要结合请求时间、最近请求数、Retry-After 和同一
时间窗口内的其它请求判断。它不能与 `446` 合并为同一类错误，也不能因为出现
`446` 就自动认定账号被限流。

### 409

`409` 可能带有 `itemViolations`，常见于球员在 Active Squad、锁定或其它 EA 实体
状态冲突。是否允许一次受限的确认提交由现有的 Active Squad 保护策略决定；不能把
`446` 当作 409 的确认提交理由。

### 471

`471 = ITEM_EXISTS`。开包或实体化流程中出现 471 时，必须检查开包响应是否已经
返回物品、Purchased/Unassigned API 是否已出现新实体、以及当前 Pack 实例是否仍是
有效待处理实例。不能仅凭“页面没有显示 Unassigned”判断包无效，也不能在有待处理
物品时再次开包。

### `REQUIRED_ITEM_UNAVAILABLE`

这是业务层材料不可用信号，不是 `446`。诊断时要分别记录：需求类型、允许来源、每个
来源的候选数量、被保护数量、判重结果和最终缺口，避免把判重失败误报成库存不足。

## `446` 的安全处理原则

当前没有足够证据证明重试 `446` 一定安全，因此不能把它无条件加入普通自动重试
列表。推荐的诊断/恢复顺序是：

1. 保留本次请求的 Set、Challenge、阵容 item ID、definition ID、评分、Required
   Special、chemistry 选项和请求时间。
2. 记录提交前后的 Challenge 状态、Set 次数、阵容是否仍在客户端对象中，以及
   inventory/pack 数量是否发生变化。
3. 重新读取最新 Challenge/Set 元数据和化学版本相关字段；如果对象已被刷新，重新
   规划阵容，而不是复用旧的 Challenge 快照。
4. 只有在确认提交没有产生任何副作用、且新的 Challenge/chemistry 快照与阵容重新
   对账后，才允许由上层策略决定是否进行一次有界重试。
5. 如果没有新的服务端证据，保持 fail-closed，并把 `446` 原样显示在日志中。

## 重新核对方法

EA 脚本使用混淆字符串表。核对新 build 时只需要执行以下只读步骤：

1. 通过代理下载对应 `ocompiled.js`。
2. 定位 `var UtasErrorCode` 枚举和字符串表初始化代码。
3. 执行字符串表的 base64 字符表转换和数组旋转，得到枚举名称。
4. 对照客户端错误处理分支，确认名称是否真的被 EA 客户端使用。
5. 将 build、日期和映射结果记录在本文；不要根据搜索引擎、第三方脚本或单次日志
   猜测错误码含义。

这套解码只用于调查和文档，不应在生产 Runner 中执行 EA 客户端脚本或防调试代码。
