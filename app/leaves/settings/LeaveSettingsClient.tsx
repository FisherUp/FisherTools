"use client";

import { useEffect, useState } from "react";
import {
  getMyProfile,
} from "../../../lib/services/inventoryService";
import {
  fetchOrgProfiles,
  fetchLeaveQuotas,
  upsertLeaveQuota,
  OrgProfile,
  LeaveQuota,
} from "../../../lib/services/leaveService";

type QuotaRow = {
  userId: string;
  displayName: string;
  annual_days: number;
  sabbatical_days: number;
  sick_days: number;
  special_days: number;
  dirty: boolean;
  saving: boolean;
};

export default function LeaveSettingsClient() {
  const [role, setRole] = useState("");
  const [orgId, setOrgId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<QuotaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 批量设置
  const [batchAnnual, setBatchAnnual] = useState("0");
  const [batchSabbatical, setBatchSabbatical] = useState("0");
  const [batchSick, setBatchSick] = useState("0");
  const [batchSpecial, setBatchSpecial] = useState("0");
  const [batchSaving, setBatchSaving] = useState(false);

  const isAdmin = role === "admin";

  useEffect(() => {
    loadData();
  }, [year]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setRole(profile.role);

      if (profile.role !== "admin") {
        setError("仅管理员可访问此页面");
        setLoading(false);
        return;
      }

      const [profiles, quotas] = await Promise.all([
        fetchOrgProfiles(profile.orgId),
        fetchLeaveQuotas(profile.orgId, year),
      ]);

      const quotaMap = new Map<string, LeaveQuota>();
      quotas.forEach((q) => quotaMap.set(q.user_id, q));

      const merged: QuotaRow[] = profiles.map((p) => {
        const q = quotaMap.get(p.id);
        return {
          userId: p.id,
          displayName: p.display_name || p.email || p.id.slice(0, 8),
          annual_days: q?.annual_days ?? 0,
          sabbatical_days: q?.sabbatical_days ?? 0,
          sick_days: q?.sick_days ?? 0,
          special_days: q?.special_days ?? 0,
          dirty: false,
          saving: false,
        };
      });

      setRows(merged);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(idx: number, field: string, value: number) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, [field]: value, dirty: true } : r
      )
    );
  }

  async function saveRow(idx: number) {
    const row = rows[idx];
    try {
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, saving: true } : r))
      );
      await upsertLeaveQuota(orgId, row.userId, year, {
        annual_days: row.annual_days,
        sabbatical_days: row.sabbatical_days,
        sick_days: row.sick_days,
        special_days: row.special_days,
      });
      setRows((prev) =>
        prev.map((r, i) =>
          i === idx ? { ...r, dirty: false, saving: false } : r
        )
      );
      setSuccess("已保存 " + row.displayName + " 的额度");
      setTimeout(() => setSuccess(""), 2000);
    } catch (err: any) {
      setError(err.message || "保存失败");
      setRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, saving: false } : r))
      );
    }
  }

  async function batchSet() {
    try {
      setBatchSaving(true);
      setError("");
      const quotas = {
        annual_days: Number(batchAnnual) || 0,
        sabbatical_days: Number(batchSabbatical) || 0,
        sick_days: Number(batchSick) || 0,
        special_days: Number(batchSpecial) || 0,
      };
      for (const row of rows) {
        await upsertLeaveQuota(orgId, row.userId, year, quotas);
      }
      setSuccess("已为所有用户设置额度");
      setTimeout(() => setSuccess(""), 2000);
      await loadData();
    } catch (err: any) {
      setError(err.message || "批量设置失败");
    } finally {
      setBatchSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 20 }}>加载中...</div>;
  if (!isAdmin) {
    return (
      <div style={{ padding: 20 }}>
        <p style={{ color: "#c00" }}>仅管理员可访问此页面</p>
        <a href="/leaves" style={{ color: "#0366d6" }}>← 返回休假管理</a>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>假期额度设置</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/leaves" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回休假管理
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

      {/* 年份选择 */}
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <label style={{ fontWeight: 600 }}>年份：</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6 }}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* 批量设置 */}
      <div style={{ background: "#f5f5f5", padding: 14, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>批量设置（为所有用户统一设置）</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ fontSize: 13 }}>
            年假
            <input type="number" min="0" step="0.5" value={batchAnnual}
              onChange={(e) => setBatchAnnual(e.target.value)}
              style={{ display: "block", width: 70, padding: 6, border: "1px solid #ddd", borderRadius: 4 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            安息假
            <input type="number" min="0" step="0.5" value={batchSabbatical}
              onChange={(e) => setBatchSabbatical(e.target.value)}
              style={{ display: "block", width: 70, padding: 6, border: "1px solid #ddd", borderRadius: 4 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            病假
            <input type="number" min="0" step="0.5" value={batchSick}
              onChange={(e) => setBatchSick(e.target.value)}
              style={{ display: "block", width: 70, padding: 6, border: "1px solid #ddd", borderRadius: 4 }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            特殊假
            <input type="number" min="0" step="0.5" value={batchSpecial}
              onChange={(e) => setBatchSpecial(e.target.value)}
              style={{ display: "block", width: 70, padding: 6, border: "1px solid #ddd", borderRadius: 4 }}
            />
          </label>
          <button
            onClick={batchSet}
            disabled={batchSaving}
            style={{
              padding: "8px 16px",
              background: batchSaving ? "#ccc" : "#0366d6",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontWeight: 700,
              cursor: batchSaving ? "not-allowed" : "pointer",
            }}
          >
            {batchSaving ? "设置中..." : "批量设置"}
          </button>
        </div>
      </div>

      {/* 用户额度表格 */}
      <div style={{ border: "1px solid #eee", borderRadius: 8, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>用户</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>年假</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>安息假</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>病假</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 90 }}>特殊假</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#666" }}>
                  暂无用户
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={row.userId}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontWeight: 600 }}>
                    {row.displayName}
                  </td>
                  {(["annual_days", "sabbatical_days", "sick_days", "special_days"] as const).map((field) => (
                    <td key={field} style={{ padding: 6, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={row[field]}
                        onChange={(e) => updateRow(idx, field, Number(e.target.value) || 0)}
                        style={{
                          width: 60,
                          padding: 4,
                          textAlign: "center",
                          border: "1px solid #ddd",
                          borderRadius: 4,
                        }}
                      />
                    </td>
                  ))}
                  <td style={{ padding: 6, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                    <button
                      onClick={() => saveRow(idx)}
                      disabled={!row.dirty || row.saving}
                      style={{
                        padding: "4px 10px",
                        background: row.dirty ? "#0366d6" : "#ccc",
                        color: "white",
                        border: "none",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: row.dirty ? "pointer" : "not-allowed",
                      }}
                    >
                      {row.saving ? "..." : "保存"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
        事假无额度限制，不在此设置。特殊假通常设为0，有特殊情况时由审批人判断。
      </div>
    </div>
  );
}
