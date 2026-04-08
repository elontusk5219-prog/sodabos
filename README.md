<h1 align="center">
  🧠 SodaBOS
</h1>

<p align="center">
  <strong>The AI-Native Business Operating System</strong>
</p>

<p align="center">
  Your team uses the GUI. Your AI agents plug in via MCP.<br/>
  Same data. Same memory. Same roundtable. <strong>Equal participants.</strong>
</p>

<p align="center">
  <a href="#the-idea">The Idea</a> ·
  <a href="#see-it-in-action">See It</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#make-it-yours">Make It Yours</a> ·
  <a href="#acknowledgments">Thanks</a>
</p>

<p align="center">
  <a href="./SODABOS.zh-CN.md"><strong>中文文档</strong></a>
</p>

---

## The Idea

Every AI tool today works the same way: human asks, AI answers, context is lost.

**SodaBOS flips this.** It's a shared cognitive substrate — a persistent brain for your entire team — where:

- **Humans** work through a full web GUI (dashboards, project boards, roundtable discussions, approval flows)
- **AI agents** (Claude Code, Cursor, custom bots, *anything MCP-compatible*) plug in through 25+ MCP tools and operate on the exact same business data
- **The cognitive engine** runs autonomously in the background — perceiving, deciding, reflecting, and *dreaming*

Nobody is "calling" anybody. Everyone — human and machine — is a participant in a living, learning system.

```
┌──────────────────────────────────────────────────┐
│                   SodaBOS                         │
│     Projects · Memory · Methodology · Knowledge   │
│     Roundtable · Decisions · Lessons · Rules      │
│                                                   │
├──────────────┬───────────────────────────────────┤
│  🖥️ GUI       │  🔌 MCP (25+ tools)               │
│              │                                    │
│  Humans:     │  AI Agents:                        │
│  Dashboard   │  Claude Code — build features      │
│  Approve     │  Cursor — code with context        │
│  Discuss     │  Custom bot — automate pipelines   │
│  Answer Qs   │  Any MCP client — full access      │
└──────────────┴───────────────────────────────────┘
```

---

## Why This Exists

We built an AI product management platform called [imsoda](https://github.com/elontusk5219-prog/pm-agent). Halfway through, we realized something:

> The interesting part wasn't the product management features. It was the **cognitive infrastructure underneath** — the memory that persisted, the loop that learned from our decisions, the dreaming system that compressed weeks of experience into reusable methodology, the roundtable where our PM, Claude Code, and the autonomous agent all sat as equals.

So we extracted it.

SodaBOS is that extraction. **The part that makes AI actually useful in a team, not just impressive in a demo.**

---

## See It in Action

### The Dreaming System

Our production instance ran its first dream cycle. Here's what happened:

```
🌙 Dream Cycle #1 — Real production data

Phase 1: Memory Compression
  65 memories → 29 memories (55% reduction)
  19 decisions compressed to 9
  35 insights compressed to 14

Phase 2: Methodology Extraction
  +3 new methodologies derived
  +1 existing methodology updated
  Total: 11 reusable principles

Phase 3: Contradiction Detection
  Found: Business model pricing (¥10-20K/year) contradicts
         target market (micro-businesses with near-zero budgets)
  Found: "Avoid LLM extension line" methodology conflicts with
         current Multi-Agent architecture direction
  Found: "High reuse rate" metric applied to inherently
         low-frequency job-seeking behavior

Phase 4: Proactive Questioning
  Generated 3 high-priority questions
  → Created dedicated "💭 Dream Notes" roundtable room
  → Posted questions for team review
  → Created checkpoints in PM Agent approval panel
```

**The AI found a fundamental contradiction in our business strategy that we hadn't noticed.** It didn't wait to be asked. It dreamed, found the conflict, created a discussion room, and asked us about it.

### The Roundtable

Same room. Human PM types a message. Claude Code posts an analysis it generated. PM Agent (autonomous) responds with methodology-backed insights. A custom scraper bot drops in fresh data. Everyone sees everything.

### The Learning Loop

```
Agent proposes something → Human approves/rejects → Memory stores the signal
                                                          ↓
Next cycle: Agent's decisions are shaped by accumulated team judgment
                                                          ↓
Dreaming: Raw decisions get compressed into methodology
                                                          ↓
Methodology gets injected into future cognitive cycles
                                                          ↓
The whole system gets smarter. Not in theory. In production.
```

---

## Architecture

### Cognitive Loop — 9 Phases

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. Perception        Detect new signals, feedback, trends  │
│        ↓                                                    │
│  2. State Modeling    Build world state snapshot             │
│        ↓                                                    │
│  3. Simulation        Score & rank with role-based agents   │
│        ↓               (Signal Hunter, Strategist, Judge)   │
│  4. Classification    Categorize by insight layer           │
│        ↓                                                    │
│  5. Quality Gate      Filter low-confidence items           │
│        ↓                                                    │
│  6. Decision          Recommend actions (investigate/skip)  │
│        ↓                                                    │
│  7. Self-Review       Agent audits its own reasoning        │
│        ↓                                                    │
│  8. Execution         Create checkpoints for human review   │
│        ↓                                                    │
│  9. Reflection        Extract lessons → prevention rules    │
│        ↓                                                    │
│  [idle] → Dreaming    Compress → Methodology → Questions    │
│                                                             │
│  ← Prevention rules & methodology injected back into 3/6 → │
└─────────────────────────────────────────────────────────────┘
```

When there are no new signals, the loop doesn't just idle — it **dreams**:
- Compresses memories to reduce noise
- Extracts reusable methodology from raw decisions
- Detects contradictions in the team's knowledge
- Generates questions and posts them to the roundtable

### Memory System

```
AgentMemory (single source of truth)
├── memories[]        — Insights, contexts, preferences
├── decisions[]       — Every approve/reject with reasoning
├── learned_lessons[] — Extracted from team Q&A
├── feedbacks{}       — Per-user preference tracking
└── user_preferences{}— Liked/disliked topics per person

Dreaming writes to:
├── methodologies.json  — Reusable principles (11 in production)
├── pending_questions.json — Questions awaiting team answers
└── dream_log.json — History of all dream cycles
```

All subsystems (tools, dreaming, cognitive loop) access memory through a **unified interface** — no race conditions, no stale reads.

### MCP Tools (25+)

| Category | Tools | What agents can do |
|---|---|---|
| **Data** | `list_demands`, `demand_detail`, `dashboard` | Query business data |
| **Projects** | `list_projects`, `project_detail`, `create_project` | Manage the pipeline |
| **Talk** | `roundtable_*`, `discuss`, `create_discussion` | Join team conversations |
| **Knowledge** | `search_knowledge`, `search_lessons` | Read institutional memory |
| **Create** | `generate_document`, `list_documents` | Produce deliverables |
| **Think** | `agent_status`, `agent_methodologies` | See the cognitive engine |
| **Learn** | `submit_lesson`, `vote_stage_gate` | Feed the learning loop |

---

## Quick Start

```bash
git clone https://github.com/elontusk5219-prog/sodabos.git
cd sodabos

# Backend
cd backend && pip install -r requirements.txt
cp .env.example .env   # Add your LLM API key (OpenAI-compatible)
python -m uvicorn main:app --port 8000

# Frontend
cd ../frontend && npm install && npm run build && npm start

# MCP Server — this is what your AI agents connect to
python ../backend/mcp_sse_server.py
```

### Connect Claude Code

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

Now Claude Code can see your business. Ask it anything.

### Connect Any Agent

```python
# Any MCP client, or just use the REST API directly:
import requests

BASE = "http://localhost:8000/api"
token = requests.post(f"{BASE}/auth/login",
    json={"username": "admin", "password": "admin"}).json()["access_token"]

headers = {"Authorization": f"Bearer {token}"}

# Query your data
demands = requests.get(f"{BASE}/demands", headers=headers).json()

# Post to a roundtable
requests.post(f"{BASE}/roundtable/rooms/1/messages", headers=headers,
    json={"content": "My bot found something interesting...",
          "sender_type": "agent", "sender_name": "DataBot"})
```

---

## Make It Yours

**SodaBOS is a framework, not a finished product.** It's designed to be deeply reshaped around your business.

### What you swap out

| Layer | Default (imsoda) | Your version |
|---|---|---|
| **Core entity** | "Demand" (user pain point) | Ticket, Lead, Candidate, Deal, Article |
| **Cognitive roles** | Product Strategist, Investor Judge | Sales Analyst, Recruiter, Triage Agent |
| **Scoring** | 7 dimensions (pain, competition, etc.) | Revenue potential, SLA risk, close probability |
| **Pipeline stages** | Discover → Validate → PMF → BizModel | Prospect → Qualify → Propose → Close |
| **Data sources** | Reddit, HN, Twitter scrapers | CRM webhook, Zendesk, internal APIs |
| **MCP tools** | `query_demands`, `create_project` | `approve_deal`, `escalate_ticket` |
| **GUI pages** | Demand pool, competitive analysis | Sales funnel, hiring board, support queue |

### Industry examples

**Sales** — Leads as entities, CRM as data source, "Deal Strategist" as AI role, pipeline stages for cognitive phases. Agent learns which deals your team closes, and starts pre-filtering.

**Hiring** — Candidates as entities, LinkedIn scraper, "Recruiter Agent" role. Agent learns what "good fit" means from your accept/reject patterns, and dreams about contradictions in your hiring criteria.

**Support** — Tickets as entities, Zendesk integration, "Triage Agent" role, SLA-based quality gates. Agent routes tickets based on accumulated team methodology.

**Content** — Articles as entities, social listening scrapers, "Editor Agent" role. Agent learns your editorial voice from approvals, suggests topics from trend analysis, and asks when it detects conflicting editorial directions.

### Want us to build it for you?

We do **deep customization** — not just setup, but full domain analysis, cognitive loop design, prompt engineering, and ongoing tuning:

📧 **hello@ninetyculture.com** · GitHub [@ninetyculture](https://github.com/ninetyculture) · WeChat `NinetyCulture`

---

## What's Open Source vs. What's Not

### Open (this repo)

| Module | What it does |
|---|---|
| **Cognitive Loop** | 9-phase autonomous decision cycle with role injection |
| **Memory** | Unified persistence (Cognee + JSON) with learning signals |
| **Dreaming** | Memory compression, methodology extraction, contradiction detection |
| **Role System** | 7 configurable AI roles with dynamic prompt injection |
| **Agent Bus** | Multi-agent coordination and message passing |
| **MCP Server** | 25+ tools exposing business context to any agent |
| **Roundtable** | Multi-party discussion rooms (human + AI + bots) |
| **Checkpoints** | Human approval gateway with feedback loop |
| **Lessons** | Experience extraction and prevention rules |
| **RAG Engine** | FTS5-based retrieval for knowledge and docs |
| **Auth** | JWT + bcrypt user management |
| **AI Client** | OpenAI-compatible wrapper (Claude, GPT, DeepSeek, etc.) |

### Closed (proprietary reference implementation)

- 20+ platform scraper adapters (Reddit, Twitter, HN, etc.)
- Domain-specific scoring algorithms
- Full product UI suite
- Business analysis prompt library

---

## Tech Stack

| | |
|---|---|
| Backend | Python 3.11 · FastAPI · aiosqlite |
| Frontend | Next.js 14 · React 18 · Tailwind CSS |
| AI | Any OpenAI-compatible API |
| Memory | Cognee (optional) + local JSON |
| Search | FTS5 full-text search |
| Agent Bridge | FastMCP SSE server |
| Auth | JWT · bcrypt |

---

## Acknowledgments

### Anthropic & Claude

SodaBOS was **built with Claude Code and designed for Claude Code**. The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) by Anthropic is the backbone of our agent integration architecture — it's what makes "plug any AI agent into your business" possible without custom glue code. Claude's ability to reason about complex systems while using tools is what makes SodaBOS more than infrastructure.

### Spice AI

[Spice AI](https://github.com/spiceai/spiceai) inspired our approach to **AI-native data infrastructure** — the idea that intelligence should be a first-class citizen in your data stack, not a bolt-on. This shaped how SodaBOS treats memory, learning signals, and the cognitive loop as core infrastructure rather than application features.

### Cognee

[Cognee](https://github.com/topoteretes/cognee) showed us that **structured knowledge graphs beat raw vector stores** for agent memory. Our `AgentMemory` module wraps Cognee for semantic search, with a local JSON fallback for zero-dependency deployments. The "cognitive memory" concept — memory that isn't just stored but understood — comes directly from Cognee's vision.

### The Open Source Community

- **LangChain** — Chain-of-thought patterns that informed our cognitive loop
- **CrewAI** — Role-based agent collaboration that shaped our multi-role system
- **AutoGen** — Multi-agent conversation patterns
- **FastMCP** — Making MCP server implementation accessible

### Our Team at Ninety Culture

SodaBOS was born inside **imsoda**, a production AI product management platform. Every feature was battle-tested on real workflows before being extracted into the framework. The dreaming system exists because our PM once asked: *"Can the AI organize what it learned when it's idle, like humans do when they sleep?"* We built it. It found contradictions in our strategy that we'd missed for weeks.

This isn't a research project. It's extracted production infrastructure.

---

## Roadmap

- [ ] Plugin system for custom cognitive phases
- [ ] Multi-tenant isolation
- [ ] Webhook triggers for external events
- [ ] Dream cycle visualization dashboard
- [ ] Real-time voice collaboration mode
- [ ] Browser extension for signal capture
- [ ] One-click deployment templates (Docker, Railway, Fly.io)

---

## License

**MIT** — Use it, fork it, reshape it, ship it.

---

<p align="center">
  <strong>SodaBOS</strong><br/>
  Your team's AI brain. Thinks. Learns. Dreams. Asks.<br/><br/>
  <a href="https://github.com/elontusk5219-prog/sodabos">⭐ Star us on GitHub</a> ·
  <a href="./SODABOS.zh-CN.md">中文文档</a> ·
  <a href="mailto:hello@ninetyculture.com">Contact</a>
</p>
