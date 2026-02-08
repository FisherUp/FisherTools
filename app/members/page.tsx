"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type MemberRow = {
  id: string;
  org_id: string;
  name: string;
  member_type: string;
  note: string | null;
  is_active: boolean;
  created_at: string;
};

async function getMyProfile() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(userErr.message);
  const user = userRes.user;
  if (!user) throw new Error("未登录，请先登录。");

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (pErr) throw new Error("读取 profiles 失败：" + pErr.message);
  if (!profile?.org_id) throw new Error("profiles.org_id 为空，请为该用户设置组织。");

  return { userId: user.id, orgId: String(profile.org_id), role: String(profile.role ?? "") };
}

export default function MembersPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [orgId, setOrgId] = useState<string>("");
  const [role, setRole] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [memberType, setMemberType] = useState("");
  const [note, setNote] = useState("");
  const [isActive, setIsActive] = useState(true);

  const isAdmin = role === "admin";

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setMemberType("");
    setNote("");
    setIsActive(true);
  };

  const loadMembers = async (orgIdValue: string, roleValue: string) => {
    setLoading(true);
    setMsg("");
    try {
      let query = supabase
        .from("members")
        .select("id,org_id,name,member_type,note,is_active,created_at")
        .eq("org_id", orgIdValue)
        .order("created_at", { ascending: false });

      if (roleValue !== "admin") {
        query = query.eq("is_active", true);
      }

      const { data, error } = await query;
      if (error) {
        setMsg("加载成员失败：" + error.message);
        setMembers([]);
        return;
      }

      const rows: MemberRow[] = Array.isArray(data)
        ? data.map((x: any) => ({
            id: String(x.id),
            org_id: String(x.org_id),
            name: String(x.name),
            member_type: String(x.member_type ?? ""),
            note: x.note ?? null,
            is_active: Boolean(x.is_active),
            created_at: String(x.created_at),
          }))
        : [];

      setMembers(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setMsg("");
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setRole(profile.role);
        await loadMembers(profile.orgId, profile.role);
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      }
    };

    init();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return setMsg("仅管理员可维护成员。");

    const nameTrim = name.trim();
    const typeTrim = memberType.trim();
    const noteTrim = note.trim();

    if (!nameTrim) return setMsg("请填写姓名");

    setLoading(true);
    setMsg("");
    try {
      if (!orgId) throw new Error("组织信息缺失");

      if (editingId) {
        const payload: any = {
          name: nameTrim,
          note: noteTrim || null,
          is_active: isActive,
        };
        if (typeTrim) payload.member_type = typeTrim;

        const { error } = await supabase
          .from("members")
          .update(payload)
          .eq("id", editingId)
          .eq("org_id", orgId);

        if (error) return setMsg("更新失败：" + error.message);
        setMsg("✅ 已更新成员");
      } else {
        const payload: any = {
          org_id: orgId,
          name: nameTrim,
          note: noteTrim || null,
          is_active: isActive,
        };
        if (typeTrim) payload.member_type = typeTrim;

        const { error } = await supabase.from("members").insert(payload);
        if (error) return setMsg("新增失败：" + error.message);
        setMsg("✅ 已新增成员");
      }

      resetForm();
      await loadMembers(orgId, role);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (m: MemberRow) => {
    if (!isAdmin) return;
    setEditingId(m.id);
    setName(m.name);
    setMemberType(m.member_type || "");
    setNote(m.note ?? "");
    setIsActive(Boolean(m.is_active));
  };

  const toggleActive = async (m: MemberRow) => {
    if (!isAdmin) return setMsg("仅管理员可维护成员。");

    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase
        .from("members")
        .update({ is_active: !m.is_active })
        .eq("id", m.id)
        .eq("org_id", orgId);

      if (error) return setMsg("更新失败：" + error.message);
      await loadMembers(orgId, role);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>经手人管理</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回流水
          </a>
        </div>
      </div>

      {!isAdmin && (
        <div style={{ marginBottom: 12, padding: 10, background: "#f5f5f5", borderRadius: 8 }}>
          你当前为非管理员，仅可查看启用状态成员。
        </div>
      )}

      {!!msg && <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 8 }}>{msg}</div>}

      {isAdmin && (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{editingId ? "编辑成员" : "新增成员"}</div>

          <label>
            姓名：
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            />
          </label>

          <label>
            成员类型（可选）：
            <input
              value={memberType}
              onChange={(e) => setMemberType(e.target.value)}
              placeholder="例如：会友"
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            />
          </label>

          <label>
            备注（可选）：
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            启用
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={loading} style={{ padding: "8px 12px", fontWeight: 700 }}>
              {loading ? "处理中..." : editingId ? "保存修改" : "新增"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                style={{ padding: "8px 12px", border: "1px solid #ddd", background: "#fff" }}
              >
                取消编辑
              </button>
            )}
          </div>
        </form>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>姓名</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类型</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>备注</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>状态</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>创建时间</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 14, color: "#666" }}>
                  暂无成员
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{m.name}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{m.member_type || "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{m.note ?? ""}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                    {m.is_active ? "启用" : "停用"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                    {m.created_at ? new Date(m.created_at).toLocaleString() : "-"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          style={{ marginRight: 8, border: "1px solid #0366d6", color: "#0366d6" }}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(m)}
                          style={{ border: "1px solid #c00", color: "#c00" }}
                        >
                          {m.is_active ? "停用" : "启用"}
                        </button>
                      </>
                    ) : (
                      <span style={{ color: "#999" }}>-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
