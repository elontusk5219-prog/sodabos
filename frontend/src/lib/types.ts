export interface DataSource {
  id: number;
  name: string;
  platform: string;
  enabled: number;
  fetch_interval: number;
  last_fetched_at: string | null;
  config: string;
}

export interface RawItem {
  id: number;
  source_id: number;
  title: string;
  content: string;
  url: string;
  platform: string;
  metrics: string;
  sentiment: string | null;
  tags: string;
  fetched_at: string;
  created_at: string;
}

export interface Demand {
  id: number;
  title: string;
  description: string;
  source_items: string;
  stage: string;
  score_total: number;
  score_pain: number;
  score_competition: number;
  score_cold_start: number;
  score_cost: number;
  score_virality: number;
  score_ltv: number;
  score_ai_opportunity: number;
  ai_analysis: string;
  signal_count?: number;
  platforms?: string;
  track?: string;           // "A"=痛点洞察 "B"=竞品洞察
  competitive_ref?: string; // 对标产品
  insight_layer?: "conventional" | "trending" | "first_principles";
  created_at: string;
  updated_at: string;
}

export interface Trend {
  id?: number;
  keyword: string;
  platform: string;
  value: number;
  previous_value?: number;
  change_percent: number;
  recorded_at?: string;
  sub?: string;
}

export interface DashboardData {
  total_items: number;
  items_today: number;
  total_demands: number;
  avg_score: number;
  total_sources: number;
  active_sources: number;
  top_platforms: { platform: string; count: number }[];
  recent_trends: Trend[];
  recent_items: { id: number; title: string; platform: string; url: string; sentiment: string; fetched_at: string }[];
  stages: Record<string, number>;
}

export const PLATFORM_COLORS: Record<string, string> = {
  google_trends: "#4285F4",
  reddit: "#FF4500",
  hackernews: "#FF6600",
  producthunt: "#DA552F",
  youtube: "#FF0000",
  trustmrr: "#10B981",
  xiaohongshu: "#FE2C55",
  twitter: "#1DA1F2",
  quora: "#B92B27",
  zhihu: "#0066FF",
  v2ex: "#333333",
  weibo: "#E6162D",
  tieba: "#4879BD",
  bilibili: "#00A1D6",
  fiverr: "#1DBF73",
  etsy: "#F1641E",
};

export const PLATFORM_NAMES: Record<string, string> = {
  google_trends: "Google Trends",
  reddit: "Reddit",
  hackernews: "Hacker News",
  producthunt: "Product Hunt",
  youtube: "YouTube",
  trustmrr: "TrustMRR",
  xiaohongshu: "小红书",
  twitter: "X/Twitter",
  quora: "Quora",
  zhihu: "知乎",
  v2ex: "V2EX",
  weibo: "微博",
  tieba: "贴吧",
  bilibili: "B站",
  fiverr: "Fiverr",
  etsy: "Etsy",
};

export const STAGE_NAMES: Record<string, string> = {
  discovered: "已发现",
  filtered: "已过滤",
  validated: "已验证",
};

// ── 知识库类型 ─────────────────────────────────────────────────────────────

// ── 竞品洞察类型 ───────────────────────────────────────────────────────────

export interface CompetitiveProduct {
  id: string;
  name: string;
  tagline: string;
  description: string;
  votes: number;
  comments: number;
  website: string;
  url: string;
  thumbnail: string;
  topics: string[];
  source: string;
  mrr?: string;
}

export interface CompetitiveAngle {
  angle: string;
  title: string;
  why: string;
  how: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface CompetitiveAnalysis {
  product_id: string;
  product_name: string;
  angles: CompetitiveAngle[];
  has_comments: boolean;
  has_cross_platform: boolean;
  ts: number;
}

export interface KnowledgeDoc {
  id: number;
  title: string;
  category: string;
  file_type: string;
  char_count: number;
  chunks_count: number;
  created_by: string;
  created_at: string;
}

export interface KnowledgeChunkResult {
  chunk_id: number;
  doc_id: number;
  doc_title: string;
  category: string;
  content: string;
  rank: number;
}

export interface KnowledgeAskResponse {
  answer: string;
  sources: string[];
}

// ── PM Agent 类型 ────────────────────────────────────────────────────────

export interface AgentStatus {
  enabled: boolean;
  cycle_interval: number;
  auto_investigate_threshold: number;
  running: boolean;
  last_run: AgentRun | null;
  pending_checkpoints: number;
}

export interface AgentRun {
  id?: number;
  run_id: string;
  status: string;
  phase: string;
  reasoning_log: { phase: string; summary: string }[];
  world_state?: Record<string, unknown>;
  decisions?: Record<string, unknown>[];
  started_at: string;
  completed_at: string | null;
  created_at?: string;
  error: string | null;
}

export interface AgentCheckpoint {
  id: number;
  run_id: string;
  checkpoint_type: string;
  demand_id: number;
  proposal: string;
  status: string;
  urgency: "auto" | "inform" | "ask";
  user_feedback: string | null;
  created_at: string;
  resolved_at: string | null;
  // joined from demands
  demand_title?: string;
  demand_description?: string;
  score_total?: number;
  score_pain?: number;
  score_ai_opportunity?: number;
  track?: string;
  insight_layer?: "conventional" | "trending" | "first_principles";
  plan_steps?: string[];
}

export interface AgentArtifact {
  id: number;
  run_id: string;
  demand_id: number;
  artifact_type: "signal_report" | "simulation" | "decision_rationale";
  content: Record<string, unknown>;
  created_at: string;
}

export interface WeeklyRetro {
  period: string;
  generated_at: string;
  total_cycles: number;
  success_rate: string;
  total_recommendations: number;
  adoption_rate: string;
  urgency_distribution: { ask: number; inform: number; auto: number };
  insight_layer_distribution: Record<string, number>;
  insight_layer_adoption: Record<string, number>;
  platform_quality: Record<string, number>;
  report_md: string;
}

// ── 用户系统 ──────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
  role: string;
  is_active?: number;
  last_login_at?: string;
  created_at?: string;
}

// ── 项目系统 ──────────────────────────────────────────────────────────

export const PROJECT_STAGES = [
  { key: "discover", label: "发现需求" },
  { key: "value_filter", label: "价值过滤" },
  { key: "validate", label: "验证需求" },
  { key: "pmf", label: "PMF验证" },
  { key: "business_model", label: "商业模型验证" },
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number]["key"];

export interface Project {
  id: number;
  title: string;
  description: string;
  demand_id?: number;
  current_stage: ProjectStage;
  status: string;
  created_by?: number;
  tags: string;
  created_at: string;
  updated_at: string;
  // deployment links
  landing_page_url?: string;
  mvp_url?: string;
  analytics_dashboard_url?: string;
  stats_api_url?: string;
  // joined fields
  member_count?: number;
  doc_count?: number;
  creator_name?: string;
  latest_analytics?: ProjectAnalytics | null;
}

export interface ProjectAnalytics {
  id: number;
  project_id: number;
  recorded_date: string;
  visits: number;
  signups: number;
  active_users: number;
  revenue: number;
  custom_metrics: Record<string, unknown>;
  notes: string;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  user_id: number;
  role: string;
  joined_at: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
}

export interface StageDeliverable {
  id: number;
  stage: string;
  doc_type: string;
  title: string;
  description: string;
  is_required: number;
  sort_order: number;
  ai_generatable: number;
  // runtime
  completed?: boolean;
  document_id?: number;
}

export interface ProjectDocument {
  id: number;
  project_id: number;
  doc_type: string;
  title: string;
  content: string;
  stage: string;
  generated_by: string;
  version: number;
  status: string;
  created_by?: number;
  updated_by?: number;
  created_at: string;
  updated_at: string;
  creator_name?: string;
}

export interface ProjectFile {
  id: number;
  project_id: number;
  document_id?: number;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by?: number;
  created_at: string;
  uploader_name?: string;
}

export interface DiscussionThread {
  id: number;
  project_id: number;
  document_id?: number;
  title: string;
  thread_type: string;
  created_by?: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
  creator_name?: string;
}

export interface DiscussionMessage {
  id: number;
  thread_id: number;
  user_id?: number;
  role: string;
  content: string;
  metadata: string;
  created_at: string;
  username?: string;
  display_name?: string;
}

export interface StageGate {
  id: number;
  project_id: number;
  from_stage: string;
  to_stage: string;
  status: string;
  opened_by?: number;
  resolved_at?: string;
  created_at: string;
  votes?: StageGateVote[];
  opener_name?: string;
}

export interface StageGateVote {
  id: number;
  gate_id: number;
  user_id: number;
  vote: string;
  comment: string;
  voted_at: string;
  username?: string;
  display_name?: string;
}

export interface ActivityItem {
  id: number;
  project_id?: number;
  user_id?: number;
  action: string;
  target_type: string;
  target_id: number;
  detail: string;
  created_at: string;
  username?: string;
  display_name?: string;
  project_title?: string;
}

// ── 教训复盘 ──────────────────────────────────────────────────────────
export interface Lesson {
  id: number;
  title: string;
  category: string;
  severity: string;
  background: string;
  lesson: string;
  prevention_rule: string;
  related_demand_ids: string;
  related_project_id?: number;
  created_by?: number;
  creator_name?: string;
  created_at: string;
  updated_at: string;
}

export interface LessonInsights {
  total: number;
  categories: Record<string, number>;
  severities: Record<string, number>;
  patterns: string[];
  suggestions: string[];
  summary: string;
}

export interface Prototype {
  id: number;
  demand_id: number;
  checkpoint_id: number;
  title: string;
  description: string;
  html_path: string;
  feedback_score: number;
  feedback_notes: string;
  version: number;
  created_at: string;
}

// ── 圆桌讨论 ──
export interface RoundtableRoom {
  id: number;
  title: string;
  topic: string;
  project_id?: number;
  project_title?: string;
  created_by?: number;
  creator_name?: string;
  invite_token?: string;
  status: string;
  message_count?: number;
  last_message?: string;
  last_message_at?: string;
  participants?: string;
  created_at: string;
  updated_at: string;
}

export interface RoundtableMessage {
  id: number;
  room_id: number;
  sender_type: 'human' | 'claude_code' | 'pm_agent' | 'system';
  sender_name: string;
  user_id?: number;
  content: string;
  metadata: string;
  reply_to_id?: number | null;
  reply_to?: {
    id: number;
    sender_name: string;
    content: string;
    sender_type: string;
  } | null;
  created_at: string;
}
