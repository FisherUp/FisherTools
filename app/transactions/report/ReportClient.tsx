"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import {
  FUND_LABELS,
  type FundType,
  ALL_FUND_TYPES,
} from "../../../lib/services/fundService";

/* ---------- 类型 ---------- */
type CategoryRow = {
  id: string;
  name: string;
  fund_type: FundType | null;
  is_active: boolean;
};

type BudgetRow = {
  category_id: string;
  amount: number; // 分
  year: number;
  is_enabled: boolean;
};

type TxAgg = {
  category_id: string;
  direction: "income" | "expense";
  month: number; // 1-12
  total: number; // 分
};

type AllocationRow = {
  fund_type: FundType;
  amount: number; // 分
  allocation_date: string;
  allocation_type: string;
};

type TxDetail = {
  id: string;
  date: string;
  amount: number;
  direction: "income" | "expense";
  category_id: string;
  description: string | null;
  account_name: string;
};

/** 上年及以前（自期初日起）的流水，用于计算年初结转余额 */
type PriorTxRow = {
  amount: number;
  direction: "income" | "expense";
  category_id: string;
};

type PopupInfo = {
  categoryId: string | null; // null = income aggregate
  month: number;
  label: string;
  rect: { top: number; left: number };
};

/* ---------- 工具 ---------- */
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MIN_YEAR = 2026;

function fenToYuan(fen: number): string {
  if (fen === 0) return "";
  const y = fen / 100;
  return y % 1 === 0
    ? `¥${y.toLocaleString()}`
    : `¥${y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(used: number, budget: number): string {
  if (budget === 0) return "";
  return `${((used / budget) * 100).toFixed(1)}%`;
}

/* 基金显示顺序 */
const FUND_ORDER: FundType[] = ["jh_operations", "city", "social_care", "mission"];

/* ---------- 组件 ---------- */
export default function ReportClient() {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState("");

  /* 原始数据 */
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [txAgg, setTxAgg] = useState<TxAgg[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [txDetails, setTxDetails] = useState<TxDetail[]>([]);
  const [priorTx, setPriorTx] = useState<PriorTxRow[]>([]);

  /* 弹窗状态 */
  const [popup, setPopup] = useState<PopupInfo | null>(null);

  /* ---------- 数据加载 ---------- */
  const loadData = useCallback(async (yr: number) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();
      if (!profile) return;
      const oid = profile.org_id;
      setOrgId(oid);

      /* 并行查询 */
      const [catRes, budRes, txRes, allocRes, txDetailRes, acctRes] = await Promise.all([
        supabase.from("categories").select("id, name, fund_type, is_active").eq("org_id", oid),
        supabase.from("category_budgets").select("category_id, amount, year, is_enabled").eq("org_id", oid).eq("year", yr),
        supabase.from("transactions").select("category_id, direction, date, amount").eq("org_id", oid).gte("date", `${yr}-01-01`).lte("date", `${yr}-12-31`),
        supabase.from("fund_allocations").select("fund_type, amount, allocation_date, allocation_type").eq("org_id", oid),
        supabase.from("transactions").select("id, date, amount, direction, category_id, description, account_id").eq("org_id", oid).gte("date", `${yr}-01-01`).lte("date", `${yr}-12-31`),
        supabase.from("accounts").select("id, name").eq("org_id", oid),
      ]);

      setCategories((catRes.data ?? []) as CategoryRow[]);
      setBudgets((budRes.data ?? []) as BudgetRow[]);

      /* 聚合交易到月 */
      const agg: TxAgg[] = [];
      const map = new Map<string, number>();
      for (const tx of (txRes.data ?? []) as { category_id: string; direction: string; date: string; amount: number }[]) {
        const m = Number(tx.date.split("-")[1]);
        const key = `${tx.category_id}|${tx.direction}|${m}`;
        map.set(key, (map.get(key) ?? 0) + Number(tx.amount));
      }
      map.forEach((total, key) => {
        const [category_id, direction, month] = key.split("|");
        agg.push({ category_id, direction: direction as "income" | "expense", month: Number(month), total });
      });
      setTxAgg(agg);
      const allocRows = (allocRes.data ?? []) as AllocationRow[];
      setAllocations(allocRows);

      /* 期初日：最早一条 opening_balance 划拨的日期。
         期初余额已包含该日期之前的历史收支（如 2025-12 的流水），
         因此结转计算只能从期初日当天起算，否则会重复计算。*/
      const openDate =
        allocRows
          .filter((a) => a.allocation_type === "opening_balance")
          .map((a) => a.allocation_date)
          .sort()[0] ?? null;

      /* 上年及以前（期初日 ~ 上年末）的收支，用于年初结转余额 */
      let priorQuery = supabase
        .from("transactions")
        .select("amount, direction, category_id")
        .eq("org_id", oid)
        .lte("date", `${yr - 1}-12-31`);
      if (openDate) priorQuery = priorQuery.gte("date", openDate);
      const priorRes = await priorQuery;
      setPriorTx(
        ((priorRes.data ?? []) as { amount: number; direction: string; category_id: string }[]).map((t) => ({
          amount: Number(t.amount),
          direction: t.direction as "income" | "expense",
          category_id: t.category_id,
        }))
      );

      /* 交易明细（含账户名） */
      const acctMap = new Map<string, string>();
      for (const a of (acctRes.data ?? []) as { id: string; name: string }[]) {
        acctMap.set(a.id, a.name);
      }
      const details: TxDetail[] = ((txDetailRes.data ?? []) as {
        id: string; date: string; amount: number; direction: string;
        category_id: string; description: string | null; account_id: string;
      }[]).map((t) => ({
        id: t.id,
        date: t.date,
        amount: Number(t.amount),
        direction: t.direction as "income" | "expense",
        category_id: t.category_id,
        description: t.description,
        account_name: acctMap.get(t.account_id) ?? "",
      }));
      setTxDetails(details);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(year); }, [year, loadData]);

  /* ---------- 派生数据 ---------- */

  /* 预算 map: category_id → amount(分) */
  const budgetMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of budgets) {
      if (b.is_enabled) m.set(b.category_id, b.amount);
    }
    return m;
  }, [budgets]);

  /* 交易 map: `${category_id}|${month}` → total(分) */
  const txMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txAgg) {
      const key = `${t.category_id}|${t.month}`;
      m.set(key, (m.get(key) ?? 0) + t.total);
    }
    return m;
  }, [txAgg]);

  /* 收入类别 & 支出类别 */
  const incomeCategories = useMemo(
    () => categories.filter((c) => c.fund_type === null),
    [categories]
  );
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.fund_type !== null),
    [categories]
  );

  /* 按基金分组支出类别（仅包含当年有预算的类别） */
  const fundGroups = useMemo(() => {
    return FUND_ORDER.map((ft) => ({
      fundType: ft,
      label: FUND_LABELS[ft],
      cats: expenseCategories
        .filter((c) => c.fund_type === ft && budgetMap.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name, "zh")),
    })).filter((g) => g.cats.length > 0);
  }, [expenseCategories, budgetMap]);

  /* 类别 → 基金归属 */
  const catFundMap = useMemo(() => {
    const m = new Map<string, FundType | null>();
    for (const c of categories) m.set(c.id, c.fund_type);
    return m;
  }, [categories]);

  /* 上年及以前（自期初日起）的收入合计与各基金支出合计 */
  const priorAgg = useMemo(() => {
    let income = 0;
    const expense = new Map<FundType, number>();
    for (const ft of ALL_FUND_TYPES) expense.set(ft, 0);
    for (const t of priorTx) {
      if (t.direction === "income") {
        income += t.amount;
      } else {
        const ft = catFundMap.get(t.category_id);
        if (ft) expense.set(ft, (expense.get(ft) ?? 0) + t.amount);
      }
    }
    return { income, expense };
  }, [priorTx, catFundMap]);

  /* 本年各基金支出合计（含未设预算的类别，保证余额准确） */
  const yearExpenseByFund = useMemo(() => {
    const m = new Map<FundType, number>();
    for (const ft of ALL_FUND_TYPES) m.set(ft, 0);
    for (const t of txAgg) {
      if (t.direction !== "expense") continue;
      const ft = catFundMap.get(t.category_id);
      if (ft) m.set(ft, (m.get(ft) ?? 0) + t.total);
    }
    return m;
  }, [txAgg, catFundMap]);

  /* 截至某日期的划拨聚合。
     划拨是「运营管理池内部转账」：一次非期初划拨的整批金额全部从运营管理池划出，
     再按比例划入四个基金（运营管理自身那份即回流）。期初余额不属于转出。 */
  const aggAllocationsUpTo = useCallback(
    (upTo: string) => {
      const credited = new Map<FundType, number>();
      for (const ft of ALL_FUND_TYPES) credited.set(ft, 0);
      let jhOut = 0;
      for (const a of allocations) {
        if (a.allocation_date > upTo) continue;
        const amt = Number(a.amount);
        credited.set(a.fund_type, (credited.get(a.fund_type) ?? 0) + amt);
        if (a.allocation_type !== "opening_balance") jhOut += amt;
      }
      return { credited, jhOut };
    },
    [allocations]
  );

  /* 年初余额 = 上年末结转余额（期初 + 截至今年1月1日的划拨 + 期初后至上年末的收支） */
  const openingBalanceMap = useMemo(() => {
    const { credited, jhOut } = aggAllocationsUpTo(`${year}-01-01`);
    const m = new Map<FundType, number>();
    for (const ft of ALL_FUND_TYPES) {
      const isJh = ft === "jh_operations";
      const base = (credited.get(ft) ?? 0) - (isJh ? jhOut : 0);
      const income = isJh ? priorAgg.income : 0;
      m.set(ft, base + income - (priorAgg.expense.get(ft) ?? 0));
    }
    return m;
  }, [aggAllocationsUpTo, year, priorAgg]);

  /* 本年收入合计（全部进入运营管理资金池） */
  const yearIncomeTotal = useMemo(
    () => txAgg.reduce((s, t) => (t.direction === "income" ? s + t.total : s), 0),
    [txAgg]
  );

  /* 年末余额 = 年初余额 + 本年划拨净额 + 本年收入（仅运营管理）− 本年该基金支出 */
  const endingBalanceMap = useMemo(() => {
    const { credited, jhOut } = aggAllocationsUpTo(`${year}-12-31`);
    const m = new Map<FundType, number>();
    for (const ft of ALL_FUND_TYPES) {
      const isJh = ft === "jh_operations";
      const base = (credited.get(ft) ?? 0) - (isJh ? jhOut : 0);
      const income = isJh ? priorAgg.income + yearIncomeTotal : 0;
      const expense =
        (priorAgg.expense.get(ft) ?? 0) + (yearExpenseByFund.get(ft) ?? 0);
      m.set(ft, base + income - expense);
    }
    return m;
  }, [aggAllocationsUpTo, year, priorAgg, yearExpenseByFund, yearIncomeTotal]);

  /* 本年度的划拨批次（半年划拨 + 手动调整），按日期分组 */
  const transferBatches = useMemo(() => {
    const dateMap = new Map<
      string,
      { type: string; credited: Map<FundType, number>; batchTotal: number }
    >();
    for (const a of allocations) {
      if (a.allocation_type === "opening_balance") continue;
      if (a.allocation_date < `${year}-01-01` || a.allocation_date > `${year}-12-31`) continue;
      if (!dateMap.has(a.allocation_date)) {
        dateMap.set(a.allocation_date, {
          type: a.allocation_type,
          credited: new Map(),
          batchTotal: 0,
        });
      }
      const entry = dateMap.get(a.allocation_date)!;
      const amt = Number(a.amount);
      entry.credited.set(a.fund_type, (entry.credited.get(a.fund_type) ?? 0) + amt);
      entry.batchTotal += amt;
    }
    return Array.from(dateMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [allocations, year]);


  /* 收入月度汇总 */
  const incomeMonthly = useMemo(() => {
    const monthly: number[] = new Array(12).fill(0);
    for (const t of txAgg) {
      if (t.direction === "income") {
        monthly[t.month - 1] += t.total;
      }
    }
    return monthly;
  }, [txAgg]);

  /* 弹窗明细数据 */
  const popupDetails = useMemo(() => {
    if (!popup) return [];
    const m = popup.month;
    const mStr = String(m).padStart(2, "0");
    return txDetails
      .filter((t) => {
        const txMonth = t.date.split("-")[1];
        if (txMonth !== mStr) return false;
        if (popup.categoryId === null) return t.direction === "income";
        return t.category_id === popup.categoryId;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [popup, txDetails]);

  /* 点击金额单元格 */
  function handleCellClick(
    e: React.MouseEvent,
    categoryId: string | null,
    month: number,
    label: string,
  ) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopup({ categoryId, month, label, rect: { top: rect.bottom + window.scrollY, left: rect.left + window.scrollX } });
  }

  /* CSV 导出 */
  function exportCSV() {
    const BOM = "\uFEFF";
    const header = ["类别", "基金类别", "年初预算", "年初余额", ...MONTHS.map((m) => `${m}月`), "1-12月汇总", "使用总额占预算比例", "年末余额"];
    const rows: string[][] = [header];

    const fy = (fen: number) => fen === 0 ? "" : (fen / 100).toFixed(2);

    /* 收入 */
    const incTotal = incomeMonthly.reduce((a, b) => a + b, 0);
    rows.push(["实收", "运营管理", "", "", ...MONTHS.map((m) => fy(incomeMonthly[m - 1])), fy(incTotal), "", ""]);    

    /* 支出 */
    for (const group of fundGroups) {
      for (const cat of group.cats) {
        const catBudget = budgetMap.get(cat.id) ?? 0;
        const catTotal = getCatYearTotal(cat.id);
        rows.push([
          cat.name, group.label, fy(catBudget), "",
          ...MONTHS.map((m) => fy(getCatMonth(cat.id, m))),
          fy(catTotal),
          catBudget > 0 ? pct(catTotal, catBudget) : "",
          "",
        ]);
      }
      /* 汇总行 */
      const gBudget = getFundBudgetTotal(group.cats);
      const gTotal = getFundYearTotal(group.cats);
      const openBal = openingBalanceMap.get(group.fundType) ?? 0;
      const endBal = endingBalanceMap.get(group.fundType) ?? 0;
      rows.push([
        `汇总`, group.label, fy(gBudget), fy(openBal),
        ...MONTHS.map((m) => fy(getFundMonthTotal(group.cats, m))),
        fy(gTotal),
        gBudget > 0 ? pct(gTotal, gBudget) : "",
        fy(endBal),
      ]);

      /* 划拨划入 / 划出行 */
      const isJhGroup = group.fundType === "jh_operations";
      for (const batch of transferBatches) {
        const inAmt = batch.credited.get(group.fundType) ?? 0;
        const outAmt = isJhGroup ? batch.batchTotal : 0;
        const allocMonth = Number(batch.date.split("-")[1]);
        const typeLabel = batch.type === "adjustment" ? "手动调整" : "半年划拨";
        if (inAmt > 0) {
          rows.push([
            `划入 (${batch.date})`, typeLabel, "", "",
            ...MONTHS.map((m) => (m === allocMonth ? (inAmt / 100).toFixed(2) : "")),
            (inAmt / 100).toFixed(2), "", "",
          ]);
        }
        if (outAmt > 0) {
          rows.push([
            `划出 (${batch.date})`, typeLabel, "", "",
            ...MONTHS.map((m) => (m === allocMonth ? (-outAmt / 100).toFixed(2) : "")),
            (-outAmt / 100).toFixed(2), "", "",
          ]);
        }
      }
    }

    /* 支出总计 */
    const allCats = fundGroups.flatMap((g) => g.cats);
    const totalBudget = allCats.reduce((s, c) => s + (budgetMap.get(c.id) ?? 0), 0);
    const totalExpense = allCats.reduce((s, c) => s + getCatYearTotal(c.id), 0);
    const totalEndBal = ALL_FUND_TYPES.reduce((s, ft) => s + (endingBalanceMap.get(ft) ?? 0), 0);
    rows.push([
      "支出总计", "", fy(totalBudget), "",
      ...MONTHS.map((m) => fy(allCats.reduce((s, c) => s + getCatMonth(c.id, m), 0))),
      fy(totalExpense),
      totalBudget > 0 ? pct(totalExpense, totalBudget) : "",
      fy(totalEndBal),
    ]);

    const csv = BOM + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `年度预算执行报表_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* 辅助：获取某类别某月金额 */
  function getCatMonth(catId: string, month: number): number {
    return txMap.get(`${catId}|${month}`) ?? 0;
  }

  /* 辅助：获取某类别年度合计 */
  function getCatYearTotal(catId: string): number {
    let sum = 0;
    for (let m = 1; m <= 12; m++) sum += getCatMonth(catId, m);
    return sum;
  }

  /* 辅助：获取某基金组月度合计 */
  function getFundMonthTotal(cats: CategoryRow[], month: number): number {
    return cats.reduce((s, c) => s + getCatMonth(c.id, month), 0);
  }

  /* 辅助：获取某基金组年度合计 */
  function getFundYearTotal(cats: CategoryRow[]): number {
    return cats.reduce((s, c) => s + getCatYearTotal(c.id), 0);
  }

  /* 辅助：获取某基金组预算合计 */
  function getFundBudgetTotal(cats: CategoryRow[]): number {
    return cats.reduce((s, c) => s + (budgetMap.get(c.id) ?? 0), 0);
  }

  /* ---------- 样式常量 ---------- */
  const thStyle: React.CSSProperties = {
    padding: "6px 8px",
    borderBottom: "2px solid #999",
    borderRight: "1px solid #ddd",
    background: "#f0f2f5",
    fontWeight: 600,
    fontSize: 12,
    textAlign: "center",
    whiteSpace: "nowrap",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };

  const tdStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderBottom: "1px solid #e8e8e8",
    borderRight: "1px solid #f0f0f0",
    fontSize: 12,
    textAlign: "right",
    whiteSpace: "nowrap",
  };

  const sectionHeaderStyle: React.CSSProperties = {
    ...tdStyle,
    background: "#fff8e1",
    fontWeight: 700,
    fontSize: 13,
    textAlign: "left",
  };

  const subtotalStyle: React.CSSProperties = {
    ...tdStyle,
    background: "#fffde7",
    fontWeight: 700,
    color: "#333",
  };

  const allocInStyle: React.CSSProperties = {
    ...tdStyle,
    background: "#e8f5e9",
    fontWeight: 600,
    color: "#2e7d32",
    fontSize: 11,
  };

  const allocOutStyle: React.CSSProperties = {
    ...tdStyle,
    background: "#ffebee",
    fontWeight: 600,
    color: "#c62828",
    fontSize: 11,
  };

  /* 总列数 = 类别 + 基金类别 + 年初预算 + 年初余额 + 12月 + 汇总 + 占比 + 年末余额 = 19 */
  const totalCols = 19;

  /* ---------- 渲染 ---------- */
  return (
    <div style={{ maxWidth: 1500, margin: "30px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* 顶部导航 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          onClick={() => router.push("/transactions")}
          style={{
            padding: "8px 16px",
            fontWeight: 600,
            cursor: "pointer",
            border: "1px solid #d0d0d0",
            borderRadius: 6,
            background: "#fff",
            fontSize: 13,
          }}
        >
          ← 返回流水
        </button>

        <div style={{ flex: 1 }} />

        {/* CSV 导出 */}
        <button
          onClick={exportCSV}
          disabled={loading}
          style={{
            padding: "8px 16px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            border: "1px solid #43a047",
            borderRadius: 6,
            background: "#e8f5e9",
            color: "#2e7d32",
            fontSize: 13,
            opacity: loading ? 0.5 : 1,
          }}
        >
          导出 CSV
        </button>

        {/* 年份选择 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => setYear((y) => Math.max(MIN_YEAR, y - 1))}
            disabled={year <= MIN_YEAR}
            style={{
              padding: "6px 12px",
              fontWeight: 700,
              cursor: year <= MIN_YEAR ? "not-allowed" : "pointer",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#fff",
              opacity: year <= MIN_YEAR ? 0.4 : 1,
            }}
          >
            ◀
          </button>
          <span style={{ fontSize: 20, fontWeight: 700, minWidth: 80, textAlign: "center" }}>
            {year}
          </span>
          <button
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= new Date().getFullYear() + 1}
            style={{
              padding: "6px 12px",
              fontWeight: 700,
              cursor: year >= new Date().getFullYear() + 1 ? "not-allowed" : "pointer",
              border: "1px solid #ccc",
              borderRadius: 4,
              background: "#fff",
              opacity: year >= new Date().getFullYear() + 1 ? 0.4 : 1,
            }}
          >
            ▶
          </button>
        </div>
      </div>

      {/* 标题 */}
      <h2 style={{ textAlign: "center", marginBottom: 6, fontSize: 18, fontWeight: 700 }}>
        年度预算执行报表 —— {year}
      </h2>
      <p style={{ textAlign: "center", color: "#888", fontSize: 12, marginBottom: 16 }}>
        可按年翻页，从{MIN_YEAR}年开始
      </p>

      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#999" }}>加载中...</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid #d0d0d0", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1300 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left", minWidth: 90, position: "sticky", left: 0, zIndex: 3, background: "#f0f2f5" }}>类别</th>
                <th style={{ ...thStyle, minWidth: 80 }}>基金类别</th>
                <th style={{ ...thStyle, minWidth: 80 }}>年初预算</th>
                <th style={{ ...thStyle, minWidth: 80 }}>年初余额</th>
                {MONTHS.map((m) => (
                  <th key={m} style={{ ...thStyle, minWidth: 65 }}>{m}月</th>
                ))}
                <th style={{ ...thStyle, minWidth: 80 }}>1-12月汇总</th>
                <th style={{ ...thStyle, minWidth: 80 }}>使用总额占<br/>预算比例</th>
                <th style={{ ...thStyle, minWidth: 90 }}>年末余额</th>
              </tr>
            </thead>
            <tbody>
              {/* ===== 收入 ===== */}
              <tr>
                <td colSpan={totalCols} style={{ ...sectionHeaderStyle, fontSize: 14, background: "#e3f2fd", color: "#1565c0" }}>
                  收入
                </td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, textAlign: "left", fontWeight: 500, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>实收</td>
                <td style={tdStyle}>运营管理</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
                {MONTHS.map((m) => (
                  <td
                    key={m}
                    style={{ ...tdStyle, color: incomeMonthly[m - 1] > 0 ? "#1565c0" : undefined, cursor: incomeMonthly[m - 1] > 0 ? "pointer" : undefined }}
                    onClick={incomeMonthly[m - 1] > 0 ? (e) => handleCellClick(e, null, m, `收入 ${m}月`) : undefined}
                  >
                    {fenToYuan(incomeMonthly[m - 1])}
                  </td>
                ))}
                <td style={{ ...tdStyle, fontWeight: 700, color: "#1565c0" }}>
                  {fenToYuan(incomeMonthly.reduce((a, b) => a + b, 0))}
                </td>
                <td style={tdStyle}></td>
                <td style={tdStyle}></td>
              </tr>

              {/* ===== 支出 ===== */}
              <tr>
                <td colSpan={totalCols} style={{ ...sectionHeaderStyle, fontSize: 14, background: "#fce4ec", color: "#c62828" }}>
                  支出
                </td>
              </tr>

              {fundGroups.map((group) => {
                const groupBudget = getFundBudgetTotal(group.cats);
                const groupYearTotal = getFundYearTotal(group.cats);
                const openBal = openingBalanceMap.get(group.fundType) ?? 0;
                const endBal = endingBalanceMap.get(group.fundType) ?? 0;
                const isJh = group.fundType === "jh_operations";

                return (
                  <React.Fragment key={group.fundType}>
                    {/* 各类别行 */}
                    {group.cats.map((cat) => {
                      const catBudget = budgetMap.get(cat.id) ?? 0;
                      const catTotal = getCatYearTotal(cat.id);
                      return (
                        <tr key={cat.id}>
                          <td style={{ ...tdStyle, textAlign: "left", paddingLeft: 16, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
                            {cat.name}
                          </td>
                          <td style={{ ...tdStyle, color: "#666", fontSize: 11 }}>{group.label}</td>
                          <td style={tdStyle}>{fenToYuan(catBudget)}</td>
                          <td style={tdStyle}></td>
                          {MONTHS.map((m) => {
                            const v = getCatMonth(cat.id, m);
                            return (
                              <td
                                key={m}
                                style={{ ...tdStyle, color: v > 0 ? "#c62828" : undefined, cursor: v > 0 ? "pointer" : undefined }}
                                onClick={v > 0 ? (e) => handleCellClick(e, cat.id, m, `${cat.name} ${m}月`) : undefined}
                              >
                                {fenToYuan(v)}
                              </td>
                            );
                          })}
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{fenToYuan(catTotal)}</td>
                          <td style={{ ...tdStyle, color: catBudget > 0 && catTotal > catBudget ? "#c62828" : "#666" }}>
                            {pct(catTotal, catBudget)}
                          </td>
                          <td style={tdStyle}></td>
                        </tr>
                      );
                    })}

                    {/* 汇总行 */}
                    <tr>
                      <td style={{ ...subtotalStyle, textAlign: "left", position: "sticky", left: 0, zIndex: 1, background: "#fffde7" }}>
                        汇总
                      </td>
                      <td style={subtotalStyle}>{group.label}</td>
                      <td style={subtotalStyle}>{fenToYuan(groupBudget)}</td>
                      <td style={subtotalStyle}>{fenToYuan(openBal)}</td>
                      {MONTHS.map((m) => (
                        <td key={m} style={subtotalStyle}>
                          {fenToYuan(getFundMonthTotal(group.cats, m))}
                        </td>
                      ))}
                      <td style={{ ...subtotalStyle, fontWeight: 800 }}>{fenToYuan(groupYearTotal)}</td>
                      <td style={{ ...subtotalStyle, color: groupBudget > 0 && groupYearTotal > groupBudget ? "#c62828" : "#333" }}>
                        {pct(groupYearTotal, groupBudget)}
                      </td>
                      <td style={{ ...subtotalStyle, fontWeight: 800, color: endBal < 0 ? "#c62828" : "#1565c0" }}>
                        {fenToYuan(endBal)}
                      </td>
                    </tr>

                    {/* 划拨行：划入（绿）与划出（红）分开展示 */}
                    {transferBatches.map((batch) => {
                      const inAmt = batch.credited.get(group.fundType) ?? 0;
                      // 每次划拨的整批金额全部从运营管理池划出，再按比例划入四个基金
                      const outAmt = isJh ? batch.batchTotal : 0;
                      if (inAmt === 0 && outAmt === 0) return null;
                      const allocMonth = Number(batch.date.split("-")[1]);
                      const typeLabel =
                        batch.type === "adjustment" ? "手动调整" : "半年划拨";
                      return (
                        <React.Fragment key={`alloc-${group.fundType}-${batch.date}`}>
                          {inAmt > 0 && (
                            <tr>
                              <td style={{ ...allocInStyle, textAlign: "left", paddingLeft: 16, position: "sticky", left: 0, zIndex: 1, background: "#e8f5e9" }}>
                                划入 ({batch.date})
                              </td>
                              <td style={allocInStyle}>{typeLabel}</td>
                              <td style={allocInStyle}></td>
                              <td style={allocInStyle}></td>
                              {MONTHS.map((m) => (
                                <td key={m} style={allocInStyle}>
                                  {m === allocMonth ? `+${fenToYuan(inAmt)}` : ""}
                                </td>
                              ))}
                              <td style={allocInStyle}>+{fenToYuan(inAmt)}</td>
                              <td style={allocInStyle}></td>
                              <td style={allocInStyle}></td>
                            </tr>
                          )}
                          {outAmt > 0 && (
                            <tr>
                              <td style={{ ...allocOutStyle, textAlign: "left", paddingLeft: 16, position: "sticky", left: 0, zIndex: 1, background: "#ffebee" }}>
                                划出 ({batch.date})
                              </td>
                              <td style={allocOutStyle}>{typeLabel}</td>
                              <td style={allocOutStyle}></td>
                              <td style={allocOutStyle}></td>
                              {MONTHS.map((m) => (
                                <td key={m} style={allocOutStyle}>
                                  {m === allocMonth ? `-${fenToYuan(outAmt)}` : ""}
                                </td>
                              ))}
                              <td style={allocOutStyle}>-{fenToYuan(outAmt)}</td>
                              <td style={allocOutStyle}></td>
                              <td style={allocOutStyle}></td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}

              {/* ===== 支出总计 ===== */}
              {(() => {
                const allExpenseCats = fundGroups.flatMap((g) => g.cats);
                const totalBudget = allExpenseCats.reduce((s, c) => s + (budgetMap.get(c.id) ?? 0), 0);
                const totalExpense = allExpenseCats.reduce((s, c) => s + getCatYearTotal(c.id), 0);
                const totalEndBal = ALL_FUND_TYPES.reduce((s, ft) => s + (endingBalanceMap.get(ft) ?? 0), 0);
                return (
                  <tr>
                    <td style={{ ...subtotalStyle, textAlign: "left", position: "sticky", left: 0, zIndex: 1, background: "#fff3e0", fontWeight: 800, fontSize: 13 }}>
                      支出总计
                    </td>
                    <td style={{ ...subtotalStyle, background: "#fff3e0" }}></td>
                    <td style={{ ...subtotalStyle, background: "#fff3e0", fontWeight: 800 }}>{fenToYuan(totalBudget)}</td>
                    <td style={{ ...subtotalStyle, background: "#fff3e0" }}></td>
                    {MONTHS.map((m) => (
                      <td key={m} style={{ ...subtotalStyle, background: "#fff3e0" }}>
                        {fenToYuan(allExpenseCats.reduce((s, c) => s + getCatMonth(c.id, m), 0))}
                      </td>
                    ))}
                    <td style={{ ...subtotalStyle, background: "#fff3e0", fontWeight: 800 }}>{fenToYuan(totalExpense)}</td>
                    <td style={{ ...subtotalStyle, background: "#fff3e0", color: totalBudget > 0 && totalExpense > totalBudget ? "#c62828" : "#333" }}>
                      {pct(totalExpense, totalBudget)}
                    </td>
                    <td style={{ ...subtotalStyle, background: "#fff3e0", fontWeight: 800, color: totalEndBal < 0 ? "#c62828" : "#1565c0" }}>
                      {fenToYuan(totalEndBal)}
                    </td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* 图例说明 */}
      {!loading && (
        <div style={{ marginTop: 16, padding: "10px 14px", background: "#f5f5f5", borderRadius: 8, fontSize: 12, color: "#555", lineHeight: 2 }}>
          {transferBatches.length > 0 && (
            <>
              <span style={{ display: "inline-block", width: 14, height: 14, background: "#e8f5e9", border: "1px solid #a5d6a7", borderRadius: 3, verticalAlign: "middle", marginRight: 6 }} />
              绿色行＝划入金额；
              <span style={{ display: "inline-block", width: 14, height: 14, background: "#ffebee", border: "1px solid #ef9a9a", borderRadius: 3, verticalAlign: "middle", margin: "0 6px 0 10px" }} />
              红色行＝划出金额。划拨是资金池内部转账：整批金额从运营管理划出，再按 5:2:2:1 划入四个基金，四基金余额总和不变。
              <br />
            </>
          )}
          年初余额＝上年末结转余额（期初余额 + 截至本年 1 月 1 日的划拨净额 + 期初日后至上年末的收支）；
          年末余额＝年初余额 + 本年划拨净额 + 本年收入（仅运营管理）− 本年该基金支出。
          <br />
          余额列按全部支出类别计算（含未设预算的类别），因此可能与上方「汇总」行的口径略有差异。
        </div>
      )}

      {/* 明细弹窗 */}
      {popup && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 100 }}
          onClick={() => setPopup(null)}
        >
          <div
            style={{
              position: "absolute",
              top: Math.min(popup.rect.top, window.innerHeight - 320),
              left: Math.min(popup.rect.left, window.innerWidth - 420),
              width: 400,
              maxHeight: 300,
              background: "#fff",
              border: "1px solid #ccc",
              borderRadius: 8,
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #eee", fontWeight: 700, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{popup.label}</span>
              <button onClick={() => setPopup(null)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#999" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 14px" }}>
              {popupDetails.length === 0 ? (
                <div style={{ color: "#999", fontSize: 12, padding: 12, textAlign: "center" }}>无明细记录</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ddd", fontWeight: 600 }}>日期</th>
                      <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #ddd", fontWeight: 600 }}>金额</th>
                      <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ddd", fontWeight: 600 }}>账户</th>
                      <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #ddd", fontWeight: 600 }}>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {popupDetails.map((d) => (
                      <tr key={d.id}>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>{d.date}</td>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0", textAlign: "right", color: d.direction === "income" ? "#1565c0" : "#c62828" }}>
                          {fenToYuan(d.amount)}
                        </td>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0" }}>{d.account_name}</td>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0", color: "#666", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.description ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
