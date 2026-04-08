"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Prototype } from "@/lib/types";

export default function PrototypesPage() {
  const [prototypes, setPrototypes] = useState<(Prototype & { demand_title?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.agentPrototypes().then((data: { prototypes: Prototype[] }) => {
      setPrototypes(data?.prototypes || []);
      setLoading(false);
    }).catch(() => {
      setPrototypes([]);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="p-6 text-gray-400">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Prototypes</h1>

      {prototypes.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">No prototypes yet</p>
          <p className="text-sm">Prototypes are generated after the PM Agent investigates a demand.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {prototypes.map((p) => (
            <Link
              key={p.id}
              href={`/prototypes/${p.id}`}
              className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                  v{p.version}
                </span>
                {p.feedback_score > 0 && (
                  <span className="text-xs text-gray-500">
                    Score: {p.feedback_score}/5
                  </span>
                )}
              </div>
              <h3 className="font-medium text-sm line-clamp-2">{p.demand_title || p.title}</h3>
              <p className="text-xs text-gray-500 mt-2">
                {p.created_at ? new Date(p.created_at.replace?.(" ", "T") || p.created_at).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "-"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
