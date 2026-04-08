"use client";

import { useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/useApi";
import { useAuth } from "@/components/auth/AuthProvider";
import { ProjectFile } from "@/lib/types";

// ── File size formatter ───────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── MIME type icon ────────────────────────────────────────────────────────

function MimeIcon({ mime }: { mime: string }) {
  // Determine icon based on mime category
  const category = mime.split("/")[0];
  const subtype = mime.split("/")[1] || "";

  let iconPath: string;
  let iconColor: string;

  if (category === "image") {
    iconPath =
      "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z";
    iconColor = "text-pink-500";
  } else if (
    subtype.includes("pdf") ||
    subtype.includes("document") ||
    subtype.includes("word")
  ) {
    iconPath =
      "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z";
    iconColor = "text-red-500";
  } else if (
    subtype.includes("spreadsheet") ||
    subtype.includes("excel") ||
    subtype.includes("csv")
  ) {
    iconPath =
      "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2";
    iconColor = "text-green-500";
  } else if (category === "video") {
    iconPath =
      "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z";
    iconColor = "text-purple-500";
  } else if (category === "audio") {
    iconPath =
      "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3";
    iconColor = "text-orange-500";
  } else if (
    subtype.includes("zip") ||
    subtype.includes("rar") ||
    subtype.includes("tar") ||
    subtype.includes("gzip")
  ) {
    iconPath =
      "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4";
    iconColor = "text-yellow-600";
  } else {
    // Default file icon
    iconPath =
      "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";
    iconColor = "text-blue-500";
  }

  return (
    <svg
      className={`w-8 h-8 ${iconColor}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d={iconPath}
      />
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export default function FilesPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const projectId = Number(params.id);

  const {
    data: files,
    loading,
    reload,
  } = useApi<ProjectFile[]>(() => api.projectFiles(projectId), [projectId]);

  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = files ?? [];

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const handleUpload = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setUploading(true);
      try {
        for (let i = 0; i < fileList.length; i++) {
          const formData = new FormData();
          formData.append("file", fileList[i]);
          await api.uploadFile(projectId, formData);
        }
        await reload();
      } catch (err) {
        console.error("Failed to upload file:", err);
      } finally {
        setUploading(false);
        // Reset the file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [projectId, reload]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }

  async function handleDelete(fileId: number) {
    try {
      await api.deleteFile(projectId, fileId);
      setDeleteConfirm(null);
      await reload();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  }

  function handleDownload(file: ProjectFile) {
    const link = document.createElement("a");
    link.href = `/api/projects/${projectId}/files/${file.id}/download`;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">
          <svg
            className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-500"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p>加载文件...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">项目文件</h1>
          <p className="text-sm text-gray-500 mt-1">
            共 {list.length} 个文件
          </p>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; 返回项目
        </button>
      </div>

      {/* Upload Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 mb-6 text-center cursor-pointer transition-all ${
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
          <div className="flex flex-col items-center">
            <svg
              className="animate-spin h-8 w-8 text-blue-500 mb-3"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-sm text-gray-600">上传中...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <svg
              className={`w-10 h-10 mb-3 ${
                dragOver ? "text-blue-500" : "text-gray-400"
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="text-sm font-medium text-gray-700">
              拖拽文件到此处上传
            </p>
            <p className="text-xs text-gray-400 mt-1">
              或点击选择文件
            </p>
          </div>
        )}
      </div>

      {/* Empty State */}
      {list.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <svg
            className="mx-auto h-12 w-12 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <p className="text-lg font-medium">暂无文件</p>
          <p className="text-sm mt-1">上传文件到项目中</p>
        </div>
      )}

      {/* File List */}
      {list.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">文件名</th>
                <th className="px-4 py-3 w-24">大小</th>
                <th className="px-4 py-3 w-28">上传者</th>
                <th className="px-4 py-3 w-36">上传时间</th>
                <th className="px-4 py-3 w-24 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((file) => (
                <tr
                  key={file.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <MimeIcon mime={file.mime_type} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {file.filename}
                        </p>
                        <p className="text-xs text-gray-400">
                          {file.mime_type}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatFileSize(file.file_size)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {file.uploader_name || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {formatDate(file.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleDownload(file)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                        title="下载"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </button>

                      <div className="relative">
                        <button
                          onClick={() =>
                            setDeleteConfirm(
                              deleteConfirm === file.id ? null : file.id
                            )
                          }
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          title="删除"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>

                        {deleteConfirm === file.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-10 w-52">
                            <p className="text-xs text-gray-600 mb-2">
                              确定删除此文件？
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleDelete(file.id)}
                                className="px-2.5 py-1 text-xs bg-red-600 text-white hover:bg-red-700 rounded"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
