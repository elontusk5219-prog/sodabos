"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useCallback, useRef } from "react";
import { useApi } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { BookOpen, AlertTriangle, Circle, Globe, Rocket, BarChart3, ExternalLink, Plus, TrendingUp, TrendingDown, Minus, Edit2, Check, X, Users, Eye, UserPlus, DollarSign, Upload, FileText, Image, FileSpreadsheet, Film, Music, Archive, File, Trash2, Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import {
  PROJECT_STAGES,
  type Project,
  type ProjectMember,
  type ProjectAnalytics,
  type StageDeliverable,
  type ActivityItem,
  type StageGate,
  type ProjectFile,
} from "@/lib/types";

// ── Deployment & Analytics Section ─────────────────────────────────────────

function DeploymentSection({ project, pid }: { project: (Project & { members: ProjectMember[] }) | null | undefined; pid: number }) {
  const [editing, setEditing] = useState(false);
  const [urls, setUrls] = useState({ landing_page_url: "", mvp_url: "", analytics_dashboard_url: "", stats_api_url: "" });
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recordData, setRecordData] = useState({ visits: 0, signups: 0, active_users: 0, revenue: 0, notes: "" });
  const [saving, setSaving] = useState(false);

  const { data: analyticsData, reload: reloadAnalytics } = useApi<{
    history: ProjectAnalytics[];
    latest: ProjectAnalytics | null;
    trends: Record<string, number>;
  }>(() => api.projectAnalytics(pid, 30), [pid]);

  const startEdit = useCallback(() => {
    setUrls({
      landing_page_url: project?.landing_page_url || "",
      mvp_url: project?.mvp_url || "",
      analytics_dashboard_url: project?.analytics_dashboard_url || "",
      stats_api_url: project?.stats_api_url || "",
    });
    setEditing(true);
  }, [project]);

  const saveUrls = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateProject(pid, urls);
      setEditing(false);
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }, [pid, urls]);

  const handleRecord = useCallback(async () => {
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.recordAnalytics(pid, { recorded_date: today, ...recordData });
      setShowRecordForm(false);
      setRecordData({ visits: 0, signups: 0, active_users: 0, revenue: 0, notes: "" });
      reloadAnalytics();
    } finally {
      setSaving(false);
    }
  }, [pid, recordData, reloadAnalytics]);

  const hasAnyUrl = project?.landing_page_url || project?.mvp_url || project?.analytics_dashboard_url || project?.stats_api_url;
  const latest = analyticsData?.latest;
  const trends = analyticsData?.trends || {};

  const linkItems = [
    { key: "landing_page_url" as const, label: "Landing Page", icon: <Globe size={16} className="text-blue-500" /> },
    { key: "mvp_url" as const, label: "MVP", icon: <Rocket size={16} className="text-purple-500" /> },
    { key: "analytics_dashboard_url" as const, label: "数据看板", icon: <BarChart3 size={16} className="text-green-500" /> },
    { key: "stats_api_url" as const, label: "Stats API", icon: <TrendingUp size={16} className="text-orange-500" /> },
  ];

  const metricItems = [
    { key: "visits" as const, label: "访问量", icon: <Eye size={18} className="text-blue-500" />, color: "blue" },
    { key: "signups" as const, label: "注册数", icon: <UserPlus size={18} className="text-green-500" />, color: "green" },
    { key: "active_users" as const, label: "活跃用户", icon: <Users size={18} className="text-purple-500" />, color: "purple" },
    { key: "revenue" as const, label: "收入", icon: <DollarSign size={18} className="text-orange-500" />, color: "orange", prefix: "¥" },
  ];

  function TrendBadge({ value }: { value?: number }) {
    if (value === undefined || value === null) return null;
    if (value > 0) return <span className="text-xs text-green-600 flex items-center gap-0.5"><TrendingUp size={12} />+{value}%</span>;
    if (value < 0) return <span className="text-xs text-red-600 flex items-center gap-0.5"><TrendingDown size={12} />{value}%</span>;
    return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus size={12} />0%</span>;
  }

  // Hide entire section if no URLs and no analytics
  if (!hasAnyUrl && !latest && !editing) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">部署与数据</h2>
          <button onClick={startEdit} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
            <Plus size={14} /> 添加部署链接
          </button>
        </div>
        <p className="text-sm text-gray-400 text-center py-4">添加部署链接后，可在此跟踪项目数据</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">部署与数据</h2>
        <div className="flex gap-2">
          {!editing && (
            <button onClick={startEdit} className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1">
              <Edit2 size={12} /> 编辑链接
            </button>
          )}
          <button
            onClick={() => setShowRecordForm(!showRecordForm)}
            className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={14} /> 记录数据
          </button>
        </div>
      </div>

      {/* Deployment Links */}
      {editing ? (
        <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
          {linkItems.map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              {item.icon}
              <span className="text-xs text-gray-500 w-24">{item.label}</span>
              <input
                value={urls[item.key]}
                onChange={(e) => setUrls({ ...urls, [item.key]: e.target.value })}
                placeholder={`https://...`}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <button onClick={saveUrls} disabled={saving} className="px-3 py-1 text-xs text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1">
              <Check size={12} /> 保存
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-500 bg-gray-100 rounded hover:bg-gray-200 flex items-center gap-1">
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      ) : (hasAnyUrl && (
        <div className="flex flex-wrap gap-3">
          {linkItems.map((item) => {
            const url = project?.[item.key];
            if (!url) return null;
            return (
              <a
                key={item.key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-700 transition-colors"
              >
                {item.icon}
                <span>{item.label}</span>
                <ExternalLink size={12} className="text-gray-400" />
              </a>
            );
          })}
        </div>
      ))}

      {/* Record Data Form */}
      {showRecordForm && (
        <div className="p-3 bg-blue-50 rounded-lg space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {metricItems.map((m) => (
              <div key={m.key} className="flex items-center gap-2">
                {m.icon}
                <label className="text-xs text-gray-500 w-16">{m.label}</label>
                <input
                  type="number"
                  value={recordData[m.key]}
                  onChange={(e) => setRecordData({ ...recordData, [m.key]: Number(e.target.value) })}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            ))}
          </div>
          <input
            value={recordData.notes}
            onChange={(e) => setRecordData({ ...recordData, notes: e.target.value })}
            placeholder="备注（选填）"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
          <button onClick={handleRecord} disabled={saving} className="px-3 py-1 text-xs text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50">
            {saving ? "保存中..." : "记录"}
          </button>
        </div>
      )}

      {/* Analytics Metrics — core 4 */}
      {latest && (
        <div className="grid grid-cols-4 gap-3">
          {metricItems.map((m) => (
            <div key={m.key} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                {m.icon}
                <span className="text-xs text-gray-500">{m.label}</span>
              </div>
              <div className="text-xl font-bold text-gray-900">
                {m.prefix || ""}{(latest[m.key] as number)?.toLocaleString() || 0}
              </div>
              <TrendBadge value={trends[m.key]} />
            </div>
          ))}
        </div>
      )}

      {/* Custom metrics from Stats API — dynamic */}
      {latest && latest.custom_metrics && (() => {
        const cm = typeof latest.custom_metrics === "string"
          ? (() => { try { return JSON.parse(latest.custom_metrics); } catch { return {}; } })()
          : latest.custom_metrics;
        const entries = Object.entries(cm).filter(([k]) => k !== "query" && k !== "count");
        if (entries.length === 0) return null;
        return (
          <div>
            <div className="text-xs text-gray-400 mb-2">扩展指标</div>
            <div className="grid grid-cols-3 gap-2">
              {entries.map(([key, value]) => (
                <div key={key} className="bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-500 truncate">{key}</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {typeof value === "number" ? value.toLocaleString() : String(value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {latest && (
        <div className="text-xs text-gray-400 text-right">
          最近更新: {latest.recorded_date}
          {latest.notes && <span className="ml-2">· {latest.notes}</span>}
        </div>
      )}

      {/* Analytics History Chart */}
      {analyticsData?.history && analyticsData.history.length > 1 && (() => {
        const chartData = [...analyticsData.history]
          .sort((a, b) => a.recorded_date.localeCompare(b.recorded_date))
          .map((h) => ({
            date: h.recorded_date.slice(5), // MM-DD
            visits: h.visits,
            signups: h.signups,
            active_users: h.active_users,
            revenue: h.revenue,
          }));
        return (
          <div>
            <div className="text-xs text-gray-400 mb-2">趋势 (近 {chartData.length} 条记录)</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#ccc" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#ccc" />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Line type="monotone" dataKey="visits" name="访问量" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="signups" name="注册数" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="active_users" name="活跃用户" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="revenue" name="收入" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}
    </div>
  );
}


// ── Project Reference Files Section ───────────────────────────────────────

function fileIcon(mime: string) {
  const cat = mime.split("/")[0];
  const sub = mime.split("/")[1] || "";
  if (cat === "image") return <Image size={16} className="text-pink-500" />;
  if (sub.includes("pdf") || sub.includes("document") || sub.includes("word"))
    return <FileText size={16} className="text-red-500" />;
  if (sub.includes("spreadsheet") || sub.includes("excel") || sub.includes("csv"))
    return <FileSpreadsheet size={16} className="text-green-500" />;
  if (cat === "video") return <Film size={16} className="text-purple-500" />;
  if (cat === "audio") return <Music size={16} className="text-orange-500" />;
  if (sub.includes("zip") || sub.includes("rar") || sub.includes("tar"))
    return <Archive size={16} className="text-yellow-600" />;
  return <File size={16} className="text-blue-500" />;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function ProjectFilesSection({ pid }: { pid: number }) {
  const { data: files, loading, reload } = useApi<ProjectFile[]>(
    () => api.projectFiles(pid),
    [pid],
  );
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = files ?? [];

  const handleUpload = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setUploading(true);
      try {
        for (let i = 0; i < fileList.length; i++) {
          const formData = new FormData();
          formData.append("file", fileList[i]);
          await api.uploadFile(pid, formData);
        }
        await reload();
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [pid, reload],
  );

  const handleDelete = useCallback(
    async (fileId: number) => {
      try {
        await api.deleteFile(pid, fileId);
        setDeleteConfirm(null);
        await reload();
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [pid, reload],
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">参考资料</h2>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${pid}/files`}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            管理全部文件 →
          </Link>
        </div>
      </div>

      {/* Compact upload area */}
      <div
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
        onClick={() => fileInputRef.current?.click()}
        className={`border border-dashed rounded-lg p-3 mb-4 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 bg-gray-50"
        } ${uploading ? "opacity-50 pointer-events-none" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        {uploading ? (
          <p className="text-xs text-gray-500">上传中...</p>
        ) : (
          <div className="flex items-center justify-center gap-2 text-gray-500">
            <Upload size={14} />
            <span className="text-xs">拖拽或点击上传参考资料（竞品分析、用户访谈、设计稿等）</span>
          </div>
        )}
      </div>

      {/* File list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse flex gap-3 items-center">
              <div className="w-4 h-4 bg-gray-200 rounded" />
              <div className="h-3 bg-gray-200 rounded flex-1" />
              <div className="h-3 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-2">
          暂无参考资料，上传你已有的文档到项目中
        </p>
      ) : (
        <div className="space-y-1.5">
          {list.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group transition-colors"
            >
              {fileIcon(file.mime_type)}
              <span className="text-sm text-gray-800 truncate flex-1 min-w-0">
                {file.filename}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {formatFileSize(file.file_size)}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <a
                  href={`/api/projects/${pid}/files/${file.id}/download`}
                  download={file.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 text-gray-400 hover:text-blue-600 rounded"
                  title="下载"
                >
                  <Download size={14} />
                </a>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirm(deleteConfirm === file.id ? null : file.id);
                    }}
                    className="p-1 text-gray-400 hover:text-red-600 rounded"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                  {deleteConfirm === file.id && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2.5 z-10 w-44">
                      <p className="text-xs text-gray-600 mb-2">确定删除？</p>
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                          className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                        >
                          取消
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(file.id); }}
                          className="px-2 py-1 text-xs bg-red-600 text-white hover:bg-red-700 rounded"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectOverviewPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const pid = Number(id);

  // Backend returns flat object: {id, title, ..., members: [...], current_stage_info: [...]}
  const { data: projectData } = useApi<Project & { members: ProjectMember[] }>(
    () => api.project(pid),
    [pid],
  );
  // Backend returns stages as top-level keys: {discover: [...], value_filter: [...], ...}
  const { data: progressData, loading: progressLoading } = useApi<
    Record<string, StageDeliverable[]>
  >(() => api.projectProgress(pid), [pid]);
  const { data: activityData, loading: activityLoading } = useApi<ActivityItem[]>(
    () => api.projectActivity(pid),
    [pid],
  );
  const { data: gatesData, loading: gatesLoading, reload: reloadGates } = useApi<StageGate[]>(
    () => api.projectGates(pid),
    [pid],
  );

  const [openingGate, setOpeningGate] = useState(false);
  const [votingGate, setVotingGate] = useState(false);
  const [voteComment, setVoteComment] = useState("");

  // Backend returns flat object with members embedded, not {project, members}
  const project = projectData;
  const members = projectData?.members ?? [];

  // ── Stage progress section ────────────────────────────────────────────
  const currentStageIdx = PROJECT_STAGES.findIndex((s) => s.key === project?.current_stage);

  // Check if all required deliverables for current stage are done
  // Backend returns deliverables directly under stage key (no .deliverables wrapper)
  const currentStageDeliverables =
    progressData?.[project?.current_stage ?? ""] ?? [];
  const allRequiredDone = currentStageDeliverables
    .filter((d) => d.is_required)
    .every((d) => d.completed);

  // Find open gate
  const openGate = gatesData?.find((g) => g.status === "open");
  const userAlreadyVoted = openGate?.votes?.some((v) => v.user_id === user?.id);

  const handleOpenGate = async () => {
    setOpeningGate(true);
    try {
      await api.openGate(pid);
      reloadGates();
    } finally {
      setOpeningGate(false);
    }
  };

  const handleVote = async (vote: "approve" | "reject") => {
    if (!openGate) return;
    setVotingGate(true);
    try {
      await api.voteGate(pid, openGate.id, { vote, comment: voteComment });
      setVoteComment("");
      reloadGates();
    } finally {
      setVotingGate(false);
    }
  };

  // ── Time helpers ──────────────────────────────────────────────────────
  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  }

  function daysSince(dateStr: string) {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }

  // ── Project Lessons Component ─────────────────────────────────────────
  function ProjectLessons({ projectId, projectTitle }: { projectId: number; projectTitle: string }) {
    const [showAdd, setShowAdd] = useState(false);
    const [title, setTitle] = useState("");
    const [lesson, setLesson] = useState("");
    const [category, setCategory] = useState("other");
    const [severity, setSeverity] = useState("medium");
    const [background, setBackground] = useState("");
    const [preventionRule, setPreventionRule] = useState("");
    const [saving, setSaving] = useState(false);

    const { data: lessonsData, reload: reloadLessons } = useApi<{ lessons?: Array<{
      id: number; title: string; lesson: string; category: string; severity: string;
      background: string; prevention_rule: string; creator_name: string; created_at: string;
    }> }>(
      () => api.lessons({ project_id: String(projectId) }),
      [projectId],
    );
    const lessons = lessonsData?.lessons ?? (Array.isArray(lessonsData) ? lessonsData : []);

    const sevIcon: Record<string, React.ReactNode> = {
      high: <Circle size={12} className="inline text-red-500 fill-red-500" />,
      medium: <Circle size={12} className="inline text-yellow-500 fill-yellow-500" />,
      low: <Circle size={12} className="inline text-green-500 fill-green-500" />,
    };
    const catLabel: Record<string, string> = {
      product_direction: "产品方向", tech_choice: "技术选型",
      market_judgment: "市场判断", execution: "执行问题", other: "其他",
    };

    const handleSave = async () => {
      if (!title || !lesson) return;
      setSaving(true);
      try {
        const result = await api.createLesson({
          title, lesson, category, severity, background, prevention_rule: preventionRule,
          related_project_id: projectId, related_demand_ids: [],
        });
        // trigger learn
        try { await api.learnLesson(result.id); } catch {}
        setShowAdd(false);
        setTitle(""); setLesson(""); setBackground(""); setPreventionRule("");
        reloadLessons();
      } finally { setSaving(false); }
    };

    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-1.5"><BookOpen size={18} className="inline" /> 教训复盘</h2>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            {showAdd ? "取消" : "+ 记录教训"}
          </button>
        </div>

        {showAdd && (
          <div className="space-y-3 mb-4 p-4 bg-gray-50 rounded-lg">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="教训标题"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs">
                <option value="product_direction">产品方向</option>
                <option value="tech_choice">技术选型</option>
                <option value="market_judgment">市场判断</option>
                <option value="execution">执行问题</option>
                <option value="other">其他</option>
              </select>
              <div className="flex gap-1">
                {(["high", "medium", "low"] as const).map((s) => (
                  <button key={s} onClick={() => setSeverity(s)}
                    className={`px-2 py-1 text-xs rounded ${severity === s ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"}`}>
                    {sevIcon[s]} {s === "high" ? "严重" : s === "medium" ? "中等" : "轻微"}
                  </button>
                ))}
              </div>
            </div>
            <textarea value={background} onChange={(e) => setBackground(e.target.value)}
              placeholder="发生了什么（背景）" rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
            <textarea value={lesson} onChange={(e) => setLesson(e.target.value)}
              placeholder="我们学到了什么（教训）*" rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
            <textarea value={preventionRule} onChange={(e) => setPreventionRule(e.target.value)}
              placeholder="如何预防（规则）" rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
            <button onClick={handleSave} disabled={saving || !title || !lesson}
              className="w-full py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50">
              {saving ? "保存中..." : "保存并让 Agent 学习"}
            </button>
          </div>
        )}

        {lessons.length > 0 ? (
          <div className="space-y-3">
            {lessons.map((l) => (
              <div key={l.id} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{sevIcon[l.severity] || sevIcon.medium}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-200 rounded-full text-gray-600">
                    {catLabel[l.category] || l.category}
                  </span>
                  <span className="text-sm font-medium text-gray-900 flex-1">{l.title}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{l.lesson}</p>
                {l.prevention_rule && (
                  <p className="text-xs text-orange-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} className="inline" /> 预防: {l.prevention_rule}</p>
                )}
                <div className="text-xs text-gray-400 mt-2">
                  {l.creator_name || "系统"} · {new Date(l.created_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">暂无教训记录，项目中的经验值得沉淀</p>
        )}

        {lessons.length > 0 && (
          <Link href="/lessons" className="block text-center text-xs text-blue-500 hover:text-blue-700 mt-3">
            查看所有教训 →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "文档数", value: project?.doc_count ?? 0, icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
          { label: "成员数", value: members.length, icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
          { label: "已创建", value: project ? `${daysSince(project.created_at)}天` : "-", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={stat.icon} />
              </svg>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Deployment & Analytics ─────────────────────────────────── */}
      <DeploymentSection project={project} pid={pid} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Stage Progress + Gate */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stage Deliverables */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">阶段交付物</h2>
            {progressLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3 items-center">
                    <div className="w-5 h-5 bg-gray-200 rounded" />
                    <div className="h-4 bg-gray-200 rounded flex-1" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {PROJECT_STAGES.map((stage, stageIdx) => {
                  const deliverables = progressData?.[stage.key] ?? [];
                  if (deliverables.length === 0) return null;
                  const isCurrentOrPast = stageIdx <= currentStageIdx;

                  return (
                    <div key={stage.key}>
                      <h3
                        className={`text-sm font-medium mb-2 ${
                          stageIdx === currentStageIdx
                            ? "text-blue-600"
                            : stageIdx < currentStageIdx
                              ? "text-green-600"
                              : "text-gray-400"
                        }`}
                      >
                        {stage.label}
                        {stageIdx === currentStageIdx && (
                          <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                            当前阶段
                          </span>
                        )}
                      </h3>
                      <ul className="space-y-2">
                        {deliverables.map((d) => (
                          <li key={d.id} className="flex items-center gap-3 group">
                            <div
                              className={`
                                w-5 h-5 rounded flex items-center justify-center flex-shrink-0
                                ${d.completed ? "bg-green-500 text-white" : "border-2 border-gray-300"}
                              `}
                            >
                              {d.completed && (
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span
                              className={`text-sm flex-1 ${
                                d.completed ? "text-gray-500 line-through" : "text-gray-900"
                              }`}
                            >
                              {d.title}
                              {d.is_required ? (
                                <span className="ml-1 text-red-400 text-xs">*</span>
                              ) : null}
                            </span>
                            {d.completed && d.document_id ? (
                              <Link
                                href={`/projects/${id}/documents`}
                                className="text-xs text-blue-500 hover:text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                查看
                              </Link>
                            ) : isCurrentOrPast && !d.completed ? (
                              <Link
                                href={`/projects/${id}/documents`}
                                className="text-xs text-blue-500 hover:text-blue-700 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                去创建
                              </Link>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reference Materials (Uploaded Files) */}
          <ProjectFilesSection pid={pid} />

          {/* Stage Gate */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">阶段评审</h2>
            {gatesLoading ? (
              <div className="animate-pulse h-16 bg-gray-100 rounded" />
            ) : openGate ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm">
                  <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                    评审中
                  </span>
                  <span className="text-gray-600">
                    {PROJECT_STAGES.find((s) => s.key === openGate.from_stage)?.label}
                    {" "}
                    <svg className="w-4 h-4 inline text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {" "}
                    {PROJECT_STAGES.find((s) => s.key === openGate.to_stage)?.label}
                  </span>
                  {openGate.opener_name && (
                    <span className="text-gray-400">
                      由 {openGate.opener_name} 发起
                    </span>
                  )}
                </div>

                {/* Existing votes */}
                {openGate.votes && openGate.votes.length > 0 && (
                  <div className="space-y-2">
                    {openGate.votes.map((v) => (
                      <div key={v.id} className="flex items-center gap-2 text-sm">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            v.vote === "approve" ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <span className="font-medium text-gray-700">
                          {v.display_name || v.username}
                        </span>
                        <span className={v.vote === "approve" ? "text-green-600" : "text-red-600"}>
                          {v.vote === "approve" ? "通过" : "驳回"}
                        </span>
                        {v.comment && (
                          <span className="text-gray-400">&mdash; {v.comment}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Vote form */}
                {!userAlreadyVoted ? (
                  <div className="space-y-3 pt-2 border-t border-gray-100">
                    <textarea
                      value={voteComment}
                      onChange={(e) => setVoteComment(e.target.value)}
                      placeholder="评审意见（选填）"
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleVote("approve")}
                        disabled={votingGate}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        通过
                      </button>
                      <button
                        onClick={() => handleVote("reject")}
                        disabled={votingGate}
                        className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        驳回
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">你已投票</p>
                )}
              </div>
            ) : (
              <div>
                {allRequiredDone ? (
                  <button
                    onClick={handleOpenGate}
                    disabled={openingGate}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {openingGate ? "发起中..." : "发起阶段评审"}
                  </button>
                ) : (
                  <p className="text-sm text-gray-400">
                    完成当前阶段的所有必需交付物后，可发起阶段评审
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Activity + Lessons */}
        <div className="space-y-6">
          {/* Lessons for this project */}
          <ProjectLessons projectId={pid} projectTitle={project?.title || ""} />

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">最近动态</h2>
            {activityLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-8 h-8 bg-gray-200 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-gray-200 rounded w-3/4" />
                      <div className="h-3 bg-gray-200 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activityData && activityData.length > 0 ? (
              <div className="space-y-4">
                {activityData.slice(0, 10).map((item) => (
                  <div key={item.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-xs font-medium text-gray-600">
                      {(item.display_name || item.username || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">{item.display_name || item.username}</span>
                        {" "}
                        <span className="text-gray-500">{item.action}</span>
                        {" "}
                        <span className="text-gray-600">{item.detail}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">暂无动态</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
