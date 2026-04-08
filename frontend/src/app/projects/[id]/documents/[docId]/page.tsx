"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/components/auth/AuthProvider";
import { ProjectDocument } from "@/lib/types";

// ── Simple Markdown Renderer ──────────────────────────────────────────────

function renderMarkdown(md: string): string {
  if (!md) return "";

  let html = md;

  // Code blocks (``` ... ```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) =>
      `<pre class="bg-gray-900 text-green-300 rounded-lg p-4 my-3 overflow-x-auto text-sm font-mono"><code>${escapeHtml(code.trim())}</code></pre>`
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>'
  );

  // Headers
  html = html.replace(
    /^#### (.+)$/gm,
    '<h4 class="text-base font-semibold text-gray-800 mt-4 mb-2">$1</h4>'
  );
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 class="text-lg font-semibold text-gray-800 mt-5 mb-2">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 class="text-xl font-bold text-gray-900 mt-6 mb-3">$1</h2>'
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-3">$1</h1>'
  );

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Horizontal rules
  html = html.replace(
    /^---+$/gm,
    '<hr class="my-4 border-gray-200" />'
  );

  // Unordered list items (- or *)
  html = html.replace(
    /^[\t ]*[-*] (.+)$/gm,
    '<li class="ml-4 list-disc text-gray-700">$1</li>'
  );

  // Ordered list items
  html = html.replace(
    /^[\t ]*\d+\. (.+)$/gm,
    '<li class="ml-4 list-decimal text-gray-700">$1</li>'
  );

  // Wrap consecutive <li> elements in <ul>/<ol>
  html = html.replace(
    /((?:<li class="ml-4 list-disc[^>]*>.*?<\/li>\n?)+)/g,
    '<ul class="my-2 space-y-1">$1</ul>'
  );
  html = html.replace(
    /((?:<li class="ml-4 list-decimal[^>]*>.*?<\/li>\n?)+)/g,
    '<ol class="my-2 space-y-1">$1</ol>'
  );

  // Blockquotes
  html = html.replace(
    /^> (.+)$/gm,
    '<blockquote class="border-l-4 border-blue-300 pl-4 my-2 text-gray-600 italic">$1</blockquote>'
  );

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Paragraphs: wrap remaining lines that aren't already HTML
  const lines = html.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<ul") ||
      trimmed.startsWith("<ol") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("</")
    ) {
      result.push(line);
    } else {
      result.push(`<p class="text-gray-700 my-1.5 leading-relaxed">${trimmed}</p>`);
    }
  }

  return result.join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Status / Badge Styles ─────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  review: "评审中",
  approved: "已通过",
};

const GENERATED_BY_STYLES: Record<string, string> = {
  ai: "bg-purple-100 text-purple-700",
  manual: "bg-blue-100 text-blue-700",
  skill_import: "bg-orange-100 text-orange-700",
};

const GENERATED_BY_LABELS: Record<string, string> = {
  ai: "AI 生成",
  manual: "手动创建",
  skill_import: "技能导入",
};

// ── Main Component ────────────────────────────────────────────────────────

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const projectId = Number(params.id);
  const docId = Number(params.docId);

  const {
    data: doc,
    loading,
    reload,
  } = useApi<ProjectDocument>(
    () => api.projectDocument(projectId, docId),
    [projectId, docId]
  );

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [actionError, setActionError] = useState("");

  // Sync edit buffers when doc loads
  const initEditState = useCallback(
    (document: ProjectDocument) => {
      setEditContent(document.content);
      setEditTitle(document.title);
    },
    []
  );

  // When doc first loads, init
  useMemo(() => {
    if (doc) initEditState(doc);
  }, [doc, initEditState]);

  const renderedContent = useMemo(() => {
    if (!doc) return "";
    return renderMarkdown(editing ? editContent : doc.content);
  }, [doc, editing, editContent]);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function handleSave() {
    if (!doc) return;
    setSaving(true);
    try {
      await api.updateDocument(projectId, docId, {
        content: editContent,
        title: editTitle,
      });
      setEditing(false);
      await reload();
    } catch (err: any) {
      console.error("Failed to save document:", err);
      setActionError(err?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!doc) return;
    try {
      await api.updateDocument(projectId, docId, { status: newStatus });
      await reload();
    } catch (err: any) {
      console.error("Failed to update status:", err);
      setActionError(err?.message || "状态更新失败");
    }
  }

  async function handleDelete() {
    try {
      await api.deleteDocument(projectId, docId);
      router.push(`/projects/${projectId}/documents`);
    } catch (err: any) {
      console.error("Failed to delete document:", err);
      setActionError(err?.message || "删除失败");
    }
  }

  async function handleStartDiscussion() {
    if (!doc) return;
    try {
      const result = await api.createDiscussion(projectId, {
        title: `讨论: ${doc.title}`,
        document_id: docId,
        thread_type: "document",
      });
      if (result?.id) {
        router.push(`/projects/${projectId}/discussions/${result.id}`);
      }
    } catch (err: any) {
      console.error("Failed to create discussion:", err);
      setActionError(err?.message || "创建讨论失败");
    }
  }

  function handleExportMarkdown() {
    if (!doc) return;
    const blob = new Blob([doc.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleTitleSave() {
    setEditingTitle(false);
    // Title will be saved with the next content save, or save immediately
    if (!editing && doc && editTitle !== doc.title) {
      api
        .updateDocument(projectId, docId, { title: editTitle })
        .then(() => reload())
        .catch((err: any) => {
          console.error("Failed to save title:", err);
          setActionError(err?.message || "标题保存失败");
        });
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
          <p>加载文档...</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center">
        <p className="text-gray-500">文档不存在或已被删除</p>
        <button
          onClick={() => router.push(`/projects/${projectId}/documents`)}
          className="mt-4 text-blue-600 hover:underline text-sm"
        >
          返回文档列表
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Navigation */}
      <button
        onClick={() => router.push(`/projects/${projectId}/documents`)}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-flex items-center gap-1"
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
            d="M15 19l-7-7 7-7"
          />
        </svg>
        返回文档列表
      </button>

      {/* Action Error */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 flex items-center justify-between mb-4">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        {/* Title */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            {editingTitle ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => e.key === "Enter" && handleTitleSave()}
                autoFocus
                className="text-2xl font-bold text-gray-900 w-full border-b-2 border-blue-500 outline-none pb-1 bg-transparent"
              />
            ) : (
              <h1
                className="text-2xl font-bold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={() => {
                  setEditingTitle(true);
                  setEditTitle(doc.title);
                }}
                title="点击编辑标题"
              >
                {doc.title}
              </h1>
            )}
          </div>
        </div>

        {/* Badges & Status Actions */}
        <div className="flex items-center flex-wrap gap-2 mb-4">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${
              STATUS_STYLES[doc.status] ?? STATUS_STYLES.draft
            }`}
          >
            {STATUS_LABELS[doc.status] ?? doc.status}
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium ${
              GENERATED_BY_STYLES[doc.generated_by] ??
              GENERATED_BY_STYLES.manual
            }`}
          >
            {GENERATED_BY_LABELS[doc.generated_by] ?? doc.generated_by}
          </span>

          <div className="flex-1" />

          {doc.status !== "approved" && (
            <button
              onClick={() => handleStatusChange("approved")}
              className="text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-md font-medium transition-colors"
            >
              标记为已通过
            </button>
          )}
          {doc.status !== "review" && (
            <button
              onClick={() => handleStatusChange("review")}
              className="text-xs px-3 py-1.5 bg-yellow-50 text-yellow-700 hover:bg-yellow-100 rounded-md font-medium transition-colors"
            >
              标记为评审中
            </button>
          )}
          {doc.status !== "draft" && (
            <button
              onClick={() => handleStatusChange("draft")}
              className="text-xs px-3 py-1.5 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-md font-medium transition-colors"
            >
              标记为草稿
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-xs text-gray-400">
          <span>版本 v{doc.version}</span>
          <span>创建于 {formatDate(doc.created_at)}</span>
          <span>更新于 {formatDate(doc.updated_at)}</span>
          {doc.creator_name && <span>创建者: {doc.creator_name}</span>}
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => {
            if (editing) {
              // Cancel edit
              setEditing(false);
              setEditContent(doc.content);
            } else {
              setEditing(true);
              setEditContent(doc.content);
            }
          }}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            editing
              ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
              : "bg-blue-50 text-blue-700 hover:bg-blue-100"
          }`}
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
              d={
                editing
                  ? "M6 18L18 6M6 6l12 12"
                  : "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              }
            />
          </svg>
          {editing ? "取消编辑" : "编辑"}
        </button>

        {editing && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
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
                保存中...
              </>
            ) : (
              "保存"
            )}
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={handleStartDiscussion}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          开启讨论
        </button>

        <button
          onClick={handleExportMarkdown}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
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
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          导出 Markdown
        </button>

        <div className="relative">
          <button
            onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            删除
          </button>

          {showDeleteConfirm && (
            <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-10 w-64">
              <p className="text-sm text-gray-700 mb-3">
                确定要删除此文档吗？此操作不可撤销。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 text-xs bg-red-600 text-white hover:bg-red-700 rounded-md"
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full min-h-[500px] p-6 font-mono text-sm text-gray-800 border-none outline-none resize-y bg-gray-50"
            placeholder="输入 Markdown 内容..."
          />
        ) : (
          <div
            className="prose max-w-none p-6"
            dangerouslySetInnerHTML={{ __html: renderedContent }}
          />
        )}
      </div>
    </div>
  );
}
