# FC27 可选 LLM 助手（开发验证）

日期：2026-09-25。默认关闭；当前只接入专用浏览器检查器，**尚未接入 Tampermonkey 正式面板**。FSU、传统 Live 事务、生产网络权限和发布资产均不改变。它不是完整 SBC Solver/Market 交付。

## 支持范围

| 协议 | 地址/模型 | 实现 |
| --- | --- | --- |
| `chat-completions` | 自定义完整 URL 和模型名；适用于相同协议的中转/DeepSeek 等 | `messages`、JSON 输出、Bearer key；token 参数可选 |
| `responses` | 自定义完整 URL 和模型名 | `input`、`text.format`、`store:false`、Bearer key |
| `gemini` | 完整 `.../models/{model}:generateContent` URL | `contents`、`systemInstruction`、`generationConfig`、`x-goog-api-key` |

仅支持非流式 JSON 响应。不能从品牌推断某个端点一定兼容，需先 `ai-test`；未测试真实服务商不能标记为已验收。Azure 特有 `api-version`/额外认证头、OAuth、SSE、厂商原生工具调用和自动模型发现不在本批范围。HTTPS 默认允许；明文 HTTP 只允许 localhost/127.0.0.1/::1，拒绝 URL 内凭据、query、fragment。endpoint 是**完整请求路径**，不是仅填域名或 `/v1`。

## 最简启动

在仓库 PowerShell 执行；第一次会生成仓库外的空白配置模板，不要求输入信息或关闭已打开的浏览器：

```powershell
.\StartFCAutomationToolAIInspection.ps1
```

默认配置文件为 `%LOCALAPPDATA%\FCAutomationTool\ai-inspection.json`（本机为 `C:\Users\Administrator\AppData\Local\FCAutomationTool\ai-inspection.json`）。填写 `endpoint`、`model`、`apiKey` 后再次运行同一命令，以后会自动读取，不再反复询问。

```json
{
  "schema": 1,
  "protocol": "chat-completions",
  "endpoint": "",
  "model": "",
  "outputFormat": "json",
  "chatTokenField": "max_tokens",
  "shareAggregates": false,
  "apiKey": "",
  "protectedCredential": ""
}
```

`endpoint` 填完整请求地址，例如中转的 `https://你的域名/v1/chat/completions`；`model` 填该服务接受的精确名称。Gemini 原生协议使用 `protocol: "gemini"` 及 `.../models/{model}:generateContent` 路径；兼容 Chat 协议的 Gemini/DeepSeek 中转仍选 `chat-completions`。`shareAggregates: true` 表示同意将脱敏 SBC 需求与候选组计数发送给该接口，默认 `false` 仍可做合成 `ai-test`，不能运行 `puzzle-ai`。

首次成功导入时，启动器用 Windows DPAPI 当前用户模式保护「Key + 完整 endpoint + 协议」，写入 `protectedCredential` 并清空 `apiKey`。只有原 Windows 账户/计算机可正常解密；更改 endpoint 或协议后，旧 Key 会被拒绝使用，须重新填写 `apiKey` 并检查分享选择。更换模型不要求重填 Key。模板文件限制为当前用户与 SYSTEM 访问，配置拒绝放入仓库；明文只在你手动填写后、导入前暂存，编辑器备份/历史不会由工具清除。浏览器不继承 `FCAT_LLM_API_KEY`，运行结束或异常后恢复启动前环境变量。

可选命令（均不调用模型）：

```powershell
.\StartFCAutomationToolAIInspection.ps1 -SaveConfig        # 立即加密导入，不启动浏览器；旧会话仍开着也可执行
.\StartFCAutomationToolAIInspection.ps1 -SaveConfig -SetKey # 隐藏输入替换 Key，不需在 JSON 填明文
.\StartFCAutomationToolAIInspection.ps1 -CheckOnly         # 只检查配置、凭据、依赖及 profile 占用；不改文件
```

可通过 `-ConfigPath` 指向另一份仓库外文件；协议/模型/格式参数仍可覆盖配置，正常启动时保存选择。没有后台模型请求、自动重试或自动消费 EA 库存。DPAPI 不防御已控制当前账户或本机管理员的读取。

### 专用浏览器重复启动

`AI inspection exited with an error` 曾是所有 Node 启动失败共用的尾部异常。2026-09-25 本机复现确认：旧 `run.mjs --agent` 会话仍占用 `.fcat-browser-inspection/profile`，Chrome 将第二次启动转交旧会话并退出，Playwright 的新控制管道因此关闭；尚未执行模型请求。

现在启动器在解密/询问 Key 前精确检查 Chrome/Edge 的 `--user-data-dir`，输出 `FCAT_BROWSER_PROFILE_BUSY` 和对应 PID。请在旧检查终端输入 `q`；找不到旧终端时，只关闭带自动测试控制提示的专用浏览器窗口，再运行启动器。不要清空 profile、删除锁文件或关闭所有普通浏览器。`-SaveConfig` 不需要关闭旧会话。若检查后发生启动竞争，Node 会给出 `FCAT_BROWSER_LAUNCH_FAILED`，保留阶段提示并隐藏原始浏览器参数；其它检查失败有独立配置/依赖/凭据错误码。

启动后命令：

```text
ai-test
puzzle 19 43
puzzle-ai 19 43
q
```

`ai-test` 只发送合成连接测试，可能产生少量模型费用，无需 EA 登录；`puzzle` 不使用 AI；`puzzle-ai` 需要 EA 已登录、当前 Challenge 为 IN_PROGRESS，以及明确同意分享聚合。示例 ID 仅为本仓库已观察样例，必须使用当前真实 Challenge。AI 不会初始化挑战、改变阵容或提交。

服务不支持 JSON 输出参数时可用 `-OutputFormat text`，支持严格 schema 时用 `-OutputFormat schema`；两者都强制本地 JSON/schema 校验。Chat 协议的部分模型要求 `-ChatTokenField max_completion_tokens`。不自动更换模型、地址、输出模式或重试付费请求。

## 高级环境配置

开发入口只读取以下 `FCAT_` 变量；不读取其他应用或当前会话的凭据：

- `FCAT_LLM_ENABLED=true`
- `FCAT_LLM_PROTOCOL=chat-completions|responses|gemini`
- `FCAT_LLM_ENDPOINT`：完整请求 URL
- `FCAT_LLM_MODEL`：端点接受的精确模型名
- `FCAT_LLM_API_KEY`：进程环境中的密钥，勿放命令行参数/日志/仓库
- `FCAT_LLM_KEY_ENDPOINT`：密钥明确绑定的配置 endpoint，必须与当前 endpoint 完全相等（Gemini 使用同一个 `{model}` 模板）
- `FCAT_LLM_SHARE_AGGREGATES=true`：独立同意发送挑战/候选聚合
- `FCAT_LLM_FORMAT=json|schema|text`（默认 json）
- `FCAT_LLM_CHAT_TOKEN_FIELD=max_tokens|max_completion_tokens`（默认 max_tokens）

随后运行 `node scripts/browser-inspection/run.mjs --agent --with-extensions`。普通 `puzzle` 不受上述配置影响；不设置 ENABLED 就不调用模型。本批没有内置代理或配置代理凭据；Node 的外部连通性需要自行具备，不复用浏览器代理或任意其他程序凭据。

## 边界与恢复

1. 始终先做本地规划；纯库存模式已有可行解则零模型请求，只在本地达到搜索预算时辅助重新排序。市场模式允许继续优化已有有成本方案；零成本方案或已耗尽改善预算时不调用模型。
2. 本地 session 保留精确实体，发送的只有规则、最多每类 32 个候选组、评分计数、freshness/搜索摘要；分组截断会显式标注。
3. AI 只选择已观察国家/联赛/关联俱乐部分组或低分策略，不改材料保护、人数、位置合法性、评分/化学公式或最终校验。纯库存模式只重排既有候选；市场模式可在经过验证和报价的目录候选中调整有界候选池，不扩展到未知卡片或无报价版本。
4. 默认每会话 3 次 HTTP、每次 20 秒/2,048 output tokens；每次本地 50,000 节点、总计 150,000 节点。达到预算不是证明无解，更不是自动购买授权。
5. 输入变化、无效 JSON、拒绝、截断、未知指令、重复策略、401/429/超时均停止；不重试同一付费请求。原本地结果仍可查看，修好配置后重新执行同一命令即可。
6. HTTP 禁止重定向和 Cookie，响应最多 128 KiB。错误输出不包含服务响应正文、请求头、key 或模型推理；模型摘要也不写入日志。
7. 模型调用/合成测试不等于 EA 公式差分、真实填阵/提交验收。市场补卡目前只有开发期只读联合规划；真实 FC27 目录/报价 Provider、报价与购买事务、多阵优化、Android/UI 接入仍待后续实现。

### 市场模式（开发期只读）

市场模式会把已通过 FSU 过滤的库存候选与有明确 FC27 赛季/平台/TTL 证据的目录报价联合规划。模型最多看到规则、评分分布、国家/联赛/俱乐部的聚合数量、价格下界和预算；不会收到 item ID、definition ID、完整卡库、账号信息或逐卡报价记录。已有零成本方案不调用模型；已有有成本市场方案仍可让模型比较未尝试路线，但最终版本、价格和成本始终由本地确定性规划器决定。

当前浏览器报告中的 Club 缓存不是市场目录，且没有经过审查的 FC27 报价 Provider 时，检查器返回阻断或只读预览。`purchases` 不是可直接提交的库存实体；每个采购项都必须在执行前重新核价并取得精确回执，随后刷新库存、按新快照重新规划，最后仍需单独确认 SBC。当前没有任何自动买入、竞价、挂牌或交易写接口接入。

开发检查命令为 `puzzle-market <set-id> <challenge-id>` 和 `puzzle-market-ai <set-id> <challenge-id>`。当前先读取经过审查的数据快照，默认路径 `artifacts/fc27-market/input.json`，也可通过 `FCAT_MARKET_INPUT_FILE` 指定；这不是自动下载器，用户不需要手工整理全库。输入只接受 `schema/platform/catalog/quotes/marketPolicy`，拒绝合成目录作为实机输入；缺文件返回 `FC27_MARKET_DATA_REQUIRED`。真实 Provider 接通之前，不应人工填造赛季、平台、余额或报价证据来解除阻断。

市场聚合分享与库存分享分别授权：AI 市场命令还要求检查进程显式设置 `FCAT_LLM_SHARE_MARKET=true`，不会沿用 `shareAggregates` 自动开启。默认最多 96 个市场候选（硬上限 256），每次最多 50,000 节点、默认总计 150,000 节点、最多五次本地路线；目录上限 50,000 条不等于把全库送给模型。返回最优只表示已完成搜索的候选池内最优，搜索超限或候选池无解不等于全市场无解。

## 官方协议参考

实现时核对的公开文档（不是模型或中转服务的兼容保证）：

- OpenAI：`https://developers.openai.com/api/docs/guides/structured-outputs`
- Gemini：`https://ai.google.dev/api/generate-content`
- DeepSeek：`https://api-docs.deepseek.com/guides/json_mode/`

OpenAI Docs 指引用于核对协议/schema；未引入 SDK、固定模型或服务商原生 Agent 框架。
