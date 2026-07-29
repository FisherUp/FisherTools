"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** AI 解析出的流水字段（名称形式，由调用方映射为 id） */
export type AiTxResult = {
  date: string;
  direction: "income" | "expense";
  amount_yuan: number;
  category: string;
  account: string;
  handler1: string;
  handler2: string;
  description: string;
};

type Props = {
  /**
   * 解析成功回调。
   * @param result 解析结果
   * @param photo  用户拍摄/选择的原始图片（可留作附件），文字/语音模式为 null
   */
  onParsed: (result: AiTxResult, photo: File | null) => void;
  disabled?: boolean;
};

/* ------------------------------------------------------------------ */
/* 图片压缩：识别用的小图（省流量、AI 更快）                            */
/* ------------------------------------------------------------------ */
function compressToBase64(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas 不可用"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读取图片失败"));
    };
    img.src = url;
  });
}

let sdkPromise: Promise<any> | null = null;
function loadSpeechSdk() {
  if (!sdkPromise) sdkPromise = import("microsoft-cognitiveservices-speech-sdk");
  return sdkPromise;
}

export default function AiTxInputPanel({ onParsed, disabled }: Props) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [keepAsAttachment, setKeepAsAttachment] = useState(true);

  const [recording, setRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [parsing, setParsing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const recognizerRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      recognizerRef.current?.close?.();
    };
  }, [photoUrl]);

  /* ---------------- 语音 ---------------- */
  const startRecording = useCallback(async () => {
    setError("");
    setLiveTranscript("");
    try {
      const tokenRes = await fetch("/api/inventory/speech-token");
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || "获取语音 token 失败");
      }
      const { token, region } = await tokenRes.json();

      const sdk = await loadSpeechSdk();
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
      speechConfig.speechRecognitionLanguage = "zh-CN";

      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      recognizerRef.current = recognizer;

      let finalText = "";
      recognizer.recognizing = (_s: any, e: any) => setLiveTranscript(finalText + e.result.text);
      recognizer.recognized = (_s: any, e: any) => {
        if (e.result?.text) {
          finalText += e.result.text;
          setLiveTranscript(finalText);
        }
      };
      recognizer.canceled = (_s: any, e: any) => {
        setError("语音识别中断：" + (e.errorDetails || ""));
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
      setError(e?.message || "语音服务不可用");
      setRecording(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recognizerRef.current;
    if (!rec) return;
    rec.stopContinuousRecognitionAsync(
      () => {
        setRecording(false);
        setText((prev) => (liveTranscript ? (prev ? prev + " " + liveTranscript : liveTranscript) : prev));
        setLiveTranscript("");
        rec.close();
        recognizerRef.current = null;
      },
      () => setRecording(false)
    );
  }, [liveTranscript]);

  /* ---------------- 拍照 ---------------- */
  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(f);
    setPhotoUrl(URL.createObjectURL(f));
    setError("");
  };

  const clearPhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(null);
    setPhotoUrl("");
    if (fileRef.current) fileRef.current.value = "";
  };

  /* ---------------- 解析 ---------------- */
  const doParse = async () => {
    const content = (text + " " + liveTranscript).trim();
    if (!content && !photo) {
      setError("请先说一句话、输入文字，或拍一张票据照片");
      return;
    }
    setError("");
    setParsing(true);
    setElapsed(0);
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 100) / 10), 100);

    try {
      const payload: Record<string, unknown> = {};
      if (content) payload.text = content;
      if (photo) {
        payload.imageBase64 = await compressToBase64(photo);
        payload.imageMimeType = "image/jpeg";
      }

      const res = await fetch("/api/transactions/ai-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "解析失败");

      onParsed(data.result as AiTxResult, keepAsAttachment ? photo : null);
    } catch (e: any) {
      setError(e?.message || "解析失败");
    } finally {
      clearInterval(timer);
      setParsing(false);
    }
  };

  const busy = disabled || parsing;

  return (
    <div
      style={{
        border: "1px solid #dbeafe",
        background: "linear-gradient(180deg,#f8fbff 0%,#ffffff 100%)",
        borderRadius: 10,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: "#1d4ed8" }}>✨ AI 快速录入</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          说一句话 / 输入文字 / 拍票据 → 自动填表，确认无误后再提交
        </span>
      </div>

      {/* 文本 + 语音 */}
      <textarea
        value={recording && liveTranscript ? (text ? text + " " + liveTranscript : liveTranscript) : text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={busy || recording}
        placeholder="例如：今天报销吃饭 120 元，现金支付，经手人张三"
        style={{ width: "100%", padding: 10, boxSizing: "border-box", resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          disabled={busy}
          className="ft-btn"
          style={
            recording
              ? { background: "#dc2626", borderColor: "#dc2626", color: "#fff" }
              : undefined
          }
        >
          {recording ? "⏹ 停止录音" : "🎤 语音输入"}
        </button>

        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="ft-btn">
          📷 拍照 / 选图
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickPhoto}
          style={{ display: "none" }}
        />

        <button
          type="button"
          onClick={doParse}
          disabled={busy || recording}
          className="ft-btn ft-btn-primary"
          style={{ marginLeft: "auto" }}
        >
          {parsing ? `识别中… ${elapsed}s` : "🚀 AI 识别并填表"}
        </button>
      </div>

      {recording && (
        <div style={{ fontSize: 12, color: "#dc2626" }}>
          ● 正在聆听… {liveTranscript ? `「${liveTranscript}」` : "请开始说话"}
        </div>
      )}

      {photoUrl && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt="票据预览"
            style={{
              width: 92,
              height: 92,
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid #e3e8ef",
            }}
          />
          <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={keepAsAttachment}
                onChange={(e) => setKeepAsAttachment(e.target.checked)}
              />
              保存这张照片为附件（提交时自动上传并压缩）
            </label>
            <button type="button" onClick={clearPhoto} className="ft-btn ft-btn-sm">
              移除照片
            </button>
          </div>
        </div>
      )}

      {!!error && (
        <div
          style={{
            fontSize: 12,
            color: "#b91c1c",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
