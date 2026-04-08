"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Demand } from "@/lib/types";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { ThumbsUp, ThumbsDown, MessageCircle, Bot, ChevronLeft, ChevronRight, PartyPopper, Search, Lightbulb } from "lucide-react";

const REJECT_REASONS = [
  "重复需求", "太小众", "技术不可行", "已有成熟方案", "不符合方向", "其他",
];

function ScoreBar({ label, value, max = 10, color }: { label: string; value: number; max?: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-6 text-right">{value}</span>
    </div>
  );
}

export default function SwipeView({
  demands,
  onAction,
}: {
  demands: Demand[];
  onAction: (id: number, action: "approve" | "dismiss" | "discuss") => void;
}) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | "up" | null>(null);
  const [showRejectMenu, setShowRejectMenu] = useState(false);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const demand = demands[currentIndex];

  const goNext = useCallback(() => {
    setSwipeDir(null);
    setDragOffset({ x: 0, y: 0 });
    setShowRejectMenu(false);
    setShowComment(false);
    setComment("");
    if (currentIndex < demands.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, demands.length]);

  const handleApprove = useCallback(() => {
    if (!demand) return;
    setSwipeDir("right");
    api.vote("demand", String(demand.id), 1).catch(() => {});
    api.reviewDemand(demand.id, "approved").catch(() => {});
    onAction(demand.id, "approve");
    setTimeout(goNext, 300);
  }, [demand, onAction, goNext]);

  const handleDismiss = useCallback((reason: string) => {
    if (!demand) return;
    setSwipeDir("left");
    api.reviewDemand(demand.id, "dismissed", reason, comment || undefined).catch(() => {});
    onAction(demand.id, "dismiss");
    setShowRejectMenu(false);
    setTimeout(goNext, 300);
  }, [demand, onAction, goNext, comment]);

  const handleAskAgent = useCallback(() => {
    if (!demand) return;
    router.push(`/agent?demand_id=${demand.id}`);
    onAction(demand.id, "discuss");
  }, [demand, onAction, router]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showRejectMenu || showComment) return;
      if (e.key === "ArrowRight") handleApprove();
      else if (e.key === "ArrowLeft") setShowRejectMenu(true);
      else if (e.key === "ArrowUp") handleAskAgent();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleApprove, handleAskAgent, showRejectMenu, showComment]);

  // Touch/mouse drag handling
  const handlePointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    setDragOffset({ x: dx, y: Math.min(0, dy) }); // only allow upward drag
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    if (dragOffset.x > 100) {
      handleApprove();
    } else if (dragOffset.x < -100) {
      setShowRejectMenu(true);
      setDragOffset({ x: 0, y: 0 });
    } else if (dragOffset.y < -80) {
      handleAskAgent();
      setDragOffset({ x: 0, y: 0 });
    } else {
      setDragOffset({ x: 0, y: 0 });
    }
  };

  if (!demand) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <div className="text-center text-gray-400">
          <div className="mb-4"><PartyPopper size={48} className="mx-auto text-gray-400" /></div>
          <p className="text-lg font-medium">全部审完了！</p>
          <p className="text-sm mt-2">共审核了 {demands.length} 个需求</p>
        </div>
      </div>
    );
  }

  const rotation = dragOffset.x * 0.05;
  const opacity = Math.max(0, 1 - Math.abs(dragOffset.x) / 300);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Progress */}
      <div className="flex items-center gap-3 text-sm text-gray-400">
        <span>{currentIndex + 1} / {demands.length}</span>
        <div className="w-48 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${((currentIndex + 1) / demands.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Swipe hints */}
      <div className="flex items-center gap-8 text-xs text-gray-300">
        <span className="flex items-center gap-1"><ChevronLeft className="w-3 h-3" /> 左滑淘汰</span>
        <span className="flex items-center gap-1">上滑问Agent <Bot className="w-3 h-3" /></span>
        <span className="flex items-center gap-1">右滑通过 <ChevronRight className="w-3 h-3" /></span>
      </div>

      {/* Card stack */}
      <div className="relative w-[400px] h-[520px]">
        {/* Background card (next) */}
        {currentIndex + 1 < demands.length && (
          <div className="absolute inset-0 bg-white rounded-2xl border border-gray-100 shadow-sm scale-[0.95] opacity-50" />
        )}

        {/* Swipe indicator overlays */}
        {dragOffset.x > 50 && (
          <div className="absolute inset-0 bg-green-500/10 rounded-2xl z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-green-500 text-white px-6 py-3 rounded-full text-lg font-bold rotate-[-15deg]">
              有价值 <ThumbsUp size={18} className="inline" />
            </div>
          </div>
        )}
        {dragOffset.x < -50 && (
          <div className="absolute inset-0 bg-red-500/10 rounded-2xl z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-red-500 text-white px-6 py-3 rounded-full text-lg font-bold rotate-[15deg]">
              淘汰 <ThumbsDown size={18} className="inline" />
            </div>
          </div>
        )}
        {dragOffset.y < -40 && (
          <div className="absolute inset-0 bg-blue-500/10 rounded-2xl z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-blue-500 text-white px-6 py-3 rounded-full text-lg font-bold">
              问 Agent <Bot size={18} className="inline" />
            </div>
          </div>
        )}

        {/* Main card */}
        <div
          ref={cardRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`absolute inset-0 bg-white rounded-2xl border border-gray-200 shadow-lg cursor-grab active:cursor-grabbing select-none overflow-hidden transition-transform ${
            swipeDir === "right" ? "translate-x-[120%] rotate-12" :
            swipeDir === "left" ? "-translate-x-[120%] -rotate-12" :
            swipeDir === "up" ? "-translate-y-[120%]" : ""
          } ${swipeDir ? "transition-all duration-300" : isDragging ? "" : "transition-transform duration-200"}`}
          style={!swipeDir ? {
            transform: `translateX(${dragOffset.x}px) translateY(${dragOffset.y}px) rotate(${rotation}deg)`,
            opacity,
          } : undefined}
        >
          {/* Track badge + Score */}
          <div className="px-6 pt-5 pb-3 flex items-start justify-between">
            <div>
              <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                demand.track === "B" ? "bg-orange-50 text-orange-600" : "bg-blue-50 text-blue-600"
              }`}>
                {demand.track === "B" ? <><Search size={12} className="inline" /> 竞品洞察</> : <><Lightbulb size={12} className="inline" /> 痛点洞察</>}
              </span>
            </div>
            <div className={`text-3xl font-bold ${
              demand.score_total >= 70 ? "text-green-500" :
              demand.score_total >= 50 ? "text-yellow-500" : "text-red-400"
            }`}>
              {Number(demand.score_total).toFixed(1)}
            </div>
          </div>

          {/* Title */}
          <div className="px-6 pb-3">
            <h2 className="text-lg font-bold text-gray-900 leading-snug">{demand.title}</h2>
          </div>

          {/* Description */}
          <div className="px-6 pb-4">
            <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">{demand.description}</p>
          </div>

          {/* Score bars */}
          <div className="px-6 pb-4 space-y-2">
            <ScoreBar label="痛点" value={demand.score_pain} color="bg-red-400" />
            <ScoreBar label="AI机会" value={demand.score_ai_opportunity} color="bg-purple-400" />
            <ScoreBar label="竞争度" value={demand.score_competition} color="bg-blue-400" />
            <ScoreBar label="冷启动" value={demand.score_cold_start} color="bg-green-400" />
            <ScoreBar label="成本" value={demand.score_cost} color="bg-yellow-400" />
            <ScoreBar label="传播性" value={demand.score_virality} color="bg-pink-400" />
            <ScoreBar label="LTV" value={demand.score_ltv} color="bg-indigo-400" />
          </div>

          {/* AI Analysis snippet */}
          {demand.ai_analysis && (
            <div className="px-6 pb-4">
              <p className="text-xs text-gray-400 line-clamp-2">{demand.ai_analysis}</p>
            </div>
          )}
        </div>

        {/* Reject reason menu overlay */}
        {showRejectMenu && (
          <div className="absolute inset-0 bg-white/95 backdrop-blur-sm rounded-2xl z-20 flex flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm font-medium text-gray-700 mb-2">为什么淘汰？</p>
            {REJECT_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => handleDismiss(reason)}
                className="w-full py-2.5 px-4 bg-gray-50 hover:bg-red-50 hover:text-red-600 rounded-xl text-sm transition-colors"
              >
                {reason}
              </button>
            ))}

            {/* Optional comment */}
            {showComment ? (
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="补充说明..."
                className="w-full px-3 py-2 border rounded-xl text-sm mt-2"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setShowComment(true)}
                className="text-xs text-gray-400 hover:text-gray-600 mt-1"
              >
                + 补充说明
              </button>
            )}

            <button
              onClick={() => { setShowRejectMenu(false); setDragOffset({ x: 0, y: 0 }); }}
              className="text-xs text-gray-400 hover:text-gray-600 mt-2"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-6 mt-2">
        <button
          onClick={() => setShowRejectMenu(true)}
          className="w-14 h-14 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors group"
        >
          <ThumbsDown className="w-6 h-6 text-red-400 group-hover:text-red-500" />
        </button>
        <button
          onClick={() => setShowComment(!showComment)}
          className="w-11 h-11 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors group"
        >
          <MessageCircle className="w-5 h-5 text-gray-400 group-hover:text-gray-600" />
        </button>
        <button
          onClick={handleAskAgent}
          className="w-11 h-11 rounded-full bg-blue-50 hover:bg-blue-100 flex items-center justify-center transition-colors group"
        >
          <Bot className="w-5 h-5 text-blue-400 group-hover:text-blue-600" />
        </button>
        <button
          onClick={handleApprove}
          className="w-14 h-14 rounded-full bg-green-50 hover:bg-green-100 flex items-center justify-center transition-colors group"
        >
          <ThumbsUp className="w-6 h-6 text-green-400 group-hover:text-green-500" />
        </button>
      </div>

      {/* Keyboard hints */}
      <div className="flex gap-4 text-[10px] text-gray-300 mt-1">
        <span>← 淘汰</span>
        <span>↑ 问Agent</span>
        <span>→ 通过</span>
      </div>
    </div>
  );
}
