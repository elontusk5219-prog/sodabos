"use client";

import Link from "next/link";
import { Users, FileText, Clock } from "lucide-react";
import type { Project } from "@/lib/types";
import { PROJECT_STAGES } from "@/lib/types";

const STAGE_COLORS: Record<string, { bg: string; text: string }> = {
  discover: { bg: "bg-blue-50", text: "text-blue-700" },
  value_filter: { bg: "bg-amber-50", text: "text-amber-700" },
  validate: { bg: "bg-green-50", text: "text-green-700" },
  pmf: { bg: "bg-purple-50", text: "text-purple-700" },
  business_model: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

function stageLabel(key: string): string {
  return PROJECT_STAGES.find((s) => s.key === key)?.label ?? key;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

interface ProjectCardProps {
  project: Project;
  compact?: boolean;
}

export default function ProjectCard({ project, compact }: ProjectCardProps) {
  const colors = STAGE_COLORS[project.current_stage] ?? {
    bg: "bg-gray-50",
    text: "text-gray-700",
  };

  return (
    <Link href={`/projects/${project.id}`} className="block">
      <div
        className={`bg-white rounded-lg border border-gray-200 transition-shadow hover:shadow-md ${
          compact ? "p-3" : "p-4"
        }`}
      >
        {/* Title */}
        <h3
          className={`font-semibold text-gray-900 line-clamp-1 ${
            compact ? "text-sm" : "text-base"
          }`}
        >
          {project.title}
        </h3>

        {/* Description */}
        {project.description && (
          <p
            className={`text-gray-500 line-clamp-2 mt-1 ${
              compact ? "text-xs" : "text-sm"
            }`}
          >
            {project.description}
          </p>
        )}

        {/* Stage badge */}
        <div className="mt-2">
          <span
            className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
          >
            {stageLabel(project.current_stage)}
          </span>
        </div>

        {/* Bottom row */}
        <div
          className={`flex items-center gap-3 text-gray-400 mt-3 pt-2 border-t border-gray-100 ${
            compact ? "text-[10px]" : "text-xs"
          }`}
        >
          {project.creator_name && (
            <span className="text-gray-500 truncate max-w-[80px]">
              {project.creator_name}
            </span>
          )}
          <span className="flex items-center gap-0.5">
            <Users className="w-3 h-3" />
            {project.member_count ?? 0}
          </span>
          <span className="flex items-center gap-0.5">
            <FileText className="w-3 h-3" />
            {project.doc_count ?? 0}
          </span>
          <span className="flex items-center gap-0.5 ml-auto">
            <Clock className="w-3 h-3" />
            {relativeTime(project.updated_at)}
          </span>
        </div>
      </div>
    </Link>
  );
}
