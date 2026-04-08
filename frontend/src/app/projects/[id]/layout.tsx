"use client";
import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Project, ProjectMember } from "@/lib/types";
import StageProgress from "@/components/projects/StageProgress";

const TABS = [
  { label: "概览", suffix: "" },
  { label: "文档", suffix: "/documents" },
  { label: "讨论", suffix: "/discussions" },
  { label: "文件", suffix: "/files" },
  { label: "设置", suffix: "/settings" },
] as const;

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams();
  const pathname = usePathname();
  const projectId = Number(id);

  const { data, loading, error } = useApi<Project & { members: ProjectMember[] }>(
    () => api.project(projectId),
    [projectId],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-6">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
        <div className="h-12 bg-gray-200 rounded w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || "项目不存在"}
        </div>
      </div>
    );
  }

  const project = data;
  const basePath = `/projects/${id}`;

  // Determine active tab by matching pathname
  const activeTab = TABS.reduce((best, tab) => {
    const tabPath = basePath + tab.suffix;
    if (pathname === tabPath || (tab.suffix && pathname.startsWith(tabPath + "/"))) {
      return tab;
    }
    return best;
  }, TABS[0]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
          <span
            className={`
              px-2 py-0.5 text-xs rounded-full font-medium
              ${project.status === "active" ? "bg-green-100 text-green-700" : ""}
              ${project.status === "archived" ? "bg-gray-100 text-gray-500" : ""}
              ${project.status === "completed" ? "bg-blue-100 text-blue-700" : ""}
            `}
          >
            {project.status === "active" ? "进行中" : project.status === "archived" ? "已归档" : project.status}
          </span>
        </div>
        {project.description && (
          <p className="text-gray-500 text-sm ml-8">{project.description}</p>
        )}
      </div>

      {/* Stage Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <StageProgress currentStage={project.current_stage} />
      </div>

      {/* Tab Navigation */}
      <nav className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const tabPath = basePath + tab.suffix;
          const isActive = tab === activeTab;

          return (
            <Link
              key={tab.suffix}
              href={tabPath}
              className={`
                px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors
                ${isActive
                  ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }
              `}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Page Content */}
      <div>{children}</div>
    </div>
  );
}
