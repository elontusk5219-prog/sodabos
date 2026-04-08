import Link from "next/link";
import Badge from "@/components/common/Badge";
import IdeaCard from "@/components/common/IdeaCard";
import type { Demand } from "@/lib/types";
import { STAGE_NAMES } from "@/lib/types";
import { ThumbsUp, ThumbsDown, Trash2, Search, TrendingUp, Lightbulb, BarChart3 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit", hackernews: "HN", bilibili: "B站", tieba: "贴吧",
  weibo: "微博", xiaohongshu: "小红书", twitter: "X", v2ex: "V2EX",
  quora: "Quora", trustmrr: "TrustMrr", producthunt: "PH",
  youtube: "YouTube", google_trends: "GTrends", zhihu: "知乎",
};

function scoreColor(score: number) {
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-500";
}

function ScoreBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-10 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="text-[10px] text-gray-400">{value}</span>
    </div>
  );
}

const REJECT_REASONS = [
  "重复需求", "太小众", "技术不可行", "已有成熟方案", "不符合方向", "其他",
];

export default function DemandCard({ demand, onRemove }: { demand: Demand; onRemove?: (id: number, reason: string) => void }) {
  let platforms: string[] = [];
  try {
    platforms = demand.platforms ? JSON.parse(demand.platforms) : [];
  } catch { platforms = []; }

  const signalCount = demand.signal_count || 1;
  const [myVote, setMyVote] = useState<1 | -1 | null>(null);
  const [showRejectMenu, setShowRejectMenu] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleVote = async (vote: 1 | -1, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = myVote === vote ? null : vote;
    setMyVote(next);
    if (next !== null) {
      await api.vote("demand", String(demand.id), next).catch(() => {});
    }
  };

  const borderColor = demand.track === "B" ? "border-l-orange-400" : "border-l-blue-500";

  const handleReject = (reason: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowRejectMenu(false);
    setDismissed(true);
    // Dismiss with reason - feeds into Cognee for learning
    api.dismissDemand(demand.id, reason).catch(() => {});
    onRemove?.(demand.id, reason);
  };

  if (dismissed) {
    return (
      <div className="bg-gray-50 rounded-lg border border-gray-100 p-4 text-center text-sm text-gray-400">
        已移除: {demand.title}
      </div>
    );
  }

  return (
    <IdeaCard
      type="demand"
      borderColor={borderColor}
      agentContext={{ demandId: demand.id, title: demand.title }}
    >
      <Link href={`/demands/${demand.id}`} className="block">
        {/* Header: title + score */}
        <div className="flex justify-between items-start mb-2 gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap mb-1">
              {demand.track === "B" && (
                <span className="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  <Search size={10} className="inline" /> 竞品洞察
                </span>
              )}
              {demand.insight_layer === "trending" && (
                <span className="inline-block text-[10px] font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                  <TrendingUp size={10} className="inline" /> Trending
                </span>
              )}
              {demand.insight_layer === "first_principles" && (
                <span className="inline-block text-[10px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5">
                  <Lightbulb size={10} className="inline" /> First Principles
                </span>
              )}
            </div>
            <h3 className="font-medium text-sm line-clamp-2">{demand.title}</h3>
          </div>
          <span className={`text-xl font-bold shrink-0 ${scoreColor(demand.score_total)}`}>
            {Number(demand.score_total).toFixed(1)}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-gray-500 line-clamp-2 mb-3">{demand.description}</p>

        {/* Score bars */}
        <div className="grid grid-cols-3 gap-x-2 gap-y-1 mb-3">
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">痛点</div>
            <ScoreBar value={demand.score_pain} color="bg-red-400" />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">AI机会</div>
            <ScoreBar value={demand.score_ai_opportunity} color="bg-purple-400" />
          </div>
          <div>
            <div className="text-[10px] text-gray-400 mb-0.5">竞争度</div>
            <ScoreBar value={demand.score_competition} color="bg-blue-400" />
          </div>
        </div>

        {/* Footer: stage + signal + platforms */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Badge color={demand.stage === "validated" ? "green" : demand.stage === "filtered" ? "yellow" : "gray"}>
              {STAGE_NAMES[demand.stage] || demand.stage}
            </Badge>
            {signalCount > 1 && (
              <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                <BarChart3 size={10} className="inline" /> {signalCount}条信号
              </span>
            )}
          </div>
          <div className="flex gap-1 flex-wrap justify-end">
            {platforms.slice(0, 3).map((p) => (
              <span key={p} className="text-[10px] text-gray-400 bg-gray-50 px-1 py-0.5 rounded">
                {PLATFORM_LABELS[p] || p}
              </span>
            ))}
            {platforms.length > 3 && (
              <span className="text-[10px] text-gray-400">+{platforms.length - 3}</span>
            )}
          </div>
        </div>

        {/* Quick feedback bar */}
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-50 relative">
          <button
            onClick={(e) => handleVote(1, e)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${myVote === 1 ? "bg-green-100 text-green-600" : "text-gray-300 hover:text-green-500 hover:bg-green-50"}`}
          >
            <ThumbsUp className="w-3 h-3" /> 有价值
          </button>
          <button
            onClick={(e) => handleVote(-1, e)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${myVote === -1 ? "bg-red-100 text-red-500" : "text-gray-300 hover:text-red-400 hover:bg-red-50"}`}
          >
            <ThumbsDown className="w-3 h-3" /> 一般
          </button>
          <div className="flex-1" />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRejectMenu(!showRejectMenu); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> 移除
          </button>
          {showRejectMenu && (
            <div className="absolute bottom-full right-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
              <div className="px-3 py-1.5 text-[10px] text-gray-400 font-medium">移除原因</div>
              {REJECT_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={(e) => handleReject(reason, e)}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
                >
                  {reason}
                </button>
              ))}
            </div>
          )}
        </div>
      </Link>
    </IdeaCard>
  );
}
