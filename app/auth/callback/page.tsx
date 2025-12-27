"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("处理中...");

  useEffect(() => {
    const run = async () => {
      try {
        // Supabase 邀请/重置/魔法链接常见会带 code 或 token
        const url = new URL(window.location.href);

        // ✅ 新版（PKCE）通常是 code=xxxx
        const code = url.searchParams.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setMsg("登录回调失败：" + error.message);
            return;
          }

          // ✅ 邀请用户通常需要先设置密码
          router.replace("/reset-password");
          return;
        }

        // 兼容一些旧链接：如果没有 code，看看是否已有 session
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          router.replace("/reset-password");
          return;
        }

        setMsg("回调链接无效或已过期，请让管理员重新邀请。");
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
        如果一直停留在此页，说明邀请链接没有成功换取会话（session）。
      </div>
    </div>
  );
}
