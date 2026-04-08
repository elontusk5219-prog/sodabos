"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getToken } from "@/lib/auth";
import { Phone, Pin, CheckCircle, Rocket, Bot, BarChart3, Target, Mic, MicOff, Pause, Play } from "lucide-react";

/* ---------- types ---------- */
interface Transcript {
  id: string;
  speaker: string;
  text: string;
  time: string; // HH:mm:ss
  isAgent?: boolean;
}

interface MeetingSummary {
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
  agentInsights: string[];
}

type AgentStatus = "旁听中" | "思考中" | "回答中";
type MeetingPhase = "idle" | "active" | "ended";

/* ---------- helpers ---------- */
function bjNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
  );
}

function formatTime(d: Date) {
  return d.toTimeString().slice(0, 8);
}

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

let idSeq = 0;
function nextId() {
  return `t-${Date.now()}-${++idSeq}`;
}

/* ========== component ========== */
export default function MeetingPage() {
  const { user } = useAuth();

  /* ----- meeting state ----- */
  const [phase, setPhase] = useState<MeetingPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("旁听中");
  const [wordCount, setWordCount] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [volume, setVolume] = useState(0);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [paused, setPaused] = useState(false);

  /* ----- refs ----- */
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);

  /* auto-scroll transcripts */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  /* timer */
  useEffect(() => {
    if (phase === "active" && !paused) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, paused]);

  /* volume meter */
  const startVolumeMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setVolume(Math.min(100, Math.round((avg / 128) * 100)));
      animRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  /* ----- WebSocket ----- */
  const connectWs = useCallback(() => {
    const token = getToken();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    const ws = new WebSocket(
      `${proto}://${host}/ws/meeting?token=${encodeURIComponent(token || "")}`
    );
    ws.binaryType = "arraybuffer";

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "asr_text": {
            const t: Transcript = {
              id: nextId(),
              speaker: msg.speaker || "参会者",
              text: msg.text,
              time: formatTime(bjNow()),
            };
            setTranscripts((prev) => [...prev, t]);
            setWordCount((c) => c + msg.text.length);
            break;
          }
          case "agent_text": {
            const t: Transcript = {
              id: nextId(),
              speaker: "PM Agent",
              text: msg.text,
              time: formatTime(bjNow()),
              isAgent: true,
            };
            setTranscripts((prev) => [...prev, t]);
            break;
          }
          case "status":
            if (msg.agent_status) setAgentStatus(msg.agent_status);
            if (msg.topics) setTopics(msg.topics);
            break;
          case "summary":
            setSummary(msg.data as MeetingSummary);
            setPhase("ended");
            break;
        }
      } else {
        /* agent_audio — PCM 24kHz 16bit mono */
        playPcm(ev.data as ArrayBuffer);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    wsRef.current = ws;
  }, []);

  /* ----- audio capture (16kHz mono PCM) ----- */
  const startAudioCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });
    mediaStreamRef.current = stream;
    startVolumeMeter(stream);

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (!micOn || paused) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcm16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  }, [micOn, paused, startVolumeMeter]);

  /* ----- play received PCM ----- */
  const playPcm = useCallback((buf: ArrayBuffer) => {
    if (!playCtxRef.current) {
      playCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    const ctx = playCtxRef.current;
    const int16 = new Int16Array(buf);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }
    const ab = ctx.createBuffer(1, float32.length, 24000);
    ab.getChannelData(0).set(float32);
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(ctx.destination);
    src.start();
  }, []);

  /* ----- controls ----- */
  const startMeeting = useCallback(async () => {
    setPhase("active");
    setElapsed(0);
    setTranscripts([]);
    setSummary(null);
    setAgentStatus("旁听中");
    setWordCount(0);
    setTopics([]);
    setPaused(false);
    connectWs();
    await startAudioCapture();
    wsRef.current?.send(JSON.stringify({ command: "start" }));
  }, [connectWs, startAudioCapture]);

  const endMeeting = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ command: "stop" }));
    /* generate local summary fallback */
    if (!summary) {
      const points = transcripts
        .filter((t) => !t.isAgent)
        .slice(-5)
        .map((t) => t.text.slice(0, 40));
      const decisions = transcripts
        .filter((t) => t.text.includes("决定") || t.text.includes("确认"))
        .map((t) => t.text.slice(0, 60));
      const actions = transcripts
        .filter((t) => t.text.includes("跟进") || t.text.includes("负责"))
        .map((t) => t.text.slice(0, 60));
      const insights = transcripts
        .filter((t) => t.isAgent)
        .map((t) => t.text.slice(0, 60));
      setSummary({
        keyPoints: points.length ? points : ["暂无讨论要点"],
        decisions: decisions.length ? decisions : ["暂无决策记录"],
        actionItems: actions.length ? actions : ["暂无行动项"],
        agentInsights: insights.length ? insights : ["Agent 未参与发言"],
      });
    }
    /* cleanup */
    processorRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    cancelAnimationFrame(animRef.current);
    setPhase("ended");
  }, [summary, transcripts]);

  const togglePause = useCallback(() => {
    const next = !paused;
    setPaused(next);
    wsRef.current?.send(
      JSON.stringify({ command: next ? "pause" : "resume" })
    );
  }, [paused]);

  const sendQuery = useCallback(
    (text: string) => {
      if (!text.trim() || !wsRef.current) return;
      wsRef.current.send(JSON.stringify({ command: "query", text }));
      const t: Transcript = {
        id: nextId(),
        speaker: user?.display_name || "我",
        text,
        time: formatTime(bjNow()),
      };
      setTranscripts((prev) => [...prev, t]);
      setQuery("");
    },
    [user]
  );

  const quickAction = useCallback(
    (action: string) => {
      wsRef.current?.send(JSON.stringify({ command: "action", action }));
      setAgentStatus("思考中");
    },
    []
  );

  /* cleanup on unmount */
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      processorRef.current?.disconnect();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      playCtxRef.current?.close();
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /* ============ RENDER ============ */

  /* ----- idle screen ----- */
  if (phase === "idle") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-md w-full">
          <div className="mb-4"><Phone size={48} className="mx-auto text-gray-400" /></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">会议模式</h1>
          <p className="text-gray-500 mb-8">
            开启会议后，Agent 将实时旁听并提供智能辅助。支持语音转写、数据查询、竞品分析等能力。
          </p>
          <button
            onClick={startMeeting}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-semibold text-lg hover:bg-blue-700 transition-colors shadow-md"
          >
            开始会议
          </button>
        </div>
      </div>
    );
  }

  /* ----- ended / summary screen ----- */
  if (phase === "ended" && summary) {
    const sections: { title: string; icon: React.ReactNode; items: string[] }[] = [
      { title: "讨论要点", icon: <Pin size={18} />, items: summary.keyPoints },
      { title: "决策记录", icon: <CheckCircle size={18} />, items: summary.decisions },
      { title: "行动项", icon: <Rocket size={18} />, items: summary.actionItems },
      { title: "Agent 洞察", icon: <Bot size={18} />, items: summary.agentInsights },
    ];

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">会议纪要</h1>
            <span className="text-sm text-gray-500">
              时长 {fmtDuration(elapsed)} &middot; 转写 {wordCount} 字
            </span>
          </div>

          <div className="space-y-5">
            {sections.map((sec) => (
              <div
                key={sec.title}
                className="bg-white rounded-xl border border-gray-200 p-5"
              >
                <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  {sec.icon}
                  {sec.title}
                </h2>
                <ul className="space-y-2">
                  {sec.items.map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-gray-700"
                    >
                      <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* transcript history */}
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-lg font-semibold mb-3">完整转写记录</h2>
            <div className="max-h-64 overflow-y-auto space-y-2 text-sm">
              {transcripts.map((t) => (
                <div key={t.id} className="flex gap-2">
                  <span className="text-gray-400 shrink-0">{t.time}</span>
                  <span
                    className={
                      t.isAgent
                        ? "font-medium text-blue-600"
                        : "font-medium text-gray-700"
                    }
                  >
                    {t.speaker}:
                  </span>
                  <span className="text-gray-600">{t.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            <button
              onClick={() => {
                setPhase("idle");
                setSummary(null);
              }}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              新建会议
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ----- active meeting ----- */
  const statusColor: Record<AgentStatus, string> = {
    旁听中: "bg-green-100 text-green-700",
    思考中: "bg-yellow-100 text-yellow-700",
    回答中: "bg-blue-100 text-blue-700",
  };

  const quickBtns: { label: string; action: string; icon: React.ReactNode }[] = [
    { label: "查数据", action: "query_data", icon: <BarChart3 size={14} /> },
    { label: "查竞品", action: "query_competitor", icon: <Target size={14} /> },
    { label: "记决策", action: "record_decision", icon: <CheckCircle size={14} /> },
    { label: "问Agent", action: "ask_agent", icon: <Bot size={14} /> },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ---- header ---- */}
      <header className="bg-blue-600 text-white px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Phone size={18} />
          <h1 className="text-lg font-semibold">会议模式</h1>
          {paused && (
            <span className="text-xs bg-white/20 rounded px-2 py-0.5">
              已暂停
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="font-mono">{fmtDuration(elapsed)}</span>
          <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        </div>
      </header>

      {/* ---- agent status bar ---- */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4 text-sm shrink-0">
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[agentStatus]}`}
        >
          {agentStatus}
        </span>
        <span className="text-gray-400">|</span>
        <span className="text-gray-600">已转写 {wordCount} 字</span>
        {topics.length > 0 && (
          <>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">
              话题:{" "}
              {topics.map((t, i) => (
                <span
                  key={i}
                  className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1 text-xs"
                >
                  {t}
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      {/* ---- transcript area ---- */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {transcripts.length === 0 && (
          <div className="text-center text-gray-400 mt-20 text-sm">
            等待发言...会议内容将实时显示在这里
          </div>
        )}
        {transcripts.map((t) => (
          <div
            key={t.id}
            className={`flex gap-3 ${t.isAgent ? "items-start" : ""}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                t.isAgent
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {t.isAgent ? "AI" : t.speaker.slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-medium ${
                    t.isAgent ? "text-blue-600" : "text-gray-800"
                  }`}
                >
                  {t.speaker}
                </span>
                <span className="text-xs text-gray-400">{t.time}</span>
              </div>
              <p
                className={`text-sm mt-0.5 ${
                  t.isAgent
                    ? "text-blue-700 bg-blue-50 rounded-lg px-3 py-2 inline-block"
                    : "text-gray-600"
                }`}
              >
                {t.text}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ---- bottom controls ---- */}
      <div className="border-t border-gray-200 bg-white shrink-0">
        {/* quick actions */}
        <div className="px-6 py-2 flex items-center gap-2 border-b border-gray-100">
          {quickBtns.map((b) => (
            <button
              key={b.action}
              onClick={() => quickAction(b.action)}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm text-gray-700 transition-colors flex items-center gap-1"
            >
              {b.icon}
              {b.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={togglePause}
            className="px-3 py-1.5 bg-yellow-50 hover:bg-yellow-100 rounded-lg text-sm text-yellow-700 transition-colors"
          >
            {paused ? <><Play size={12} className="inline mr-1" /> 继续</> : <><Pause size={12} className="inline mr-1" /> 暂停</>}
          </button>
          <button
            onClick={endMeeting}
            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg text-sm text-red-600 transition-colors"
          >
            结束会议
          </button>
        </div>

        {/* input + mic */}
        <div className="px-6 py-3 flex items-center gap-3">
          {/* mic toggle */}
          <button
            onClick={() => setMicOn((v) => !v)}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-colors ${
              micOn
                ? "bg-blue-600 text-white"
                : "bg-gray-200 text-gray-500"
            }`}
            title={micOn ? "关闭麦克风" : "开启麦克风"}
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>

          {/* volume bar */}
          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-400 rounded-full transition-all duration-100"
              style={{ width: `${micOn ? volume : 0}%` }}
            />
          </div>

          {/* text input */}
          <div className="flex-1 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendQuery(query);
              }}
              placeholder="输入问题，直接向 Agent 提问..."
              className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={() => sendQuery(query)}
              disabled={!query.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
