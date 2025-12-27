"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

function safeNextFromUrl(defaultNext = "/reset-password") {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("next"); // 可能是 "%2Freset-password" 或 "/reset-password"
    if (!raw) return defaultNext;

    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return defaultNext;
    }

    // 安全：只允许站内路径
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) return defaultNext;

    // 确保以 / 开头
    if (!decoded.startsWith("/")) decoded = "/" + decoded;

    return decoded;
  } catch {
    return defaultNext;
  }
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("处理中...");

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        // ✅ next 可能是 %2Freset-password，我们这里统一解码并兜底
        const next = safeNextFromUrl("/reset-password");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("登录回调失败：" + error.message);
            return;
          }
          router.replace(next);
          return;
        }

        // 没有 code：看看是否已有 session（兼容某些链接）
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(next);
          return;
        }

        setMsg("回调链接无效或已过期。请重新发起“忘记密码”或让管理员重新邀请。");
      } catch (e: any) {
        setMsg("回调异常：" + String(e?.message ?? e));
      }
    };

    run();
  }, [router]);

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
