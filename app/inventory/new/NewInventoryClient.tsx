"use client";

import { useEffect, useState } from "react";
import {
  getMyProfile,
  createInventoryItem,
  uploadInventoryImage,
  updateInventoryItem,
  fetchMembers,
  CATEGORY_OPTIONS,
  STATUS_OPTIONS,
  LOCATION_OPTIONS,
  MAX_FILE_SIZE,
} from "../../../lib/services/inventoryService";

type Member = { id: string; name: string };

export default function NewInventoryClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("in_use");
  const [notes, setNotes] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const canWrite = role === "admin" || role === "finance";

  useEffect(() => {
    const init = async () => {
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setRole(profile.role);

        const memberList = await fetchMembers(profile.orgId);
        setMembers(memberList);
        if (memberList.length > 0) setOwnerId(memberList[0].id);
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      }
    };
    init();
  }, []);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setMsg(`文件 ${file.name} 超过 10MB，请压缩后再上传`);
      return;
    }
    setImageFile(file);
    // 本地预览
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!canWrite) return setMsg("权限不足，无法创建物资。");
    if (!name.trim()) return setMsg("请输入物资名称");
    if (!ownerId) return setMsg("请选择所属人");

    const qty = parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) return setMsg("数量必须 ≥ 1");

    setLoading(true);
    try {
      // 1) 创建物资记录
      const newId = await createInventoryItem({
        org_id: orgId,
        name: name.trim(),
        category: category || null,
        owner_id: ownerId,
        quantity: qty,
        location: location || null,
        status,
        notes: notes.trim() || null,
      });

      // 2) 如果选了图片，上传并更新 image_path
      if (imageFile) {
        try {
          const imgPath = await uploadInventoryImage(orgId, newId, imageFile);
          await updateInventoryItem(newId, { image_path: imgPath });
        } catch (uploadErr: any) {
          // 物资已创建成功，图片上传失败不回滚，提示用户稍后补传
          setMsg(`✅ 物资已创建，但图片上传失败：${uploadErr.message}。您可以在编辑页重新上传。`);
          setLoading(false);
          return;
        }
      }

      setMsg("✅ 创建成功！");
      // 跳转到编辑页（可继续上传/修改图片）
      setTimeout(() => {
        window.location.href = `/inventory/${newId}/edit`;
      }, 800);
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>新增物资</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/inventory" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回列表
          </a>
        </div>
      </div>

      {!canWrite && (
        <div style={{ marginBottom: 12, padding: 10, background: "#f5f5f5", borderRadius: 8 }}>
          你当前角色无新增权限（需要 admin 或 finance 角色）。
        </div>
      )}

      {!!msg && <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 8 }}>{msg}</div>}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <label>
          名称（必填）：
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="物资名称"
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
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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
            {members.length === 0 && <option value="">（暂无可用成员）</option>}
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
            {LOCATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
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
            placeholder="可选备注"
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          />
        </label>

        {/* 图片上传 */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>图片（可选）：</div>
          <input type="file" accept="image/*" onChange={handleImageSelect} />
          {imagePreview && (
            <div style={{ marginTop: 8 }}>
              <img
                src={imagePreview}
                alt="预览"
                style={{ maxWidth: 200, maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "1px solid #eee" }}
              />
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
                style={{ display: "block", marginTop: 4, fontSize: 12, color: "#c00", background: "none", border: "none", cursor: "pointer" }}
              >
                移除图片
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || !canWrite}
          style={{ padding: "10px 16px", fontWeight: 700, marginTop: 8 }}
        >
          {loading ? "创建中…" : "创建物资"}
        </button>
      </form>
    </div>
  );
}
