"use client";

import { useEffect, useState } from "react";
import { getMyProfile } from "../../lib/services/inventoryService";
import {
  fetchLeaveRequests,
  fetchLeaveBalance,
  approveLeaveRequest,
  rejectLeaveRequest,
  cancelLeaveRequest,
  leaveTypeLabel,
  LEAVE_TYPES,
  LeaveRequest,
  LeaveBalance,
} from "../../lib/services/leaveService";
import {
  fetchUserDisplayMap,
  resolveUserDisplay,
} from "../../lib/services/userDisplay";

export default function LeavesClient() {
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [userMap, setUserMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 筛选
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const currentYear = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState(currentYear);

  // 驳回弹窗
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const isAdmin = role === "admin";

  useEffect(() => {
    loadData();
  }, [filterStatus, filterType, filterYear]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setUserId(profile.userId);
      setRole(profile.role);

      const filters: any = { year: filterYear };
      if (filterStatus) filters.status = filterStatus;
      if (filterType) filters.leave_type = filterType;

      const [reqs, bal] = await Promise.all([
        fetchLeaveRequests(profile.orgId, filters),
        fetchLeaveBalance(profile.orgId, profile.userId, filterYear),
      ]);

      setRequests(reqs);
      setBalances(bal);

      // 收集所有用户 ID 用于显示名
      const userIds = new Set<string>();
      reqs.forEach((r) => {
        userIds.add(r.requester_id);
        if (r.reviewer_id) userIds.add(r.reviewer_id);
      });
      const displayMap = await fetchUserDisplayMap(Array.from(userIds), profile.orgId);
      setUserMap(displayMap);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id: string) {
    if (!confirm("确认通过此休假申请？")) return;
    try {
      setError("");
      await approveLeaveRequest(id, userId);
      setSuccess("已通过");
      setTimeout(() => setSuccess(""), 2000);
      await loadData();
    } catch (err: any) {
      setError(err.message || "审批失败");
    }
  }

  async function handleReject(id: string) {
    if (!rejectNote.trim()) {
      setError("驳回原因不能为空");
      return;
    }
    try {
      setError("");
      await rejectLeaveRequest(id, userId, rejectNote.trim());
      setRejectingId(null);
      setRejectNote("");
      setSuccess("已驳回");
      setTimeout(() => setSuccess(""), 2000);
      await loadData();
    } catch (err: any) {
      setError(err.message || "驳回失败");
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("确认取消此休假申请？")) return;
    try {
      setError("");
      await cancelLeaveRequest(id, userId);
      setSuccess("已取消");
      setTimeout(() => setSuccess(""), 2000);
      await loadData();
    } catch (err: any) {
      setError(err.message || "取消失败");
    }
  }

  function statusLabel(s: string) {
    const map: Record<string, { text: string; color: string; bg: string }> = {
      pending: { text: "待审批", color: "#856404", bg: "#fff3cd" },
      approved: { text: "已通过", color: "#1a7a1a", bg: "#e6f9e6" },
      rejected: { text: "已驳回", color: "#c00", bg: "#ffe0e0" },
      cancelled: { text: "已取消", color: "#666", bg: "#f0f0f0" },
    };
    const m = map[s] || { text: s, color: "#333", bg: "#f0f0f0" };
    return (
      <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600, background: m.bg, color: m.color }}>
        {m.text}
      </span>
    );
  }

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
      {/* 顶部 */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>休假管理</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/leaves/new" style={{ padding: "8px 12px", fontWeight: 700 }}>
            + 申请休假
          </a>
          {isAdmin && (
            <a href="/leaves/settings" style={{ padding: "8px 12px", fontWeight: 700, border: "1px solid #0366d6", color: "#0366d6", borderRadius: 6 }}>
              假期设置
            </a>
          )}
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回流水
          </a>
        </div>
      </div>

      {!!error && (
        <div style={{ marginBottom: 12, padding: 10, background: "#ffe0e0", borderRadius: 8, color: "#c00" }}>
          {error}
        </div>
      )}
      {!!success && (
        <div style={{ marginBottom: 12, padding: 10, background: "#e6f9e6", borderRadius: 8, color: "#1a7a1a" }}>
          {success}
        </div>
      )}

      {/* 我的假期余额 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>我的 {filterYear} 年假期余额</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {balances.map((b) => (
            <div
              key={b.leave_type}
              style={{
                background: "#f5f5f5",
                padding: "8px 14px",
                borderRadius: 8,
                fontSize: 13,
                minWidth: 120,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{leaveTypeLabel(b.leave_type)}</div>
              {b.quota !== null ? (
                <div>
                  <span style={{ color: "#666" }}>额度 {b.quota}</span>
                  {" / "}
                  <span>已用 {b.used}</span>
                  {" / "}
                  <span style={{
                    fontWeight: 700,
                    color: b.remaining !== null && b.remaining < 0 ? "#c00" : "#1a7a1a",
                  }}>
                    剩余 {b.remaining}
                  </span>
                </div>
              ) : (
                <div><span>已用 {b.used} 次</span></div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 筛选 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(Number(e.target.value))}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">全部状态</option>
          <option value="pending">待审批</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
          <option value="cancelled">已取消</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          <option value="">全部类型</option>
          {LEAVE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* 申请列表 */}
      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#666" }}>加载中...</div>
      ) : (
        <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>申请人</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>类型</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>起始日期</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>结束日期</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>天数</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>原因</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>状态</th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>审批人</th>
                <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#666" }}>
                    暂无休假记录
                  </td>
                </tr>
              ) : (
                requests.map((r) => {
                  const isMine = r.requester_id === userId;
                  const isPending = r.status === "pending";
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontWeight: isMine ? 700 : 400 }}>
                        {resolveUserDisplay(r.requester_id, userMap)}
                        {isMine && <span style={{ fontSize: 11, color: "#0366d6", marginLeft: 4 }}>（我）</span>}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {leaveTypeLabel(r.leave_type)}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {r.start_date}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {r.end_date}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {r.days}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontSize: 13, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.reason || "-"}
                        {r.review_note && (
                          <div style={{ fontSize: 12, color: "#c00", marginTop: 2 }}>
                            审批备注：{r.review_note}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                        {statusLabel(r.status)}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        {r.reviewer_id ? resolveUserDisplay(r.reviewer_id, userMap) : "-"}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center", whiteSpace: "nowrap" }}>
                        {isPending && !isMine && (
                          <>
                            <button
                              onClick={() => handleApprove(r.id)}
                              style={{
                                padding: "4px 8px",
                                background: "#1a7a1a",
                                color: "white",
                                border: "none",
                                borderRadius: 4,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                marginRight: 4,
                              }}
                            >
                              通过
                            </button>
                            <button
                              onClick={() => { setRejectingId(r.id); setRejectNote(""); }}
                              style={{
                                padding: "4px 8px",
                                color: "#c00",
                                border: "1px solid #c00",
                                background: "transparent",
                                borderRadius: 4,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              驳回
                            </button>
                          </>
                        )}
                        {isPending && isMine && (
                          <button
                            onClick={() => handleCancel(r.id)}
                            style={{
                              padding: "4px 8px",
                              color: "#666",
                              border: "1px solid #ddd",
                              background: "transparent",
                              borderRadius: 4,
                              fontSize: 12,
                              cursor: "pointer",
                            }}
                          >
                            取消
                          </button>
                        )}
                        {!isPending && (
                          <span style={{ color: "#999", fontSize: 12 }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 驳回弹窗 */}
      {rejectingId && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{ background: "white", padding: 24, borderRadius: 12, width: 400, maxWidth: "90vw" }}>
            <h3 style={{ margin: "0 0 12px 0" }}>驳回原因</h3>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="请填写驳回原因（必填）"
              rows={3}
              style={{ width: "100%", padding: 8, marginBottom: 12, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setRejectingId(null); setRejectNote(""); }}
                style={{ padding: "8px 16px", border: "1px solid #ddd", borderRadius: 6, background: "white", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                onClick={() => handleReject(rejectingId)}
                style={{ padding: "8px 16px", background: "#c00", color: "white", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
              >
                确认驳回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
