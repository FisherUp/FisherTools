import { supabase } from "../supabaseClient";
import type { FridgeItem, FridgeItemInput, FridgeProfile, FridgeRole } from "../fridge";

export * from "../fridge";

const WRITE_ROLES: FridgeRole[] = ["admin", "finance", "inventory-edit", "learner"];

export function canEditFridge(role: FridgeRole): boolean {
  return WRITE_ROLES.includes(role);
}

export async function getFridgeProfile(): Promise<FridgeProfile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!userData.user) throw new Error("未登录，请先登录。");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", userData.user.id)
    .single();

  if (profileError) throw new Error("读取用户权限失败：" + profileError.message);
  if (!profile?.org_id) throw new Error("当前用户尚未关联组织。");

  return {
    userId: userData.user.id,
    orgId: String(profile.org_id),
    role: (profile.role ?? "") as FridgeRole,
  };
}

export async function listFridgeItems(orgId: string): Promise<FridgeItem[]> {
  const { data, error } = await supabase
    .from("fridge_items")
    .select("*")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .eq("status", "available")
    .gt("quantity", 0)
    .order("expiry_date", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) throw new Error("读取冰箱食材失败：" + error.message);
  return (data ?? []).map(toFridgeItem);
}

export async function createFridgeItems(
  orgId: string,
  items: FridgeItemInput[]
): Promise<FridgeItem[]> {
  if (items.length === 0) return [];
  if (items.length > 30) throw new Error("单次最多确认 30 条食材。");

  const rows = items.map((item) => ({
    org_id: orgId,
    name: item.name.trim(),
    category: item.category,
    quantity: Number(item.quantity),
    unit: item.unit.trim(),
    purchase_date: item.purchase_date,
    expiry_date: item.expiry_date,
    storage_location: item.storage_location,
    opened: Boolean(item.opened),
    notes: item.notes?.trim() || null,
  }));

  const { data, error } = await supabase.from("fridge_items").insert(rows).select("*");
  if (error) throw new Error("保存食材失败：" + error.message);
  return (data ?? []).map(toFridgeItem);
}

export async function updateFridgeItem(
  orgId: string,
  id: string,
  input: FridgeItemInput
): Promise<FridgeItem> {
  const { data, error } = await supabase
    .from("fridge_items")
    .update({
      name: input.name.trim(),
      category: input.category,
      quantity: Number(input.quantity),
      unit: input.unit.trim(),
      purchase_date: input.purchase_date,
      expiry_date: input.expiry_date,
      storage_location: input.storage_location,
      opened: Boolean(input.opened),
      notes: input.notes?.trim() || null,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .select("*")
    .single();

  if (error) throw new Error("更新食材失败：" + error.message);
  return toFridgeItem(data);
}

export async function consumeFridgeItem(id: string, quantity: number): Promise<void> {
  const { error } = await supabase.rpc("consume_fridge_item", {
    p_item_id: id,
    p_quantity: quantity,
  });
  if (error) throw new Error("记录消耗失败：" + error.message);
}

export async function discardFridgeItem(orgId: string, id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("fridge_items")
    .update({ status: "discarded", deleted_at: now })
    .eq("id", id)
    .eq("org_id", orgId)
    .is("deleted_at", null);
  if (error) throw new Error("移除食材失败：" + error.message);
}

function toFridgeItem(row: Record<string, unknown>): FridgeItem {
  return {
    ...(row as unknown as FridgeItem),
    quantity: Number(row.quantity ?? 0),
    opened: Boolean(row.opened),
  };
}
