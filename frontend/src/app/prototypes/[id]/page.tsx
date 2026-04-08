"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

interface PrototypeDetail {
  id: number;
  demand_id: number;
  title: string;
  description: string;
  html_path: string;
  feedback_score: number;
  feedback_notes: string;
  version: number;
  created_at: string;
  demand_title?: string;
}

export default function PrototypeDetailPage() {
  const params = useParams();
  const protoId = Number(params.id);
  const [proto, setProto] = useState<PrototypeDetail | null>(null);
  const [allVersions, setAllVersions] = useState<PrototypeDetail[]>([]);
  const [feedbackScore, setFeedbackScore] = useState(3);
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // We need to load prototype data — since we have list endpoint, fetch all and find
    api.agentPrototypes().then((data: { prototypes: PrototypeDetail[] }) => {
      const all = data.prototypes || [];
      const current = all.find((p: PrototypeDetail) => p.id === protoId);
      setProto(current || null);
      if (current) {
        setAllVersions(all.filter((p: PrototypeDetail) => p.demand_id === current.demand_id));
      }
    });
  }, [protoId]);

  const handleFeedback = async () => {
    if (!proto) return;
    setSubmitting(true);
    try {
      await api.prototypesFeedback(proto.id, { score: feedbackScore, notes: feedbackNotes });
      setFeedbackNotes("");
      // Reload
      const data = await api.agentPrototypes();
      const updated = (data.prototypes || []).find((p: PrototypeDetail) => p.id === protoId);
      if (updated) setProto(updated);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = async () => {
    if (!proto) return;
    setRegenerating(true);
    try {
      await api.prototypesRegenerate(proto.demand_id, { feedback: feedbackNotes });
      // Reload all versions
      const data = await api.agentPrototypes();
      const all = data.prototypes || [];
      setAllVersions(all.filter((p: PrototypeDetail) => p.demand_id === proto.demand_id));
      // Switch to newest
      const newest = all
        .filter((p: PrototypeDetail) => p.demand_id === proto.demand_id)
        .sort((a: PrototypeDetail, b: PrototypeDetail) => b.version - a.version)[0];
      if (newest) setProto(newest);
    } finally {
      setRegenerating(false);
    }
  };

  if (!proto) {
    return <div className="p-6 text-gray-400">Loading...</div>;
  }

  const iframeUrl = `/prototypes/${proto.html_path}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">{proto.demand_title || proto.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{proto.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {allVersions.length > 1 && (
            <select
              value={proto.id}
              onChange={(e) => {
                const selected = allVersions.find((v) => v.id === Number(e.target.value));
                if (selected) setProto(selected);
              }}
              className="text-sm border rounded-lg px-3 py-1.5"
            >
              {allVersions
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} — {new Date(v.created_at).toLocaleDateString()}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>

      {/* Main layout: preview + feedback */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Prototype iframe */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 flex items-center gap-2 border-b">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-yellow-400" />
                <span className="w-3 h-3 rounded-full bg-green-400" />
              </div>
              <span className="text-xs text-gray-500 ml-2">{iframeUrl}</span>
            </div>
            <iframe
              src={iframeUrl}
              className="w-full border-0"
              style={{ height: "600px" }}
              title="Prototype Preview"
            />
          </div>
        </div>

        {/* Feedback panel */}
        <div className="space-y-4">
          {/* Score */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-sm mb-3">Rate this prototype</h3>
            <div className="flex gap-2 mb-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setFeedbackScore(n)}
                  className={`w-10 h-10 rounded-lg text-sm font-medium transition-colors ${
                    feedbackScore >= n
                      ? "bg-yellow-400 text-white"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <textarea
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              placeholder="Feedback / suggestions for improvement..."
              className="w-full px-3 py-2 text-sm border rounded-lg resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />

            <div className="flex gap-2 mt-3">
              <button
                onClick={handleFeedback}
                disabled={submitting}
                className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {submitting ? "Submitting..." : "Submit Feedback"}
              </button>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="flex-1 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium"
              >
                {regenerating ? "Generating..." : "Regenerate"}
              </button>
            </div>
          </div>

          {/* History */}
          {proto.feedback_notes && proto.feedback_notes !== "[]" && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium text-sm mb-2">Feedback History</h3>
              <div className="space-y-2">
                {JSON.parse(proto.feedback_notes || "[]").map(
                  (fb: { score: number; notes: string; timestamp: string }, i: number) => (
                    <div key={i} className="text-xs bg-gray-50 rounded p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Score: {fb.score}/5</span>
                        <span className="text-gray-400">
                          {new Date(fb.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      {fb.notes && <p className="text-gray-600 mt-1">{fb.notes}</p>}
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
            <div>Version: {proto.version}</div>
            <div>Created: {new Date(proto.created_at).toLocaleString()}</div>
            <div>Demand ID: {proto.demand_id}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
