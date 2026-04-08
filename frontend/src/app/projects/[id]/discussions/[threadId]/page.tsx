"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, streamChat } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/components/auth/AuthProvider";
import { DiscussionThread, DiscussionMessage } from "@/lib/types";

export default function DiscussionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const projectId = Number(params.id);
  const threadId = Number(params.threadId);

  const {
    data: thread,
    loading: threadLoading,
  } = useApi<DiscussionThread>(
    () => api.discussion(projectId, threadId),
    [projectId, threadId]
  );

  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPhase, setAiPhase] = useState<"idle" | "thinking" | "tool_call" | "generating">("idle");
  const [streamingReply, setStreamingReply] = useState("");
  const [sendError, setSendError] = useState("");
  const aiAbortRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const result = await api.discussion(projectId, threadId);
      if (result?.messages) {
        setMessages(result.messages);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setMessagesLoading(false);
    }
  }, [projectId, threadId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Scroll to bottom
  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    if (isToday) {
      return d.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return d.toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function handleSend() {
    if (!inputValue.trim() || sending) return;
    const content = inputValue.trim();
    setInputValue("");
    setSending(true);
    setSendError("");

    try {
      const result = await api.postMessage(projectId, threadId, content);
      if (result) {
        // Optimistic: add the message directly, or refetch
        await fetchMessages();
      }
    } catch (err: any) {
      console.error("Failed to send message:", err);
      // Restore input on error
      setInputValue(content);
      setSendError(err?.message || "发送失败");
    } finally {
      setSending(false);
    }
  }

  function handleSendWithAI() {
    if (!inputValue.trim() || sending || aiLoading) return;
    const content = inputValue.trim();
    setInputValue("");
    setSending(true);
    setAiLoading(true);
    setAiPhase("thinking");
    setStreamingReply("");
    setSendError("");

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        thread_id: threadId,
        role: "user",
        content,
        metadata: "",
        username: user?.username || "用户",
        display_name: user?.display_name || user?.username || "用户",
        created_at: new Date().toISOString(),
      },
    ]);

    // Add placeholder AI message
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + 1,
        thread_id: threadId,
        role: "assistant",
        content: "",
        metadata: "",
        username: "ai",
        display_name: "AI 助手",
        created_at: new Date().toISOString(),
      },
    ]);

    aiAbortRef.current = streamChat(
      `/projects/${projectId}/discussions/${threadId}/ai/stream`,
      { content },
      {
        onStatus: (p) => {
          if (p === "thinking") setAiPhase("thinking");
          else if (p === "tool_call") setAiPhase("tool_call");
        },
        onContent: (text) => {
          setAiPhase("generating");
          setStreamingReply((prev) => prev + text);
          // Update the AI placeholder message
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && (last.role === "assistant" || last.role === "ai")) {
              updated[updated.length - 1] = { ...last, content: last.content + text };
            }
            return updated;
          });
        },
        onDone: () => {
          // Refetch to get the persisted version
          fetchMessages();
          setSending(false);
          setAiLoading(false);
          setAiPhase("idle");
          setStreamingReply("");
        },
        onError: (message) => {
          setSending(false);
          setAiLoading(false);
          setAiPhase("idle");
          setStreamingReply("");
          setSendError(message || "AI 回复失败");
          // Remove the empty AI placeholder on error
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && (last.role === "assistant" || last.role === "ai") && !last.content) {
              return updated.slice(0, -1);
            }
            return updated;
          });
        },
      }
    );
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      handleSendWithAI();
    }
  }

  const loading = threadLoading || messagesLoading;

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">
          <svg
            className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p>加载讨论...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-4xl mx-auto">
      {/* Thread Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={() => router.push(`/projects/${projectId}/discussions`)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {thread?.title ?? "讨论"}
          </h1>
          {thread && (
            <p className="text-xs text-gray-400">
              {messages.length} 条消息
            </p>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50"
      >
        {messages.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">还没有消息，发送第一条消息开始讨论</p>
          </div>
        )}

        {messages.map((msg) => {
          const isAI = msg.role === "assistant" || msg.role === "ai";
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] ${
                  isUser ? "order-1" : "order-1"
                }`}
              >
                {/* Sender label */}
                <div
                  className={`text-xs mb-1 ${
                    isUser ? "text-right text-gray-400" : "text-left text-gray-400"
                  }`}
                >
                  {isAI ? (
                    <span className="inline-flex items-center gap-1">
                      <svg
                        className="w-3 h-3 text-green-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      AI 助手
                    </span>
                  ) : (
                    <span>
                      {msg.display_name || msg.username || "用户"}
                    </span>
                  )}
                  <span className="ml-2">{formatTime(msg.created_at)}</span>
                </div>

                {/* Message bubble */}
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    isAI
                      ? "bg-white border border-gray-200 text-gray-800 rounded-tl-md"
                      : "bg-blue-600 text-white rounded-tr-md"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {/* AI phase indicator */}
        {aiLoading && aiPhase !== "generating" && (
          <div className="flex justify-start">
            <div className="max-w-[75%]">
              <div className="text-xs mb-1 text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <svg
                    className="w-3 h-3 text-green-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  AI 助手
                </span>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-md px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                  <span className="text-xs text-gray-400">
                    {aiPhase === "thinking" ? "思考中..." : aiPhase === "tool_call" ? "调用工具..." : "处理中..."}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Send Error */}
      {sendError && (
        <div className="flex-shrink-0 bg-red-50 border-t border-red-200 px-4 py-2 text-sm text-red-600 flex items-center justify-between">
          <span>{sendError}</span>
          <button onClick={() => setSendError("")} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Input Area */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行, Cmd+Enter AI 回复)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent max-h-32"
            style={{ minHeight: "42px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height =
                Math.min(target.scrollHeight, 128) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !inputValue.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
            发送
          </button>
          <button
            onClick={handleSendWithAI}
            disabled={sending || aiLoading || !inputValue.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {aiLoading ? (
              <svg
                className="animate-spin h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            )}
            发送并获取AI回复
          </button>
          {aiLoading && (
            <button
              onClick={() => {
                aiAbortRef.current?.abort();
                setSending(false);
                setAiLoading(false);
                setAiPhase("idle");
                setStreamingReply("");
              }}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2.5 flex-shrink-0"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
