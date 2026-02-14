"use client";

import { useEffect, useState } from "react";
import {
  getMyProfile,
  fetchAllInventoryCategories,
  fetchAllInventoryLocations,
  createInventoryCategory,
  createInventoryLocation,
  updateInventoryCategory,
  updateInventoryLocation,
  deleteInventoryCategory,
  deleteInventoryLocation,
  InventoryCategory,
  InventoryLocation,
} from "@/lib/services/inventoryService";

export default function InventorySettingsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  // 新增表单
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newLocationName, setNewLocationName] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const isAdmin = role === "admin";

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setRole(profile.role);

      const [categoriesData, locationsData] = await Promise.all([
        fetchAllInventoryCategories(profile.orgId),
        fetchAllInventoryLocations(profile.orgId),
      ]);

      setCategories(categoriesData);
      setLocations(locationsData);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) {
      setError("请填写类别名称");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await createInventoryCategory(orgId, newCategoryName.trim());
      setNewCategoryName("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "添加类别失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddLocation() {
    if (!newLocationName.trim()) {
      setError("请填写位置名称");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await createInventoryLocation(orgId, newLocationName.trim());
      setNewLocationName("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "添加位置失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleCategoryActive(id: string, currentActive: boolean) {
    try {
      setError("");
      await updateInventoryCategory(id, { is_active: !currentActive });
      await loadData();
    } catch (err: any) {
      setError(err.message || "更新类别失败");
    }
  }

  async function handleToggleLocationActive(id: string, currentActive: boolean) {
    try {
      setError("");
      await updateInventoryLocation(id, { is_active: !currentActive });
      await loadData();
    } catch (err: any) {
      setError(err.message || "更新位置失败");
    }
  }

  async function handleDeleteCategory(id: string, name: string) {
    if (!confirm(`确定要删除类别"${name}"吗？`)) return;

    try {
      setError("");
      await deleteInventoryCategory(id);
      await loadData();
    } catch (err: any) {
      setError(err.message || "删除类别失败");
    }
  }

  async function handleDeleteLocation(id: string, name: string) {
    if (!confirm(`确定要删除位置"${name}"吗？`)) return;

    try {
      setError("");
      await deleteInventoryLocation(id);
      await loadData();
    } catch (err: any) {
      setError(err.message || "删除位置失败");
    }
  }

  if (loading) {
    return <div style={{ padding: 20 }}>加载中...</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
        <div style={{ padding: 20, background: "#fff3cd", borderRadius: 8 }}>
          仅管理员可以管理物资类别和位置设置
        </div>
        <div style={{ marginTop: 20 }}>
          <a href="/inventory" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回物资管理
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          物资类别和位置管理
        </h1>
        <a
          href="/inventory"
          style={{
            padding: "8px 12px",
            border: "1px solid #0366d6",
            color: "#0366d6",
            borderRadius: 4,
            textDecoration: "none",
          }}
        >
          返回物资管理
        </a>
      </div>

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

      {/* 类别管理 */}
      <div style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
          类别管理
        </h2>

        {/* 新增类别表单 */}
        <div
          style={{
            background: "#f5f5f5",
            padding: 16,
            borderRadius: 8,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            alignItems: "end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              类别名称（如：书、玩具、家具）
            </label>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="输入类别名称"
              style={{
                width: "100%",
                padding: 8,
                border: "1px solid #ddd",
                borderRadius: 4,
              }}
            />
          </div>
          <button
            onClick={handleAddCategory}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              background: submitting ? "#ccc" : "#0366d6",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            + 添加类别
          </button>
        </div>

        {/* 类别列表 */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                  名称
                </th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>
                  状态
                </th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 20, textAlign: "center", color: "#666" }}>
                    暂无类别
                  </td>
                </tr>
              ) : (
                categories.map((cat) => (
                  <tr key={cat.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {cat.name}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          background: cat.is_active ? "#e6f9e6" : "#f0f0f0",
                          color: cat.is_active ? "#1a7a1a" : "#666",
                        }}
                      >
                        {cat.is_active ? "启用" : "停用"}
                      </span>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <button
                        onClick={() => handleToggleCategoryActive(cat.id, cat.is_active)}
                        style={{
                          padding: "4px 8px",
                          marginRight: 8,
                          fontSize: 12,
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          background: "white",
                          cursor: "pointer",
                        }}
                      >
                        {cat.is_active ? "停用" : "启用"}
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(cat.id, cat.name)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          border: "1px solid #c00",
                          borderRadius: 4,
                          background: "white",
                          color: "#c00",
                          cursor: "pointer",
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 位置管理 */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
          位置管理
        </h2>

        {/* 新增位置表单 */}
        <div
          style={{
            background: "#f5f5f5",
            padding: 16,
            borderRadius: 8,
            marginBottom: 14,
            display: "flex",
            gap: 10,
            alignItems: "end",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              位置名称（如：客厅、卧室、储物间）
            </label>
            <input
              type="text"
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              placeholder="输入位置名称"
              style={{
                width: "100%",
                padding: 8,
                border: "1px solid #ddd",
                borderRadius: 4,
              }}
            />
          </div>
          <button
            onClick={handleAddLocation}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              background: submitting ? "#ccc" : "#0366d6",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            + 添加位置
          </button>
        </div>

        {/* 位置列表 */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>
                  名称
                </th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>
                  状态
                </th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 20, textAlign: "center", color: "#666" }}>
                    暂无位置
                  </td>
                </tr>
              ) : (
                locations.map((loc) => (
                  <tr key={loc.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {loc.name}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          background: loc.is_active ? "#e6f9e6" : "#f0f0f0",
                          color: loc.is_active ? "#1a7a1a" : "#666",
                        }}
                      >
                        {loc.is_active ? "启用" : "停用"}
                      </span>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <button
                        onClick={() => handleToggleLocationActive(loc.id, loc.is_active)}
                        style={{
                          padding: "4px 8px",
                          marginRight: 8,
                          fontSize: 12,
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          background: "white",
                          cursor: "pointer",
                        }}
                      >
                        {loc.is_active ? "停用" : "启用"}
                      </button>
                      <button
                        onClick={() => handleDeleteLocation(loc.id, loc.name)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          border: "1px solid #c00",
                          borderRadius: 4,
                          background: "white",
                          color: "#c00",
                          cursor: "pointer",
                        }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

