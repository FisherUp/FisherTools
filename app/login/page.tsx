"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

function safeRedirectPath(input: string | null) {
  // 只允许站内路径，防止出现奇怪 URL/协议导致不跳
  const p = (input || "/transactions").trim();
  if (!p.startsWith("/")) return "/transactions";
  // 简单过滤掉可能的换行等
  return p.replace(/[\r\n]/g, "");
}

export default function LoginPage() {
  const sp = useSearchParams();
  const redirectedFrom = safeRedirectPath(sp.get("redirectedFrom"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const hardNavigate = (to: string) => {
    // ✅ 最强制的导航方式（比 href 更稳一点）
    setTimeout(() => {
      window.location.assign(to);
    }, 0);
  };
  const signIn = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setMsg("登录失败：" + error.message);
        return;
      }

      // ✅ 关键：不要手动跳转
      // 只刷新当前页面，让 middleware 接管跳转
      window.location.reload();
    } finally {
      setLoading(false);
    }
  };

  

  const signUp = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMsg("注册失败：" + error.message);
        return;
      }
      setMsg("✅ 注册成功。请点击“登录”。（若开启邮箱确认，需要先去邮箱确认）");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>系统登录</h1>

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          />
        </label>

        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          />
        </label>

        {/* 注意：明确 type="button"，避免被当成 submit */}
        <button type="button" onClick={signIn} disabled={loading} style={{ padding: 10, fontWeight: 800 }}>
          {loading ? "处理中..." : "登录"}
        </button>

        <button type="button" onClick={signUp} disabled={loading} style={{ padding: 10 }}>
          注册（初始化用）
        </button>

        {!!msg && (
          <div style={{ background: "#fff3cd", padding: 10, borderRadius: 8 }}>
            {msg}
          </div>
        )}

        <div style={{ fontSize: 12, color: "#666" }}>
          登录后将跳转回：{redirectedFrom}
        </div>
      </div>
    </div>
  );
}
