"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileUp, X, File, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import type { Demand } from "@/lib/types";

type Tab = "blank" | "from_demand" | "upload";

const TABS: { key: Tab; label: string }[] = [
  { key: "blank", label: "空白创建" },
  { key: "from_demand", label: "从需求创建" },
  { key: "upload", label: "上传文档创建" },
];

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
];
const ACCEPTED_EXTENSIONS = ".pdf,.docx,.md,.txt";

export default function NewProjectPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("blank");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Blank form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  // From demand state
  const [selectedDemandId, setSelectedDemandId] = useState<number | null>(null);
  const {
    data: demands,
    loading: demandsLoading,
  } = useApi<{ demands: Demand[]; total: number }>(() => api.demands(), []);

  const demandList = demands?.demands ?? [];
  const selectedDemand = demandList.find((d) => d.id === selectedDemandId) ?? null;

  // Upload state
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) =>
        ACCEPTED_TYPES.includes(f.type) ||
        /\.(pdf|docx|md|txt)$/i.test(f.name)
    );
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Submit handlers
  const handleBlankSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await api.createProject({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSubmitting(false);
    }
  };

  const handleDemandSubmit = async () => {
    if (!selectedDemand) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await api.createProject({
        title: selectedDemand.title,
        description: selectedDemand.description,
        demand_id: selectedDemand.id,
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setSubmitting(false);
    }
  };

  const handleUploadSubmit = async () => {
    if (files.length === 0) return;
    setSubmitting(true);
    setError(null);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      // Simulate progress since fetch doesn't support progress natively
      const progressTimer = setInterval(() => {
        setUploadProgress((prev) => (prev >= 90 ? 90 : prev + 10));
      }, 200);
      const project = await api.createProjectFromFiles(formData);
      clearInterval(progressTimer);
      setUploadProgress(100);
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传创建失败");
      setUploadProgress(0);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">新建项目</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              选择方式创建新项目
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setError(null);
              }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 text-red-600 rounded-lg p-3 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Tab: Blank */}
        {activeTab === "blank" && (
          <form onSubmit={handleBlankSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                项目标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入项目名称"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                项目描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简要描述项目目标和范围"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                标签
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="用逗号分隔，如: SaaS, AI, 效率工具"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !title.trim()}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              创建项目
            </button>
          </form>
        )}

        {/* Tab: From Demand */}
        {activeTab === "from_demand" && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                选择需求
              </label>
              {demandsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  加载需求列表...
                </div>
              ) : (
                <select
                  value={selectedDemandId ?? ""}
                  onChange={(e) =>
                    setSelectedDemandId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">请选择一个需求</option>
                  {demandList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} (评分: {Number(d.score_total).toFixed(1)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Selected demand preview */}
            {selectedDemand && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-medium text-sm text-gray-900">
                    {selectedDemand.title}
                  </h3>
                  <span className="text-lg font-bold text-blue-600 shrink-0">
                    {Number(selectedDemand.score_total).toFixed(1)}分
                  </span>
                </div>
                <p className="text-xs text-gray-500 line-clamp-3">
                  {selectedDemand.description}
                </p>
                <div className="flex gap-4 mt-3 text-xs text-gray-400">
                  <span>痛点: {selectedDemand.score_pain}</span>
                  <span>AI机会: {selectedDemand.score_ai_opportunity}</span>
                  <span>竞争: {selectedDemand.score_competition}</span>
                </div>
              </div>
            )}

            <button
              onClick={handleDemandSubmit}
              disabled={submitting || !selectedDemand}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              从需求创建项目
            </button>
          </div>
        )}

        {/* Tab: Upload */}
        {activeTab === "upload" && (
          <div className="space-y-5">
            {/* Drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400 bg-white"
              }`}
            >
              <FileUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600 font-medium">
                拖拽文件到此处，或点击选择文件
              </p>
              <p className="text-xs text-gray-400 mt-1">
                支持 PDF、DOCX、MD、TXT 格式，可多选
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_EXTENSIONS}
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2"
                  >
                    <File className="w-4 h-4 text-gray-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatSize(file.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload progress */}
            {submitting && uploadProgress > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>上传中...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleUploadSubmit}
              disabled={submitting || files.length === 0}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              上传并创建项目
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
