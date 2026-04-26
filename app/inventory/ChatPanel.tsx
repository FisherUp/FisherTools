"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { InventoryItem } from "../../lib/services/inventoryService";

// ── Types ────────────────────────────────────────────────────
type Status = "idle" | "connecting" | "ready" | "error";

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Props = {
  item: InventoryItem;
  age: number;
  language: "zh" | "en";
};

// ── PCM16 / Base64 helpers ───────────────────────────────────
function float32ToPcm16(f32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function pcm16ToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const out = new Float32Array(buf.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b642ab(b64: string): ArrayBuffer {
  const s = atob(b64);
  const buf = new ArrayBuffer(s.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i);
  return buf;
}

// ── Component ────────────────────────────────────────────────
export default function ChatPanel({ item, age, language }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  // Refs to avoid stale closures
  const statusRef = useRef<Status>("idle");
  const isMutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextPlayRef = useRef(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]); // ← track for interruption
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const currentAiTextRef = useRef("");
  const currentAiMsgIdRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const setStatusBoth = (s: Status) => { setStatus(s); statusRef.current = s; };
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ── System prompt ────────────────────────────────────────
  const buildSystemPrompt = useCallback(() => {
    const ctx = [
      item.name,
      item.category || item.sub_category
        ? `（分类：${[item.category, item.sub_category].filter(Boolean).join("/")}）`
        : "",
      item.location ? `，位置：${item.location}` : "",
    ].join("");

    if (language === "zh") {
      return `你是小胖，一只超级可爱的大熊猫🐼，是小朋友最好的学习伙伴！
今天你正在和一个${age}岁的小朋友一起认识「${ctx}」这件物品。

你的说话风格：
• 语言简单亲切，适合${age}岁孩子
• 充满热情和好奇心，喜欢说"哇！""太棒了！""你真聪明！"
• 用故事、比喻、生活例子解释知识
• 每次说话简短有趣（2-3句），不长篇大论
• 经常提问，鼓励孩子思考和回答
• 孩子答对了用夸张的表扬，答错了温柔引导
• 有时候故意说"小胖不知道，你能告诉我吗？"来让孩子有成就感

请先自我介绍（"我是小胖！"），然后分享一个关于「${item.name}」的有趣知识，最后问孩子一个有趣的问题。

始终用中文对话。`;
    } else {
      return `You are Xiao Pang (小胖), a super cute giant panda 🐼 and a child's best learning buddy!
Today you're exploring "${ctx}" together with a ${age}-year-old child.

Your speaking style:
• Simple and friendly English, perfect for a ${age}-year-old
• Full of enthusiasm! Use "Wow!", "Amazing!", "You're so smart!"
• Explain things through stories, comparisons, and everyday examples
• Keep responses short and fun (2-3 sentences), never lecture
• Ask questions often to get the child involved
• Celebrate right answers, gently guide wrong ones
• Sometimes pretend you don't know something - "Xiao Pang doesn't know! Can you tell me?"

Start by introducing yourself ("I'm Xiao Pang!"), share one fun fact about "${item.name}", then ask the child a question.

Always speak in English.`;
    }
  }, [item, age, language]);

  // ── Audio helper: schedule PCM16 chunk ──────────────────
  const scheduleChunk = useCallback((b64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const f32 = pcm16ToFloat32(b642ab(b64));
      const buf = ctx.createBuffer(1, f32.length, 24000);
      buf.copyToChannel(f32 as Float32Array<ArrayBuffer>, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      const start = Math.max(now, nextPlayRef.current);
      src.start(start);
      nextPlayRef.current = start + buf.duration;
      // Track this source so it can be stopped on interruption
      scheduledSourcesRef.current.push(src);
      src.onended = () => {
        scheduledSourcesRef.current = scheduledSourcesRef.current.filter((s) => s !== src);
      };
    } catch {
      // ignore transient audio errors
    }
  }, []);

  // ── Cancel all pending/playing AI audio ─────────────────
  const cancelAudio = useCallback(() => {
    scheduledSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    if (audioCtxRef.current) {
      nextPlayRef.current = audioCtxRef.current.currentTime;
    }
    setIsAiSpeaking(false);
    // Also clear accumulating AI message so next response starts fresh
    currentAiTextRef.current = "";
    currentAiMsgIdRef.current = "";
  }, []);

  // ── Cleanup all resources ────────────────────────────────
  const cleanup = useCallback(() => {
    // Stop all scheduled/playing AI audio immediately
    scheduledSourcesRef.current.forEach((src) => {
      try { src.stop(); } catch { /* already stopped */ }
    });
    scheduledSourcesRef.current = [];
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    gainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    nextPlayRef.current = 0;
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent spurious re-trigger
      wsRef.current.close(1000, "user ended session");
      wsRef.current = null;
    }
    setIsAiSpeaking(false);
    setUserSpeaking(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Mic processor setup ──────────────────────────────────
  const setupMicProcessor = useCallback(
    (ctx: AudioContext, stream: MediaStream, ws: WebSocket) => {
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode: 2048 samples @ 24kHz ≈ 85ms intervals
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      // Silent gain so we don't hear our own mic (but onaudioprocess still fires)
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: ab2b64(float32ToPcm16(f32)),
          })
        );
      };

      source.connect(processor);
      processor.connect(gain);
      gain.connect(ctx.destination);
    },
    []
  );

  // ── Handle incoming WebSocket messages ──────────────────
  const handleWsMessage = useCallback(
    (data: any, ctx: AudioContext, ws: WebSocket) => {
      switch (data.type) {

        case "session.updated": {
          setStatusBoth("ready");
          setupMicProcessor(ctx, micStreamRef.current!, ws);
          // Prompt AI to greet first
          ws.send(JSON.stringify({ type: "response.create" }));
          break;
        }

        case "input_audio_buffer.speech_started": {
          setUserSpeaking(true);
          // Immediately cancel all queued/playing AI audio to prevent overlap
          cancelAudio();
          break;
        }

        case "input_audio_buffer.speech_stopped": {
          setUserSpeaking(false);
          break;
        }

        case "conversation.item.input_audio_transcription.completed": {
          const txt = (data.transcript ?? "").trim();
          if (txt) {
            setMsgs((prev) => [
              ...prev,
              { id: `user-${Date.now()}`, role: "user", text: txt },
            ]);
          }
          break;
        }

        case "response.audio.delta": {
          setIsAiSpeaking(true);
          scheduleChunk(data.delta);
          break;
        }

        // Use audio transcript for display (matches what AI is saying)
        case "response.audio_transcript.delta": {
          currentAiTextRef.current += data.delta ?? "";
          const id = currentAiMsgIdRef.current;
          if (id) {
            setMsgs((prev) =>
              prev.map((m) =>
                m.id === id ? { ...m, text: currentAiTextRef.current } : m
              )
            );
          } else {
            const newId = `ai-${Date.now()}`;
            currentAiMsgIdRef.current = newId;
            setMsgs((prev) => [
              ...prev,
              { id: newId, role: "assistant", text: currentAiTextRef.current },
            ]);
          }
          break;
        }

        case "response.done": {
          setIsAiSpeaking(false);
          currentAiTextRef.current = "";
          currentAiMsgIdRef.current = "";
          break;
        }

        case "error": {
          const errMsg = data.error?.message ?? "小胖出错了，再试一试！";
          console.error("Realtime error:", data.error);
          setError(errMsg);
          break;
        }
      }
    },
    [scheduleChunk, setupMicProcessor, cancelAudio]
  );

  // ── Start session ────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatusBoth("connecting");
    setError("");
    setMsgs([]);
    currentAiTextRef.current = "";
    currentAiMsgIdRef.current = "";

    try {
      // 1. Fetch credentials
      const res = await fetch("/api/inventory/realtime-token");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "无法获取连接凭证，请检查配置");
      }
      const { wsUrl } = await res.json();
      if (!wsUrl) throw new Error("返回的连接凭证不完整");

      // 2. Setup AudioContext at 24kHz (matches Realtime API)
      const ctx = new AudioContext({ sampleRate: 24000 });
      if (ctx.state === "suspended") await ctx.resume();
      audioCtxRef.current = ctx;

      // 3. Request microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      // 4. Connect to Azure Realtime via WebSocket
      // Azure OpenAI Realtime 使用 URL 查询参数认证（api-key 已内嵌在 wsUrl 中）
      // 不能使用 openai-insecure-api-key.{key} 子协议（那是 OpenAI.com 私有布局，Azure 不支持）
      const ws = new WebSocket(wsUrl, ["realtime"]);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              instructions: buildSystemPrompt(),
              voice: "shimmer",
              input_audio_format: "pcm16",
              output_audio_format: "pcm16",
              input_audio_transcription: { model: "whisper-1" },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 700,
              },
              modalities: ["audio", "text"],
            },
          })
        );
      };

      ws.onmessage = (e) => {
        let parsed: any;
        try { parsed = JSON.parse(e.data); } catch { return; }
        handleWsMessage(parsed, ctx, ws);
      };

      ws.onerror = (ev) => {
        console.error("Realtime WebSocket error:", ev);
        setError("连接小胖失败，请检查网络及 AZURE_REALTIME_* 配置");
        setStatusBoth("error");
        cleanup();
      };

      ws.onclose = (e) => {
        if (e.code !== 1000 && statusRef.current === "ready") {
          setError(`连接已断开 (${e.code})，请重新开始`);
          setStatusBoth("error");
        } else if (statusRef.current !== "idle") {
          setStatusBoth("idle");
        }
      };
    } catch (e: any) {
      const msg = e.message || "连接失败，请重试";
      setError(msg);
      setStatusBoth("error");
      cleanup();
    }
  }, [buildSystemPrompt, cleanup, handleWsMessage]);

  const stopSession = useCallback(() => {
    cleanup();
    setStatusBoth("idle");
    setError("");
  }, [cleanup]);

  // ── Render helpers ───────────────────────────────────────
  const statusColor = status === "ready" ? "#22863a" : status === "connecting" ? "#e6a817" : status === "error" ? "#d73a49" : "#888";
  const statusLabel = status === "ready" ? "🟢 小胖在线" : status === "connecting" ? "🟡 连接中…" : status === "error" ? "🔴 连接断开" : "⭕ 未连接";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 340 }}>
      {/* ── Style block for animations ── */}
      <style>{`
        @keyframes cp-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.12)} }
        @keyframes cp-bounce { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        @keyframes cp-wave { 0%,100%{height:6px} 50%{height:20px} }
        .cp-speaking-ai { animation: cp-bounce 0.8s ease-in-out infinite; display:inline-block; }
        .cp-speaking-user { animation: cp-pulse 0.6s ease-in-out infinite; display:inline-block; }
        .cp-wave-bar { display:inline-block; width:4px; border-radius:3px; background:#1a73e8; margin:0 1px; animation:cp-wave 0.6s ease-in-out infinite; }
        .cp-wave-bar:nth-child(2){animation-delay:.1s}
        .cp-wave-bar:nth-child(3){animation-delay:.2s}
        .cp-wave-bar:nth-child(4){animation-delay:.3s}
      `}</style>

      {/* ── Status bar ── */}
      <div style={{
        padding: "8px 14px",
        background: "#f0fdf4",
        borderBottom: "1px solid #d1fae5",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 22 }}>🐼</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: statusColor }}>{statusLabel}</span>

        {/* Speaking indicators */}
        {isAiSpeaking && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
            <span className="cp-speaking-ai" style={{ fontSize: 16 }}>🐼</span>
            <span style={{ fontSize: 12, color: "#22863a", fontWeight: 600 }}>说话中</span>
          </div>
        )}
        {userSpeaking && status === "ready" && !isMuted && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 22, marginLeft: 4 }}>
            <span className="cp-wave-bar" />
            <span className="cp-wave-bar" />
            <span className="cp-wave-bar" />
            <span className="cp-wave-bar" />
          </div>
        )}

        {status === "ready" && (
          <button
            onClick={() => setIsMuted((v) => !v)}
            title={isMuted ? "取消静音" : "静音（孩子不说话时按这里）"}
            style={{
              marginLeft: "auto",
              padding: "4px 10px",
              border: `1px solid ${isMuted ? "#f59e0b" : "#ddd"}`,
              borderRadius: 6,
              background: isMuted ? "#fffbeb" : "#fff",
              color: isMuted ? "#b45309" : "#555",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {isMuted ? "🔇 已静音" : "🎤 麦克风开启"}
          </button>
        )}
      </div>

      {/* ── Transcript ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", background: "#fafffe" }}>
        {status === "idle" && msgs.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 16px", color: "#888" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🐼</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#333", marginBottom: 6 }}>
              {language === "zh" ? "小胖等你来！" : "Xiao Pang is waiting!"}
            </div>
            <div style={{ fontSize: 13, color: "#999", lineHeight: 1.7 }}>
              {language === "zh"
                ? `按下开始和小胖一起认识「${item.name}」吧\n小胖会先打招呼，然后你们可以自由对话 🎉`
                : `Press Start to learn about "${item.name}" with Xiao Pang!\nXiao Pang will greet you first 🎉`}
            </div>
            <div style={{ marginTop: 16, padding: "8px 12px", background: "#fff8e1", borderRadius: 8, fontSize: 12, color: "#78716c" }}>
              💡 {language === "zh" ? "建议使用耳机以获得最佳体验" : "Headphones recommended for best experience"}
            </div>
          </div>
        )}

        {status === "connecting" && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#888" }}>
            <div className="cp-speaking-ai" style={{ fontSize: 48, marginBottom: 12 }}>🐼</div>
            <div style={{ fontSize: 14 }}>{language === "zh" ? "小胖正在赶来，稍等一下…" : "Xiao Pang is on the way…"}</div>
          </div>
        )}

        {error && (
          <div style={{
            padding: "10px 14px", background: "#fff3cd", borderRadius: 10,
            color: "#856404", fontSize: 13, marginBottom: 12,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠️</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button
              onClick={() => setError("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#856404", fontSize: 16, padding: 0, lineHeight: 1 }}
            >×</button>
          </div>
        )}

        {/* Message bubbles */}
        {msgs.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 10,
              alignItems: "flex-end",
              gap: 6,
            }}
          >
            {msg.role === "assistant" && (
              <span style={{ fontSize: 24, flexShrink: 0, marginBottom: 2 }}>🐼</span>
            )}
            <div style={{
              maxWidth: "74%",
              padding: "10px 14px",
              borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: msg.role === "user" ? "#1a73e8" : "#fff",
              color: msg.role === "user" ? "#fff" : "#222",
              fontSize: 14,
              lineHeight: 1.75,
              boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              border: msg.role === "assistant" ? "1px solid #e5f3e5" : "none",
              whiteSpace: "pre-wrap",
            }}>
              {msg.text || (msg.role === "assistant" ? "…" : "")}
            </div>
            {msg.role === "user" && (
              <span style={{ fontSize: 20, flexShrink: 0, marginBottom: 2 }}>🧒</span>
            )}
          </div>
        ))}
        <div ref={transcriptEndRef} />
      </div>

      {/* ── Action bar ── */}
      <div style={{
        padding: "12px 14px",
        borderTop: "1px solid #f0f0f0",
        display: "flex", gap: 10, alignItems: "center",
        background: "#fff",
      }}>
        {status === "idle" || status === "error" ? (
          <button
            onClick={startSession}
            style={{
              flex: 1,
              padding: "11px 0",
              background: "linear-gradient(135deg, #22863a, #1a7a1a)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: "0 2px 8px rgba(34,134,58,0.3)",
            }}
          >
            <span>🐼</span>
            <span>{language === "zh" ? "开始和小胖对话！" : "Start talking with Xiao Pang!"}</span>
          </button>
        ) : (
          <>
            <button
              onClick={stopSession}
              style={{
                flex: 1,
                padding: "11px 0",
                background: "#dc3545",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ⏹ {language === "zh" ? "结束对话" : "End Session"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
