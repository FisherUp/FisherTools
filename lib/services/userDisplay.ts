import { supabase } from "../supabaseClient";

export type UserDisplayMap = Map<string, string>;

function shortId(v: string) {
  return v.length > 8 ? `${v.slice(0, 8)}…` : v;
}

export function resolveUserDisplay(userId: string | null, map: UserDisplayMap) {
  if (!userId) return "-";
  return map.get(userId) ?? shortId(userId);
}

export async function fetchUserDisplayMap(userIds: string[], orgId: string): Promise<UserDisplayMap> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!orgId || ids.length === 0) return map;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email")
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    console.warn("加载用户显示名失败：", error.message);
    return map;
  }

  (data ?? []).forEach((p: any) => {
    const id = String(p.id);
    const displayName = String(p.display_name ?? "").trim();
    const email = String(p.email ?? "").trim();
    const label = displayName || email || shortId(id);
    map.set(id, label);
  });

  return map;
}
