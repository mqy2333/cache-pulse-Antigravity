# Cache Pulse（缓存脉搏）

[English](README.md) | **简体中文**

**面向 Antigravity 的实时提示词缓存命中率、任务均速、分模型用量及 5 小时 / 24 小时 / 7 天多周期统计插件。**

Cache Pulse 通过 Antigravity 原生 MCP Apps 交互面板与 Lifecycle Hooks 在本地运行，帮助你逐轮监控缓存命中率、对比不同模型的 Token 消耗与响应速度，以及区分同一工作区内的多个历史任务会话——**完全离线本地统计，无任何联网上传行为**。

---

## 功能特性

- **中英双语界面（`EN / 中`）**：自动识别客户端语言环境（非中文环境默认英文，`zh*` 自动显示简体中文），顶部工具栏支持一键即时切换。
- **单会话实时监控**：
  - 展示当前会话的**缓存命中率**、缓存命中 / 未缓存新输入 / 输出占比条，以及逐轮输入规模与命中率双轴曲线。
  - 自动从会话注释与首条用户消息提取可读**任务标题**，与项目名并排显示，解决同项目多会话重名问题。
  - 最近调用明细表（模型标签、缓存/新输入、输出、单步均速）与详情/精简双布局、自适应明暗主题。
- **5 小时 / 24 小时 / 7 天多周期统计**：
  - 统计周期内触发过的所有会话的**总 Token 使用量**、**总缓存命中率**与**所有任务均速（`tok/s`）**。
  - 提供多周期横向对比、模型/Token 构成环形图、按时间切片堆叠柱状图+命中率折线图、模型/项目用量排行条、效率散点图，以及支持排序和点击跳转的会话明细表。
- **分模型统计与筛选**：
  - 支持**合并档位**（自动归并同模型的 High / XHigh 等思考档位）与**细分档位**两种模式。
  - 在单会话与周期统计页均支持点击模型筛选条、占比条快速聚焦单一模型。
- **Hook 毫秒级计时**：
  - 利用 Antigravity Lifecycle Hooks（`SessionStart`、`PreInvocation`、`PostInvocation`、`Stop`）在本地记录每轮高精度耗时，并与日志时间差回退估算融合计算真实任务均速。

---

## 隐私说明

- 仅读取本机 `~/.gemini/antigravity/conversations`、会话元数据 `~/.gemini/antigravity/annotations`，以及插件自有本地目录 `${PLUGIN_DATA}` 中的计时状态。
- 不发起任何外部网络请求，不上传对话内容或任何本机凭据。

---

## 安装方法

### 方式一：通过 Antigravity CLI 一键安装

```bash
agy plugin install https://github.com/mqy2333/cache-pulse-Antigravity
```

仓库根目录已预置打包好的 `dist/server.cjs`、`dist/app.html` 与 `scripts/hook-capture.cjs`，可直接从 GitHub 安装运行，无需额外构建步骤。

### 方式二：Git 克隆到本地插件目录

**Windows（PowerShell）：**

```powershell
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git "$env:USERPROFILE\.gemini\config\plugins\cache-pulse"
```

**macOS / Linux：**

```bash
git clone https://github.com/mqy2333/cache-pulse-Antigravity.git ~/.gemini/config/plugins/cache-pulse
```

安装完成后，在 Antigravity Desktop 中重新加载插件（或重启客户端）即可生效。

> 环境要求：系统 `PATH` 中需安装 **Node.js 20+**。

---

## 使用方式

安装后可直接在对话中触发内置提示词或调用监控面板：

- *“打开当前会话的 Cache Pulse 监控面板”*
- *“查看近 24 小时各模型 Token 用量与缓存命中率”*
- *“统计近 7 天所有任务均速与总消耗”*

面板内可随时切换：
- **单会话** / **周期统计（近 5 小时 / 近 24 小时 / 近 7 天）**
- **合并档位** / **细分档位** 与顶部模型筛选胶囊
- **详情** / **精简** 视图模式
- **`EN` / `中`** 界面语言一键切换

---

## 统计口径说明

- **缓存命中率**：`cache_read_tokens / (cache_read_tokens + uncached_input_tokens)`。
- **任务均速（`tok/s`）**：已计时轮次的加权输出速率（优先采用 Hook `PostInvocation - PreInvocation` 毫秒差，无 Hook 记录的历史轮次回退日志相邻步骤时间差估算）。
- **多周期统计范围**：只要会话在对应时间窗口内活跃过，即把该会话累计数据计入对应周期汇总；时间轴按轮次发生时间切片，窗口前历史轮次归入“更早延续”桶。

---

## 本地开发与测试

```bash
npm install
npm run typecheck
npm run build
npm test
```

构建并热更新部署到本机 `~/.gemini/config/plugins/cache-pulse`：

```bash
npm run deploy
```

---

## 开源协议

基于 [MIT](LICENSE) 协议开源 © 2026 [mqy2333](https://github.com/mqy2333)
