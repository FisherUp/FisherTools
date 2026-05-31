"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchUserDisplayMap, resolveUserDisplay, type UserDisplayMap } from "../../lib/services/userDisplay";
import {
  ENTRY_TYPE_LABELS,
  STATUS_LABELS,
  confirmProxyDraft,
  deleteDraft,
  errMsg,
  fetchDraftTransactions,
  getMyProfile,
  transferDraftToTransaction,
  type DraftEntryType,
  type DraftStatus,
  type DraftTransaction,
} from "../../lib/services/draftService";
import { supabase } from "../../lib/supabaseClient";

function fmtYuan(fen: number) {
  return (fen / 100).toFixed(2);
}

function fmtDate(v: string | null) {
  if (!v) return "-";
  return v.slice(0, 10);
}

type Member = { id: string; name: string };

const STATUS_STYLE: Record<DraftStatus, { bg: string; color: string }> = {
  pending: { bg: "#fff3e0", color: "#e65100" },
  confirmed: { bg: "#e8f5e9", color: "#2e7d32" },
  transferred: { bg: "#e3f2fd", color: "#1565c0" },
};

const TYPE_STYLE: Record<DraftEntryType, { bg: string; color: string }> = {
  reimbursement: { bg: "#ede7f6", color: "#5e35b1" },
  proxy: { bg: "#fce4ec", color: "#c2185b" },
};

export default function DraftsClient() {
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [rows, setRows] = useState<DraftTransaction[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [userMap, setUserMap] = useState<UserDisplayMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>("");
  const [msg, setMsg] = useState("");

  const [filterType, setFilterType] = useState<"all" | DraftEntryType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | DraftStatus>("all");

  const isAdmin = role === "admin";
  const canWrite = role === "admin" || role === "finance" || role === "coordinator";

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setUserId(profile.userId);
      setRole(profile.role);

      const [drafts, { data: memData }] = await Promise.all([
        fetchDraftTransactions(profile.orgId),
        supabase.from("members").select("id,name").eq("org_id", profile.orgId),
      ]);

      setRows(drafts);

      const memMap: Record<string, string> = {};
      (memData as Member[] | null)?.forEach((m) => {
        memMap[String(m.id)] = String(m.name);
      });
      setMembers(memMap);

      const userIds = Array.from(
        new Set(
          drafts
            .flatMap((d) => [d.created_by, d.confirmed_by, d.transferred_by])
            .filter((x): x is string => !!x)
        )
      );
      if (userIds.length > 0) {
        setUserMap(await fetchUserDisplayMap(userIds, profile.orgId));
      }
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter(
      (r) =>
        (filterType === "all" || r.entry_type === filterType) &&
        (filterStatus === "all" || r.status === filterStatus)
    );
  }, [rows, filterType, filterStatus]);

  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending");
    const pendingReimb = pending.filter((r) => r.entry_type === "reimbursement");
    const pendingProxy = pending.filter((r) => r.entry_type === "proxy");
    const sum = (list: DraftTransaction[], dir: "income" | "expense") =>
      list.filter((r) => r.direction === dir).reduce((a, r) => a + r.amount, 0);
    return {
      pendingCount: pending.length,
      pendingReimbExpense: sum(pendingReimb, "expense"),
      pendingProxyCount: pendingProxy.length,
    };
  }, [rows]);

  const onDelete = async (d: DraftTransaction) => {
    if (!confirm("确定删除该草稿吗？此操作不可恢复。")) return;
    setBusyId(d.id);
    try {
      await deleteDraft(d.id);
      await load();
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusyId("");
    }
  };

  const onConfirm = async (d: DraftTransaction) => {
    if (!confirm("确认后该代办账目将被锁定，不可再修改，确定吗？")) return;
    setBusyId(d.id);
    try {
      await confirmProxyDraft(d, userId);
      await load();
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusyId("");
    }
  };

  const onTransfer = async (d: DraftTransaction) => {
    if (!confirm("将该草稿转移至正式收支流水？转移后草稿锁定不可修改。")) return;
    setBusyId(d.id);
    try {
      await transferDraftToTransaction(d, orgId, userId);
      await load();
      alert("✅ 已转移至正式流水。");
    } catch (e) {
      alert(errMsg(e));
    } finally {
      setBusyId("");
    }
  };

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 8px",
    fontSize: 12,
    color: "#555",
    borderBottom: "2px solid #eee",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "10px 8px",
    fontSize: 13,
    borderBottom: "1px solid #f0f0f0",
    verticalAlign: "top",
  };

  return (
    <div style={{ maxWidth: 1200, margin: "32px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>草稿收支流水</h1>
        <span style={{ fontSize: 13, color: "#888" }}>
          预先登记待报销账目，或记录组织代办账目（不进报表）
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button onClick={load} disabled={loading} style={btnPlain}>
            {loading ? "刷新中..." : "刷新"}
          </button>
          {canWrite && (
            <a href="/drafts/new" style={btnPrimary}>
              + 登记草稿
            </a>
          )}
        </div>
      </div>

      {!canWrite && (
        <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
          ℹ️ 你当前为只读角色，仅可查看草稿流水。
        </div>
      )}

      {/* 概览卡片 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={card}>
          <div style={cardLabel}>待处理草稿</div>
          <div style={cardValue}>{stats.pendingCount} 笔</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>待报销支出（待处理）</div>
          <div style={{ ...cardValue, color: "#c62828" }}>¥{fmtYuan(stats.pendingReimbExpense)}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>代办账目（待确认）</div>
          <div style={cardValue}>{stats.pendingProxyCount} 笔</div>
        </div>
      </div>

      {/* 筛选 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#666" }}>类型：</span>
        {(["all", "reimbursement", "proxy"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            style={chip(filterType === t)}
          >
            {t === "all" ? "全部" : ENTRY_TYPE_LABELS[t]}
          </button>
        ))}
        <span style={{ fontSize: 13, color: "#666", marginLeft: 8 }}>状态：</span>
        {(["all", "pending", "confirmed", "transferred"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            style={chip(filterStatus === s)}
          >
            {s === "all" ? "全部" : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{ padding: 10, background: "#ffebee", color: "#c62828", borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {msg}
        </div>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>类型</th>
              <th style={th}>状态</th>
              <th style={th}>日期</th>
              <th style={th}>收/支</th>
              <th style={{ ...th, textAlign: "right" }}>金额</th>
              <th style={th}>类别</th>
              <th style={th}>账户</th>
              <th style={th}>经手人</th>
              <th style={th}>备注</th>
              <th style={th}>登记信息</th>
              <th style={{ ...th, textAlign: "center" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td style={{ ...td, textAlign: "center", color: "#999", padding: 28 }} colSpan={11}>
                  {loading ? "加载中..." : "暂无草稿记录"}
                </td>
              </tr>
            )}
            {filtered.map((d) => {
              const locked = d.status !== "pending";
              const handlerNames = [d.handler1_id, d.handler2_id]
                .filter(Boolean)
                .map((id) => members[id as string] ?? "—")
                .join(" / ");
              const ts = TYPE_STYLE[d.entry_type];
              const ss = STATUS_STYLE[d.status];
              return (
                <tr key={d.id}>
                  <td style={td}>
                    <span style={badge(ts.bg, ts.color)}>{ENTRY_TYPE_LABELS[d.entry_type]}</span>
                  </td>
                  <td style={td}>
                    <span style={badge(ss.bg, ss.color)}>{STATUS_LABELS[d.status]}</span>
                  </td>
                  <td style={td}>{fmtDate(d.date)}</td>
                  <td style={td}>{d.direction === "income" ? "收入" : "支出"}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, color: d.direction === "income" ? "#2e7d32" : "#c62828" }}>
                    ¥{fmtYuan(d.amount)}
                  </td>
                  <td style={td}>{d.categories?.name ?? "-"}</td>
                  <td style={td}>{d.accounts?.name ?? "-"}</td>
                  <td style={td}>{handlerNames || "-"}</td>
                  <td style={{ ...td, minWidth: 140, whiteSpace: "pre-wrap" }}>{d.description || "-"}</td>
                  <td style={{ ...td, fontSize: 11, color: "#888" }}>
                    {resolveUserDisplay(d.created_by, userMap)}
                    <br />
                    {fmtDate(d.created_at)}
                    {d.status === "transferred" && d.transferred_by && (
                      <div style={{ color: "#1565c0", marginTop: 2 }}>
                        转移：{resolveUserDisplay(d.transferred_by, userMap)}
                      </div>
                    )}
                    {d.status === "confirmed" && d.confirmed_by && (
                      <div style={{ color: "#2e7d32", marginTop: 2 }}>
                        确认：{resolveUserDisplay(d.confirmed_by, userMap)}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                    {locked ? (
                      <span style={{ color: "#bbb", fontSize: 12 }}>已锁定</span>
                    ) : (
                      <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                        {canWrite && (
                          <a href={`/drafts/${d.id}/edit`} style={btnMini("#1565c0")}>
                            编辑
                          </a>
                        )}
                        {isAdmin && d.entry_type === "reimbursement" && (
                          <button
                            onClick={() => onTransfer(d)}
                            disabled={busyId === d.id}
                            style={btnMini("#2e7d32")}
                            title="转移至正式收支流水"
                          >
                            转移
                          </button>
                        )}
                        {isAdmin && d.entry_type === "proxy" && (
                          <button
                            onClick={() => onConfirm(d)}
                            disabled={busyId === d.id}
                            style={btnMini("#6a1b9a")}
                            title="确认代办账目并锁定"
                          >
                            确认
                          </button>
                        )}
                        {canWrite && (
                          <button
                            onClick={() => onDelete(d)}
                            disabled={busyId === d.id}
                            style={btnMini("#c62828")}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const btnPlain: React.CSSProperties = {
  padding: "8px 14px",
  fontWeight: 700,
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  textDecoration: "none",
  color: "#333",
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px",
  fontWeight: 700,
  background: "#1565c0",
  color: "#fff",
  borderRadius: 6,
  textDecoration: "none",
  border: "none",
  cursor: "pointer",
};
const card: React.CSSProperties = {
  background: "#fafafa",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: "12px 18px",
  minWidth: 160,
};
const cardLabel: React.CSSProperties = { fontSize: 12, color: "#888", marginBottom: 6 };
const cardValue: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: "#333" };

function badge(bg: string, color: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 700,
    background: bg,
    color,
    whiteSpace: "nowrap",
  };
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: 16,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    border: active ? "1px solid #1565c0" : "1px solid #ddd",
    background: active ? "#1565c0" : "#fff",
    color: active ? "#fff" : "#555",
  };
}

function btnMini(color: string): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    border: `1px solid ${color}`,
    background: "#fff",
    color,
    textDecoration: "none",
    lineHeight: "18px",
  };
}
