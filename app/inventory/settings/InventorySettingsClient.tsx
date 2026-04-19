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
  getPrimaryCategories,
  getSubCategories,
} from "@/lib/services/inventoryService";

export default function InventorySettingsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  // 新增表单
  const [newPrimaryCategoryName, setNewPrimaryCategoryName] = useState("");
  const [newSubCategoryName, setNewSubCategoryName] = useState("");
  const [newSubParentId, setNewSubParentId] = useState("");
  const [newLocationName, setNewLocationName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [expandedPrimary, setExpandedPrimary] = useState<Set<string>>(new Set());

  const isAdmin = role === "admin";
  const primaryCats = getPrimaryCategories(categories);

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

  const toggleExpand = (id: string) => {
    setExpandedPrimary((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 新增一级分类
  async function handleAddPrimaryCategory() {
    if (!newPrimaryCategoryName.trim()) {
      setError("请填写一级分类名称");
      return;
    }
    try {
      setSubmitting(true);
      setError("");
      await createInventoryCategory(orgId, newPrimaryCategoryName.trim(), 0, null);
      setNewPrimaryCategoryName("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "添加一级分类失败");
    } finally {
      setSubmitting(false);
    }
  }

  // 新增二级分类
  async function handleAddSubCategory() {
    if (!newSubParentId) {
      setError("请选择所属一级分类");
      return;
    }
    if (!newSubCategoryName.trim()) {
      setError("请填写二级分类名称");
      return;
    }
    try {
      setSubmitting(true);
      setError("");
      await createInventoryCategory(orgId, newSubCategoryName.trim(), 0, newSubParentId);
      setNewSubCategoryName("");
      // 自动展开该一级分类
      setExpandedPrimary((prev) => new Set(prev).add(newSubParentId));
      await loadData();
    } catch (err: any) {
      setError(err.message || "添加二级分类失败");
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

  async function handleDeleteCategory(id: string, name: string, hasChildren: boolean) {
    if (hasChildren) {
      setError(`无法删除「${name}」：请先删除其下所有二级分类`);
      return;
    }
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>物资类别和位置管理</h1>
        <a href="/inventory" style={{ padding: "8px 12px", border: "1px solid #0366d6", color: "#0366d6", borderRadius: 4, textDecoration: "none" }}>
          返回物资管理
        </a>
      </div>

      {error && (
        <div style={{ padding: 10, background: "#ffe6e6", color: "#c00", borderRadius: 8, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {/* ── 一级分类管理 ── */}
      <div style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>一级分类</h2>

        <div style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, marginBottom: 14, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>一级分类名称</label>
            <input
              type="text"
              value={newPrimaryCategoryName}
              onChange={(e) => setNewPrimaryCategoryName(e.target.value)}
              placeholder="如：家具与空间"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>
          <button
            onClick={handleAddPrimaryCategory}
            disabled={submitting}
            style={{ padding: "8px 16px", background: submitting ? "#ccc" : "#0366d6", color: "white", border: "none", borderRadius: 4, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            + 添加一级分类
          </button>
        </div>

        {/* 一级分类列表 + 嵌套二级 */}
        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
          {primaryCats.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "#666" }}>暂无一级分类</div>
          ) : (
            primaryCats.map((cat) => {
              const subs = getSubCategories(categories, cat.id);
              const isExpanded = expandedPrimary.has(cat.id);

              return (
                <div key={cat.id}>
                  {/* 一级分类行 */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      borderBottom: "1px solid #f0f0f0",
                      background: "#fafafa",
                      cursor: "pointer",
                    }}
                    onClick={() => toggleExpand(cat.id)}
                  >
                    <span style={{ fontSize: 12, width: 16 }}>{isExpanded ? "▼" : "▶"}</span>
                    <strong style={{ flex: 1 }}>
                      {cat.name}
                      <span style={{ fontWeight: 400, color: "#888", fontSize: 12, marginLeft: 6 }}>
                        ({subs.length} 个二级分类)
                      </span>
                    </strong>
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
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleCategoryActive(cat.id, cat.is_active); }}
                      style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #ddd", borderRadius: 4, background: "white", cursor: "pointer" }}
                    >
                      {cat.is_active ? "停用" : "启用"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name, subs.length > 0); }}
                      style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #c00", borderRadius: 4, background: "white", color: "#c00", cursor: "pointer" }}
                    >
                      删除
                    </button>
                  </div>

                  {/* 二级分类列表 */}
                  {isExpanded && (
                    <div style={{ paddingLeft: 28, background: "#fff" }}>
                      {subs.length === 0 ? (
                        <div style={{ padding: "8px 12px", color: "#999", fontSize: 13 }}>暂无二级分类</div>
                      ) : (
                        subs.map((sub) => (
                          <div
                            key={sub.id}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid #f8f8f8" }}
                          >
                            <span style={{ flex: 1 }}>↳ {sub.name}</span>
                            <span
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 600,
                                background: sub.is_active ? "#e6f9e6" : "#f0f0f0",
                                color: sub.is_active ? "#1a7a1a" : "#666",
                              }}
                            >
                              {sub.is_active ? "启用" : "停用"}
                            </span>
                            <button
                              onClick={() => handleToggleCategoryActive(sub.id, sub.is_active)}
                              style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #ddd", borderRadius: 4, background: "white", cursor: "pointer" }}
                            >
                              {sub.is_active ? "停用" : "启用"}
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(sub.id, sub.name, false)}
                              style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #c00", borderRadius: 4, background: "white", color: "#c00", cursor: "pointer" }}
                            >
                              删除
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── 二级分类快速添加 ── */}
      <div style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>添加二级分类</h2>

        <div style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: "0 0 220px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>所属一级分类</label>
            <select
              value={newSubParentId}
              onChange={(e) => setNewSubParentId(e.target.value)}
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
            >
              <option value="">选择一级分类</option>
              {primaryCats.filter((c) => c.is_active).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>二级分类名称</label>
            <input
              type="text"
              value={newSubCategoryName}
              onChange={(e) => setNewSubCategoryName(e.target.value)}
              placeholder="如：桌子、椅子与坐具"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>
          <button
            onClick={handleAddSubCategory}
            disabled={submitting}
            style={{ padding: "8px 16px", background: submitting ? "#ccc" : "#198754", color: "white", border: "none", borderRadius: 4, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            + 添加二级分类
          </button>
        </div>
      </div>

      {/* ── 位置管理 ── */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>位置管理</h2>

        <div style={{ background: "#f5f5f5", padding: 16, borderRadius: 8, marginBottom: 14, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px" }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>位置名称（如：客厅、卧室、储物间）</label>
            <input
              type="text"
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              placeholder="输入位置名称"
              style={{ width: "100%", padding: 8, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>
          <button
            onClick={handleAddLocation}
            disabled={submitting}
            style={{ padding: "8px 16px", background: submitting ? "#ccc" : "#0366d6", color: "white", border: "none", borderRadius: 4, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer" }}
          >
            + 添加位置
          </button>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>名称</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>状态</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {locations.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 20, textAlign: "center", color: "#666" }}>暂无位置</td>
                </tr>
              ) : (
                locations.map((loc) => (
                  <tr key={loc.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{loc.name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, background: loc.is_active ? "#e6f9e6" : "#f0f0f0", color: loc.is_active ? "#1a7a1a" : "#666" }}>
                        {loc.is_active ? "启用" : "停用"}
                      </span>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <button
                        onClick={() => handleToggleLocationActive(loc.id, loc.is_active)}
                        style={{ padding: "4px 8px", marginRight: 8, fontSize: 12, border: "1px solid #ddd", borderRadius: 4, background: "white", cursor: "pointer" }}
                      >
                        {loc.is_active ? "停用" : "启用"}
                      </button>
                      <button
                        onClick={() => handleDeleteLocation(loc.id, loc.name)}
                        style={{ padding: "4px 8px", fontSize: 12, border: "1px solid #c00", borderRadius: 4, background: "white", color: "#c00", cursor: "pointer" }}
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
