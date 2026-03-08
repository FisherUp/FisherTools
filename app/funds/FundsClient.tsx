"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  fetchFundBalances,
  fetchFundAllocations,
  fetchAllocationSuggestion,
  createAllocationBatch,
  deleteAllocationGroup,
  fetchLocationSlots,
  upsertLocationSlots,
  ALL_FUND_TYPES,
  FUND_LABELS,
  FUND_RATIOS,
  ALLOCATION_TYPE_LABELS,
  type FundType,
  type FundBalanceSummary,
  type FundAllocation,
  type AllocationSuggestion,
  type AllocationTypeName,
  type LocationSlot,
} from "../../lib/services/fundService";

// -------------------------------------------------------
// 工具函数
// -------------------------------------------------------
function fmtYuan(fen: number): string {
  const yuan = fen / 100;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(yuan);
}

function toFen(yuanStr: string): number {
  const yuan = parseFloat(yuanStr);
  if (isNaN(yuan)) return 0;
  return Math.round(yuan * 100);
}

function fenToYuanStr(fen: number): string {
  return (fen / 100).toFixed(2);
}

// 将同一 allocation_group 的4条记录合并为一行展示
type AllocationGroupRow = {
  allocation_group: string;
  allocation_date: string;
  allocation_type: AllocationTypeName;
  note: string | null;
  amounts: Record<FundType, number>;
  created_at: string;
};

function groupAllocations(rows: FundAllocation[]): AllocationGroupRow[] {
  const map = new Map<string, AllocationGroupRow>();
  for (const r of rows) {
    if (!map.has(r.allocation_group)) {
      map.set(r.allocation_group, {
        allocation_group: r.allocation_group,
        allocation_date: r.allocation_date,
        allocation_type: r.allocation_type,
        note: r.note,
        amounts: { mission: 0, social_care: 0, city: 0, jh_operations: 0 },
        created_at: r.created_at,
      });
    }
    const entry = map.get(r.allocation_group)!;
    entry.amounts[r.fund_type] = r.amount;
  }
  const result = Array.from(map.values());
  result.sort((a, b) => b.allocation_date.localeCompare(a.allocation_date));
  return result;
}

// -------------------------------------------------------
// 基金余额卡片
// -------------------------------------------------------
const FUND_COLORS: Record<FundType, { bg: string; border: string; text: string }> = {
  mission: { bg: "#f0f7ff", border: "#4a90d9", text: "#1a5fa8" },
  social_care: { bg: "#f0fff4", border: "#38a169", text: "#276749" },
  city: { bg: "#fffbeb", border: "#d69e2e", text: "#975a16" },
  jh_operations: { bg: "#faf5ff", border: "#805ad5", text: "#553c9a" },
};

function BalanceCard({ summary }: { summary: FundBalanceSummary }) {
  const color = FUND_COLORS[summary.fund_type];
  const isNegative = summary.balance < 0;
  return (
    <div
      style={{
        flex: "1 1 200px",
        padding: "16px 20px",
        borderRadius: 12,
        border: `2px solid ${color.border}`,
        background: color.bg,
      }}
    >
      <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
        {FUND_LABELS[summary.fund_type]}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: isNegative ? "#c00" : color.text,
        }}
      >
        {fmtYuan(summary.balance)}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#888", lineHeight: 1.8 }}>
        <span>累计划拨：{fmtYuan(summary.total_allocated)}</span>
        <br />
        {summary.fund_type === "jh_operations" && (
          <>
            <span>期初后收入：{fmtYuan(summary.total_income)}</span>
            <br />
          </>
        )}
        <span>已使用：{fmtYuan(summary.total_expense)}</span>
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
        比例 {Math.round(FUND_RATIOS[summary.fund_type] * 100)}%
      </div>
    </div>
  );
}

// -------------------------------------------------------
// 主页面
// -------------------------------------------------------
export default function FundsClient() {
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const [balances, setBalances] = useState<FundBalanceSummary[]>([]);
  const [allocations, setAllocations] = useState<FundAllocation[]>([]);

  // ------ 资金分布状态 ------
  const [locationSlots, setLocationSlots] = useState<LocationSlot[]>([
    { slot_number: 1, label: "", amount: 0 },
    { slot_number: 2, label: "", amount: 0 },
    { slot_number: 3, label: "", amount: 0 },
  ]);
  // 编辑中的列表（元字符串输入）
  const [locationEdits, setLocationEdits] = useState<{ label: string; amountStr: string }[]>([
    { label: "", amountStr: "" },
    { label: "", amountStr: "" },
    { label: "", amountStr: "" },
  ]);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationMsg, setLocationMsg] = useState("");

  // ------ 划拨向导状态 ------
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardType, setWizardType] = useState<AllocationTypeName>("semi_annual");
  const [wizardDate, setWizardDate] = useState(() => {
    // 默认下一个半年节点（6/30 或 12/31）
    const today = new Date();
    return today.getMonth() < 6 ? `${today.getFullYear()}-06-30` : `${today.getFullYear()}-12-31`;
  });
  const [suggestion, setSuggestion] = useState<AllocationSuggestion | null>(null);
  const [wizardAmounts, setWizardAmounts] = useState<Record<FundType, string>>({
    mission: "",
    social_care: "",
    city: "",
    jh_operations: "",
  });
  const [wizardNote, setWizardNote] = useState("");
  const [wizardLoading, setWizardLoading] = useState(false);

  const isAdmin = role === "admin";

  // -------------------------------------------------------
  // 数据加载
  // -------------------------------------------------------
  const loadData = useCallback(async (oid: string) => {
    setLoading(true);
    try {
      const [bal, alloc, slots] = await Promise.all([
        fetchFundBalances(oid),
        fetchFundAllocations(oid),
        fetchLocationSlots(oid),
      ]);
      setBalances(bal);
      setAllocations(alloc);
      setLocationSlots(slots);
      setLocationEdits(slots.map((s) => ({
        label: s.label,
        amountStr: s.amount === 0 ? "" : (s.amount / 100).toFixed(2),
      })));
    } catch (e: unknown) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  // -------------------------------------------------------
  // 初始化
  // -------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      setMsg("");
      try {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error("请先登录");
        const uid = userRes.user.id;

        const { data: profile, error: pErr } = await supabase
          .from("profiles")
          .select("org_id, role")
          .eq("id", uid)
          .single();
        if (pErr || !profile?.org_id) throw new Error("读取用户信息失败");

        setUserId(uid);
        setOrgId(String(profile.org_id));
        setRole(String(profile.role ?? ""));

        await loadData(String(profile.org_id));
      } catch (e: unknown) {
        setMsg(String((e as Error)?.message ?? e));
      }
    };
    init();
  }, [loadData]);

  // -------------------------------------------------------
  // 计算划拨建议
  // -------------------------------------------------------
  const calcSuggestion = async () => {
    if (!orgId || !wizardDate) return;
    setWizardLoading(true);
    setMsg("");
    try {
      const s = await fetchAllocationSuggestion(orgId, wizardDate);
      setSuggestion(s);
      // 预填建议金额（元）
      const next: Record<FundType, string> = {
        mission: fenToYuanStr(s.suggestions.mission),
        social_care: fenToYuanStr(s.suggestions.social_care),
        city: fenToYuanStr(s.suggestions.city),
        jh_operations: fenToYuanStr(s.suggestions.jh_operations),
      };
      setWizardAmounts(next);
    } catch (e: unknown) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setWizardLoading(false);
    }
  };

  // 向导打开或日期变化时自动计算
  useEffect(() => {
    if (wizardOpen && orgId && wizardDate) {
      calcSuggestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, wizardDate, orgId]);

  // -------------------------------------------------------
  // 提交划拨
  // -------------------------------------------------------
  const onSubmitAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return setMsg("仅管理员可录入划拨。");
    if (!wizardDate) return setMsg("请选择划拨日期");

    const amounts: Record<FundType, number> = {
      mission: toFen(wizardAmounts.mission),
      social_care: toFen(wizardAmounts.social_care),
      city: toFen(wizardAmounts.city),
      jh_operations: toFen(wizardAmounts.jh_operations),
    };

    for (const ft of ALL_FUND_TYPES) {
      if (amounts[ft] < 0) return setMsg(`${FUND_LABELS[ft]}金额不能为负数`);
    }

    setLoading(true);
    setMsg("");
    try {
      await createAllocationBatch(orgId, wizardDate, wizardType, amounts, wizardNote, userId);
      setMsg("✅ 划拨已录入");
      setWizardOpen(false);
      setWizardNote("");
      setSuggestion(null);
      await loadData(orgId);
    } catch (e: unknown) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------
  // 删除划拨批次
  // -------------------------------------------------------
  const onDeleteGroup = async (group: AllocationGroupRow) => {
    if (!isAdmin) return;
    if (!confirm(`确认删除 ${group.allocation_date} 的${ALLOCATION_TYPE_LABELS[group.allocation_type]}记录？此操作不可撤销。`)) return;
    setLoading(true);
    setMsg("");
    try {
      await deleteAllocationGroup(orgId, group.allocation_group);
      setMsg("✅ 已删除划拨记录");
      await loadData(orgId);
    } catch (e: unknown) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const groupedAllocations = groupAllocations(allocations);

  // -------------------------------------------------------
  // 保存资金存放位置
  // -------------------------------------------------------
  const totalBalance = balances.reduce((s, b) => s + b.balance, 0);

  const onSaveLocations = async () => {
    if (!isAdmin) return;
    setLocationSaving(true);
    setLocationMsg("");
    try {
      const slots: LocationSlot[] = locationEdits.map((e, i) => ({
        slot_number: (i + 1) as 1 | 2 | 3,
        label: e.label.trim(),
        amount: Math.round((parseFloat(e.amountStr) || 0) * 100),
      }));
      await upsertLocationSlots(orgId, slots, userId);
      setLocationSlots(slots);
      setLocationMsg("✅ 已保存");
    } catch (e: unknown) {
      setLocationMsg(String((e as Error)?.message ?? e));
    } finally {
      setLocationSaving(false);
    }
  };

  // -------------------------------------------------------
  // 渲染
  // -------------------------------------------------------
  return (
    <div style={{ maxWidth: 1080, margin: "40px auto", padding: 16 }}>
      {/* 标题栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>🏦 基金管理</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/categories" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            类别管理
          </a>
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
            ← 返回流水
          </a>
        </div>
      </div>

      {!!msg && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 8,
            background: msg.startsWith("✅") ? "#d4edda" : "#fff3cd",
            color: msg.startsWith("✅") ? "#155724" : "#856404",
          }}
        >
          {msg}
        </div>
      )}

      {/* ─── 1. 余额总览 ─── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#333" }}>基金余额总览</h2>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
          余额 = 累计划拨金额 − 该基金下归属支出合计
        </div>
        {loading ? (
          <div style={{ color: "#999" }}>加载中...</div>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {balances.length > 0
              ? balances.map((b) => <BalanceCard key={b.fund_type} summary={b} />)
              : ALL_FUND_TYPES.map((ft) => (
                  <BalanceCard
                    key={ft}
                    summary={{ fund_type: ft, total_allocated: 0, total_income: 0, total_expense: 0, balance: 0 }}
                  />
                ))}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "#888",
            padding: "8px 12px",
            background: "#f9f9f9",
            borderRadius: 6,
          }}
        >
          💡 <strong>基金归属规则</strong>：所有收入归入 JH 总收入池，每半年由管理员按比例划拨（宣教 50% / 社会关抅20% / 城幵20% / JH运营 10%）。支出通过「类别」归属到对应基金。请在{" "}
          <a href="/categories" style={{ color: "#0070f3" }}>类别管理</a> 中为每个支出类别设置基金归属。
        </div>
      </section>

      {/* ─── 2. 资金分布 ─── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#333" }}>资金分布</h2>

        {/* 总额显示 */}
        <div
          style={{
            display: "inline-block",
            marginBottom: 16,
            padding: "10px 20px",
            background: "#1a1a2e",
            borderRadius: 10,
            color: "#fff",
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.7 }}>全部基金总额</span>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 2 }}>{fmtYuan(totalBalance)}</div>
        </div>

        {/* 4 个位置 */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #eee", width: 40 }}>NO.</th>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #eee", minWidth: 180 }}>位置名称</th>
                <th style={{ textAlign: "right", padding: "8px 12px", borderBottom: "2px solid #eee", width: 160 }}>金额（元）</th>
                <th style={{ textAlign: "right", padding: "8px 12px", borderBottom: "2px solid #eee", width: 120 }}>占比</th>
              </tr>
            </thead>
            <tbody>
              {locationEdits.map((edit, i) => {
                const fenAmt = Math.round((parseFloat(edit.amountStr) || 0) * 100);
                const pct = totalBalance > 0 ? ((fenAmt / totalBalance) * 100).toFixed(1) : "-";
                return (
                  <tr key={i}>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", color: "#999", fontSize: 12 }}>{i + 1}</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0" }}>
                      {isAdmin ? (
                        <input
                          value={edit.label}
                          onChange={(ev) => {
                            const next = [...locationEdits];
                            next[i] = { ...next[i], label: ev.target.value };
                            setLocationEdits(next);
                          }}
                          placeholder={`位置 ${i + 1}（如：中国银行）`}
                          style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", width: "100%", fontSize: 13 }}
                        />
                      ) : (
                        <span style={{ fontSize: 13 }}>{locationSlots[i]?.label || <span style={{ color: "#bbb" }}>未命名</span>}</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                      {isAdmin ? (
                        <input
                          value={edit.amountStr}
                          onChange={(ev) => {
                            const next = [...locationEdits];
                            next[i] = { ...next[i], amountStr: ev.target.value };
                            setLocationEdits(next);
                          }}
                          placeholder="0.00"
                          style={{ border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", width: 120, textAlign: "right", fontSize: 13 }}
                        />
                      ) : (
                        <strong style={{ fontSize: 13 }}>{fmtYuan(locationSlots[i]?.amount ?? 0)}</strong>
                      )}
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontSize: 12, color: "#888" }}>
                      {pct === "-" ? "-" : `${pct}%`}
                    </td>
                  </tr>
                );
              })}
              {/* 第 4 行：自动计算 = 总额 - 前三项之和 */}
              {(() => {
                const slot123 = locationEdits.reduce(
                  (s, e) => s + Math.round((parseFloat(e.amountStr) || 0) * 100), 0
                );
                const remainder = totalBalance - slot123;
                const pct = totalBalance > 0 ? ((remainder / totalBalance) * 100).toFixed(1) : "-";
                return (
                  <tr style={{ background: "#f9f9f9" }}>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #e8e8e8", color: "#999", fontSize: 12 }}>4</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #e8e8e8", fontSize: 13, color: "#555", fontStyle: "italic" }}>其他（自动计算）</td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #e8e8e8", textAlign: "right" }}>
                      <strong style={{ fontSize: 13, color: remainder < 0 ? "#c00" : "#333" }}>{fmtYuan(remainder)}</strong>
                    </td>
                    <td style={{ padding: "8px 12px", borderBottom: "1px solid #e8e8e8", textAlign: "right", fontSize: 12, color: "#888" }}>
                      {pct === "-" ? "-" : `${pct}%`}
                    </td>
                  </tr>
                );
              })()}
              {/* 合计行 */}
              <tr style={{ background: "#f0f0f0", fontWeight: 700 }}>
                <td style={{ padding: "8px 12px", fontSize: 12 }} />
                <td style={{ padding: "8px 12px", fontSize: 13 }}>合计</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 13 }}>{fmtYuan(totalBalance)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontSize: 12 }}>100%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 保存按钮（仅 admin） */}
        {isAdmin && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={onSaveLocations}
              disabled={locationSaving}
              style={{
                padding: "8px 20px",
                background: locationSaving ? "#ccc" : "#1a1a2e",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: locationSaving ? "default" : "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {locationSaving ? "保存中..." : "💾 保存分布记录"}
            </button>
            {locationMsg && (
              <span style={{ fontSize: 12, color: locationMsg.startsWith("✅") ? "#276749" : "#c00" }}>
                {locationMsg}
              </span>
            )}
          </div>
        )}
      </section>

      {/* ─── 3. 划拨向导 ─── */}
      {isAdmin && (
        <section style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: wizardOpen ? "#f0f7ff" : "#fafafa",
              border: `1px solid ${wizardOpen ? "#4a90d9" : "#e0e0e0"}`,
              borderRadius: wizardOpen ? "10px 10px 0 0" : 10,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => setWizardOpen((v) => !v)}
          >
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {wizardOpen ? "▼" : "▶"} 录入划拨
            </span>
            <span style={{ fontSize: 12, color: "#888", marginLeft: 4 }}>
              （半年划拨 / 期初余额 / 手动调整）
            </span>
          </div>

          {wizardOpen && (
            <div
              style={{
                border: "1px solid #4a90d9",
                borderTop: "none",
                borderRadius: "0 0 10px 10px",
                padding: 20,
                background: "#f9fcff",
              }}
            >
              {/* 类型选择 */}
              <div style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontWeight: 600, fontSize: 13 }}>划拨类型：</label>
                {(["semi_annual", "opening_balance", "adjustment"] as AllocationTypeName[]).map((t) => (
                  <label key={t} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="wizardType"
                      value={t}
                      checked={wizardType === t}
                      onChange={() => setWizardType(t)}
                    />
                    {ALLOCATION_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>

              {/* 日期 */}
              <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontWeight: 600, fontSize: 13 }}>
                  划拨日期：
                  <input
                    type="date"
                    value={wizardDate}
                    onChange={(e) => setWizardDate(e.target.value)}
                    style={{ marginLeft: 8, padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc" }}
                  />
                </label>
                <button
                  type="button"
                  onClick={calcSuggestion}
                  disabled={wizardLoading}
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #4a90d9",
                    background: "#fff",
                    color: "#4a90d9",
                    cursor: "pointer",
                  }}
                >
                  {wizardLoading ? "计算中..." : "🔄 重新计算建议"}
                </button>
              </div>

              {/* 建议说明 */}
              {suggestion && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: "10px 14px",
                    background: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "#444",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "#333" }}>
                    📊 建议计算依据
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", lineHeight: 2 }}>
                    <span>
                      计算期间：
                      <strong>
                        {suggestion.period_start} → {suggestion.end_date}
                      </strong>
                    </span>
                    <span>
                      期间收入合计：<strong>{fmtYuan(suggestion.total_income)}</strong>
                    </span>
                    <span>
                      JH运营支出：<strong>{fmtYuan(suggestion.jh_expense)}</strong>
                    </span>
                    <span>
                      三基金直接支出：
                      <strong>{fmtYuan(suggestion.direct_fund_expense)}</strong>
                      <span style={{ fontSize: 11, color: "#888", marginLeft: 4 }}>（不入JH池）</span>
                    </span>
                    <span style={{ color: suggestion.net_amount >= 0 ? "#276749" : "#c00" }}>
                      JH池净余额（划拨基数）：<strong>{fmtYuan(suggestion.net_amount)}</strong>
                      {suggestion.net_amount < 0 && "（净亏损，建议金额置为0）"}
                    </span>
                  </div>
                </div>
              )}

              {/* 金额输入 */}
              <form onSubmit={onSubmitAllocation}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", marginBottom: 16 }}>
                  {ALL_FUND_TYPES.map((ft) => (
                    <label key={ft} style={{ fontSize: 13 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4, color: FUND_COLORS[ft].text }}>
                        {FUND_LABELS[ft]}
                        <span style={{ fontWeight: 400, fontSize: 11, color: "#888", marginLeft: 4 }}>
                          （{Math.round(FUND_RATIOS[ft] * 100)}%）
                        </span>
                        {suggestion && (
                          <span style={{ fontWeight: 400, fontSize: 11, color: "#4a90d9", marginLeft: 8 }}>
                            建议：{fmtYuan(suggestion.suggestions[ft])}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: "#666" }}>¥</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={wizardAmounts[ft]}
                          onChange={(e) =>
                            setWizardAmounts((prev) => ({ ...prev, [ft]: e.target.value }))
                          }
                          style={{
                            width: "100%",
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #ccc",
                            fontSize: 14,
                          }}
                          placeholder="0.00"
                        />
                      </div>
                    </label>
                  ))}
                </div>

                {/* 合计展示 */}
                <div style={{ marginBottom: 14, fontSize: 13, color: "#555" }}>
                  本次划拨合计：
                  <strong style={{ fontSize: 15, color: "#333", marginLeft: 6 }}>
                    {fmtYuan(
                      ALL_FUND_TYPES.reduce((sum, ft) => sum + toFen(wizardAmounts[ft]), 0)
                    )}
                  </strong>
                  {suggestion && (
                    <span style={{ fontSize: 11, color: "#888", marginLeft: 10 }}>
                      （建议合计：{fmtYuan(suggestion.net_amount > 0 ? suggestion.net_amount : 0)}）
                    </span>
                  )}
                </div>

                {/* 备注 */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    备注（可选）：
                    <textarea
                      value={wizardNote}
                      onChange={(e) => setWizardNote(e.target.value)}
                      rows={2}
                      style={{
                        display: "block",
                        width: "100%",
                        marginTop: 6,
                        padding: "8px 10px",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        fontSize: 13,
                        resize: "vertical",
                      }}
                      placeholder="如：2026年上半年划拨"
                    />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      padding: "8px 20px",
                      fontWeight: 700,
                      borderRadius: 6,
                      background: "#1a5fa8",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    {loading ? "录入中..." : "✅ 确认录入划拨"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardOpen(false)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 6,
                      border: "1px solid #ddd",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      )}

      {/* ─── 4. 划拨记录表 ─── */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: "#333" }}>
          划拨记录
          <span style={{ fontSize: 12, fontWeight: 400, color: "#888", marginLeft: 8 }}>
            （共 {groupedAllocations.length} 次）
          </span>
        </h2>

        <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                  日期
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                  类型
                </th>
                <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid #eee", color: FUND_COLORS.mission.text, whiteSpace: "nowrap" }}>
                  宣教基金（50%）
                </th>
                <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid #eee", color: FUND_COLORS.social_care.text, whiteSpace: "nowrap" }}>
                  社会关怀（20%）
                </th>
                <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid #eee", color: FUND_COLORS.city.text, whiteSpace: "nowrap" }}>
                  城市基金（20%）
                </th>
                <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid #eee", color: FUND_COLORS.jh_operations.text, whiteSpace: "nowrap" }}>
                  JH运营（10%）
                </th>
                <th style={{ textAlign: "right", padding: "10px 12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                  合计
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #eee" }}>
                  备注
                </th>
                {isAdmin && (
                  <th style={{ padding: "10px 12px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                    操作
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {groupedAllocations.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdmin ? 9 : 8}
                    style={{ padding: 20, color: "#999", textAlign: "center" }}
                  >
                    暂无划拨记录。请先录入各基金期初余额（2026-01-01），再录入半年划拨。
                  </td>
                </tr>
              ) : (
                groupedAllocations.map((g) => {
                  const total = ALL_FUND_TYPES.reduce((s, ft) => s + g.amounts[ft], 0);
                  return (
                    <tr key={g.allocation_group} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {g.allocation_date}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 600,
                            background:
                              g.allocation_type === "opening_balance"
                                ? "#e8f5e9"
                                : g.allocation_type === "semi_annual"
                                ? "#e3f2fd"
                                : "#fff3e0",
                            color:
                              g.allocation_type === "opening_balance"
                                ? "#2e7d32"
                                : g.allocation_type === "semi_annual"
                                ? "#1565c0"
                                : "#e65100",
                          }}
                        >
                          {ALLOCATION_TYPE_LABELS[g.allocation_type]}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtYuan(g.amounts.mission)}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtYuan(g.amounts.social_care)}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtYuan(g.amounts.city)}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmtYuan(g.amounts.jh_operations)}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {fmtYuan(total)}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#555", fontSize: 12, maxWidth: 180 }}>
                        {g.note ?? "—"}
                      </td>
                      {isAdmin && (
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <button
                            type="button"
                            onClick={() => onDeleteGroup(g)}
                            style={{
                              padding: "3px 10px",
                              fontSize: 12,
                              border: "1px solid #c00",
                              color: "#c00",
                              background: "#fff",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                          >
                            删除
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {groupedAllocations.length > 0 && (
              <tfoot>
                <tr style={{ background: "#fafafa", fontWeight: 700 }}>
                  <td style={{ padding: "10px 12px" }} colSpan={2}>
                    合计
                  </td>
                  {ALL_FUND_TYPES.map((ft) => (
                    <td key={ft} style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {fmtYuan(groupedAllocations.reduce((s, g) => s + g.amounts[ft], 0))}
                    </td>
                  ))}
                  <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtYuan(
                      groupedAllocations.reduce(
                        (s, g) => s + ALL_FUND_TYPES.reduce((s2, ft) => s2 + g.amounts[ft], 0),
                        0
                      )
                    )}
                  </td>
                  <td colSpan={isAdmin ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
