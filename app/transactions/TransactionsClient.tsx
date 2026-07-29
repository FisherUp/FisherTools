"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../lib/services/userDisplay";
import { FUND_LABELS, type FundType } from "../../lib/services/fundService";
import { exportTablePdf } from "../../lib/utils/pdfExport";

type Row = {
  id: string;
  date: string; // yyyy-mm-dd
  amount: number; // 分
  direction: "income" | "expense";
  description: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  accounts: { name: string; type: "cash" | "bank" } | null;
  categories: { name: string; fund_type: FundType | null } | null;
  handler1_id: string | null;
  handler2_id: string | null;
};

type CategoryRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type BudgetRow = {
  category_id: string;
  amount: number;
  year: number;
  is_enabled: boolean;
};

type BudgetSummaryRow = {
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  budgetAmount: number | null;
  usedAmount: number;
  remainingAmount: number | null;
};

type YearOverview = {
  budgetTotal: number;   // 年度预算总额（分）
  incomeTotal: number;   // 年度累计收入（分）
  timeProgress: number;  // 年度时间进度 (0~1)
  incomeRate: number | null;  // 收入完成率 (null if budgetTotal=0)
};

/** 计算年度时间进度：所选月份月末是当年第几天 / 全年总天数 */
function calcTimeProgress(year: number, monthNum: number): number {
  const endOfMonth = new Date(year, monthNum, 0); // 所选月份最后一天
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.floor((endOfMonth.getTime() - jan1.getTime()) / 86400000) + 1;
  const totalDays = Math.floor((new Date(year + 1, 0, 1).getTime() - jan1.getTime()) / 86400000);
  return dayOfYear / totalDays;
}

function formatYuanFromFen(fen: number) {
  return (fen / 100).toFixed(2);
}
function fenToYuan(fen: number) {
  return (fen / 100).toFixed(2);
}

function csvEscape(value: string) {
  const v = value ?? "";
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fmtDateTime(dt: Date) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function fmtDateTimeMaybe(v: string | null) {
  if (!v) return "-";
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return "-";
  return fmtDateTime(dt);
}


export default function TransactionsClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // ✅ 从 URL search params 读取 year/month，缺省取当前年月
  const month = useMemo(() => {
    const now = new Date();
    const y = searchParams.get("year") ?? String(now.getFullYear());
    const m = searchParams.get("month") ?? String(now.getMonth() + 1);
    return `${y}-${String(Number(m)).padStart(2, "0")}`;
  }, [searchParams]);

  const setMonth = useCallback(
    (val: string) => {
      const [y, m] = val.split("-");
      router.replace(`/transactions?year=${Number(y)}&month=${Number(m)}`);
    },
    [router]
  );

  // ✅ 月份前后切换
  const goPrevMonth = useCallback(() => {
    const [y, m] = month.split("-").map(Number);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    router.replace(`/transactions?year=${prev.y}&month=${prev.m}`);
  }, [month, router]);

  const goNextMonth = useCallback(() => {
    const [y, m] = month.split("-").map(Number);
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    router.replace(`/transactions?year=${next.y}&month=${next.m}`);
  }, [month, router]);

  const isNextDisabled = useMemo(() => {
    const now = new Date();
    const [y, m] = month.split("-").map(Number);
    return y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1);
  }, [month]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // ✅ 当前登录用户信息
  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  const [orgId, setOrgId] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");

  // ✅ members 映射：id -> name（用于显示经手人）
  const [memberMap, setMemberMap] = useState<Map<string, string>>(new Map());

  // ✅ 附件数量映射：transaction_id -> 张数（用于列表 📎 标识）
  const [attachCountMap, setAttachCountMap] = useState<Map<string, number>>(new Map());

  // ✅ users 映射：id -> display（用于显示创建/修改人）
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());

  // ✅ 预算汇总（按分类）
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummaryRow[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState("");
  const [budgetCollapsed, setBudgetCollapsed] = useState(true);

  // ✅ 年度预算执行总览
  const [yearOverview, setYearOverview] = useState<YearOverview | null>(null);

  // 计算当月起止日期：例如 2025-12 -> [2025-12-01, 2026-01-01)
  const { fromDate, toDate } = useMemo(() => {
    const [yStr, mStr] = month.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const from = `${yStr}-${mStr}-01`;
    const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    const nextMonthStr = String(nextMonth.m).padStart(2, "0");
    const to = `${nextMonth.y}-${nextMonthStr}-01`;
    return { fromDate: from, toDate: to };
  }, [month]);

  // ✅ 读取当前用户邮箱 + role + org_id + org_name
  const loadCurrentUser = async () => {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setUserEmail("");
      setUserRole("");
      setOrgId("");
      setOrgName("");
      return "";
    }

    setUserEmail(userRes.user.email ?? "");

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("role, org_id, organizations(name)")
      .eq("id", userRes.user.id)
      .single();

    if (!pErr && profile) {
      setUserRole((profile as any).role ?? "");
      const oid = (profile as any).org_id ? String((profile as any).org_id) : "";
      setOrgId(oid);

      let oname = String((profile as any).organizations?.name ?? "");
      if (!oname && oid) {
        const { data: org, error: oErr } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", oid)
          .single();
        if (!oErr && org?.name) oname = String(org.name);
      }
      setOrgName(oname);
    }
    return (profile as any)?.org_id ? String((profile as any).org_id) : "";
  };

  const load = async (orgIdOverride?: string) => {
    setLoading(true);
    setMsg("");
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          `
          id,
          date,
          amount,
          direction,
          description,
          created_by,
          updated_by,
          created_at,
          updated_at,
          handler1_id,
          handler2_id,
          accounts ( name, type ),
          categories ( name, fund_type )
        `
        )
        .gte("date", fromDate)
        .lt("date", toDate)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        setMsg("加载流水失败：" + error.message);
        setRows([]);
        setMemberMap(new Map());
        return;
      }

      const list: Row[] = Array.isArray(data)
        ? data.map((x: any) => ({
            id: String(x.id),
            date: String(x.date),
            amount: Number(x.amount),
            direction: x.direction,
            description: x.description ?? null,
            created_by: x.created_by ? String(x.created_by) : null,
            updated_by: x.updated_by ? String(x.updated_by) : null,
            created_at: x.created_at ? String(x.created_at) : null,
            updated_at: x.updated_at ? String(x.updated_at) : null,
            accounts: x.accounts ?? null,
            categories: x.categories ?? null,
            handler1_id: x.handler1_id ? String(x.handler1_id) : null,
            handler2_id: x.handler2_id ? String(x.handler2_id) : null,
          }))
        : [];

      setRows(list);

      // ✅ 批量查附件数量，让列表一眼能看出哪条有票据
      if (list.length > 0) {
        const { data: attData, error: attErr } = await supabase
          .from("attachments")
          .select("transaction_id")
          .in(
            "transaction_id",
            list.map((r) => r.id)
          );

        if (attErr) {
          console.warn("加载附件数量失败：", attErr.message);
          setAttachCountMap(new Map());
        } else {
          const counts = new Map<string, number>();
          (attData ?? []).forEach((a: any) => {
            const k = String(a.transaction_id);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          });
          setAttachCountMap(counts);
        }
      } else {
        setAttachCountMap(new Map());
      }

      const userIds = Array.from(
        new Set(list.flatMap((r) => [r.created_by, r.updated_by]).filter(Boolean) as string[])
      );

      const resolvedOrgId = orgIdOverride ?? orgId;

      if (resolvedOrgId) {
        const displayMap = await fetchUserDisplayMap(userIds, resolvedOrgId);
        setUserDisplayMap(displayMap);
      } else {
        setUserDisplayMap(new Map());
      }

      // ✅ 拉取经手人名字（批量）
      const ids = Array.from(
        new Set(list.flatMap((r) => [r.handler1_id, r.handler2_id]).filter(Boolean) as string[])
      );

      if (ids.length === 0) {
        setMemberMap(new Map());
        return;
      }

      const { data: memData, error: memErr } = await supabase.from("members").select("id,name").in("id", ids);
      if (memErr) {
        console.warn("加载 members 失败：", memErr.message);
        setMemberMap(new Map());
        return;
      }

      const map = new Map<string, string>();
      (memData ?? []).forEach((m: any) => map.set(String(m.id), String(m.name)));
      setMemberMap(map);
    } finally {
      setLoading(false);
    }
  };

  const loadBudgetSummary = async (orgIdOverride?: string) => {
    const resolvedOrgId = orgIdOverride ?? orgId;
    if (!resolvedOrgId) {
      setBudgetSummary([]);
      return;
    }

    const year = Number(month.slice(0, 4));
    const yearStart = `${year}-01-01`;

    setBudgetLoading(true);
    setBudgetMsg("");
    try {
      const [budRes, catRes, txRes, incomeRes] = await Promise.all([
        supabase
          .from("category_budgets")
          .select("category_id, amount, year, is_enabled")
          .eq("org_id", resolvedOrgId)
          .eq("year", year)
          .eq("is_enabled", true),
        supabase
          .from("categories")
          .select("id,name,is_active")
          .eq("org_id", resolvedOrgId)
          .order("name", { ascending: true }),
        supabase
          .from("transactions")
          .select("category_id, amount")
          .eq("org_id", resolvedOrgId)
          .eq("direction", "expense")
          .gte("date", yearStart)
          .lt("date", toDate),
        // ✅ 新增：年度累计收入查询
        supabase
          .from("transactions")
          .select("amount")
          .eq("org_id", resolvedOrgId)
          .eq("direction", "income")
          .gte("date", yearStart)
          .lt("date", toDate),
      ]);

      if (budRes.error) setBudgetMsg("加载预算失败：" + budRes.error.message);
      if (catRes.error) setBudgetMsg("加载类别失败：" + catRes.error.message);
      if (txRes.error) setBudgetMsg("加载年度支出失败：" + txRes.error.message);
      if (incomeRes.error) setBudgetMsg("加载年度收入失败：" + incomeRes.error.message);

      const categoryRows: CategoryRow[] = Array.isArray(catRes.data)
        ? catRes.data.map((c: any) => ({
            id: String(c.id),
            name: String(c.name),
            is_active: Boolean(c.is_active),
          }))
        : [];

      const budgetMap = new Map<string, BudgetRow>();
      (budRes.data ?? []).forEach((b: any) => {
        budgetMap.set(String(b.category_id), {
          category_id: String(b.category_id),
          amount: Number(b.amount),
          year: Number(b.year),
          is_enabled: Boolean(b.is_enabled),
        });
      });

      const usedMap = new Map<string, number>();
      (txRes.data ?? []).forEach((t: any) => {
        const cid = t.category_id ? String(t.category_id) : "";
        if (!cid) return;
        usedMap.set(cid, (usedMap.get(cid) ?? 0) + Number(t.amount || 0));
      });

      const categoryMap = new Map<string, CategoryRow>();
      categoryRows.forEach((c) => categoryMap.set(c.id, c));

      // ✅ 仅以有预算记录的 category 为基准，未设置预算的类别不参与概览
      const allIds = new Set<string>(Array.from(budgetMap.keys()));

      const summaryRows: BudgetSummaryRow[] = Array.from(allIds).map((id) => {
        const cat = categoryMap.get(id);
        const bud = budgetMap.get(id);
        const used = usedMap.get(id) ?? 0;
        const budgetAmount = bud ? bud.amount : null;
        const remainingAmount = budgetAmount === null ? null : budgetAmount - used;
        return {
          categoryId: id,
          categoryName: cat?.name ?? "未分类",
          isActive: cat?.is_active ?? true,
          budgetAmount,
          usedAmount: used,
          remainingAmount,
        };
      });

      summaryRows.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
      setBudgetSummary(summaryRows);

      // ✅ 计算年度预算执行总览
      const budgetTotal = summaryRows.reduce((s, r) => s + (r.budgetAmount ?? 0), 0);
      const incomeTotal = (incomeRes.data ?? []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      const monthNum = Number(month.slice(5, 7));
      const timeProgress = calcTimeProgress(year, monthNum);
      const incomeRate = budgetTotal > 0 ? incomeTotal / budgetTotal : null;
      setYearOverview({ budgetTotal, incomeTotal, timeProgress, incomeRate });
    } finally {
      setBudgetLoading(false);
    }
  };

  const reloadAll = async () => {
    const oid = orgId || (await loadCurrentUser());
    await load(oid);
    await loadBudgetSummary(oid);
  };

  // 删除一条流水
  const deleteRow = async (id: string) => {
    const ok = confirm("确定要删除这条流水吗？此操作不可恢复。");
    if (!ok) return;

    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) {
        setMsg("删除失败：" + error.message);
        return;
      }
      await load();
    } finally {
      setLoading(false);
    }
  };

  // ✅ 明细 CSV（包含经手人1/2）
  const exportCsv = () => {
    if (rows.length === 0) {
      alert("本月暂无流水可导出");
      return;
    }

    const header = ["日期", "收支", "金额（元）", "类别", "账户", "账户类型", "经手人1", "经手人2", "备注"];

    const lines = rows.map((r) => {
      const accountName = r.accounts?.name ?? "";
      const accountType =
        r.accounts?.type === "cash" ? "现金" : r.accounts?.type === "bank" ? "银行卡" : "";
      const categoryName = r.categories?.name ?? "";
      const direction = r.direction === "income" ? "收入" : "支出";
      const amountYuan = formatYuanFromFen(r.amount);
      const desc = r.description ?? "";
      const h1 = r.handler1_id ? memberMap.get(r.handler1_id) ?? "" : "";
      const h2 = r.handler2_id ? memberMap.get(r.handler2_id) ?? "" : "";

      return [r.date, direction, amountYuan, categoryName, accountName, accountType, h1, h2, desc]
        .map((v) => csvEscape(String(v)))
        .join(",");
    });

    const filename = `流水_${month}.csv`;
    const bom = "\uFEFF";
    const csvContent = bom + header.map(csvEscape).join(",") + "\n" + lines.join("\n");
    downloadTextFile(filename, csvContent);
  };

  // ✅ 月度汇总（按类别）CSV
  const exportMonthlySummaryCsv = () => {
    if (rows.length === 0) {
      alert("本月暂无数据");
      return;
    }

    const map = new Map<string, { income: number; expense: number }>();

    for (const r of rows) {
      const cat = r.categories?.name ?? "未分类";
      if (!map.has(cat)) map.set(cat, { income: 0, expense: 0 });
      const item = map.get(cat)!;
      if (r.direction === "income") item.income += r.amount;
      else item.expense += r.amount;
    }

    const header = ["类别", "收入合计", "支出合计", "净额"];

    const lines = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, v]) => {
        const net = v.income - v.expense;
        return [cat, fenToYuan(v.income), fenToYuan(v.expense), fenToYuan(net)]
          .map((x) => csvEscape(String(x)))
          .join(",");
      });

    const bom = "\uFEFF";
    const csv = bom + header.map(csvEscape).join(",") + "\n" + lines.join("\n");
    downloadTextFile(`月度汇总_${month}.csv`, csv);
  };

  // ✅ 月度汇总（按类别）PDF
  const exportMonthlySummaryPdf = async () => {
    if (rows.length === 0) {
      alert("本月暂无数据");
      return;
    }

    const map = new Map<string, { income: number; expense: number }>();
    for (const r of rows) {
      const cat = r.categories?.name ?? "未分类";
      if (!map.has(cat)) map.set(cat, { income: 0, expense: 0 });
      const item = map.get(cat)!;
      if (r.direction === "income") item.income += r.amount;
      else item.expense += r.amount;
    }

    const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));

    await exportTablePdf({
      filename: `月度汇总_${month}.pdf`,
      title: `月度收支汇总（按类别）· ${month}`,
      meta: [
        { label: "组织", value: orgName || (orgId ? orgId.slice(0, 8) + "…" : "-") },
        { label: "导出人", value: userEmail || "-" },
        { label: "导出时间", value: fmtDateTime(new Date()) },
      ],
      columns: [
        { header: "类别", width: 2 },
        { header: "收入合计（元）", width: 1.2, align: "right" },
        { header: "支出合计（元）", width: 1.2, align: "right" },
        { header: "净额（元）", width: 1.2, align: "right" },
      ],
      rows: entries.map(([cat, v]) => {
        const net = v.income - v.expense;
        return [
          cat,
          { text: fenToYuan(v.income), align: "right" as const },
          { text: fenToYuan(v.expense), align: "right" as const },
          {
            text: fenToYuan(net),
            align: "right" as const,
            bold: true,
            color: net >= 0 ? "#15803d" : "#b91c1c",
          },
        ];
      }),
      summary: [
        { label: "收入合计", value: `¥${formatYuanFromFen(summary.income)}` },
        { label: "支出合计", value: `¥${formatYuanFromFen(summary.expense)}` },
        { label: "净额", value: `¥${formatYuanFromFen(summary.net)}` },
      ],
    });
  };

  // ✅ 年度汇总（12 个月）CSV
  const exportYearlySummaryCsv = async () => {
    const year = month.slice(0, 4);
    setLoading(true);
    setMsg("");

    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("date,amount,direction")
        .gte("date", `${year}-01-01`)
        .lt("date", `${Number(year) + 1}-01-01`);

      if (error) {
        setMsg("加载年度数据失败：" + error.message);
        return;
      }

      const monthMap = new Map<string, { income: number; expense: number }>();

      for (const r of data ?? []) {
        const m = String((r as any).date).slice(0, 7);
        if (!monthMap.has(m)) monthMap.set(m, { income: 0, expense: 0 });
        const item = monthMap.get(m)!;
        const dir = (r as any).direction as "income" | "expense";
        const amt = Number((r as any).amount);
        if (dir === "income") item.income += amt;
        else item.expense += amt;
      }

      for (let mm = 1; mm <= 12; mm++) {
        const key = `${year}-${String(mm).padStart(2, "0")}`;
        if (!monthMap.has(key)) monthMap.set(key, { income: 0, expense: 0 });
      }

      const header = ["月份", "收入", "支出", "净额"];

      const lines = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, v]) => {
          const net = v.income - v.expense;
          return [m, fenToYuan(v.income), fenToYuan(v.expense), fenToYuan(net)]
            .map((x) => csvEscape(String(x)))
            .join(",");
        });

      const bom = "\uFEFF";
      const csv = bom + header.map(csvEscape).join(",") + "\n" + lines.join("\n");
      downloadTextFile(`年度汇总_${year}.csv`, csv);
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ PDF 导出（中文零乱码）
   *
   * 旧实现把 16MB 的 NotoSansCJKsc-Regular.otf 塞进 jsPDF —— 该字体是 CFF 轮廓，
   * jsPDF 只支持 TrueType 轮廓，所以必然出现方块/乱码，而且每次导出都要下载 16MB。
   * 现在改为 lib/utils/pdfExport 的离屏 DOM 光栅化方案：中文由系统字体渲染，永不乱码。
   */
  const exportPdf = async () => {
    if (!rows || rows.length === 0) {
      alert("本月暂无流水可导出");
      return;
    }

    await exportTablePdf({
      filename: `流水明细_${month}.pdf`,
      title: `收支流水明细 · ${month}`,
      subtitle: `统计区间：${fromDate} ～ ${toDate}（不含 ${toDate}）`,
      orientation: "landscape",
      meta: [
        { label: "组织", value: orgName || (orgId ? orgId.slice(0, 8) + "…" : "-") },
        { label: "导出人", value: userEmail || "-" },
        { label: "角色", value: userRole || "-" },
        { label: "导出时间", value: fmtDateTime(new Date()) },
      ],
      columns: [
        { header: "日期", width: 1.1 },
        { header: "收/支", width: 0.6, align: "center" },
        { header: "金额(元)", width: 1.1, align: "right" },
        { header: "类别", width: 1.3 },
        { header: "基金", width: 1 },
        { header: "账户", width: 1.4 },
        { header: "经手人1", width: 0.9 },
        { header: "经手人2", width: 0.9 },
        { header: "备注", width: 2.4 },
        { header: "票据", width: 0.6, align: "center" },
      ],
      rows: rows.map((r) => {
        const isIncome = r.direction === "income";
        const attCount = attachCountMap.get(r.id) ?? 0;
        return [
          r.date,
          {
            text: isIncome ? "收入" : "支出",
            align: "center" as const,
            color: isIncome ? "#15803d" : "#b91c1c",
            bold: true,
          },
          {
            text: formatYuanFromFen(r.amount),
            align: "right" as const,
            bold: true,
            color: isIncome ? "#15803d" : "#b91c1c",
          },
          r.categories?.name ?? "-",
          r.categories?.fund_type ? FUND_LABELS[r.categories.fund_type] : "—",
          r.accounts ? `${r.accounts.name}（${r.accounts.type === "cash" ? "现金" : "银行卡"}）` : "-",
          r.handler1_id ? memberMap.get(r.handler1_id) ?? "-" : "-",
          r.handler2_id ? memberMap.get(r.handler2_id) ?? "-" : "-",
          r.description ?? "",
          { text: attCount > 0 ? `${attCount}` : "—", align: "center" as const },
        ];
      }),
      summary: [
        { label: "记录数", value: `${rows.length} 条` },
        { label: "收入合计", value: `¥${formatYuanFromFen(summary.income)}` },
        { label: "支出合计", value: `¥${formatYuanFromFen(summary.expense)}` },
        { label: "净额", value: `¥${formatYuanFromFen(summary.net)}` },
      ],
    });
  };

  useEffect(() => {
    const loadAll = async () => {
      const oid = await loadCurrentUser();
      await load(oid);
      await loadBudgetSummary(oid);
    };

    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // 计算月度合计
  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      if (r.direction === "income") income += r.amount;
      else expense += r.amount;
    }
    return { income, expense, net: income - expense };
  }, [rows]);

  const budgetYear = month.slice(0, 4);

  return (
    <div className="ft-page">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 className="ft-title">流水列表</h1>

        {userEmail && (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: "#f5f7fa",
              fontSize: 13,
              color: "#333",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>👤 {userEmail}</span>

            {!!userRole && (
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: userRole === "admin" ? "#ffe5e5" : "#e5f0ff",
                  color: userRole === "admin" ? "#c00" : "#0366d6",
                  fontWeight: 800,
                }}
                title={
                  userRole === "admin"
                    ? "管理员：可管理所有数据和设置"
                    : userRole === "finance"
                    ? "财务：可查看和编辑财务数据"
                    : "普通用户：仅可查看数据"
                }
              >
                {userRole}
              </span>
            )}

            {!!(orgName || orgId) && (
              <span style={{ color: "#666", fontSize: 12 }}>
                org: <b style={{ color: "#333" }}>{orgName || orgId.slice(0, 8) + "…"}</b>
              </span>
            )}
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
            <button
              onClick={goPrevMonth}
              style={{ padding: "4px 8px", fontWeight: 700, cursor: "pointer", border: "1px solid #ccc", borderRadius: 4, background: "#fff" }}
              title="上个月"
            >
              ◀
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ padding: 6 }}
            />
            <button
              onClick={goNextMonth}
              disabled={isNextDisabled}
              style={{
                padding: "4px 8px",
                fontWeight: 700,
                cursor: isNextDisabled ? "not-allowed" : "pointer",
                border: "1px solid #ccc",
                borderRadius: 4,
                background: "#fff",
                opacity: isNextDisabled ? 0.4 : 1,
              }}
              title="下个月"
            >
              ▶
            </button>
          </div>

          <button onClick={reloadAll} disabled={loading} className="ft-btn">
            {loading ? "刷新中..." : "↻ 刷新"}
          </button>

          <details style={{ position: "relative" }}>
            <summary
              className="ft-btn"
              style={{ listStyle: "none", cursor: "pointer" }}
            >
              ⬇ 导出
            </summary>
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 6px)",
                zIndex: 30,
                background: "#fff",
                border: "1px solid #e3e8ef",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
                padding: 8,
                display: "grid",
                gap: 6,
                minWidth: 190,
              }}
            >
              <div style={{ fontSize: 11, color: "#94a3b8", padding: "2px 6px" }}>PDF（中文不乱码）</div>
              <button
                onClick={async () => {
                  try {
                    await exportPdf();
                  } catch (e: any) {
                    alert("导出PDF失败：" + String(e?.message ?? e));
                  }
                }}
                disabled={loading || rows.length === 0}
                className="ft-btn ft-btn-sm"
              >
                流水明细 PDF
              </button>
              <button
                onClick={async () => {
                  try {
                    await exportMonthlySummaryPdf();
                  } catch (e: any) {
                    alert("导出PDF失败：" + String(e?.message ?? e));
                  }
                }}
                disabled={loading || rows.length === 0}
                className="ft-btn ft-btn-sm"
              >
                月度汇总 PDF
              </button>

              <div style={{ fontSize: 11, color: "#94a3b8", padding: "2px 6px", marginTop: 4 }}>CSV</div>
              <button onClick={exportCsv} disabled={loading || rows.length === 0} className="ft-btn ft-btn-sm">
                流水明细 CSV
              </button>
              <button
                onClick={exportMonthlySummaryCsv}
                disabled={loading || rows.length === 0}
                className="ft-btn ft-btn-sm"
              >
                月度汇总 CSV
              </button>
              <button onClick={exportYearlySummaryCsv} disabled={loading} className="ft-btn ft-btn-sm">
                年度汇总 CSV
              </button>
            </div>
          </details>

          <a href={`/transactions/report`} className="ft-btn ft-btn-primary">
            年度报表
          </a>

          {(userRole === "admin" || userRole === "finance") && (
            <a
              href={`/transactions/new?from_year=${month.split("-")[0]}&from_month=${Number(month.split("-")[1])}`}
              className="ft-btn ft-btn-primary"
            >
              + 新增
            </a>
          )}

          {userRole === "admin" && (
            <a href="/members" className="ft-btn ft-btn-ghost ft-only-desktop">
              经手人管理
            </a>
          )}

          {userRole === "admin" && (
            <a href="/accounts" className="ft-btn ft-btn-ghost ft-only-desktop">
              账户管理
            </a>
          )}

          {userRole === "admin" && (
            <a href="/categories" className="ft-btn ft-btn-ghost ft-only-desktop">
              类别管理
            </a>
          )}

          {userRole === "admin" && (
            <a href="/budgets" className="ft-btn ft-btn-ghost ft-only-desktop">
              资源计划
            </a>
          )}

          {(userRole === "admin" || userRole === "viewer") && (
            <a href="/funds" className="ft-btn ft-btn-ghost">
              🏦 资源池
            </a>
          )}
        </div>
      </div>

      <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
        筛选范围：{fromDate} ～ {toDate}（不含 {toDate}）
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        {[
          { label: "收入合计", value: summary.income, color: "#15803d", bg: "#ecfdf5", border: "#bbf7d0" },
          { label: "支出合计", value: summary.expense, color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
          {
            label: "净额",
            value: summary.net,
            color: summary.net >= 0 ? "#1d4ed8" : "#b91c1c",
            bg: "#eff6ff",
            border: "#bfdbfe",
          },
          { label: "记录数", value: null, color: "#334155", bg: "#f6f8fa", border: "#e3e8ef" },
        ].map((c) => (
          <div
            key={c.label}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{c.label}</div>
            <div className="ft-num" style={{ fontSize: 20, fontWeight: 800, color: c.color }}>
              {c.value === null ? `${rows.length} 条` : `¥${formatYuanFromFen(c.value)}`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{ fontWeight: 800, marginBottom: 6, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}
          onClick={() => setBudgetCollapsed((v) => !v)}
        >
          <span style={{ fontSize: 12, display: "inline-block", transition: "transform 0.15s", transform: budgetCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
          预算概览（{budgetYear} 年）
        </div>

        {!budgetCollapsed && (
          <>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              统计口径：当年 1 月 1 日起至所选月份月底。收入 = direction=income，支出 = direction=expense。
            </div>

            {!!budgetMsg && (
              <div style={{ padding: 10, background: "#fff3cd", borderRadius: 8, marginBottom: 8 }}>
                {budgetMsg}
              </div>
            )}

            {/* ====== 年度预算执行总览 ====== */}
            {yearOverview && (
              <div style={{ background: "#f8f9fb", border: "1px solid #e4e8ee", borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>年度预算执行总览</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
                  <div>
                    年度计划总额：<b>¥{formatYuanFromFen(yearOverview.budgetTotal)}</b>
                  </div>
                  <div>
                    当前累计收入：<b>¥{formatYuanFromFen(yearOverview.incomeTotal)}</b>
                  </div>
                  <div>
                    收入完成率：<b>{yearOverview.incomeRate !== null ? (yearOverview.incomeRate * 100).toFixed(1) + "%" : "N/A"}</b>
                  </div>
                  <div>
                    年度时间进度：<b>{(yearOverview.timeProgress * 100).toFixed(1)}%</b>
                  </div>
                </div>
                {yearOverview.incomeRate !== null && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    {yearOverview.incomeRate >= yearOverview.timeProgress ? (
                      <span style={{ color: "#28a745", fontWeight: 700 }}>
                        ✅ 执行进度领先年度计划节奏（领先 {((yearOverview.incomeRate - yearOverview.timeProgress) * 100).toFixed(1)} 个百分点）
                      </span>
                    ) : (
                      <span style={{ color: "#e67e22", fontWeight: 700 }}>
                        ⚠ 执行进度滞后于年度计划（差距 {((yearOverview.timeProgress - yearOverview.incomeRate) * 100).toFixed(1)} 个百分点）
                      </span>
                    )}
                  </div>
                )}
                {yearOverview.budgetTotal === 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>年度预算总额为 0，无法计算收入完成率。</div>
                )}
              </div>
            )}

            {/* ====== 分类预算明细表 ====== */}
            <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类别</th>
                    <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>年度预算（元）</th>
                    <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>已使用（元）</th>
                    <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>剩余预算（元）</th>
                    <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>使用比例</th>
                    <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>执行节奏</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetSummary.length === 0 && !budgetLoading ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 14, color: "#666" }}>
                        暂无预算数据
                      </td>
                    </tr>
                  ) : (
                    budgetSummary.map((b) => {
                      const over = b.remainingAmount !== null && b.remainingAmount < 0;
                      const remainText = b.remainingAmount === null ? "-" : formatYuanFromFen(b.remainingAmount);

                      // 使用比例
                      const usageRatio = b.budgetAmount && b.budgetAmount > 0 ? b.usedAmount / b.budgetAmount : null;
                      const usageRatioText = usageRatio !== null ? (usageRatio * 100).toFixed(1) + "%" : "-";

                      // 执行节奏判断
                      const tp = yearOverview?.timeProgress ?? 0;
                      const theoreticalBudget = b.budgetAmount ? b.budgetAmount * tp : 0;
                      const paceFast = b.budgetAmount && b.budgetAmount > 0 && b.usedAmount > theoreticalBudget;

                      // 颜色：超预算→红 | 节奏偏快但未超→橙 | 正常→默认
                      const paceColor = over ? "#c00" : paceFast ? "#e67e22" : "#28a745";
                      const paceText = over ? "⚠ 已超预算" : paceFast ? "⚠ 支出节奏偏快" : "✓ 支出节奏正常";

                      return (
                        <tr key={b.categoryId}>
                          <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                            {b.categoryName}
                            {!b.isActive ? "（已停用）" : ""}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                            {b.budgetAmount === null ? "未设置" : formatYuanFromFen(b.budgetAmount)}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                            {formatYuanFromFen(b.usedAmount)}
                          </td>
                          <td
                            style={{
                              padding: 10,
                              borderBottom: "1px solid #f0f0f0",
                              textAlign: "right",
                              color: over ? "#c00" : "#333",
                              fontWeight: over ? 700 : 400,
                            }}
                          >
                            {b.remainingAmount === null ? "-" : remainText}
                          </td>
                          <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                            {usageRatioText}
                          </td>
                          <td
                            style={{
                              padding: 10,
                              borderBottom: "1px solid #f0f0f0",
                              textAlign: "center",
                              color: paceColor,
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {b.budgetAmount && b.budgetAmount > 0 ? paceText : "-"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {!!msg && (
        <div style={{ padding: 10, background: "#fff3cd", borderRadius: 8, marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div className="ft-only-desktop" style={{ overflowX: "auto", border: "1px solid #e3e8ef", borderRadius: 10, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1500 }}>
          <thead>
            <tr style={{ background: "#f6f8fa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "90px" }}>日期</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "60px" }}>收/支</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee", width: "100px" }}>金额（元）</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: "60px" }} title="是否已上传票据附件">票据</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "100px" }}>类别</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "90px" }}>基金</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "120px" }}>账户</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "90px" }}>经手人1</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "90px" }}>经手人2</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", minWidth: "150px" }}>备注</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "100px" }}>创建人</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "140px" }}>创建时间</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "100px" }}>最后修改人</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee", width: "140px" }}>最后修改时间</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", width: "80px" }}>操作</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={15} style={{ padding: 14, color: "#666" }}>
                  本月暂无流水
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const h1 = r.handler1_id ? memberMap.get(r.handler1_id) ?? "-" : "-";
                const h2 = r.handler2_id ? memberMap.get(r.handler2_id) ?? "-" : "-";
                const attCount = attachCountMap.get(r.id) ?? 0;

                return (
                  <tr key={r.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.date}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {r.direction === "income" ? "收入" : "支出"}
                    </td>
                    <td
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #f0f0f0",
                        textAlign: "right",
                        fontWeight: 700,
                        color: r.direction === "income" ? "#15803d" : "#b91c1c",
                      }}
                      className="ft-num"
                    >
                      {formatYuanFromFen(r.amount)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      {attCount > 0 ? (
                        <span
                          className="ft-chip ft-chip-info"
                          title={`已上传 ${attCount} 张票据，点“编辑”可查看`}
                        >
                          📎 {attCount}
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }} title="尚未上传票据">
                          —
                        </span>
                      )}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.categories?.name ?? "-"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", color: r.categories?.fund_type ? "#555" : "#bbb", fontSize: 12 }}>
                      {r.categories?.fund_type ? FUND_LABELS[r.categories.fund_type] : "—"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {r.accounts ? `${r.accounts.name}（${r.accounts.type === "cash" ? "现金" : "银行卡"}）` : "-"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{h1}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{h2}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.description ?? ""}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {resolveUserDisplay(r.created_by, userDisplayMap)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{fmtDateTimeMaybe(r.created_at)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {resolveUserDisplay(r.updated_by, userDisplayMap)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{fmtDateTimeMaybe(r.updated_at)}</td>

                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" }}>
                      {(userRole === "admin" || userRole === "finance") && (
                        <a
                          href={`/transactions/${r.id}/edit?from_year=${month.split("-")[0]}&from_month=${Number(month.split("-")[1])}`}
                          style={{
                            marginRight: 10,
                            color: "#0366d6",
                            textDecoration: "none",
                            border: "1px solid #0366d6",
                            padding: "4px 8px",
                            borderRadius: 4,
                            display: "inline-block",
                          }}
                        >
                          编辑
                        </a>
                      )}

                      {userRole === "admin" && (
                        <button
                          onClick={() => deleteRow(r.id)}
                          disabled={loading}
                          style={{
                            color: "#c00",
                            border: "1px solid #c00",
                            background: "transparent",
                            padding: "4px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          删除
                        </button>
                      )}

                      {userRole !== "admin" && userRole !== "finance" && (
                        <span style={{ color: "#999", fontSize: 12 }}>仅查看</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ===== 移动端：卡片式列表（宽表格在手机上无法阅读） ===== */}
      <div className="ft-only-mobile">
        {rows.length === 0 && !loading ? (
          <div className="ft-card" style={{ color: "#64748b" }}>本月暂无流水</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((r) => {
              const isIncome = r.direction === "income";
              const h1 = r.handler1_id ? memberMap.get(r.handler1_id) ?? "" : "";
              const h2 = r.handler2_id ? memberMap.get(r.handler2_id) ?? "" : "";
              const attCount = attachCountMap.get(r.id) ?? 0;

              return (
                <div key={r.id} className="ft-card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span
                      className={`ft-chip ${isIncome ? "ft-chip-success" : "ft-chip-danger"}`}
                      style={{ flex: "0 0 auto" }}
                    >
                      {isIncome ? "收入" : "支出"}
                    </span>
                    <span style={{ fontSize: 13, color: "#64748b" }}>{r.date}</span>
                    <span
                      className="ft-num"
                      style={{
                        marginLeft: "auto",
                        fontSize: 18,
                        fontWeight: 800,
                        color: isIncome ? "#15803d" : "#b91c1c",
                      }}
                    >
                      {isIncome ? "+" : "-"}¥{formatYuanFromFen(r.amount)}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, display: "grid", gap: 4 }}>
                    <div>
                      <span className="ft-muted">类别：</span>
                      {r.categories?.name ?? "-"}
                      {r.categories?.fund_type && (
                        <span className="ft-chip" style={{ marginLeft: 6 }}>
                          {FUND_LABELS[r.categories.fund_type]}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="ft-muted">账户：</span>
                      {r.accounts ? `${r.accounts.name}（${r.accounts.type === "cash" ? "现金" : "银行卡"}）` : "-"}
                    </div>
                    {(h1 || h2) && (
                      <div>
                        <span className="ft-muted">经手人：</span>
                        {[h1, h2].filter(Boolean).join(" / ")}
                      </div>
                    )}
                    {!!r.description && (
                      <div>
                        <span className="ft-muted">备注：</span>
                        {r.description}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid #f1f5f9",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {attCount > 0 ? (
                      <span className="ft-chip ft-chip-info">📎 {attCount} 张票据</span>
                    ) : (
                      <span className="ft-chip">无票据</span>
                    )}

                    {(userRole === "admin" || userRole === "finance") && (
                      <a
                        href={`/transactions/${r.id}/edit?from_year=${month.split("-")[0]}&from_month=${Number(
                          month.split("-")[1]
                        )}`}
                        className="ft-btn ft-btn-sm"
                        style={{ marginLeft: "auto" }}
                      >
                        编辑 / 票据
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
        金额在数据库中以“分（整数）”存储；导出 CSV 已加 UTF-8 BOM，Excel 打开中文不乱码；PDF 采用页面渲染方式生成，中文不会乱码。
      </div>
    </div>
  );
}
