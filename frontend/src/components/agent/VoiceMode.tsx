"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, RefreshCw, Square } from "lucide-react";

interface VoiceModeProps {
  onTranscript: (text: string, source: "user" | "agent") => void;
  onReply: (text: string, sessionId?: number) => void;
  token: string;
}

type VoiceState = "idle" | "connecting" | "listening" | "processing" | "speaking";

// ── Shared TTS function (exported for per-message playback) ─────────

let _token = "";

export async function playTTS(text: string): Promise<void> {
  if (!text.trim()) return;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (_token) headers["Authorization"] = `Bearer ${_token}`;
    const res = await fetch("/api/agent/tts", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: text.slice(0, 500) }),
    });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 100) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await audio.play();
        await new Promise((resolve) => { audio.onended = resolve; });
        URL.revokeObjectURL(url);
      }
    }
  } catch { /* ignore */ }
}

// ── Deepgram real-time STT via WebSocket ────────────────────────────

let _deepgramKey = "";

async function getDeepgramKey(): Promise<string> {
  if (_deepgramKey) return _deepgramKey;
  try {
    const headers: Record<string, string> = {};
    if (_token) headers["Authorization"] = `Bearer ${_token}`;
    const res = await fetch("/api/config/voice-keys", { headers });
    if (res.ok) {
      const data = await res.json();
      _deepgramKey = data.deepgram_key || "";
    }
  } catch { /* ignore */ }
  return _deepgramKey;
}

export default function VoiceMode({ onTranscript, onReply, token }: VoiceModeProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [mode, setMode] = useState<"duplex" | "push">("duplex");

  // Refs
  const voiceWsRef = useRef<WebSocket | null>(null);     // backend voice WS
  const dgWsRef = useRef<WebSocket | null>(null);         // Deepgram STT WS
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const isSpeakingRef = useRef(false);  // Agent 正在说话 → 暂停 STT

  useEffect(() => { _token = token; }, [token]);

  // ── Audio playback (complete MP3 segments) ───────────────────
  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    while (audioQueueRef.current.length > 0) {
      const chunk = audioQueueRef.current.shift();
      if (!chunk || chunk.byteLength < 500) continue;

      isSpeakingRef.current = true;  // 开始播放 → 暂停 STT 送音频
      setState("speaking");

      try {
        const blob = new Blob([chunk], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await audio.play();
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        });
      } catch { /* skip */ }
    }

    isSpeakingRef.current = false;  // 播放完毕 → 恢复 STT
    isPlayingRef.current = false;
    if (voiceWsRef.current?.readyState === WebSocket.OPEN) {
      setState("listening");
    }
  }, []);

  // ── Client-side silence detection via AudioAnalyser ─────────
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SILENCE_THRESHOLD = 15;   // volume below this = silence
  const SILENCE_DURATION = 2000;  // 2s of silence → auto-send

  const startSilenceDetector = useCallback((stream: MediaStream, onSilence: () => void) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const check = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;

        if (avg < SILENCE_THRESHOLD) {
          // Quiet
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              onSilence();
              silenceTimerRef.current = null;
            }, SILENCE_DURATION);
          }
        } else {
          // Speaking
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
        requestAnimationFrame(check);
      };
      check();
    } catch { /* ignore */ }
  }, []);

  // ── Start Deepgram STT WebSocket ─────────────────────────────
  const startDeepgramSTT = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });
      mediaStreamRef.current = stream;

      const deepgramKey = await getDeepgramKey();
      if (!deepgramKey) {
        onTranscript("Deepgram key not configured, using browser STT", "agent");
        startBrowserSTT(stream);
        return;
      }

      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&interim_results=true&endpointing=800&utterance_end_ms=1500&vad_events=true`;
      const dgWs = new WebSocket(dgUrl, ["token", deepgramKey]);
      dgWsRef.current = dgWs;

      let finalTranscript = "";
      let sendTimer: ReturnType<typeof setTimeout> | null = null;

      const flushTranscript = () => {
        if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
        if (finalTranscript.trim()) {
          onTranscript(finalTranscript.trim(), "user");
          if (voiceWsRef.current?.readyState === WebSocket.OPEN) {
            voiceWsRef.current.send(JSON.stringify({ text: finalTranscript.trim() }));
            setState("processing");
          }
          finalTranscript = "";
        }
      };

      // Client-side silence detection as backup
      startSilenceDetector(stream, flushTranscript);

      dgWs.onopen = () => {
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN && !isSpeakingRef.current) {
            dgWs.send(e.data);
          }
        };

        recorder.start(100);
      };

      dgWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "UtteranceEnd") {
            flushTranscript();
            return;
          }

          if (msg.type === "Results" && msg.channel?.alternatives?.[0]) {
            const alt = msg.channel.alternatives[0];
            const text = alt.transcript || "";

            if (msg.is_final && text.trim()) {
              finalTranscript += text;

              if (sendTimer) clearTimeout(sendTimer);
              sendTimer = setTimeout(flushTranscript, 1500);

              if (msg.speech_final) {
                flushTranscript();
              }
            }
          }
        } catch { /* ignore */ }
      };

      dgWs.onerror = () => {
        // Fallback: use Web Speech API
        onTranscript("Deepgram 不可用，使用浏览器语音识别", "agent");
        startBrowserSTT(stream);
      };

      dgWs.onclose = () => {
        recorderRef.current?.stop();
      };

    } catch (e) {
      onTranscript(`[Error] 麦克风访问失败: ${e}`, "agent");
    }
  }, [onTranscript, startSilenceDetector]);

  // ── Fallback: Browser Web Speech API ──────────────────────────
  const startBrowserSTT = useCallback((stream: MediaStream) => {
    const SR = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) {
      onTranscript("[Error] 浏览器不支持语音识别", "agent");
      return;
    }
    const recognition = new (SR as new () => SpeechRecognition)();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "zh-CN";

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[e.results.length - 1][0].transcript;
      if (text.trim()) {
        onTranscript(text.trim(), "user");
        if (voiceWsRef.current?.readyState === WebSocket.OPEN) {
          voiceWsRef.current.send(JSON.stringify({ text: text.trim() }));
          setState("processing");
        }
      }
    };

    recognition.onerror = () => { /* ignore */ };
    recognition.onend = () => { if (voiceWsRef.current?.readyState === WebSocket.OPEN) recognition.start(); };
    recognition.start();
  }, [onTranscript]);

  // ── Start backend voice WebSocket ────────────────────────────
  const startVoiceWS = useCallback(() => {
    const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/voice-lite`;

    setState("connecting");
    const ws = new WebSocket(wsUrl);
    voiceWsRef.current = ws;

    ws.onopen = () => {
      setState("listening");
      onTranscript("语音已连接，开始说话...", "agent");
      startDeepgramSTT();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "text_chunk") {
            // 文字流
          } else if (msg.type === "done") {
            onReply(msg.full_text);
          } else if (msg.type === "error") {
            onTranscript(`[Error] ${msg.error}`, "agent");
            setState("listening");
          }
        } catch { /* ignore */ }
      } else if (event.data instanceof Blob) {
        // 音频 → 播放队列
        event.data.arrayBuffer().then((buf) => {
          audioQueueRef.current.push(buf);
          playAudioQueue();
        });
      }
    };

    ws.onerror = () => {
      onTranscript("[Error] 语音连接失败", "agent");
      setState("idle");
    };

    ws.onclose = () => {
      setState("idle");
    };
  }, [onTranscript, onReply, playAudioQueue, startDeepgramSTT]);

  // ── Push-to-talk: send text to LLM via WS ────────────────────
  const sendToVoiceWS = useCallback((text: string) => {
    setState("processing");
    const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/voice-lite`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => ws.send(JSON.stringify({ text }));
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "done") {
            onReply(m.full_text);
            setState("idle");
            ws.close();
          }
        } catch { /* ignore */ }
      } else if (ev.data instanceof Blob) {
        setState("speaking");
        ev.data.arrayBuffer().then((buf) => {
          audioQueueRef.current.push(buf);
          playAudioQueue();
        });
      }
    };
    ws.onerror = () => setState("idle");
  }, [onReply, playAudioQueue]);

  // ── Push-to-talk mode ─────────────────────────────────────────
  const startPushToTalk = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      setState("listening");
      onTranscript("说完会自动发送（2秒静音自动停止）", "agent");

      // Try Deepgram first
      const deepgramKey = await getDeepgramKey();
      if (!deepgramKey) {
        onTranscript("Deepgram key not configured, using browser STT", "agent");
        const SR = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
        if (!SR) { onTranscript("Browser STT not supported", "agent"); setState("idle"); return; }
        const recognition = new (SR as new () => SpeechRecognition)();
        recognition.continuous = false; recognition.interimResults = false; recognition.lang = "zh-CN";
        recognition.onresult = (e: SpeechRecognitionEvent) => {
          const text = e.results[0][0].transcript;
          if (text.trim()) { onTranscript(text.trim(), "user"); sendToVoiceWS(text.trim()); }
        };
        recognition.onerror = () => setState("idle");
        recognition.onend = () => setState("idle");
        recognition.start();
        return;
      }
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&utterance_end_ms=1500&vad_events=true`;
      const dgWs = new WebSocket(dgUrl, ["token", deepgramKey]);
      dgWsRef.current = dgWs;

      let transcript = "";
      let dgFailed = false;

      // Client-side silence detector → auto-send
      startSilenceDetector(stream, () => {
        if (transcript.trim()) {
          onTranscript(transcript.trim(), "user");
          recorderRef.current?.stop();
          dgWsRef.current?.close();
          sendToVoiceWS(transcript.trim());
          transcript = "";
        }
      });

      dgWs.onopen = () => {
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN) dgWs.send(e.data);
        };
        recorder.start(100);
        setTimeout(() => { if (recorder.state === "recording") { recorder.stop(); dgWs.close(); } }, 30000);
      };

      dgWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "Results" && msg.is_final) {
            const text = msg.channel?.alternatives?.[0]?.transcript || "";
            if (text.trim()) transcript += text;
          }
          if (msg.type === "UtteranceEnd" && transcript.trim()) {
            onTranscript(transcript.trim(), "user");
            recorderRef.current?.stop();
            dgWs.close();
            sendToVoiceWS(transcript.trim());
            transcript = "";
          }
        } catch { /* ignore */ }
      };

      dgWs.onerror = () => {
        if (dgFailed) return;
        dgFailed = true;
        // Fallback: Browser Speech API
        const SR = (window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
        if (!SR) {
          onTranscript("[Error] 浏览器不支持语音识别", "agent");
          setState("idle");
          return;
        }
        onTranscript("切换浏览器语音识别", "agent");
        const recognition = new (SR as new () => SpeechRecognition)();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "zh-CN";
        recognition.onresult = (e: SpeechRecognitionEvent) => {
          const text = e.results[0][0].transcript;
          if (text.trim()) {
            onTranscript(text.trim(), "user");
            sendToVoiceWS(text.trim());
          }
        };
        recognition.onerror = () => setState("idle");
        recognition.onend = () => setState("idle");
        recognition.start();
      };
    } catch (e) {
      onTranscript(`[Error] 麦克风访问失败: ${e}`, "agent");
      setState("idle");
    }
  }, [onTranscript, playAudioQueue, startSilenceDetector, sendToVoiceWS]);

  // ── Stop all ─────────────────────────────────────────────────
  const stop = useCallback(() => {
    recorderRef.current?.stop();
    dgWsRef.current?.close();
    voiceWsRef.current?.close();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    dgWsRef.current = null;
    voiceWsRef.current = null;
    recorderRef.current = null;
    analyserRef.current = null;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    isSpeakingRef.current = false;
    setState("idle");
  }, []);

  // ── UI ────────────────────────────────────────────────────────
  const stateColors: Record<VoiceState, string> = {
    idle: "bg-white/20 hover:bg-white/30",
    connecting: "bg-yellow-500 animate-pulse",
    listening: "bg-red-500 animate-pulse",
    processing: "bg-purple-500 animate-pulse",
    speaking: "bg-green-500 animate-pulse",
  };

  const stateLabels: Record<VoiceState, string> = {
    idle: "",
    connecting: "连接...",
    listening: "听...",
    processing: "想...",
    speaking: "说...",
  };

  return (
    <div className="flex items-center gap-1">
      {/* Mode toggle */}
      <button
        onClick={() => { if (state !== "idle") stop(); setMode(mode === "duplex" ? "push" : "duplex"); }}
        className="text-[10px] text-blue-200 hover:text-white px-1"
        title={mode === "duplex" ? "切换到按键说话" : "切换到全双工"}
      >
        {mode === "duplex" ? <RefreshCw size={10} /> : <Mic size={10} />}
      </button>

      {/* Main voice button */}
      <button
        onClick={() => {
          if (state !== "idle") {
            stop();
          } else {
            if (mode === "duplex") startVoiceWS();
            else startPushToTalk();
          }
        }}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-white transition-all ${stateColors[state]}`}
        title={state === "idle" ? (mode === "duplex" ? "全双工语音" : "按键说话") : "停止"}
      >
        {state === "idle" ? (
          <><Mic size={12} className="inline" /> {mode === "duplex" ? "语音" : "说话"}</>
        ) : (
          <>{stateLabels[state]} <Square size={10} className="inline" /></>
        )}
      </button>
    </div>
  );
}
