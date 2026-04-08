"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, LayoutGrid, List, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Project } from "@/lib/types";
import { PROJECT_STAGES } from "@/lib/types";
import ProjectCard from "@/components/projects/ProjectCard";

const COLUMN_HEADER_COLORS: Record<string, string> = {
  discover: "bg-blue-500",
  value_filter: "bg-amber-500",
  validate: "bg-green-500",
  pmf: "bg-purple-500",
  business_model: "bg-emerald-500",
};

type ViewMode = "kanban" | "list";

export default function ProjectsPage() {
  const [view, setView] = useState<ViewMode>("kanban");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, projectId: number) => {
    e.dataTransfer.setData("text/plain", String(projectId));
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(projectId);
  };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageKey);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    setDraggingId(null);
    const projectId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (!projectId) return;
    try {
      await api.updateProject(projectId, { current_stage: targetStage });
      // Reload data without full page refresh
      reloadKanban();
      reloadList();
    } catch (err) {
      console.error("Move failed:", err);
    }
  };

  const {
    data: kanbanData,
    loading: kanbanLoading,
    error: kanbanError,
    reload: reloadKanban,
  } = useApi<Record<string, Project[]>>(() => api.projectsKanban(), []);

  const {
    data: listData,
    loading: listLoading,
    error: listError,
    reload: reloadList,
  } = useApi<Project[]>(() => api.projects(), []);

  const loading = view === "kanban" ? kanbanLoading : listLoading;
  const error = view === "kanban" ? kanbanError : listError;

  // Check if there are any projects at all
  const hasProjects =
    view === "kanban"
      ? kanbanData &&
        Object.values(kanbanData).some((col) => (col || []).length > 0)
      : listData && (Array.isArray(listData) ? listData : []).length > 0;

  const safeListData = Array.isArray(listData) ? listData : [];
  const filteredList =
    safeListData.length > 0 && stageFilter !== "all"
      ? safeListData.filter((p) => p.current_stage === stageFilter)
      : safeListData;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">项目管理</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              管理从需求到商业验证的完整项目流程
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setView("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "kanban"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                看板
              </button>
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  view === "list"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <List className="w-4 h-4" />
                列表
              </button>
            </div>

            {/* New project button */}
            <Link
              href="/projects/new"
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建项目
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 rounded-lg p-4 text-sm">
            加载失败: {error}
          </div>
        )}

        {!loading && !error && !hasProjects && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <LayoutGrid className="w-12 h-12 mb-4" />
            <p className="text-lg font-medium text-gray-500">
              还没有项目，创建第一个项目开始吧
            </p>
            <Link
              href="/projects/new"
              className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建项目
            </Link>
          </div>
        )}

        {/* Kanban View */}
        {!loading && !error && view === "kanban" && kanbanData && hasProjects && (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {PROJECT_STAGES.map((stage) => {
              const projects = (kanbanData && kanbanData[stage.key]) ? kanbanData[stage.key] : [];
              const headerColor =
                COLUMN_HEADER_COLORS[stage.key] ?? "bg-gray-500";
              return (
                <div
                  key={stage.key}
                  className={`flex-shrink-0 w-72 rounded-xl transition-colors ${
                    dragOverStage === stage.key
                      ? "bg-blue-100 ring-2 ring-blue-400"
                      : "bg-gray-100"
                  }`}
                  onDragOver={(e) => handleDragOver(e, stage.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage.key)}
                >
                  {/* Column header */}
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${headerColor}`}
                      />
                      <h3 className="font-semibold text-sm text-gray-700">
                        {stage.label}
                      </h3>
                      <span className="ml-auto text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full">
                        {projects.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="px-3 pb-3 space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto">
                    {projects.length === 0 && (
                      <div className={`text-center text-xs py-8 ${
                        dragOverStage === stage.key ? "text-blue-500" : "text-gray-400"
                      }`}>
                        {dragOverStage === stage.key ? "放在这里" : "暂无项目"}
                      </div>
                    )}
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, project.id)}
                        onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                        className={`cursor-grab active:cursor-grabbing transition-opacity ${
                          draggingId === project.id ? "opacity-40" : ""
                        }`}
                      >
                        <ProjectCard
                          project={project}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List View */}
        {!loading && !error && view === "list" && filteredList && hasProjects && (
          <div>
            {/* Stage filter */}
            <div className="mb-4">
              <div className="relative inline-block">
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2 pr-8 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="all">全部阶段</option>
                  {PROJECT_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Project list */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredList.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>

            {filteredList.length === 0 && (
              <div className="text-center text-gray-400 py-12 text-sm">
                该阶段暂无项目
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
