"use client";
import { useState } from "react";
import { useApi, ApiErrorBanner } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { PlatformBadge, SentimentBadge } from "@/components/common/Badge";
import type { RawItem } from "@/lib/types";
import { BookOpen, Loader2, CheckCircle, XCircle } from "lucide-react";

export default function DiscoverPage() {
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const { data, loading, error, reload } = useApi<{ items: RawItem[]; total: number }>(
    () => api.items({ ...(platform ? { platform } : {}), ...(search ? { search } : {}), limit: "100" }),
    [platform, search]
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");

  const handleAnalyze = async () => {
    if (selected.length === 0) return;
    setAnalyzing(true);
    try {
      const result = await api.analyze({ item_ids: selected });
      setAnalyzeMsg("AI 正在检索知识库并分析…");
      // 轮询任务状态
      const poll = async () => {
        const status = await api.analysisStatus(result.job_id);
        if (status.status === "done") {
          setAnalyzing(false);
          setAnalyzeMsg("");
          alert(`分析完成，发现 ${status.demands_created} 个新需求`);
          setSelected([]);
        } else if (status.status === "error") {
          setAnalyzing(false);
          setAnalyzeMsg("");
          alert(`分析失败：${status.error}`);
        } else {
          setAnalyzeMsg(status.progress || "分析中…");
          setTimeout(poll, 3000);
        }
      };
      setTimeout(poll, 3000);
    } catch {
      setAnalyzing(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAll = () => {
    if (!data) return;
    if (selected.length === (data.items || []).length) {
      setSelected([]);
    } else {
      setSelected((data.items || []).map((i) => i.id));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">数据发现</h1>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => reload()}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50"
          >
            刷新
          </button>
          {selected.length > 0 && (
            <span className="text-sm text-gray-500">已选 {selected.length} 条</span>
          )}
          {/* 知识库自动参考指示器 */}
          <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 flex items-center gap-1">
            <BookOpen size={12} className="inline" /> <span>知识库已自动参考</span>
          </span>
          <button
            onClick={handleAnalyze}
            disabled={selected.length === 0 || analyzing}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm disabled:opacity-50"
          >
            {analyzing ? "分析中..." : "AI分析选中"}
          </button>
        </div>
      </div>

      {/* 分析进度提示 */}
      {analyzeMsg && (
        <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-4 py-2">
          <Loader2 size={14} className="animate-spin" />
          {analyzeMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">全部平台</option>
          <option value="google_trends">Google Trends</option>
          <option value="reddit">Reddit</option>
          <option value="hackernews">Hacker News</option>
          <option value="producthunt">Product Hunt</option>
          <option value="youtube">YouTube</option>
          <option value="trustmrr">TrustMRR</option>
          <option value="xiaohongshu">小红书</option>
          <option value="twitter">X/Twitter</option>
          <option value="quora">Quora</option>
          <option value="zhihu">知乎</option>
          <option value="v2ex">V2EX</option>
          <option value="weibo">微博</option>
          <option value="tieba">贴吧</option>
          <option value="bilibili">B站</option>
        </select>
        <input
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs"
        />
        <button onClick={selectAll} className="text-sm text-blue-600 hover:underline">
          {data && selected.length === (data?.items || []).length ? "取消全选" : "全选"}
        </button>
      </div>

      {/* Items */}
      {error && <ApiErrorBanner error={error} onRetry={reload} />}
      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : !error ? (
        <>
          <div className="text-sm text-gray-400">共 {data?.total || 0} 条数据</div>
          <div className="space-y-2">
            {(data?.items || []).map((item) => {
              let metrics: Record<string, unknown> = {};
              try { metrics = JSON.parse(item.metrics || "{}"); } catch {}
              let tags: string[] = [];
              try { tags = JSON.parse(item.tags || "[]"); } catch {}

              return (
                <div
                  key={item.id}
                  className={`bg-white border rounded-lg p-3 flex gap-3 items-start cursor-pointer transition-colors ${
                    selected.includes(item.id) ? "border-blue-400 bg-blue-50" : "hover:border-gray-300"
                  }`}
                  onClick={() => toggleSelect(item.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <PlatformBadge platform={item.platform} />
                      <SentimentBadge sentiment={item.sentiment} />
                      {metrics.score != null && (
                        <span className="text-xs text-gray-400">score: {String(metrics.score)}</span>
                      )}
                    </div>
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    {item.content && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.content}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {tags.length > 0 && tags.slice(0, 5).map((t, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-500 hover:underline ml-auto"
                        >
                          查看原文 ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
