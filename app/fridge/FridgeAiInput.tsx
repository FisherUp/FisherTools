"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  FRIDGE_CATEGORIES,
  FRIDGE_LOCATIONS,
  FridgeItemInput,
  addDays,
  localDateString,
} from "../../lib/fridge";

type Candidate = FridgeItemInput & {
  confidence: number;
  shelf_life_days: number;
};

type Props = {
  disabled?: boolean;
  onConfirm: (items: FridgeItemInput[]) => Promise<void>;
};

export default function FridgeAiInput({ disabled, onConfirm }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognizerRef = useRef<import("microsoft-cognitiveservices-speech-sdk").SpeechRecognizer | null>(null);
  const speechSdkRef = useRef<typeof import("microsoft-cognitiveservices-speech-sdk") | null>(null);

  useEffect(() => {
    return () => {
      try {
        recognizerRef.current?.close();
      } catch {
        // The recognizer may already be closed by Azure Speech.
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const loadSpeechSdk = useCallback(async () => {
    if (speechSdkRef.current) return speechSdkRef.current;
    const sdk = await import("microsoft-cognitiveservices-speech-sdk");
    speechSdkRef.current = sdk;
    return sdk;
  }, []);

  const startRecording = async () => {
    setError("");
    setTranscript("");
    try {
      const tokenResponse = await fetch("/api/inventory/speech-token");
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenPayload.error || "获取语音授权失败");

      const sdk = await loadSpeechSdk();
      const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(
        tokenPayload.token,
        tokenPayload.region
      );
      speechConfig.speechRecognitionLanguage = "zh-CN";
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      recognizerRef.current = recognizer;
      let accepted = "";

      recognizer.recognizing = (_sender, event) => {
        setTranscript((accepted + event.result.text).trim());
      };
      recognizer.recognized = (_sender, event) => {
        if (!event.result.text) return;
        accepted = `${accepted}${accepted ? " " : ""}${event.result.text}`.trim();
        setTranscript(accepted);
        setText(accepted);
      };
      recognizer.canceled = (_sender, event) => {
        if (event.errorDetails) setError("语音识别失败：" + event.errorDetails);
        setRecording(false);
      };
      recognizer.sessionStopped = () => setRecording(false);
      recognizer.startContinuousRecognitionAsync(
        () => setRecording(true),
        (reason: string) => {
          setError("无法启动语音识别：" + reason);
          setRecording(false);
        }
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "语音识别不可用，请改用文字输入");
      setRecording(false);
    }
  };

  const stopRecording = () => {
    recognizerRef.current?.stopContinuousRecognitionAsync(
      () => {
        setRecording(false);
        recognizerRef.current?.close();
        recognizerRef.current = null;
      },
      () => setRecording(false)
    );
  };

  const parseRequest = async (payload: Record<string, unknown>) => {
    setParsing(true);
    setError("");
    setCandidates([]);
    try {
      const response = await fetch("/api/fridge/ai-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, today: localDateString() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 识别失败");
      const normalized = (Array.isArray(data.items) ? data.items : [])
        .map(normalizeCandidate)
        .filter((item: Candidate | null): item is Candidate => Boolean(item));
      if (normalized.length === 0) throw new Error("没有识别到可入库的食材，请补充描述或手工添加");
      setCandidates(normalized);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "AI 识别失败");
    } finally {
      setParsing(false);
    }
  };

  const parseText = () => {
    if (!text.trim()) return setError("请先输入或说出食材信息");
    void parseRequest({ text: text.trim() });
  };

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError("原始图片超过 15 MB，请换一张较小的图片");
      event.target.value = "";
      return;
    }
    try {
      const compressed = await compressImage(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
      await parseRequest({
        text: text.trim(),
        imageBase64: compressed.base64,
        imageMimeType: compressed.mimeType,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "读取图片失败");
    } finally {
      event.target.value = "";
    }
  };

  const updateCandidate = <K extends keyof Candidate>(index: number, key: K, value: Candidate[K]) => {
    setCandidates((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, [key]: value } : candidate
      )
    );
  };

  const confirm = async () => {
    const invalid = candidates.find(
      (candidate) =>
        !candidate.name.trim() ||
        !candidate.unit.trim() ||
        candidate.quantity <= 0 ||
        !candidate.purchase_date ||
        !candidate.expiry_date
    );
    if (invalid) return setError("候选项中有名称、数量、单位或日期未填写完整");
    if (candidates.some((candidate) => candidate.expiry_date < candidate.purchase_date)) {
      return setError("候选项中的到期日不能早于购买日");
    }

    setConfirming(true);
    setError("");
    try {
      await onConfirm(candidates);
      setCandidates([]);
      setText("");
      setTranscript("");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <section className="fridge-ai-panel" aria-labelledby="fridge-ai-title">
      <button
        className="fridge-panel-toggle"
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span id="fridge-ai-title">AI 智能入库</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="fridge-ai-body">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={selectImage}
          />
          <div className="fridge-ai-compose">
            <textarea
              value={text}
              rows={3}
              maxLength={2000}
              disabled={disabled || parsing}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：今天买了 3 个番茄、一盒开封牛奶，牛奶后天到期"
            />
            <div className="fridge-ai-actions">
              <button
                type="button"
                className={`fridge-button ${recording ? "danger" : "secondary"}`}
                onClick={recording ? stopRecording : startRecording}
                disabled={disabled || parsing}
              >
                {recording ? "停止录音" : "语音输入"}
              </button>
              <button
                type="button"
                className="fridge-button secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || parsing}
              >
                拍照识别
              </button>
              <button
                type="button"
                className="fridge-button primary"
                onClick={parseText}
                disabled={disabled || parsing || !text.trim()}
              >
                {parsing ? "识别中..." : "识别文字"}
              </button>
            </div>
          </div>

          {recording && <div className="fridge-live-text">正在听：{transcript || "请开始说话..."}</div>}
          {previewUrl && (
            <div className="fridge-image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="待识别食材" />
              <span>图片仅用于本次 AI 识别，不会上传到图床</span>
            </div>
          )}
          {error && <div className="fridge-message error">{error}</div>}

          {candidates.length > 0 && (
            <div className="fridge-candidates">
              <div className="fridge-candidate-head">
                <div>
                  <strong>确认后再入库</strong>
                  <span>请核对 AI 识别的数量和日期</span>
                </div>
                <button
                  type="button"
                  className="fridge-button primary"
                  onClick={confirm}
                  disabled={confirming}
                >
                  {confirming ? "保存中..." : `确认 ${candidates.length} 项`}
                </button>
              </div>

              <div className="fridge-candidate-list">
                {candidates.map((candidate, index) => (
                  <div className="fridge-candidate" key={`${candidate.name}-${index}`}>
                    <div className="fridge-candidate-title">
                      <span>候选 {index + 1}</span>
                      <span className={candidate.confidence < 0.65 ? "confidence low" : "confidence"}>
                        可信度 {Math.round(candidate.confidence * 100)}%
                      </span>
                      <button
                        type="button"
                        className="fridge-icon-button"
                        aria-label={`移除候选 ${candidate.name}`}
                        title="移除候选"
                        onClick={() => setCandidates((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        ×
                      </button>
                    </div>
                    <div className="fridge-candidate-grid">
                      <label className="fridge-field fridge-span-2">
                        <span>食材</span>
                        <input
                          value={candidate.name}
                          onChange={(event) => updateCandidate(index, "name", event.target.value)}
                        />
                      </label>
                      <label className="fridge-field">
                        <span>分类</span>
                        <select
                          value={candidate.category}
                          onChange={(event) =>
                            updateCandidate(index, "category", event.target.value as Candidate["category"])
                          }
                        >
                          {FRIDGE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="fridge-field">
                        <span>位置</span>
                        <select
                          value={candidate.storage_location}
                          onChange={(event) =>
                            updateCandidate(
                              index,
                              "storage_location",
                              event.target.value as Candidate["storage_location"]
                            )
                          }
                        >
                          {FRIDGE_LOCATIONS.map((location) => <option key={location}>{location}</option>)}
                        </select>
                      </label>
                      <label className="fridge-field">
                        <span>数量</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={candidate.quantity}
                          onChange={(event) => updateCandidate(index, "quantity", Number(event.target.value))}
                        />
                      </label>
                      <label className="fridge-field">
                        <span>单位</span>
                        <input
                          value={candidate.unit}
                          onChange={(event) => updateCandidate(index, "unit", event.target.value)}
                        />
                      </label>
                      <label className="fridge-field">
                        <span>购买日</span>
                        <input
                          type="date"
                          value={candidate.purchase_date}
                          onChange={(event) => updateCandidate(index, "purchase_date", event.target.value)}
                        />
                      </label>
                      <label className="fridge-field">
                        <span>到期日</span>
                        <input
                          type="date"
                          value={candidate.expiry_date}
                          onChange={(event) => updateCandidate(index, "expiry_date", event.target.value)}
                        />
                      </label>
                      <label className="fridge-check fridge-span-2">
                        <input
                          type="checkbox"
                          checked={candidate.opened}
                          onChange={(event) => updateCandidate(index, "opened", event.target.checked)}
                        />
                        <span>已开封</span>
                      </label>
                      <label className="fridge-field fridge-span-2">
                        <span>备注</span>
                        <input
                          value={candidate.notes ?? ""}
                          maxLength={500}
                          onChange={(event) => updateCandidate(index, "notes", event.target.value)}
                          placeholder="包装状态或识别说明"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function normalizeCandidate(value: unknown): Candidate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const today = localDateString();
  const shelfLife = clamp(Number(row.shelf_life_days), 0, 3650, 7);
  return {
    name,
    category: FRIDGE_CATEGORIES.includes(row.category as Candidate["category"])
      ? (row.category as Candidate["category"])
      : "其他",
    quantity: clamp(Number(row.quantity), 0.01, 100000, 1),
    unit: String(row.unit ?? "份").trim() || "份",
    purchase_date: validDate(row.purchase_date) ? String(row.purchase_date) : today,
    expiry_date: validDate(row.expiry_date) ? String(row.expiry_date) : addDays(today, shelfLife),
    shelf_life_days: shelfLife,
    storage_location: FRIDGE_LOCATIONS.includes(row.storage_location as Candidate["storage_location"])
      ? (row.storage_location as Candidate["storage_location"])
      : "冷藏室",
    opened: Boolean(row.opened),
    notes: String(row.notes ?? "").trim(),
    confidence: clamp(Number(row.confidence), 0, 1, 0.7),
  };
}

async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  const image = await loadImage(file);
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法处理图片，请改用文字输入");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
  if (!blob) throw new Error("图片压缩失败");
  const dataUrl = await blobToDataUrl(blob);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取这张图片"));
    };
    image.src = url;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取压缩后的图片"));
    reader.readAsDataURL(blob);
  });
}

function validDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
