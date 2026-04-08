"use client";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { Demand } from "@/lib/types";

const DIMS = [
  { key: "score_pain", label: "痛点" },
  { key: "score_competition", label: "竞争" },
  { key: "score_cold_start", label: "冷启" },
  { key: "score_cost", label: "成本" },
  { key: "score_virality", label: "裂变" },
  { key: "score_ltv", label: "LTV" },
  { key: "score_ai_opportunity", label: "AI机会" },
];

export default function ScoreRadar({ demand }: { demand: Demand }) {
  const data = DIMS.map((d) => ({
    dim: d.label,
    value: (demand as unknown as Record<string, unknown>)[d.key] as number || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <RadarChart data={data}>
        <PolarGrid />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 12 }} />
        <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
        <Radar dataKey="value" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.3} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
