"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setMsg("当前链接无效或未登录。请通过邀请邮件链接进入，或让管理员重新邀请。");
        setReady(false);
        return;
      }
      setReady(true);
    };
    check();
  }, []);

  const update = async () => {
    if (!ready) return;
    if (password.length < 6) return setMsg("密码至少 6 位");
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return setMsg("修改失败：" + error.message);

      setMsg("✅ 密码已设置成功，请重新登录。");
      // 设置完密码后建议退出，让用户走正常登录流程
      await supabase.auth.signOut();
      setTimeout(() => router.replace("/login"), 800);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12 }}>设置新密码</h1>

      <input
        type="password"
        placeholder="请输入新密码（至少6位）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        disabled={!ready}
      />

      <button
        onClick={update}
        disabled={loading || !ready}
        style={{ padding: 10, width: "100%", fontWeight: 800 }}
      >
        {loading ? "处理中..." : "确认设置密码"}
      </button>

      {!!msg && (
        <div style={{ marginTop: 10, background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
