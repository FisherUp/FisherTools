"use client";

import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { supabase } from "../../lib/supabaseClient";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../lib/services/userDisplay";

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
  categories: { name: string } | null;
  handler1_id: string | null;
  handler2_id: string | null;
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

/** ✅ 关键：稳定读取大字体（Noto CJK 很大），不要用 btoa(binary) 那套 */
async function fetchAsBase64Stable(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`读取字体失败：${res.status} ${res.statusText}（${url}）`);
  const blob = await res.blob();

  const base64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader 读取字体失败"));
    reader.onload = () => {
      const result = String(reader.result || "");
      // data:font/otf;base64,XXXX
      const idx = result.indexOf("base64,");
      if (idx < 0) reject(new Error("字体 DataURL 格式异常"));
      else resolve(result.slice(idx + "base64,".length));
    };
    reader.readAsDataURL(blob);
  });

  return base64;
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
  const [orgName, setOrgName] = useState<string>("");

  // ✅ members 映射：id -> name（用于显示经手人）
  const [memberMap, setMemberMap] = useState<Map<string, string>>(new Map());

  // ✅ users 映射：id -> display（用于显示创建/修改人）
  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());

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

  /** ✅ PDF导出：中文不乱码 + 不可编辑(至少不可轻易编辑) + 包含导出信息 */
  const exportPdf = async () => {
    if (!rows || rows.length === 0) {
      alert("本月暂无流水可导出");
      return;
    }

    // ⚠️ 这里的路径/文件名必须与你 public 目录一致
    const fontBase64 = await fetchAsBase64Stable("/fonts/NotoSansCJKsc-Regular.otf");

    const doc = new jsPDF({ unit: "pt", format: "a4" });

    doc.addFileToVFS("NotoSansCJKsc-Regular.otf", fontBase64);
    doc.addFont("NotoSansCJKsc-Regular.otf", "NotoSansCJK", "normal");
    doc.setFont("NotoSansCJK", "normal");

    const now = new Date();

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    const lineH = 18;

    let y = margin;

    // 标题区
    doc.setFontSize(16);
    doc.text(`流水导出（${month}）`, margin, y);
    y += lineH;

    doc.setFontSize(10);
    doc.text(`导出人：${userEmail || "-"}`, margin, y);
    y += lineH;
    doc.text(`角色：${userRole || "-"}`, margin, y);
    y += lineH;
    doc.text(`组织：${orgName || (orgId ? orgId.slice(0, 8) + "…" : "-")}`, margin, y);
    y += lineH;
    doc.text(`导出时间：${fmtDateTime(now)}`, margin, y);
    y += lineH;

    y += 6;
    doc.line(margin, y, pageW - margin, y);
    y += lineH;

    // 列布局（A4 宽度有限，尽量紧凑）
    doc.setFontSize(9);

    const cols = {
      date: margin,
      dir: margin + 70,
      amt: margin + 120,
      cat: margin + 190,
      acc: margin + 265,
      h1: margin + 355,
      h2: margin + 425,
      desc: margin + 495,
    };

    const maxDescWidth = pageW - margin - cols.desc;

    // 表头
    doc.text("日期", cols.date, y);
    doc.text("收支", cols.dir, y);
    doc.text("金额", cols.amt, y);
    doc.text("类别", cols.cat, y);
    doc.text("账户", cols.acc, y);
    doc.text("经手1", cols.h1, y);
    doc.text("经手2", cols.h2, y);
    doc.text("备注", cols.desc, y);
    y += 10;
    doc.line(margin, y, pageW - margin, y);
    y += lineH;

    const safeText = (s: any) => String(s ?? "");

    for (const r of rows) {
      const date = safeText(r.date);
      const direction = r.direction === "income" ? "收入" : "支出";
      const amountYuan = ((Number(r.amount) || 0) / 100).toFixed(2);
      const categoryName = safeText(r.categories?.name ?? "-");
      const accountText = r.accounts
        ? `${r.accounts.name}（${r.accounts.type === "cash" ? "现金" : "银行卡"}）`
        : "-";

      const h1 = r.handler1_id ? memberMap.get(r.handler1_id) ?? "-" : "-";
      const h2 = r.handler2_id ? memberMap.get(r.handler2_id) ?? "-" : "-";
      const desc = safeText(r.description ?? "");

      // 换页
      if (y > pageH - margin) {
        doc.addPage();
        doc.setFont("NotoSansCJK", "normal"); // ✅ 修正：不要写错字体名
        doc.setFontSize(9);
        y = margin;

        // 新页重画表头
        doc.text("日期", cols.date, y);
        doc.text("收支", cols.dir, y);
        doc.text("金额", cols.amt, y);
        doc.text("类别", cols.cat, y);
        doc.text("账户", cols.acc, y);
        doc.text("经手1", cols.h1, y);
        doc.text("经手2", cols.h2, y);
        doc.text("备注", cols.desc, y);
        y += 10;
        doc.line(margin, y, pageW - margin, y);
        y += lineH;
      }

      // 账户列 & 备注列可能换行
      const accLines = doc.splitTextToSize(safeText(accountText), cols.h1 - cols.acc - 6);
      const descLines = doc.splitTextToSize(desc, maxDescWidth);

      const usedLines = Math.max(
        1,
        Array.isArray(accLines) ? accLines.length : 1,
        Array.isArray(descLines) ? descLines.length : 1
      );

      doc.text(date, cols.date, y);
      doc.text(direction, cols.dir, y);
      doc.text(amountYuan, cols.amt, y);
      doc.text(categoryName, cols.cat, y);
      doc.text(accLines, cols.acc, y);
      doc.text(String(h1), cols.h1, y);
      doc.text(String(h2), cols.h2, y);
      doc.text(descLines, cols.desc, y);

      y += lineH * usedLines;
    }

    doc.save(`流水_${month}.pdf`);
  };

  useEffect(() => {
    const loadAll = async () => {
      const oid = await loadCurrentUser();
      await load(oid);
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

  return (
    <div style={{ maxWidth: 1150, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>流水列表</h1>

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

          <button
            onClick={exportCsv}
            disabled={loading || rows.length === 0}
            style={{ padding: "8px 12px", fontWeight: 700 }}
          >
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

          <button
            onClick={async () => {
              try {
                await exportPdf();
              } catch (e: any) {
                alert("导出PDF失败：" + String(e?.message ?? e));
              }
            }}
            disabled={loading || rows.length === 0}
            style={{ padding: "8px 12px", fontWeight: 700 }}
          >
            PDF导出
          </button>

          <a href="/transactions/new" style={{ padding: "8px 12px", fontWeight: 700 }}>
            + 新增
          </a>

          {userRole === "admin" && (
            <a href="/members" style={{ padding: "8px 12px", fontWeight: 700 }}>
              经手人管理
            </a>
          )}

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
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1320 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>日期</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>收/支</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>金额（元）</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类别</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>账户</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>经手人1</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>经手人2</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>备注</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>创建人</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>创建时间</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>最后修改人</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>最后修改时间</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={13} style={{ padding: 14, color: "#666" }}>
                  本月暂无流水
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const h1 = r.handler1_id ? memberMap.get(r.handler1_id) ?? "-" : "-";
                const h2 = r.handler2_id ? memberMap.get(r.handler2_id) ?? "-" : "-";

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
                      }}
                    >
                      {formatYuanFromFen(r.amount)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{r.categories?.name ?? "-"}</td>
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
                );
              })
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
