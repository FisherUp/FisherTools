"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchAllServiceTypes,
  createServiceType,
  updateServiceType,
  toggleServiceTypeActive,
} from "@/lib/services/serviceScheduling";

interface ServiceType {
  id: string;
  name: string;
  frequency: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

async function getMyProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("未登录");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) throw new Error("无法获取用户信息");

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role,
  };
}

export default function ServiceTypesClient() {
  const [orgId, setOrgId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 表单状态
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formFrequency, setFormFrequency] = useState("weekly");
  const [formDescription, setFormDescription] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setUserRole(profile.role);

      const types = await fetchAllServiceTypes(profile.orgId);
      setServiceTypes(types);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  function openCreateForm() {
    setEditingId(null);
    setFormName("");
    setFormFrequency("weekly");
    setFormDescription("");
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEditForm(type: ServiceType) {
    setEditingId(type.id);
    setFormName(type.name);
    setFormFrequency(type.frequency);
    setFormDescription(type.description || "");
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormFrequency("weekly");
    setFormDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formName.trim()) {
      setError("请输入服务类型名称");
      return;
    }

    try {
      if (editingId) {
        // 更新
        await updateServiceType(
          editingId,
          formName.trim(),
          formFrequency,
          formDescription.trim() || undefined,
          undefined
        );
        setSuccess("更新成功");
      } else {
        // 创建
        await createServiceType(
          orgId,
          formName.trim(),
          formFrequency,
          formDescription.trim() || undefined
        );
        setSuccess("创建成功");
      }

      closeForm();
      await loadData();
    } catch (err: any) {
      setError(err.message || "操作失败");
    }
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    try {
      setError("");
      setSuccess("");
      await toggleServiceTypeActive(id, !currentActive);
      setSuccess(currentActive ? "已禁用" : "已启用");
      await loadData();
    } catch (err: any) {
      setError(err.message || "操作失败");
    }
  }

  const isAdmin = userRole === "admin";

  if (loading) {
    return <div style={{ padding: 20 }}>加载中...</div>;
  }

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          服务类型管理
        </h1>
        <div style={{ display: "flex", gap: 10 }}>
          <a
            href="/services"
            style={{
              padding: "8px 12px",
              border: "1px solid #0366d6",
              color: "#0366d6",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            返回排班
          </a>
          {isAdmin && (
            <button
              onClick={openCreateForm}
              style={{
                padding: "8px 12px",
                background: "#0366d6",
                color: "white",
                border: "none",
                borderRadius: 4,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + 新建服务类型
            </button>
          )}
        </div>
      </div>

      {/* 消息提示 */}
      {error && (
        <div
          style={{
            padding: 10,
            background: "#ffe6e6",
            color: "#c00",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          style={{
            padding: 10,
            background: "#e6f9e6",
            color: "#1a7a1a",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {success}
        </div>
      )}

      {/* 表单 */}
      {showForm && isAdmin && (
        <div
          style={{
            background: "#f5f5f5",
            padding: 20,
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            {editingId ? "编辑服务类型" : "新建服务类型"}
          </h2>
          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
            <label>
              服务类型名称：
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                }}
                placeholder="如：敬拜主领"
                required
              />
            </label>

            <label>
              频率：
              <select
                value={formFrequency}
                onChange={(e) => setFormFrequency(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                }}
              >
                <option value="weekly">每周（主日）</option>
                <option value="weekday">周中</option>
                <option value="other">其他</option>
              </select>
            </label>

            <label>
              描述（可选）：
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  minHeight: 60,
                }}
                placeholder="服务类型的详细说明"
              />
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button
                type="submit"
                style={{
                  padding: "8px 16px",
                  background: "#0366d6",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {editingId ? "保存" : "创建"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                style={{
                  padding: "8px 16px",
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 服务类型列表 */}
      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                }}
              >
                服务类型
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                }}
              >
                频率
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                }}
              >
                描述
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                }}
              >
                状态
              </th>
              {isAdmin && (
                <th
                  style={{
                    textAlign: "center",
                    padding: 10,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {serviceTypes.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 5 : 4}
                  style={{ padding: 20, textAlign: "center", color: "#999" }}
                >
                  暂无服务类型
                </td>
              </tr>
            ) : (
              serviceTypes.map((type) => (
                <tr key={type.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    {type.name}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    {type.frequency === "weekly"
                      ? "每周（主日）"
                      : type.frequency === "weekday"
                      ? "周中"
                      : "其他"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    {type.description || "-"}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      textAlign: "center",
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        background: type.is_active ? "#e6f9e6" : "#f5f5f5",
                        color: type.is_active ? "#1a7a1a" : "#666",
                      }}
                    >
                      {type.is_active ? "启用" : "禁用"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #eee",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button
                          onClick={() => openEditForm(type)}
                          style={{
                            padding: "4px 8px",
                            border: "1px solid #0366d6",
                            color: "#0366d6",
                            background: "white",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleToggleActive(type.id, type.is_active)}
                          style={{
                            padding: "4px 8px",
                            border: "1px solid #999",
                            color: "#666",
                            background: "white",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {type.is_active ? "禁用" : "启用"}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
