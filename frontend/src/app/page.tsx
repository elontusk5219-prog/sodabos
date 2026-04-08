"use client";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import type { Project, ProjectAnalytics } from "@/lib/types";
import { useState, useEffect, useMemo } from "react";
import {
  Globe, Rocket, Sparkles, Loader2, Eye, UserPlus, Users, DollarSign,
  FolderOpen, TrendingUp, TrendingDown, Clock, Radio,
  ChevronDown, ChevronRight, BarChart3, MousePointerClick, Timer, Layers,
} from "lucide-react";
import { useAgentDrawer } from "@/contexts/AgentDrawerContext";

/* ── 常量 ────────────────────────────────────────────────────── */
const STAGE_LABELS: Record<string, string> = {
  discover: "发现", value_filter: "过滤", validate: "验证", pmf: "PMF", business_model: "商业",
};
const STAGE_COLORS: Record<string, string> = {
  discover: "bg-blue-100 text-blue-700", value_filter: "bg-yellow-100 text-yellow-700",
  validate: "bg-purple-100 text-purple-700", pmf: "bg-green-100 text-green-700",
  business_model: "bg-orange-100 text-orange-700",
};

const CN: Record<string, string> = {
  totalPV: "总浏览量", uniqueVisitors: "独立访客", totalWaitlist: "候补名单",
  emailSubmits: "邮件提交", conversionRate: "转化率", totalSwipes: "总滑动",
  avgScrollDepth: "平均滚动深度", avgTimeOnPage: "平均停留时长",
  landing_view: "落地页浏览", entrance_select: "选择入口", career_select: "选择职业",
  level_select: "选择等级", lesson_started: "开始课程", quiz_completed: "完成测验",
  lesson_completed: "完成课程", saw_paywall: "看到付费墙", clicked_pay: "点击付费",
  submitted_info: "提交信息", page_view: "页面浏览", paywall_view: "付费墙浏览",
  thankyou_view: "感谢页浏览", paywall_dismiss: "关闭付费墙", profile_submit: "提交资料",
  total_signups: "总注册", today_signups: "今日注册", conversion_rate: "转化率",
  page_views_total: "总浏览量", today_page_views: "今日浏览",
  avg_time_on_page_sec: "平均停留(秒)", avg_scroll_depth_pct: "滚动深度%",
  share_rate: "分享率", survey_completion_rate: "问卷完成率", viral_coefficient: "病毒系数",
  visits: "访问量", signups: "注册数", active_users: "活跃用户", revenue: "收入",
  hero: "首屏", how_it_works: "使用方式", chat_demo: "聊天演示", cta: "行动号召",
  gradual_reveal: "渐进展示", quote: "引言", section_view: "板块浏览",
  card_shown: "卡片展示", card_swipe: "卡片滑动", scroll_depth: "滚动深度",
  showcase_loaded: "展示加载", time_on_page: "停留时长", cards_exhausted: "卡片翻完",
  test: "测试",
};
function cn(key: string): string { return CN[key] || key.replace(/_/g, " "); }

/* ── 趋势徽章 ────────────────────────────────────────────────── */
function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return <span className="text-[10px] text-green-600 font-medium">NEW</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return pct > 0
    ? <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-medium"><TrendingUp size={10} />+{pct}%</span>
    : <span className="inline-flex items-center gap-0.5 text-[10px] text-red-500 font-medium"><TrendingDown size={10} />{pct}%</span>;
}

/* ── 水平条形图 ──────────────────────────────────────────────── */
function HBar({ items, color = "hsl(220,65%,55%)" }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-[11px] text-[#6B6B6B] w-24 text-right truncate">{item.label}</span>
          <div className="flex-1 bg-[#F0EDE8] rounded-full h-5 relative overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, backgroundColor: `hsl(${220 - i * 15}, 60%, ${52 + i * 3}%)` }}
            />
          </div>
          <span className="text-[11px] font-semibold text-[#1A1A1A] w-10 text-right">{item.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/* ── 漏斗图 ──────────────────────────────────────────────────── */
function FunnelChart({ steps }: { steps: { label: string; value: number }[] }) {
  const max = steps[0]?.value || 1;
  return (
    <div className="space-y-0.5">
      {steps.map((step, i) => {
        const pct = max > 0 ? (step.value / max) * 100 : 0;
        const convRate = i > 0 && steps[i - 1].value > 0
          ? Math.round((step.value / steps[i - 1].value) * 100) : null;
        return (
          <div key={step.label} className="flex items-center gap-2">
            <span className="text-[11px] text-[#6B6B6B] w-24 text-right truncate">{step.label}</span>
            <div className="flex-1 flex justify-center">
              <div
                className="h-7 rounded transition-all duration-500 flex items-center justify-center"
                style={{
                  width: `${Math.max(pct, 8)}%`,
                  backgroundColor: `hsl(${220 - i * 12}, 65%, ${50 + i * 4}%)`,
                }}
              >
                <span className="text-[10px] font-bold text-white drop-shadow">{step.value}</span>
              </div>
            </div>
            <span className="text-[10px] text-[#9B9B9B] w-10 text-right">
              {convRate !== null ? `${convRate}%` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── 排行榜 ──────────────────────────────────────────────────── */
function RankingTable({ items, labelKey, valueKey, subKey }: {
  items: Record<string, unknown>[]; labelKey: string; valueKey: string; subKey?: string;
}) {
  const sorted = [...items].sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0));
  return (
    <div className="space-y-0.5">
      {sorted.slice(0, 8).map((item, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
            i < 3 ? "bg-[#354DAA] text-white" : "bg-[#F0EDE8] text-[#6B6B6B]"
          }`}>{i + 1}</span>
          <span className="flex-1 text-[12px] text-[#1A1A1A] truncate">{String(item[labelKey] || "")}</span>
          {subKey && <span className="text-[10px] text-[#9B9B9B]">{String(item[subKey] || "")}</span>}
          <span className="text-[12px] font-semibold text-[#1A1A1A]">{Number(item[valueKey] || 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

/* ── 指标卡片 ────────────────────────────────────────────────── */
function MetricCard({ label, value, icon: Icon, trend }: {
  label: string; value: string | number; icon?: React.ElementType;
  trend?: { current: number; previous: number };
}) {
  return (
    <div className="bg-[#FAFAF8] border border-[#E8E5E0] rounded-lg px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[#9B9B9B] truncate">{label}</span>
        {trend && <TrendBadge current={trend.current} previous={trend.previous} />}
      </div>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={14} className="text-[#354DAA]" />}
        <span className="text-lg font-semibold text-[#1A1A1A]">
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
      </div>
    </div>
  );
}

/* ── 分区卡片 ────────────────────────────────────────────────── */
function SectionCard({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-[#FAFAF8] border border-[#E8E5E0] rounded-lg p-4">
      <div className="text-xs font-semibold text-[#6B6B6B] mb-3 flex items-center gap-1.5">
        <Icon size={13} className="text-[#354DAA]" /> {title}
      </div>
      {children}
    </div>
  );
}

/* ── 项目大卡片 ──────────────────────────────────────────────── */
function ProjectCard({ project }: { project: Project }) {
  const { openDrawer } = useAgentDrawer();
  const [fullData, setFullData] = useState<{ raw: Record<string, unknown>; cn: Record<string, unknown> } | null>(null);
  const [liveFlat, setLiveFlat] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ProjectAnalytics[] | null>(null);
  const [expanded, setExpanded] = useState(true);
  const hasStatsApi = !!project.stats_api_url;

  // Fetch full data + live flat
  useEffect(() => {
    if (!hasStatsApi) return;
    let cancelled = false;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [full, live] = await Promise.all([
          api.statsFull(project.id).catch(() => null),
          api.statsLive(project.id).catch(() => null),
        ]);
        if (!cancelled) {
          if (full) setFullData(full);
          if (live) setLiveFlat(live);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    };
    fetchAll();
    const timer = setInterval(fetchAll, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [project.id, hasStatsApi]);

  // Fetch history for trends
  useEffect(() => {
    (async () => {
      try { const d = await api.projectAnalytics(project.id, 14); if (d?.history) setHistory(d.history); } catch {}
    })();
  }, [project.id]);

  const raw = fullData?.raw as Record<string, unknown> | undefined;
  const isLive = liveFlat && liveFlat.live;

  // Core metrics from live flat
  const visits = Number(liveFlat?.visits || project.latest_analytics?.visits || 0);
  const signups = Number(liveFlat?.signups || project.latest_analytics?.signups || 0);
  const activeUsers = Number(liveFlat?.active_users || project.latest_analytics?.active_users || 0);
  const revenue = Number(liveFlat?.revenue || project.latest_analytics?.revenue || 0);
  const prev = history && history.length > 1 ? history[1] : null;

  // Extract rich data sections from raw
  const overview = raw?.overview as Record<string, unknown> | undefined;
  const engagement = raw?.engagement as Record<string, unknown> | undefined;
  const swipeRanking = raw?.swipeRanking as Record<string, unknown>[] | undefined;
  const eventCounts = raw?.eventCounts as Record<string, unknown>[] | undefined;
  const sections = (engagement?.sections || []) as { section: string; count: number }[];

  // NoFOMO funnel from data[0]
  const nofomData = (raw?.data as Record<string, unknown>[] | undefined)?.[0];
  const funnelKeys = ["landing_view", "entrance_select", "career_select", "level_select",
    "lesson_started", "quiz_completed", "lesson_completed", "saw_paywall", "clicked_pay", "submitted_info"];
  const funnelSteps = nofomData
    ? funnelKeys.filter(k => nofomData[k] !== undefined).map(k => ({ label: cn(k), value: Number(nofomData[k]) }))
    : [];

  // BlendIn flat metrics
  const blendInKeys = ["total_signups", "today_signups", "conversion_rate", "page_views_total",
    "today_page_views", "avg_time_on_page_sec", "avg_scroll_depth_pct", "share_rate",
    "survey_completion_rate", "viral_coefficient"];
  const blendInMetrics = raw && !overview && !nofomData
    ? blendInKeys.filter(k => raw[k] !== undefined).map(k => ({ key: k, label: cn(k), value: raw[k] }))
    : [];

  // Overview extra metrics (Mirage)
  const overviewExtras = overview
    ? Object.entries(overview).filter(([k]) => !["totalPV", "uniqueVisitors"].includes(k))
    : [];

  const dataTime = project.latest_analytics?.recorded_date || null;
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

  const handleAnalyze = () => {
    openDrawer(`请查询并深度分析项目「${project.title}」(ID:${project.id})的完整运营数据，找出关键问题和优化方向。`);
  };

  return (
    <div className="bg-white border border-[#E8E5E0] rounded-lg overflow-hidden hover:shadow-md transition-shadow duration-150">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[#9B9B9B] hover:text-[#1A1A1A]">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <a href={`/projects/${project.id}`}
            className="text-base font-semibold text-[#1A1A1A] hover:text-[#354DAA] transition-colors truncate">
            {project.title}
          </a>
          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STAGE_COLORS[project.current_stage] || "bg-gray-100 text-gray-600"}`}>
            {STAGE_LABELS[project.current_stage] || project.current_stage}
          </span>
          {loading && <Loader2 size={14} className="animate-spin text-[#9B9B9B]" />}
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
              <Radio size={9} className="animate-pulse" /> 实时
            </span>
          )}
          {!isLive && dataTime && (
            <span className="inline-flex items-center gap-1 text-[10px] text-[#9B9B9B]">
              <Clock size={9} /> {dataTime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {project.landing_page_url && (
            <a href={project.landing_page_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-[#354DAA] px-2 py-1 rounded-md hover:bg-[#F5F3EF]">
              <Globe size={13} /> Landing
            </a>
          )}
          {project.mvp_url && (
            <a href={project.mvp_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-[#354DAA] px-2 py-1 rounded-md hover:bg-[#F5F3EF]">
              <Rocket size={13} /> MVP
            </a>
          )}
          <button onClick={handleAnalyze}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#354DAA] hover:bg-[#EEF1FB] px-2.5 py-1.5 rounded-md transition-colors">
            <Sparkles size={13} /> 分析
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* 核心指标 */}
          <div className="grid grid-cols-4 gap-3">
            <MetricCard label="访问量" value={visits} icon={Eye}
              trend={prev ? { current: visits, previous: prev.visits } : undefined} />
            <MetricCard label="注册数" value={signups} icon={UserPlus}
              trend={prev ? { current: signups, previous: prev.signups } : undefined} />
            <MetricCard label="活跃用户" value={activeUsers} icon={Users}
              trend={prev ? { current: activeUsers, previous: prev.active_users } : undefined} />
            <MetricCard label="收入" value={`$${revenue.toLocaleString()}`} icon={DollarSign}
              trend={prev ? { current: revenue, previous: prev.revenue } : undefined} />
          </div>

          {/* Mirage: 概览扩展 + 板块浏览 + 事件分布 + 滑动排行 */}
          {overview && (
            <div className="grid grid-cols-3 gap-3">
              {overviewExtras.map(([k, v]) => (
                <MetricCard key={k} label={cn(k)} value={typeof v === "number" ? v : String(v)} />
              ))}
            </div>
          )}

          {sections.length > 0 && (
            <SectionCard title="板块浏览热度" icon={Layers}>
              <HBar items={sections.map(s => ({ label: cn(s.section), value: s.count }))} />
            </SectionCard>
          )}

          {eventCounts && eventCounts.length > 0 && (
            <SectionCard title="事件分布" icon={MousePointerClick}>
              <HBar items={eventCounts.map(e => ({
                label: cn(String(e.event || e.event_name || "")),
                value: Number(e.count || e.cnt || 0),
              }))} />
            </SectionCard>
          )}

          {swipeRanking && swipeRanking.length > 0 && (
            <SectionCard title="角色滑动排行" icon={BarChart3}>
              <RankingTable items={swipeRanking} labelKey="name" valueKey="total" subKey="likeRate" />
            </SectionCard>
          )}

          {engagement && (
            <div className="grid grid-cols-2 gap-3">
              {engagement.avgScrollDepth !== undefined && (
                <MetricCard label="平均滚动深度" value={String(engagement.avgScrollDepth)} icon={Layers} />
              )}
              {engagement.avgTimeOnPage !== undefined && (
                <MetricCard label="平均停留时长" value={String(engagement.avgTimeOnPage)} icon={Timer} />
              )}
            </div>
          )}

          {/* NoFOMO: 转化漏斗 */}
          {funnelSteps.length >= 3 && (
            <SectionCard title="转化漏斗" icon={BarChart3}>
              <FunnelChart steps={funnelSteps} />
            </SectionCard>
          )}

          {/* NoFOMO: 事件分布 (from data array's event_counts query — we use raw.data) */}

          {/* BlendIn: 扁平指标 */}
          {blendInMetrics.length > 0 && (
            <>
              <div className="text-xs font-semibold text-[#6B6B6B]">详细指标</div>
              <div className="grid grid-cols-4 gap-3">
                {blendInMetrics.map(m => (
                  <MetricCard key={m.key} label={m.label} value={typeof m.value === "number" ? m.value : String(m.value)} />
                ))}
              </div>
            </>
          )}

          {/* 无数据 */}
          {!visits && !signups && !activeUsers && !revenue && !overview && !nofomData && blendInMetrics.length === 0 && (
            <div className="text-xs text-[#9B9B9B] py-2">暂无运营数据</div>
          )}

          {/* 时间 */}
          {isLive && (
            <div className="text-[10px] text-[#9B9B9B] pt-1 border-t border-[#F0EDE8]">
              实时数据 · 最后刷新 {now} · 每分钟自动更新
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 紧凑卡片 ────────────────────────────────────────────────── */
function CompactProjectCard({ project }: { project: Project }) {
  return (
    <a href={`/projects/${project.id}`}
      className="bg-white border border-[#E8E5E0] rounded-lg p-4 hover:shadow-sm hover:border-[#354DAA]/30 transition-all flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <FolderOpen size={16} className="text-[#9B9B9B] flex-shrink-0" />
        <span className="text-sm font-medium text-[#1A1A1A] truncate">{project.title}</span>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STAGE_COLORS[project.current_stage] || "bg-gray-100 text-gray-600"}`}>
        {STAGE_LABELS[project.current_stage] || project.current_stage}
      </span>
    </a>
  );
}

/* ── 已部署项目横向滚动卡片 ───────────────────────────────────── */
function DeployedProjectStrip({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-[#6B6B6B] uppercase tracking-wider">已部署项目</h2>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-[#E8E5E0]">
        {projects.map(p => {
          const a = p.latest_analytics;
          const metrics = [
            { label: "访问", value: a?.visits ?? 0, icon: Eye },
            { label: "注册", value: a?.signups ?? 0, icon: UserPlus },
            { label: "活跃", value: a?.active_users ?? 0, icon: Users },
            { label: "收入", value: a?.revenue ?? 0, icon: DollarSign, prefix: "$" },
          ];
          return (
            <div
              key={p.id}
              className="flex-shrink-0 w-72 bg-white border border-[#E8E5E0] rounded-lg p-4 hover:shadow-md hover:border-[#354DAA]/30 transition-all"
            >
              {/* 项目名 + 阶段徽章 */}
              <div className="flex items-center gap-2 mb-3">
                <a
                  href={`/projects/${p.id}`}
                  className="text-sm font-semibold text-[#1A1A1A] hover:text-[#354DAA] transition-colors truncate"
                >
                  {p.title}
                </a>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                    STAGE_COLORS[p.current_stage] || "bg-gray-100 text-gray-600"
                  }`}
                >
                  {STAGE_LABELS[p.current_stage] || p.current_stage}
                </span>
              </div>

              {/* 链接按钮 */}
              <div className="flex items-center gap-1.5 mb-3">
                {p.landing_page_url && (
                  <a
                    href={p.landing_page_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#6B6B6B] hover:text-[#354DAA] px-2 py-1 rounded-md bg-[#F5F3EF] hover:bg-[#EEF1FB] transition-colors"
                  >
                    <Globe size={11} /> Landing
                  </a>
                )}
                {p.mvp_url && (
                  <a
                    href={p.mvp_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#6B6B6B] hover:text-[#354DAA] px-2 py-1 rounded-md bg-[#F5F3EF] hover:bg-[#EEF1FB] transition-colors"
                  >
                    <Rocket size={11} /> MVP
                  </a>
                )}
                {p.analytics_dashboard_url && (
                  <a
                    href={p.analytics_dashboard_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#6B6B6B] hover:text-[#354DAA] px-2 py-1 rounded-md bg-[#F5F3EF] hover:bg-[#EEF1FB] transition-colors"
                  >
                    <BarChart3 size={11} /> Dashboard
                  </a>
                )}
              </div>

              {/* 核心指标 */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {metrics.map(m => {
                  const Icon = m.icon;
                  return (
                    <div key={m.label} className="flex items-center gap-1.5">
                      <Icon size={11} className="text-[#9B9B9B] flex-shrink-0" />
                      <span className="text-[10px] text-[#9B9B9B]">{m.label}</span>
                      <span className="text-[11px] font-semibold text-[#1A1A1A] ml-auto">
                        {m.prefix || ""}{m.value.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 汇总条 ──────────────────────────────────────────────────── */
function SummaryBar({ projects }: { projects: Project[] }) {
  let tv = 0, ts = 0, ta = 0, tr = 0;
  for (const p of projects) { const a = p.latest_analytics; if (a) { tv += a.visits||0; ts += a.signups||0; ta += a.active_users||0; tr += a.revenue||0; } }
  const stats = [
    { label: "总访问", value: tv.toLocaleString(), icon: Eye },
    { label: "总注册", value: ts.toLocaleString(), icon: UserPlus },
    { label: "总活跃", value: ta.toLocaleString(), icon: Users },
    { label: "总收入", value: `$${tr.toLocaleString()}`, icon: DollarSign },
  ];
  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map(s => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="bg-white border border-[#E8E5E0] rounded-lg p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-[#EEF1FB] flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-[#354DAA]" />
            </div>
            <div>
              <div className="text-xs text-[#9B9B9B]">{s.label}</div>
              <div className="text-xl font-semibold text-[#1A1A1A]">{s.value}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-8 w-56 rounded-md" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <div key={i} className="skeleton h-20 rounded-lg" />)}</div>
      {[1,2].map(i => <div key={i} className="skeleton h-48 rounded-lg" />)}
    </div>
  );
}

/* ── 主页面 ──────────────────────────────────────────────────── */
export default function Dashboard() {
  const { data: deployedProjects, loading: l1 } = useApi<Project[]>(() => api.deployedProjects(), []);
  const { data: allProjects, loading: l2 } = useApi<Project[]>(() => api.projects(), []);
  if (l1 || l2) return <DashboardSkeleton />;
  const deployed = deployedProjects || [];
  const all = allProjects || [];
  const deployedIds = new Set(deployed.map(p => p.id));
  const otherProjects = all.filter(p => !deployedIds.has(p.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#1A1A1A]">项目运营总览</h1>
        <p className="text-sm text-[#9B9B9B] mt-0.5">已部署项目实时数据 · 数据每分钟自动刷新</p>
      </div>
      <SummaryBar projects={deployed} />
      <DeployedProjectStrip projects={deployed} />
      {deployed.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[#6B6B6B] uppercase tracking-wider">已部署项目</h2>
          {deployed.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <div className="bg-white border border-[#E8E5E0] rounded-lg p-8 text-center">
          <FolderOpen size={32} className="mx-auto text-[#E8E5E0] mb-2" />
          <div className="text-sm text-[#9B9B9B]">暂无已部署项目</div>
        </div>
      )}
      {otherProjects.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[#6B6B6B] uppercase tracking-wider">其他项目</h2>
          <div className="grid grid-cols-2 gap-3">
            {otherProjects.map(p => <CompactProjectCard key={p.id} project={p} />)}
          </div>
        </div>
      )}
    </div>
  );
}
