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
  fetchInventoryUnits,
  createInventoryUnit,
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
  STATUS_OPTIONS,
  MAX_FILE_SIZE,
  getPrimaryCategories,
  getSubCategories,
  findCategoryByValue,
  logItemChanges,
  createIntakeLog,
  confirmIntakeLog,
  fmtYuan,
  createInventoryLocation,
} from "../../../lib/services/inventoryService";
import AiInputPanel, { AiParsedItem } from "./AiInputPanel";

type Member = { id: string; name: string };

type BatchItem = {
  name: string;
  primaryCategory: string;
  subCategory: string;
  ownerId: string;
  quantity: string;
  location: string;
  status: string;
  notes: string;
  unit: string;
  unit_price: string;
  rawInput: string;
  parsedResult: AiParsedItem;
  imageFile?: File; // 拍照识别时拍摄的原始照片
};

export default function NewInventoryClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [allCategories, setAllCategories] = useState<InventoryCategory[]>([]);
  const [locationOptions, setLocationOptions] = useState<InventoryLocation[]>([]);
  const [unitOptions, setUnitOptions] = useState<InventoryUnit[]>([]);
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [name, setName] = useState("");
  const [primaryCategory, setPrimaryCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [unitPrice, setUnitPrice] = useState(""); // 分（整数字符串），存 DB
  const [unitPriceDisplay, setUnitPriceDisplay] = useState(""); // 显示用（元字符串）
  const [newUnitName, setNewUnitName] = useState("");
  const [addingUnit, setAddingUnit] = useState(false);
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

  // 批量确认队列
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchMsg, setBatchMsg] = useState("");

  const canWrite = role === "admin" || role === "finance" || role === "inventory-edit" || role === "learner";
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

        const [memberList, cats, locs, units] = await Promise.all([
          fetchMembers(profile.orgId),
          fetchInventoryCategories(profile.orgId),
          fetchInventoryLocations(profile.orgId),
          fetchInventoryUnits(profile.orgId),
        ]);
        setMembers(memberList);
        setAllCategories(cats);
        setLocationOptions(locs);
        setUnitOptions(units);
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
  const handleAiApply = useCallback(async (item: AiParsedItem, rawInput: string, photoFile?: File) => {
    setName(item.name || "");
    setQuantity(String(item.quantity || 1));
    setNotes(item.notes || "");
    setAiRawInput(rawInput);

    // 单价（分存到 unitPrice，元显示到 unitPriceDisplay）
    if ((item as any).unit_price && (item as any).unit_price > 0) {
      setUnitPrice(String((item as any).unit_price));
      setUnitPriceDisplay(((item as any).unit_price / 100).toFixed(2));
    }

    // 单位：如果 AI 建议的单位不在列表里，自动创建
    if ((item as any).unit) {
      const unitName: string = (item as any).unit;
      const existing = unitOptions.find((u) => u.name === unitName);
      if (!existing && orgId) {
        try {
          await createInventoryUnit(orgId, unitName);
          const updated = await fetchInventoryUnits(orgId);
          setUnitOptions(updated);
        } catch {}
      }
      setUnit(unitName);
    }

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

    // 位置：如果 AI 建议的位置不在列表里，自动创建
    if (item.location) {
      let matched = locationOptions.find(
        (l) => l.name === item.location || l.value === item.location
      );
      if (!matched && orgId) {
        try {
          await createInventoryLocation(orgId, item.location);
          const updated = await fetchInventoryLocations(orgId);
          setLocationOptions(updated);
          matched = updated.find((l) => l.name === item.location || l.value === item.location);
        } catch {}
      }
      if (matched) setLocation(matched.value);
    }

    // 匹配状态
    if (item.status) {
      const validStatus = STATUS_OPTIONS.map((o) => o.value);
      if (validStatus.includes(item.status as any)) {
        setStatus(item.status);
      }
    }

    // 如果拍照识别，自动水印到表单图片（免得再次手动上传）
    if (photoFile) {
      setImageFile(photoFile);
      setImagePreview(URL.createObjectURL(photoFile));
    }

    // 记录 AI 输入信息
    setAiInputType("text");
    setAiParsedResult(item);
  }, [primaryCategories, allCategories, locationOptions, unitOptions, orgId]);

  // 将 AI 解析结果转为批量队列项（匹配数据库分类/位置值）
  const parsedItemToBatchItem = useCallback(
    (parsed: AiParsedItem, rawInput: string): BatchItem => {
      let primaryCat = "";
      let subCat = "";
      if (parsed.primary_category) {
        const m = primaryCategories.find(
          (c) => c.name === parsed.primary_category || c.value === parsed.primary_category
        );
        if (m) {
          primaryCat = m.value;
          if (parsed.sub_category) {
            const subs = getSubCategories(allCategories, m.id);
            const ms = subs.find((c) => c.name === parsed.sub_category || c.value === parsed.sub_category);
            if (ms) subCat = ms.value;
          }
        }
      }
      let loc = "";
      if (parsed.location) {
        const ml = locationOptions.find((l) => l.name === parsed.location || l.value === parsed.location);
        if (ml) loc = ml.value;
      }
      let st = "in_use";
      if (parsed.status) {
        const valid = STATUS_OPTIONS.map((o) => o.value);
        if (valid.includes(parsed.status as any)) st = parsed.status;
      }
      const savedOwner = typeof window !== "undefined" ? localStorage.getItem(LS_OWNER_KEY) : null;
      const defOwner =
        savedOwner && members.some((m) => m.id === savedOwner)
          ? savedOwner
          : members[0]?.id ?? "";
      return {
        name: parsed.name || "",
        primaryCategory: primaryCat,
        subCategory: subCat,
        ownerId: defOwner,
        quantity: String(parsed.quantity || 1),
        location: loc,
        status: st,
        notes: parsed.notes || "",
        unit: parsed.unit || "",
        unit_price: parsed.unit_price ? String(parsed.unit_price) : "",
        rawInput,
        parsedResult: parsed,
      };
    },
    [primaryCategories, allCategories, locationOptions, members]
  );

  // 新增单位（在表单）
  const handleAddUnit = async () => {
    const name = newUnitName.trim();
    if (!name || !orgId) return;
    setAddingUnit(true);
    try {
      await createInventoryUnit(orgId, name);
      const updated = await fetchInventoryUnits(orgId);
      setUnitOptions(updated);
      setUnit(name);
      setNewUnitName("");
    } catch (e: any) {
      setMsg("新增单位失败：" + (e?.message ?? e));
    } finally {
      setAddingUnit(false);
    }
  };

  // 接收 AI 面板的批量结果，加入确认队列
  // 先自动创建 AI 建议中数据库里没有的单位/位置，减少用户额外手动输入
  const handleBatchApply = useCallback(
    async (items: AiParsedItem[], rawInput: string, photoFile?: File) => {
      // 收集所有项目中独特的单位和位置名称
      const uniqueUnits = [...new Set(items.map((i) => i.unit).filter(Boolean) as string[])];
      const uniqueLocations = [...new Set(items.map((i) => i.location).filter(Boolean) as string[])];

      // 自动创建缺失的单位
      let latestLocs = locationOptions;
      let needRefreshLocs = false;
      for (const locName of uniqueLocations) {
        if (!locationOptions.find((l) => l.name === locName || l.value === locName) && orgId) {
          try { await createInventoryLocation(orgId, locName); needRefreshLocs = true; } catch {}
        }
      }
      if (needRefreshLocs) {
        latestLocs = await fetchInventoryLocations(orgId);
        setLocationOptions(latestLocs);
      }

      // 自动创建缺失的单位
      let needRefreshUnits = false;
      for (const unitName of uniqueUnits) {
        if (!unitOptions.find((u) => u.name === unitName) && orgId) {
          try { await createInventoryUnit(orgId, unitName); needRefreshUnits = true; } catch {}
        }
      }
      if (needRefreshUnits) {
        const latestUnits = await fetchInventoryUnits(orgId);
        setUnitOptions(latestUnits);
      }

      setBatchItems(items.map((item, idx) => ({
        ...parsedItemToBatchItem(item, rawInput, latestLocs),
        imageFile: idx === 0 ? photoFile : undefined, // 拍照关联到第一件物资
      })));
      setBatchMsg("");
      setAiInputType("text");
      setAiRawInput(rawInput);
    },
    [parsedItemToBatchItem, locationOptions, unitOptions, orgId]
  );

  const updateBatchItem = (idx: number, field: keyof BatchItem, value: string) => {
    setBatchItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === "primaryCategory") updated.subCategory = "";
        return updated;
      })
    );
  };

  const removeBatchItem = (idx: number) => {
    setBatchItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleBatchSubmit = async () => {
    if (batchItems.length === 0) return;
    setBatchMsg("");
    for (let i = 0; i < batchItems.length; i++) {
      const it = batchItems[i];
      if (!it.name.trim()) return setBatchMsg(`第 ${i + 1} 件物资名称不能为空`);
      if (!it.ownerId) return setBatchMsg(`第 ${i + 1} 件物资请选择所属人`);
      const qty = parseInt(it.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1) return setBatchMsg(`第 ${i + 1} 件物资数量必须 ≥ 1`);
    }
    setBatchLoading(true);

    // 并行创建所有物资
    const results = await Promise.allSettled(
      batchItems.map(async (it) => {
        const newId = await createInventoryItem({
          org_id: orgId,
          name: it.name.trim(),
          category: it.primaryCategory || null,
          sub_category: it.subCategory || null,
          owner_id: it.ownerId,
          quantity: parseInt(it.quantity, 10),
          location: it.location || null,
          status: it.status,
          notes: it.notes.trim() || null,
          unit: it.unit || null,
          unit_price: it.unit_price ? parseInt(it.unit_price) : null,
        });
        // 如果有拍照图片，自动上传
        if (it.imageFile) {
          try {
            const imgPath = await uploadInventoryImage(orgId, newId, it.imageFile);
            await updateInventoryItem(newId, { image_path: imgPath });
          } catch {
            // 图片上传失败不阵塞主流程
          }
        }
        // 日志记录不阻塞主流程，并行执行
        await Promise.allSettled([
          logItemChanges(orgId, newId, "create", []),
          createIntakeLog(orgId, it.rawInput, it.parsedResult, aiInputType || "text")
            .then((logId) => confirmIntakeLog(logId, newId))
            .catch(() => {}),
        ]);
        return { name: it.name, id: newId };
      })
    );

    let ok = 0;
    const errs: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        ok++;
      } else {
        errs.push(`「${batchItems[i].name}」：${r.reason?.message ?? r.reason}`);
      }
    }

    setBatchLoading(false);
    if (errs.length === 0) {
      setBatchMsg(`✅ 全部 ${ok} 件物资已创建！正在跳转…`);
      setBatchItems([]);
      setTimeout(() => { window.location.href = "/inventory"; }, 1200);
    } else {
      setBatchMsg(`已创建 ${ok} 件，以下 ${errs.length} 件失败：${errs.join("；")}`);
    }
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
        category: primaryCategory || null,
        sub_category: subCategory || null,
        owner_id: ownerId,
        quantity: qty,
        location: location || null,
        status,
        notes: notes.trim() || null,
        unit: unit || null,
        unit_price: unitPrice ? parseInt(unitPrice) : null,
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
          onApply={(item, rawInput, imageFile) => handleAiApply(item, rawInput, imageFile)}
          onBatchApply={(items, rawInput, imageFile) => handleBatchApply(items, rawInput, imageFile)}
          disabled={!canWrite}
        />
      )}

      {/* ── 批量确认队列 ── */}
      {batchItems.length > 0 && (
        <div style={{ marginBottom: 16, border: "2px solid #1a73e8", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ background: "#e8f0fe", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 15, flexWrap: "wrap" }}>
            <span>📋</span>
            <span>AI 共识别 {batchItems.length} 件物资，请核对后统一提交</span>
            <span style={{ fontWeight: 400, fontSize: 12, color: "#555" }}>（可直接修改各字段）</span>
          </div>
          <div style={{ padding: 12, background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
            {batchItems.map((bItem, idx) => {
              const selPri = primaryCategories.find((c) => c.value === bItem.primaryCategory);
              const itemSubCats = selPri ? getSubCategories(allCategories, selPri.id) : [];
              return (
                <div key={idx} style={{ padding: "10px 12px", border: "1px solid #e0e0e0", borderRadius: 6, background: "#fafbfc" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ background: "#1a73e8", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {idx + 1}
                    </span>
                    <input
                      value={bItem.name}
                      onChange={(e) => updateBatchItem(idx, "name", e.target.value)}
                      placeholder="物资名称（必填）"
                      style={{ flex: 1, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 4, fontWeight: 600, fontSize: 14, boxSizing: "border-box" }}
                    />
                    {bItem.imageFile && (
                      <span title="已自动关联拍照图片" style={{ fontSize: 12, color: "#6f42c1", flexShrink: 0 }}>📷</span>
                    )}
                    <button type="button" onClick={() => removeBatchItem(idx)} title="移除" style={{ background: "none", border: "none", cursor: "pointer", color: "#c00", fontSize: 20, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>×</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>一级分类</div>
                      <select value={bItem.primaryCategory} onChange={(e) => updateBatchItem(idx, "primaryCategory", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        <option value="">（未选）</option>
                        {primaryCategories.map((c) => <option key={c.id} value={c.value}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>二级分类</div>
                      <select value={bItem.subCategory} onChange={(e) => updateBatchItem(idx, "subCategory", e.target.value)} disabled={itemSubCats.length === 0} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        <option value="">（未选）</option>
                        {itemSubCats.map((c) => <option key={c.id} value={c.value}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>数量</div>
                      <input type="number" min={1} value={bItem.quantity} onChange={(e) => updateBatchItem(idx, "quantity", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>所属人</div>
                      <select value={bItem.ownerId} onChange={(e) => updateBatchItem(idx, "ownerId", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>位置</div>
                      <select value={bItem.location} onChange={(e) => updateBatchItem(idx, "location", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        <option value="">（未选）</option>
                        {locationOptions.map((l) => <option key={l.id} value={l.value}>{l.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>状态</div>
                      <select value={bItem.status} onChange={(e) => updateBatchItem(idx, "status", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>单位</div>
                      <select value={bItem.unit} onChange={(e) => updateBatchItem(idx, "unit", e.target.value)} style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}>
                        <option value="">（未选）</option>
                        {unitOptions.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>单价 ¥</div>
                      <input type="number" min={0} step={0.01}
                        value={bItem.unit_price ? (Number(bItem.unit_price) / 100).toFixed(2) : ""}
                        onChange={(e) => updateBatchItem(idx, "unit_price", String(Math.round(parseFloat(e.target.value || "0") * 100)))}
                        placeholder="0.00" style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>备注</div>
                    <input value={bItem.notes} onChange={(e) => updateBatchItem(idx, "notes", e.target.value)} placeholder="（可选）" style={{ width: "100%", padding: "4px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                </div>
              );
            })}

            {batchMsg && (
              <div style={{ padding: "8px 12px", borderRadius: 6, background: batchMsg.startsWith("✅") ? "#d4edda" : "#f8d7da", color: batchMsg.startsWith("✅") ? "#155724" : "#842029", fontSize: 13 }}>
                {batchMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={() => { setBatchItems([]); setBatchMsg(""); }} style={{ padding: "8px 14px", border: "1px solid #ddd", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 14 }}>
                清空批次
              </button>
              <button
                type="button"
                onClick={handleBatchSubmit}
                disabled={batchLoading || batchItems.length === 0}
                style={{ padding: "8px 18px", background: batchLoading ? "#aaa" : "#1a73e8", color: "#fff", border: "none", borderRadius: 6, cursor: batchLoading ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14 }}
              >
                {batchLoading ? "创建中…" : `批量创建全部 ${batchItems.length} 件物资`}
              </button>
            </div>
          </div>
        </div>
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
