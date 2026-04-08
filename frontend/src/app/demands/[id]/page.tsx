"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import ScoreRadar from "@/components/demands/ScoreRadar";
import Badge from "@/components/common/Badge";
import type { Demand, AgentArtifact } from "@/lib/types";
import { STAGE_NAMES } from "@/lib/types";
import { useState, useEffect } from "react";
import { TrendingUp, Lightbulb, Search, Link as LinkIcon, FileText, FlaskConical, Scale, Satellite } from "lucide-react";

const SCORE_DIMS = [
  { key: "score_pain", label: "痛点等级", desc: "需求对应的痛点强度" },
  { key: "score_competition", label: "竞争环境", desc: "越高=越蓝海" },
  { key: "score_cold_start", label: "冷启难度", desc: "越高=越易冷启" },
  { key: "score_cost", label: "实现成本", desc: "越高=成本越低" },
  { key: "score_virality", label: "裂变属性", desc: "自带传播性" },
  { key: "score_ltv", label: "LTV", desc: "用户生命周期价值" },
  { key: "score_ai_opportunity", label: "AI剪刀差", desc: "AI技术优势" },
];

const INSIGHT_LAYER_LABELS: Record<string, { label: string; className: string }> = {
  trending: {
    label: "Trending",
    className: "text-orange-700 bg-orange-50 border-orange-200",
  },
  first_principles: {
    label: "First Principles",
    className: "text-purple-700 bg-purple-50 border-purple-200",
  },
};

const ARTIFACT_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  signal_report: { label: "Signal Report", icon: "satellite", color: "bg-green-50 border-green-200" },
  simulation: { label: "Product Simulation", icon: "flask", color: "bg-purple-50 border-purple-200" },
  decision_rationale: { label: "Decision Rationale", icon: "scale", color: "bg-amber-50 border-amber-200" },
};

export default function DemandDetailPage() {
  const { id } = useParams();
  const { data: demand, loading, reload } = useApi<Demand>(
    () => api.demand(Number(id)),
    [id]
  );
  const [rescoring, setRescoring] = useState(false);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [expandedArtifact, setExpandedArtifact] = useState<number | null>(null);
  const [linkedProjectId, setLinkedProjectId] = useState<number | null>(null);
  const [projectChecked, setProjectChecked] = useState(false);

  useEffect(() => {
    if (id) {
      api.agentArtifacts(Number(id)).then((data: { artifacts: AgentArtifact[] }) => {
        setArtifacts(data?.artifacts || []);
      }).catch(() => {});

      // Check if a project is already linked to this demand
      api.projects({ search: "" }).then((projects: { id: number; demand_id?: number }[]) => {
        const arr = Array.isArray(projects) ? projects : [];
        const linked = arr.find((p) => p.demand_id === Number(id));
        setLinkedProjectId(linked ? linked.id : null);
        setProjectChecked(true);
      }).catch(() => {
        setProjectChecked(true);
      });
    }
  }, [id]);

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (!demand) return <div className="text-red-500">需求不存在</div>;

  const handleStageChange = async (stage: string) => {
    try {
      await api.updateDemand(demand.id, { stage });
      reload();
    } catch (e) {
      console.error("更新阶段失败:", e);
    }
  };

  const handleRescore = async () => {
    setRescoring(true);
    try {
      await api.rescore(demand.id);
      reload();
    } catch (e) {
      console.error("重新评分失败:", e);
    } finally {
      setRescoring(false);
    }
  };

  const insightInfo = demand.insight_layer ? INSIGHT_LAYER_LABELS[demand.insight_layer] : null;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge color={demand.stage === "validated" ? "green" : demand.stage === "filtered" ? "yellow" : "gray"}>
            {STAGE_NAMES[demand.stage] || demand.stage}
          </Badge>
          {demand.track === "B" && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 flex items-center gap-1">
              <Search size={12} className="inline" /> 竞品洞察
            </span>
          )}
          {insightInfo && (
            <span className={`text-xs font-medium border rounded-full px-2.5 py-1 flex items-center gap-1 ${insightInfo.className}`}>
              {demand.insight_layer === "trending" ? <TrendingUp size={12} /> : <Lightbulb size={12} />}
              {insightInfo.label}
            </span>
          )}
          <span className="text-2xl font-bold text-blue-600">{Number(demand.score_total).toFixed(1)}</span>
        </div>
        <h1 className="text-2xl font-bold">{demand.title}</h1>
        <p className="text-gray-500 mt-2">{demand.description}</p>
      </div>

      {/* 竞品洞察专区 */}
      {demand.track === "B" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h2 className="font-medium text-amber-800 mb-2 flex items-center gap-1"><Search size={16} className="inline" /> 竞品洞察来源</h2>
          <p className="text-sm text-amber-700">
            该需求来自对已验证热门产品的逆向分析 - 基于 ProductHunt/TrustMRR 上的成功产品，
            结合其他平台用户的真实痛点反馈，发现了不同角度的切入机会。
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {["discovered", "filtered", "validated"].map((s) => (
          <button
            key={s}
            onClick={() => handleStageChange(s)}
            className={`px-3 py-1.5 rounded text-sm border ${
              demand.stage === s
                ? "bg-blue-600 text-white border-blue-600"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {STAGE_NAMES[s]}
          </button>
        ))}
        <button
          onClick={handleRescore}
          disabled={rescoring}
          className="px-3 py-1.5 rounded text-sm border border-purple-300 text-purple-600 hover:bg-purple-50 disabled:opacity-50 ml-auto"
        >
          {rescoring ? "评分中..." : "重新评分"}
        </button>
        {projectChecked && (
          linkedProjectId ? (
            <Link
              href={`/projects/${linkedProjectId}`}
              className="px-3 py-1.5 rounded text-sm border border-green-300 text-green-700 hover:bg-green-50"
            >
              查看项目
            </Link>
          ) : (
            <Link
              href={`/projects/new?demand_id=${id}`}
              className="px-3 py-1.5 rounded text-sm border border-blue-300 text-blue-600 hover:bg-blue-50"
            >
              开启项目
            </Link>
          )
        )}
      </div>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">评分雷达图</h2>
          <ScoreRadar demand={demand} />
        </div>
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">分维度评分</h2>
          <div className="space-y-3">
            {SCORE_DIMS.map(({ key, label, desc }) => {
              const val = (demand as unknown as Record<string, unknown>)[key] as number || 0;
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>
                      {label} <span className="text-gray-400 text-xs">({desc})</span>
                    </span>
                    <span className="font-medium">{val}/10</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${val * 10}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Agent Analysis Chain (Artifacts) */}
      {artifacts.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3 flex items-center gap-1"><LinkIcon size={16} className="inline" /> Agent Analysis Chain</h2>
          <p className="text-xs text-gray-400 mb-3">认知循环各阶段的中间产物，完整展示 Agent 的分析链路</p>
          <div className="space-y-2">
            {artifacts.map((artifact) => {
              const meta = ARTIFACT_TYPE_LABELS[artifact.artifact_type] || {
                label: artifact.artifact_type, icon: "file", color: "bg-gray-50 border-gray-200"
              };
              const isExpanded = expandedArtifact === artifact.id;
              return (
                <div key={artifact.id} className={`border rounded-lg overflow-hidden ${meta.color}`}>
                  <button
                    onClick={() => setExpandedArtifact(isExpanded ? null : artifact.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span>{meta.icon === "satellite" ? <Satellite size={14} /> : meta.icon === "flask" ? <FlaskConical size={14} /> : meta.icon === "scale" ? <Scale size={14} /> : <FileText size={14} />}</span>
                      <span className="text-sm font-medium">{meta.label}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(artifact.created_at).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-gray-400 text-sm">{isExpanded ? "▲" : "▼"}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <pre className="text-xs text-gray-700 bg-white/70 rounded p-3 overflow-x-auto max-h-[300px] overflow-y-auto">
                        {typeof artifact.content === "string"
                          ? artifact.content
                          : JSON.stringify(artifact.content, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Analysis */}
      {demand.ai_analysis && (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">AI分析报告</h2>
          <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
            {demand.ai_analysis}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-gray-400 flex gap-4">
        <span>创建: {demand.created_at}</span>
        <span>更新: {demand.updated_at}</span>
      </div>
    </div>
  );
}
