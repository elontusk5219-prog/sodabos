"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { KnowledgeDoc, KnowledgeAskResponse } from "@/lib/types";
import { CheckCircle, FileText, MessageCircle, BookOpen } from "lucide-react";

// ── 上传弹窗 ──────────────────────────────────────────────────────────────────
function UploadModal({
  categories,
  onClose,
  onUploaded,
}: {
  categories: string[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [fileType, setFileType] = useState("txt");
  const [rawText, setRawText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "txt";
    setFileType(ext === "md" ? "md" : "txt");
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = (ev) => setRawText((ev.target?.result as string) || "");
    reader.readAsText(file, "utf-8");
  }

  async function handleUpload() {
    const cat = customCategory.trim() || category;
    if (!title.trim() || !rawText.trim() || !cat) {
      setError("请填写标题、赛道分类，并选择文件");
      return;
    }
    setUploading(true);
    setError("");
    try {
      await api.uploadDoc({
        title: title.trim(),
        category: cat,
        file_type: fileType,
        raw_text: rawText,
        created_by: createdBy.trim(),
      });
      onUploaded();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">上传文档</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* 文件选择 */}
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {rawText ? (
            <p className="text-sm text-green-600 flex items-center justify-center gap-1"><CheckCircle size={14} className="inline" /> 已读取 {rawText.length.toLocaleString()} 字符</p>
          ) : (
            <>
              <p className="text-gray-500 text-sm">点击或拖拽上传 .txt / .md 文件</p>
              <p className="text-xs text-gray-400 mt-1">UTF-8 编码，无大小限制</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {/* 标题 */}
        <div>
          <label className="text-sm font-medium text-gray-700">文档标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：AI工具赛道竞品分析 2025"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* 赛道分类 */}
        <div>
          <label className="text-sm font-medium text-gray-700">赛道分类</label>
          <div className="flex gap-2 mt-1 flex-wrap">
            {(categories || []).map((c) => (
              <button
                key={c}
                onClick={() => { setCategory(c); setCustomCategory(""); }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  category === c && !customCategory
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-gray-300 text-gray-600 hover:border-blue-400"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            value={customCategory}
            onChange={(e) => { setCustomCategory(e.target.value); setCategory(""); }}
            placeholder="或输入新分类…"
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* 上传人 */}
        <div>
          <label className="text-sm font-medium text-gray-700">上传人</label>
          <input
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            placeholder="你的名字"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? "上传中…" : "确认上传"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filterCat, setFilterCat] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
  const [docDetail, setDocDetail] = useState<{ preview: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"preview" | "ask">("preview");
  const [showUpload, setShowUpload] = useState(false);

  // 提问状态
  const [question, setQuestion] = useState("");
  const [askCategory, setAskCategory] = useState("");
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<KnowledgeAskResponse | null>(null);

  // 删除确认
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function loadDocs() {
    try {
      const [docsData, catsData] = await Promise.all([
        api.knowledgeDocs(filterCat || undefined),
        api.knowledgeCategories(),
      ]);
      setDocs(Array.isArray(docsData) ? docsData : []);
      setCategories(Array.isArray(catsData) ? catsData : []);
    } catch (e) {
      console.error("知识库加载失败:", e);
      setDocs([]);
      setCategories([]);
    }
  }

  useEffect(() => { loadDocs(); }, [filterCat]); // eslint-disable-line

  async function loadDocDetail(doc: KnowledgeDoc) {
    setSelectedDoc(doc);
    setDocDetail(null);
    try {
      const detail = await api.knowledgeDoc(doc.id);
      setDocDetail(detail);
    } catch (e) {
      console.error("文档加载失败:", e);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteDoc(id);
      setDeletingId(null);
      if (selectedDoc?.id === id) { setSelectedDoc(null); setDocDetail(null); }
      loadDocs();
    } catch (e) {
      console.error("删除失败:", e);
      setDeletingId(null);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setAskResult(null);
    try {
      const res = await api.knowledgeAsk(question, askCategory || undefined);
      setAskResult(res);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">知识库</h1>
          <p className="text-sm text-gray-500 mt-0.5">上传市场分析、竞品格局文档，AI 分析时可参考</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <span>+</span> 上传文档
        </button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ── 左侧文档列表 ── */}
        <div className="w-72 flex flex-col gap-3">
          {/* 赛道筛选 */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterCat("")}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                !filterCat ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-blue-400"
              }`}
            >
              全部
            </button>
            {(categories || []).map((c) => (
              <button
                key={c}
                onClick={() => setFilterCat(c)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  filterCat === c ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-blue-400"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* 文档卡片列表 */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {docs.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2"><FileText size={32} className="mx-auto text-gray-400" /></p>
                <p className="text-sm">还没有文档</p>
                <p className="text-xs mt-1">点击右上角上传</p>
              </div>
            )}
            {docs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => loadDocDetail(doc)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedDoc?.id === doc.id
                    ? "border-blue-400 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {doc.category}
                      </span>
                      <span className="text-xs text-gray-400">
                        {((doc.char_count || 0) / 1000).toFixed(1)}k字
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {doc.created_by || "未知"} · {doc.created_at?.slice(0, 10)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingId(doc.id); }}
                    className="text-gray-300 hover:text-red-500 text-lg flex-shrink-0 transition-colors"
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 右侧功能区 ── */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 flex flex-col min-h-0">
          {/* Tab 切换 */}
          <div className="flex border-b border-gray-200 px-4">
            <button
              onClick={() => setActiveTab("preview")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "preview" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              文档预览
            </button>
            <button
              onClick={() => setActiveTab("ask")}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "ask" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <MessageCircle size={14} className="inline mr-1" /> 向AI提问
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* 文档预览 */}
            {activeTab === "preview" && (
              <div>
                {!selectedDoc ? (
                  <div className="text-center py-20 text-gray-400">
                    <p className="text-4xl mb-3"><BookOpen size={40} className="mx-auto text-gray-400" /></p>
                    <p className="text-sm">从左侧选择文档查看内容</p>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-gray-900">{selectedDoc.title}</h2>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">
                          {selectedDoc.category}
                        </span>
                        <span>{(selectedDoc.char_count || 0).toLocaleString()} 字</span>
                        <span>{selectedDoc.chunks_count || 0} 个知识块</span>
                        <span>上传者：{selectedDoc.created_by || "—"}</span>
                      </div>
                    </div>
                    {docDetail ? (
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-4 font-sans">
                        {docDetail.preview}
                        {(selectedDoc.char_count || 0) > 2000 && (
                          <span className="text-gray-400 block mt-2">
                            … （仅显示前 2000 字）
                          </span>
                        )}
                      </pre>
                    ) : (
                      <div className="text-center py-8 text-gray-400 text-sm">加载中…</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 向AI提问 */}
            {activeTab === "ask" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">限定赛道（可选）</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <button
                      onClick={() => setAskCategory("")}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                        !askCategory ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600"
                      }`}
                    >
                      全部
                    </button>
                    {(categories || []).map((c) => (
                      <button
                        key={c}
                        onClick={() => setAskCategory(c)}
                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                          askCategory === c ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">问题</label>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="例如：AI工具赛道有哪些头部竞品？它们的核心优劣势是什么？"
                    rows={3}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAsk();
                    }}
                  />
                  <p className="text-xs text-gray-400 mt-1">Cmd/Ctrl + Enter 发送</p>
                </div>

                <button
                  onClick={handleAsk}
                  disabled={asking || !question.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {asking ? "AI 正在检索知识库…" : "发送"}
                </button>

                {/* AI 回答 */}
                {askResult && (
                  <div className="mt-4 space-y-3">
                    <div className="bg-blue-50 rounded-xl p-4">
                      <p className="text-sm font-medium text-blue-800 mb-2">AI 回答</p>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {askResult.answer}
                      </div>
                    </div>
                    {(askResult?.sources || []).length > 0 && (
                      <div className="bg-gray-50 rounded-xl p-3">
                        <p className="text-xs font-medium text-gray-600 mb-1">参考来源</p>
                        {(askResult?.sources || []).map((s, i) => (
                          <p key={i} className="text-xs text-gray-500">· {s}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 上传弹窗 */}
      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => setShowUpload(false)}
          onUploaded={loadDocs}
        />
      )}

      {/* 删除确认 */}
      {deletingId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 mb-4">
              删除后文档及其所有知识块将永久移除，无法恢复。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
