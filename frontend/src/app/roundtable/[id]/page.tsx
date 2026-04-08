"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { RoundtableRoom, RoundtableMessage } from "@/lib/types";
import {
  ArrowLeft,
  Send,
  FileText,
  LinkIcon,
  Users,
  Bot,
  Share2,
  Check,
  Copy,
  X,
  Reply,
  CornerDownRight,
} from "lucide-react";

const SENDER_CONFIG: Record<
  string,
  { emoji: string; label: string; bg: string; text: string; border: string }
> = {
  human: {
    emoji: "\u{1F464}",
    label: "",
    bg: "bg-blue-100",
    text: "text-blue-800",
    border: "border-blue-200",
  },
  claude_code: {
    emoji: "\u{1F5A5}\uFE0F",
    label: "Claude Code",
    bg: "bg-green-100",
    text: "text-green-800",
    border: "border-green-200",
  },
  pm_agent: {
    emoji: "\u{1F916}",
    label: "PM Agent",
    bg: "bg-purple-100",
    text: "text-purple-800",
    border: "border-purple-200",
  },
  system: {
    emoji: "",
    label: "System",
    bg: "bg-gray-100",
    text: "text-gray-500",
    border: "border-gray-200",
  },
};

function senderIcon(type: string) {
  const cfg = SENDER_CONFIG[type] || SENDER_CONFIG.human;
  if (type === "system") return null;
  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${cfg.bg} ${cfg.text}`}
    >
      {cfg.emoji}
    </div>
  );
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uniqueParticipants(messages: RoundtableMessage[]) {
  const seen = new Map<string, { type: string; name: string }>();
  for (const m of messages) {
    if (m.sender_type === "system") continue;
    const key = `${m.sender_type}:${m.sender_name}`;
    if (!seen.has(key)) {
      seen.set(key, { type: m.sender_type, name: m.sender_name });
    }
  }
  return Array.from(seen.values());
}

export default function RoundtableRoomPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const roomId = Number(params.id);

  const [room, setRoom] = useState<RoundtableRoom | null>(null);
  const [messages, setMessages] = useState<RoundtableMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const waitingStartRef = useRef<number>(0);
  const [waitingElapsed, setWaitingElapsed] = useState(0);
  const [replyTo, setReplyTo] = useState<RoundtableMessage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<number>(0);

  // Initial fetch
  const fetchRoom = useCallback(async () => {
    try {
      const result = await api.roundtableRoom(roomId, 200);
      if (result) {
        setRoom(result.room ?? result);
        const msgs: RoundtableMessage[] = result.messages ?? [];
        setMessages(msgs);
        if (msgs.length > 0) {
          lastMessageIdRef.current = msgs[msgs.length - 1].id;
          // Detect if last message mentions pm_agent with no agent reply after it
          const lastIdx = msgs.length - 1;
          const lastMsg = msgs[lastIdx];
          if (
            lastMsg.sender_type !== "pm_agent" &&
            /@(pm_agent|PM|pm)\b/i.test(lastMsg.content)
          ) {
            // Check if this message was recent (within 3 minutes)
            const msgAge = Date.now() - new Date(lastMsg.created_at).getTime();
            if (msgAge < 180_000) {
              setWaitingForAgent(true);
              waitingStartRef.current = Date.now() - msgAge;
            }
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch room:", err);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // Polling for new messages — faster (1.5s) when waiting for agent, normal (3s) otherwise
  useEffect(() => {
    const poll = async () => {
      try {
        const result = await api.roundtableRoom(roomId, 200);
        if (result) {
          const msgs: RoundtableMessage[] = result.messages ?? [];
          if (msgs.length > 0) {
            const latestId = msgs[msgs.length - 1].id;
            if (latestId > lastMessageIdRef.current) {
              const newMsgs = msgs.filter((m) => m.id > lastMessageIdRef.current);
              setMessages((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                const toAdd = newMsgs.filter((m) => !existingIds.has(m.id));
                return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
              });
              lastMessageIdRef.current = latestId;
              // If a pm_agent message arrived, stop waiting
              if (newMsgs.some((m) => m.sender_type === "pm_agent")) {
                setWaitingForAgent(false);
              }
            }
          }
          if (result.room) {
            setRoom(result.room);
          }
        }
      } catch {
        // Silently ignore polling errors
      }
      // Safety timeout: stop waiting after 3 minutes
      if (waitingForAgent && Date.now() - waitingStartRef.current > 180_000) {
        setWaitingForAgent(false);
      }
    };
    const interval = setInterval(poll, waitingForAgent ? 1500 : 3000);
    return () => clearInterval(interval);
  }, [roomId, waitingForAgent]);

  // Tick elapsed time while waiting for agent
  useEffect(() => {
    if (!waitingForAgent) { setWaitingElapsed(0); return; }
    const t = setInterval(() => {
      setWaitingElapsed(Math.floor((Date.now() - waitingStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [waitingForAgent]);

  // Auto-scroll to bottom when new messages arrive or agent starts thinking
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, waitingForAgent]);

  async function handleSend() {
    if (!inputValue.trim() || sending) return;
    const content = inputValue.trim();
    const mentionsAgent = /@(pm_agent|PM|pm)\b/i.test(content);
    const replyToId = replyTo?.id || null;
    setInputValue("");
    setReplyTo(null);
    setSending(true);

    try {
      const senderName = user?.display_name || user?.username || "User";
      await api.postRoundtableMessage(roomId, content, "human", senderName, replyToId);
      // Optimistic: refetch to get server-assigned id
      const result = await api.roundtableRoom(roomId, 200);
      if (result) {
        const msgs: RoundtableMessage[] = result.messages ?? [];
        setMessages(msgs);
        if (msgs.length > 0) {
          lastMessageIdRef.current = msgs[msgs.length - 1].id;
        }
      }
      if (mentionsAgent) {
        setWaitingForAgent(true);
        waitingStartRef.current = Date.now();
      }
    } catch (err) {
      console.error("Failed to send:", err);
      setInputValue(content);
    } finally {
      setSending(false);
    }
  }

  async function handleSummary() {
    if (summarizing) return;
    setSummarizing(true);
    try {
      await api.roundtableSummary(roomId);
      // Refetch to get the summary system message
      const result = await api.roundtableRoom(roomId, 200);
      if (result) {
        const msgs: RoundtableMessage[] = result.messages ?? [];
        setMessages(msgs);
        if (msgs.length > 0) {
          lastMessageIdRef.current = msgs[msgs.length - 1].id;
        }
      }
    } catch (err) {
      console.error("Failed to generate summary:", err);
    } finally {
      setSummarizing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function insertAtMention() {
    setInputValue((prev) => {
      const needsSpace = prev.length > 0 && !prev.endsWith(" ");
      return prev + (needsSpace ? " " : "") + "@pm_agent ";
    });
  }

  function getBaseUrl() {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return "";
  }

  function getOpenApiBase() {
    const base = getBaseUrl();
    const token = room?.invite_token;
    if (!token) return "";
    return `${base}/api/roundtable/open/${token}`;
  }

  async function handleCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  }

  const participants = uniqueParticipants(messages);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-2 text-[#9B9B9B]">
          <svg className="animate-spin h-8 w-8 text-[#354DAA]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">加载讨论室...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0 rounded-t-xl">
        <button
          onClick={() => router.push("/roundtable")}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-[#1A1A1A] truncate">
            {room?.title ?? "讨论室"}
          </h1>
          <div className="flex items-center gap-3 text-xs text-[#9B9B9B]">
            {room?.topic && <span className="truncate max-w-[300px]">{room.topic}</span>}
            {room?.project_title && (
              <button
                onClick={() => room?.project_id && router.push(`/projects/${room.project_id}`)}
                className="inline-flex items-center gap-1 text-[#354DAA] hover:underline"
              >
                <LinkIcon size={10} />
                {room.project_title}
              </button>
            )}
          </div>
        </div>

        {/* Participant avatars */}
        <div className="flex items-center gap-1.5">
          {participants.map((p) => {
            const cfg = SENDER_CONFIG[p.type] || SENDER_CONFIG.human;
            return (
              <div
                key={`${p.type}:${p.name}`}
                title={p.name || cfg.label}
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${cfg.bg} ${cfg.text}`}
              >
                {cfg.emoji}
              </div>
            );
          })}
        </div>

        {/* Invite button */}
        {room?.invite_token && (
          <button
            onClick={() => setShowInvite(!showInvite)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showInvite
                ? "bg-[#354DAA] text-white"
                : "bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200"
            }`}
          >
            <Share2 size={14} />
            API 接入
          </button>
        )}

        {/* Summary button */}
        <button
          onClick={handleSummary}
          disabled={summarizing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        >
          <FileText size={14} />
          {summarizing ? "生成中..." : "生成摘要"}
        </button>
      </div>

      {/* Invite / API panel */}
      {showInvite && room?.invite_token && (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-200 px-4 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-orange-900">🔗 外部 Agent 接入</h3>
            <button onClick={() => setShowInvite(false)} className="text-orange-400 hover:text-orange-600">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-orange-700 mb-3">
            使用以下 API 让你的 Agent 免登录接入此圆桌讨论
          </p>
          <div className="space-y-2">
            {/* Token */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-orange-600 w-14 flex-shrink-0 font-medium">Token</span>
              <code className="flex-1 text-xs bg-white/80 border border-orange-200 rounded px-2 py-1.5 font-mono text-gray-700 truncate">
                {room.invite_token}
              </code>
              <button
                onClick={() => handleCopy(room.invite_token!, "token")}
                className="flex-shrink-0 p-1.5 rounded hover:bg-orange-100 text-orange-600 transition-colors"
                title="复制 Token"
              >
                {copied === "token" ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>
            {/* API Base */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-orange-600 w-14 flex-shrink-0 font-medium">API</span>
              <code className="flex-1 text-xs bg-white/80 border border-orange-200 rounded px-2 py-1.5 font-mono text-gray-700 truncate">
                {getOpenApiBase()}
              </code>
              <button
                onClick={() => handleCopy(getOpenApiBase(), "api")}
                className="flex-shrink-0 p-1.5 rounded hover:bg-orange-100 text-orange-600 transition-colors"
                title="复制 API 地址"
              >
                {copied === "api" ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              </button>
            </div>
            {/* Quick example */}
            <div className="mt-3 bg-gray-900 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto">
              <div className="text-gray-500"># 读取消息</div>
              <div>curl {getOpenApiBase()}/messages</div>
              <div className="mt-2 text-gray-500"># 发送消息</div>
              <div>curl -X POST {getOpenApiBase()}/messages \</div>
              <div className="pl-4">-H &quot;Content-Type: application/json&quot; \</div>
              <div className="pl-4">-d &apos;{`{"content":"你好","sender_name":"MyBot"}`}&apos;</div>
              <div className="mt-2 text-gray-500"># 发消息 + 召唤 PM Agent</div>
              <div>curl -X POST {getOpenApiBase()}/pm \</div>
              <div className="pl-4">-H &quot;Content-Type: application/json&quot; \</div>
              <div className="pl-4">-d &apos;{`{"content":"分析一下","sender_name":"MyBot"}`}&apos;</div>
            </div>
            <button
              onClick={() => {
                const example = `import requests\n\nBASE = "${getOpenApiBase()}"\n\n# 读取消息\nmsgs = requests.get(f"{BASE}/messages").json()\n\n# 发送消息\nrequests.post(f"{BASE}/messages", json={\n    "content": "你好",\n    "sender_type": "agent",\n    "sender_name": "MyBot"\n})\n\n# 发消息 + 自动召唤 PM Agent\nrequests.post(f"{BASE}/pm", json={\n    "content": "帮我分析一下",\n    "sender_name": "MyBot"\n})`;
                handleCopy(example, "python");
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-orange-200 hover:bg-orange-50 text-orange-700 rounded-lg text-xs font-medium transition-colors"
            >
              {copied === "python" ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
              复制 Python 示例代码
            </button>
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[#FAFAF8]"
      >
        {messages.length === 0 && (
          <div className="text-center py-12 text-[#9B9B9B]">
            <Users size={32} className="mx-auto mb-2 text-[#D4D4D4]" />
            <p className="text-sm">讨论室已创建，发送第一条消息开始圆桌讨论</p>
          </div>
        )}

        {messages.map((msg) => {
          const cfg = SENDER_CONFIG[msg.sender_type] || SENDER_CONFIG.human;

          // System messages: centered
          if (msg.sender_type === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="max-w-[80%] text-center px-4 py-2 text-xs text-gray-500 italic bg-gray-100 rounded-lg whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="flex items-start gap-2.5 group">
              {/* Avatar */}
              {senderIcon(msg.sender_type)}

              <div className="flex-1 min-w-0">
                {/* Sender label + time + reply button */}
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-xs font-medium ${cfg.text}`}>
                    {msg.sender_name || cfg.label || "Unknown"}
                  </span>
                  <span className="text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatTime(msg.created_at)}
                  </span>
                  <button
                    onClick={() => setReplyTo(msg)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-[#354DAA] p-0.5 rounded"
                    title="回复此消息"
                  >
                    <Reply size={12} />
                  </button>
                </div>

                {/* Reply-to context */}
                {msg.reply_to && (
                  <div className="flex items-start gap-1.5 mb-1 max-w-[85%]">
                    <CornerDownRight size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-500 truncate">
                      <span className="font-medium text-gray-600">{msg.reply_to.sender_name}</span>
                      {": "}
                      {msg.reply_to.content}
                    </div>
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={`inline-block max-w-[85%] rounded-2xl rounded-tl-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words border ${cfg.bg} ${cfg.border} text-gray-800`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {/* PM Agent thinking indicator */}
        {waitingForAgent && (
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 bg-purple-100 text-purple-800">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-purple-800">PM Agent</span>
              </div>
              <div className="inline-block rounded-2xl rounded-tl-md px-4 py-3 text-sm border bg-purple-50 border-purple-200">
                <div className="flex items-center gap-2 text-purple-600">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>正在思考...</span>
                  {waitingElapsed > 3 && (
                    <span className="text-xs text-purple-400">已等待 {waitingElapsed}s</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Persistence indicator */}
      <div className="px-4 py-1 bg-[#FAFAF8] border-t border-gray-100">
        <p className="text-[10px] text-[#C4C4C4] text-center">
          所有讨论内容已持久化保存
        </p>
      </div>

      {/* Reply preview bar */}
      {replyTo && (
        <div className="flex-shrink-0 bg-gray-50 border-t border-gray-200 px-4 py-2 flex items-center gap-2">
          <Reply size={14} className="text-[#354DAA] flex-shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-gray-600 truncate">
            回复 <span className="font-medium text-gray-800">{replyTo.sender_name}</span>
            {": "}
            <span className="text-gray-500">{replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? "..." : ""}</span>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 p-0.5 rounded"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3 rounded-b-xl">
        <div className="flex items-end gap-2">
          {/* @PM Agent quick button */}
          <button
            onClick={insertAtMention}
            className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-medium transition-colors border border-purple-200"
            title="插入 @PM Agent"
          >
            <Bot size={14} />
            @PM Agent
          </button>

          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#354DAA] focus:border-transparent max-h-32"
            style={{ minHeight: "42px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 128) + "px";
            }}
          />

          <button
            onClick={handleSend}
            disabled={sending || !inputValue.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#354DAA] text-white rounded-xl text-sm font-medium hover:bg-[#2a3f8f] transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {sending ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Send size={16} />
            )}
            {sending ? "发送中" : "发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
