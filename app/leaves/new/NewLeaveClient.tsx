"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMyProfile } from "../../../lib/services/inventoryService";
import {
  createLeaveRequest,
  fetchLeaveBalance,
  LEAVE_TYPES,
  leaveTypeLabel,
  LeaveBalance,
} from "../../../lib/services/leaveService";

export default function NewLeaveClient() {
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [balances, setBalances] = useState<LeaveBalance[]>([]);

  // 表单
  const [leaveType, setLeaveType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setUserId(profile.userId);

        const bal = await fetchLeaveBalance(
          profile.orgId,
          profile.userId,
          new Date().getFullYear()
        );
        setBalances(bal);
      } catch (e: any) {
        setError(e.message || "加载失败");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // 自动计算天数（简单：end - start + 1）
  useEffect(() => {
    if (startDate && endDate) {
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (e >= s) {
        const diff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        setDays(String(diff));
      }
    }
  }, [startDate, endDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const numDays = Number(days);
    if (!startDate || !endDate) {
      setError("请选择起止日期");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError("结束日期不能早于开始日期");
      return;
    }
    if (numDays <= 0 || numDays % 0.5 !== 0) {
      setError("天数必须大于0，且为0.5的倍数");
      return;
    }
    if (leaveType === "special" && !reason.trim()) {
      setError("特殊假必须填写原因（如丧假、产假等）");
      return;
    }

    try {
      setSubmitting(true);
      await createLeaveRequest(orgId, userId, {
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days: numDays,
        reason: reason.trim() || undefined,
      });
      router.push("/leaves");
    } catch (err: any) {
      setError(err.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  // 当前选中类型的余额
  const currentBalance = balances.find((b) => b.leave_type === leaveType);

  if (loading) return <div style={{ padding: 20 }}>加载中...</div>;

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>申请休假</h1>
        <a href="/leaves" style={{ marginLeft: "auto", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
          ← 返回
        </a>
      </div>

      {!!error && (
        <div style={{ marginBottom: 12, padding: 10, background: "#ffe0e0", borderRadius: 8, color: "#c00" }}>
          {error}
        </div>
      )}

      {/* 余额提示 */}
      {currentBalance && currentBalance.quota !== null && (
        <div style={{
          marginBottom: 14,
          padding: 10,
          background: (currentBalance.remaining !== null && currentBalance.remaining < 0) ? "#ffe0e0" : "#f5f5f5",
          borderRadius: 8,
          fontSize: 13,
        }}>
          {leaveTypeLabel(leaveType)}余额：额度 {currentBalance.quota} 天，已用 {currentBalance.used} 天，
          剩余 <b style={{ color: (currentBalance.remaining !== null && currentBalance.remaining < 0) ? "#c00" : "#1a7a1a" }}>
            {currentBalance.remaining} 天
          </b>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label>
          假期类型：
          <select
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ flex: 1 }}>
            开始日期：
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            结束日期：
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
              required
            />
          </label>
        </div>

        <label>
          天数（可手动调整为0.5的倍数）：
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
            required
          />
        </label>

        <label>
          原因/备注{leaveType === "special" ? "（必填）" : "（可选）"}：
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={leaveType === "special" ? "请说明原因，如丧假、产假等" : "可选填写"}
            rows={3}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 4, resize: "vertical" }}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          style={{ padding: "10px 16px", fontWeight: 700, marginTop: 8 }}
        >
          {submitting ? "提交中..." : "提交申请"}
        </button>
      </form>
    </div>
  );
}
