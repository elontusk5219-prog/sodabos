<h1 align="center">
  🧠 SodaBOS
</h1>

<p align="center">
  <strong>AI 原生业务操作系统</strong>
</p>

<p align="center">
  你的团队用 GUI。你的 AI Agent 通过 MCP 接入。<br/>
  同一份数据。同一套记忆。同一张圆桌。<strong>平等的参与者。</strong>
</p>

<p align="center">
  <a href="#核心理念">核心理念</a> ·
  <a href="#实战效果">实战效果</a> ·
  <a href="#架构">架构</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#按你的业务改造">改造指南</a> ·
  <a href="#致谢">致谢</a>
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a>
</p>

---

## 核心理念

今天所有的 AI 工具都是同一个模式：人问，AI 答，上下文丢失。

**SodaBOS 把这件事反过来。** 它是一个共享的认知基底 — 你整个团队的持久大脑：

- **人** 通过完整的 Web GUI 工作（仪表盘、项目看板、圆桌讨论、审批流程）
- **AI Agent**（Claude Code、Cursor、自建机器人、*任何 MCP 兼容客户端*）通过 25+ MCP 工具接入，操作完全相同的业务数据
- **认知引擎** 在后台自主运行 — 感知、决策、反思、*做梦*

没有谁在"调用"谁。每个参与者 — 人和机器 — 都是一个活的、学习中的系统里的平等成员。

```
┌──────────────────────────────────────────────────┐
│                   SodaBOS                         │
│     项目 · 记忆 · 方法论 · 知识库                   │
│     圆桌 · 决策 · 经验教训 · 规则                   │
│                                                   │
├──────────────┬───────────────────────────────────┤
│  🖥️ GUI       │  🔌 MCP（25+ 工具）                │
│              │                                    │
│  人类：       │  AI Agent：                        │
│  看仪表盘    │  Claude Code — 带上下文建功能        │
│  审批决策    │  Cursor — 带项目知识写代码           │
│  参与讨论    │  自建 Bot — 自动化数据管线           │
│  回答问题    │  任何 MCP 客户端 — 完整访问          │
└──────────────┴───────────────────────────────────┘
```

---

## 为什么做这个

我们做了一个 AI 产品管理平台叫 [imsoda](https://github.com/elontusk5219-prog/pm-agent)。做到一半，我们意识到一件事：

> 真正有趣的不是产品管理功能本身。而是**底下那套认知基础设施** — 会持久保存的记忆、从决策中学习的循环、把数周经验压缩成可复用方法论的做梦系统、PM 和 Claude Code 和自主 Agent 平等对话的圆桌。

于是我们把它抽出来了。

SodaBOS 就是那个抽象层。**让 AI 在团队中真正有用的部分，而不只是在 Demo 里让人惊叹。**

---

## 实战效果

### 做梦系统

我们的生产环境跑了第一轮做梦循环。以下是实际发生的事：

```
🌙 做梦循环 #1 — 真实生产数据

阶段 1：记忆压缩
  65 条记忆 → 29 条记忆（减少 55%）
  19 条决策压缩为 9 条
  35 条洞察压缩为 14 条

阶段 2：方法论提炼
  +3 条新方法论
  +1 条方法论更新
  共计：11 条可复用原则

阶段 3：矛盾检测
  发现：商业模式定价（¥10-20K/年）与
        目标用户（预算接近零的微型企业）矛盾
  发现："避免 LLM 延伸线"方法论与
        当前多 Agent 架构方向冲突
  发现："高复用率"指标不适用于
        天然低频的求职行为

阶段 4：主动提问
  生成 3 个高优先级问题
  → 创建专属"💭 做梦笔记"圆桌讨论室
  → 向团队发布问题等待回答
  → 在 PM Agent 审批面板创建检查点
```

**AI 发现了我们商业策略中一个根本性的矛盾，而我们自己没注意到。** 它没有等着被问。它做梦、发现冲突、创建讨论室、然后问我们。

### 圆桌协作

同一个讨论室。人类 PM 打字发消息。Claude Code 发布它生成的分析。PM Agent（自主运行）用方法论支撑的洞察回应。自建爬虫机器人灌入最新数据。所有人看到所有内容。

### 学习循环

```
Agent 提出方案 → 人类审批/拒绝 → 记忆存储信号
                                        ↓
下一轮：Agent 的决策受累积的团队判断塑造
                                        ↓
做梦：原始决策被压缩成方法论
                                        ↓
方法论注入未来的认知循环
                                        ↓
整个系统变得更聪明。不是理论上。在生产环境中。
```

---

## 架构

### 认知循环 — 9 个阶段

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. 感知            检测新信号、反馈、趋势                    │
│        ↓                                                    │
│  2. 状态建模        构建世界状态快照                          │
│        ↓                                                    │
│  3. 模拟推演        角色化 Agent 打分排序                     │
│        ↓            （信号猎手、策略师、评委）                 │
│  4. 知识分类        按洞察层级分类                            │
│        ↓                                                    │
│  5. 质量门禁        过滤低置信度项目                          │
│        ↓                                                    │
│  6. 决策            推荐行动（深入/跳过）                     │
│        ↓                                                    │
│  7. 自审            Agent 审计自己的推理                      │
│        ↓                                                    │
│  8. 执行            创建检查点等待人类审批                     │
│        ↓                                                    │
│  9. 反思            提炼经验 → 预防规则                       │
│        ↓                                                    │
│  [空闲] → 做梦      压缩 → 方法论 → 提问                     │
│                                                             │
│  ← 预防规则和方法论注入回第 3/6 阶段 →                        │
└─────────────────────────────────────────────────────────────┘
```

当没有新信号时，循环不会闲着 — 它**做梦**：
- 压缩记忆以减少噪音
- 从原始决策中提炼可复用方法论
- 检测团队知识中的矛盾
- 生成问题并发布到圆桌讨论

### 记忆系统

```
AgentMemory（唯一数据源）
├── memories[]        — 洞察、上下文、偏好
├── decisions[]       — 每次审批/拒绝及其推理
├── learned_lessons[] — 从团队问答中提取
├── feedbacks{}       — 按用户的偏好追踪
└── user_preferences{}— 每个人喜欢/不喜欢的话题

做梦写入：
├── methodologies.json  — 可复用原则（生产环境 11 条）
├── pending_questions.json — 等待团队回答的问题
└── dream_log.json — 所有做梦循环历史
```

所有子系统（工具、做梦、认知循环）通过**统一接口**访问记忆 — 无竞态条件，无过期读取。

### MCP 工具（25+）

| 类别 | 工具 | Agent 能做什么 |
|---|---|---|
| **数据** | `list_demands`, `demand_detail`, `dashboard` | 查询业务数据 |
| **项目** | `list_projects`, `project_detail`, `create_project` | 管理项目管线 |
| **讨论** | `roundtable_*`, `discuss`, `create_discussion` | 加入团队对话 |
| **知识** | `search_knowledge`, `search_lessons` | 读取组织记忆 |
| **创作** | `generate_document`, `list_documents` | 生成交付物 |
| **思考** | `agent_status`, `agent_methodologies` | 查看认知引擎 |
| **学习** | `submit_lesson`, `vote_stage_gate` | 喂养学习循环 |

---

## 快速开始

```bash
git clone https://github.com/elontusk5219-prog/sodabos.git
cd sodabos

# 后端
cd backend && pip install -r requirements.txt
cp .env.example .env   # 填入你的 LLM API Key（OpenAI 兼容）
python -m uvicorn main:app --port 8000

# 前端
cd ../frontend && npm install && npm run build && npm start

# MCP 服务器 — 你的 AI Agent 连接这里
python ../backend/mcp_sse_server.py
```

### 接入 Claude Code

```json
{
  "mcpServers": {
    "sodabos": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:9000/sse"]
    }
  }
}
```

现在 Claude Code 能看到你的业务了。问它任何问题。

### 接入任何 Agent

```python
# 任何 MCP 客户端，或者直接用 REST API：
import requests

BASE = "http://localhost:8000/api"
token = requests.post(f"{BASE}/auth/login",
    json={"username": "admin", "password": "admin"}).json()["access_token"]

headers = {"Authorization": f"Bearer {token}"}

# 查询数据
demands = requests.get(f"{BASE}/demands", headers=headers).json()

# 发到圆桌
requests.post(f"{BASE}/roundtable/rooms/1/messages", headers=headers,
    json={"content": "我的机器人发现了一些有趣的东西...",
          "sender_type": "agent", "sender_name": "DataBot"})
```

---

## 按你的业务改造

**SodaBOS 是一个框架，不是成品。** 它被设计为可以根据你的业务进行深度改造。

### 你可以替换什么

| 层面 | 默认（imsoda） | 你的版本 |
|---|---|---|
| **核心实体** | "需求"（用户痛点） | 工单、线索、候选人、订单、文章 |
| **认知角色** | 产品策略师、投资人评委 | 销售分析师、招聘官、分诊 Agent |
| **评分维度** | 7 个维度（痛点、竞争等） | 营收潜力、SLA 风险、成交概率 |
| **管线阶段** | 发现 → 验证 → PMF → 商业模式 | 线索 → 资格 → 方案 → 成交 |
| **数据源** | Reddit、HN、Twitter 爬虫 | CRM Webhook、Zendesk、内部 API |
| **MCP 工具** | `query_demands`, `create_project` | `approve_deal`, `escalate_ticket` |
| **GUI 页面** | 需求池、竞品分析 | 销售漏斗、招聘看板、客服队列 |

### 行业示例

**销售** — 线索为实体，CRM 为数据源，"销售策略师"为 AI 角色，管线阶段对应认知循环。Agent 学习你团队成交哪些单子，开始自动预筛选。

**招聘** — 候选人为实体，LinkedIn 爬虫，"招聘 Agent"角色。Agent 从你的录用/拒绝模式中学习"好候选人"的含义，做梦时检测招聘标准中的矛盾。

**客服** — 工单为实体，Zendesk 集成，"分诊 Agent"角色，SLA 驱动的质量门禁。Agent 基于累积的团队方法论路由工单。

**内容** — 文章为实体，社交监听爬虫，"编辑 Agent"角色。Agent 从审批中学习你的编辑风格，从趋势分析中建议选题，在发现编辑方向冲突时主动提问。

### 需要我们帮你做？

我们提供**深度定制** — 不只是搭建，而是完整的领域分析、认知循环设计、Prompt 工程和持续调优：

📧 **hello@ninetyculture.com** · GitHub [@ninetyculture](https://github.com/ninetyculture) · 微信 `NinetyCulture`

---

## 开源与闭源

### 开源（本仓库）

| 模块 | 功能 |
|---|---|
| **认知循环** | 9 阶段自主决策循环 + 角色注入 |
| **记忆系统** | 统一持久化（Cognee + JSON）+ 学习信号 |
| **做梦系统** | 记忆压缩、方法论提炼、矛盾检测 |
| **角色系统** | 7 个可配置 AI 角色 + 动态 Prompt 注入 |
| **Agent 总线** | 多 Agent 协调和消息传递 |
| **MCP 服务器** | 25+ 工具，暴露业务上下文给任何 Agent |
| **圆桌讨论** | 多方讨论室（人 + AI + 机器人） |
| **检查点** | 人类审批网关 + 反馈循环 |
| **经验教训** | 经验提取和预防规则 |
| **RAG 引擎** | FTS5 全文检索 |
| **认证** | JWT + bcrypt 用户管理 |
| **AI 客户端** | OpenAI 兼容封装（Claude、GPT、DeepSeek 等） |

### 闭源（产品参考实现）

- 20+ 平台爬虫适配器（Reddit、Twitter、HN 等）
- 领域特定评分算法
- 完整产品 UI 套件
- 业务分析 Prompt 库

---

## 技术栈

| | |
|---|---|
| 后端 | Python 3.11 · FastAPI · aiosqlite |
| 前端 | Next.js 14 · React 18 · Tailwind CSS |
| AI | 任何 OpenAI 兼容 API |
| 记忆 | Cognee（可选）+ 本地 JSON |
| 搜索 | FTS5 全文检索 |
| Agent 桥接 | FastMCP SSE 服务器 |
| 认证 | JWT · bcrypt |

---

## 致谢

### Anthropic & Claude

SodaBOS **用 Claude Code 构建，为 Claude Code 设计**。Anthropic 的 [MCP（模型上下文协议）](https://modelcontextprotocol.io/) 是我们 Agent 集成架构的骨架 — 正是它让"把任何 AI Agent 插入你的业务"成为可能，无需定制胶水代码。Claude 在使用工具的同时推理复杂系统的能力，让 SodaBOS 远不止是基础设施。

### Spice AI

[Spice AI](https://github.com/spiceai/spiceai) 启发了我们构建 **AI 原生数据基础设施**的思路 — 智能应该是数据栈中的一等公民，而非事后附加。这塑造了 SodaBOS 把记忆、学习信号和认知循环视为核心基础设施（而非应用功能）的方式。

### Cognee

[Cognee](https://github.com/topoteretes/cognee) 让我们看到**结构化知识图谱比原始向量存储更适合 Agent 记忆**。我们的 `AgentMemory` 模块封装了 Cognee 做语义搜索，并提供本地 JSON 回退实现零依赖部署。"认知记忆"的概念 — 记忆不只是被存储，而是被理解 — 直接来自 Cognee 的愿景。

### 开源社区

- **LangChain** — 思维链模式启发了我们的认知循环
- **CrewAI** — 角色化 Agent 协作塑造了我们的多角色系统
- **AutoGen** — 多 Agent 对话模式
- **FastMCP** — 让 MCP 服务器实现变得触手可及

### Ninety Culture 团队

SodaBOS 诞生于 **imsoda**，一个在生产环境运行的 AI 产品管理平台。每个功能都是在真实工作流中经过实战验证后才被抽取进框架的。做梦系统的存在，是因为我们的 PM 有一天问：*"AI 能不能在空闲的时候整理它学到的东西，就像人类睡觉时做的那样？"* 我们做出来了。它发现了我们忽略了几周的策略矛盾。

这不是研究项目。这是从生产环境提取的基础设施。

---

## 路线图

- [ ] 自定义认知阶段插件系统
- [ ] 多租户隔离
- [ ] Webhook 外部事件触发
- [ ] 做梦循环可视化面板
- [ ] 实时语音协作模式
- [ ] 浏览器扩展（信号捕获）
- [ ] 一键部署模板（Docker、Railway、Fly.io）

---

## 开源协议

**MIT** — 用它、改它、基于它构建、上线它。

---

<p align="center">
  <strong>SodaBOS</strong><br/>
  你团队的 AI 大脑。会思考。会学习。会做梦。会提问。<br/><br/>
  <a href="https://github.com/elontusk5219-prog/sodabos">⭐ Star us on GitHub</a> ·
  <a href="./README.md">English</a> ·
  <a href="mailto:hello@ninetyculture.com">联系我们</a>
</p>
