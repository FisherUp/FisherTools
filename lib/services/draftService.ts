import { supabase } from "../supabaseClient";
import { uploadReceiptImageFile } from "./imageStorageService";

const RECEIPTS_BUCKET = "receipts";
const SIGNED_URL_TTL = 300;

/** 草稿附件在 Storage 中的二级目录前缀（与正式流水区分开） */
function draftFolder(draftId: string) {
  return `draft_${draftId}`;
}

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

export type DraftAttachment = {
  id: string;
  storage_path: string;
  signed_url: string;
  created_at: string | null;
};

/** 新增草稿，返回新草稿 id（便于随后挂附件） */
export async function createDraft(orgId: string, input: DraftInput): Promise<string> {
  const { data, error } = await supabase
    .from("draft_transactions")
    .insert({
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
    })
    .select("id")
    .single();

  if (error) throw new Error("保存草稿失败：" + error.message);
  return String(data?.id ?? "");
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

  // ✅ 票据附件同步迁移：Storage 文件不动，只把归属改到新流水上
  if (newTxId) {
    const { error: attErr } = await supabase
      .from("attachments")
      .update({ transaction_id: newTxId })
      .eq("draft_id", draft.id)
      .eq("org_id", orgId);
    if (attErr) {
      throw new Error(
        "正式流水已生成，但票据附件迁移失败，请人工核对：" + attErr.message
      );
    }
  }

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

/* ============================================================
   草稿票据附件
   附件统一存放在 attachments 表：草稿阶段 draft_id 有值、transaction_id 为空；
   转移为正式流水后由 transferDraftToTransaction 补上 transaction_id。
   ============================================================ */

/** 上传草稿票据（自动压缩），返回成功数与错误列表 */
export async function uploadDraftAttachments(
  orgId: string,
  draftId: string,
  files: File[]
): Promise<{ okCount: number; savedBytes: number; errors: string[] }> {
  let okCount = 0;
  let savedBytes = 0;
  const errors: string[] = [];

  for (const file of files) {
    let storagePath = "";
    try {
      const uploaded = await uploadReceiptImageFile(orgId, draftFolder(draftId), file);
      storagePath = uploaded.storagePath;
      savedBytes += Math.max(0, uploaded.originalBytes - uploaded.uploadedBytes);
    } catch (e) {
      errors.push(`${file.name}：${errMsg(e)}`);
      continue;
    }

    const { error: insErr } = await supabase.from("attachments").insert({
      org_id: orgId,
      draft_id: draftId,
      transaction_id: null,
      storage_path: storagePath,
      file_url: storagePath,
    });

    if (insErr) {
      // 写表失败就回滚 Storage 文件，避免产生孤儿文件
      await supabase.storage.from(RECEIPTS_BUCKET).remove([storagePath]);
      errors.push(`${file.name}：${insErr.message}`);
      continue;
    }
    okCount += 1;
  }

  return { okCount, savedBytes, errors };
}

/** 读取某条草稿的票据（含 5 分钟签名 URL） */
export async function fetchDraftAttachments(
  orgId: string,
  draftId: string
): Promise<DraftAttachment[]> {
  const { data, error } = await supabase
    .from("attachments")
    .select("id, storage_path, created_at")
    .eq("draft_id", draftId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("加载草稿票据失败：" + error.message);

  const result: DraftAttachment[] = [];
  const rows = (data ?? []) as { id: string; storage_path: string | null; created_at: string | null }[];
  for (const row of rows) {
    const path = String(row.storage_path ?? "");
    let signed = "";
    if (path) {
      const { data: s } = await supabase.storage
        .from(RECEIPTS_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      signed = s?.signedUrl ?? "";
    }
    result.push({
      id: String(row.id),
      storage_path: path,
      signed_url: signed,
      created_at: row.created_at ? String(row.created_at) : null,
    });
  }
  return result;
}

/** 删除一张草稿票据 */
export async function deleteDraftAttachment(orgId: string, attachmentId: string, storagePath: string) {
  if (storagePath) {
    const { error: stErr } = await supabase.storage.from(RECEIPTS_BUCKET).remove([storagePath]);
    if (stErr) throw new Error("删除 Storage 文件失败：" + stErr.message);
  }
  const { error } = await supabase
    .from("attachments")
    .delete()
    .eq("id", attachmentId)
    .eq("org_id", orgId);
  if (error) throw new Error("删除票据记录失败：" + error.message);
}

/** 批量统计草稿票据数量：draftId -> 张数 */
export async function fetchDraftAttachmentCounts(
  orgId: string,
  draftIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (draftIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("attachments")
    .select("draft_id")
    .eq("org_id", orgId)
    .in("draft_id", draftIds);

  if (error) {
    console.warn("加载草稿票据数量失败：", error.message);
    return counts;
  }

  for (const row of (data ?? []) as { draft_id: string | null }[]) {
    const k = String(row.draft_id ?? "");
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}
