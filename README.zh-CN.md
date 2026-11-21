# Cache Pulse Antigravity

[English](README.md) | **简体中文**

**Antigravity 实时提示词缓存与用量监控插件**——在客户端里直接查看 Prompt Cache 命中率、任务均速、分模型消耗，以及近 5 小时 / 24 小时 / 7 天的多会话汇总统计。

Cache Pulse Antigravity 基于原生 MCP Apps 面板与 Lifecycle Hooks 在本地运行。你可以逐轮盯盘缓存命中情况、横向对比不同模型的 Token 开销与响应速度，也可以按时间窗口复盘一段时间内所有任务的整体用量。**完全本地读取与计算，不联网、不上传任何对话或凭据。**

---

## 主要功能

- **中英双语（`EN / 中`）**
  自动跟随客户端语言（英文环境默认英文，中文环境默认简体中文），顶部工具栏随时一键切换。
- **单会话实时监控**
  - 实时展示当前会话的**缓存命中率**、缓存 / 新输入 / 输出占比条，以及逐轮输入规模与命中率趋势图。
  - 自动提取左侧任务名称（无标题时回退取首条提问摘要），与项目名一起显示，避免同一工作区下多个会话重名分不清。
  - 逐轮列出调用明细（模型、缓存/新输入、输出与单步速度），支持「详情 / 精简」两种布局，自动适配明暗主题。
- **近 5 小时 / 24 小时 / 7 天多会话统计**
  - 汇总统计所选时间段内的**总 Token 消耗**、**总缓存命中率**与**所有任务均速（`tok/s`）**。
  - 提供多周期对比、模型/Token 构成环形图、分时段用量与命中率趋势图、模型/项目排行、效率散点图（命中率 × 均速），以及支持排序、点击直达会话详情的列表。
- **分模型统计与筛选**
  - 支持**合并档位**（将同一模型的 High / XHigh 等思考档位合并查看）与**细分档位**两种口径。
  - 单会话页和周期统计页均支持点击顶部模型标签或占比条，快速筛选查看单一模型数据。
- **Hook 毫秒级计时**
  - 通过 Lifecycle Hooks（`SessionStart`、`PreInvocation`、`PostInvocation`、`Stop`）在本地记录每轮实际耗时，历史会话无 Hook 记录时自动按日志时间差兜底估算均速。

---

## 隐私与安全

- 仅读取本机 Antigravity 目录下的会话日志（`~/.gemini/antigravity/conversations`）、任务元数据（`~/.gemini/antigravity/annotations`），以及插件本地数据目录 `${PLUGIN_DATA}` 中的计时文件。
- 全程离线运行，不发起外部网络请求，不收集或上传任何对话内容与凭据。

---

## 安装方式

> 运行环境：本机需安装 **Node.js 20+**（确保 `node` 命令在系统 `PATH` 中可用）。

### 方式一：Antigravity CLI 一键安装（推荐）

```bash
agy plugin install https://github.com/mqy2333/cache-pulse-Antigravity
```

仓库根目录已附带打包好的 `dist/server.cjs`、`dist/app.html` 和 `scripts/hook-capture.cjs`，从 GitHub 拉取后可直接运行，无需手动构建。

### 方式二：手动克隆到插件目录

**Windows（PowerShell）：**

```powershell
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git "$env:USERPROFILE\.gemini\config\plugins\cache-pulse"
```

**macOS / Linux：**

```bash
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git ~/.gemini/config/plugins/cache-pulse
```

克隆完成后，在 Antigravity 客户端中重新加载插件（或重启客户端）即可使用。

---

## 使用说明

安装生效后，可以直接在对话框输入类似下面的指令，或使用插件自带的快捷提示词打开监控面板：

- *“打开当前会话的 Cache Pulse 监控面板”*
- *“查看近 24 小时各模型 Token 用量与缓存命中率”*
- *“统计近 7 天所有任务均速与总消耗”*

打开面板后，你可以在界面内随时切换：

- **单会话** / **周期统计（近 5 小时 / 近 24 小时 / 近 7 天）**
- **合并档位** / **细分档位**，点击模型标签筛选单个模型
- **详情** / **精简** 布局
- **`EN` / `中`** 界面语言

---

## 统计口径

- **缓存命中率**：`cache_read_tokens / (cache_read_tokens + uncached_input_tokens)`。
- **任务均速（`tok/s`）**：已计时轮次的加权平均输出速度（优先采用 Hook 记录的 `PostInvocation - PreInvocation` 毫秒耗时；缺少 Hook 记录的历史轮次，按日志相邻步骤的时间差估算）。
- **多周期汇总范围**：采用宽松口径——只要会话在对应时间窗口内活跃过，就会将该会话的累计数据整体计入汇总；时间轴图按各轮实际发生时间分段，落在窗口之前的历史轮次归入「更早延续」一栏。

---

## 本地开发与调试

```bash
npm install
npm run typecheck
npm run build
npm test
```

重新打包并同步部署到本机插件目录 `~/.gemini/config/plugins/cache-pulse`：

```bash
npm run deploy
```

---

## 开源协议

[MIT](LICENSE) © 2026 [mqy2333](https://github.com/mqy2333)
