import { supabase } from "../supabaseClient";

// ─── 类型 ───

export type LeaveRequest = {
  id: string;
  org_id: string;
  requester_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type LeaveQuota = {
  id: string;
  org_id: string;
  user_id: string;
  year: number;
  annual_days: number;
  sabbatical_days: number;
  sick_days: number;
  special_days: number;
};

export type LeaveBalance = {
  leave_type: string;
  quota: number | null; // null = 无额度限制（事假）
  used: number;
  remaining: number | null;
};

export type OrgProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string;
};

// ─── 常量 ───

export const LEAVE_TYPES = [
  { value: "annual", label: "年假" },
  { value: "personal", label: "事假" },
  { value: "sabbatical", label: "安息假" },
  { value: "sick", label: "病假" },
  { value: "special", label: "特殊假" },
] as const;

export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ─── 组织用户 ───

/** 获取组织内所有登录用户（用于额度设置和显示名） */
export async function fetchOrgProfiles(orgId: string): Promise<OrgProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, role")
    .eq("org_id", orgId)
    .order("display_name", { ascending: true });

  if (error) throw new Error("加载用户列表失败：" + error.message);
  return (data ?? []) as OrgProfile[];
}

// ─── 假期额度 ───

/** 获取某年所有人的额度 */
export async function fetchLeaveQuotas(orgId: string, year: number): Promise<LeaveQuota[]> {
  const { data, error } = await supabase
    .from("leave_quotas")
    .select("*")
    .eq("org_id", orgId)
    .eq("year", year);

  if (error) throw new Error("加载假期额度失败：" + error.message);
  return (data ?? []) as LeaveQuota[];
}

/** 设置/更新某人某年额度（upsert） */
export async function upsertLeaveQuota(
  orgId: string,
  userId: string,
  year: number,
  quotas: {
    annual_days: number;
    sabbatical_days: number;
    sick_days: number;
    special_days: number;
  }
): Promise<void> {
  const { error } = await supabase
    .from("leave_quotas")
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        year,
        ...quotas,
      },
      { onConflict: "org_id,user_id,year" }
    );

  if (error) throw new Error("保存假期额度失败：" + error.message);
}

// ─── 休假申请 ───

/** 获取休假申请列表 */
export async function fetchLeaveRequests(
  orgId: string,
  filters?: {
    status?: string;
    leave_type?: string;
    year?: number;
  }
): Promise<LeaveRequest[]> {
  let query = supabase
    .from("leave_requests")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.leave_type) {
    query = query.eq("leave_type", filters.leave_type);
  }
  if (filters?.year) {
    query = query
      .gte("start_date", `${filters.year}-01-01`)
      .lte("start_date", `${filters.year}-12-31`);
  }

  const { data, error } = await query;
  if (error) throw new Error("加载休假申请失败：" + error.message);
  return (data ?? []) as LeaveRequest[];
}

/** 提交休假申请 */
export async function createLeaveRequest(
  orgId: string,
  requesterId: string,
  data: {
    leave_type: string;
    start_date: string;
    end_date: string;
    days: number;
    reason?: string;
  }
): Promise<string> {
  const { data: result, error } = await supabase
    .from("leave_requests")
    .insert({
      org_id: orgId,
      requester_id: requesterId,
      leave_type: data.leave_type,
      start_date: data.start_date,
      end_date: data.end_date,
      days: data.days,
      reason: data.reason || null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) throw new Error("提交休假申请失败：" + error.message);
  return result.id;
}

/** 审批通过 */
export async function approveLeaveRequest(
  id: string,
  reviewerId: string,
  note?: string
): Promise<void> {
  // 先检查：不能自审批，且必须是 pending 状态
  const { data: req, error: fetchErr } = await supabase
    .from("leave_requests")
    .select("requester_id, status")
    .eq("id", id)
    .single();

  if (fetchErr) throw new Error("查询申请失败：" + fetchErr.message);
  if (!req) throw new Error("申请不存在");
  if (req.status !== "pending") throw new Error("该申请已处理，无法再次审批");
  if (req.requester_id === reviewerId) throw new Error("不能审批自己的申请");

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status: "approved",
      reviewer_id: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: note || null,
    })
    .eq("id", id);

  if (error) throw new Error("审批失败：" + error.message);
}

/** 驳回 */
export async function rejectLeaveRequest(
  id: string,
  reviewerId: string,
  note: string
): Promise<void> {
  // 先检查
  const { data: req, error: fetchErr } = await supabase
    .from("leave_requests")
    .select("requester_id, status")
    .eq("id", id)
    .single();

  if (fetchErr) throw new Error("查询申请失败：" + fetchErr.message);
  if (!req) throw new Error("申请不存在");
  if (req.status !== "pending") throw new Error("该申请已处理，无法再次审批");
  if (req.requester_id === reviewerId) throw new Error("不能审批自己的申请");

  const { error } = await supabase
    .from("leave_requests")
    .update({
      status: "rejected",
      reviewer_id: reviewerId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", id);

  if (error) throw new Error("驳回失败：" + error.message);
}

/** 申请人取消自己的 pending 申请 */
export async function cancelLeaveRequest(
  id: string,
  requesterId: string
): Promise<void> {
  const { data: req, error: fetchErr } = await supabase
    .from("leave_requests")
    .select("requester_id, status")
    .eq("id", id)
    .single();

  if (fetchErr) throw new Error("查询申请失败：" + fetchErr.message);
  if (!req) throw new Error("申请不存在");
  if (req.status !== "pending") throw new Error("只能取消待审批的申请");
  if (req.requester_id !== requesterId) throw new Error("只能取消自己的申请");

  const { error } = await supabase
    .from("leave_requests")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw new Error("取消失败：" + error.message);
}

/** 计算某人某年各类型已用/剩余天数 */
export async function fetchLeaveBalance(
  orgId: string,
  userId: string,
  year: number
): Promise<LeaveBalance[]> {
  // 获取额度
  const { data: quotaData } = await supabase
    .from("leave_quotas")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("year", year)
    .maybeSingle();

  const quota = quotaData as LeaveQuota | null;

  // 获取已批准的休假天数
  const { data: requests, error } = await supabase
    .from("leave_requests")
    .select("leave_type, days")
    .eq("org_id", orgId)
    .eq("requester_id", userId)
    .eq("status", "approved")
    .gte("start_date", `${year}-01-01`)
    .lte("start_date", `${year}-12-31`);

  if (error) throw new Error("计算余额失败：" + error.message);

  // 按类型汇总已用天数
  const usedMap: Record<string, number> = {};
  (requests ?? []).forEach((r: any) => {
    usedMap[r.leave_type] = (usedMap[r.leave_type] || 0) + Number(r.days);
  });

  const quotaMap: Record<string, number | null> = {
    annual: quota?.annual_days ?? 0,
    personal: null, // 事假无额度
    sabbatical: quota?.sabbatical_days ?? 0,
    sick: quota?.sick_days ?? 0,
    special: quota?.special_days ?? 0,
  };

  return LEAVE_TYPES.map((t) => {
    const used = usedMap[t.value] || 0;
    const q = quotaMap[t.value];
    return {
      leave_type: t.value,
      quota: q,
      used,
      remaining: q !== null ? q - used : null,
    };
  });
}
