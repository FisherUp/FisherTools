"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const redirectedFrom = sp.get("redirectedFrom") || "/transactions";
  const redirectedFromDecoded = decodeURIComponent(redirectedFrom);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return setMsg("登录失败：" + error.message);

      // ✅ 稳一点：登录成功后刷新路由状态
      router.replace(redirectedFrom);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const signUp = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return setMsg("注册失败：" + error.message);
      setMsg("✅ 注册成功。请点击“登录”。（若开启邮箱确认，需要先去邮箱确认）");
    } finally {
      setLoading(false);
    }
  };
  
const resetPassword = async () => {
  const emailTrim = email.trim();
  if (!emailTrim) return setMsg("请先输入邮箱");

  setLoading(true);
  setMsg("");
  try {
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(emailTrim, { redirectTo });
    if (error) return setMsg("发送失败：" + error.message);

    setMsg("✅ 已发送重置密码邮件，请到邮箱打开链接设置新密码。");
  } finally {
    setLoading(false);
  }
};


  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>系统登录</h1>

      <div style={{ display: "grid", gap: 10 }}>
        <label htmlFor="email" style={{ fontSize: 14 }}>
          邮箱
        </label>
        <input
          id="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          style={{ width: "100%", padding: 10 }}
        />

        <label htmlFor="password" style={{ fontSize: 14 }}>
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
          style={{ width: "100%", padding: 10 }}
        />

        <button onClick={signIn} disabled={loading} style={{ padding: 10, fontWeight: 800 }}>
          {loading ? "处理中..." : "登录"}
        </button>
        <button onClick={resetPassword} disabled={loading} style={{ padding: 10 }}>
         忘记密码（发邮件重置）
        </button>


        {!!msg && <div style={{ background: "#fff3cd", padding: 10, borderRadius: 8 }}>{msg}</div>}

        <div style={{ fontSize: 12, color: "#666" }}>登录后将跳转回：{redirectedFromDecoded}</div>
      </div>
    </div>
  );
}
