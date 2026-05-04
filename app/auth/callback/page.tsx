"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

const DEFAULT_RESET_PATH = "/reset-password";
type EmailOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

const EMAIL_OTP_TYPES: EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function safeOtpType(rawType: string | null): EmailOtpType {
  if (EMAIL_OTP_TYPES.includes(rawType as EmailOtpType)) return rawType as EmailOtpType;
  return "recovery";
}

function normalizeNextPath(rawNext: string | null, defaultNext = DEFAULT_RESET_PATH) {
  if (!rawNext) return defaultNext;

  let next = rawNext.trim();
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(next);
      if (decoded === next) break;
      next = decoded;
    } catch {
      return defaultNext;
    }
  }

  // 兼容旧邮件中路径斜杠被编码成 %2F，甚至百分号被吞掉后剩下 2F 的情况。
  if (/^2f/i.test(next)) next = `/${next.slice(2)}`;

  // 安全：只允许站内路径，避免把回调变成开放重定向。
  if (/^[a-z][a-z\d+\-.]*:/i.test(next) || next.startsWith("//")) return defaultNext;

  if (!next.startsWith("/")) next = "/" + next;
  return next;
}

function safeNextFromUrl(defaultNext = DEFAULT_RESET_PATH) {
  try {
    const url = new URL(window.location.href);
    return normalizeNextPath(url.searchParams.get("next"), defaultNext);
  } catch {
    return defaultNext;
  }
}

export default function AuthCallbackPage() {
  const [msg, setMsg] = useState("处理中...");

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = safeOtpType(url.searchParams.get("type"));

        const next = safeNextFromUrl(DEFAULT_RESET_PATH);

        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type,
          });
          if (error) {
            setMsg("登录回调失败：" + error.message);
            return;
          }
          window.location.replace(next);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("登录回调失败：" + error.message);
            return;
          }
          window.location.replace(next);
          return;
        }

        // 没有 code：看看是否已有 session（兼容某些链接）
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          window.location.replace(next);
          return;
        }

        setMsg("回调链接无效或已过期。请重新发起“忘记密码”或让管理员重新邀请。");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        setMsg("回调异常：" + message);
      }
    };

    run();
  }, []);

  return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 800 }}>登录回调</h1>
      <div style={{ marginTop: 10, background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
        {msg}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
        如果一直停留在此页，说明回调链接没有成功换取会话（session）。
      </div>
    </div>
  );
}
