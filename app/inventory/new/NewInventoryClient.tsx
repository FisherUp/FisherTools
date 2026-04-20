"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getMyProfile,
  createInventoryItem,
  uploadInventoryImage,
  updateInventoryItem,
  fetchMembers,
  fetchInventoryCategories,
  fetchInventoryLocations,
  InventoryCategory,
  InventoryLocation,
  STATUS_OPTIONS,
  MAX_FILE_SIZE,
  getPrimaryCategories,
  getSubCategories,
  findCategoryByValue,
  logItemChanges,
  createIntakeLog,
  confirmIntakeLog,
} from "../../../lib/services/inventoryService";
import AiInputPanel, { AiParsedItem } from "./AiInputPanel";

type Member = { id: string; name: string };

export default function NewInventoryClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [allCategories, setAllCategories] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [name, setName] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("in_use");
  const [notes, setNotes] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // AI 录入跟踪
  const [aiInputType, setAiInputType] = useState<"voice" | "text" | null>(null);
  const [aiRawInput, setAiRawInput] = useState("");
  const [aiParsedResult, setAiParsedResult] = useState<any>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const canWrite = role === "admin" || role === "finance" || role === "inventory-edit";
  const LS_OWNER_KEY = "inventory_default_owner_id";

  // 一级分类列表
  const primaryCategories = getPrimaryCategories(allCategories);
  // 当前一级下的二级分类
  const selectedPrimary = primaryCategories.find((c) => c.value === primaryCategory);
  const subCategories = selectedPrimary ? getSubCategories(allCategories, selectedPrimary.id) : [];

  useEffect(() => {
    const init = async () => {
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setRole(profile.role);

        const [memberList, cats, locs] = await Promise.all([
          fetchMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
        ]);
        setMembers(memberList);
        setAllCategories(cats);
        setLocationOptions(locs);
        // 默认所属人：优先用 localStorage 记忆的上次选择
        const savedOwner = typeof window !== "undefined" ? localStorage.getItem(LS_OWNER_KEY) : null;
        const defaultOwner =
          savedOwner && memberList.some((m) => m.id === savedOwner)
            ? savedOwner
            : memberList.length > 0
            ? memberList[0].id
            : "";
        setOwnerId(defaultOwner);
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      }
    };
    init();
  }, []);

  // 一级分类变更时清空二级
  const handlePrimaryCategoryChange = (val: string) => {
    setPrimaryCategory(val);
    setSubCategory("");
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setMsg(`文件 ${file.name} 超过 10MB，请压缩后再上传`);
      return;
    }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  };

  // AI 解析结果填入表单
  const handleAiApply = useCallback((item: AiParsedItem, rawInput: string) => {
    setName(item.name || "");
    setQuantity(String(item.quantity || 1));
    setNotes(item.notes || "");
    setAiRawInput(rawInput);  // 修复：正确进行设置

    // 根据 AI 返回的分类名匹配数据库分类
    if (item.primary_category) {
      const matchedPrimary = primaryCategories.find(
        (c) => c.name === item.primary_category || c.value === item.primary_category
      );
      if (matchedPrimary) {
        setPrimaryCategory(matchedPrimary.value);
        // 匹配二级分类
        if (item.sub_category) {
          const subs = getSubCategories(allCategories, matchedPrimary.id);
          const matchedSub = subs.find(
            (c) => c.name === item.sub_category || c.value === item.sub_category
          );
          if (matchedSub) setSubCategory(matchedSub.value);
        }
      }
    }

    // 匹配位置
    if (item.location) {
      const matchedLoc = locationOptions.find(
        (l) => l.name === item.location || l.value === item.location
      );
      if (matchedLoc) setLocation(matchedLoc.value);
    }

    // 匹配状态
    if (item.status) {
      const validStatus = STATUS_OPTIONS.map((o) => o.value);
      if (validStatus.includes(item.status as any)) {
        setStatus(item.status);
      }
    }

    // 记录 AI 输入信息
    setAiInputType("text");
    setAiParsedResult(item);
  }, [primaryCategories, allCategories, locationOptions]);

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
        category: primaryCategory || null,
        sub_category: subCategory || null,
        owner_id: ownerId,
        quantity: qty,
        location: location || null,
        status,
        notes: notes.trim() || null,
      });

      // 2) 记录创建日志
      await logItemChanges(orgId, newId, "create", []);

      // 3) 如果有 AI 录入，记录 intake_log
      if (aiParsedResult && aiRawInput) {
        try {
          const logId = await createIntakeLog(orgId, aiRawInput, aiParsedResult, aiInputType || "text");
          await confirmIntakeLog(logId, newId);
        } catch {
          // AI 日志失败不影响主流程
        }
      }

      // 4) 如果选了图片，上传并更新 image_path
      if (imageFile) {
        try {
          const imgPath = await uploadInventoryImage(orgId, newId, imageFile);
          await updateInventoryItem(newId, { image_path: imgPath });
        } catch (uploadErr: any) {
          setMsg(`✅ 物资已创建，但图片上传失败：${uploadErr.message}。您可以在编辑页重新上传。`);
          setLoading(false);
          return;
        }
      }

      setMsg("✅ 创建成功！");
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

      {/* AI 智能录入面板 */}
      {canWrite && (
        <AiInputPanel
          onApply={(item, rawInput) => {
            handleAiApply(item, rawInput);
          }}
          disabled={!canWrite}
        />
      )}

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 8 }}>
        <label>
          名称（必填）：
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="物资名称"
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>

        {/* 一级分类 */}
        <label>
          一级分类：
          <select
            value={primaryCategory}
            onChange={(e) => handlePrimaryCategoryChange(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          >
            <option value="">（可选）</option>
            {primaryCategories.map((o) => (
              <option key={o.id} value={o.value}>{o.name}</option>
            ))}
          </select>
        </label>

        {/* 二级分类（仅当一级已选时显示） */}
        {primaryCategory && subCategories.length > 0 && (
          <label>
            二级分类：
            <select
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
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
            onChange={(e) => {
              setOwnerId(e.target.value);
              if (typeof window !== "undefined") {
                localStorage.setItem(LS_OWNER_KEY, e.target.value);
              }
            }}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
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
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
          />
        </label>

        <label>
          位置：
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
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
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
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
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, boxSizing: "border-box" }}
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
