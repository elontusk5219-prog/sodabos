"use client";
import { useState } from "react";

const MCP_SSE_URL_INTERNAL = "http://10.1.0.111:8851/sse";
const MCP_SSE_URL_EXTERNAL = "https://mandy-nonluminous-unsilently.ngrok-free.dev/sse";
const API_BASE_EXTERNAL = "http://10.1.0.111:8899";

export default function MCPGuidePage() {
  const [copied, setCopied] = useState("");

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  const CopyBtn = ({ text, label }: { text: string; label: string }) => (
    <button
      onClick={() => copy(text, label)}
      className="ml-2 px-2 py-0.5 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
    >
      {copied === label ? "Copied!" : "Copy"}
    </button>
  );

  const CodeBlock = ({
    code,
    label,
    lang = "json",
  }: {
    code: string;
    label: string;
    lang?: string;
  }) => (
    <div className="relative group">
      <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={() => copy(code, label)}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-600"
      >
        {copied === label ? "Copied!" : "Copy"}
      </button>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        MCP Server 接入指南
      </h1>
      <p className="text-gray-500 mb-8">
        将 PM Agent 的能力接入 Claude Code、Claude Desktop 或 Claude Cowork，让 AI 助手直接操作项目系统。
      </p>

      {/* Available Tools */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center text-sm">
            T
          </span>
          提供的工具（25 个）
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { name: "login", desc: "登录系统（必须先调用）" },
            { name: "dashboard", desc: "查看仪表盘概览" },
            { name: "list_demands", desc: "浏览需求池" },
            { name: "demand_detail", desc: "查看需求详情和评分" },
            { name: "list_projects", desc: "查看所有项目" },
            { name: "project_kanban", desc: "看板视图（5阶段分组）" },
            { name: "create_project", desc: "创建新项目" },
            { name: "project_detail", desc: "查看项目详情" },
            { name: "project_progress", desc: "查看交付物完成情况" },
            { name: "list_documents", desc: "查看项目文档" },
            { name: "read_document", desc: "读取文档内容" },
            { name: "generate_document", desc: "AI 生成文档" },
            { name: "update_document", desc: "编辑文档或更新状态" },
            { name: "list_discussions", desc: "查看讨论列表" },
            { name: "read_discussion", desc: "读取讨论消息" },
            { name: "discuss", desc: "发消息并获取 AI 回复" },
            { name: "create_discussion", desc: "创建讨论线程" },
            { name: "open_stage_gate", desc: "发起阶段评审" },
            { name: "vote_stage_gate", desc: "投票通过/拒绝" },
            { name: "search_knowledge", desc: "搜索知识库" },
            { name: "agent_status", desc: "查看 Agent 状态" },
            { name: "fetch_all_sources", desc: "一键采集数据" },
            { name: "run_ai_analysis", desc: "运行 AI 分析" },
            { name: "recent_activity", desc: "查看最近活动" },
          ].map((tool) => (
            <div
              key={tool.name}
              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
            >
              <code className="text-xs bg-white px-2 py-1 rounded border border-gray-200 text-blue-600 font-mono whitespace-nowrap">
                {tool.name}
              </code>
              <span className="text-sm text-gray-600">{tool.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Connection Methods */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center text-sm">
            1
          </span>
          Claude Code（内网）
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          适用于与服务器在同一内网（10.x.x.x）的设备。编辑{" "}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
            ~/.claude/settings.json
          </code>
        </p>
        <CodeBlock
          label="claude-code-internal"
          code={`{
  "mcpServers": {
    "pm-agent": {
      "url": "${MCP_SSE_URL_INTERNAL}"
    }
  }
}`}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-green-100 text-green-600 rounded-lg flex items-center justify-center text-sm">
            2
          </span>
          Claude Code / Desktop（外网）
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          适用于不在内网的设备，通过 ngrok 隧道连接。
        </p>
        <CodeBlock
          label="claude-code-external"
          code={`{
  "mcpServers": {
    "pm-agent": {
      "url": "${MCP_SSE_URL_EXTERNAL}"
    }
  }
}`}
        />
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center text-sm">
            3
          </span>
          Claude Cowork (claude.ai)
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          在 claude.ai 的 Project 设置中添加 MCP 集成。
        </p>
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
              1
            </span>
            <span className="text-sm text-gray-700">
              打开 claude.ai → 进入一个 Project
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
              2
            </span>
            <span className="text-sm text-gray-700">
              点击 Project Settings → Integrations → Add MCP Server
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
              3
            </span>
            <div className="text-sm text-gray-700">
              填入 URL：
              <div className="mt-2 flex items-center gap-2">
                <code className="bg-gray-900 text-green-400 px-3 py-1.5 rounded text-xs font-mono">
                  {MCP_SSE_URL_EXTERNAL}
                </code>
                <CopyBtn text={MCP_SSE_URL_EXTERNAL} label="cowork-url" />
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 shrink-0">
              4
            </span>
            <span className="text-sm text-gray-700">
              保存后即可在对话中使用 PM Agent 工具
            </span>
          </div>
        </div>
      </section>

      {/* Usage */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-yellow-100 text-yellow-600 rounded-lg flex items-center justify-center text-sm">
            !
          </span>
          使用方法
        </h2>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-4">
          <p className="text-sm text-amber-800 font-medium mb-2">
            首次使用必须先登录
          </p>
          <p className="text-sm text-amber-700">
            连接 MCP 后，在对话中说：<br />
            <code className="bg-white px-2 py-0.5 rounded text-xs">
              &quot;登录 PM Agent，用户名 xxx 密码 xxx&quot;
            </code>
          </p>
        </div>

        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          示例对话
        </h3>
        <div className="space-y-3">
          {[
            {
              q: "看看需求池里评分最高的需求",
              a: "Claude 调用 list_demands(sort='score_desc', limit=5)",
            },
            {
              q: "把这个需求开启为项目",
              a: "Claude 调用 create_project(demand_id=42)",
            },
            {
              q: "帮这个项目生成 One Pager",
              a: "Claude 调用 generate_document(project_id=1, doc_type='one_pager')",
            },
            {
              q: "看看项目进展到哪一步了",
              a: "Claude 调用 project_progress(project_id=1)",
            },
            {
              q: "在项目讨论区聊聊这个方向的可行性",
              a: "Claude 调用 create_discussion + discuss",
            },
            {
              q: "发起阶段评审投票",
              a: "Claude 调用 open_stage_gate(project_id=1)",
            },
          ].map((item, i) => (
            <div
              key={i}
              className="flex gap-4 p-3 bg-gray-50 rounded-lg text-sm"
            >
              <div className="flex-1">
                <span className="text-gray-400 text-xs">You:</span>
                <p className="text-gray-800">{item.q}</p>
              </div>
              <div className="flex-1">
                <span className="text-gray-400 text-xs">Claude:</span>
                <p className="text-gray-500 font-mono text-xs">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* API Info */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-7 h-7 bg-gray-100 text-gray-600 rounded-lg flex items-center justify-center text-sm">
            i
          </span>
          技术信息
        </h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {[
            { label: "MCP 协议", value: "SSE (Server-Sent Events)" },
            {
              label: "内网 SSE 地址",
              value: MCP_SSE_URL_INTERNAL,
              mono: true,
            },
            {
              label: "外网 SSE 地址",
              value: MCP_SSE_URL_EXTERNAL,
              mono: true,
            },
            { label: "REST API", value: API_BASE_EXTERNAL, mono: true },
            { label: "工具数量", value: "25 个" },
            {
              label: "认证方式",
              value: "通过 login 工具获取 JWT Token，自动管理",
            },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-4 px-5 py-3"
            >
              <span className="text-sm text-gray-500 w-32 shrink-0">
                {row.label}
              </span>
              <span
                className={`text-sm ${row.mono ? "font-mono text-gray-700" : "text-gray-700"}`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Notes */}
      <section>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 text-sm text-gray-600 space-y-2">
          <p>
            <strong>Note:</strong> ngrok 免费版 URL
            在服务重启后会变更。如果 URL 失效，请联系管理员获取最新地址。
          </p>
          <p>
            如需固定域名，可升级 ngrok 付费版（$8/月）或改用 Cloudflare
            Tunnel。
          </p>
        </div>
      </section>
    </div>
  );
}
