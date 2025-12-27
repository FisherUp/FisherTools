"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") || "/reset-password";
  const [msg, setMsg] = useState("处理中...");

  useEffect(() => {
    const run = async () => {
      try {
        // 邮件链接一般会带 ?code=xxxx（PKCE）
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("回调失败：" + error.message);
            return;
          }
          router.replace(next);
          return;
        }

        // 没有 code 的情况：看是否已有 session（兼容）
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace(next);
          return;
        }

        setMsg("链接无效或已过期，请重新发起重置密码。");
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
    </div>
  );
}
