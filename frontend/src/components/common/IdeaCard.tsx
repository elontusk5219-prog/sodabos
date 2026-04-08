"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Target, ClipboardList } from "lucide-react";

interface IdeaCardProps {
  type: "demand" | "angle";
  borderColor?: string;
  children: React.ReactNode;
  agentContext?: {
    demandId?: number;
    title?: string;
    angleData?: { angle: string; title: string; why: string; how: string; productName?: string };
  };
}

export default function IdeaCard({ type, borderColor, children, agentContext }: IdeaCardProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const border = borderColor || (type === "demand" ? "border-l-blue-500" : "border-l-orange-400");

  const handleAskPMAgent = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    if (agentContext?.demandId) {
      router.push(`/agent?demand_id=${agentContext.demandId}`);
    } else {
      router.push("/agent");
    }
  };

  const handleAcquisition = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    if (agentContext?.demandId) {
      router.push(`/acquisition?demand_id=${agentContext.demandId}`);
    } else {
      router.push("/acquisition");
    }
  };

  const handleAddToProject = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    if (agentContext?.demandId) {
      router.push(`/projects/new?demand_id=${agentContext.demandId}`);
    } else {
      router.push("/projects/new");
    }
  };

  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 border-l-4 ${border} hover:shadow-md transition-shadow`}
    >
      <div className="p-4">{children}</div>
      <div className="px-4 pb-3 pt-0 relative">
        <div className="flex gap-1.5">
          <button
            onClick={handleAskPMAgent}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            <Bot size={12} className="inline" /> PM Agent
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowMenu(!showMenu); }}
            className="px-2 py-1.5 text-xs text-gray-400 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
          >
            ···
          </button>
        </div>

        {/* Dropdown menu */}
        {showMenu && (
          <div className="absolute bottom-full right-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[150px]">
            <button
              onClick={handleAcquisition}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-emerald-50 hover:text-emerald-600 transition-colors flex items-center gap-2"
            >
              <Target size={12} className="inline" /> 发送到获客 Agent
            </button>
            <button
              onClick={handleAddToProject}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-purple-50 hover:text-purple-600 transition-colors flex items-center gap-2"
            >
              <ClipboardList size={12} className="inline" /> 加入项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
