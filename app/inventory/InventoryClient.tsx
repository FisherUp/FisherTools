"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  InventoryItem,
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
  fetchInventoryItems,
  fetchAllMembers,
  fetchInventoryCategories,
  fetchInventoryLocations,
  fetchInventoryUnits,
  batchGetSignedUrls,
  deleteInventoryItem,
  getMyProfile,
  statusLabel,
  STATUS_OPTIONS,
  getPrimaryCategories,
  getSubCategories,
  getCategoryDisplayText,
  fmtYuan,
  logItemChanges,
} from "../../lib/services/inventoryService";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../lib/services/userDisplay";
import { supabase } from "../../lib/supabaseClient";
import LearnModal from "./LearnModal";

type MemberMap = Map<string, string>;
const PAGE_SIZE = 20;

export default function InventoryClient() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [memberMap, setMemberMap] = useState<MemberMap>(new Map());
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());
  const [imageUrlMap, setImageUrlMap] = useState<Map<string, string>>(new Map());
  const [categoryOptions, setCategoryOptions] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);
  const [unitOptions, setUnitOptions] = useState<InventoryUnit[]>([]);
  const [orgId, setOrgId] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [role, setRole] = useState("");

  // 学习模式
  const [learnItem, setLearnItem] = useState<InventoryItem | null>(null);
  const [learnAge, setLearnAge] = useState(7);

  // 筛选
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSubCategory, setFilterSubCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOwner, setFilterOwner] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [filterMinPrice, setFilterMinPrice] = useState("");
  const [filterMaxPrice, setFilterMaxPrice] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const isAdmin = role === "admin";
  const isInventoryEditOnly = role === "inventory-edit" || role === "learner";
  const canWrite = role === "admin" || role === "finance" || role === "inventory-edit" || role === "learner";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setMsg("");
      try {
        const profile = await getMyProfile();
        setRole(profile.role);
        setOrgId(profile.orgId);

        const [list, members, cats, locs, units] = await Promise.all([
          fetchInventoryItems(profile.orgId),
          fetchAllMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
          fetchInventoryUnits(profile.orgId),
        ]);

        setItems(list);
        setMemberMap(members);
        setCategoryOptions(cats);
        setLocationOptions(locs);
        setUnitOptions(units);

        // 先渲染列表，再并行加载缩略图 URL 和审计显示名
        const paths = list.map((i) => i.image_path);
        const auditIds = Array.from(
          new Set(
            list.flatMap((i) => [i.created_by, i.updated_by]).filter(Boolean) as string[]
          )
        );

        const [urlMap, displayMap] = await Promise.all([
          batchGetSignedUrls(paths),
          auditIds.length > 0
            ? fetchUserDisplayMap(auditIds, profile.orgId)
            : Promise.resolve(new Map<string, string>()),
        ]);
        setImageUrlMap(urlMap);
        setUserDisplayMap(displayMap);
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handlePrimaryChange = (val: string) => {
    setFilterCategory(val);
    setFilterSubCategory("");
    setCurrentPage(1);
  };

  // 学习年龄持久化
  useEffect(() => {
    const saved = localStorage.getItem("inventory_learn_age");
    if (saved) { const p = parseInt(saved); if (p >= 3 && p <= 18) setLearnAge(p); }
  }, []);
  useEffect(() => { localStorage.setItem("inventory_learn_age", String(learnAge)); }, [learnAge]);

  // 筛选变化时重置分页
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setCurrentPage(1); }, [search, filterCategory, filterSubCategory, filterStatus, filterOwner, filterLocation, filterMinPrice, filterMaxPrice]);

  // 二级分类筛选选项（依赖于已选一级分类）
  const filterSubCategoryOptions = useMemo(() => {
    if (!filterCategory) return [];
    const primCat = getPrimaryCategories(categoryOptions).find((c) => c.value === filterCategory);
    if (!primCat) return [];
    return getSubCategories(categoryOptions, primCat.id);
  }, [filterCategory, categoryOptions]);

  // 获取所属人列表（用于筛选下拉）
  const ownerOptions = useMemo(() => {
    const owners = new Map<string, string>();
    items.forEach((i) => { const n = memberMap.get(i.owner_id); if (n) owners.set(i.owner_id, n); });
    return Array.from(owners.entries()).map(([id, name]) => ({ value: id, label: name }));
  }, [items, memberMap]);

  // 过滤后的列表
  const filteredItems = useMemo(() => {
    const minFen = filterMinPrice ? Math.round(parseFloat(filterMinPrice) * 100) : null;
    const maxFen = filterMaxPrice ? Math.round(parseFloat(filterMaxPrice) * 100) : null;
    return items.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !(item.notes ?? "").toLowerCase().includes(q)) return false;
      }
      if (filterCategory && item.category !== filterCategory) return false;
      if (filterSubCategory && item.sub_category !== filterSubCategory) return false;
      if (filterStatus && item.status !== filterStatus) return false;
      if (filterOwner && item.owner_id !== filterOwner) return false;
      if (filterLocation && item.location !== filterLocation) return false;
      if (minFen !== null || maxFen !== null) {
        if (item.unit_price == null) return false;
        const totalFen = item.unit_price * item.quantity;
        if (minFen !== null && totalFen < minFen) return false;
        if (maxFen !== null && totalFen > maxFen) return false;
      }
      return true;
    });
  }, [items, search, filterCategory, filterSubCategory, filterStatus, filterOwner, filterLocation, filterMinPrice, filterMaxPrice]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pagedItems = useMemo(
    () => filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredItems, currentPage]
  );
  const totalValueAll = useMemo(() => items.reduce((s, i) => s + (i.unit_price ?? 0) * i.quantity, 0), [items]);
  const totalValueFiltered = useMemo(() => filteredItems.reduce((s, i) => s + (i.unit_price ?? 0) * i.quantity, 0), [filteredItems]);
  const itemsMissingPrice = useMemo(() => items.filter((i) => i.unit_price == null).length, [items]);

  const handleDelete = useCallback(async (item: InventoryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;
    if (!confirm(`确定要永久删除物资「${item.name}」吗？\n（如果只是不再使用，建议将状态改为"已处理"）`)) return;
    try {
      await deleteInventoryItem(item.id);
      await logItemChanges(orgId, item.id, "delete", []);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setMsg(`✅ 已删除「${item.name}」`);
    } catch (e2: any) {
      setMsg("删除失败：" + (e2?.message ?? e2));
    }
  }, [isAdmin, orgId]);

  const handleDownloadCSV = useCallback(() => {
    const headers = ["序号", "名称", "一级分类", "二级分类", "所属人",
      "数量", "单位", "单价(元)", "总价值(元)", "位置",
      "状态", "录入人", "录入时间", "最近修改人", "最近修改时间", "备注"];
    const primaryCats = getPrimaryCategories(categoryOptions);
    const rows = filteredItems.map((item, idx) => {
      const priCat = primaryCats.find((c) => c.value === item.category);
      const priName = priCat?.name ?? item.category ?? "";
      const subName = priCat
        ? (getSubCategories(categoryOptions, priCat.id).find((c) => c.value === item.sub_category)?.name ?? item.sub_category ?? "")
        : (item.sub_category ?? "");
      const totalYuan = item.unit_price != null ? (item.unit_price * item.quantity / 100).toFixed(2) : "";
      return [
        idx + 1, item.name, priName, subName,
        memberMap.get(item.owner_id) ?? "",
        item.quantity, item.unit ?? "",
        item.unit_price != null ? (item.unit_price / 100).toFixed(2) : "",
        totalYuan,
        locationOptions.find((l) => l.value === item.location)?.name ?? item.location ?? "",
        statusLabel(item.status),
        resolveUserDisplay(item.created_by, userDisplayMap),
        fmtDate(item.created_at ?? ""),
        item.updated_by ? resolveUserDisplay(item.updated_by, userDisplayMap) : "",
        item.updated_at ? fmtDate(item.updated_at) : "",
        item.notes ?? "",
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `物资清单_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredItems, categoryOptions, memberMap, locationOptions, userDisplayMap]);

  const fmtDate = (v: string) => {
    if (!v) return "-";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "-";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div style={{ maxWidth: 1280, margin: "40px auto", padding: 16 }}>
      {/* 头部导航 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>物资管理</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {canWrite && (
            <a href="/inventory/new"
              style={{ padding: "8px 12px", background: "#1a73e8", color: "#fff", borderRadius: 6, fontWeight: 700, textDecoration: "none" }}>
              + 新增物资
            </a>
          )}
          <button onClick={handleDownloadCSV}
            style={{ padding: "8px 12px", border: "1px solid #1a73e8", color: "#1a73e8", borderRadius: 6, background: "#fff", cursor: "pointer", fontWeight: 600 }}>
            ⬇ 导出 CSV
          </button>
          {isAdmin && (
            <>
              <a href="/inventory/settings"
                style={{ padding: "8px 12px", border: "1px solid #0366d6", color: "#0366d6", borderRadius: 6, textDecoration: "none" }}>
                ⚙️ 类别/位置设置
              </a>
              <a href="/profiles"
                style={{ padding: "8px 12px", border: "1px solid #6f42c1", color: "#6f42c1", borderRadius: 6, textDecoration: "none" }}>
                👤 用户权限
              </a>
            </>
          )}
          {!isInventoryEditOnly && (
            <>
              <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none" }}>
                ← 返回流水
              </a>
              <a href="/leaves" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, textDecoration: "none" }}>
                休假管理
              </a>
            </>
          )}
          {isInventoryEditOnly && (
            <button onClick={handleSignOut}
              style={{ padding: "8px 14px", border: "1px solid #d0372e", borderRadius: 6, background: "#fff", color: "#d0372e", cursor: "pointer", fontWeight: 600 }}>
              退出登录
            </button>
          )}
        </div>
      </div>

      {!!msg && (
        <div style={{ marginBottom: 12, padding: 10, background: msg.startsWith("✅") ? "#d4edda" : "#fff3cd", borderRadius: 8, color: msg.startsWith("✅") ? "#155724" : "#856404" }}>
          {msg}
        </div>
      )}

      {/* 数据完整性提示 */}
      {!loading && itemsMissingPrice > 0 && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 6, fontSize: 13, color: "#795548" }}>
          💡 有 <strong>{itemsMissingPrice}</strong> 件物资尚未填写单价，建议补充以便统计总价值。
        </div>
      )}

      {/* 价值汇总卡片 */}
      {!loading && items.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, background: "#f3f8ff", border: "1px solid #cce0ff", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>全部物资总价值</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1a73e8" }}>
              {totalValueAll > 0
                ? `¥${(totalValueAll / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>共 {items.length} 件物资</div>
          </div>
          {(filteredItems.length !== items.length || totalValueFiltered !== totalValueAll) && (
            <div style={{ flex: 1, minWidth: 180, background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>筛选结果总价值</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#333" }}>
                {totalValueFiltered > 0
                  ? `¥${(totalValueFiltered / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>共 {filteredItems.length} 件</div>
            </div>
          )}
        </div>
      )}

      {/* 搜索与筛选 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text" placeholder="搜索名称/备注…" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, minWidth: 180 }}
        />
        <select value={filterCategory} onChange={(e) => handlePrimaryChange(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="">全部一级分类</option>
          {getPrimaryCategories(categoryOptions).map((o) => (
            <option key={o.id} value={o.value}>{o.name}</option>
          ))}
        </select>
        {filterCategory && filterSubCategoryOptions.length > 0 && (
          <select value={filterSubCategory} onChange={(e) => { setFilterSubCategory(e.target.value); setCurrentPage(1); }}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
            <option value="">全部二级分类</option>
            {filterSubCategoryOptions.map((o) => (
              <option key={o.id} value={o.value}>{o.name}</option>
            ))}
          </select>
        )}
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setCurrentPage(1); }}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterOwner} onChange={(e) => { setFilterOwner(e.target.value); setCurrentPage(1); }}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="">全部所属人</option>
          {ownerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterLocation} onChange={(e) => { setFilterLocation(e.target.value); setCurrentPage(1); }}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}>
          <option value="">全部位置</option>
          {locationOptions.filter((l) => l.is_active).map((o) => (
            <option key={o.id} value={o.value}>{o.name}</option>
          ))}
        </select>
      </div>

      {/* 总价值范围筛选 + 学习年龄 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {/* 学习年龄设置 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#f0f7ff", border: "1px solid #cce0ff", borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: "#1a73e8", fontWeight: 600 }}>📚 学习年龄</span>
          <input
            type="number" min={3} max={18} value={learnAge}
            onChange={(e) => { const v = parseInt(e.target.value); if (v >= 3 && v <= 18) setLearnAge(v); }}
            style={{ width: 44, padding: "2px 6px", border: "1px solid #cce0ff", borderRadius: 4, fontSize: 13, textAlign: "center", background: "#fff" }}
          />
          <span style={{ fontSize: 12, color: "#555" }}>岁</span>
        </div>
        <div style={{ width: 1, height: 20, background: "#e0e0e0", margin: "0 2px" }} />
        <span style={{ fontSize: 13, color: "#666" }}>总价值范围：</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 13 }}>¥</span>
          <input type="number" min={0} step={0.01} value={filterMinPrice}
            onChange={(e) => { setFilterMinPrice(e.target.value); setCurrentPage(1); }}
            placeholder="最低" style={{ width: 90, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
        </div>
        <span style={{ color: "#aaa" }}>—</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 13 }}>¥</span>
          <input type="number" min={0} step={0.01} value={filterMaxPrice}
            onChange={(e) => { setFilterMaxPrice(e.target.value); setCurrentPage(1); }}
            placeholder="最高" style={{ width: 90, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
        </div>
        {(filterMinPrice || filterMaxPrice) && (
          <button type="button" onClick={() => { setFilterMinPrice(""); setFilterMaxPrice(""); }}
            style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12, color: "#666" }}>
            × 清除价格筛选
          </button>
        )}
        <span style={{ fontSize: 13, color: "#888", marginLeft: "auto" }}>
          筛选结果：<strong>{filteredItems.length}</strong> 件 / 全部 {items.length} 件
        </span>
      </div>

      {/* 列表 */}
      {loading ? (
        <div style={{ padding: 20, color: "#666" }}>加载中…</div>
      ) : (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", width: 46, textAlign: "center", color: "#888", fontSize: 12 }}>#</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", width: 72 }}>图片</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>名称</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>类别</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>所属人</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "center" }}>数量</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "center" }}>单位</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "right" }}>单价</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "right" }}>总价值</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>位置</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>状态</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>录入人</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", textAlign: "left" }}>最近修改</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #eee", width: 80, textAlign: "center" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.length === 0 ? (
                  <tr>
                    <td colSpan={14} style={{ padding: 24, color: "#666", textAlign: "center" }}>
                      暂无物资记录
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((item, pageIdx) => {
                    const rowNum = (currentPage - 1) * PAGE_SIZE + pageIdx + 1;
                    const imgUrl = item.image_path ? imageUrlMap.get(item.image_path) : null;
                    const ownerName = memberMap.get(item.owner_id) ?? "-";
                    const createdByName = resolveUserDisplay(item.created_by, userDisplayMap);
                    const updatedByName = item.updated_by ? resolveUserDisplay(item.updated_by, userDisplayMap) : null;
                    const locName = item.location
                      ? (locationOptions.find((l) => l.value === item.location)?.name ?? item.location)
                      : "—";
                    const totalVal = item.unit_price != null ? item.unit_price * item.quantity : null;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => { window.location.href = `/inventory/${item.id}/edit`; }}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f8f8f8"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                      >
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#aaa", fontSize: 12 }}>
                          {rowNum}
                        </td>
                        <td style={{ padding: 6, borderBottom: "1px solid #f0f0f0" }}>
                          {imgUrl ? (
                            <img src={imgUrl} alt={item.name} loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                                const next = e.currentTarget.nextElementSibling as HTMLElement;
                                if (next) next.style.display = "flex";
                              }}
                              style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, background: "#f0f0f0" }}
                            />
                          ) : null}
                          <div style={{
                            width: 56, height: 56, borderRadius: 6, background: "#f0f0f0",
                            display: imgUrl ? "none" : "flex",
                            alignItems: "center", justifyContent: "center", fontSize: 24, color: "#ccc",
                          }}>📦</div>
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", fontWeight: 600 }}>
                          {item.name}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          {getCategoryDisplayText(categoryOptions, item.category, item.sub_category)}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0" }}>
                          {ownerName}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                          {item.quantity}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center", fontSize: 13, color: "#555" }}>
                          {item.unit ?? <span style={{ color: "#ccc" }}>—</span>}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontSize: 13 }}>
                          {item.unit_price != null ? fmtYuan(item.unit_price) : <span style={{ color: "#ccc" }}>—</span>}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: totalVal ? 600 : 400, fontSize: 13 }}>
                          {totalVal != null ? fmtYuan(totalVal) : <span style={{ color: "#ccc" }}>—</span>}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                          {locName}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0" }}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600,
                            background: item.status === "in_use" ? "#e6f9e6" : item.status === "idle" ? "#fff3cd"
                              : item.status === "lent_out" ? "#d6eaff" : item.status === "disposed" ? "#f0f0f0" : "#ffeedd",
                            color: item.status === "in_use" ? "#1a7a1a" : item.status === "idle" ? "#856404"
                              : item.status === "lent_out" ? "#0366d6" : item.status === "disposed" ? "#666" : "#c45500",
                          }}>
                            {statusLabel(item.status)}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#555" }}>
                          {createdByName}
                          <div style={{ color: "#aaa", fontSize: 11, marginTop: 1 }}>{fmtDate(item.created_at ?? "")}</div>
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#555" }}>
                          {updatedByName ? (
                            <>
                              {updatedByName}
                              <div style={{ color: "#aaa", fontSize: 11, marginTop: 1 }}>{fmtDate(item.updated_at ?? "")}</div>
                            </>
                          ) : <span style={{ color: "#ccc" }}>—</span>}
                        </td>
                        <td style={{ padding: "6px 10px", borderBottom: "1px solid #f0f0f0", textAlign: "center" }}
                          onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setLearnItem(item)}
                            title={`学习「${item.name}」`}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}
                          >
                            📚
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => handleDelete(item, e)}
                              title={`删除「${item.name}」`}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#c00", fontSize: 16, padding: "2px 4px", marginLeft: 2 }}
                            >
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 14 }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: "6px 14px", border: "1px solid #ddd", borderRadius: 6, background: currentPage <= 1 ? "#f5f5f5" : "#fff", cursor: currentPage <= 1 ? "not-allowed" : "pointer" }}
              >
                ‹ 上一页
              </button>
              <span style={{ fontSize: 13, color: "#555" }}>
                第 {currentPage} / {totalPages} 页 &nbsp;·&nbsp; 每页 {PAGE_SIZE} 条
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: "6px 14px", border: "1px solid #ddd", borderRadius: 6, background: currentPage >= totalPages ? "#f5f5f5" : "#fff", cursor: currentPage >= totalPages ? "not-allowed" : "pointer" }}
              >
                下一页 ›
              </button>
            </div>
          )}
        </>
      )}
      
      {/* 学习模态框 */}
      {learnItem && (
        <LearnModal
          item={learnItem}
          age={learnAge}
          onClose={() => setLearnItem(null)}
          onAgeChange={(a) => setLearnAge(a)}
        />
      )}
    </div>
  );
}
