"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";

type RoleValue = "admin" | "finance" | "coordinator" | "viewer" | "inventory-edit" | "learner";

const ROLE_OPTIONS: { value: RoleValue; label: string; desc: string; color: string }[] = [
  { value: "admin",          label: "管理员",     desc: "全部权限，含删除和设置",           color: "#d73a49" },
  { value: "finance",        label: "财务",       desc: "财务流水、物资（增/改）",           color: "#1a73e8" },
  { value: "coordinator",    label: "协调员",     desc: "服务排班管理",                     color: "#6f42c1" },
  { value: "viewer",         label: "观察者",     desc: "只读，不可编辑任何内容",            color: "#6c757d" },
  { value: "inventory-edit", label: "物资编辑员", desc: "仅物资模块（增/改），无学习功能",   color: "#28a745" },
  { value: "learner",        label: "学习者",     desc: "物资模块（增/改）+ 学习功能 + 小胖对话", color: "#fd7e14" },
];

type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: RoleValue;
  org_id: string;
};

async function getMyProfile() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(userErr.message);
  const user = userRes.user;
  if (!user) throw new Error("未登录");
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  if (pErr) throw new Error(pErr.message);
  return { userId: user.id, orgId: profile.org_id as string, role: profile.role as string };
}

export default function ProfilesClient() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // id being saved
  const [msg, setMsg] = useState("");
  const [myId, setMyId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<Record<string, RoleValue>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const me = await getMyProfile();
      setMyId(me.userId);
      setIsAdmin(me.role === "admin");
      if (me.role !== "admin") {
        setMsg("仅管理员可访问用户权限管理页面。");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, role, org_id")
        .eq("org_id", me.orgId)
        .order("display_name", { ascending: true });

      if (error) throw new Error(error.message);
      const rows = (data ?? []).map((r: any) => ({
        id: r.id,
        email: r.email ?? "",
        display_name: r.display_name ?? null,
        role: (r.role ?? "viewer") as RoleValue,
        org_id: r.org_id,
      }));
      setProfiles(rows);
      // Init pending roles
      const init: Record<string, RoleValue> = {};
      rows.forEach((r) => { init[r.id] = r.role; });
      setPendingRoles(init);
    } catch (e: any) {
      setMsg("加载失败：" + (e.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = (id: string, role: RoleValue) => {
    setPendingRoles((prev) => ({ ...prev, [id]: role }));
  };

  const handleSave = async (profileId: string) => {
    const newRole = pendingRoles[profileId];
    setSaving(profileId);
    setMsg("");
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", profileId);
      if (error) throw new Error(error.message);
      setProfiles((prev) => prev.map((p) => p.id === profileId ? { ...p, role: newRole } : p));
      setMsg(`✅ 已将角色更新为「${ROLE_OPTIONS.find((r) => r.value === newRole)?.label ?? newRole}」`);
    } catch (e: any) {
      setMsg("保存失败：" + (e.message ?? String(e)));
    } finally {
      setSaving(null);
    }
  };

  const isDirty = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    return profile && pendingRoles[id] !== profile.role;
  };

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>👤 用户权限管理</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/inventory"
            style={{ padding: "8px 14px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none", color: "#555", fontSize: 13 }}>
            ← 返回物资
          </a>
        </div>
      </div>

      {!!msg && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 8, fontSize: 13,
          background: msg.startsWith("✅") ? "#d4edda" : "#fff3cd",
          color: msg.startsWith("✅") ? "#155724" : "#856404",
        }}>
          {msg}
        </div>
      )}

      {/* Role legend */}
      <div style={{ marginBottom: 20, padding: "12px 16px", background: "#f8f9fa", borderRadius: 10, border: "1px solid #e9ecef" }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "#555" }}>📘 角色说明</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {ROLE_OPTIONS.map((r) => (
            <div key={r.value} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{
                display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11,
                fontWeight: 700, background: r.color + "22", color: r.color,
                whiteSpace: "nowrap", flexShrink: 0, marginTop: 1,
              }}>
                {r.label}
              </span>
              <span style={{ fontSize: 12, color: "#666", lineHeight: 1.4 }}>{r.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 32, textAlign: "center", color: "#888" }}>加载中…</div>
      ) : !isAdmin ? (
        <div style={{ padding: 32, textAlign: "center", color: "#888" }}>权限不足，仅管理员可管理用户角色。</div>
      ) : profiles.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#888" }}>暂无用户数据</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {profiles.map((p) => {
            const selectedRole = pendingRoles[p.id] ?? p.role;
            const roleInfo = ROLE_OPTIONS.find((r) => r.value === selectedRole);
            const dirty = isDirty(p.id);
            const isSelf = p.id === myId;

            return (
              <div key={p.id} style={{
                padding: "12px 16px",
                border: `1px solid ${dirty ? "#fde68a" : "#e9ecef"}`,
                borderRadius: 10,
                background: dirty ? "#fffbeb" : "#fff",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                transition: "border-color 0.15s, background 0.15s",
              }}>
                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "#e8f0fe", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, flexShrink: 0,
                }}>
                  {isSelf ? "🙋" : "👤"}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    {p.display_name || p.email || p.id.slice(0, 8)}
                    {isSelf && <span style={{ fontSize: 11, color: "#888", fontWeight: 400 }}>（我）</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.email || p.id}
                  </div>
                </div>

                {/* Role selector */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={selectedRole}
                    onChange={(e) => !isSelf && handleRoleChange(p.id, e.target.value as RoleValue)}
                    disabled={isSelf || saving === p.id}
                    title={isSelf ? "不能修改自己的角色" : ""}
                    style={{
                      padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6,
                      fontSize: 13, cursor: isSelf ? "not-allowed" : "pointer",
                      background: isSelf ? "#f5f5f5" : "#fff",
                      color: roleInfo?.color ?? "#333",
                      fontWeight: 600,
                      minWidth: 110,
                    }}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleSave(p.id)}
                    disabled={!dirty || isSelf || saving === p.id}
                    style={{
                      padding: "6px 14px", border: "none", borderRadius: 6,
                      background: dirty && !isSelf ? "#1a73e8" : "#e9ecef",
                      color: dirty && !isSelf ? "#fff" : "#aaa",
                      fontWeight: 700, fontSize: 13,
                      cursor: dirty && !isSelf ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {saving === p.id ? "保存…" : "保存"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
