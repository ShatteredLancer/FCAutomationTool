# 响应式与触摸界面

FC Automation Tool 使用同一套运行状态和命令处理桌面、平板和手机界面。布局变化只改变展示方式，不会重新创建当前 Loop、Profile、日志或运行会话。

## 1. 自动布局

`Config -> Layout` 提供三个模式：

- `Auto`：根据可视区域自动选择 Desktop、Tablet 或 Mobile。
- `Desktop`：强制使用桌面布局，适合桌面浏览器缩放、触摸笔记本或需要同时查看多栏 Builder 的场景。
- `Mobile`：强制使用移动布局，适合窄窗口、手机和触摸操作。

Auto 当前使用以下规则：

- 宽度不超过 620px：Mobile。
- 触摸设备横屏且可视高度不超过 620px：Mobile。
- 宽度不超过 1024px：Tablet。
- 其它情况：Desktop。

输入方式与布局独立判断。触摸屏即使使用 Desktop 布局，也会保留至少 44px 的按钮和输入控件目标。Runner 不读取 User-Agent。

## 2. 主面板

Desktop 和 Tablet 保留原有面板：

- `Options` 展开配置和完整日志。
- `L` 折叠面板。
- Desktop/Tablet 可以拖动标题栏、调整面板大小和完整日志高度。
- 保存的桌面位置和尺寸不会被 Mobile 底部面板覆盖。

Mobile 使用底部面板，并分为三个视图：

```text
┌──────────────────────────────┐
│ Loop Runner             ?  L │
├─────────┬─────────┬──────────┤
│   Run   │ Options │   Log    │
├─────────┴─────────┴──────────┤
│ 当前视图内容                 │
│                              │
│ Start / Stop                 │
└──────────────────────────────┘
```

- `Run`：选择并启动 Loop，显示最新状态。
- `Options`：运行选项、Profile、Builder 和 SBC 扫描。
- `Log`：完整会话日志以及 Copy、Clear、Save 操作。

启动 Loop 时，Mobile 自动切回紧凑的 Run 控制器，并持续显示 `Stop`。运行状态、停止请求和日志不会因为旋转屏幕、调整窗口或改变 Layout 而重置。停止仍然遵守原有安全点语义，不会强制中断正在提交的操作。

## 3. Builder

Desktop Builder 保留 Library、Editor、Inspector 三栏。Mobile Builder 使用：

```text
┌──────────────────────────────┐
│ Workflow Builder       More  │
│ Profile / Name / State       │
├──────────────────────────────┤
│ Workflows Loops Recovery ... │
├─────────┬─────────┬──────────┤
│ Library │ Editor  │ Details  │
├─────────┴─────────┴──────────┤
│ 当前对象、表单或步骤详情     │
├──────────────────────────────┤
│ Save       Activate    Close │
└──────────────────────────────┘
```

- 在 `Library` 选择 Workflow、Loop 或 Recovery 对象后自动进入 `Editor`。
- 在 Workflow 中选择一个步骤后自动进入 `Details`。
- `More` 展开 New profile、Undo/Redo、Validate、Preview、Import 和 Export 等次要命令。
- `Save`、`Activate` 和 `Close` 固定在底部，避免长表单把关键命令推离屏幕。
- 顶部 Workflows/Loops/Recovery/Dynamic SBCs/JSON validation 标签可以横向滚动。

手动强制 Desktop 时，Builder 恢复三栏并在窄视口提供横向滚动；触摸目标仍保持触摸尺寸。

## 4. 对话框与 Recap

Batch Open、Player Pick、Recap、Reward Alert 设置和帮助对话框在 Mobile 中使用全屏 `100dvh` 布局：

- 标题和主要操作保持可见。
- 内容区域独立纵向滚动。
- 使用设备安全区，避免被刘海、圆角和底部手势区域遮挡。
- Recap 继续每页显示 15 项；分页、停止原因和预览行为不变。
- Pack Highlight 显示在屏幕顶部，不会被底部运行面板遮挡。

## 5. 手机运行注意事项

- 浏览器切到后台或锁屏后，系统可能暂停页面计时器和网络活动。保持 EA Web App 在前台，并关闭该站点的省电或自动休眠限制。
- 屏幕旋转和软键盘会改变可视区域；Auto 会重新计算布局，但不会重启运行会话。
- Mobile 底部面板禁用拖动和 resize；用 `L` 折叠后可以拖动 48px 图标避开 EA 控件。图标位置会保存并在屏幕旋转后限制到可视范围内，切回 Desktop 后继续使用单独保存的桌面几何信息。
- 若自动判断不适合当前设备，在 `Config -> Layout` 手动覆盖；该选择会保存在本地。

## 6. 验收清单

发布前至少检查：

1. Desktop、触摸 Desktop、Mobile 竖屏和 Mobile 横屏。
2. 空闲、扫描、运行、Stopping 和运行结束状态。
3. Mobile Run/Options/Log 切换及完整日志滚动、复制和保存。
4. Builder Library/Editor/Details、More 菜单和底部操作栏。
5. Batch Open、Player Pick、Recap、Reward Alert 和帮助对话框。
6. Auto/Desktop/Mobile 来回切换后，运行状态、Profile、日志和桌面面板几何保持不变。
