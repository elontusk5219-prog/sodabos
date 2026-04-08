"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { CompetitiveProduct, CompetitiveAnalysis, CompetitiveAngle } from "@/lib/types";
import IdeaCard from "@/components/common/IdeaCard";
import { Target, Lightbulb, RefreshCw, Rocket, Sparkles, MessageCircle } from "lucide-react";

const DIFFICULTY_MAP: Record<string, { label: string; color: string }> = {
  easy: { label: "低难度", color: "bg-green-100 text-green-700" },
  medium: { label: "中难度", color: "bg-yellow-100 text-yellow-700" },
  hard: { label: "高难度", color: "bg-red-100 text-red-700" },
};

export default function CompetitivePage() {
  const [source, setSource] = useState<"producthunt" | "trustmrr">("producthunt");
  const [products, setProducts] = useState<CompetitiveProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Selected product & analysis
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CompetitiveAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.competitiveProducts(source);
      setProducts(Array.isArray(data?.products) ? data.products : []);
      if (data?.error) setError(data.error);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleAnalyze = async (product: CompetitiveProduct) => {
    setSelectedId(product.id);
    setAnalysis(null);
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const result = await api.competitiveAnalyze(product.id, {
        name: product.name,
        tagline: product.tagline,
        description: product.description,
        votes: product.votes,
        topics: product.topics,
        source: product.source,
      });
      if (result?.angles) {
        setAnalysis(result);
      } else {
        setAnalyzeError(result?.error || "Analysis failed");
      }
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const selected = products.find((p) => p.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-2rem)] gap-4">
      {/* ── Left Panel: Product List ── */}
      <div className="w-[420px] flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-bold mb-3">竞品洞察</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSource("producthunt")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                source === "producthunt"
                  ? "bg-orange-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Product Hunt
            </button>
            <button
              onClick={() => setSource("trustmrr")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                source === "trustmrr"
                  ? "bg-emerald-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              TrustMRR
            </button>
            <button
              onClick={loadProducts}
              disabled={loading}
              className="ml-auto px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
            >
              {loading ? "..." : "刷新"}
            </button>
          </div>
        </div>

        {/* Product List */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="p-4 text-sm text-red-600 bg-red-50 m-3 rounded-lg">
              <p className="font-medium mb-1">加载失败</p>
              <p>{error}</p>
            </div>
          )}
          {loading && products.length === 0 && (
            <div className="p-8 text-center text-gray-400">
              <div className="animate-spin inline-block w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full mb-2" />
              <p className="text-sm">Loading...</p>
            </div>
          )}
          {products.map((product) => (
            <div
              key={product.id}
              onClick={() => handleAnalyze(product)}
              className={`p-4 border-b border-gray-50 cursor-pointer transition-colors hover:bg-blue-50 ${
                selectedId === product.id ? "bg-blue-50 border-l-4 border-l-blue-500" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                {product.thumbnail && (
                  <img
                    src={product.thumbnail}
                    alt={product.name}
                    className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm truncate">{product.name}</h3>
                    {product.votes > 0 && (
                      <span className="text-xs text-orange-500 flex-shrink-0">
                        ▲ {product.votes}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {product.tagline}
                  </p>
                  {product.mrr && (
                    <span className="inline-block mt-1 text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">
                      MRR: {product.mrr}
                    </span>
                  )}
                  {(product.topics || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(product.topics || []).slice(0, 3).map((t) => (
                        <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!loading && products.length === 0 && !error && (
            <div className="p-8 text-center text-gray-400 text-sm">
              暂无产品数据
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Analysis ── */}
      <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-y-auto">
        {!selectedId && (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <span className="mb-3 block"><Target size={40} className="mx-auto text-gray-400" /></span>
              <p className="text-sm">点击左侧产品，AI 会分析不同角度的切入机会</p>
            </div>
          </div>
        )}

        {selectedId && selected && (
          <div className="p-6">
            {/* Product Header */}
            <div className="mb-6 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3 mb-2">
                {selected.thumbnail && (
                  <img src={selected.thumbnail} alt="" className="w-12 h-12 rounded-xl" />
                )}
                <div>
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <p className="text-sm text-gray-500">{selected.tagline}</p>
                </div>
              </div>
              {selected.description && (
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                  {selected.description.slice(0, 300)}
                  {selected.description.length > 300 ? "..." : ""}
                </p>
              )}
              <div className="flex gap-3 mt-3 text-xs text-gray-400">
                {selected.votes > 0 && <span>▲ {selected.votes} votes</span>}
                {selected.comments > 0 && <span className="flex items-center gap-0.5"><MessageCircle size={12} className="inline" /> {selected.comments} comments</span>}
                {selected.website && (
                  <a
                    href={selected.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    访问官网 →
                  </a>
                )}
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange-500 hover:underline"
                  >
                    PH 页面 →
                  </a>
                )}
              </div>
            </div>

            {/* Analysis Status */}
            {analyzing && (
              <div className="flex items-center gap-3 p-6 bg-blue-50 rounded-xl mb-4">
                <div className="animate-spin w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full" />
                <div>
                  <p className="font-medium text-blue-700 text-sm">AI 正在分析...</p>
                  <p className="text-xs text-blue-500 mt-0.5">
                    正在拉取评论、搜索关联讨论、寻找切入角度
                  </p>
                </div>
              </div>
            )}

            {analyzeError && (
              <div className="p-4 bg-red-50 rounded-xl mb-4 text-sm text-red-600">
                {analyzeError}
              </div>
            )}

            {/* Analysis Results */}
            {analysis && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="font-bold text-lg">不同角度的切入机会</h3>
                  <div className="flex gap-2 text-xs text-gray-400">
                    {analysis.has_comments && (
                      <span className="bg-green-50 text-green-600 px-2 py-0.5 rounded-full">
                        已参考 PH 评论
                      </span>
                    )}
                    {analysis.has_cross_platform && (
                      <span className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
                        已交叉验证其他平台
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  {(analysis.angles || []).map((angle: CompetitiveAngle, idx: number) => {
                    const diff = DIFFICULTY_MAP[angle.difficulty] || DIFFICULTY_MAP.medium;
                    return (
                      <IdeaCard
                        key={idx}
                        type="angle"
                        agentContext={{
                          angleData: {
                            angle: angle.angle,
                            title: angle.title,
                            why: angle.why,
                            how: angle.how,
                            productName: selected?.name,
                          },
                        }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span>
                            {idx === 0 ? <Lightbulb size={18} className="inline text-yellow-500" /> : idx === 1 ? <RefreshCw size={18} className="inline text-blue-500" /> : idx === 2 ? <Rocket size={18} className="inline text-purple-500" /> : <Sparkles size={18} className="inline text-amber-500" />}
                          </span>
                          <h4 className="font-bold text-base">{angle.angle}</h4>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${diff.color}`}>
                            {diff.label}
                          </span>
                        </div>
                        <p className="font-medium text-sm text-gray-800 mb-2">{angle.title}</p>
                        <div className="space-y-1.5 text-sm text-gray-600">
                          <p>
                            <span className="text-gray-400 mr-1">为什么能成立：</span>
                            {angle.why}
                          </p>
                          <p>
                            <span className="text-gray-400 mr-1">如何验证：</span>
                            {angle.how}
                          </p>
                        </div>
                      </IdeaCard>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
