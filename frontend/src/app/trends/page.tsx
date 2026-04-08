"use client";
import { useState } from "react";
import { useApi, ApiErrorBanner } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { Trend } from "@/lib/types";
import { TrendingUp } from "lucide-react";

export default function TrendsPage() {
  const [keyword, setKeyword] = useState("");
  const { data: keywords, error: kwError, reload: reloadKw } = useApi<{ keyword: string; platform: string; max_val: number; max_change: number }[]>(
    () => api.keywords()
  );
  const { data: trends, loading, error: trendsError, reload: reloadTrends } = useApi<Trend[]>(
    () => api.trends(keyword ? { keyword } : {}),
    [keyword]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">趋势分析</h1>
        <button onClick={() => { reloadKw(); reloadTrends(); }} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-50">刷新</button>
      </div>

      {(kwError || trendsError) && <ApiErrorBanner error={kwError || trendsError || ""} onRetry={() => { reloadKw(); reloadTrends(); }} />}

      {/* Keyword cloud */}
      {keywords && (Array.isArray(keywords) ? keywords : []).length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">关键词趋势</h2>
          <div className="flex flex-wrap gap-2">
            {(Array.isArray(keywords) ? keywords : []).map((kw, i) => (
              <button
                key={i}
                onClick={() => setKeyword(kw.keyword === keyword ? "" : kw.keyword)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  kw.keyword === keyword
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-200 text-gray-600 hover:border-blue-300"
                }`}
              >
                {kw.keyword}
                {kw.max_change > 0 && (
                  <span className="text-green-500 ml-1">+{Math.round(kw.max_change)}%</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chart */}
      {trends && (Array.isArray(trends) ? trends : []).length > 0 ? (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-4">
            趋势图 {keyword && <span className="text-blue-600">- {keyword}</span>}
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={[...(Array.isArray(trends) ? trends : [])].reverse()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="recorded_at" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3B82F6" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : !loading ? (
        <div className="text-center text-gray-400 py-20">
          <div className="mb-4"><TrendingUp size={40} className="mx-auto text-gray-400" /></div>
          <div>暂无趋势数据，请先采集Google Trends数据</div>
        </div>
      ) : (
        <div className="text-gray-400">Loading...</div>
      )}

      {/* Trend table */}
      {trends && (Array.isArray(trends) ? trends : []).length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-medium mb-3">趋势明细</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">关键词</th>
                <th className="pb-2">平台</th>
                <th className="pb-2 text-right">当前值</th>
                <th className="pb-2 text-right">变化</th>
                <th className="pb-2 text-right">时间</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(trends) ? trends : []).slice(0, 30).map((t) => (
                <tr key={t.id} className="border-b border-gray-50">
                  <td className="py-1.5">{t.keyword}</td>
                  <td className="py-1.5">{t.platform}</td>
                  <td className="py-1.5 text-right">{t.value}</td>
                  <td className={`py-1.5 text-right ${(t.change_percent || 0) > 0 ? "text-green-600" : (t.change_percent || 0) < 0 ? "text-red-500" : ""}`}>
                    {(t.change_percent || 0) > 0 ? "+" : ""}{t.change_percent}%
                  </td>
                  <td className="py-1.5 text-right text-gray-400">{t.recorded_at?.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
