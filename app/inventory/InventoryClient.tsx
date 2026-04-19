"use client";

import { useEffect, useState, useMemo } from "react";
import {
  InventoryItem,
  InventoryCategory,
  InventoryLocation,
  fetchInventoryItems,
  fetchAllMembers,
  fetchInventoryCategories,
  fetchInventoryLocations,
  batchGetSignedUrls,
  getMyProfile,
  statusLabel,
  STATUS_OPTIONS,
  getPrimaryCategories,
  getSubCategories,
  getCategoryDisplayText,
} from "../../lib/services/inventoryService";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../lib/services/userDisplay";

type MemberMap = Map<string, string>;

export default function InventoryClient() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [memberMap, setMemberMap] = useState<MemberMap>(new Map());
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());
  const [imageUrlMap, setImageUrlMap] = useState<Map<string, string>>(new Map());
  const [categoryOptions, setCategoryOptions] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [role, setRole] = useState("");

  // 筛选
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOwner, setFilterOwner] = useState("");

  const isAdmin = role === "admin";
  const canWrite = role === "admin" || role === "finance";

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setMsg("");
      try {
        const profile = await getMyProfile();
        setRole(profile.role);

        const [list, members, cats, locs] = await Promise.all([
          fetchInventoryItems(profile.orgId),
          fetchAllMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
        ]);

        setItems(list);
        setMemberMap(members);
        setCategoryOptions(cats);
        setLocationOptions(locs);

        // 批量生成缩略图 signed URL
        const paths = list.map((i) => i.image_path);
        const urlMap = await batchGetSignedUrls(paths);
        setImageUrlMap(urlMap);

        // 加载录入人/修改人显示名
        const auditIds = Array.from(
          new Set(
            list.flatMap((i) => [i.created_by, i.updated_by]).filter(Boolean) as string[]
          )
        );
        if (auditIds.length > 0) {
          const displayMap = await fetchUserDisplayMap(auditIds, profile.orgId);
          setUserDisplayMap(displayMap);
        }
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // 获取所属人列表（用于筛选下拉）
  const ownerOptions = useMemo(() => {
    const owners = new Map<string, string>();
    items.forEach((i) => {
      const name = memberMap.get(i.owner_id);
      if (name) owners.set(i.owner_id, name);
    });
    return Array.from(owners.entries()).map(([id, name]) => ({ value: id, label: name }));
  }, [items, memberMap]);

  // 过滤后的列表
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 搜索
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = item.name.toLowerCase().includes(q);
        const notesMatch = (item.notes ?? "").toLowerCase().includes(q);
        if (!nameMatch && !notesMatch) return false;
      }
      // 类别（筛选一级分类时，同时匹配该一级及其下属二级的物资）
      if (filterCategory) {
        if (item.category !== filterCategory && item.sub_category !== filterCategory) return false;
      }
      // 状态
      if (filterStatus && item.status !== filterStatus) return false;
      // 所属人
      if (filterOwner && item.owner_id !== filterOwner) return false;
      return true;
    });
  }, [items, search, filterCategory, filterStatus, filterOwner]);

  const fmtDate = (v: string) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      {/* 头部导航 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>物资管理</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canWrite && (
            <a href="/inventory/new" style={{ padding: "8px 12px", fontWeight: 700 }}>
              + 新增物资
            </a>
          )}
          {isAdmin && (
            <a href="/inventory/settings" style={{ padding: "8px 12px", fontWeight: 700, border: "1px solid #0366d6", color: "#0366d6", borderRadius: 6 }}>
              ⚙️ 类别/位置设置
            </a>
          )}
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回流水
          </a>
          <a href="/leaves" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            休假管理
          </a>
        </div>
      </div>

      {!!msg && <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 8 }}>{msg}</div>}

      {/* 搜索与筛选 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="搜索名称/备注…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, minWidth: 180 }}
        />

        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">全部类别</option>
          {getPrimaryCategories(categoryOptions).map((o) => (
            <option key={o.id} value={o.value}>
              {o.name}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={filterOwner}
          onChange={(e) => setFilterOwner(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">全部所属人</option>
          {ownerOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <span style={{ fontSize: 13, color: "#888" }}>
          共 {filteredItems.length} 项
        </span>
      </div>

      {/* 列表 */}
      {loading ? (
        <div style={{ padding: 20, color: "#666" }}>加载中…</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: 72 }}>图片</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>名称</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类别</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>所属人</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>数量</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>位置</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>状态</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>录入人</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>最近修改</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 20, color: "#666", textAlign: "center" }}>
                    暂无物资记录
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const imgUrl = item.image_path ? imageUrlMap.get(item.image_path) : null;
                  const ownerName = memberMap.get(item.owner_id) ?? "-";
                  const createdByName = resolveUserDisplay(item.created_by, userDisplayMap);
                  const updatedByName = item.updated_by ? resolveUserDisplay(item.updated_by, userDisplayMap) : null;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => {
                        window.location.href = `/inventory/${item.id}/edit`;
                      }}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "#f8f8f8";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "";
                      }}
                    >
                      {/* 缩略图 */}
                      <td style={{ padding: 6, borderBottom: "1px solid #f0f0f0" }}>
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={item.name}
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                              const next = e.currentTarget.nextElementSibling as HTMLElement;
                              if (next) next.style.display = "flex";
                            }}
                            style={{
                              width: 56,
                              height: 56,
                              objectFit: "cover",
                              borderRadius: 6,
                              background: "#f0f0f0",
                            }}
                          />
                        ) : null}
                        <div
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 6,
                            background: "#f0f0f0",
                            display: imgUrl ? "none" : "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 24,
                            color: "#ccc",
                          }}
                        >
                          📦
                        </div>
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontWeight: 600 }}>
                        {item.name}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                        {getCategoryDisplayText(categoryOptions, item.category, item.sub_category)}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        {ownerName}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {item.quantity}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        {item.location ? (locationOptions.find((l) => l.value === item.location)?.name ?? item.location) : "-"}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            background:
                              item.status === "in_use"
                                ? "#e6f9e6"
                                : item.status === "idle"
                                ? "#fff3cd"
                                : item.status === "lent_out"
                                ? "#d6eaff"
                                : item.status === "disposed"
                                ? "#f0f0f0"
                                : "#ffeedd",
                            color:
                              item.status === "in_use"
                                ? "#1a7a1a"
                                : item.status === "idle"
                                ? "#856404"
                                : item.status === "lent_out"
                                ? "#0366d6"
                                : item.status === "disposed"
                                ? "#666"
                                : "#c45500",
                          }}
                        >
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      {/* 录入人 */}
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#555" }}>
                        {createdByName}
                        <div style={{ color: "#aaa", fontSize: 11, marginTop: 1 }}>{fmtDate(item.created_at)}</div>
                      </td>
                      {/* 最近修改 */}
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#555" }}>
                        {updatedByName ? (
                          <>
                            {updatedByName}
                            <div style={{ color: "#aaa", fontSize: 11, marginTop: 1 }}>{fmtDate(item.updated_at)}</div>
                          </>
                        ) : (
                          <span style={{ color: "#ccc" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
