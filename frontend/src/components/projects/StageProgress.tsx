"use client";
import { PROJECT_STAGES, type ProjectStage } from "@/lib/types";

interface StageProgressProps {
  currentStage: ProjectStage;
  className?: string;
}

export default function StageProgress({ currentStage, className = "" }: StageProgressProps) {
  const currentIdx = PROJECT_STAGES.findIndex((s) => s.key === currentStage);

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between">
        {PROJECT_STAGES.map((stage, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;

          return (
            <div key={stage.key} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex flex-col items-center relative">
                <div
                  className={`
                    w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium
                    transition-all duration-300
                    ${isCompleted ? "bg-green-500 text-white" : ""}
                    ${isCurrent ? "bg-blue-500 text-white ring-4 ring-blue-500/20 animate-pulse" : ""}
                    ${isFuture ? "bg-gray-200 text-gray-400" : ""}
                  `}
                >
                  {isCompleted ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span className={isCurrent ? "w-2.5 h-2.5 rounded-full bg-white" : ""}>{isFuture ? idx + 1 : ""}</span>
                  )}
                </div>
                <span
                  className={`
                    mt-2 text-xs font-medium whitespace-nowrap
                    ${isCompleted ? "text-green-600" : ""}
                    ${isCurrent ? "text-blue-600" : ""}
                    ${isFuture ? "text-gray-400" : ""}
                  `}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {idx < PROJECT_STAGES.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-2 mt-[-1.25rem] transition-colors duration-300
                    ${idx < currentIdx ? "bg-green-500" : "bg-gray-200"}
                  `}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
