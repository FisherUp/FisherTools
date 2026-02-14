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

// 生成指定月份范围的所有日期
function generateMonthDates(startMonth: Date, monthCount: number): string[] {
  const result: string[] = [];
  const current = new Date(startMonth);

  for (let i = 0; i < monthCount; i++) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      result.push(date.toISOString().split("T")[0]);
    }

    current.setMonth(current.getMonth() + 1);
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
  const [monthCount, setMonthCount] = useState(3); // 3个月或6个月
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

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

  function toggleDate(date: string) {
    const newDates = new Set(selectedDates);
    if (newDates.has(date)) {
      newDates.delete(date);
    } else {
      newDates.add(date);
    }
    setSelectedDates(newDates);
  }

  function toggleMember(memberId: string) {
    if (selectedMemberIds.includes(memberId)) {
      setSelectedMemberIds(selectedMemberIds.filter((id) => id !== memberId));
    } else {
      setSelectedMemberIds([...selectedMemberIds, memberId]);
    }
  }

  // 生成日历数据
  const calendarDates = useMemo(() => {
    const today = new Date();
    today.setDate(1); // 设置为本月1号
    return generateMonthDates(today, monthCount);
  }, [monthCount]);

  // 按月份分组日期
  const datesByMonth = useMemo(() => {
    const groups = new Map<string, string[]>();
    calendarDates.forEach((date) => {
      const d = new Date(date);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!groups.has(monthKey)) {
        groups.set(monthKey, []);
      }
      groups.get(monthKey)!.push(date);
    });
    return groups;
  }, [calendarDates]);

  // 生成预览
  const previewAssignments = useMemo((): PreviewAssignment[] => {
    if (!serviceTypeId || selectedMemberIds.length === 0 || selectedDates.size === 0) {
      return [];
    }

    const dates = Array.from(selectedDates).sort();
    const result: PreviewAssignment[] = [];

    // 轮换算法：循环分配成员到选中的日期
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
  }, [serviceTypeId, selectedDates, selectedMemberIds, members]);

  async function handleSubmit() {
    setError("");
    setSubmitting(true);

    if (!serviceTypeId || selectedMemberIds.length === 0) {
      setError("请选择服务类型和至少一个成员");
      setSubmitting(false);
      return;
    }

    if (selectedDates.size === 0) {
      setError("请至少选择一个日期");
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
    <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto" }}>
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

            <label>
              显示月份数：
              <select
                value={monthCount}
                onChange={(e) => setMonthCount(Number(e.target.value))}
                style={{
                  display: "block",
                  width: "100%",
                  padding: 8,
                  marginTop: 6,
                  border: "1px solid #ddd",
                  borderRadius: 4,
                }}
              >
                <option value={3}>3个月</option>
                <option value={6}>6个月</option>
              </select>
            </label>
          </div>
        </div>

        {/* 日历视图 */}
        <div
          style={{
            background: "#f5f5f5",
            padding: 20,
            borderRadius: 8,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>
            选择日期（已选 {selectedDates.size} 天）
          </h2>

          <div style={{ display: "grid", gap: 20 }}>
            {Array.from(datesByMonth.entries()).map(([monthKey, dates]) => {
              const firstDate = new Date(dates[0]);
              const monthName = firstDate.toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "long",
              });

              // 计算该月第一天是星期几
              const firstDayOfMonth = new Date(
                firstDate.getFullYear(),
                firstDate.getMonth(),
                1
              );
              const startDayOfWeek = firstDayOfMonth.getDay();

              // 创建日历网格（包含空白单元格）
              const calendarGrid: (string | null)[] = [];
              for (let i = 0; i < startDayOfWeek; i++) {
                calendarGrid.push(null);
              }
              dates.forEach((date) => calendarGrid.push(date));

              return (
                <div key={monthKey}>
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      marginBottom: 10,
                    }}
                  >
                    {monthName}
                  </h3>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 8,
                    }}
                  >
                    {/* 星期标题 */}
                    {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
                      <div
                        key={day}
                        style={{
                          textAlign: "center",
                          fontWeight: 600,
                          padding: 8,
                          color: "#666",
                        }}
                      >
                        {day}
                      </div>
                    ))}

                    {/* 日期单元格 */}
                    {calendarGrid.map((date, index) => {
                      if (!date) {
                        return <div key={`empty-${index}`} />;
                      }

                      const d = new Date(date);
                      const dayNum = d.getDate();
                      const isSelected = selectedDates.has(date);
                      const isToday =
                        date === new Date().toISOString().split("T")[0];

                      return (
                        <button
                          key={date}
                          onClick={() => toggleDate(date)}
                          style={{
                            padding: 8,
                            border: isSelected
                              ? "2px solid #0366d6"
                              : "1px solid #ddd",
                            borderRadius: 4,
                            background: isSelected
                              ? "#e6f2ff"
                              : isToday
                              ? "#fff9e6"
                              : "white",
                            cursor: "pointer",
                            textAlign: "center",
                            fontWeight: isSelected ? 700 : 400,
                            color: isSelected ? "#0366d6" : "#333",
                          }}
                        >
                          {dayNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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

        {/* 预览和提交 */}
        {previewAssignments.length > 0 && (
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
                maxHeight: 400,
                overflowY: "auto",
              }}
            >
              <table
                style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}
              >
                <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                  <tr>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

