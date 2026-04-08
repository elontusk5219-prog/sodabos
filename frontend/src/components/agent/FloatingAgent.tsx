"use client";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, X, Minus, Send, MessageSquare, Plus, ArrowLeft, Loader2 } from "lucide-react";
import { api, streamChat } from "@/lib/api";
import { useAgentDrawer } from "@/contexts/AgentDrawerContext";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  session_id: number;
  title: string;
  updated_at: string;
  message_count: number;
}

type AgentPhase = "idle" | "sending" | "thinking" | "tool_call" | "generating" | "error";

const QUICK_ACTIONS = [
  { label: "本周总结", prompt: "帮我总结本周所有项目的关键数据变化和重要事项" },
  { label: "数据异常", prompt: "检查所有已部署项目是否有数据异常或需要关注的指标" },
  { label: "下步建议", prompt: "基于当前项目进展，给出下一步行动建议" },
  { label: "竞品动态", prompt: "最近有什么值得关注的竞品动态或行业趋势" },
];

function toolLabel(tool: string): string {
  const map: Record<string, string> = {
    query_demands: "查询需求池",
    search_knowledge: "搜索知识库",
    get_project_status: "获取项目状态",
    list_projects: "查看项目列表",
    get_demand_detail: "查看需求详情",
    recent_activity: "查看最近活动",
  };
  return map[tool] || `调用 ${tool}`;
}

function PhaseIndicator({ phase, tool }: { phase: AgentPhase; tool: string }) {
  if (phase === "idle" || phase === "error") return null;

  const labels: Record<string, string> = {
    sending: "发送中...",
    thinking: "思考中...",
    tool_call: `正在${toolLabel(tool)}...`,
    generating: "正在回复...",
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-gray-500">
      <span className="flex gap-0.5">
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
      <span>{labels[phase] || "处理中..."}</span>
    </div>
  );
}

export default function FloatingAgent() {
  const pathname = usePathname();
  const { open, contextMessage, openDrawer, closeDrawer, toggleDrawer } = useAgentDrawer();
  const [minimized, setMinimized] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [activeTool, setActiveTool] = useState<string>("");
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hidden = pathname.startsWith("/agent") || pathname === "/login";

  useEffect(() => {
    if (contextMessage && open) {
      setInput(contextMessage);
    }
  }, [contextMessage, open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open, minimized]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await api.agentChatHistory();
      setSessions(data || []);
    } catch {
      /* ignore */
    }
    setSessionsLoading(false);
  }, []);

  const loadSession = useCallback(async (sid: number) => {
    try {
      const data = await api.agentChatSession(sid);
      if (data?.messages) {
        setMessages(
          data.messages.map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      }
      setSessionId(sid);
      setShowSessions(false);
    } catch {
      /* ignore */
    }
  }, []);

  const sendMessage = useCallback(
    (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || phase !== "idle") return;

      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: msg }]);
      setPhase("sending");
      setStreamingContent("");

      // Add placeholder for assistant response
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      abortRef.current = streamChat(
        "/agent/chat/stream",
        { message: msg, session_id: sessionId },
        {
          onStatus: (p, tool) => {
            if (p === "thinking") setPhase("thinking");
            else if (p === "tool_call") {
              setPhase("tool_call");
              setActiveTool(tool || "");
            } else if (p === "tool_result") {
              // Could show brief tool result
            }
          },
          onContent: (text) => {
            setPhase("generating");
            setStreamingContent((prev) => prev + text);
            // Update the last message (assistant placeholder)
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                updated[updated.length - 1] = { ...last, content: last.content + text };
              }
              return updated;
            });
          },
          onDone: (data) => {
            if (data.session_id && !sessionId) {
              setSessionId(data.session_id);
            }
            setPhase("idle");
            setStreamingContent("");
            setActiveTool("");
          },
          onError: (message) => {
            setPhase("idle");
            setActiveTool("");
            setStreamingContent("");
            setMessages((prev) => {
              // Replace empty assistant message with error
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant" && !last.content) {
                updated[updated.length - 1] = { ...last, content: `\u26A0\uFE0F ${message}` };
              } else {
                updated.push({ role: "assistant", content: `\u26A0\uFE0F ${message}` });
              }
              return updated;
            });
          },
        }
      );
    },
    [input, phase, sessionId]
  );

  const startNewSession = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setShowSessions(false);
    setPhase("idle");
    setActiveTool("");
    setStreamingContent("");
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (hidden) return null;

  if (!open || minimized) {
    return (
      <button
        onClick={() => {
          if (minimized) {
            setMinimized(false);
            openDrawer();
          } else {
            toggleDrawer();
          }
        }}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-lg bg-[#354DAA] text-white flex items-center justify-center shadow-md hover:shadow-lg hover:bg-[#2A3F8E] transition-all duration-150 z-50"
        title="PM Agent"
      >
        <Bot size={20} />
      </button>
    );
  }

  return (
    <div
      className="fixed top-0 right-0 h-full w-[380px] bg-white border-l border-[#E8E5E0] shadow-xl z-50 flex flex-col"
      style={{ animation: "slideInRight 200ms ease-out" }}
    >
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E5E0] bg-[#FAFAF8]">
        <div className="flex items-center gap-2">
          {showSessions && (
            <button
              onClick={() => setShowSessions(false)}
              className="p-1 rounded hover:bg-[#F5F3EF] text-[#6B6B6B] transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <Bot size={18} className="text-[#354DAA]" />
          <span className="font-semibold text-[#1A1A1A] text-sm">PM Agent</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              loadSessions();
              setShowSessions(!showSessions);
            }}
            className="p-1.5 rounded hover:bg-[#F5F3EF] text-[#6B6B6B] transition-colors"
            title="会话历史"
          >
            <MessageSquare size={15} />
          </button>
          <button
            onClick={startNewSession}
            className="p-1.5 rounded hover:bg-[#F5F3EF] text-[#6B6B6B] transition-colors"
            title="新会话"
          >
            <Plus size={15} />
          </button>
          <button
            onClick={() => setMinimized(true)}
            className="p-1.5 rounded hover:bg-[#F5F3EF] text-[#6B6B6B] transition-colors"
            title="最小化"
          >
            <Minus size={15} />
          </button>
          <button
            onClick={closeDrawer}
            className="p-1.5 rounded hover:bg-[#F5F3EF] text-[#6B6B6B] transition-colors"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Sessions panel */}
      {showSessions ? (
        <div className="flex-1 overflow-auto p-3">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-[#9B9B9B]" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-sm text-[#9B9B9B]">暂无会话记录</div>
          ) : (
            <div className="space-y-1">
              {sessions.map((s) => (
                <button
                  key={s.session_id}
                  onClick={() => loadSession(s.session_id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                    sessionId === s.session_id
                      ? "bg-[#EEF1FB] text-[#354DAA]"
                      : "hover:bg-[#F5F3EF] text-[#1A1A1A]"
                  }`}
                >
                  <div className="truncate font-medium">{s.title || "未命名会话"}</div>
                  <div className="text-xs text-[#9B9B9B] mt-0.5">
                    {s.message_count} 条消息 · {s.updated_at?.slice(0, 10)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Messages area */}
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#EEF1FB] flex items-center justify-center">
                  <Bot size={20} className="text-[#354DAA]" />
                </div>
                <p className="text-sm text-[#9B9B9B] text-center">
                  你好，我是 PM Agent。
                  <br />
                  可以帮你分析项目数据、提供建议。
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendMessage(action.prompt)}
                      disabled={phase !== "idle"}
                      className="px-3 py-1.5 rounded-full text-xs border border-[#E8E5E0] text-[#6B6B6B] hover:bg-[#F5F3EF] hover:border-[#354DAA] hover:text-[#354DAA] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[85%]">
                      <div
                        className={`rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                          msg.role === "user"
                            ? "bg-[#354DAA] text-white"
                            : "bg-[#F5F3EF] text-[#1A1A1A]"
                        }`}
                      >
                        {msg.content || (
                          phase !== "idle" && i === messages.length - 1 ? null : ""
                        )}
                      </div>
                      {/* Retry button for error messages */}
                      {msg.role === "assistant" && msg.content.startsWith("\u26A0\uFE0F") && (
                        <button
                          onClick={() => {
                            // Remove this error message and the user message before it
                            const userMsg = messages[i - 1];
                            setMessages((prev) => prev.slice(0, i - 1));
                            // Retry with the user's original message
                            if (userMsg?.role === "user") {
                              // Use setTimeout to allow state to settle before re-sending
                              setTimeout(() => sendMessage(userMsg.content), 50);
                            }
                          }}
                          className="text-xs text-blue-500 hover:text-blue-700 mt-1"
                        >
                          重试
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <PhaseIndicator phase={phase} tool={activeTool} />
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-[#E8E5E0] p-3 bg-[#FAFAF8]">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                rows={1}
                className="flex-1 resize-none rounded-lg border border-[#E8E5E0] bg-white px-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#9B9B9B] focus:outline-none focus:border-[#354DAA] transition-colors"
                style={{ maxHeight: 100 }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 100) + "px";
                }}
              />
              {phase !== "idle" ? (
                <button
                  onClick={() => {
                    abortRef.current?.abort();
                    setPhase("idle");
                    setActiveTool("");
                    setStreamingContent("");
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2 flex-shrink-0"
                >
                  取消
                </button>
              ) : (
                <button
                  onClick={() => sendMessage()}
                  disabled={phase !== "idle" || !input.trim()}
                  className="p-2 rounded-lg bg-[#354DAA] text-white disabled:opacity-40 hover:bg-[#2A3F8E] transition-colors flex-shrink-0"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
