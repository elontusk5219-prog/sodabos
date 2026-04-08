"use client";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import Sidebar from "./Sidebar";
import FloatingAgent from "@/components/agent/FloatingAgent";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AgentDrawerProvider, useAgentDrawer } from "@/contexts/AgentDrawerContext";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { open } = useAgentDrawer();
  const isLoginPage = pathname === "/login";
  const isAgentPage = pathname.startsWith("/agent");
  const drawerActive = open && !isAgentPage && !isLoginPage;

  useEffect(() => {
    if (!loading && !user && !isLoginPage) {
      router.push("/login");
    }
  }, [loading, user, isLoginPage, router]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <span
            className="text-2xl font-bold text-[#1A1A1A] tracking-tight"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            imsoda
          </span>
          <div className="text-sm text-[#9B9B9B] font-medium">加载中...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main
        className="flex-1 bg-[#FAFAF8] p-6 overflow-auto transition-[margin] duration-200 ease-out"
        style={{ marginRight: drawerActive ? 380 : 0 }}
      >
        <div
          key={pathname}
          className="animate-[fadeIn_200ms_ease-out]"
          style={{ animation: "fadeIn 200ms ease-out" }}
        >
          {children}
        </div>
      </main>
      <FloatingAgent />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AgentDrawerProvider>
      <AppShellInner>{children}</AppShellInner>
    </AgentDrawerProvider>
  );
}
