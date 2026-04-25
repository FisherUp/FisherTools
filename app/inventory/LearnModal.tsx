"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { InventoryItem } from "../../lib/services/inventoryService";
import ChatPanel from "./ChatPanel";

type LearnContent = {
  title?: string;
  format_name?: string;
  main_content?: string;
  key_fact?: string;
  question?: string;
  // English extras
  english_word?: string;
  pronunciation?: string;
  vocabulary?: string[];
  fun_fact?: string;
};

type Props = {
  item: InventoryItem;
  age: number;
  onClose: () => void;
  onAgeChange: (age: number) => void;
};

export default function LearnModal({ item, age, onClose, onAgeChange }: Props) {
  const [activeTab, setActiveTab] = useState<"learn" | "chat">("learn");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [content, setContent] = useState<LearnContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [variant, setVariant] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [localAge, setLocalAge] = useState(age);

  const synthRef = useRef<any>(null);
  const sdkRef = useRef<any>(null);

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      try { synthRef.current.close(); } catch {}
      synthRef.current = null;
    }
    setSpeaking(false);
  }, []);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const fetchContent = useCallback(async (lang: "zh" | "en", v: number, a: number) => {
    setLoading(true);
    setError("");
    setContent(null);
    stopSpeaking();
    try {
      const res = await fetch("/api/inventory/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_name: item.name,
          primary_category: item.category,
          sub_category: item.sub_category,
          quantity: item.quantity,
          unit: item.unit,
          location: item.location,
          age: a,
          language: lang,
          variant: v,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "生成失败");
      }
      setContent(await res.json());
    } catch (e: any) {
      setError(e.message || "内容生成失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [item]);

  // Initial load
  useEffect(() => { fetchContent("zh", 0, localAge); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleLanguageChange = (lang: "zh" | "en") => {
    if (lang === language) return;
    setLanguage(lang);
    fetchContent(lang, variant, localAge);
  };

  const handleRefresh = () => {
    const next = (variant + 1) % 6;
    setVariant(next);
    fetchContent(language, next, localAge);
  };

  const handleAgeBlur = (raw: string) => {
    const v = parseInt(raw);
    if (Number.isFinite(v) && v >= 3 && v <= 18) {
      setLocalAge(v);
      onAgeChange(v);
      fetchContent(language, variant, v);
    }
  };

  const buildTtsText = (c: LearnContent): string => {
    const parts: string[] = [];
    if (c.title) parts.push(c.title + "。");
    if (c.main_content) parts.push(c.main_content);
    if (c.key_fact) parts.push(c.key_fact);
    if (c.fun_fact) parts.push(c.fun_fact);
    if (c.vocabulary?.length) parts.push(c.vocabulary.join("。"));
    if (c.question) parts.push(c.question);
    return parts.join("\n\n");
  };

  const handleSpeak = async () => {
    if (speaking) { stopSpeaking(); return; }
    if (!content) return;

    try {
      const tokenRes = await fetch("/api/inventory/speech-token");
      if (!tokenRes.ok) throw new Error("无法获取语音 token");
      const { token, region } = await tokenRes.json();

      if (!sdkRef.current) {
        sdkRef.current = await import("microsoft-cognitiveservices-speech-sdk");
      }
      const sdk = sdkRef.current;

      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechSynthesisVoiceName = language === "zh"
        ? "zh-CN-XiaoxiaoNeural"
        : "en-US-JennyNeural";
      const audioConfig = sdk.AudioConfig.fromDefaultSpeakerOutput();
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);
      synthRef.current = synthesizer;
      setSpeaking(true);

      synthesizer.speakTextAsync(
        buildTtsText(content),
        () => { setSpeaking(false); synthRef.current = null; },
        (err: string) => { setError("朗读失败：" + err); setSpeaking(false); synthRef.current = null; }
      );
    } catch (e: any) {
      setError(e.message || "朗读失败");
      setSpeaking(false);
    }
  };

  const formatBadgeColors: Record<string, { bg: string; color: string }> = {
    "场景造句": { bg: "#e0f7fa", color: "#00796b" },
    "亲子对话": { bg: "#fce4ec", color: "#c62828" },
    "猜谜时间": { bg: "#fff9c4", color: "#f57f17" },
    "小故事": { bg: "#e8f5e9", color: "#2e7d32" },
    "你知道吗？": { bg: "#e8eaf6", color: "#3949ab" },
    "填空练习": { bg: "#fbe9e7", color: "#bf360c" },
    "Word Spotlight": { bg: "#e3f2fd", color: "#1565c0" },
    "Daily Conversation": { bg: "#fce4ec", color: "#c62828" },
    "Story Time": { bg: "#e8f5e9", color: "#2e7d32" },
    "Fun Facts": { bg: "#fff9c4", color: "#f57f17" },
    "Word Explorer": { bg: "#e8eaf6", color: "#3949ab" },
    "English Challenge": { bg: "#fbe9e7", color: "#bf360c" },
  };

  const badge = content?.format_name ? (formatBadgeColors[content.format_name] ?? { bg: "#e8f0fe", color: "#1a73e8" }) : { bg: "#e8f0fe", color: "#1a73e8" };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, backdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 18, width: "100%", maxWidth: 660,
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 12px 48px rgba(0,0,0,0.22)",
        overflow: "hidden",
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 28 }}>📚</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.2 }}>学习时间</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.name}
              {(item.category || item.sub_category) && (
                <span style={{ color: "#aaa", marginLeft: 8, fontSize: 12 }}>
                  {[item.category, item.sub_category].filter(Boolean).join(" › ")}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#aaa", padding: "0 6px", lineHeight: 1, flexShrink: 0 }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* ── Controls ── */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", background: "#fafbfc" }}>
          {/* Age */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#555", whiteSpace: "nowrap" }}>🎂 孩子年龄</span>
            <input
              type="number" min={3} max={18}
              defaultValue={localAge}
              key={localAge}
              onBlur={(e) => handleAgeBlur(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAgeBlur((e.target as HTMLInputElement).value); }}
              style={{ width: 52, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, textAlign: "center" }}
            />
            <span style={{ fontSize: 13, color: "#555" }}>岁</span>
          </div>

          {/* Language toggle - only in learn tab */}
          {activeTab === "learn" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid #ddd" }}>
            {(["zh", "en"] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => handleLanguageChange(lang)}
                style={{
                  padding: "6px 18px", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
                  background: language === lang ? "#1a73e8" : "#fff",
                  color: language === lang ? "#fff" : "#444",
                  transition: "background 0.15s",
                }}
              >
                {lang === "zh" ? "🇨🇳 中文" : "🇬🇧 English"}
              </button>
            ))}
          </div>
          )}
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: "flex", borderBottom: "2px solid #f0f0f0", background: "#fff" }}>
          <button
            onClick={() => setActiveTab("learn")}
            style={{
              flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14,
              background: "none",
              color: activeTab === "learn" ? "#1a73e8" : "#888",
              borderBottom: activeTab === "learn" ? "2px solid #1a73e8" : "2px solid transparent",
              marginBottom: -2,
              transition: "all 0.15s",
            }}
          >
            📚 学习内容
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            style={{
              flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14,
              background: "none",
              color: activeTab === "chat" ? "#22863a" : "#888",
              borderBottom: activeTab === "chat" ? "2px solid #22863a" : "2px solid transparent",
              marginBottom: -2,
              transition: "all 0.15s",
            }}
          >
            🐼 和小胖对话
          </button>
        </div>

        {/* ── Content area ── */}
        {activeTab === "chat" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <ChatPanel item={item} age={localAge} language={language} />
          </div>
        ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "#888" }}>
              <div style={{ fontSize: 40, marginBottom: 14, animation: "spin 1.2s linear infinite", display: "inline-block" }}>⏳</div>
              <div style={{ fontSize: 15 }}>AI 正在生成学习内容…</div>
              <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>约需 3-6 秒</div>
            </div>
          ) : error ? (
            <div style={{ padding: 16, background: "#fff3cd", borderRadius: 10, color: "#856404", fontSize: 14, lineHeight: 1.6 }}>
              ⚠️ {error}
              <button
                onClick={() => fetchContent(language, variant, localAge)}
                style={{ marginLeft: 12, padding: "4px 10px", background: "#856404", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
              >
                重试
              </button>
            </div>
          ) : content ? (
            <div>
              {/* Format badge */}
              {content.format_name && (
                <div style={{ marginBottom: 14 }}>
                  <span style={{ padding: "3px 12px", background: badge.bg, color: badge.color, borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                    ✦ {content.format_name}
                  </span>
                </div>
              )}

              {/* English word highlight */}
              {content.english_word && (
                <div style={{ marginBottom: 18, padding: "14px 18px", background: "linear-gradient(135deg,#f0f7ff,#e8f0fe)", borderRadius: 12, border: "1px solid #c5d9f7", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 34, fontWeight: 900, color: "#1a73e8", letterSpacing: "-0.5px" }}>
                    {content.english_word}
                  </span>
                  {content.pronunciation && (
                    <span style={{ fontSize: 16, color: "#5f6368", fontFamily: "monospace" }}>{content.pronunciation}</span>
                  )}
                </div>
              )}

              {/* Main content */}
              {content.main_content && (
                <div style={{ lineHeight: 1.9, fontSize: 15, whiteSpace: "pre-wrap", marginBottom: 18, color: "#222" }}>
                  {content.main_content}
                </div>
              )}

              {/* Vocabulary (English) */}
              {content.vocabulary && content.vocabulary.length > 0 && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#15803d", marginBottom: 8 }}>📖 词汇表</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {content.vocabulary.map((v, i) => (
                      <span key={i} style={{ padding: "3px 10px", background: "#dcfce7", color: "#166534", borderRadius: 6, fontSize: 13, fontWeight: 500 }}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Key fact (Chinese) */}
              {content.key_fact && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a", display: "flex", gap: 10 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
                  <div>
                    <span style={{ fontWeight: 700, color: "#92400e", fontSize: 13 }}>知识点：</span>
                    <span style={{ fontSize: 14, color: "#444", lineHeight: 1.7 }}>{content.key_fact}</span>
                  </div>
                </div>
              )}

              {/* Fun fact (English) */}
              {content.fun_fact && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a", display: "flex", gap: 10 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>🌟</span>
                  <div>
                    <span style={{ fontWeight: 700, color: "#92400e", fontSize: 13 }}>Fun Fact: </span>
                    <span style={{ fontSize: 14, color: "#444", lineHeight: 1.7 }}>{content.fun_fact}</span>
                  </div>
                </div>
              )}

              {/* Interaction question */}
              {content.question && (
                <div style={{ padding: "14px 18px", background: "#f3f4f6", borderRadius: 12, borderLeft: "4px solid #1a73e8" }}>
                  <div style={{ fontSize: 14, color: "#333", lineHeight: 1.75 }}>{content.question}</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
        )}

        {/* ── Footer ── */}
        {activeTab === "learn" && (
        <div style={{ padding: "12px 20px", borderTop: "1px solid #f0f0f0", display: "flex", gap: 10, alignItems: "center", background: "#fafbfc", flexWrap: "wrap" }}>
          <button
            onClick={handleSpeak}
            disabled={!content || loading}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "none",
              cursor: (!content || loading) ? "not-allowed" : "pointer",
              background: speaking ? "#dc3545" : "#28a745",
              color: "#fff", fontWeight: 700, fontSize: 14,
              opacity: (!content || loading) ? 0.5 : 1,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {speaking ? "⏹ 停止朗读" : "🔊 朗读"}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: "9px 18px", borderRadius: 8, border: "1px solid #ddd",
              cursor: loading ? "not-allowed" : "pointer",
              background: "#fff", color: "#333", fontWeight: 700, fontSize: 14,
              opacity: loading ? 0.5 : 1,
            }}
          >
            🔄 换一批
          </button>
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#bbb" }}>
            格式 {(variant % 6) + 1}/6
          </div>
          <button
            onClick={onClose}
            style={{ padding: "9px 20px", borderRadius: 8, border: "1px solid #e0e0e0", cursor: "pointer", background: "#fff", color: "#666", fontWeight: 600 }}
          >
            关闭
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
