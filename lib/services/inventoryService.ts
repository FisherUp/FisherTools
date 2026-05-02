import { supabase } from "../supabaseClient";

// ─── 常量 ───
const BUCKET = "inventory-images";
const SIGNED_URL_TTL = 300; // 5 分钟
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── 类型 ───
export type InventoryItem = {
  id: string;
  org_id: string;
  name: string;
  category: string | null;
  sub_category: string | null;
  owner_id: string;
  quantity: number;
  unit: string | null;
  unit_price: number | null;  // 单位：分（整数）
  location: string | null;
  status: string;
  notes: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type InventoryUnit = {
  id: string;
  org_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type InventoryCategory = {
  id: string;
  org_id: string;
  name: string;
  value: string;
  parent_id: string | null;
  is_active: boolean;
  sort_order: number;
};

export type InventoryLocation = {
  id: string;
  org_id: string;
  name: string;
  value: string;
  is_active: boolean;
  sort_order: number;
};

export type ItemRule = {
  id: string;
  org_id: string;
  item_id: string;
  min_quantity: number;
  max_quantity: number | null;
};

export type ItemChangeLog = {
  id: string;
  org_id: string;
  item_id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type IntakeLog = {
  id: string;
  org_id: string;
  raw_input: string;
  parsed_result: any;
  item_id: string | null;
  input_type: string;
  status: string;
  created_by: string | null;
  created_at: string;
};

// ─── 枚举选项 ───
// 注意：这些常量保留用于向后兼容，但新代码应该从数据库读取
export const CATEGORY_OPTIONS = [
  { value: "book", label: "书" },
  { value: "toy", label: "玩具" },
  { value: "furniture", label: "家具" },
  { value: "electronics", label: "电器" },
  { value: "kitchenware", label: "厨具" },
  { value: "bedding", label: "床品" },
  { value: "clothing", label: "衣物" },
  { value: "other", label: "其他" },
] as const;

export const STATUS_OPTIONS = [
  { value: "in_use", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "pending", label: "待处理" },
  { value: "disposed", label: "已处理" },
  { value: "lent_out", label: "借出" },
] as const;

export const LOCATION_OPTIONS = [
  { value: "living_room", label: "客厅" },
  { value: "bedroom", label: "卧室" },
  { value: "study", label: "书房" },
  { value: "kitchen", label: "厨房" },
  { value: "storage_room", label: "储物间" },
  { value: "other", label: "其他" },
] as const;

// ─── 标签转换 ───
export function categoryLabel(v: string | null): string {
  if (!v) return "-";
  return CATEGORY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
export function statusLabel(v: string): string {
  return STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
export function locationLabel(v: string | null): string {
  if (!v) return "-";
  return LOCATION_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/** 金额（分） 转 元 显示，如 350 → "¥3.50" */
export function fmtYuan(fen: number | null | undefined): string {
  if (fen == null) return "-";
  return "¥" + (fen / 100).toFixed(2);
}

/** 计算总价（分），数量 × 单价 */
export function calcTotalPrice(item: Pick<InventoryItem, "quantity" | "unit_price">): number | null {
  if (item.unit_price == null || item.unit_price === 0) return null;
  return item.quantity * item.unit_price;
}

// ─── 通用 Profile 读取（复用现有模式）───
export async function getMyProfile() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(userErr.message);
  const user = userRes.user;
  if (!user) throw new Error("未登录，请先登录。");

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (pErr) throw new Error("读取 profiles 失败：" + pErr.message);
  if (!profile?.org_id) throw new Error("profiles.org_id 为空，请为该用户设置组织。");

  return {
    userId: user.id,
    orgId: String(profile.org_id),
    role: String(profile.role ?? ""),
  };
}

// ─── CRUD ───

/** 获取物资列表 */
export async function fetchInventoryItems(orgId: string): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error("加载物资列表失败：" + error.message);
  return (data ?? []) as InventoryItem[];
}

/** 获取单条物资 */
export async function fetchInventoryItem(id: string): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error("加载物资详情失败：" + error.message);
  return data as InventoryItem;
}

/** 获取物资 ID+名称列表（轻量，用于编辑页上/下一项导航）
 *  按 created_at 正序排列，保存物资不会改变其在导航列表中的位置。
 */
export async function fetchInventoryItemIdList(
  orgId: string
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("加载物资列表失败：", error.message);
    return [];
  }
  return (data ?? []) as { id: string; name: string }[];
}

/** 创建物资，返回新 ID */
export async function createInventoryItem(
  item: Pick<InventoryItem, "org_id" | "name" | "category" | "sub_category" | "owner_id" | "quantity" | "unit" | "unit_price" | "location" | "status" | "notes">
): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_items")
    .insert(item)
    .select("id")
    .single();

  if (error) throw new Error("创建物资失败：" + error.message);
  return data.id;
}

/** 更新物资 */
export async function updateInventoryItem(
  id: string,
  updates: Partial<Pick<InventoryItem, "name" | "category" | "sub_category" | "owner_id" | "quantity" | "unit" | "unit_price" | "location" | "status" | "notes" | "image_path">>
): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error("更新物资失败：" + error.message);
}

/** 删除物资（硬删除，需 admin 权限） */
export async function deleteInventoryItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id);

  if (error) throw new Error("删除物资失败：" + error.message);
}

// ─── 图片操作 ───

/**
 * 客户端图片压缩：缩放到 maxDim 以内、JPEG quality 压缩
 * 返回压缩后的 File 对象
 */
export function compressImage(
  file: File,
  maxDim = 1200,
  quality = 0.7
): Promise<File> {
  return new Promise((resolve, reject) => {
    // 非图片直接返回原文件
    if (!file.type.startsWith("image/")) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w <= maxDim && h <= maxDim && file.size <= 300 * 1024) {
        // 已经很小，无需压缩
        return resolve(file);
      }
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("压缩失败"));
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
            type: "image/jpeg",
          });
          resolve(compressed);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // 解码失败则返回原文件
    };
    img.src = url;
  });
}

/** 上传图片到 inventory-images bucket，返回 storage path（自动压缩）
 *  存储压缩策略：最长边 1000px，JPEG 75%，保证加载速度同时清晰可辨。
 */
export async function uploadInventoryImage(
  orgId: string,
  itemId: string,
  file: File
): Promise<string> {
  // 先压缩（存储用，比 AI 识别用更小）
  const compressed = await compressImage(file, 1000, 0.75);
  if (compressed.size > MAX_FILE_SIZE) {
    throw new Error(`文件 ${file.name} 压缩后仍超过 10MB（${(compressed.size / 1024 / 1024).toFixed(1)}MB），请手动压缩后再上传`);
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${orgId}/${itemId}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, compressed, {
    upsert: false,
    contentType: compressed.type,
  });

  if (error) throw new Error("上传图片失败：" + error.message);
  return storagePath;
}

/** 删除 Storage 中的图片 */
export async function deleteInventoryImage(storagePath: string): Promise<void> {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw new Error("删除图片失败：" + error.message);
}

/** 生成单个 signed URL */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  if (!storagePath) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (error || !data?.signedUrl) {
    console.warn("生成签名 URL 失败：", error?.message);
    return null;
  }
  return data.signedUrl;
}

/** 批量生成 signed URL（用于列表页缩略图）——使用 Supabase 批量接口，单次 HTTP */
export async function batchGetSignedUrls(
  paths: (string | null)[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const validPaths = Array.from(new Set(paths.filter(Boolean) as string[]));
  if (validPaths.length === 0) return map;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(validPaths, SIGNED_URL_TTL);

  if (error) {
    console.warn("批量生成签名 URL 失败：", error.message);
    return map;
  }

  for (const item of data ?? []) {
    if (item.signedUrl && item.path) {
      map.set(item.path, item.signedUrl);
    }
  }

  return map;
}

/** 加载 members（作为"所属人"下拉） */
export async function fetchMembers(orgId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("members")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw new Error("加载成员失败：" + error.message);
  return (data ?? []).map((m: any) => ({ id: String(m.id), name: String(m.name) }));
}

/** 加载所有 members（含停用，用于显示名称映射） */
export async function fetchAllMembers(orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("members")
    .select("id, name")
    .eq("org_id", orgId);

  if (error) {
    console.warn("加载成员失败：", error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  (data ?? []).forEach((m: any) => map.set(String(m.id), String(m.name)));
  return map;
}

// ─── 类别和位置管理 ───

/** 获取类别列表（仅启用的，用于表单下拉） */
export async function fetchInventoryCategories(orgId: string): Promise<InventoryCategory[]> {
  const { data, error } = await supabase
    .from("inventory_categories")
    .select("*, parent_id")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error("加载类别列表失败：" + error.message);
  return (data ?? []) as InventoryCategory[];
}

/** 获取所有类别（含停用的，用于设置页管理） */
export async function fetchAllInventoryCategories(orgId: string): Promise<InventoryCategory[]> {
  const { data, error } = await supabase
    .from("inventory_categories")
    .select("*, parent_id")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error("加载类别列表失败：" + error.message);
  return (data ?? []) as InventoryCategory[];
}

/** 获取位置列表（仅启用的，用于表单下拉） */
export async function fetchInventoryLocations(orgId: string): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error("加载位置列表失败：" + error.message);
  return (data ?? []) as InventoryLocation[];
}

/** 获取所有位置（含停用���，用于设置页管理） */
export async function fetchAllInventoryLocations(orgId: string): Promise<InventoryLocation[]> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });

  if (error) throw new Error("加载位置列表失败：" + error.message);
  return (data ?? []) as InventoryLocation[];
}

/** 创建类别（value 自动使用 name，支持 parent_id） */
export async function createInventoryCategory(
  orgId: string,
  name: string,
  sortOrder: number = 0,
  parentId: string | null = null
): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_categories")
    .insert({ org_id: orgId, name, value: name, sort_order: sortOrder, parent_id: parentId })
    .select("id")
    .single();

  if (error) throw new Error("创建类别失败：" + error.message);
  return data.id;
}

/** 创建位置（value 自动使用 name） */
export async function createInventoryLocation(
  orgId: string,
  name: string,
  sortOrder: number = 0
): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_locations")
    .insert({ org_id: orgId, name, value: name, sort_order: sortOrder })
    .select("id")
    .single();

  if (error) throw new Error("创建位置失败：" + error.message);
  return data.id;
}

/** 更新类别 */
export async function updateInventoryCategory(
  id: string,
  updates: Partial<Pick<InventoryCategory, "name" | "value" | "sort_order" | "is_active">>
): Promise<void> {
  const { error } = await supabase
    .from("inventory_categories")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error("更新类别失败：" + error.message);
}

/** 更新位置 */
export async function updateInventoryLocation(
  id: string,
  updates: Partial<Pick<InventoryLocation, "name" | "value" | "sort_order" | "is_active">>
): Promise<void> {
  const { error } = await supabase
    .from("inventory_locations")
    .update(updates)
    .eq("id", id);

  if (error) throw new Error("更新位置失败：" + error.message);
}

/** 删除类别 */
export async function deleteInventoryCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_categories")
    .delete()
    .eq("id", id);

  if (error) throw new Error("删除类别失败：" + error.message);
}

/** 删除位置 */
export async function deleteInventoryLocation(id: string): Promise<void> {
  const { error } = await supabase
    .from("inventory_locations")
    .delete()
    .eq("id", id);

  if (error) throw new Error("删除位置失败：" + error.message);
}

// ─── 二级分类辅助 ───

/** 获取一级分类列表 */
export function getPrimaryCategories(categories: InventoryCategory[]): InventoryCategory[] {
  return categories.filter((c) => !c.parent_id);
}

/** 获取某一级分类下的二级分类 */
export function getSubCategories(categories: InventoryCategory[], parentId: string): InventoryCategory[] {
  return categories.filter((c) => c.parent_id === parentId);
}

/** 根据 value 查找分类名称 */
export function findCategoryByValue(categories: InventoryCategory[], value: string | null): InventoryCategory | undefined {
  if (!value) return undefined;
  return categories.find((c) => c.value === value);
}

/** 根据二级分类 value，返回 "一级 > 二级" 显示文本 */
export function getCategoryDisplayText(
  categories: InventoryCategory[],
  primaryValue: string | null,
  subValue: string | null
): string {
  const primary = findCategoryByValue(categories, primaryValue);
  const sub = findCategoryByValue(categories, subValue);
  if (primary && sub) return `${primary.name} > ${sub.name}`;
  if (primary) return primary.name;
  if (sub) return sub.name;
  return "-";
}

// ─── 物资规则 ───

/** 获取物资规则 */
export async function fetchItemRule(itemId: string): Promise<ItemRule | null> {
  const { data, error } = await supabase
    .from("item_rules")
    .select("*")
    .eq("item_id", itemId)
    .maybeSingle();

  if (error) throw new Error("加载物资规则失败：" + error.message);
  return data as ItemRule | null;
}

/** 批量获取物资规则 */
export async function fetchItemRules(orgId: string): Promise<Map<string, ItemRule>> {
  const { data, error } = await supabase
    .from("item_rules")
    .select("*")
    .eq("org_id", orgId);

  if (error) throw new Error("加载物资规则失败：" + error.message);
  const map = new Map<string, ItemRule>();
  (data ?? []).forEach((r: any) => map.set(r.item_id, r as ItemRule));
  return map;
}

/** 创建或更新物资规则 */
export async function upsertItemRule(
  orgId: string,
  itemId: string,
  minQuantity: number,
  maxQuantity: number | null
): Promise<void> {
  const { error } = await supabase
    .from("item_rules")
    .upsert(
      { org_id: orgId, item_id: itemId, min_quantity: minQuantity, max_quantity: maxQuantity },
      { onConflict: "item_id" }
    );

  if (error) throw new Error("保存物资规则失败：" + error.message);
}

// ─── 变更日志 ───

/** 写入变更日志（多个字段变更） */
export async function logItemChanges(
  orgId: string,
  itemId: string,
  action: "create" | "update" | "delete",
  changes: { field_name: string; old_value: string | null; new_value: string | null }[]
): Promise<void> {
  if (changes.length === 0 && action === "update") return;

  const rows = action === "update"
    ? changes.map((c) => ({
        org_id: orgId,
        item_id: itemId,
        action,
        field_name: c.field_name,
        old_value: c.old_value,
        new_value: c.new_value,
      }))
    : [{ org_id: orgId, item_id: itemId, action, field_name: null, old_value: null, new_value: null }];

  const { error } = await supabase.from("item_change_logs").insert(rows);
  if (error) console.warn("写入变更日志失败：", error.message);
}

/** 获取物资变更日志 */
export async function fetchItemChangeLogs(itemId: string): Promise<ItemChangeLog[]> {
  const { data, error } = await supabase
    .from("item_change_logs")
    .select("*")
    .eq("item_id", itemId)
    .order("changed_at", { ascending: false })
    .limit(50);

  if (error) throw new Error("加载变更日志失败：" + error.message);
  return (data ?? []) as ItemChangeLog[];
}

// ─── AI 录入日志 ───

/** 创建 AI 录入日志 */
export async function createIntakeLog(
  orgId: string,
  rawInput: string,
  parsedResult: any,
  inputType: "voice" | "text"
): Promise<string> {
  const { data, error } = await supabase
    .from("intake_logs")
    .insert({
      org_id: orgId,
      raw_input: rawInput,
      parsed_result: parsedResult,
      input_type: inputType,
      status: "parsed",
    })
    .select("id")
    .single();

  if (error) throw new Error("保存录入日志失败：" + error.message);
  return data.id;
}

/** 更新录入日志状态（确认后关联 item_id） */
export async function confirmIntakeLog(
  logId: string,
  itemId: string
): Promise<void> {
  const { error } = await supabase
    .from("intake_logs")
    .update({ item_id: itemId, status: "confirmed" })
    .eq("id", logId);

  if (error) console.warn("更新录入日志失败：", error.message);
}

// ─── 变更对比辅助 ───

/** 比较旧值和新值，返回差异字段列表 */
export function diffItemFields(
  oldItem: Record<string, any>,
  newItem: Record<string, any>,
  fields: string[]
): { field_name: string; old_value: string | null; new_value: string | null }[] {
  const changes: { field_name: string; old_value: string | null; new_value: string | null }[] = [];
  for (const f of fields) {
    const ov = oldItem[f] ?? null;
    const nv = newItem[f] ?? null;
    const ovStr = ov === null ? null : String(ov);
    const nvStr = nv === null ? null : String(nv);
    if (ovStr !== nvStr) {
      changes.push({ field_name: f, old_value: ovStr, new_value: nvStr });
    }
  }
  return changes;
}

// ─── 单位管理 ───

/** 获取单位列表（仅启用，用于表单下拉） */
export async function fetchInventoryUnits(orgId: string): Promise<InventoryUnit[]> {
  const { data, error } = await supabase
    .from("inventory_units")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error("加载单位列表失败：" + error.message);
  return (data ?? []) as InventoryUnit[];
}

/** 获取所有单位（含停用，用于设置页） */
export async function fetchAllInventoryUnits(orgId: string): Promise<InventoryUnit[]> {
  const { data, error } = await supabase
    .from("inventory_units")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error("加载单位列表失败：" + error.message);
  return (data ?? []) as InventoryUnit[];
}

/** 创建单位，返回新 ID */
export async function createInventoryUnit(orgId: string, name: string): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_units")
    .insert({ org_id: orgId, name, sort_order: 0 })
    .select("id")
    .single();
  if (error) throw new Error("创建单位失败：" + error.message);
  return data.id;
}

/** 删除单位 */
export async function deleteInventoryUnit(id: string): Promise<void> {
  const { error } = await supabase.from("inventory_units").delete().eq("id", id);
  if (error) throw new Error("删除单位失败：" + error.message);
}

/** 切换单位启用状态 */
export async function toggleInventoryUnit(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("inventory_units")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) throw new Error("更新单位状态失败：" + error.message);
}

// ─── 学习会话记录 ───

export type LearnStats = {
  zh_sessions: number;  // 中文学习次数
  zh_seconds: number;   // 中文学习总秒数
  en_sessions: number;  // 英文学习次数
  en_seconds: number;   // 英文学习总秒数
};

/**
 * 记录一次 ≥90 秒的学习会话（朗读或小胖对话）。
 * 静默失败（仅 console.error），不阻断主流程。
 */
export async function logLearnSession(params: {
  orgId: string;
  itemId: string;
  userId: string;
  language: "zh" | "en";
  sessionType: "read" | "chat";
  durationSeconds: number;
}): Promise<void> {
  const { error } = await supabase.from("item_learn_logs").insert({
    org_id: params.orgId,
    item_id: params.itemId,
    user_id: params.userId,
    language: params.language,
    session_type: params.sessionType,
    duration_seconds: params.durationSeconds,
  });
  if (error) console.error("logLearnSession error:", error.message);
}

/**
 * 拉取组织内所有物资的学习统计（按 item_id 聚合）。
 * 返回 Map<itemId, LearnStats>；无记录的 item 不出现在 Map 中。
 */
export async function fetchLearnStatsByOrg(orgId: string): Promise<Map<string, LearnStats>> {
  const { data, error } = await supabase
    .from("item_learn_logs")
    .select("item_id, language, duration_seconds")
    .eq("org_id", orgId);

  const map = new Map<string, LearnStats>();
  if (error || !data) return map;

  for (const row of data) {
    const s = map.get(row.item_id) ?? { zh_sessions: 0, zh_seconds: 0, en_sessions: 0, en_seconds: 0 };
    if (row.language === "zh") {
      s.zh_sessions += 1;
      s.zh_seconds += row.duration_seconds;
    } else {
      s.en_sessions += 1;
      s.en_seconds += row.duration_seconds;
    }
    map.set(row.item_id, s);
  }
  return map;
}

/** 格式化学习时长（秒 → 显示文字） */
export function fmtLearnTime(seconds: number): string {
  if (seconds <= 0) return "0分";
  if (seconds < 60) return "< 1分";
  const mins = Math.round(seconds / 60);
  return `${mins}分`;
}

