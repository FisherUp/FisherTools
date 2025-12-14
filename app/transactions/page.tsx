"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Row = {
  id: string;
  date: string; // yyyy-mm-dd
  amount: number; // 分
  direction: "income" | "expense";
  description: string | null;
  accounts: { name: string; type: "cash" | "bank" } | null;
  categories: { name: string } | null;
};

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

export default function TransactionsPage() {
  // 默认选当前月份（YYYY-MM）
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // ✅ 当前登录用户信息
  const [userEmail, setUserEmail] = useState<string>("");
  const [userRole, setUserRole] = useState<string>("");
  const [orgId, setOrgId] = useState<string>("");

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

  // ✅ 读取当前用户邮箱 + role + org_id
  const loadCurrentUser = async () => {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setUserEmail("");
      setUserRole("");
      setOrgId("");
      return;
    }

    setUserEmail(userRes.user.email ?? "");

    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("role, org_id")
      .eq("id", userRes.user.id)
      .single();

    if (!pErr && profile) {
      setUserRole(profile.role ?? "");
      setOrgId(profile.org_id ? String(profile.org_id) : "");
    }
  };

  const load = async () => {
    setLoading(true);
    setMsg("");
    try {
      const { data, error } = await supabase
        .from("transactions")
        // 依赖外键 references accounts(id), categories(id)
        .select(
          `
          id,
          date,
          amount,
          direction,
          description,
          accounts ( name, type ),
          categories ( name )
        `
        )
        .gte("date", fromDate)
        .lt("date", toDate)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        setMsg("加载流水失败：" + error.message);
        setRows([]);
        return;
      }

      const list: Row[] = Array.isArray(data)
        ? data.map((x: any) => ({
            id: String(x.id),
            date: String(x.date),
            amount: Number(x.amount),
            direction: x.direction,
            description: x.description ?? null,
            accounts: x.accounts ?? null,
            categories: x.categories ?? null,
          }))
        : [];

      setRows(list);
    } finally {
      setLoading(false);
    }
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

  // 导出当月明细 CSV（Excel 友好：加 BOM）
  const exportCsv = () => {
    if (rows.length === 0) {
      alert("本月暂无流水可导出");
      return;
    }

    const header = ["日期", "收支", "金额（元）", "类别", "账户", "账户类型", "备注"];

    const lines = rows.map((r) => {
      const accountName = r.accounts?.name ?? "";
      const accountType =
        r.accounts?.type === "cash" ? "现金" : r.accounts?.type === "bank" ? "银行卡" : "";
      const categoryName = r.categories?.name ?? "";
      const direction = r.direction === "income" ? "收入" : "支出";
      const amountYuan = formatYuanFromFen(r.amount);
      const desc = r.description ?? "";

      return [r.date, direction, amountYuan, categoryName, accountName, accountType, desc]
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

  // ✅ 年度汇总（12 个月）CSV：从数据库拉该年所有流水后按月聚合
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
        const m = String((r as any).date).slice(0, 7); // YYYY-MM
        if (!monthMap.has(m)) monthMap.set(m, { income: 0, expense: 0 });
        const item = monthMap.get(m)!;
        const dir = (r as any).direction as "income" | "expense";
        const amt = Number((r as any).amount);
        if (dir === "income") item.income += amt;
        else item.expense += amt;
      }

      // 补齐 12 个月
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

  useEffect(() => {
    loadCurrentUser();
    load();
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

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>流水列表</h1>

        {/* ✅ 当前用户信息 */}
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
              >
                {userRole}
              </span>
            )}

            {!!orgId && (
              <span style={{ color: "#666", fontSize: 12 }}>
                org: {orgId.slice(0, 8)}…
              </span>
            )}
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 14 }}>
            月份：
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ marginLeft: 8, padding: 6 }}
            />
          </label>

          <button onClick={load} disabled={loading} style={{ padding: "8px 12px", fontWeight: 700 }}>
            {loading ? "刷新中..." : "刷新"}
          </button>

          <button onClick={exportCsv} disabled={loading || rows.length === 0} style={{ padding: "8px 12px", fontWeight: 700 }}>
            明细CSV
          </button>

          <button
            onClick={exportMonthlySummaryCsv}
            disabled={loading || rows.length === 0}
            style={{ padding: "8px 12px", fontWeight: 700 }}
          >
            月度汇总CSV
          </button>

          <button onClick={exportYearlySummaryCsv} disabled={loading} style={{ padding: "8px 12px", fontWeight: 700 }}>
            年度汇总CSV
          </button>

          <a href="/transactions/new" style={{ padding: "8px 12px", fontWeight: 700 }}>
            + 新增
          </a>

          <button
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            style={{ padding: "8px 12px", fontWeight: 700 }}
          >
            退出
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
        筛选范围：{fromDate} ～ {toDate}（不含 {toDate}）
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
          收入合计：<b>{formatYuanFromFen(summary.income)}</b> 元
        </div>
        <div style={{ background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
          支出合计：<b>{formatYuanFromFen(summary.expense)}</b> 元
        </div>
        <div style={{ background: "#f5f5f5", padding: 10, borderRadius: 8 }}>
          净额：<b>{formatYuanFromFen(summary.net)}</b> 元
        </div>
      </div>

      {!!msg && (
        <div style={{ padding: 10, background: "#fff3cd", borderRadius: 8, marginBottom: 12 }}>
          {msg}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>日期</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>收/支</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>金额（元）</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类别</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>账户</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>备注</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 14, color: "#666" }}>
                  本月暂无流水
                </td>
              </tr>
            ) : (
              rows.map((r) => (
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
                    }}
                  >
                    {formatYuanFromFen(r.amount)}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.categories?.name ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                    {r.accounts ? `${r.accounts.name}（${r.accounts.type === "cash" ? "现金" : "银行卡"}）` : "-"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.description ?? ""}</td>

                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                    <a
                      href={`/transactions/${r.id}/edit`}
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
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
        金额在数据库中以“分（整数）”存储；导出 CSV 已加 UTF-8 BOM，Excel 打开中文不乱码。
      </div>
    </div>
  );
}
