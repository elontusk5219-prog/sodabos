import clsx from "clsx";

const COLORS: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  red: "bg-red-100 text-red-700",
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
  gray: "bg-gray-100 text-gray-600",
  orange: "bg-orange-100 text-orange-700",
  purple: "bg-purple-100 text-purple-700",
};

export default function Badge({
  children,
  color = "gray",
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        COLORS[color] || COLORS.gray
      )}
    >
      {children}
    </span>
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { label: string; color: string }> = {
    google_trends: { label: "Google Trends", color: "blue" },
    reddit: { label: "Reddit", color: "orange" },
    hackernews: { label: "HN", color: "orange" },
    producthunt: { label: "PH", color: "red" },
    youtube: { label: "YouTube", color: "red" },
    trustmrr: { label: "TrustMRR", color: "green" },
    xiaohongshu: { label: "小红书", color: "red" },
    twitter: { label: "X", color: "blue" },
    quora: { label: "Quora", color: "red" },
    zhihu: { label: "知乎", color: "blue" },
    v2ex: { label: "V2EX", color: "gray" },
    weibo: { label: "微博", color: "red" },
    tieba: { label: "贴吧", color: "blue" },
    bilibili: { label: "B站", color: "blue" },
  };
  const info = map[platform] || { label: platform, color: "gray" };
  return <Badge color={info.color}>{info.label}</Badge>;
}

export function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const map: Record<string, { label: string; color: string }> = {
    positive: { label: "正面", color: "green" },
    negative: { label: "负面", color: "red" },
    neutral: { label: "中性", color: "gray" },
  };
  const info = map[sentiment] || { label: sentiment, color: "gray" };
  return <Badge color={info.color}>{info.label}</Badge>;
}
