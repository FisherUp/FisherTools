"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchServiceAssignments,
  fetchServiceTypes,
  deleteServiceAssignment,
} from "@/lib/services/serviceScheduling";
import { fetchMembers } from "@/lib/services/inventoryService";
import { getCalendarNotePreview } from "@/lib/utils/notes";
import {
  fetchUserDisplayMap,
  resolveUserDisplay,
  type UserDisplayMap,
} from "@/lib/services/userDisplay";

interface ServiceAssignment {
  id: string;
  service_date: string;
  sermon_title: string | null;
  notes: string | null;
  status: string;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  service_types: {
    id: string;
    name: string;
    frequency: string;
  } | null;
  members: {
    id: string;
    name: string;
  } | null;
}

interface ServiceType {
  id: string;
  name: string;
  frequency: string;
}

interface Member {
  id: string;
  name: string;
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

export default function ServicesClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [orgId, setOrgId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [assignments, setAssignments] = useState<ServiceAssignment[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [userDisplayMap, setUserDisplayMap] = useState<UserDisplayMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 视图模式
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");

  // 筛选器
  const [filterServiceType, setFilterServiceType] = useState("");
  const [filterMember, setFilterMember] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // 日期范围（默认显示当前周 + 未来3周）
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay()); // 本周日
    return d.toISOString().split("T")[0];
  });

  const [endDate, setEndDate] = useState(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay() + 27); // 未来4周的周六
    return d.toISOString().split("T")[0];
  });

  useEffect(() => {
    loadData();
  }, [startDate, endDate]);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
      setOrgId(profile.orgId);
      setUserRole(profile.role);

      const [assignmentsData, typesData, membersData] = await Promise.all([
        fetchServiceAssignments(profile.orgId, startDate, endDate),
        fetchServiceTypes(profile.orgId),
        fetchMembers(profile.orgId),
      ]);

      setAssignments(assignmentsData as any);
      setServiceTypes(typesData);
      setMembers(membersData);

      // 收集审计字段中的用户 ID，批量解析显示名
      const auditIds = (assignmentsData as any[]).flatMap((a: any) =>
        [a.created_by, a.updated_by].filter(Boolean)
      );
      if (auditIds.length > 0) {
        const displayMap = await fetchUserDisplayMap(auditIds, profile.orgId);
        setUserDisplayMap(displayMap);
      }
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  function goPrevWeek() {
    const start = new Date(startDate);
    start.setDate(start.getDate() - 7);
    const end = new Date(endDate);
    end.setDate(end.getDate() - 7);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  }

  function goNextWeek() {
    const start = new Date(startDate);
    start.setDate(start.getDate() + 7);
    const end = new Date(endDate);
    end.setDate(end.getDate() + 7);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这个服务安排吗？")) return;

    try {
      setError("");
      setSuccess("");
      await deleteServiceAssignment(id);
      setSuccess("删除成功");
      await loadData();
    } catch (err: any) {
      setError(err.message || "删除失败");
    }
  }

  // 筛选后的安排
  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (filterServiceType && a.service_types?.id !== filterServiceType)
        return false;
      if (filterMember && a.members?.id !== filterMember) return false;
      if (filterStatus && a.status !== filterStatus) return false;
      return true;
    });
  }, [assignments, filterServiceType, filterMember, filterStatus]);

  const isAdmin = userRole === "admin";
  const canEdit = userRole === "admin" || userRole === "coordinator";
  const canDelete = userRole === "admin";

  if (loading) {
    return <div style={{ padding: 20 }}>加载中...</div>;
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: "0 auto" }}>
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="/transactions"
            style={{
              padding: "6px 10px",
              border: "1px solid #ccc",
              color: "#666",
              borderRadius: 4,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            ← 返回主界面
          </a>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>服务排班</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {isAdmin && (
            <a
              href="/services/types"
              style={{
                padding: "8px 12px",
                border: "1px solid #999",
                color: "#666",
                borderRadius: 4,
                textDecoration: "none",
              }}
            >
              服务类型管理
            </a>
          )}
          {canEdit && (
            <>
              <a
                href="/services/new"
                style={{
                  padding: "8px 12px",
                  background: "#0366d6",
                  color: "white",
                  borderRadius: 4,
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                + 单个排班
              </a>
              <a
                href="/services/batch"
                style={{
                  padding: "8px 12px",
                  background: "#1a7a1a",
                  color: "white",
                  borderRadius: 4,
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                批量排班
              </a>
            </>
          )}
          <a
            href="/leaves"
            style={{
              padding: "8px 12px",
              border: "1px solid #999",
              color: "#666",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            休假管理
          </a>
        </div>
      </div>

      {/* 消息提示 */}
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
      {success && (
        <div
          style={{
            padding: 10,
            background: "#e6f9e6",
            color: "#1a7a1a",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {success}
        </div>
      )}

      {/* 工具栏 */}
      <div
        style={{
          background: "#f5f5f5",
          padding: 14,
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        {/* 日期导航 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <button
            onClick={goPrevWeek}
            style={{
              padding: "6px 12px",
              border: "1px solid #ddd",
              background: "white",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            ◀ 上周
          </button>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
          />
          <span>至</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
          />
          <button
            onClick={goNextWeek}
            style={{
              padding: "6px 12px",
              border: "1px solid #ddd",
              background: "white",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            下周 ▶
          </button>
        </div>

        {/* 视图切换和筛选器 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {/* 视图切换 */}
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setViewMode("calendar")}
              style={{
                padding: "6px 12px",
                border: "1px solid #ddd",
                background: viewMode === "calendar" ? "#0366d6" : "white",
                color: viewMode === "calendar" ? "white" : "#666",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: viewMode === "calendar" ? 700 : 400,
              }}
            >
              日历视图
            </button>
            <button
              onClick={() => setViewMode("list")}
              style={{
                padding: "6px 12px",
                border: "1px solid #ddd",
                background: viewMode === "list" ? "#0366d6" : "white",
                color: viewMode === "list" ? "white" : "#666",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: viewMode === "list" ? 700 : 400,
              }}
            >
              列表视图
            </button>
          </div>

          {/* 筛选器 */}
          <select
            value={filterServiceType}
            onChange={(e) => setFilterServiceType(e.target.value)}
            style={{
              padding: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
              background: "white",
            }}
          >
            <option value="">全部服务类型</option>
            {serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            style={{
              padding: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
              background: "white",
            }}
          >
            <option value="">全部成员</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{
              padding: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
              background: "white",
            }}
          >
            <option value="">全部状态</option>
            <option value="scheduled">已安排</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
      </div>

      {/* 视图内容 */}
      {viewMode === "calendar" ? (
        <CalendarView
          assignments={filteredAssignments}
          startDate={startDate}
          endDate={endDate}
          canEdit={canEdit}
          canDelete={canDelete}
          onDelete={handleDelete}
        />
      ) : (
        <ListView
          assignments={filteredAssignments}
          canEdit={canEdit}
          canDelete={canDelete}
          userDisplayMap={userDisplayMap}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// 日历视图组件
function CalendarView({
  assignments,
  startDate,
  endDate,
  canEdit,
  canDelete,
  onDelete,
}: {
  assignments: ServiceAssignment[];
  startDate: string;
  endDate: string;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  // 生成日期范围内的所有日期
  const dates = useMemo(() => {
    const result: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      result.push(d.toISOString().split("T")[0]);
    }

    return result;
  }, [startDate, endDate]);

  // 按日期分组
  const assignmentsByDate = useMemo(() => {
    const map = new Map<string, ServiceAssignment[]>();
    assignments.forEach((a) => {
      const list = map.get(a.service_date) || [];
      list.push(a);
      map.set(a.service_date, list);
    });
    return map;
  }, [assignments]);

  // 按周分组日期
  const weeks = useMemo(() => {
    const result: string[][] = [];
    let currentWeek: string[] = [];

    dates.forEach((date, index) => {
      const dayOfWeek = new Date(date).getDay();

      if (dayOfWeek === 0 && currentWeek.length > 0) {
        result.push(currentWeek);
        currentWeek = [];
      }

      currentWeek.push(date);

      if (index === dates.length - 1) {
        result.push(currentWeek);
      }
    });

    return result;
  }, [dates]);

  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  return (
    <div>
      {weeks.map((week, weekIndex) => (
        <div
          key={weekIndex}
          style={{
            marginBottom: 20,
            border: "1px solid #eee",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr",
              background: "#fafafa",
              borderBottom: "1px solid #eee",
            }}
          >
            {week.map((date, dayIndex) => {
              const d = new Date(date);
              const dayOfWeek = d.getDay();
              return (
                <div
                  key={date}
                  style={{
                    padding: 8,
                    textAlign: "center",
                    borderRight:
                      dayIndex < week.length - 1 ? "1px solid #eee" : "none",
                    fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: 12, color: "#999" }}>
                    {weekDays[dayOfWeek]}
                  </div>
                  <div style={{ fontSize: 14 }}>
                    {d.getMonth() + 1}/{d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1fr",
              minHeight: 120,
            }}
          >
            {week.map((date, dayIndex) => {
              const dayAssignments = assignmentsByDate.get(date) || [];
              return (
                <div
                  key={date}
                  style={{
                    padding: 8,
                    borderRight:
                      dayIndex < week.length - 1 ? "1px solid #eee" : "none",
                    background: "white",
                  }}
                >
                  {(() => {
                    // 按服务类型分组，同类型多人合并为一张卡片
                    const grouped = new Map<string, ServiceAssignment[]>();
                    dayAssignments.forEach((a) => {
                      const key = a.service_types?.id || "unknown";
                      if (!grouped.has(key)) grouped.set(key, []);
                      grouped.get(key)!.push(a);
                    });
                    return Array.from(grouped.values()).map((group) => {
                      const first = group[0];
                      const notePreview = getCalendarNotePreview(first.notes);
                      const visibleMembers = group.slice(0, 5);
                      const hiddenCount = group.length - 5;
                      return (
                        <div
                          key={first.service_types?.id || first.id}
                          style={{
                            padding: 6,
                            marginBottom: 6,
                            background: "#f0f8ff",
                            borderLeft: "3px solid #0366d6",
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        >
                          {/* 服务类型名 */}
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            {first.service_types?.name || "未知"}
                          </div>
                          {/* 讲道题目 */}
                          {first.sermon_title &&
                            first.service_types?.name === "分享信息" && (
                              <div
                                style={{
                                  color: "#0366d6",
                                  marginBottom: 2,
                                  fontSize: 11,
                                  fontStyle: "italic",
                                }}
                              >
                                {first.sermon_title}
                              </div>
                            )}
                            {/* 每位成员一行，canEdit 显示编辑图标，canDelete 显示删除图标 */}
                          {visibleMembers.map((a) => (
                            <div
                              key={a.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginTop: 2,
                              }}
                            >
                              <span style={{ color: "#555" }}>
                                {a.members?.name || "未分配"}
                              </span>
                              {canEdit && (
                                <span
                                  style={{
                                    display: "flex",
                                    gap: 2,
                                    flexShrink: 0,
                                    marginLeft: 4,
                                  }}
                                >
                                  <a
                                    href={`/services/${a.id}/edit`}
                                    style={{
                                      fontSize: 12,
                                      color: "#0366d6",
                                      textDecoration: "none",
                                      cursor: "pointer",
                                    }}
                                    title="编辑"
                                  >
                                    ✏️
                                  </a>
                                  {canDelete && (
                                    <button
                                      onClick={() => onDelete(a.id)}
                                      style={{
                                        fontSize: 12,
                                        color: "#c00",
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 0,
                                      }}
                                      title="删除"
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                          ))}
                          {/* 超过 5 人时提示 */}
                          {hiddenCount > 0 && (
                            <div
                              style={{
                                color: "#999",
                                fontSize: 10,
                                marginTop: 2,
                              }}
                            >
                              等 {hiddenCount} 人…
                            </div>
                          )}
                          {/* 备注预览 */}
                          {notePreview && (
                            <div
                              style={{
                                color: "#888",
                                fontSize: 10,
                                marginTop: 3,
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                                textOverflow: "ellipsis",
                              }}
                              title={notePreview}
                            >
                              {notePreview}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// 列表视图组件
function ListView({
  assignments,
  canEdit,
  canDelete,
  userDisplayMap,
  onDelete,
}: {
  assignments: ServiceAssignment[];
  canEdit: boolean;
  canDelete: boolean;
  userDisplayMap: UserDisplayMap;
  onDelete: (id: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
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
              服务类型
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
            <th
              style={{
                textAlign: "left",
                padding: 10,
                borderBottom: "1px solid #eee",
              }}
            >
              备注
            </th>
            <th
              style={{
                textAlign: "center",
                padding: 10,
                borderBottom: "1px solid #eee",
              }}
            >
              状态
            </th>
            <th
              style={{
                textAlign: "left",
                padding: 10,
                borderBottom: "1px solid #eee",
                fontSize: 12,
                color: "#666",
              }}
            >
              录入信息
            </th>
            {canEdit && (
              <th
                style={{
                  textAlign: "center",
                  padding: 10,
                  borderBottom: "1px solid #eee",
                }}
              >
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {assignments.length === 0 ? (
            <tr>
              <td
                colSpan={canEdit ? 7 : 6}
                style={{ padding: 20, textAlign: "center", color: "#999" }}
              >
                暂无服务安排
              </td>
            </tr>
          ) : (
            assignments.map((a) => (
              <tr key={a.id}>
                <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                  {a.service_date}
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                  {a.service_types?.name || "未知"}
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                  {a.members?.name || "未分配"}
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                  {a.notes || "-"}
                </td>
                <td
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      background:
                        a.status === "completed"
                          ? "#e6f9e6"
                          : a.status === "cancelled"
                          ? "#f5f5f5"
                          : "#fff3cd",
                      color:
                        a.status === "completed"
                          ? "#1a7a1a"
                          : a.status === "cancelled"
                          ? "#666"
                          : "#856404",
                    }}
                  >
                    {a.status === "scheduled"
                      ? "已安排"
                      : a.status === "completed"
                      ? "已完成"
                      : "已取消"}
                  </span>
                </td>
                <td style={{ padding: 10, borderBottom: "1px solid #eee", fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>
                  <div>
                    创建：{resolveUserDisplay(a.created_by, userDisplayMap)}
                    {a.created_at && (
                      <span style={{ marginLeft: 4, color: "#bbb" }}>
                        {new Date(a.created_at).toLocaleDateString("zh-CN")}
                      </span>
                    )}
                  </div>
                  {a.updated_by && (
                    <div style={{ marginTop: 2 }}>
                      修改：{resolveUserDisplay(a.updated_by, userDisplayMap)}
                      {a.updated_at && (
                        <span style={{ marginLeft: 4, color: "#bbb" }}>
                          {new Date(a.updated_at).toLocaleDateString("zh-CN")}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                {canEdit && (
                  <td
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{ display: "flex", gap: 8, justifyContent: "center" }}
                    >
                      <a
                        href={`/services/${a.id}/edit`}
                        style={{
                          padding: "4px 8px",
                          border: "1px solid #0366d6",
                          color: "#0366d6",
                          background: "white",
                          borderRadius: 4,
                          textDecoration: "none",
                          fontSize: 12,
                        }}
                      >
                        编辑
                      </a>
                      {canDelete && (
                        <button
                          onClick={() => onDelete(a.id)}
                          style={{
                            padding: "4px 8px",
                            border: "1px solid #c00",
                            color: "#c00",
                            background: "white",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
