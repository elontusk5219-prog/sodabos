"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/lib/api";
import {
  Play, FileText, Users, Zap, Target, RefreshCw,
  ChevronDown, ChevronUp, ExternalLink, MessageCircle,
  Star, TrendingUp, Copy, CheckCheck,
} from "lucide-react";

interface Persona {
  id: number;
  title: string;
  persona_json: Record<string, unknown>;
  created_at: string;
}

interface Project {
  id: number;
  title: string;
  description: string;
  current_stage: string;
}

interface Run {
  id: number;
  persona_id: number;
  status: string;
  posts_found: number;
  leads_qualified: number;
  replies_generated: number;
  errors: string;
  started_at: string;
  finished_at: string | null;
  step: string;
}

interface Lead {
  id: number;
  platform: string;
  content: string;
  author: string;
  url: string;
  overall_score: number;
  relevance_score: number;
  intent_score: number;
  authority_score: number;
  reason: string;
  status: string;
}

interface Reply {
  id: number;
  reply_text: string;
  language: string;
  strategy: string;
  status: string;
  platform: string;
  post_content: string;
  author: string;
  overall_score: number;
}

import {
  User, Target as TargetIcon, Search as SearchIcon, Star as StarIcon,
  MessageCircle as MsgIcon, BarChart3, RefreshCw as RefreshIcon, CheckCircle as CheckIcon, XCircle,
} from "lucide-react";

const PIPELINE_STEPS: { key: string; icon: React.ReactNode; label: string; sub: string }[] = [
  { key: "profile", icon: <User size={18} />, label: "用户画像", sub: "Profile Agent" },
  { key: "strategy", icon: <TargetIcon size={18} />, label: "获客策略", sub: "Strategy Agent" },
  { key: "scanning", icon: <SearchIcon size={18} />, label: "平台扫描", sub: "Scanner" },
  { key: "qualifying", icon: <StarIcon size={18} />, label: "质量评估", sub: "Qualifier" },
  { key: "engaging", icon: <MsgIcon size={18} />, label: "生成回复", sub: "Engager" },
  { key: "done", icon: <BarChart3 size={18} />, label: "线索报告", sub: "Reporter" },
];

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function AcquisitionInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"run" | "leads" | "replies">("run");
  const [inputText, setInputText] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [expandedLead, setExpandedLead] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load context from URL (from drag & drop)
  useEffect(() => {
    const ctx = searchParams.get("context");
    if (ctx) {
      try {
        const parsed = JSON.parse(decodeURIComponent(ctx));
        setInputText(
          `${parsed.title || ""}\n${parsed.data?.description || parsed.data?.why || ""}`
        );
      } catch {}
    }
  }, [searchParams]);

  // Load initial data
  useEffect(() => {
    api.projects({}).then((data: { projects?: Project[] } | Project[]) => {
      const list = Array.isArray(data) ? data : data.projects || [];
      setProjects(list);
    }).catch(() => {});

    api.acqPersonas().then((data: Persona[] | { personas: Persona[] }) => {
      const list = Array.isArray(data) ? data : data.personas || [];
      setPersonas(list);
    }).catch(() => {});

    api.acqStats().then((d) => setStats(d || {})).catch(() => {});
    api.acqRuns().then((data: Run[] | { runs: Run[] }) => {
      const runs = Array.isArray(data) ? data : (data?.runs || []);
      const running = runs.find(r => r.status === "running");
      if (running) {
        setActiveRun(running);
        startPolling(running.id);
      }
    }).catch(() => {});
  }, []);

  const startPolling = (runId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const run = await api.acqRunStatus(runId);
        setActiveRun(run);
        if (run.status === "done" || run.status === "error") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          // Refresh data
          api.acqLeads({ run_id: String(runId) }).then((d) => setLeads(Array.isArray(d) ? d : d?.leads || [])).catch(() => {});
          api.acqReplies({ run_id: String(runId) }).then((d) => setReplies(Array.isArray(d) ? d : d?.replies || [])).catch(() => {});
          api.acqStats().then((d) => setStats(d || {})).catch(() => {});
        }
      } catch {}
    }, 3000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleCreatePersona = async (source: "text" | "project") => {
    setLoading(true);
    setError("");
    try {
      let persona: Persona;
      if (source === "text") {
        persona = await api.acqPersonaFromText(inputText);
      } else {
        persona = await api.acqPersonaFromProject(selectedProject!.id);
      }
      setPersonas(prev => [persona, ...prev]);
      // Auto-start run
      const run = await api.acqRun(persona.id);
      setActiveRun(run);
      setTab("run");
      startPolling(run.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStartRun = async (personaId: number) => {
    setLoading(true);
    setError("");
    try {
      const run = await api.acqRun(personaId);
      setActiveRun(run);
      setTab("run");
      startPolling(run.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyReply = (id: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const currentStepIndex = activeRun
    ? PIPELINE_STEPS.findIndex(s => s.key === activeRun.step)
    : -1;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="w-6 h-6 text-emerald-600" />
            获客 Agent
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            基于产品描述自动发现并触达潜在用户
          </p>
        </div>
        {/* Stats */}
        <div className="flex gap-4 text-sm">
          <div className="text-center">
            <div className="text-lg font-bold text-gray-800">{stats.total_posts || 0}</div>
            <div className="text-gray-400 text-xs">扫描帖子</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-600">{stats.total_leads || 0}</div>
            <div className="text-gray-400 text-xs">合格线索</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{stats.total_replies || 0}</div>
            <div className="text-gray-400 text-xs">生成回复</div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-2 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* Pipeline visualization */}
      {activeRun && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm">
              <span className="flex items-center gap-1">
                {activeRun.status === "running" ? <><RefreshIcon size={14} className="animate-spin" /> Pipeline 运行中...</> :
                 activeRun.status === "done" ? <><CheckIcon size={14} /> Pipeline 完成</> : <><XCircle size={14} /> 出错</>}
              </span>
            </h3>
            <span className="text-xs text-gray-400">
              Run #{activeRun.id} · {activeRun.started_at ? new Date(activeRun.started_at.replace(" ", "T")).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : ""}
            </span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {PIPELINE_STEPS.map((step, i) => {
              const isDone = activeRun.status === "done" || i < currentStepIndex;
              const isCurrent = i === currentStepIndex && activeRun.status === "running";
              return (
                <div key={step.key} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <span className="text-gray-300 mx-1">→</span>}
                  <div className={`text-center px-3 py-2 rounded-lg transition-colors ${
                    isCurrent ? "bg-emerald-50 ring-2 ring-emerald-200" :
                    isDone ? "bg-green-50" : "bg-gray-50"
                  }`}>
                    <div className={`flex justify-center ${isCurrent ? "animate-bounce" : ""}`}>{step.icon}</div>
                    <div className="text-[10px] font-medium text-gray-600 mt-1">{step.label}</div>
                    <div className="text-[9px] text-gray-400">{step.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Metrics */}
          {(activeRun.posts_found > 0 || activeRun.leads_qualified > 0) && (
            <div className="flex gap-6 mt-4 pt-4 border-t border-gray-100 text-sm">
              <span>扫描: <strong>{activeRun.posts_found}</strong> 帖子</span>
              <span>合格: <strong className="text-emerald-600">{activeRun.leads_qualified}</strong> 线索</span>
              <span>回复: <strong className="text-blue-600">{activeRun.replies_generated}</strong> 条</span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: "run", label: "启动获客", icon: Zap },
          { key: "leads", label: `线索 (${leads.length})`, icon: Star },
          { key: "replies", label: `回复 (${replies.length})`, icon: MessageCircle },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key as typeof tab);
              if (t.key === "leads" && activeRun) api.acqLeads({ run_id: String(activeRun.id) }).then((d) => setLeads(Array.isArray(d) ? d : d?.leads || [])).catch(() => {});
              if (t.key === "replies" && activeRun) api.acqReplies({ run_id: String(activeRun.id) }).then((d) => setReplies(Array.isArray(d) ? d : d?.replies || [])).catch(() => {});
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-emerald-500 text-emerald-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Run */}
      {tab === "run" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option 1: Text input */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-sm">描述产品</h3>
            </div>
            <p className="text-xs text-gray-500">
              输入产品描述或 PRD，AI 自动生成用户画像并开始获客
            </p>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="描述你的产品、目标用户和核心价值..."
              className="w-full h-32 px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <button
              onClick={() => handleCreatePersona("text")}
              disabled={!inputText.trim() || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? "创建中..." : "生成画像 & 开始获客"}
            </button>
          </div>

          {/* Option 2: From project */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-500" />
              <h3 className="font-semibold text-sm">从项目启动</h3>
            </div>
            <p className="text-xs text-gray-500">
              选择已有项目，自动读取 PRD 和用户研究作为获客输入
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {projects.length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">暂无项目</p>
              ) : projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProject(selectedProject?.id === p.id ? null : p)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                    selectedProject?.id === p.id
                      ? "border-purple-300 bg-purple-50 text-purple-700"
                      : "border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-xs text-gray-400 truncate">{p.description}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => handleCreatePersona("project")}
              disabled={!selectedProject || loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              从项目获客
            </button>
          </div>

          {/* Existing personas */}
          {personas.length > 0 && (
            <div className="md:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-gray-400" />
                历史画像（点击重新运行）
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {personas.slice(0, 6).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleStartRun(p.id)}
                    disabled={loading}
                    className="text-left p-3 border border-gray-100 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 transition-colors"
                  >
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {p.created_at ? new Date(p.created_at.replace(" ", "T")).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : ""}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Leads */}
      {tab === "leads" && (
        <div className="space-y-3">
          {leads.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <Star className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>暂无线索，运行获客 Pipeline 后查看</p>
            </div>
          ) : leads.map(lead => (
            <div key={lead.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      lead.platform === "reddit" ? "bg-orange-50 text-orange-600" :
                      lead.platform === "x" ? "bg-gray-100 text-gray-700" :
                      lead.platform === "tiktok" ? "bg-pink-50 text-pink-600" :
                      "bg-blue-50 text-blue-600"
                    }`}>
                      {lead.platform}
                    </span>
                    <span className="text-xs text-gray-400">@{lead.author}</span>
                    {lead.url && (
                      <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-blue-500">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-2">{lead.content}</p>
                  {lead.reason && (
                    <p className="text-xs text-gray-400 mt-1 italic">{lead.reason}</p>
                  )}
                </div>
                <div className="text-right ml-4 shrink-0">
                  <div className={`text-xl font-bold ${
                    (lead.overall_score || 0) >= 0.7 ? "text-emerald-500" :
                    (lead.overall_score || 0) >= 0.5 ? "text-yellow-500" : "text-gray-400"
                  }`}>
                    {((lead.overall_score || 0) * 100).toFixed(0)}
                  </div>
                  <button
                    onClick={() => setExpandedLead(expandedLead === lead.id ? null : lead.id)}
                    className="text-gray-300 hover:text-gray-500 mt-1"
                  >
                    {expandedLead === lead.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {expandedLead === lead.id && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">相关性</span>
                    <ScoreBar value={lead.relevance_score || 0} color="bg-blue-400" />
                    <span className="text-xs text-gray-400 w-8">{((lead.relevance_score || 0) * 100).toFixed(0)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">意图</span>
                    <ScoreBar value={lead.intent_score || 0} color="bg-green-400" />
                    <span className="text-xs text-gray-400 w-8">{((lead.intent_score || 0) * 100).toFixed(0)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">权威</span>
                    <ScoreBar value={lead.authority_score || 0} color="bg-purple-400" />
                    <span className="text-xs text-gray-400 w-8">{((lead.authority_score || 0) * 100).toFixed(0)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: Replies */}
      {tab === "replies" && (
        <div className="space-y-3">
          {replies.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>暂无回复，运行获客 Pipeline 后查看</p>
            </div>
          ) : replies.map(reply => (
            <div key={reply.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    reply.platform === "reddit" ? "bg-orange-50 text-orange-600" :
                    reply.platform === "x" ? "bg-gray-100 text-gray-700" :
                    "bg-blue-50 text-blue-600"
                  }`}>
                    {reply.platform}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    reply.strategy === "helpful_tip" ? "bg-green-50 text-green-600" :
                    reply.strategy === "experience_share" ? "bg-blue-50 text-blue-600" :
                    "bg-yellow-50 text-yellow-600"
                  }`}>
                    {reply.strategy === "helpful_tip" ? "实用建议" :
                     reply.strategy === "experience_share" ? "经验分享" : "提问互动"}
                  </span>
                  <span className="text-xs text-gray-400">@{reply.author}</span>
                </div>
                <button
                  onClick={() => copyReply(reply.id, reply.reply_text)}
                  className="text-gray-300 hover:text-emerald-500 transition-colors"
                >
                  {copiedId === reply.id ? <CheckCheck className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {/* Original post */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3">
                <p className="text-xs text-gray-500 line-clamp-2">{reply.post_content}</p>
              </div>
              {/* Reply */}
              <div className="bg-emerald-50 rounded-lg px-3 py-2">
                <p className="text-sm text-emerald-900">{reply.reply_text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AcquisitionPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Loading...</div>}>
      <AcquisitionInner />
    </Suspense>
  );
}
