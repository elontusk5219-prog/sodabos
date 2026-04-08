"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/components/auth/AuthProvider";
import { DiscussionThread } from "@/lib/types";

const TYPE_STYLES: Record<string, string> = {
  general: "bg-blue-100 text-blue-700",
  document: "bg-purple-100 text-purple-700",
  gate_review: "bg-amber-100 text-amber-700",
  ai_session: "bg-green-100 text-green-700",
};

const TYPE_LABELS: Record<string, string> = {
  general: "综合讨论",
  document: "文档讨论",
  gate_review: "阶段评审",
  ai_session: "AI 会话",
};

export default function DiscussionsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const projectId = Number(params.id);

  const {
    data: threads,
    loading,
    reload,
  } = useApi<DiscussionThread[]>(() => api.discussions(projectId), [projectId]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    });
  }

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const result = await api.createDiscussion(projectId, {
        title: newTitle.trim(),
        thread_type: "general",
      });
      setShowCreateModal(false);
      setNewTitle("");
      if (result?.id) {
        router.push(`/projects/${projectId}/discussions/${result.id}`);
      } else {
        await reload();
      }
    } catch (err) {
      console.error("Failed to create discussion:", err);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
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

  const list = threads ?? [];

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目讨论</h1>
          <p className="text-sm text-gray-500 mt-1">
            共 {list.length} 个讨论
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; 返回项目
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            新建讨论
          </button>
        </div>
      </div>

      {/* Empty State */}
      {list.length === 0 && (
        <div className="text-center py-16">
          <svg
            className="mx-auto h-12 w-12 text-gray-300 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-lg font-medium text-gray-500">开始第一个讨论</p>
          <p className="text-sm text-gray-400 mt-1">
            与团队成员或 AI 助手展开讨论
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            新建讨论
          </button>
        </div>
      )}

      {/* Thread List */}
      <div className="space-y-3">
        {list.map((thread) => (
          <div
            key={thread.id}
            onClick={() =>
              router.push(`/projects/${projectId}/discussions/${thread.id}`)
            }
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-blue-300 cursor-pointer transition-all group"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium text-gray-900 group-hover:text-blue-600 truncate">
                    {thread.title}
                  </h3>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                      TYPE_STYLES[thread.thread_type] ?? TYPE_STYLES.general
                    }`}
                  >
                    {TYPE_LABELS[thread.thread_type] ?? thread.thread_type}
                  </span>
                </div>

                {thread.last_message && (
                  <p className="text-sm text-gray-500 truncate mt-1">
                    {thread.last_message}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                  {thread.creator_name && (
                    <span className="flex items-center gap-1">
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                      {thread.creator_name}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                      />
                    </svg>
                    {thread.message_count ?? 0} 条消息
                  </span>
                  <span>{formatDate(thread.updated_at)}</span>
                </div>
              </div>

              <svg
                className="w-5 h-5 text-gray-300 group-hover:text-blue-400 flex-shrink-0 ml-3 mt-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              新建讨论
            </h2>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="输入讨论标题..."
              autoFocus
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewTitle("");
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
