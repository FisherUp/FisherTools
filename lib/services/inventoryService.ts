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
  owner_id: string;
  quantity: number;
  location: string | null;
  status: string;
  notes: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type InventoryCategory = {
  id: string;
  org_id: string;
  name: string;
  value: string;
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

/** 创建物资，返回新 ID */
export async function createInventoryItem(
  item: Pick<InventoryItem, "org_id" | "name" | "category" | "owner_id" | "quantity" | "location" | "status" | "notes">
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
  updates: Partial<Pick<InventoryItem, "name" | "category" | "owner_id" | "quantity" | "location" | "status" | "notes" | "image_path">>
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

/** 上传图片到 inventory-images bucket，返回 storage path */
export async function uploadInventoryImage(
  orgId: string,
  itemId: string,
  file: File
): Promise<string> {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`文件 ${file.name} 超过 10MB（${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后再上传`);
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${orgId}/${itemId}/${Date.now()}_${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    upsert: false,
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

/** 批量生成 signed URL（用于列表页缩略图） */
export async function batchGetSignedUrls(
  paths: (string | null)[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const validPaths = Array.from(new Set(paths.filter(Boolean) as string[]));
  if (validPaths.length === 0) return map;

  const results = await Promise.allSettled(
    validPaths.map(async (p) => {
      const url = await getSignedUrl(p);
      return { path: p, url };
    })
  );

  for (const r of results) {
    if (r.status === "fulfilled" && r.value.url) {
      map.set(r.value.path, r.value.url);
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
    .select("*")
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
    .select("*")
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

/** 创建类别（value 自动使用 name） */
export async function createInventoryCategory(
  orgId: string,
  name: string,
  sortOrder: number = 0
): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_categories")
    .insert({ org_id: orgId, name, value: name, sort_order: sortOrder })
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
