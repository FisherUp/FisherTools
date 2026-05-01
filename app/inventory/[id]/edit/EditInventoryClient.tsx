"use client";

import { useEffect, useState } from "react";
import {
  InventoryItem,
  InventoryCategory,
  InventoryLocation,
  getMyProfile,
  fetchInventoryItem,
  fetchInventoryItemIdList,
  updateInventoryItem,
  deleteInventoryItem,
  uploadInventoryImage,
  deleteInventoryImage,
  getSignedUrl,
  fetchMembers,
  fetchAllMembers,
  fetchInventoryCategories,
  fetchInventoryLocations,
  fetchInventoryUnits,
  createInventoryUnit,
  InventoryUnit,
  STATUS_OPTIONS,
  MAX_FILE_SIZE,
  getPrimaryCategories,
  getSubCategories,
  logItemChanges,
  diffItemFields,
} from "../../../../lib/services/inventoryService";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../../../lib/services/userDisplay";

type Member = { id: string; name: string };

export default function EditInventoryClient({ id }: { id: string }) {
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [allMemberMap, setAllMemberMap] = useState<Map<string, string>>(new Map());
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());
  const [allCategories, setAllCategories] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);
  const [unitOptions, setUnitOptions] = useState<InventoryUnit[]>([]);

  // 原始数据（用于变更对比）
  const [originalItem, setOriginalItem] = useState<InventoryItem | null>(null);

  // 表单字段
  const [name, setName] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("in_use");
  const [notes, setNotes] = useState("");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitPriceDisplay, setUnitPriceDisplay] = useState(""); // 显示用（元）
  const [newUnitName, setNewUnitName] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);

  // 图片
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageSignedUrl, setImageSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // 图片旋转（前端预览角度，0/90/180/270）
  const [previewRotation, setPreviewRotation] = useState(0);
  const [savingRotation, setSavingRotation] = useState(false);

  // 上下一项导航
  const [itemIdList, setItemIdList] = useState<{ id: string; name: string }[]>([]);

  // 审计字段
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [imgMsg, setImgMsg] = useState("");

  const canWrite = role === "admin" || role === "finance" || role === "inventory-edit" || role === "learner";
  const isAdmin = role === "admin";

  // 一级/二级分类
  const primaryCategories = getPrimaryCategories(allCategories);
  const selectedPrimary = primaryCategories.find((c) => c.value === primaryCategory);
  const subCategories = selectedPrimary ? getSubCategories(allCategories, selectedPrimary.id) : [];

  const handlePrimaryCategoryChange = (val: string) => {
    setPrimaryCategory(val);
    setSubCategory("");
  };

  const fmtDateTimeMaybe = (v: string | null) => {
    if (!v) return "-";
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return "-";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}`;
  };

  // 加载图片 signed URL
  const loadImageUrl = async (path: string | null) => {
    if (!path) {
      setImageSignedUrl(null);
      return;
    }
    const url = await getSignedUrl(path);
    setImageSignedUrl(url);
  };

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setMsg("");
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setRole(profile.role);

        const [item, memberList, memberMap, cats, locs, units, idList] = await Promise.all([
          fetchInventoryItem(id),
          fetchMembers(profile.orgId),
          fetchAllMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
          fetchInventoryUnits(profile.orgId),
          fetchInventoryItemIdList(profile.orgId),
        ]);

        setMembers(memberList);
        setAllMemberMap(memberMap);
        setAllCategories(cats);
        setLocationOptions(locs);
        setUnitOptions(units);
        setItemIdList(idList);

        // 如果当前 owner_id 不在活跃成员中，也加进下拉
        if (item.owner_id && !memberList.some((m) => m.id === item.owner_id)) {
          const ownerName = memberMap.get(item.owner_id) ?? item.owner_id;
          setMembers([...memberList, { id: item.owner_id, name: ownerName + "（已停用）" }]);
        }

        // 填充表单
        setName(item.name);
        setPrimaryCategory(item.category ?? "");
        setSubCategory(item.sub_category ?? "");
        setOwnerId(item.owner_id);
        setQuantity(String(item.quantity));
        setLocation(item.location ?? "");
        setStatus(item.status);
        setNotes(item.notes ?? "");
        setUnit(item.unit ?? "");
        setUnitPrice(item.unit_price ? String(item.unit_price) : "");
        setUnitPriceDisplay(item.unit_price ? (item.unit_price / 100).toFixed(2) : "");
        setImagePath(item.image_path);
        setCreatedBy(item.created_by);
        setUpdatedBy(item.updated_by);
        setCreatedAt(item.created_at);
        setUpdatedAt(item.updated_at);
        setPreviewRotation(0);

        // 保存原始数据用于变更对比
        setOriginalItem(item);

        // 并行加载用户显示名和图片（不阻塞主流程）
        const auditIds = [item.created_by, item.updated_by].filter(Boolean) as string[];
        await Promise.all([
          auditIds.length > 0
            ? fetchUserDisplayMap(auditIds, profile.orgId).then(setUserDisplayMap)
            : Promise.resolve(),
          loadImageUrl(item.image_path),
        ]);
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [id]);

  // 保存
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!canWrite) return setMsg("权限不足。");
    if (!name.trim()) return setMsg("请输入物资名称");
    if (!ownerId) return setMsg("请选择所属人");

    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) return setMsg("数量必须 ≥ 1");

    setLoading(true);
    try {
      const newData = {
        name: name.trim(),
        category: primaryCategory || null,
        sub_category: subCategory || null,
        owner_id: ownerId,
        quantity: qty,
        location: location || null,
        status,
        notes: notes.trim() || null,
        unit: unit || null,
        unit_price: unitPrice ? parseInt(unitPrice) : null,
      };

      await updateInventoryItem(id, newData);

      // 记录变更日志
      if (originalItem && orgId) {
        const changes = diffItemFields(
          originalItem,
          { ...newData, quantity: qty },
          ["name", "category", "sub_category", "owner_id", "quantity", "location", "status", "notes", "unit", "unit_price"]
        );
        if (changes.length > 0) {
          await logItemChanges(orgId, id, "update", changes);
        }
      }

      setMsg("✅ 保存成功");
      // 更新 originalItem 为当前值
      setOriginalItem({ ...originalItem!, ...newData, quantity: qty });
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  // 上传/替换图片
  const handleUploadImage = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];

    if (file.size > MAX_FILE_SIZE) {
      setImgMsg(`文件 ${file.name} 超过 10MB，请压缩后再上传`);
      return;
    }

    setUploading(true);
    setImgMsg("");
    try {
      // 如果已有图片，先删除旧的
      if (imagePath) {
        try {
          await deleteInventoryImage(imagePath);
        } catch {
          // 旧图删除失败不阻塞新图上传
        }
      }

      const newPath = await uploadInventoryImage(orgId, id, file);
      await updateInventoryItem(id, { image_path: newPath });
      setImagePath(newPath);
      await loadImageUrl(newPath);
      setImgMsg("✅ 图片已更新");
    } catch (e: any) {
      setImgMsg(String(e?.message ?? e));
    } finally {
      setUploading(false);
    }
  };

  // 新增单位
  const handleAddUnit = async () => {
    const n = newUnitName.trim();
    if (!n || !orgId) return;
    setAddingUnit(true);
    try {
      await createInventoryUnit(orgId, n);
      const updated = await fetchInventoryUnits(orgId);
      setUnitOptions(updated);
      setUnit(n);
      setNewUnitName("");
    } catch (e: any) {
      setMsg("新增单位失败：" + (e?.message ?? e));
    } finally {
      setAddingUnit(false);
    }
  };

  // 删除图片
  const handleDeleteImage = async () => {
    if (!imagePath) return;
    if (!confirm("确定要删除此图片吗？")) return;

    setImgMsg("");
    try {
      await deleteInventoryImage(imagePath);
      await updateInventoryItem(id, { image_path: null });
      setImagePath(null);
      setImageSignedUrl(null);
      setImgMsg("✅ 图片已删除");
    } catch (e: any) {
      setImgMsg(String(e?.message ?? e));
    }
  };

  // 删除物资
  // 保存图片旋转：用 canvas 实际旋转后重新上传
  const handleSaveRotation = async () => {
    if (!imageSignedUrl || !imagePath || previewRotation === 0) return;
    setSavingRotation(true);
    setImgMsg("");
    try {
      // 通过 fetch 拿到 blob，绕开 canvas CORS 限制
      const resp = await fetch(imageSignedUrl);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);

      const img = new Image();
      img.src = blobUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
      });
      URL.revokeObjectURL(blobUrl);

      const deg = previewRotation;
      const isOrtho = deg === 90 || deg === 270;
      const canvas = document.createElement("canvas");
      canvas.width = isOrtho ? img.height : img.width;
      canvas.height = isOrtho ? img.width : img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      const rotatedBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("图片导出失败"))), "image/jpeg", 0.9)
      );
      const rotatedFile = new File([rotatedBlob], "rotated.jpg", { type: "image/jpeg" });

      // 删旧图，上传新图
      await deleteInventoryImage(imagePath);
      const newPath = await uploadInventoryImage(orgId, id, rotatedFile);
      await updateInventoryItem(id, { image_path: newPath });
      setImagePath(newPath);
      await loadImageUrl(newPath);
      setPreviewRotation(0);
      setImgMsg("✅ 图片方向已保存");
    } catch (e: any) {
      setImgMsg("旋转保存失败：" + (e?.message ?? e));
    } finally {
      setSavingRotation(false);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin) return setMsg("仅管理员可删除物资。");

    const confirmText = `确定要永久删除物资「${name}」吗？\n（如果只是不再使用，建议将状态改为"已处理"）`;
    if (!confirm(confirmText)) return;

    setLoading(true);
    try {
      // 先删图片
      if (imagePath) {
        try {
          await deleteInventoryImage(imagePath);
        } catch {
          // 继续删除记录
        }
      }
      await deleteInventoryItem(id);
      setMsg("✅ 已删除物资");
      setTimeout(() => {
        window.location.href = "/inventory";
      }, 600);
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  // 上下一项导航计算
  const currentIndex = itemIdList.findIndex((it) => it.id === id);
  const prevItem = currentIndex > 0 ? itemIdList[currentIndex - 1] : null;
  const nextItem = currentIndex < itemIdList.length - 1 ? itemIdList[currentIndex + 1] : null;

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>编辑物资</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/inventory" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回列表
          </a>
          <a href="/inventory/new" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            + 新增
          </a>
          {isAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              style={{ padding: "8px 12px", border: "1px solid #c00", color: "#c00", borderRadius: 6, background: "#fff", cursor: "pointer" }}
            >
              删除
            </button>
          )}
        </div>
      </div>

      {!!msg && <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 8 }}>{msg}</div>}

      {/* 审计信息 */}
      <div style={{ marginBottom: 12, padding: 10, background: "#f5f5f5", borderRadius: 8, fontSize: 12 }}>
        <div>创建人：{resolveUserDisplay(createdBy, userDisplayMap)}</div>
        <div>创建时间：{fmtDateTimeMaybe(createdAt)}</div>
        <div>最后修改人：{resolveUserDisplay(updatedBy, userDisplayMap)}</div>
        <div>最后修改时间：{fmtDateTimeMaybe(updatedAt)}</div>
      </div>

      {/* 表单 */}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          名称（必填）：
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        <label>
          一级分类：
          <select
            value={primaryCategory}
            onChange={(e) => handlePrimaryCategoryChange(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            <option value="">（可选）</option>
            {primaryCategories.map((o) => (
              <option key={o.id} value={o.value}>{o.name}</option>
            ))}
          </select>
        </label>

        {primaryCategory && subCategories.length > 0 && (
          <label>
            二级分类：
            <select
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            >
              <option value="">（可选）</option>
              {subCategories.map((o) => (
                <option key={o.id} value={o.value}>{o.name}</option>
              ))}
            </select>
          </label>
        )}

        <label>
          所属人（必填）：
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>

        <label>
          数量：
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        <label>
          单位：
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}
              style={{ flex: 1, padding: 8, boxSizing: "border-box" as const }}>
              <option value="">（可选）</option>
              {unitOptions.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
            <input value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)}
              placeholder="新增单位…" style={{ width: 100, padding: 8 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddUnit(); } }} />
            <button type="button" onClick={handleAddUnit} disabled={addingUnit || !newUnitName.trim()}
              style={{ padding: "8px 10px", background: "#1a73e8", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              {addingUnit ? "…" : "+ 单位"}
            </button>
          </div>
        </label>

        <label>
          预估单价（人民币）：
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 14 }}>¥</span>
            <input type="number" min={0} step={0.01}
              value={unitPriceDisplay}
              onChange={(e) => {
                setUnitPriceDisplay(e.target.value);
                const fen = Math.round(parseFloat(e.target.value || "0") * 100);
                setUnitPrice(Number.isFinite(fen) ? String(fen) : "");
              }}
              placeholder="0.00" style={{ flex: 1, padding: 8, boxSizing: "border-box" as const }} />
            {unitPrice && Number(unitPrice) > 0 && (
              <span style={{ fontSize: 13, color: "#666" }}>
                合计：¥{((parseInt(quantity) || 0) * Number(unitPrice) / 100).toFixed(2)}
              </span>
            )}
          </div>
        </label>

        <label>
          位置：
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            <option value="">（可选）</option>
            {locationOptions.map((o) => (
              <option key={o.id} value={o.value}>{o.name}</option>
            ))}
          </select>
        </label>

        <label>
          状态：
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label>
          备注：
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        {/* 上一项 / 保存 / 下一项 三列布局 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          {prevItem ? (
            <a
              href={`/inventory/${prevItem.id}/edit`}
              title={`上一项：${prevItem.name}`}
              style={{
                flex: "0 0 auto",
                padding: "10px 14px",
                border: "1px solid #1a73e8",
                color: "#1a73e8",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
                whiteSpace: "nowrap",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              ‹ {prevItem.name.length > 7 ? prevItem.name.slice(0, 7) + "…" : prevItem.name}
            </a>
          ) : (
            <div style={{ flex: "0 0 auto", width: 40 }} />
          )}

          <button
            type="submit"
            disabled={loading || !canWrite}
            style={{ flex: 1, padding: "10px 16px", fontWeight: 700 }}
          >
            {loading ? "保存中…" : "保存"}
          </button>

          {nextItem ? (
            <a
              href={`/inventory/${nextItem.id}/edit`}
              title={`下一项：${nextItem.name}`}
              style={{
                flex: "0 0 auto",
                padding: "10px 14px",
                border: "1px solid #1a73e8",
                color: "#1a73e8",
                borderRadius: 6,
                fontSize: 13,
                textDecoration: "none",
                whiteSpace: "nowrap",
                maxWidth: 140,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {nextItem.name.length > 7 ? nextItem.name.slice(0, 7) + "…" : nextItem.name} ›
            </a>
          ) : (
            <div style={{ flex: "0 0 auto", width: 40 }} />
          )}
        </div>
      </form>

      {/* 图片管理 */}
      <hr style={{ margin: "24px 0" }} />
      <h2 style={{ fontSize: 16, fontWeight: 800 }}>物资图片</h2>

      {!!imgMsg && <div style={{ marginTop: 8, marginBottom: 8, padding: 10, background: "#f5f5f5", borderRadius: 8 }}>{imgMsg}</div>}

      {/* 当前图片预览 */}
      {imageSignedUrl ? (
        <div style={{ marginTop: 8 }}>
          {/* 图片（含旋转预览） */}
          <div style={{ display: "inline-block", overflow: "hidden" }}>
            <a href={imageSignedUrl} target="_blank" rel="noreferrer">
              <img
                src={imageSignedUrl}
                alt={name}
                style={{
                  maxWidth: 400,
                  maxHeight: 400,
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid #eee",
                  transform: `rotate(${previewRotation}deg)`,
                  transition: "transform 0.2s ease",
                  display: "block",
                }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).alt = "图片加载失败";
                }}
              />
            </a>
          </div>

          {/* 旋转控制 */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#555" }}>📐 旋转：</span>
            <button
              type="button"
              onClick={() => setPreviewRotation((r) => (r - 90 + 360) % 360)}
              style={{ padding: "4px 10px", border: "1px solid #888", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 20 }}
              title="逆时针 90°"
            >
              ↺
            </button>
            <button
              type="button"
              onClick={() => setPreviewRotation((r) => (r + 90) % 360)}
              style={{ padding: "4px 10px", border: "1px solid #888", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 20 }}
              title="顺时针 90°"
            >
              ↻
            </button>
            {previewRotation !== 0 && (
              <button
                type="button"
                onClick={handleSaveRotation}
                disabled={savingRotation || uploading}
                style={{ padding: "4px 12px", border: "1px solid #1a73e8", color: "#fff", background: savingRotation ? "#aaa" : "#1a73e8", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
              >
                {savingRotation ? "保存中…" : "💾 保存旋转"}
              </button>
            )}
            {previewRotation !== 0 && (
              <button
                type="button"
                onClick={() => setPreviewRotation(0)}
                disabled={savingRotation}
                style={{ padding: "4px 10px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13, color: "#888" }}
              >
                重置
              </button>
            )}
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 10 }}>
            {canWrite && (
              <>
                <label style={{ padding: "6px 12px", border: "1px solid #0366d6", color: "#0366d6", borderRadius: 6, cursor: "pointer", fontSize: 13 }}>
                  替换图片
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => handleUploadImage(e.target.files)}
                    disabled={uploading}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleDeleteImage}
                  disabled={uploading}
                  style={{ padding: "6px 12px", border: "1px solid #c00", color: "#c00", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
                >
                  删除图片
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => loadImageUrl(imagePath)}
              style={{ padding: "6px 12px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
            >
              刷新（重新签名）
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div style={{
            width: 120,
            height: 120,
            borderRadius: 8,
            background: "#f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            color: "#ccc",
            marginBottom: 8,
          }}>
            📦
          </div>
          {canWrite && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleUploadImage(e.target.files)}
                disabled={uploading}
              />
            </div>
          )}
          {!canWrite && <div style={{ color: "#666", fontSize: 13 }}>暂无图片</div>}
        </div>
      )}
    </div>
  );
}
