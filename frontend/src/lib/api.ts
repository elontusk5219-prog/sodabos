import { authFetch } from "./auth";

const BASE = "/api";

async function request(path: string, options?: RequestInit) {
  const res = await authFetch(`${BASE}${path}`, options);
  if (res.status === 401) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new Error("Authentication failed (401)");
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// For multipart uploads (no Content-Type header - browser sets boundary)
async function uploadRequest(path: string, formData: FormData) {
  const { getToken } = await import("./auth");
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Upload error ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API error (${res.status}): ${text.slice(0, 200)}`);
  }
}

export const api = {
  // 通用请求（供页面直接调用新端点）
  request,

  dashboard: () => request("/dashboard"),
  wordcloud: () => request("/dashboard/wordcloud"),
  refreshWordcloud: () => request("/dashboard/wordcloud/refresh", { method: "POST" }),

  // Sources
  sources: () => request("/sources"),
  toggleSource: (id: number) => request(`/sources/${id}/toggle`, { method: "PUT" }),
  fetchSource: (id: number) => request(`/sources/${id}/fetch`, { method: "POST" }),
  fetchAll: () => request("/sources/fetch-all", { method: "POST" }),
  fetchStatus: () => request("/sources/fetch-status"),

  // Items
  items: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/items${q}`);
  },
  platforms: () => request("/items/platforms"),

  // Demands
  demands: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/demands${q}`);
  },
  demand: (id: number) => request(`/demands/${id}`),
  updateDemand: (id: number, data: Record<string, unknown>) =>
    request(`/demands/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDemand: (id: number) => request(`/demands/${id}`, { method: "DELETE" }),
  dismissDemand: (id: number, reason: string, note?: string) =>
    request(`/demands/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  reviewDemand: (id: number, action: string, reason?: string, note?: string) =>
    request(`/demands/${id}/review`, { method: "POST", body: JSON.stringify({ action, reason, note }) }),
  myReviewedIds: () => request("/demands/my-reviewed-ids"),

  // Validation (Google Trends as verification tool)
  validateDemand: (demandId: number, keywords?: string[]) =>
    request("/validation/validate-demand", {
      method: "POST",
      body: JSON.stringify({ demand_id: demandId, keywords: keywords || [] }),
    }),
  quickTrends: (keywords: string[]) =>
    request("/validation/quick-trends", { method: "POST", body: JSON.stringify({ keywords }) }),
  validationHistory: (demandId: number) => request(`/validation/validation-history/${demandId}`),

  // Trends
  trends: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/trends${q}`);
  },
  keywords: () => request("/trends/keywords"),

  // Analysis
  analyze: (data: { item_ids?: number[]; platform?: string; auto?: boolean; use_knowledge?: boolean }) =>
    request("/analysis/extract", { method: "POST", body: JSON.stringify(data) }),
  analysisStatus: (jobId: string) => request(`/analysis/status/${jobId}`),
  rescore: (id: number) =>
    request(`/analysis/rescore/${id}`, { method: "POST" }),

  // Knowledge Base
  knowledgeDocs: (category?: string) =>
    request(`/knowledge/docs${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  knowledgeDoc: (id: number) => request(`/knowledge/docs/${id}`),
  uploadDoc: (data: { title: string; category: string; file_type: string; raw_text: string; created_by: string }) =>
    request("/knowledge/docs", { method: "POST", body: JSON.stringify(data) }),
  deleteDoc: (id: number) => request(`/knowledge/docs/${id}`, { method: "DELETE" }),
  knowledgeCategories: () => request("/knowledge/categories"),
  knowledgeSearch: (query: string, category?: string) =>
    request("/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, category: category || "", limit: 5 }),
    }),
  knowledgeAsk: (question: string, category?: string) =>
    request("/knowledge/ask", {
      method: "POST",
      body: JSON.stringify({ question, category: category || "" }),
    }),

  // Competitive Analysis
  competitiveProducts: (source: string = "producthunt", limit: number = 20) =>
    request(`/competitive/products?source=${source}&limit=${limit}`),
  competitiveComments: (productId: string) =>
    request(`/competitive/product/${productId}/comments`),
  competitiveAnalyze: (productId: string, product: Record<string, unknown>) =>
    request(`/competitive/analyze/${productId}`, {
      method: "POST",
      body: JSON.stringify(product),
    }),

  // Feedback
  vote: (type: "wordcloud" | "demand", targetId: string, vote: 1 | -1) =>
    request("/feedback", { method: "POST", body: JSON.stringify({ type, target_id: targetId, vote }) }),
  feedbackVotes: () => request("/feedback/votes"),
  feedbackStats: () => request("/feedback/stats"),

  // PM Agent
  agentStatus: () => request("/agent/status"),
  agentToggle: () => request("/agent/toggle", { method: "POST" }),
  agentConfig: (data: Record<string, unknown>) =>
    request("/agent/config", { method: "PATCH", body: JSON.stringify(data) }),
  agentTrigger: () => request("/agent/trigger", { method: "POST" }),
  agentCheckpoints: (status: string = "pending", urgency?: string) => {
    const params = new URLSearchParams({ status });
    if (urgency) params.set("urgency", urgency);
    return request(`/agent/checkpoints?${params.toString()}`);
  },
  agentAutoLog: (limit: number = 50) =>
    request(`/agent/checkpoints/auto-log?limit=${limit}`),
  resolveCheckpoint: (id: number, data: { status: string; feedback?: string }) =>
    request(`/agent/checkpoints/${id}/resolve`, { method: "POST", body: JSON.stringify(data) }),
  agentQuestions: () => request("/agent/questions"),
  answerQuestion: (id: number, answer: string) =>
    request(`/agent/questions/${id}/answer`, { method: "POST", body: JSON.stringify({ answer }) }),
  agentRuns: (limit: number = 20) => request(`/agent/runs?limit=${limit}`),
  agentRun: (runId: string) => request(`/agent/runs/${runId}`),
  agentMemorySummary: () => request("/agent/memory/summary"),
  agentArtifacts: (demandId: number) => request(`/agent/artifacts/${demandId}`),
  agentRetro: () => request("/agent/retro"),
  agentRetroGenerate: () => request("/agent/retro/generate", { method: "POST" }),
  agentSkills: () => request("/agent/skills"),
  agentSkillOutputs: (demandId: number) => request(`/agent/skills/${demandId}`),
  triggerSkill: (demandId: number, skillName: string) =>
    request(`/agent/skills/${demandId}/${skillName}`, { method: "POST" }),

  // Agent Chat
  agentChat: (data: { demand_id?: number | null; message: string; angle_context?: string | null; session_id?: number | null }) =>
    request("/agent/chat", { method: "POST", body: JSON.stringify(data) }),
  agentChatHistory: () => request("/agent/chat/history"),
  agentChatSession: (sessionId: number) => request(`/agent/chat/session/${sessionId}`),

  // Prototypes
  agentPrototypes: (demandId?: number) =>
    request(`/agent/prototypes${demandId ? `?demand_id=${demandId}` : ""}`),
  prototypesFeedback: (id: number, data: { score: number; notes?: string }) =>
    request(`/agent/prototypes/${id}/feedback`, { method: "POST", body: JSON.stringify(data) }),
  prototypesRegenerate: (demandId: number, data: { feedback?: string }) =>
    request(`/agent/prototypes/${demandId}/regenerate`, { method: "POST", body: JSON.stringify(data) }),

  // ── Projects ───────────────────────────────────────────────────────────
  projects: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/projects${q}`);
  },
  projectsKanban: () => request("/projects/kanban"),
  project: (id: number) => request(`/projects/${id}`),
  createProject: (data: { title: string; description?: string; demand_id?: number }) =>
    request("/projects", { method: "POST", body: JSON.stringify(data) }),
  createProjectFromFiles: (formData: FormData) =>
    uploadRequest("/projects/create-from-files", formData),
  updateProject: (id: number, data: Record<string, unknown>) =>
    request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProject: (id: number) =>
    request(`/projects/${id}`, { method: "DELETE" }),
  killProject: (id: number, reason: string, category: string) =>
    request(`/projects/${id}/kill`, { method: "POST", body: JSON.stringify({ reason, category }) }),
  projectProgress: (id: number) => request(`/projects/${id}/progress`),
  addProjectMember: (id: number, userId: number) =>
    request(`/projects/${id}/members`, { method: "POST", body: JSON.stringify({ user_id: userId }) }),
  removeProjectMember: (id: number, userId: number) =>
    request(`/projects/${id}/members/${userId}`, { method: "DELETE" }),

  // ── Project Analytics ──────────────────────────────────────────────────
  deployedProjects: () => request("/projects/deployed"),
  projectAnalytics: (pid: number, days?: number) =>
    request(`/projects/${pid}/analytics${days ? `?days=${days}` : ""}`),
  recordAnalytics: (pid: number, data: { recorded_date: string; visits: number; signups: number; active_users: number; revenue: number; custom_metrics?: Record<string, unknown>; notes?: string }) =>
    request(`/projects/${pid}/analytics`, { method: "POST", body: JSON.stringify(data) }),
  statsQuery: (pid: number, q?: string) =>
    request(`/projects/${pid}/stats-query${q ? `?q=${q}` : ""}`),
  statsLive: (pid: number) =>
    request(`/projects/${pid}/stats-live`),
  statsFull: (pid: number) =>
    request(`/projects/${pid}/stats-full`),

  // ── Project Documents ──────────────────────────────────────────────────
  projectDocuments: (pid: number, stage?: string) => {
    const q = stage ? `?stage=${stage}` : "";
    return request(`/projects/${pid}/documents${q}`);
  },
  projectDocument: (pid: number, docId: number) =>
    request(`/projects/${pid}/documents/${docId}`),
  createDocument: (pid: number, data: { doc_type: string; title: string; content?: string; stage: string }) =>
    request(`/projects/${pid}/documents`, { method: "POST", body: JSON.stringify(data) }),
  updateDocument: (pid: number, docId: number, data: Record<string, unknown>) =>
    request(`/projects/${pid}/documents/${docId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteDocument: (pid: number, docId: number) =>
    request(`/projects/${pid}/documents/${docId}`, { method: "DELETE" }),
  generateDocument: (pid: number, data: { doc_type: string; extra_instructions?: string }) =>
    request(`/projects/${pid}/documents/generate`, { method: "POST", body: JSON.stringify(data) }),

  // ── Project Files ──────────────────────────────────────────────────────
  projectFiles: (pid: number) => request(`/projects/${pid}/files`),
  uploadFile: (pid: number, formData: FormData) =>
    uploadRequest(`/projects/${pid}/files`, formData),
  deleteFile: (pid: number, fileId: number) =>
    request(`/projects/${pid}/files/${fileId}`, { method: "DELETE" }),

  // ── Discussions ────────────────────────────────────────────────────────
  discussions: (pid: number) => request(`/projects/${pid}/discussions`),
  discussion: (pid: number, tid: number) =>
    request(`/projects/${pid}/discussions/${tid}`),
  createDiscussion: (pid: number, data: { title: string; document_id?: number; thread_type?: string }) =>
    request(`/projects/${pid}/discussions`, { method: "POST", body: JSON.stringify(data) }),
  postMessage: (pid: number, tid: number, content: string) =>
    request(`/projects/${pid}/discussions/${tid}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  postMessageWithAI: (pid: number, tid: number, content: string) =>
    request(`/projects/${pid}/discussions/${tid}/ai`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  // ── Stage Gates ────────────────────────────────────────────────────────
  projectGates: (pid: number) => request(`/projects/${pid}/gates`),
  openGate: (pid: number) =>
    request(`/projects/${pid}/gates`, { method: "POST" }),
  voteGate: (pid: number, gateId: number, data: { vote: string; comment?: string }) =>
    request(`/projects/${pid}/gates/${gateId}/vote`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Activity ───────────────────────────────────────────────────────────
  activity: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/activity${q}`);
  },
  projectActivity: (pid: number) => request(`/activity/project/${pid}`),

  // ── Stage Deliverables ─────────────────────────────────────────────────
  stageDeliverables: () => request("/projects/stage-deliverables"),

  // ── Lessons (教训复盘) ───────────────────────────────────────────────
  lessons: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/lessons${q}`);
  },
  lesson: (id: number) => request(`/lessons/${id}`),
  createLesson: (data: {
    title: string;
    category: string;
    severity: string;
    background: string;
    lesson: string;
    prevention_rule: string;
    related_demand_ids: number[];
    related_project_id?: number;
  }) => request("/lessons", { method: "POST", body: JSON.stringify(data) }),
  updateLesson: (id: number, data: Record<string, unknown>) =>
    request(`/lessons/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLesson: (id: number) => request(`/lessons/${id}`, { method: "DELETE" }),
  learnLesson: (id: number) =>
    request(`/lessons/${id}/learn`, { method: "POST" }),
  lessonInsights: () => request("/lessons/insights"),

  // ── Acquisition Agent ────────────────────────────────────────────────
  acqPersonaFromText: (text: string) =>
    request("/acquisition/persona/from-text", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  acqPersonaFromProject: (projectId: number) =>
    request(`/acquisition/persona/from-project/${projectId}`, { method: "POST" }),
  acqPersonas: () => request("/acquisition/personas"),
  acqPersona: (id: number) => request(`/acquisition/persona/${id}`),
  acqRun: (personaId: number) =>
    request(`/acquisition/run/${personaId}`, { method: "POST" }),
  acqRunStatus: (runId: number) => request(`/acquisition/run/${runId}/status`),
  acqRuns: () => request("/acquisition/runs"),
  acqLeads: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/acquisition/leads${q}`);
  },
  acqReplies: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/acquisition/replies${q}`);
  },
  acqStats: () => request("/acquisition/stats"),

  // ── Twitter Monitor ──────────────────────────────────────────────────
  twitterStatus: () => request("/twitter/status"),
  twitterTokens: () => request("/twitter/tokens"),
  twitterAddToken: (token: string, label?: string) =>
    request("/twitter/tokens", { method: "POST", body: JSON.stringify({ token, label }) }),
  twitterRemoveToken: (id: number) =>
    request(`/twitter/tokens/${id}`, { method: "DELETE" }),
  twitterResetToken: (id: number) =>
    request(`/twitter/tokens/${id}/reset`, { method: "POST" }),
  twitterHandles: () => request("/twitter/handles"),
  twitterAddHandle: (handle: string, label?: string) =>
    request("/twitter/handles", { method: "POST", body: JSON.stringify({ handle, label }) }),
  twitterRemoveHandle: (handle: string) =>
    request(`/twitter/handles/${handle}`, { method: "DELETE" }),
  twitterToggleHandle: (handle: string) =>
    request(`/twitter/handles/${handle}/toggle`, { method: "PUT" }),
  twitterFetch: (data?: { handles?: string[]; max_posts?: number }) =>
    request("/twitter/fetch", { method: "POST", body: JSON.stringify(data || {}) }),
  twitterResults: (params?: Record<string, string>) => {
    const q = params ? "?" + new URLSearchParams(params).toString() : "";
    return request(`/twitter/results${q}`);
  },

  // ── Roundtable ────────────────────────────────────────────────────────
  roundtableRooms: (status?: string) => request(`/roundtable/rooms${status ? `?status=${status}` : ''}`),
  roundtableRoom: (id: number, limit = 50) => request(`/roundtable/rooms/${id}?limit=${limit}`),
  createRoundtableRoom: (data: { title: string; topic?: string; project_id?: number }) =>
    request('/roundtable/rooms', { method: 'POST', body: JSON.stringify(data) }),
  postRoundtableMessage: (roomId: number, content: string, senderType = 'human', senderName = '', replyToId?: number | null) =>
    request(`/roundtable/rooms/${roomId}/messages`, {
      method: 'POST', body: JSON.stringify({ content, sender_type: senderType, sender_name: senderName, reply_to_id: replyToId || null })
    }),
  roundtableSummary: (roomId: number) =>
    request(`/roundtable/rooms/${roomId}/summary`, { method: 'POST' }),
};

// SSE streaming helper
export function streamChat(
  path: string,
  body: object,
  callbacks: {
    onStatus?: (phase: string, tool?: string, summary?: string) => void;
    onContent?: (text: string) => void;
    onDone?: (data: { session_id?: number; message_id?: number }) => void;
    onError?: (message: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const { getToken } = await import("./auth");
      const token = getToken();

      const res = await fetch(`/api${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        callbacks.onError?.(`API error ${res.status}: ${errText.slice(0, 200)}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError?.("No response stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventType) {
                case "status":
                  callbacks.onStatus?.(data.phase, data.tool, data.summary);
                  break;
                case "content":
                  callbacks.onContent?.(data.text);
                  break;
                case "done":
                  callbacks.onDone?.(data);
                  break;
                case "error":
                  callbacks.onError?.(data.message);
                  break;
              }
            } catch {
              // skip malformed JSON
            }
            eventType = "";
          }
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        callbacks.onError?.(e.message || "Stream failed");
      }
    }
  })();

  return controller;
}
