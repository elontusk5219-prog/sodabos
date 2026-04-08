"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { RoundtableRoom, Project } from "@/lib/types";
import { MessageCircle, Plus, X, Clock, LinkIcon } from "lucide-react";

const SENDER_STYLE: Record<string, { emoji: string; color: string; bg: string }> = {
  human: { emoji: "\u{1F464}", color: "text-blue-700", bg: "bg-blue-100" },
  claude_code: { emoji: "\u{1F5A5}\uFE0F", color: "text-green-700", bg: "bg-green-100" },
  pm_agent: { emoji: "\u{1F916}", color: "text-purple-700", bg: "bg-purple-100" },
};

function participantBadges(participants?: string) {
  if (!participants) return null;
  const types = participants.split(",").map((s) => s.trim()).filter(Boolean);
  const unique = Array.from(new Set(types));
  return (
    <div className="flex items-center gap-1">
      {unique.map((t) => {
        const s = SENDER_STYLE[t] || SENDER_STYLE.human;
        return (
          <span
            key={t}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${s.bg} ${s.color}`}
          >
            {s.emoji}
          </span>
        );
      })}
    </div>
  );
}

function formatRelative(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return d.toLocaleDateString("zh-CN");
}

export default function RoundtableListPage() {
  const router = useRouter();
  const { data: rooms, loading, reload } = useApi<RoundtableRoom[]>(
    () => api.roundtableRooms(),
    []
  );

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState<number | undefined>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (showCreate) {
      api.projects().then((res: Project[] | { projects: Project[] }) => {
        const list = Array.isArray(res) ? res : (res as { projects: Project[] }).projects ?? [];
        setProjects(list);
      }).catch(() => {});
    }
  }, [showCreate]);

  async function handleCreate() {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      await api.createRoundtableRoom({
        title: title.trim(),
        topic: topic.trim() || undefined,
        project_id: projectId,
      });
      setTitle("");
      setTopic("");
      setProjectId(undefined);
      setShowCreate(false);
      reload();
    } catch (err) {
      console.error("Failed to create room:", err);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#1A1A1A]">圆桌讨论</h1>
          <p className="text-sm text-[#9B9B9B] mt-1">
            人机协作讨论室 — 人类、Claude Code、PM Agent 共同参与
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#354DAA] text-white rounded-lg text-sm font-medium hover:bg-[#2a3f8f] transition-colors"
        >
          <Plus size={16} />
          新建讨论室
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1A1A1A]">新建讨论室</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: Q2 产品方向讨论"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#354DAA] focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">讨论主题</label>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="描述这次讨论的目标和背景..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#354DAA] focus:border-transparent resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">关联项目 (可选)</label>
                <select
                  value={projectId ?? ""}
                  onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#354DAA] focus:border-transparent"
                >
                  <option value="">不关联项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!title.trim() || creating}
                  className="px-4 py-2 bg-[#354DAA] text-white rounded-lg text-sm font-medium hover:bg-[#2a3f8f] transition-colors disabled:opacity-50"
                >
                  {creating ? "创建中..." : "创建"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-2 text-[#9B9B9B]">
            <svg className="animate-spin h-8 w-8 text-[#354DAA]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">加载中...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && (!rooms || rooms.length === 0) && (
        <div className="text-center py-20">
          <MessageCircle size={48} className="mx-auto text-[#D4D4D4] mb-4" />
          <p className="text-[#9B9B9B] text-sm">还没有讨论室</p>
          <p className="text-[#9B9B9B] text-xs mt-1">点击「新建讨论室」开始一场圆桌讨论</p>
        </div>
      )}

      {/* Room grid */}
      {!loading && rooms && rooms.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => router.push(`/roundtable/${room.id}`)}
              className="text-left bg-white border border-gray-200 rounded-xl p-5 hover:shadow-md hover:border-[#354DAA]/30 transition-all duration-150 group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#1A1A1A] group-hover:text-[#354DAA] transition-colors line-clamp-1">
                  {room.title}
                </h3>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {room.topic === "由 PM Agent 对话自动创建" && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                      🤖 对话
                    </span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    room.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  }`}>
                    {room.status === "active" ? "进行中" : room.status}
                  </span>
                </div>
              </div>

              {room.topic && (
                <p className="text-xs text-[#6B6B6B] mb-3 line-clamp-2">{room.topic}</p>
              )}

              <div className="flex items-center gap-3 text-xs text-[#9B9B9B]">
                <span className="inline-flex items-center gap-1">
                  <MessageCircle size={12} />
                  {room.message_count ?? 0}
                </span>
                {participantBadges(room.participants)}
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 text-xs text-[#9B9B9B]">
                {room.project_title ? (
                  <span className="inline-flex items-center gap-1 text-[#354DAA]">
                    <LinkIcon size={10} />
                    {room.project_title}
                  </span>
                ) : (
                  <span />
                )}
                <span className="inline-flex items-center gap-1">
                  <Clock size={10} />
                  {formatRelative(room.last_message_at || room.updated_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
