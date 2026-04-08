"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { AgentStatus } from "@/lib/types";
import {
  Bot,
  Plus,
  Send,
  Settings,
  Play,
  Pause,
  Clock,
  CheckCircle,
  XCircle,
  MessageCircle,
  Loader2,
  Zap,
  FileText,
  BarChart3,
  Search,
  Activity,
  ChevronDown,
  Grip,
  X,
} from "lucide-react";

/* ── Types ──────────────────────────────────────────────────────────── */

interface Session {
  id: number;
  title: string;
  context_type?: string;
  context_data?: string;
  demand_id?: number;
  updated_at: string;
  created_at: string;
}

interface Message {
  id: string;
  role: "user" | "agent" | "assistant" | "system";
  content: string;
  created_at: string;
  checkpoint_id?: number;
  checkpoint_status?: string;
  checkpoint_type?: string;
}

/* ── Quick Actions ──────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { icon: Search, label: "分析最新需求", message: "请帮我分析最新发现的需求，给出优先级建议" },
  { icon: BarChart3, label: "项目进展汇报", message: "请汇报当前所有项目的进展情况" },
  { icon: Zap, label: "竞品分析", message: "请帮我做一次竞品分析，看看最近有什么值得关注的产品" },
  { icon: FileText, label: "生成文档", message: "请帮我生成一份产品需求文档" },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function relativeTime(iso: string): string {
  if (!iso) return "";
  const ts = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 0) return "刚刚";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "昨天";
  if (days < 7) return `${days}天前`;
  return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const ts = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(ts).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function AgentPage() {
  const searchParams = useSearchParams();
  const demandIdFromUrl = searchParams.get("demand_id");
  const [demandHandled, setDemandHandled] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // Agent status
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [togglingAgent, setTogglingAgent] = useState(false);
  const [triggeringCycle, setTriggeringCycle] = useState(false);

  // Checkpoints
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [replyInputs, setReplyInputs] = useState<Record<number, string>>({});
  const [replyingId, setReplyingId] = useState<number | null>(null);

  // Top panel state
  const [topPanelCollapsed, setTopPanelCollapsed] = useState(false);
  const [topPanelHeight, setTopPanelHeight] = useState(240);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  /* ── Load sessions ─────────────────────────────────────────────────── */

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.agentChatHistory();
      const list = data?.sessions || data;
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      /* silently fail */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.agentStatus();
      setAgentStatus(data);
    } catch {
      /* silently fail */
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadStatus();
    const statusInterval = setInterval(loadStatus, 15000);
    return () => clearInterval(statusInterval);
  }, [loadSessions, loadStatus]);

  /* ── Auto-start demand discussion from URL param ─────────────────── */

  useEffect(() => {
    if (!demandIdFromUrl || demandHandled || sessionsLoading) return;
    setDemandHandled(true);

    const demandId = Number(demandIdFromUrl);
    if (isNaN(demandId)) return;

    // Check if there's already a session for this demand
    const existingSession = sessions.find((s) => s.demand_id === demandId);
    if (existingSession) {
      setActiveSessionId(existingSession.id);
      return;
    }

    // Auto-send a message to start a new session about this demand
    (async () => {
      const msg = `请帮我分析需求 #${demandId}，评估它的可行性和市场潜力`;
      const userMsg: Message = {
        id: `url-${Date.now()}`,
        role: "user",
        content: msg,
        created_at: new Date().toISOString(),
      };
      setMessages([userMsg]);
      setSending(true);
      try {
        const data = await api.agentChat({
          message: msg,
          demand_id: demandId,
        });
        if (data?.session_id) {
          setActiveSessionId(data.session_id);
          loadSessions();
        }
        const agentMsg: Message = {
          id: `agent-${Date.now()}`,
          role: "assistant",
          content: data?.response || data?.error || "未收到回复",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "system", content: "发送失败，请重试", created_at: new Date().toISOString() },
        ]);
      } finally {
        setSending(false);
      }
    })();
  }, [demandIdFromUrl, demandHandled, sessionsLoading, sessions, loadSessions]);

  /* ── Select session ────────────────────────────────────────────────── */

  const selectSession = useCallback(async (sessionId: number) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setMessagesLoading(true);
    setMessages([]);
    try {
      const data = await api.agentChatSession(sessionId);
      const msgs = data?.messages || [];
      setMessages(
        msgs.map((m: any) => ({
          id: `db-${m.id}`,
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
          created_at: m.created_at || new Date().toISOString(),
        }))
      );
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [activeSessionId]);

  /* ── Auto-scroll ───────────────────────────────────────────────────── */

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Close settings on outside click ───────────────────────────────── */

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings]);

  /* ── Drag to resize top panel ──────────────────────────────────────── */

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientY - dragRef.current.startY;
      const newHeight = Math.max(120, Math.min(500, dragRef.current.startHeight + delta));
      setTopPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: topPanelHeight };
    setIsDragging(true);
  }, [topPanelHeight]);

  /* ── Start new chat ────────────────────────────────────────────────── */

  const startNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  /* ── Send message ──────────────────────────────────────────────────── */

  const sendMessage = useCallback(
    async (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || sending) return;

      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      const userMsg: Message = {
        id: `user-${genId()}`,
        role: "user",
        content: msg,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);

      try {
        const data = await api.agentChat({
          message: msg,
          session_id: activeSessionId,
        });

        if (data?.session_id && !activeSessionId) {
          setActiveSessionId(data.session_id);
          loadSessions();
        } else if (data?.session_id) {
          loadSessions();
        }

        const agentMsg: Message = {
          id: `agent-${genId()}`,
          role: "assistant",
          content: data?.response || data?.error || "未收到回复",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch {
        const errMsg: Message = {
          id: `err-${genId()}`,
          role: "system",
          content: "发送失败，请检查网络连接后重试",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setSending(false);
      }
    },
    [input, sending, activeSessionId, loadSessions]
  );

  /* ── Keyboard ──────────────────────────────────────────────────────── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  /* ── Auto-resize textarea ──────────────────────────────────────────── */

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  /* ── Agent controls ────────────────────────────────────────────────── */

  const handleToggleAgent = useCallback(async () => {
    setTogglingAgent(true);
    try {
      await api.agentToggle();
      await loadStatus();
    } catch {
      /* ignore */
    } finally {
      setTogglingAgent(false);
    }
  }, [loadStatus]);

  const handleTriggerCycle = useCallback(async () => {
    setTriggeringCycle(true);
    try {
      await api.agentTrigger();
      await loadStatus();
    } catch {
      /* ignore */
    } finally {
      setTriggeringCycle(false);
    }
  }, [loadStatus]);

  /* ── Checkpoint actions ────────────────────────────────────────────── */

  const loadCheckpoints = useCallback(async () => {
    setCheckpointsLoading(true);
    try {
      const data = await api.agentCheckpoints("pending");
      setCheckpoints(data?.checkpoints || []);
      setShowCheckpoints(true);
    } catch {
      /* ignore */
    } finally {
      setCheckpointsLoading(false);
    }
  }, []);

  const handleResolveCheckpoint = useCallback(
    async (checkpointId: number, action: "approved" | "rejected") => {
      try {
        await api.resolveCheckpoint(checkpointId, { status: action });
        // Update in messages
        setMessages((prev) =>
          prev.map((m) =>
            m.checkpoint_id === checkpointId
              ? { ...m, checkpoint_status: action }
              : m
          )
        );
        // Update in checkpoints list
        setCheckpoints((prev) =>
          prev.map((cp) =>
            cp.id === checkpointId ? { ...cp, status: action } : cp
          )
        );
        // Update status count
        loadStatus();
      } catch {
        /* ignore */
      }
    },
    [loadStatus]
  );

  const handleAnswerQuestion = useCallback(
    async (checkpointId: number) => {
      const answer = replyInputs[checkpointId]?.trim();
      if (!answer) return;
      setReplyingId(checkpointId);
      try {
        await api.answerQuestion(checkpointId, answer);
        setCheckpoints((prev) =>
          prev.map((cp) =>
            cp.id === checkpointId ? { ...cp, status: "approved", user_feedback: answer } : cp
          )
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.checkpoint_id === checkpointId ? { ...m, checkpoint_status: "approved" } : m
          )
        );
        setReplyInputs((prev) => { const n = { ...prev }; delete n[checkpointId]; return n; });
        loadStatus();
      } catch {
        /* ignore */
      } finally {
        setReplyingId(null);
      }
    },
    [replyInputs, loadStatus]
  );

  /* ── Derived ───────────────────────────────────────────────────────── */

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isRunning = agentStatus?.running ?? false;
  const isEnabled = agentStatus?.enabled ?? false;
  const hasInput = input.trim().length > 0;
  const showEmptyState = !activeSessionId && messages.length === 0;

  /* ── Render ────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] bg-[#FAFAF8]">
      {/* ═══════ TOP SCREEN (NDS upper) ═══════════════════════════════ */}
      {!topPanelCollapsed && (
        <div
          className="shrink-0 bg-white border-b border-[#E8E5E0] flex flex-col"
          style={{ height: topPanelHeight }}
        >
          {/* ── Top bar ──────────────────────────────────────────────── */}
          <div className="h-11 px-4 flex items-center justify-between border-b border-[#F0EDE8] shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-[#EEF1FB] flex items-center justify-center">
                  <Bot size={13} className="text-[#354DAA]" />
                </div>
                <span className="font-semibold text-[13px] text-[#1A1A1A]">PM Agent</span>
              </div>

              {/* Agent status pill */}
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#F5F3EF]">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isRunning
                      ? "bg-[#3D9A5F] animate-pulse"
                      : isEnabled
                      ? "bg-[#3D9A5F]"
                      : "bg-[#9B9B9B]"
                  }`}
                />
                <span className="text-[10px] text-[#6B6B6B]">
                  {isRunning ? "运行中" : isEnabled ? "待命" : "已暂停"}
                </span>
              </div>

              {(agentStatus?.pending_checkpoints ?? 0) > 0 && (
                <button
                  onClick={loadCheckpoints}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#EEF1FB] hover:bg-[#DDE3F7] transition-colors duration-100"
                >
                  <Clock size={10} className="text-[#354DAA]" />
                  <span className="text-[10px] font-medium text-[#354DAA]">
                    {agentStatus!.pending_checkpoints} 待审批
                  </span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* New chat button */}
              <button
                onClick={startNewChat}
                className="h-7 px-2.5 rounded-md hover:bg-[#F5F3EF] flex items-center gap-1.5 transition-colors duration-100"
                title="新对话"
              >
                <Plus size={13} className="text-[#6B6B6B]" />
                <span className="text-[11px] text-[#6B6B6B]">新对话</span>
              </button>

              {/* Settings */}
              <div className="relative" ref={settingsRef}>
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="w-7 h-7 rounded-md hover:bg-[#F5F3EF] flex items-center justify-center transition-colors duration-100"
                >
                  <Settings size={13} className="text-[#6B6B6B]" />
                </button>

                {showSettings && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-[#E8E5E0] rounded-lg shadow-lg py-1 z-50">
                    <button
                      onClick={handleToggleAgent}
                      disabled={togglingAgent}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#1A1A1A] hover:bg-[#F5F3EF] transition-colors duration-100 disabled:opacity-50"
                    >
                      {isEnabled ? (
                        <Pause size={13} className="text-[#6B6B6B]" />
                      ) : (
                        <Play size={13} className="text-[#3D9A5F]" />
                      )}
                      <span>{isEnabled ? "暂停 Agent" : "启动 Agent"}</span>
                      {togglingAgent && <Loader2 size={11} className="ml-auto animate-spin text-[#9B9B9B]" />}
                    </button>
                    <button
                      onClick={handleTriggerCycle}
                      disabled={triggeringCycle}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-[#1A1A1A] hover:bg-[#F5F3EF] transition-colors duration-100 disabled:opacity-50"
                    >
                      <Zap size={13} className="text-[#354DAA]" />
                      <span>触发认知循环</span>
                      {triggeringCycle && <Loader2 size={11} className="ml-auto animate-spin text-[#9B9B9B]" />}
                    </button>
                    <div className="border-t border-[#F0EDE8] my-1" />
                    <div className="px-4 py-2 text-[11px] text-[#9B9B9B] space-y-1">
                      <div className="flex justify-between">
                        <span>状态</span>
                        <span className={isEnabled ? "text-[#3D9A5F]" : ""}>
                          {isRunning ? "循环运行中" : isEnabled ? "已启用" : "已暂停"}
                        </span>
                      </div>
                      {agentStatus?.last_run && (
                        <div className="flex justify-between">
                          <span>上次运行</span>
                          <span>{relativeTime(agentStatus.last_run.started_at)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Collapse button */}
              <button
                onClick={() => setTopPanelCollapsed(true)}
                className="w-7 h-7 rounded-md hover:bg-[#F5F3EF] flex items-center justify-center transition-colors duration-100"
                title="收起面板"
              >
                <ChevronDown size={13} className="text-[#6B6B6B] rotate-180" />
              </button>
            </div>
          </div>

          {/* ── Session tabs + Info panels ────────────────────────────── */}
          <div className="flex-1 flex min-h-0">
            {/* Session list (scrollable vertical) */}
            <div className="w-[220px] border-r border-[#F0EDE8] overflow-y-auto shrink-0">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="text-[#9B9B9B] animate-spin" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-8 px-3">
                  <MessageCircle size={20} className="text-[#E8E5E0] mx-auto mb-1.5" />
                  <p className="text-[11px] text-[#9B9B9B]">暂无对话记录</p>
                </div>
              ) : (
                <div className="py-1">
                  {sessions.map((session) => {
                    const isActive = activeSessionId === session.id;
                    const contextLabel =
                      session.context_type === "project"
                        ? session.context_data || "项目"
                        : session.context_type === "demand"
                        ? session.context_data || "需求"
                        : session.demand_id
                        ? `需求 #${session.demand_id}`
                        : "";
                    return (
                      <button
                        key={session.id}
                        onClick={() => selectSession(session.id)}
                        className={`w-full text-left px-3 py-2.5 transition-colors duration-100 group relative ${
                          isActive
                            ? "bg-[#EEF1FB]"
                            : "hover:bg-[#F5F3EF]"
                        }`}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-[#354DAA]" />
                        )}
                        <div className="text-[12px] font-medium text-[#1A1A1A] truncate leading-snug">
                          {session.title || "新对话"}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {contextLabel && (
                            <span className="text-[9px] px-1 py-px rounded bg-[#F0EDE8] text-[#6B6B6B] truncate max-w-[100px]">
                              {contextLabel}
                            </span>
                          )}
                          <span className="text-[9px] text-[#9B9B9B] ml-auto shrink-0">
                            {relativeTime(session.updated_at || session.created_at)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Info panel area */}
            <div className="flex-1 overflow-auto p-4">
              {activeSession ? (
                /* Active session info */
                <div className="grid grid-cols-2 gap-3 h-full">
                  {/* Session details card */}
                  <div className="rounded-lg border border-[#F0EDE8] bg-[#FAFAF8] p-3 overflow-auto">
                    <div className="flex items-center gap-1.5 mb-2">
                      <MessageCircle size={12} className="text-[#354DAA]" />
                      <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">会话信息</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] text-[#9B9B9B]">标题</div>
                        <div className="text-[13px] font-medium text-[#1A1A1A] truncate">{activeSession.title || "新对话"}</div>
                      </div>
                      {activeSession.demand_id && (
                        <div>
                          <div className="text-[11px] text-[#9B9B9B]">关联需求</div>
                          <div className="text-[12px] text-[#354DAA]">#{activeSession.demand_id}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] text-[#9B9B9B]">创建时间</div>
                        <div className="text-[12px] text-[#1A1A1A]">{relativeTime(activeSession.created_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-[#9B9B9B]">消息数</div>
                        <div className="text-[12px] text-[#1A1A1A]">{messages.length}</div>
                      </div>
                    </div>
                  </div>

                  {/* Agent activity card */}
                  <div className="rounded-lg border border-[#F0EDE8] bg-[#FAFAF8] p-3 overflow-auto">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Activity size={12} className="text-[#354DAA]" />
                      <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Agent 状态</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[#9B9B9B]">引擎</span>
                        <span className={`text-[11px] font-medium ${isEnabled ? "text-[#3D9A5F]" : "text-[#9B9B9B]"}`}>
                          {isRunning ? "运行中" : isEnabled ? "已启用" : "已暂停"}
                        </span>
                      </div>
                      {agentStatus?.last_run && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[#9B9B9B]">上次循环</span>
                          <span className="text-[11px] text-[#1A1A1A]">{relativeTime(agentStatus.last_run.started_at)}</span>
                        </div>
                      )}
                      {(agentStatus?.pending_checkpoints ?? 0) > 0 && (
                        <button onClick={loadCheckpoints} className="flex items-center justify-between w-full hover:bg-[#EEF1FB] rounded px-1 -mx-1 py-0.5 transition-colors duration-100">
                          <span className="text-[11px] text-[#9B9B9B]">待审批</span>
                          <span className="text-[11px] font-medium text-[#354DAA] underline">{agentStatus!.pending_checkpoints} 个</span>
                        </button>
                      )}
                      <div className="pt-1.5 flex gap-2">
                        <button
                          onClick={handleToggleAgent}
                          disabled={togglingAgent}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium border border-[#E8E5E0] hover:bg-white transition-colors duration-100 disabled:opacity-50"
                        >
                          {togglingAgent ? (
                            <Loader2 size={11} className="animate-spin text-[#9B9B9B]" />
                          ) : isEnabled ? (
                            <>
                              <Pause size={11} className="text-[#6B6B6B]" />
                              <span className="text-[#6B6B6B]">暂停</span>
                            </>
                          ) : (
                            <>
                              <Play size={11} className="text-[#3D9A5F]" />
                              <span className="text-[#3D9A5F]">启动</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={handleTriggerCycle}
                          disabled={triggeringCycle}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium border border-[#E8E5E0] hover:bg-white transition-colors duration-100 disabled:opacity-50"
                        >
                          {triggeringCycle ? (
                            <Loader2 size={11} className="animate-spin text-[#9B9B9B]" />
                          ) : (
                            <>
                              <Zap size={11} className="text-[#354DAA]" />
                              <span className="text-[#354DAA]">触发循环</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* No session selected — show overview */
                <div className="grid grid-cols-3 gap-3 h-full">
                  {/* Sessions count */}
                  <div className="rounded-lg border border-[#F0EDE8] bg-[#FAFAF8] p-3 flex flex-col items-center justify-center">
                    <MessageCircle size={20} className="text-[#354DAA] mb-1.5" />
                    <div className="text-xl font-semibold text-[#1A1A1A]">{sessions.length}</div>
                    <div className="text-[10px] text-[#9B9B9B] mt-0.5">会话总数</div>
                  </div>

                  {/* Agent status */}
                  <div className="rounded-lg border border-[#F0EDE8] bg-[#FAFAF8] p-3 flex flex-col items-center justify-center">
                    <Activity size={20} className={`mb-1.5 ${isEnabled ? "text-[#3D9A5F]" : "text-[#9B9B9B]"}`} />
                    <div className="text-sm font-semibold text-[#1A1A1A]">
                      {isRunning ? "运行中" : isEnabled ? "待命" : "已暂停"}
                    </div>
                    <div className="text-[10px] text-[#9B9B9B] mt-0.5">Agent 引擎</div>
                  </div>

                  {/* Pending checkpoints */}
                  <button
                    onClick={loadCheckpoints}
                    className="rounded-lg border border-[#F0EDE8] bg-[#FAFAF8] p-3 flex flex-col items-center justify-center hover:border-[#354DAA] hover:bg-[#EEF1FB] transition-all duration-150 cursor-pointer"
                  >
                    <Clock size={20} className="text-[#354DAA] mb-1.5" />
                    <div className="text-xl font-semibold text-[#1A1A1A]">{agentStatus?.pending_checkpoints ?? 0}</div>
                    <div className="text-[10px] text-[#9B9B9B] mt-0.5">待审批 — 点击查看</div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Resize handle ─────────────────────────────────────────────── */}
      {!topPanelCollapsed && (
        <div
          onMouseDown={handleDragStart}
          className={`h-[5px] shrink-0 flex items-center justify-center cursor-ns-resize group ${
            isDragging ? "bg-[#354DAA]/10" : "hover:bg-[#F0EDE8]"
          } transition-colors duration-100`}
        >
          <Grip size={12} className="text-[#9B9B9B] group-hover:text-[#6B6B6B] rotate-90" />
        </div>
      )}

      {/* Collapsed top bar */}
      {topPanelCollapsed && (
        <div className="h-10 bg-white border-b border-[#E8E5E0] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-[#354DAA]" />
              <span className="font-semibold text-[12px] text-[#1A1A1A]">PM Agent</span>
            </div>
            <div className={`w-1.5 h-1.5 rounded-full ${isEnabled ? "bg-[#3D9A5F]" : "bg-[#9B9B9B]"}`} />
            {activeSession && (
              <span className="text-[11px] text-[#6B6B6B] truncate max-w-[200px]">
                {activeSession.title || "新对话"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={startNewChat}
              className="w-7 h-7 rounded-md hover:bg-[#F5F3EF] flex items-center justify-center transition-colors duration-100"
              title="新对话"
            >
              <Plus size={13} className="text-[#6B6B6B]" />
            </button>
            <button
              onClick={() => setTopPanelCollapsed(false)}
              className="w-7 h-7 rounded-md hover:bg-[#F5F3EF] flex items-center justify-center transition-colors duration-100"
              title="展开面板"
            >
              <ChevronDown size={13} className="text-[#6B6B6B]" />
            </button>
          </div>
        </div>
      )}

      {/* ═══════ Checkpoints review panel ══════════════════════════════ */}
      {showCheckpoints && (
        <div className="shrink-0 border-b border-[#E8E5E0] bg-white max-h-[300px] overflow-y-auto">
          <div className="px-4 py-2 flex items-center justify-between border-b border-[#F0EDE8] sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2">
              <Clock size={13} className="text-[#354DAA]" />
              <span className="text-[12px] font-semibold text-[#1A1A1A]">待审批 ({checkpoints.filter(c => c.status === 'pending').length})</span>
            </div>
            <button
              onClick={() => setShowCheckpoints(false)}
              className="w-6 h-6 rounded-md hover:bg-[#F5F3EF] flex items-center justify-center"
            >
              <X size={12} className="text-[#6B6B6B]" />
            </button>
          </div>
          {checkpointsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="text-[#9B9B9B] animate-spin" />
            </div>
          ) : checkpoints.length === 0 ? (
            <div className="text-center py-6 text-[12px] text-[#9B9B9B]">暂无待审批项</div>
          ) : (
            <div className="divide-y divide-[#F0EDE8]">
              {checkpoints.map((cp) => {
                let proposal: any = {};
                try { proposal = typeof cp.proposal === 'string' ? JSON.parse(cp.proposal) : cp.proposal; } catch {}
                const isPending = cp.status === 'pending';
                return (
                  <div key={cp.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EEF1FB] text-[#354DAA] font-medium">
                            {cp.checkpoint_type === 'question' ? '提问' : cp.checkpoint_type === 'investigate' ? '调研' : cp.checkpoint_type}
                          </span>
                          {proposal?.source === 'dreaming' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">💭 做梦</span>
                          )}
                          {proposal?.priority === 'high' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">🔴 高优</span>
                          )}
                          {cp.demand_title && (
                            <span className="text-[10px] text-[#6B6B6B] truncate">{cp.demand_title}</span>
                          )}
                          <span className="text-[9px] text-[#9B9B9B] ml-auto shrink-0">{relativeTime(cp.created_at)}</span>
                        </div>
                        <p className="text-[12px] text-[#1A1A1A] leading-relaxed line-clamp-3">
                          {proposal?.question || proposal?.reason || proposal?.summary || cp.proposal?.substring?.(0, 200) || ''}
                        </p>
                        {proposal?.context && (
                          <p className="text-[11px] text-[#6B6B6B] mt-1 line-clamp-2">{proposal.context}</p>
                        )}
                      </div>
                      {isPending && cp.checkpoint_type !== 'question' && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => handleResolveCheckpoint(cp.id, "approved")}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[#EDFBF2] text-[#3D9A5F] hover:bg-[#D0EDDA] transition-colors duration-100"
                          >
                            <CheckCircle size={11} />
                            批准
                          </button>
                          <button
                            onClick={() => handleResolveCheckpoint(cp.id, "rejected")}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-[#FEF0EF] text-[#DC4A3F] hover:bg-[#FEE2E2] transition-colors duration-100"
                          >
                            <XCircle size={11} />
                            拒绝
                          </button>
                        </div>
                      )}
                      {!isPending && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                          cp.status === 'approved' ? 'bg-[#EDFBF2] text-[#3D9A5F]' : cp.status === 'rejected' ? 'bg-[#FEF0EF] text-[#DC4A3F]' : 'bg-[#F5F5F5] text-[#6B6B6B]'
                        }`}>
                          {cp.status === 'approved' ? (cp.user_feedback ? '已回复' : '已批准') : '已拒绝'}
                        </span>
                      )}
                    </div>
                    {/* Question reply input */}
                    {isPending && cp.checkpoint_type === 'question' && (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          type="text"
                          value={replyInputs[cp.id] || ''}
                          onChange={(e) => setReplyInputs((prev) => ({ ...prev, [cp.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnswerQuestion(cp.id); } }}
                          placeholder="输入你的回复..."
                          className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-[#E0DCD5] bg-white focus:outline-none focus:border-[#354DAA] focus:ring-1 focus:ring-[#354DAA]/20 transition-colors"
                        />
                        <button
                          onClick={() => handleAnswerQuestion(cp.id)}
                          disabled={!replyInputs[cp.id]?.trim() || replyingId === cp.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#354DAA] text-white hover:bg-[#2A3F8E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
                        >
                          {replyingId === cp.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          回复
                        </button>
                        <button
                          onClick={() => handleResolveCheckpoint(cp.id, "rejected")}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium bg-[#FEF0EF] text-[#DC4A3F] hover:bg-[#FEE2E2] transition-colors duration-100"
                        >
                          <XCircle size={11} />
                          跳过
                        </button>
                      </div>
                    )}
                    {/* Show previous answer */}
                    {!isPending && cp.user_feedback && (
                      <div className="mt-2 text-[11px] text-[#6B6B6B] bg-[#F8F7F4] rounded px-3 py-1.5">
                        <span className="text-[#354DAA] font-medium">你的回复：</span> {cp.user_feedback}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════ BOTTOM SCREEN (NDS lower) — Chat ═════════════════════ */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* ── Messages area or Empty state ───────────────────────────── */}
        {showEmptyState ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md px-6">
              <div className="w-14 h-14 rounded-2xl bg-[#EEF1FB] flex items-center justify-center mx-auto mb-4">
                <Bot size={24} className="text-[#354DAA]" />
              </div>
              <h3 className="text-base font-semibold text-[#1A1A1A] mb-1.5">开始新对话</h3>
              <p className="text-[13px] text-[#6B6B6B] mb-5 leading-relaxed">
                我是你的 AI 产品经理助手，可以帮你分析需求、生成文档、做竞品分析等
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      onClick={() => sendMessage(action.message)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#E8E5E0] bg-white text-left hover:border-[#354DAA] hover:bg-[#EEF1FB] transition-all duration-150 group"
                    >
                      <Icon
                        size={14}
                        className="text-[#9B9B9B] group-hover:text-[#354DAA] transition-colors duration-150 shrink-0"
                      />
                      <span className="text-[12px] text-[#1A1A1A] group-hover:text-[#354DAA] transition-colors duration-150">
                        {action.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-6 py-4 space-y-4">
              {messagesLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="text-[#9B9B9B] animate-spin" />
                </div>
              )}

              {messages.map((msg) => {
                if (msg.role === "system") {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <span className="text-[11px] text-[#9B9B9B] bg-[#F5F3EF] px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    </div>
                  );
                }

                if (msg.role === "user") {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[75%]">
                        <div className="bg-[#354DAA] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                        <div className="text-[10px] text-[#9B9B9B] mt-1 text-right pr-1">
                          {formatTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-[#EEF1FB] flex items-center justify-center shrink-0 mt-0.5">
                      <Bot size={13} className="text-[#354DAA]" />
                    </div>
                    <div className="flex-1 min-w-0 max-w-[85%]">
                      <div className="bg-white border border-[#E8E5E0] rounded-2xl rounded-tl-md px-4 py-2.5 text-[13px] text-[#1A1A1A] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.content}
                      </div>

                      {msg.checkpoint_id && !msg.checkpoint_status && msg.checkpoint_type !== 'question' && (
                        <div className="flex gap-2 mt-1.5 ml-1">
                          <button
                            onClick={() => handleResolveCheckpoint(msg.checkpoint_id!, "approved")}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#EDFBF2] text-[#3D9A5F] hover:bg-[#D0EDDA] transition-colors duration-100"
                          >
                            <CheckCircle size={11} />
                            批准
                          </button>
                          <button
                            onClick={() => handleResolveCheckpoint(msg.checkpoint_id!, "rejected")}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#FEF0EF] text-[#DC4A3F] hover:bg-[#FEE2E2] transition-colors duration-100"
                          >
                            <XCircle size={11} />
                            拒绝
                          </button>
                        </div>
                      )}
                      {msg.checkpoint_id && !msg.checkpoint_status && msg.checkpoint_type === 'question' && (
                        <div className="flex gap-1.5 mt-1.5 ml-1">
                          <input
                            type="text"
                            value={replyInputs[msg.checkpoint_id] || ''}
                            onChange={(e) => setReplyInputs((prev) => ({ ...prev, [msg.checkpoint_id!]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnswerQuestion(msg.checkpoint_id!); } }}
                            placeholder="输入你的回复..."
                            className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-[#E0DCD5] bg-white focus:outline-none focus:border-[#354DAA] focus:ring-1 focus:ring-[#354DAA]/20 transition-colors"
                          />
                          <button
                            onClick={() => handleAnswerQuestion(msg.checkpoint_id!)}
                            disabled={!replyInputs[msg.checkpoint_id!]?.trim() || replyingId === msg.checkpoint_id}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-medium bg-[#354DAA] text-white hover:bg-[#2A3F8E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {replyingId === msg.checkpoint_id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            回复
                          </button>
                          <button
                            onClick={() => handleResolveCheckpoint(msg.checkpoint_id!, "rejected")}
                            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium bg-[#FEF0EF] text-[#DC4A3F] hover:bg-[#FEE2E2] transition-colors"
                          >
                            <XCircle size={11} />
                            跳过
                          </button>
                        </div>
                      )}
                      {msg.checkpoint_id && msg.checkpoint_status && (
                        <div className="mt-1.5 ml-1">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full ${
                              msg.checkpoint_status === "approved"
                                ? "bg-[#EDFBF2] text-[#3D9A5F]"
                                : "bg-[#FEF0EF] text-[#DC4A3F]"
                            }`}
                          >
                            {msg.checkpoint_status === "approved" ? "已回复" : "已跳过"}
                          </span>
                        </div>
                      )}

                      <div className="text-[10px] text-[#9B9B9B] mt-1 pl-1">
                        {formatTime(msg.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {sending && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[#EEF1FB] flex items-center justify-center shrink-0">
                    <Bot size={13} className="text-[#354DAA]" />
                  </div>
                  <div className="bg-white border border-[#E8E5E0] rounded-2xl rounded-tl-md px-4 py-2.5">
                    <div className="flex gap-1 items-center">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-[#9B9B9B]"
                          style={{
                            animation: "typingDot 1.4s ease-in-out infinite",
                            animationDelay: `${i * 200}ms`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* ── Input area ─────────────────────────────────────────────── */}
        <div className="border-t border-[#E8E5E0] bg-white px-6 py-3 shrink-0">
          <div className="max-w-3xl mx-auto">
            {activeSession?.demand_id && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] text-[#6B6B6B] bg-[#EEF1FB] px-2 py-0.5 rounded">
                  关联需求 #{activeSession.demand_id}
                </span>
              </div>
            )}

            <div className="flex items-end gap-2.5">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Shift+Enter 换行)"
                disabled={sending}
                rows={1}
                className="flex-1 px-4 py-2.5 bg-[#F5F3EF] border border-[#E8E5E0] rounded-xl text-[13px] text-[#1A1A1A] placeholder-[#9B9B9B] focus:outline-none focus:border-[#354DAA] focus:bg-white resize-none transition-all duration-150 min-h-[40px] max-h-[160px] leading-relaxed"
              />
              <button
                onClick={() => sendMessage()}
                disabled={sending || !hasInput}
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-150 ${
                  hasInput
                    ? "bg-[#354DAA] text-white hover:bg-[#2A3F8E] shadow-sm"
                    : "bg-[#E8E5E0] text-[#9B9B9B] cursor-not-allowed"
                }`}
              >
                {sending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Keyframe animation for typing dots */}
      <style jsx>{`
        @keyframes typingDot {
          0%,
          80%,
          100% {
            opacity: 0.3;
            transform: scale(0.8);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
