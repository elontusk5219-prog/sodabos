"use client";
import { useApi, ApiErrorBanner } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { DataSource } from "@/lib/types";
import { PLATFORM_NAMES } from "@/lib/types";
import { useState, useEffect } from "react";

const CDP_PLATFORMS = ["xiaohongshu", "twitter", "quora"];

export default function SourcesPage() {
  const { data: sources, loading, error, reload } = useApi<DataSource[]>(() => api.sources());
  const [fetching, setFetching] = useState<number | null>(null);
  const [browserOk, setBrowserOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/sources/browser-status")
      .then((r) => r.json())
      .then((d) => setBrowserOk(d.available))
      .catch(() => setBrowserOk(false));
  }, []);

  const handleToggle = async (id: number) => {
    try {
      await api.toggleSource(id);
      reload();
    } catch (e) {
      console.error("切换状态失败:", e);
    }
  };

  const handleFetch = async (id: number) => {
    setFetching(id);
    try {
      const result = await api.fetchSource(id);
      alert(`采集完成: ${result?.items_fetched || 0} 条数据`);
      reload();
    } catch (e) {
      alert(`采集失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setFetching(null);
    }
  };

  const handleFetchAll = async () => {
    setFetching(-1);
    try {
      const result = await api.fetchAll();
      const summary = Object.entries(result?.results || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      alert(`采集完成:\n${summary}`);
      reload();
    } catch (e) {
      alert(`采集失败: ${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setFetching(null);
    }
  };

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (error) return <ApiErrorBanner error={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">数据源管理</h1>
        <button
          onClick={handleFetchAll}
          disabled={fetching !== null}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {fetching === -1 ? "采集中..." : "全部采集"}
        </button>
      </div>

      {/* CDP Browser Status */}
      <div className={`border rounded-lg p-3 text-sm ${browserOk ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${browserOk ? "bg-green-500" : "bg-yellow-500"}`} />
          <span className="font-medium">
            {browserOk ? "Chrome CDP 已连接" : "Chrome CDP 未连接"}
          </span>
          <span className="text-gray-500">
            - 小红书/Twitter/Quora需要通过Chrome浏览器采集
          </span>
        </div>
        {!browserOk && (
          <div className="mt-2 text-xs text-gray-500 font-mono bg-white rounded p-2">
            启动方式: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
          </div>
        )}
      </div>

      <div className="grid gap-4">
        {(Array.isArray(sources) ? sources : []).map((source) => (
          <div key={source.id} className="bg-white border rounded-lg p-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{PLATFORM_NAMES[source.platform] || source.name}</h3>
                {CDP_PLATFORMS.includes(source.platform) && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${browserOk ? "bg-green-100 text-green-600" : "bg-yellow-100 text-yellow-600"}`}>
                    {browserOk ? "CDP" : "需CDP"}
                  </span>
                )}
                <span
                  className={`w-2 h-2 rounded-full ${source.enabled ? "bg-green-500" : "bg-gray-300"}`}
                />
              </div>
              <div className="text-xs text-gray-400 mt-1">
                采集间隔: {Math.round(source.fetch_interval / 60)}分钟
                {source.last_fetched_at && ` | 上次采集: ${source.last_fetched_at.slice(0, 16)}`}
              </div>
            </div>
            <button
              onClick={() => handleToggle(source.id)}
              className={`px-3 py-1 rounded text-sm border ${
                source.enabled
                  ? "border-green-300 text-green-600"
                  : "border-gray-300 text-gray-400"
              }`}
            >
              {source.enabled ? "已启用" : "已禁用"}
            </button>
            <button
              onClick={() => handleFetch(source.id)}
              disabled={fetching !== null}
              className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-sm hover:bg-blue-100 disabled:opacity-50"
            >
              {fetching === source.id ? "采集中..." : "采集"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
