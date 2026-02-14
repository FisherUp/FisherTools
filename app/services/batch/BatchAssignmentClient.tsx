"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchServiceTypes,
  createBatchServiceAssignments,
} from "@/lib/services/serviceScheduling";
import { fetchMembers } from "@/lib/services/inventoryService";

interface ServiceType {
  id: string;
  name: string;
  frequency: string;
}

interface Member {
  id: string;
  name: string;
}

interface PreviewAssignment {
  date: string;
  memberId: string;
  memberName: string;
}

async function getMyProfile() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error("未登录");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) throw new Error("无法获取用户信息");

  return {
    userId: user.id,
    orgId: profile.org_id,
    role: profile.role,
  };
}

// 生成日期范围内的所有周日（或指定星期几）
function generateDates(
  startDate: string,
  endDate: string,
  dayOfWeek: number = 0
): string[] {
  const result: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === dayOfWeek) {
      result.push(d.toISOString().split("T")[0]);
    }
  }

  return result;
}

export default function BatchAssignmentClient() {
  const router = useRouter();

  const [orgId, setOrgId] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 表单字段
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const today = new Date();
    today.setDate(today.getDate() + 28); // 4周后
    return today.toISOString().split("T")[0];
  });
  const [dayOfWeek, setDayOfWeek] = useState(0); // 0 = 周日
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);

      const [typesData, membersData] = await Promise.all([
        fetchServiceTypes(profile.orgId),
        fetchMembers(profile.orgId),
      ]);

      setServiceTypes(typesData);
      setMembers(membersData);

      if (typesData.length > 0) setServiceTypeId(typesData[0].id);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  function toggleMember(memberId: string) {
    if (selectedMemberIds.includes(memberId)) {
      setSelectedMemberIds(selectedMemberIds.filter((id) => id !== memberId));
    } else {
      setSelectedMemberIds([...selectedMemberIds, memberId]);
    }
  }

  // 生成预览
  const previewAssignments = useMemo((): PreviewAssignment[] => {
    if (!serviceTypeId || selectedMemberIds.length === 0) return [];

    const dates = generateDates(startDate, endDate, dayOfWeek);
    const result: PreviewAssignment[] = [];

    // 轮换算法：循环分配成员
    dates.forEach((date, index) => {
      const memberIndex = index % selectedMemberIds.length;
      const memberId = selectedMemberIds[memberIndex];
      const member = members.find((m) => m.id === memberId);

      result.push({
        date,
        memberId,
        memberName: member?.name || "未知",
      });
    });

    return result;
  }, [serviceTypeId, startDate, endDate, dayOfWeek, selectedMemberIds, members]);

  async function handleSubmit() {
    setError("");
    setSubmitting(true);

    if (!serviceTypeId || selectedMemberIds.length === 0) {
      setError("请选择服务类型和至少一个成员");
      setSubmitting(false);
      return;
    }

    if (previewAssignments.length === 0) {
      setError("没有生成任何排班记录，请检查日期范围和星期设置");
      setSubmitting(false);
      return;
    }

    try {
      const assignments = previewAssignments.map((p) => ({
        org_id: orgId,
        service_type_id: serviceTypeId,
        member_id: p.memberId,
        service_date: p.date,
        status: "scheduled",
      }));

      await createBatchServiceAssignments(assignments);
      router.push("/services");
    } catch (err: any) {
      setError(err.message || "创建失败");
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 20 }}>加载中...</div>;
  }

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>批量排班</h1>
        <a
          href="/services"
          style={{
            padding: "8px 12px",
            border: "1px solid #0366d6",
            color: "#0366d6",
            borderRadius: 4,
            textDecoration: "none",
          }}
        >
          返回
        </a>
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            background: "#ffe6e6",
            color: "#c00",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 20 }}>
        {/* 配置表单 */}
        <div
          style={{
            background: "#f5f5f5",
            padding: 20,
            borderRadius: 8,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            排班配置
          </h2>

          <div style={{ display: "grid", gap: 14 }}>
            <label>
              服务类型：
              <select
                value={serviceTypeId}
                onChange={(e) => setServiceTypeId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                }}
              >
                {serviceTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label>
                开始日期：
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: 8,
                    marginTop: 6,
                    border: "1px solid #ddd",
                    borderRadius: 4,
                  }}
                />
              </label>

              <label>
                结束日期：
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: 8,
                    marginTop: 6,
                    border: "1px solid #ddd",
                    borderRadius: 4,
                  }}
                />
              </label>
            </div>

            <label>
              星期几：
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                }}
              >
                <option value={0}>周日</option>
                <option value={1}>周一</option>
                <option value={2}>周二</option>
                <option value={3}>周三</option>
                <option value={4}>周四</option>
                <option value={5}>周五</option>
                <option value={6}>周六</option>
              </select>
            </label>
          </div>
        </div>

        {/* 成员选择 */}
        <div
          style={{
            background: "#f5f5f5",
            padding: 20,
            borderRadius: 8,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            选择成员（已选 {selectedMemberIds.length} 人）
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {members.map((member) => (
              <label
                key={member.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  background: selectedMemberIds.includes(member.id)
                    ? "#e6f9e6"
                    : "white",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                  style={{ cursor: "pointer" }}
                />
                <span>{member.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 预览按钮 */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setShowPreview(true)}
            disabled={selectedMemberIds.length === 0}
            style={{
              padding: "10px 20px",
              background:
                selectedMemberIds.length === 0 ? "#ccc" : "#0366d6",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
              cursor:
                selectedMemberIds.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            生成预览
          </button>
        </div>

        {/* 预览结果 */}
        {showPreview && previewAssignments.length > 0 && (
          <div
            style={{
              background: "#f5f5f5",
              padding: 20,
              borderRadius: 8,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
              预览结果（共 {previewAssignments.length} 条）
            </h2>

            <div
              style={{
                overflowX: "auto",
                border: "1px solid #eee",
                borderRadius: 8,
                background: "white",
              }}
            >
              <table
                style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}
              >
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      序号
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      日期
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      成员
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previewAssignments.map((p, index) => (
                    <tr key={index}>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        {p.date}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        {p.memberName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  padding: "10px 20px",
                  background: submitting ? "#ccc" : "#1a7a1a",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  fontWeight: 700,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "创建中..." : "确认创建"}
              </button>
              <button
                onClick={() => setShowPreview(false)}
                disabled={submitting}
                style={{
                  padding: "10px 20px",
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                重新配置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
