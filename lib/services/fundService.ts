import { supabase } from "../supabaseClient";

// -------------------------------------------------------
// 类型定义
// -------------------------------------------------------
export type FundType = "mission" | "social_care" | "city" | "jh_operations";

export const FUND_LABELS: Record<FundType, string> = {
  mission: "宣教基金",
  social_care: "社会关怀基金",
  city: "城市基金",
  jh_operations: "JH运营",
};

export const FUND_RATIOS: Record<FundType, number> = {
  mission: 0.5,
  social_care: 0.2,
  city: 0.2,
  jh_operations: 0.1,
};

export const ALL_FUND_TYPES: FundType[] = [
  "mission",
  "social_care",
  "city",
  "jh_operations",
];

export type AllocationTypeName =
  | "opening_balance"
  | "semi_annual"
  | "adjustment";

export const ALLOCATION_TYPE_LABELS: Record<AllocationTypeName, string> = {
  opening_balance: "期初余额",
  semi_annual: "半年划拨",
  adjustment: "手动调整",
};

export type FundAllocation = {
  id: string;
  org_id: string;
  allocation_group: string;
  fund_type: FundType;
  amount: number; // 单位：分
  allocation_date: string; // YYYY-MM-DD
  allocation_type: AllocationTypeName;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** 每个基金的余额摘要 */
export type FundBalanceSummary = {
  fund_type: FundType;
  total_allocated: number;  // 划拨合计（分）
  total_income: number;     // 期初日期后收入合计（分）；仅 jh_operations 为非零，其余基金始终为 0
  total_expense: number;    // 该基金下支出合计（分）
  balance: number;          // JH运营：total_allocated + total_income - total_expense
                            // 其他基金：total_allocated - total_expense
};

/** 划拨建议 */
export type AllocationSuggestion = {
  period_start: string;               // 建议计算期间起始日（日历半年起始）
  end_date: string;                   // 本次划拨截止日期
  total_income: number;               // 期间收入合计（分）
  jh_expense: number;                 // 期间JH运营支出（分）——从分配池扮除
  direct_fund_expense: number;        // 期间三基金直接支出（分）——不入JH池
  net_amount: number;                 // 划拨基数 = 收入 - JH支出（分）
  suggestions: Record<FundType, number>; // 各基金建议划拨金额（分）
};

// -------------------------------------------------------
// 读取划拨记录
// -------------------------------------------------------
export async function fetchFundAllocations(
  orgId: string
): Promise<FundAllocation[]> {
  const { data, error } = await supabase
    .from("fund_allocations")
    .select("*")
    .eq("org_id", orgId)
    .order("allocation_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error("读取划拨记录失败：" + error.message);
  return (data ?? []) as FundAllocation[];
}

// -------------------------------------------------------
// 获取最近一次划拨日期（用于建议计算的起始点）
// -------------------------------------------------------
export async function fetchLastAllocationDate(
  orgId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("fund_allocations")
    .select("allocation_date")
    .eq("org_id", orgId)
    .order("allocation_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("读取最近划拨日期失败：" + error.message);
  return data?.allocation_date ?? null;
}

// -------------------------------------------------------
// 根据划拨日期自动确定半年起始日（不依赖日历划拨记录）
// 规则：endDate 在 1-6 月 → 起始日为当年1月1日
//        endDate 在 7-12 月 → 起始日为当年7月1日
// -------------------------------------------------------
export function getHalfYearPeriodStart(endDate: string): string {
  // endDate 格式 YYYY-MM-DD
  const [yearStr, monthStr] = endDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month <= 6) {
    // H1：Jan 1 → Jun 30
    return `${year}-01-01`;
  } else {
    // H2：Jul 1 → Dec 31
    return `${year}-07-01`;
  }
}

// -------------------------------------------------------
// 计算某段时间内的JH运营净收入，用于划拨建议基数
//
// 业务规则：
//   分配基数 = 全部收入 − JH运营支出(fund_type='jh_operations')
//   三个基金的直接支出不进入JH池，不影响划拨基数
//
// startDate、endDate 均为 inclusive
// -------------------------------------------------------
export async function fetchNetBetween(
  orgId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalIncome: number;
  jhExpense: number;          // JH运营支出（从分配基数扮除）
  directFundExpense: number;  // 三基金直接支出（不入JH池）
  net: number;                // = totalIncome - jhExpense
}> {
  // 收入：所有收入流水（收入类别 fund_type = NULL）
  const { data: incomeData, error: incomeErr } = await supabase
    .from("transactions")
    .select("amount")
    .eq("org_id", orgId)
    .eq("direction", "income")
    .gte("date", startDate)
    .lte("date", endDate);

  if (incomeErr) throw new Error("查询期间收入失败：" + incomeErr.message);

  // 支出：关联 categories 以区分 JH运营 vs 三基金直接支出
  const { data: expData, error: expErr } = await supabase
    .from("transactions")
    .select("amount, categories!inner(fund_type)")
    .eq("org_id", orgId)
    .eq("direction", "expense")
    .gte("date", startDate)
    .lte("date", endDate);

  if (expErr) throw new Error("查询期间支出失败：" + expErr.message);

  const totalIncome = (incomeData ?? []).reduce(
    (sum, row) => sum + (Number(row.amount) || 0), 0
  );

  let jhExpense = 0;
  let directFundExpense = 0;
  for (const row of expData ?? []) {
    const amt = Number(row.amount) || 0;
    const cat = (row.categories as unknown) as { fund_type: string | null };
    if (cat?.fund_type === "jh_operations") {
      jhExpense += amt;
    } else if (cat?.fund_type) {
      // mission / social_care / city 直接支出
      directFundExpense += amt;
    }
  }

  return {
    totalIncome,
    jhExpense,
    directFundExpense,
    net: totalIncome - jhExpense, // 划拨基数不扮除三基金直接支出
  };
}

// -------------------------------------------------------
// 生成划拨建议
// 期间起始日由日历自动确定（H1=Jan 1, H2=Jul 1）
// 与是否有期初余额记录无关，不会重复计算
// -------------------------------------------------------
export async function fetchAllocationSuggestion(
  orgId: string,
  endDate: string
): Promise<AllocationSuggestion> {
  // 期间起始日：纯日历规则，不依赖历史划拨记录
  const periodStart = getHalfYearPeriodStart(endDate);

  const result = await fetchNetBetween(orgId, periodStart, endDate);

  // 划拨基数 = 收入 - JH运营支出（三基金直接支出不入池）
  const positiveNet = Math.max(0, result.net); // 净余额为负时建议为0

  const suggestions: Record<FundType, number> = {
    mission: Math.round(positiveNet * FUND_RATIOS.mission),
    social_care: Math.round(positiveNet * FUND_RATIOS.social_care),
    city: Math.round(positiveNet * FUND_RATIOS.city),
    jh_operations: Math.round(positiveNet * FUND_RATIOS.jh_operations),
  };

  return {
    period_start: periodStart,
    end_date: endDate,
    total_income: result.totalIncome,
    jh_expense: result.jhExpense,
    direct_fund_expense: result.directFundExpense,
    net_amount: result.net,
    suggestions,
  };
}

// -------------------------------------------------------
// 计算各基金余额
// 业务规则：只扮减期初余额日期（最早 opening_balance 日期）当天及之后的支出
// 因为期初余额已经考虑了厂史支出情况
// -------------------------------------------------------
export async function fetchFundBalances(
  orgId: string
): Promise<FundBalanceSummary[]> {
  // 0. 查询期初余额的最早日期（支出只扮减该日期当天及之后的）
  const { data: openingData, error: openingErr } = await supabase
    .from("fund_allocations")
    .select("allocation_date")
    .eq("org_id", orgId)
    .eq("allocation_type", "opening_balance")
    .order("allocation_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (openingErr) throw new Error("读取期初日期失败：" + openingErr.message);

  // 如果有期初余额记录，则仅计算其日期当天及之后的支出
  const expenseCutoff: string | null = openingData?.allocation_date ?? null;

  // 1. 读取所有划拨记录，按基金聚合
  const { data: allocData, error: allocErr } = await supabase
    .from("fund_allocations")
    .select("fund_type, amount")
    .eq("org_id", orgId);

  if (allocErr) throw new Error("读取划拨数据失败：" + allocErr.message);

  // 2. 读取支出，关联 category 的 fund_type，只计算期初日期之后的
  let txQuery = supabase
    .from("transactions")
    .select("amount, categories!inner(fund_type)")
    .eq("org_id", orgId)
    .eq("direction", "expense")
    .not("categories.fund_type", "is", null);

  if (expenseCutoff) {
    txQuery = txQuery.gte("date", expenseCutoff);
  }

  const { data: txData, error: txErr } = await txQuery;
  if (txErr) throw new Error("读取支出数据失败：" + txErr.message);

  // 3. 查询期初日期后的全部收入（用于 JH运萧余额计算）
  // 业务规则：收入均流入 JH运萧，半年划拨时再按比例分配给各基金。未分配前收入应属于 JH运萧余额的一部分。
  let incomeQuery = supabase
    .from("transactions")
    .select("amount")
    .eq("org_id", orgId)
    .eq("direction", "income");

  if (expenseCutoff) {
    incomeQuery = incomeQuery.gte("date", expenseCutoff);
  }

  const { data: incomeData, error: incomeErr } = await incomeQuery;
  if (incomeErr) throw new Error("读取收入数据失败：" + incomeErr.message);

  const totalIncomeSinceOpening = (incomeData ?? []).reduce(
    (sum, row) => sum + (Number(row.amount) || 0), 0
  );

  // 4. 聚合
  const totalAllocated: Record<string, number> = {};
  const totalExpense: Record<string, number> = {};

  for (const ft of ALL_FUND_TYPES) {
    totalAllocated[ft] = 0;
    totalExpense[ft] = 0;
  }

  for (const row of allocData ?? []) {
    if (row.fund_type in totalAllocated) {
      totalAllocated[row.fund_type] += Number(row.amount) ?? 0;
    }
  }

  for (const row of txData ?? []) {
    const cat = (row.categories as unknown) as { fund_type: string | null };
    const ft = cat?.fund_type as string | null;
    if (ft && ft in totalExpense) {
      totalExpense[ft] += Number(row.amount) ?? 0;
    }
  }

  return ALL_FUND_TYPES.map((ft) => {
    const allocated = totalAllocated[ft];
    const expense = totalExpense[ft];
    // JH运萧：余额包含期初日期后的全部收入（未分配部分属于 JH池）
    const income = ft === "jh_operations" ? totalIncomeSinceOpening : 0;
    return {
      fund_type: ft,
      total_allocated: allocated,
      total_income: income,
      total_expense: expense,
      balance: ft === "jh_operations"
        ? allocated + income - expense
        : allocated - expense,
    };
  });
}

// -------------------------------------------------------
// 批量录入一次划拨（产生 4 条记录，共用同一个 allocation_group）
// -------------------------------------------------------
export async function createAllocationBatch(
  orgId: string,
  allocationDate: string,
  allocationType: AllocationTypeName,
  amounts: Record<FundType, number>,  // 单位：分
  note: string,
  createdBy: string
): Promise<void> {
  const groupId = crypto.randomUUID();

  const rows = ALL_FUND_TYPES.map((ft) => ({
    org_id: orgId,
    allocation_group: groupId,
    fund_type: ft,
    amount: amounts[ft],
    allocation_date: allocationDate,
    allocation_type: allocationType,
    note: note || null,
    created_by: createdBy,
  }));

  const { error } = await supabase.from("fund_allocations").insert(rows);
  if (error) throw new Error("录入划拨失败：" + error.message);
}

// -------------------------------------------------------
// 删除一次划拨（按 allocation_group 删除同批次所有记录）
// -------------------------------------------------------
export async function deleteAllocationGroup(
  orgId: string,
  allocationGroup: string
): Promise<void> {
  const { error } = await supabase
    .from("fund_allocations")
    .delete()
    .eq("org_id", orgId)
    .eq("allocation_group", allocationGroup);

  if (error) throw new Error("删除划拨失败：" + error.message);
}

// -------------------------------------------------------
// 更新 category 的 fund_type 归属
// -------------------------------------------------------
export async function updateCategoryFundType(
  categoryId: string,
  orgId: string,
  fundType: FundType | null
): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ fund_type: fundType })
    .eq("id", categoryId)
    .eq("org_id", orgId);

  if (error) throw new Error("更新类别归属失败：" + error.message);
}

// -------------------------------------------------------
// 资金存放位置（fund_location_slots）
// -------------------------------------------------------

export type LocationSlot = {
  slot_number: 1 | 2 | 3;
  label: string;  // 位置名称
  amount: number; // 单位：分
};

/** 读取组织的 3 个存放位置 */
export async function fetchLocationSlots(
  orgId: string
): Promise<LocationSlot[]> {
  const { data, error } = await supabase
    .from("fund_location_slots")
    .select("slot_number, label, amount")
    .eq("org_id", orgId)
    .order("slot_number", { ascending: true });

  if (error) throw new Error("读取资金位置失败：" + error.message);

  // 确保返回 3 条，缺失的用空默认值补全
  const map = new Map<number, LocationSlot>();
  for (const row of data ?? []) {
    map.set(row.slot_number, {
      slot_number: row.slot_number as 1 | 2 | 3,
      label: row.label ?? "",
      amount: Number(row.amount) || 0,
    });
  }
  return ([1, 2, 3] as const).map((n) =>
    map.get(n) ?? { slot_number: n, label: "", amount: 0 }
  );
}

/** 保存（upsert）3 个存放位置 */
export async function upsertLocationSlots(
  orgId: string,
  slots: LocationSlot[],
  updatedBy: string
): Promise<void> {
  const rows = slots.map((s) => ({
    org_id: orgId,
    slot_number: s.slot_number,
    label: s.label,
    amount: s.amount,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("fund_location_slots")
    .upsert(rows, { onConflict: "org_id,slot_number" });

  if (error) throw new Error("保存资金位置失败：" + error.message);
}
