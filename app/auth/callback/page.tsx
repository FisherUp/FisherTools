"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

function safeDecodeNext(raw: string | null, fallback = "/reset-password") {
  if (!raw) return fallback;

  // 有些情况下 raw 可能是 "%2Freset-password"，也可能是 "/reset-password"
  // try/catch 防止用户手动改坏导致 decode 报错
  let v = raw;
  try {
    v = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  // 只允许站内路径，防止跳到外部网站
  if (v.startsWith("http://") || v.startsWith("https://")) return fallback;

  // 确保以 / 开头
  if (!v.startsWith("/")) v = "/" + v;

  return v;
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [msg, setMsg] = useState("处理中...");

  const next = useMemo(() => safeDecodeNext(sp.get("next"), "/reset-password"), [sp]);

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("登录回调失败：" + error.message);
            return;
          }
          router.replace(next);
          return;
        }

        // 兼容：如果没有 code，看 session
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(next);
          return;
        }

        setMsg("链接无效或已过期，请重新发起“忘记密码”。");
      } catch (e: any) {
        setMsg("回调异常：" + String(e?.message ?? e));
      }
    };

    run();
  }, [router, next]);

  return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 800 }}>登录回调</h1>
      <div style={{ marginTop: 10, background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
        {msg}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
        将跳转到：{next}
      </div>
    </div>
  );
}
