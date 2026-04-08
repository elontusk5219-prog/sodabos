"use client";
import { useState, useEffect, useRef } from "react";
import { useApi, ApiErrorBanner } from "@/hooks/useApi";
import { api } from "@/lib/api";
import DemandCard from "@/components/demands/DemandCard";
import SwipeView from "@/components/demands/SwipeView";
import type { Demand } from "@/lib/types";
import { Loader2, Sparkles, LayoutGrid, CreditCard, CheckCircle, XCircle, Clock, Lightbulb, Search, Building, TrendingUp } from "lucide-react";

export default function DemandsPage() {
  const [viewMode, setViewMode] = useState<"grid" | "swipe">("grid");
  const [stage, setStage] = useState("");
  const [track, setTrack] = useState("");
  const [insightLayer, setInsightLayer] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [sort, setSort] = useState("score_total");
  const [minScore, setMinScore] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [reviewedIds, setReviewedIds] = useState<Set<number>>(new Set());

  // Load user's reviewed IDs on mount
  useEffect(() => {
    api.myReviewedIds().then((data: { ids: number[] }) => {
      setReviewedIds(new Set(data?.ids || []));
    }).catch(() => {});
  }, []);

  const { data, loading, error, reload } = useApi<{ demands: Demand[]; total: number }>(
    () =>
      api.demands({
        ...(stage ? { stage } : {}),
        ...(track ? { track } : {}),
        ...(insightLayer ? { insight_layer: insightLayer } : {}),
        ...(reviewFilter ? { review_filter: reviewFilter, exclude_reviewed: "false" } : {}),
        ...(minScore ? { min_score: minScore } : {}),
        sort,
        limit: "100",
      }),
    [stage, track, insightLayer, reviewFilter, sort, minScore]
  );

  const handleRemove = (id: number) => {
    setDismissed((prev) => new Set(prev).add(id));
    setReviewedIds((prev) => new Set(prev).add(id));
  };

  const visibleDemands = (data?.demands || []).filter(
    (d) => !dismissed.has(d.id) && (reviewFilter || !reviewedIds.has(d.id))
  );

  // Poll job status
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.analysisStatus(jobId);
        if (res.status === "done") {
          clearInterval(pollRef.current!);
          setAnalyzing(false);
          setJobId(null);
          const created = res.demands_created || 0;
          const skipped = res.demands_skipped_dedup || 0;
          setJobStatus(`done:分析完成！新增 ${created} 个需求，去重跳过 ${skipped} 个`);
          reload();
        } else if (res.status === "error") {
          clearInterval(pollRef.current!);
          setAnalyzing(false);
          setJobId(null);
          setJobStatus(`error:分析失败: ${res.error}`);
        } else if (res.status === "running") {
          setJobStatus(`progress:${res.progress || "分析中..."}`);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [jobId]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setJobStatus("progress:正在启动分析任务...");
    try {
      const res = await api.analyze({ auto: true });
      if (res.status === "started" && res.job_id) {
        setJobId(res.job_id);
        setJobStatus(`progress:${res.message || "分析任务已启动，正在后台运行..."}`);
      } else if (res.error) {
        setJobStatus(`error:${res.error}`);
        setAnalyzing(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setJobStatus(`error:${msg}`);
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">需求池</h1>
        <div className="flex gap-2">
          {/* View mode toggle */}
          <div className="flex border border-gray-200 rounded overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-2.5 py-1.5 text-sm flex items-center gap-1 ${viewMode === "grid" ? "bg-gray-100 text-gray-800" : "text-gray-400 hover:bg-gray-50"}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("swipe")}
              className={`px-2.5 py-1.5 text-sm flex items-center gap-1 ${viewMode === "swipe" ? "bg-gray-100 text-gray-800" : "text-gray-400 hover:bg-gray-50"}`}
            >
              <CreditCard className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {analyzing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Sparkles className="w-4 h-4" />}
            {analyzing ? "分析中..." : "AI分析"}
          </button>
          <button onClick={() => reload()} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">刷新</button>
        </div>
      </div>

      {/* Job status banner */}
      {jobStatus && (
        <div className={`px-3 py-2 rounded text-sm flex items-center gap-1.5 ${
          jobStatus.startsWith("done:") ? "bg-green-50 text-green-700 border border-green-200"
          : jobStatus.startsWith("error:") ? "bg-red-50 text-red-700 border border-red-200"
          : "bg-blue-50 text-blue-700 border border-blue-200"
        }`}>
          {jobStatus.startsWith("done:") && <CheckCircle size={14} className="inline shrink-0" />}
          {jobStatus.startsWith("error:") && <XCircle size={14} className="inline shrink-0" />}
          {jobStatus.startsWith("progress:") && <Clock size={14} className="inline shrink-0 animate-spin" />}
          {jobStatus.replace(/^(done|error|progress):/, "")}
          {jobStatus.startsWith("done:") && (
            <button onClick={() => setJobStatus(null)} className="ml-2 text-xs opacity-60 hover:opacity-100">x</button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部阶段</option>
          <option value="discovered">已发现</option>
          <option value="filtered">已过滤</option>
          <option value="validated">已验证</option>
        </select>
        <select
          value={track}
          onChange={(e) => setTrack(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部来源</option>
          <option value="A">痛点洞察</option>
          <option value="B">竞品洞察</option>
        </select>
        <select
          value={insightLayer}
          onChange={(e) => setInsightLayer(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部洞察层</option>
          <option value="conventional">Conventional</option>
          <option value="trending">Trending</option>
          <option value="first_principles">First Principles</option>
        </select>
        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部状态</option>
          <option value="approved">已通过</option>
          <option value="dismissed">已淘汰</option>
          <option value="unreviewed">未审批</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="score_total">按总分排序</option>
          <option value="score_pain">按痛点排序</option>
          <option value="score_ai_opportunity">按AI机会排序</option>
          <option value="created_at">按时间排序</option>
        </select>
        <input
          type="number"
          placeholder="最低总分"
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-28"
        />
      </div>

      <div className="text-sm text-gray-400">
        共 {visibleDemands.length} 个需求
        {dismissed.size > 0 && <span className="ml-2 text-gray-300">（已移除 {dismissed.size} 个）</span>}
      </div>

      {error && <ApiErrorBanner error={error} onRetry={reload} />}
      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : visibleDemands.length === 0 ? (
        <div className="text-center text-gray-400 py-20">
          <div className="mb-4"><Lightbulb size={40} className="mx-auto text-gray-400" /></div>
          <div className="mb-4">暂无需求，点击「AI分析」从采集数据中提炼需求</div>
        </div>
      ) : viewMode === "swipe" ? (
        <div className="flex justify-center py-4">
          <SwipeView
            demands={visibleDemands}
            onAction={(id, action) => {
              if (action === "dismiss") handleRemove(id);
            }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleDemands.map((d) => (
            <DemandCard key={d.id} demand={d} onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  );
}
