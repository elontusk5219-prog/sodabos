"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  PROJECT_STAGES,
  ProjectDocument,
  StageDeliverable,
} from "@/lib/types";

interface StageProgress {
  stage: string;
  label: string;
  deliverables: StageDeliverable[];
  completed: number;
  total: number;
}

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

export default function DocumentsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const projectId = Number(params.id);

  const {
    data: progressData,
    loading: progressLoading,
  } = useApi<Record<string, StageDeliverable[]>>(
    () => api.projectProgress(projectId),
    [projectId],
  );

  const {
    data: documentsData,
    loading: docsLoading,
    reload: reloadDocs,
  } = useApi<{ documents: ProjectDocument[] } | ProjectDocument[]>(
    () => api.projectDocuments(projectId),
    [projectId],
  );

  const [generating, setGenerating] = useState<string | null>(null);

  const loading = progressLoading || docsLoading;

  // Backend progress returns stages as top-level keys: {discover: [...], value_filter: [...], ...}
  const stagesMap = progressData ?? {};
  const stages: StageProgress[] = PROJECT_STAGES.map((s) => {
    const deliverables: StageDeliverable[] =
      (stagesMap as Record<string, StageDeliverable[]>)?.[s.key] ?? [];
    const completed = deliverables.filter((d) => d.completed).length;
    return {
      stage: s.key,
      label: s.label,
      deliverables,
      completed,
      total: deliverables.length,
    };
  }).filter((s) => s.total > 0);

  // Backend returns {documents: [...]} wrapped format
  const docs: ProjectDocument[] = Array.isArray(documentsData)
    ? documentsData
    : (documentsData as { documents: ProjectDocument[] })?.documents ?? [];

  // Build a map from doc_type -> document for quick lookup
  const docsByType: Record<string, ProjectDocument> = {};
  for (const doc of docs) {
    docsByType[doc.doc_type] = doc;
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function handleGenerate(deliverable: StageDeliverable) {
    setGenerating(deliverable.doc_type);
    try {
      await api.generateDocument(projectId, {
        doc_type: deliverable.doc_type,
      });
      await reloadDocs();
    } catch (err) {
      console.error("Failed to generate document:", err);
    } finally {
      setGenerating(null);
    }
  }

  function handleCreateManual(deliverable: StageDeliverable) {
    router.push(
      `/projects/${projectId}/documents?create=${deliverable.doc_type}&stage=${deliverable.stage}&title=${encodeURIComponent(deliverable.title)}`
    );
  }

  async function handleCreateEmpty(deliverable: StageDeliverable) {
    try {
      const result = await api.createDocument(projectId, {
        doc_type: deliverable.doc_type,
        title: deliverable.title,
        content: `# ${deliverable.title}\n\n请在此编辑内容...`,
        stage: deliverable.stage,
      });
      if (result?.id) {
        router.push(`/projects/${projectId}/documents/${result.id}`);
      }
      reloadDocs();
    } catch (err) {
      console.error("Failed to create document:", err);
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

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目文档</h1>
          <p className="text-sm text-gray-500 mt-1">
            共 {docs.length} 个文档
          </p>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; 返回项目
        </button>
      </div>

      {stages.length === 0 && docs.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <svg
            className="mx-auto h-12 w-12 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-lg font-medium">暂无文档</p>
          <p className="text-sm mt-1">项目阶段交付物将在此展示</p>
        </div>
      )}

      <div className="space-y-8">
        {stages.map((stage) => (
          <section key={stage.stage}>
            {/* Stage header */}
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                {stage.label}
              </h2>
              <span className="text-xs text-gray-400">
                {stage.completed}/{stage.total} 已完成
              </span>
              <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{
                    width:
                      stage.total > 0
                        ? `${(stage.completed / stage.total) * 100}%`
                        : "0%",
                  }}
                />
              </div>
            </div>

            {/* Deliverable cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stage.deliverables.map((deliverable) => {
                const doc = docsByType[deliverable.doc_type];
                const isGenerating = generating === deliverable.doc_type;

                if (doc) {
                  // Document exists - show document card
                  return (
                    <div
                      key={deliverable.id}
                      onClick={() =>
                        router.push(
                          `/projects/${projectId}/documents/${doc.id}`
                        )
                      }
                      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md hover:border-blue-300 cursor-pointer transition-all group"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-medium text-gray-900 group-hover:text-blue-600 line-clamp-2">
                          {doc.title}
                        </h3>
                        <svg
                          className="w-4 h-4 text-gray-300 group-hover:text-blue-400 flex-shrink-0 ml-2"
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

                      <div className="flex items-center gap-2 mt-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            STATUS_STYLES[doc.status] ?? STATUS_STYLES.draft
                          }`}
                        >
                          {STATUS_LABELS[doc.status] ?? doc.status}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            GENERATED_BY_STYLES[doc.generated_by] ??
                            GENERATED_BY_STYLES.manual
                          }`}
                        >
                          {GENERATED_BY_LABELS[doc.generated_by] ??
                            doc.generated_by}
                        </span>
                      </div>

                      <p className="text-xs text-gray-400 mt-3">
                        更新于 {formatDate(doc.updated_at)}
                      </p>
                    </div>
                  );
                }

                // No document - show create placeholder
                return (
                  <div
                    key={deliverable.id}
                    className="border-2 border-dashed border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                  >
                    <h3 className="font-medium text-gray-500 mb-1">
                      {deliverable.title}
                    </h3>
                    <p className="text-xs text-gray-400 mb-4 line-clamp-2">
                      {deliverable.description}
                    </p>

                    <div className="flex items-center gap-2">
                      {deliverable.ai_generatable === 1 && (
                        <button
                          onClick={() => handleGenerate(deliverable)}
                          disabled={isGenerating}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {isGenerating ? (
                            <>
                              <svg
                                className="animate-spin h-3 w-3"
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
                              生成中...
                            </>
                          ) : (
                            <>
                              <svg
                                className="w-3.5 h-3.5"
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
                              AI 生成
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleCreateEmpty(deliverable)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 hover:bg-gray-100 rounded-md text-xs font-medium transition-colors"
                      >
                        <svg
                          className="w-3.5 h-3.5"
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
                        手动创建
                      </button>
                    </div>

                    {deliverable.is_required === 1 && (
                      <span className="inline-block mt-3 text-[10px] text-red-400 font-medium">
                        * 必需交付物
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
