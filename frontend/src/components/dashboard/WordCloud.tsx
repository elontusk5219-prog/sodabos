"use client";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { X, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react";

interface Word {
  text: string;
  value: number;
  products?: string[];
}

interface WordcloudResponse {
  status: "ready" | "generating" | "error";
  words: Word[];
  error?: string;
}

interface ProcessedWord extends Word {
  size: number;
  color: string;
  opacity: number;
  weight: number;
}

interface PlacedWord extends ProcessedWord {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLORS = [
  "#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6",
  "#EC4899", "#06B6D4", "#F97316", "#6366F1", "#14B8A6",
  "#E11D48", "#7C3AED", "#0EA5E9", "#D946EF", "#84CC16",
];

/** Archimedean spiral layout — largest words placed first near center */
function layoutWords(words: ProcessedWord[], containerW: number, containerH: number): PlacedWord[] {
  if (containerW === 0 || containerH === 0) return [];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const placed: PlacedWord[] = [];
  const cx = containerW / 2;
  const cy = containerH / 2;
  const PAD = 5;

  for (const word of words) {
    const fw = word.weight === 700 ? "bold" : word.weight === 500 ? "500" : "normal";
    ctx.font = `${fw} ${word.size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const ww = ctx.measureText(word.text).width + 10;
    const wh = word.size + 6;

    let px = cx - ww / 2;
    let py = cy - wh / 2;
    let found = false;

    const maxR = Math.max(containerW, containerH) * 0.8;

    for (let r = 0; r <= maxR && !found; r += 3) {
      // denser angular sampling when close to center
      const steps = r < 1 ? 1 : Math.ceil((2 * Math.PI * r) / 6);
      for (let s = 0; s < steps; s++) {
        const theta = (s / steps) * 2 * Math.PI;
        const nx = cx + r * Math.cos(theta) - ww / 2;
        const ny = cy + r * 0.7 * Math.sin(theta) - wh / 2;

        if (nx < PAD || nx + ww > containerW - PAD || ny < PAD || ny + wh > containerH - PAD) continue;

        const overlaps = placed.some(
          (p) =>
            nx < p.x + p.w + PAD &&
            nx + ww > p.x - PAD &&
            ny < p.y + p.h + PAD &&
            ny + wh > p.y - PAD
        );

        if (!overlaps) {
          px = nx;
          py = ny;
          found = true;
          break;
        }
      }
    }

    if (found) placed.push({ ...word, x: px, y: py, w: ww, h: wh });
  }

  return placed;
}

export default function WordCloud() {
  const { data: rawData, loading, reload } = useApi<WordcloudResponse>(() => api.wordcloud());
  // Support both old (bare array) and new ({status, words}) response formats
  const data: Word[] | null = rawData
    ? Array.isArray(rawData) ? rawData : (rawData.words || [])
    : null;
  const wcStatus = rawData && !Array.isArray(rawData) ? rawData.status : (data && data.length > 0 ? "ready" : "generating");
  const wcError = rawData && !Array.isArray(rawData) ? rawData.error : undefined;
  const [selected, setSelected] = useState<Word | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [votes, setVotes] = useState<Record<string, 1 | -1>>({});
  const [placedWords, setPlacedWords] = useState<PlacedWord[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.feedbackVotes().then((allVotes: Record<string, number>) => {
      const wc: Record<string, 1 | -1> = {};
      for (const [key, v] of Object.entries(allVotes)) {
        if (key.startsWith("wordcloud:")) {
          wc[key.replace("wordcloud:", "")] = v as 1 | -1;
        }
      }
      setVotes(wc);
    }).catch(() => {});
  }, []);

  const handleVote = useCallback(async (word: string, vote: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = votes[word];
    const newVote = current === vote ? null : vote;
    if (newVote === null) return;
    setVotes((prev) => ({ ...prev, [word]: newVote }));
    await api.vote("wordcloud", word, newVote).catch(() => {});
  }, [votes]);

  // Sort largest first → placed near center
  const words: ProcessedWord[] = useMemo(() => {
    if (!data || data.length === 0) return [];
    // 直接用 value 线性换算字号，不归一化
    // value 1 → 12px, value 20 → 42px （每单位 1.5px）
    const maxVal = Math.max(...data.map((d) => d.value));
    return [...data]
      .sort((a, b) => b.value - a.value)
      .map((w, i) => {
        const size = Math.max(12, Math.min(42, 9 + w.value * 1.65));
        const t = w.value / maxVal; // 0..1 相对最大值
        return {
          ...w,
          size,
          color: COLORS[i % COLORS.length],
          opacity: 0.6 + t * 0.4,
          weight: size > 30 ? 700 : size > 22 ? 500 : 400,
        };
      });
  }, [data]);

  // Recompute layout after data changes or container resizes
  useLayoutEffect(() => {
    if (!words.length || !containerRef.current) return;
    const { offsetWidth, offsetHeight } = containerRef.current;
    if (!offsetWidth || !offsetHeight) return;
    setPlacedWords(layoutWords(words, offsetWidth, offsetHeight));
  }, [words]);

  // Close popover on outside click
  useEffect(() => {
    if (!selected) return;
    const handle = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelected(null);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [selected]);

  const handleWordClick = (w: PlacedWord, e: React.MouseEvent) => {
    if (!w.products?.length) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setSelected(selected?.text === w.text ? null : w);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setSelected(null);
    setPlacedWords([]);
    try {
      await api.refreshWordcloud(); // triggers background task, returns immediately
    } finally {
      setRefreshing(false);
    }
    // Start polling for result
    await reload();
  };

  // Auto-poll every 10s ONLY when backend says it's actively generating
  useEffect(() => {
    if (words.length > 0 || loading || refreshing || wcStatus !== "generating") return;
    const timer = setInterval(() => reload(), 10000);
    return () => clearInterval(timer);
  }, [words.length, loading, refreshing, wcStatus, reload]);

  if (loading && !refreshing) return <div className="text-gray-400 text-sm">Loading...</div>;
  if (!words.length && !loading && !refreshing) {
    // Show different messages depending on backend status
    if (wcStatus === "error") {
      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <span>词云生成失败{wcError === "no_data" ? "：暂无采集数据，请先采集" : "，请重试"}</span>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            重新生成
          </button>
        </div>
      );
    }
    if (wcStatus === "generating") {
      return (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>AI正在后台生成词云，请稍候...</span>
          </div>
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            重新生成
          </button>
        </div>
      );
    }
    // Fallback: unknown status or ready with no data
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span>暂无词云数据</span>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          生成词云
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-end mb-1">
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 disabled:opacity-50 transition-colors"
          title="清除缓存并重新生成词云（需要调用AI，约30秒）">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "生成中..." : "刷新"}
        </button>
      </div>

      {refreshing && (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" />
          正在调用AI重新分析数据，请稍候...
        </div>
      )}

      {!refreshing && (
        <div ref={containerRef} className="relative w-full" style={{ height: 440 }}>
          {placedWords.map((w, i) => (
            <span
              key={i}
              className={`absolute select-none transition-opacity duration-150 ${
                w.products?.length
                  ? "cursor-pointer hover:brightness-110 hover:drop-shadow-md"
                  : "cursor-default"
              } ${selected && selected.text !== w.text ? "opacity-20" : ""}`}
              style={{
                left: w.x,
                top: w.y,
                fontSize: w.size,
                color: w.color,
                opacity: selected && selected.text !== w.text ? 0.2 : w.opacity,
                fontWeight: w.weight,
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
              title={`${w.text}: ${w.value}次${w.products?.length ? " (点击查看产品方向)" : ""}`}
              onClick={(e) => handleWordClick(w, e)}
            >
              {w.text}
            </span>
          ))}
        </div>
      )}

      {selected && selected.products && selected.products.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-4 w-80"
          style={{
            left: Math.min(popoverPos.x, (containerRef.current?.offsetWidth || 400) - 330),
            top: popoverPos.y + 10,
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="font-semibold text-sm text-gray-900">
                {selected.text}
                <span className="ml-2 text-xs font-normal text-gray-500">出现{selected.value}次</span>
              </h4>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-gray-400">这个痛点判断准吗？</span>
                <button onClick={(e) => handleVote(selected.text, 1, e)}
                  className={`p-1 rounded transition-colors ${votes[selected.text] === 1 ? "text-green-600 bg-green-50" : "text-gray-300 hover:text-green-500"}`}>
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => handleVote(selected.text, -1, e)}
                  className={`p-1 rounded transition-colors ${votes[selected.text] === -1 ? "text-red-500 bg-red-50" : "text-gray-300 hover:text-red-400"}`}>
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 p-0.5 self-start">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">可能的产品方向：</p>
          <ul className="space-y-2">
            {selected.products.map((product, idx) => (
              <li key={idx}
                className="text-sm text-gray-700 pl-3 border-l-2 border-blue-400 leading-relaxed hover:bg-blue-50 rounded-r px-2 py-1 transition-colors">
                {product}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
