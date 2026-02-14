"use client";

import { useEffect, useState } from "react";
import {
  InventoryItem,
  InventoryCategory,
  InventoryLocation,
  getMyProfile,
  fetchInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  uploadInventoryImage,
  deleteInventoryImage,
  getSignedUrl,
  fetchMembers,
  fetchAllMembers,
  fetchInventoryCategories,
  fetchInventoryLocations,
  STATUS_OPTIONS,
  MAX_FILE_SIZE,
} from "../../../../lib/services/inventoryService";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../../../lib/services/userDisplay";

type Member = { id: string; name: string };

export default function EditInventoryClient({ id }: { id: string }) {
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [allMemberMap, setAllMemberMap] = useState<Map<string, string>>(new Map());
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());
  const [categoryOptions, setCategoryOptions] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);

  // 表单字段
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("in_use");
  const [notes, setNotes] = useState("");

  // 图片
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageSignedUrl, setImageSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 审计字段
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [imgMsg, setImgMsg] = useState("");

  const canWrite = role === "admin" || role === "finance";
  const isAdmin = role === "admin";

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

        const [item, memberList, memberMap, cats, locs] = await Promise.all([
          fetchInventoryItem(id),
          fetchMembers(profile.orgId),
          fetchAllMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
        ]);

        setMembers(memberList);
        setAllMemberMap(memberMap);
        setCategoryOptions(cats);
        setLocationOptions(locs);

        // 如果当前 owner_id 不在活跃成员中，也加进下拉
        if (item.owner_id && !memberList.some((m) => m.id === item.owner_id)) {
          const ownerName = memberMap.get(item.owner_id) ?? item.owner_id;
          setMembers([...memberList, { id: item.owner_id, name: ownerName + "（已停用）" }]);
        }

        // 填充表单
        setName(item.name);
        setCategory(item.category ?? "");
        setOwnerId(item.owner_id);
        setQuantity(String(item.quantity));
        setLocation(item.location ?? "");
        setStatus(item.status);
        setNotes(item.notes ?? "");
        setImagePath(item.image_path);
        setCreatedBy(item.created_by);
        setUpdatedBy(item.updated_by);
        setCreatedAt(item.created_at);
        setUpdatedAt(item.updated_at);

        // 加载用户显示名
        const auditIds = [item.created_by, item.updated_by].filter(Boolean) as string[];
        if (auditIds.length > 0) {
          const displayMap = await fetchUserDisplayMap(auditIds, profile.orgId);
          setUserDisplayMap(displayMap);
        }

        // 加载图片
        await loadImageUrl(item.image_path);
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
      await updateInventoryItem(id, {
        name: name.trim(),
        category: category || null,
        owner_id: ownerId,
        quantity: qty,
        location: location || null,
        status,
        notes: notes.trim() || null,
      });
      setMsg("✅ 保存成功");
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

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      {/* 头部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>编辑物资</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
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
          类别：
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            <option value="">（可选）</option>
            {categoryOptions.map((o) => (
              <option key={o.id} value={o.value}>{o.name}</option>
            ))}
          </select>
        </label>

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

        <button
          type="submit"
          disabled={loading || !canWrite}
          style={{ padding: "10px 16px", fontWeight: 700, marginTop: 8 }}
        >
          {loading ? "保存中…" : "保存"}
        </button>
      </form>

      {/* 图片管理 */}
      <hr style={{ margin: "24px 0" }} />
      <h2 style={{ fontSize: 16, fontWeight: 800 }}>物资图片</h2>

      {!!imgMsg && <div style={{ marginTop: 8, marginBottom: 8, padding: 10, background: "#f5f5f5", borderRadius: 8 }}>{imgMsg}</div>}

      {/* 当前图片预览 */}
      {imageSignedUrl ? (
        <div style={{ marginTop: 8 }}>
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
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).alt = "图片加载失败";
              }}
            />
          </a>
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
