"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password, displayName);
      }
      router.push("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
      <div className="w-full max-w-md">
        <div className="bg-white border border-[#E8E5E0] rounded-xl shadow-lg p-8">
          {/* Brand */}
          <div className="text-center mb-8">
            <h1
              className="text-2xl font-bold text-[#1A1A1A] tracking-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              imsoda
            </h1>
            <p className="text-[#9B9B9B] text-sm mt-1">
              需求监控 · 项目管理 · AI 协作
            </p>
          </div>

          {/* Mode toggle — tab style with bottom border */}
          <div className="flex mb-6 border-b border-[#E8E5E0]">
            <button
              className={`flex-1 pb-2.5 text-sm font-medium transition-colors duration-150 relative ${
                mode === "login" ? "text-[#1A1A1A]" : "text-[#9B9B9B] hover:text-[#6B6B6B]"
              }`}
              onClick={() => setMode("login")}
            >
              登录
              {mode === "login" && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-[#354DAA] rounded-full" />
              )}
            </button>
            <button
              className={`flex-1 pb-2.5 text-sm font-medium transition-colors duration-150 relative ${
                mode === "register" ? "text-[#1A1A1A]" : "text-[#9B9B9B] hover:text-[#6B6B6B]"
              }`}
              onClick={() => setMode("register")}
            >
              注册
              {mode === "register" && (
                <div className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-[#354DAA] rounded-full" />
              )}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F3EF] border border-[#E8E5E0] rounded-lg text-sm text-[#1A1A1A] placeholder-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#354DAA]/30 focus:border-[#354DAA] transition-colors duration-150"
                placeholder="请输入用户名"
                required
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">显示名称</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#F5F3EF] border border-[#E8E5E0] rounded-lg text-sm text-[#1A1A1A] placeholder-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#354DAA]/30 focus:border-[#354DAA] transition-colors duration-150"
                  placeholder="团队中显示的名字"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#1A1A1A] mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#F5F3EF] border border-[#E8E5E0] rounded-lg text-sm text-[#1A1A1A] placeholder-[#9B9B9B] focus:outline-none focus:ring-2 focus:ring-[#354DAA]/30 focus:border-[#354DAA] transition-colors duration-150"
                placeholder="请输入密码"
                required
              />
            </div>

            {error && (
              <p className="text-sm text-[#DC4A3F]">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#354DAA] hover:bg-[#2A3F8E] text-white text-sm font-medium rounded-lg transition-colors duration-150 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  处理中...
                </>
              ) : (
                mode === "login" ? "登录" : "注册"
              )}
            </button>
          </form>

          <p className="text-xs text-[#9B9B9B] text-center mt-6">
            首个注册用户自动成为管理员
          </p>
        </div>
      </div>
    </div>
  );
}
