"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export type AiParsedItem = {
  name: string;
  primary_category: string;
  sub_category: string;
  quantity: number;
  location: string;
  status: string;
  notes: string;
};

type Props = {
  onApply: (item: AiParsedItem, rawInput: string) => void;
  onBatchApply?: (items: AiParsedItem[], rawInput: string) => void;
  disabled?: boolean;
};

export default function AiInputPanel({ onApply, onBatchApply, disabled }: Props) {
  const [inputText, setInputText] = useState("");
  const [parsedItems, setParsedItems] = useState<AiParsedItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const recognizerRef = useRef<any>(null);
  const sdkRef = useRef<typeof import("microsoft-cognitiveservices-speech-sdk") | null>(null);

  // Lazy load Speech SDK
  const loadSdk = useCallback(async () => {
    if (sdkRef.current) return sdkRef.current;
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");
    sdkRef.current = sdk;
    return sdk;
  }, []);

  // 清理 recognizer
  useEffect(() => {
    return () => {
      if (recognizerRef.current) {
        try { recognizerRef.current.close(); } catch {}
        recognizerRef.current = null;
      }
    };
  }, []);

  // ─── 语音录入 ───
  const startRecording = async () => {
    setError("");
    setLiveTranscript("");

    try {
      // 1. 获取 token
      const tokenRes = await fetch("/api/inventory/speech-token");
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || "获取语音 token 失败");
      }
      const { token, region } = await tokenRes.json();

      // 2. 初始化 Speech SDK
      const sdk = await loadSdk();
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = "zh-CN";

      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      recognizerRef.current = recognizer;

      // 实时识别结果
      let accumulated = "";
      recognizer.recognizing = (_: any, e: any) => {
        setLiveTranscript(accumulated + e.result.text);
      };
      recognizer.recognized = (_: any, e: any) => {
        if (e.result.text) {
          accumulated += e.result.text;
          setLiveTranscript(accumulated);
          setInputText(accumulated);
        }
      };
      recognizer.canceled = (_: any, e: any) => {
        if (e.errorDetails) {
          setError("语音识别出错：" + e.errorDetails);
        }
        setRecording(false);
      };
      recognizer.sessionStopped = () => {
        setRecording(false);
      };

      recognizer.startContinuousRecognitionAsync(
        () => setRecording(true),
        (err: string) => {
          setError("启动语音识别失败：" + err);
          setRecording(false);
        }
      );
    } catch (e: any) {
      setError(e.message || "语音服务不可用");
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognizerRef.current) {
      recognizerRef.current.stopContinuousRecognitionAsync(
        () => {
          setRecording(false);
          recognizerRef.current?.close();
          recognizerRef.current = null;
        },
        () => {
          setRecording(false);
        }
      );
    }
  };

  // ─── AI 解析 ───
  const handleParse = async () => {
    const text = inputText.trim();
    if (!text) return setError("请先输入或说出物资描述");

    setError("");
    setParsing(true);
    setParsedItems([]);

    try {
      const res = await fetch("/api/inventory/ai-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "解析失败");
      }

      const data = await res.json();
      const items: AiParsedItem[] = data.items ?? [];

      if (items.length === 0) {
        setError("AI 未能从输入中识别出物资信息，请重试");
      } else {
        setParsedItems(items);
      }
    } catch (e: any) {
      setError(e.message || "AI 解析失败");
    } finally {
      setParsing(false);
    }
  };

  // ─── 应用到表单 ───
  const handleApplyItem = (item: AiParsedItem) => {
    onApply(item, inputText);
    setExpanded(false);
  };

  const handleApplyAll = () => {
    if (onBatchApply && parsedItems.length > 0) {
      onBatchApply(parsedItems, inputText);
      setExpanded(false);
    }
  };

  return (
    <div style={{ marginBottom: 16, border: "1px solid #e0e0e0", borderRadius: 8, overflow: "hidden" }}>
      {/* 折叠头 */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: expanded ? "#e8f0fe" : "#f8f9fa",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        <span>🤖</span>
        <span>AI 智能录入</span>
        <span style={{ fontSize: 12, color: "#666", fontWeight: 400 }}>
          （语音或文字描述，自动识别分类填表）
        </span>
        <span style={{ marginLeft: "auto" }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: 14, background: "#fafbfc" }}>
          {/* 语音 + 文字输入 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={parsing}
              style={{
                padding: "8px 14px",
                background: recording ? "#dc3545" : "#28a745",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                minWidth: 100,
                animation: recording ? "pulse 1.5s infinite" : "none",
              }}
            >
              {recording ? "⏹ 停止录音" : "🎤 语音输入"}
            </button>

            <button
              type="button"
              onClick={handleParse}
              disabled={parsing || !inputText.trim()}
              style={{
                padding: "8px 14px",
                background: "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: parsing || !inputText.trim() ? "not-allowed" : "pointer",
                fontWeight: 600,
                opacity: parsing || !inputText.trim() ? 0.6 : 1,
              }}
            >
              {parsing ? "⏳ 解析中..." : "✨ AI 解析"}
            </button>
          </div>

          {/* 实时转写预览 */}
          {recording && liveTranscript && (
            <div style={{ padding: 8, background: "#fff3cd", borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
              🎤 实时识别：{liveTranscript}
            </div>
          )}

          {/* 文字输入框 */}
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="示例：厨房里有3把菜刀，5个碗，2个砧板，都在用。还有储物间有10箱矿泉水。"
            rows={3}
            style={{
              width: "100%",
              padding: 8,
              border: "1px solid #ddd",
              borderRadius: 6,
              resize: "vertical",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            💡 支持一次描述多个物资，AI 会自动拆分并识别分类
          </div>

          {/* 错误信息 */}
          {error && (
            <div style={{ padding: 8, background: "#f8d7da", color: "#842029", borderRadius: 6, marginTop: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* 解析结果 */}
          {parsedItems.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                📋 解析结果（{parsedItems.length} 项）
                {parsedItems.length > 1 && onBatchApply && (
                  <button
                    type="button"
                    onClick={handleApplyAll}
                    style={{
                      marginLeft: 12,
                      padding: "4px 10px",
                      background: "#198754",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    全部应用
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {parsedItems.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "8px 10px",
                      background: "#fff",
                      border: "1px solid #e0e0e0",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <strong>{item.name}</strong>
                      <span style={{ color: "#666", marginLeft: 8 }}>
                        {item.primary_category && `${item.primary_category}`}
                        {item.sub_category && ` > ${item.sub_category}`}
                      </span>
                      <span style={{ color: "#1a73e8", marginLeft: 8 }}>×{item.quantity}</span>
                      {item.location && <span style={{ color: "#888", marginLeft: 8 }}>📍{item.location}</span>}
                      {item.notes && <span style={{ color: "#888", marginLeft: 8 }}>📝{item.notes}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyItem(item)}
                      style={{
                        padding: "4px 10px",
                        background: "#1a73e8",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      填入表单
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* pulse animation for recording button */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
