"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/components/auth/AuthProvider";
import { useState } from "react";
import {
  LayoutDashboard,
  Lightbulb,
  Kanban,
  Bot,
  MessageCircle,
  Search,
  Target,
  BookOpen,
  Rocket,
  Phone,
  Palette,
  TrendingUp,
  Settings,
  Link as LinkIcon,
  ChevronRight,
  LogOut,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const MAIN_NAV: NavItem[] = [
  { href: "/", label: "工作台", icon: <LayoutDashboard size={16} strokeWidth={1.75} /> },
  { href: "/demands", label: "需求池", icon: <Lightbulb size={16} strokeWidth={1.75} /> },
  { href: "/projects", label: "项目看板", icon: <Kanban size={16} strokeWidth={1.75} /> },
  { href: "/agent", label: "PM Agent", icon: <Bot size={16} strokeWidth={1.75} /> },
  { href: "/roundtable", label: "圆桌讨论", icon: <MessageCircle size={16} strokeWidth={1.75} /> },
];

const DATA_NAV: NavItem[] = [
  { href: "/discover", label: "数据发现", icon: <Search size={16} strokeWidth={1.75} /> },
  { href: "/competitive", label: "竞品洞察", icon: <Target size={16} strokeWidth={1.75} /> },
  { href: "/knowledge", label: "知识库", icon: <BookOpen size={16} strokeWidth={1.75} /> },
];

const MORE_NAV: NavItem[] = [
  { href: "/acquisition", label: "获客 Agent", icon: <Rocket size={16} strokeWidth={1.75} /> },
  { href: "/agent/meeting", label: "会议模式", icon: <Phone size={16} strokeWidth={1.75} /> },
  { href: "/prototypes", label: "原型预览", icon: <Palette size={16} strokeWidth={1.75} /> },
  { href: "/trends", label: "趋势分析", icon: <TrendingUp size={16} strokeWidth={1.75} /> },
  { href: "/sources", label: "数据源", icon: <Settings size={16} strokeWidth={1.75} /> },
  { href: "/mcp-guide", label: "MCP 接入", icon: <LinkIcon size={16} strokeWidth={1.75} /> },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const SideNavItem = ({ item }: { item: NavItem }) => {
    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link
        href={item.href}
        className={clsx(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors duration-100 relative group",
          isActive
            ? "bg-[rgba(255,255,255,0.08)] text-white font-medium"
            : "text-[#8F8F8F] hover:text-[#EBEBEB] hover:bg-[rgba(255,255,255,0.04)]"
        )}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-[#354DAA]" />
        )}
        <span className={clsx(
          "transition-colors duration-100",
          isActive ? "text-white" : "text-[#8F8F8F] group-hover:text-[#EBEBEB]"
        )}>
          {item.icon}
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <aside className="w-60 bg-[#191919] h-screen p-4 flex flex-col border-r border-white/5 sticky top-0">
      {/* Brand */}
      <div className="flex items-center px-3 mb-8 mt-2">
        <span className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          imsoda
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
        {MAIN_NAV.map((item) => (
          <SideNavItem key={item.href} item={item} />
        ))}

        {/* Data section */}
        <div className="pt-5 mt-5 border-t border-white/5">
          <p className="px-3 pb-2 text-[10px] font-semibold text-[#8F8F8F] uppercase tracking-[0.15em]">
            数据
          </p>
          {DATA_NAV.map((item) => (
            <SideNavItem key={item.href} item={item} />
          ))}
        </div>

        {/* More tools */}
        <div className="pt-5 mt-5 border-t border-white/5">
          <button
            onClick={() => setShowMore(!showMore)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-[#8F8F8F] hover:text-[#EBEBEB] hover:bg-[rgba(255,255,255,0.04)] w-full transition-colors duration-100"
          >
            <ChevronRight
              size={14}
              strokeWidth={1.75}
              className={clsx(
                "transition-transform duration-150",
                showMore && "rotate-90"
              )}
            />
            更多工具
          </button>
          <div className={clsx(
            "overflow-hidden transition-all duration-200",
            showMore ? "max-h-96 opacity-100 mt-0.5" : "max-h-0 opacity-0"
          )}>
            {MORE_NAV.map((item) => (
              <SideNavItem key={item.href} item={item} />
            ))}
          </div>
        </div>
      </nav>

      {/* User menu */}
      {user && (
        <div className="relative mt-4 border-t border-white/5 pt-4 shrink-0">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-[rgba(255,255,255,0.04)] transition-colors duration-100"
          >
            <div className="w-8 h-8 rounded-full bg-[#354DAA] text-white flex items-center justify-center text-xs font-bold">
              {(user?.display_name || user?.username || "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-[#EBEBEB] truncate text-[13px]">
                {user?.display_name || user?.username || "User"}
              </div>
              <div className="text-[11px] text-[#8F8F8F]">{user?.role || ""}</div>
            </div>
          </button>

          {showMenu && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-[#252525] border border-white/10 rounded-lg shadow-lg py-1 z-50">
              <button
                onClick={() => {
                  logout();
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] text-red-400 hover:bg-red-500/10 rounded-md transition-colors duration-100"
              >
                <LogOut size={14} strokeWidth={1.75} />
                退出登录
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
