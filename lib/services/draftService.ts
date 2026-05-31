import { supabase } from "../supabaseClient";

// -------------------------------------------------------
// 草稿收支流水（Draft Transactions）服务层
// -------------------------------------------------------

export type DraftEntryType = "reimbursement" | "proxy";
export type DraftStatus = "pending" | "confirmed" | "transferred";
export type Direction = "income" | "expense";

/** 统一从未知错误对象提取可读信息 */
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return String(e);
}

export const ENTRY_TYPE_LABELS: Record<DraftEntryType, string> = {
  reimbursement: "待报销登记",
  proxy: "组织代办",
};

export const STATUS_LABELS: Record<DraftStatus, string> = {
  pending: "待处理",
  confirmed: "已确认",
  transferred: "已转移",
};

export type DraftTransaction = {
  id: string;
  org_id: string;
  entry_type: DraftEntryType;
  date: string; // yyyy-mm-dd
  amount: number; // 分
  direction: Direction;
  account_id: string | null;
  category_id: string | null;
  handler1_id: string | null;
  handler2_id: string | null;
  description: string | null;
  status: DraftStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  transferred_at: string | null;
  transferred_by: string | null;
  transaction_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  accounts?: { name: string; type: "cash" | "bank" } | null;
  categories?: { name: string } | null;
};

export type DraftInput = {
  entry_type: DraftEntryType;
  date: string;
  amount: number; // 分
  direction: Direction;
  account_id: string;
  category_id: string;
  handler1_id: string | null;
  handler2_id: string | null;
  description: string | null;
};

/** 读取当前用户 profile（org_id + role） */
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

/** 拉取草稿流水列表（同组织） */
export async function fetchDraftTransactions(orgId: string): Promise<DraftTransaction[]> {
  const { data, error } = await supabase
    .from("draft_transactions")
    .select(
      "id, org_id, entry_type, date, amount, direction, account_id, category_id, handler1_id, handler2_id, description, status, confirmed_at, confirmed_by, transferred_at, transferred_by, transaction_id, created_by, updated_by, created_at, updated_at, accounts(name,type), categories(name)"
    )
    .eq("org_id", orgId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error("加载草稿流水失败：" + error.message);
  return (data ?? []) as unknown as DraftTransaction[];
}

/** 读取单条草稿 */
export async function fetchDraftById(id: string): Promise<DraftTransaction | null> {
  const { data, error } = await supabase
    .from("draft_transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error("读取草稿失败：" + error.message);
  return (data ?? null) as unknown as DraftTransaction | null;
}

/** 新增草稿 */
export async function createDraft(orgId: string, input: DraftInput): Promise<void> {
  const { error } = await supabase.from("draft_transactions").insert({
    org_id: orgId,
    entry_type: input.entry_type,
    date: input.date,
    amount: input.amount,
    direction: input.direction,
    account_id: input.account_id,
    category_id: input.category_id,
    handler1_id: input.handler1_id,
    handler2_id: input.handler2_id,
    description: input.description,
    status: "pending",
  });
  if (error) throw new Error("保存草稿失败：" + error.message);
}

/** 更新草稿（仅 pending 可改，锁定由数据库触发器兜底） */
export async function updateDraft(id: string, input: DraftInput): Promise<void> {
  const { error } = await supabase
    .from("draft_transactions")
    .update({
      entry_type: input.entry_type,
      date: input.date,
      amount: input.amount,
      direction: input.direction,
      account_id: input.account_id,
      category_id: input.category_id,
      handler1_id: input.handler1_id,
      handler2_id: input.handler2_id,
      description: input.description,
    })
    .eq("id", id);
  if (error) throw new Error("更新草稿失败：" + error.message);
}

/** 删除草稿（仅 pending） */
export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from("draft_transactions").delete().eq("id", id);
  if (error) throw new Error("删除草稿失败：" + error.message);
}

/** 确认组织代办账目（admin）：锁定保留，不进报表 */
export async function confirmProxyDraft(draft: DraftTransaction, userId: string): Promise<void> {
  const { error } = await supabase
    .from("draft_transactions")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
    })
    .eq("id", draft.id)
    .eq("status", "pending");
  if (error) throw new Error("确认失败：" + error.message);
}

/**
 * 转移待报销草稿至正式流水（admin）：
 *   1) 复制核心字段写入 transactions
 *   2) 标记草稿 status=transferred，并回链 transaction_id
 */
export async function transferDraftToTransaction(
  draft: DraftTransaction,
  orgId: string,
  userId: string
): Promise<void> {
  if (!draft.account_id || !draft.category_id) {
    throw new Error("草稿缺少账户或类别，无法转移，请先补全。");
  }

  const { data: inserted, error: insErr } = await supabase
    .from("transactions")
    .insert({
      org_id: orgId,
      date: draft.date,
      amount: draft.amount,
      direction: draft.direction,
      account_id: draft.account_id,
      category_id: draft.category_id,
      description: draft.description,
      handler1_id: draft.handler1_id,
      handler2_id: draft.handler2_id,
    })
    .select("id")
    .single();

  if (insErr) throw new Error("生成正式流水失败：" + insErr.message);
  const newTxId = inserted?.id as string | undefined;

  const { error: updErr } = await supabase
    .from("draft_transactions")
    .update({
      status: "transferred",
      transferred_at: new Date().toISOString(),
      transferred_by: userId,
      transaction_id: newTxId ?? null,
    })
    .eq("id", draft.id)
    .eq("status", "pending");

  if (updErr) {
    // 正式流水已生成但草稿标记失败：提示人工核对，避免静默重复转移
    throw new Error(
      "正式流水已生成，但草稿状态更新失败，请刷新核对，避免重复转移：" + updErr.message
    );
  }
}
