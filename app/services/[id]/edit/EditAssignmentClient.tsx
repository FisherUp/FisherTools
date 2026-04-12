"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchServiceTypes,
  fetchServiceAssignment,
  fetchSlotAssignments,
  updateServiceAssignment,
  createBatchServiceAssignments,
  deleteServiceAssignment,
} from "@/lib/services/serviceScheduling";
import { fetchMembers } from "@/lib/services/inventoryService";
import { getVisibleNoteLength } from "@/lib/utils/notes";

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

export default function EditAssignmentClient() {
  const router = useRouter();
  const params = useParams();
  const assignmentId = params.id as string;

  const [orgId, setOrgId] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 表单字段
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [sermonTitle, setSermonTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("scheduled");

  // 多成员相关：当前槽位已有的 memberId → assignmentId 映射
  const [slotMemberMap, setSlotMemberMap] = useState<Map<string, string>>(new Map());
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  // 当前点击编辑的成员（仅用于标注「当前」）
  const [primaryMemberId, setPrimaryMemberId] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();

      if (!['admin', 'coordinator'].includes(profile.role)) {
        router.push('/services');
        return;
      }

      setOrgId(profile.orgId);

      const [typesData, membersData, assignmentData] = await Promise.all([
        fetchServiceTypes(profile.orgId),
        fetchMembers(profile.orgId),
        fetchServiceAssignment(assignmentId),
      ]);

      setServiceTypes(typesData);
      setMembers(membersData);

      // 预填充表单数据
      setServiceTypeId(assignmentData.service_type_id);
      setServiceDate(assignmentData.service_date);
      setSermonTitle(assignmentData.sermon_title || "");
      setNotes(assignmentData.notes || "");
      setStatus(assignmentData.status);
      setPrimaryMemberId(assignmentData.member_id);

      // 加载同一槽位所有成员
      const slotData = await fetchSlotAssignments(
        profile.orgId,
        assignmentData.service_type_id,
        assignmentData.service_date
      );
      const map = new Map<string, string>();
      slotData.forEach((s) => map.set(s.member_id, s.id));
      setSlotMemberMap(map);
      setSelectedMemberIds(Array.from(map.keys()));
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  // 切换服务类型或日期时重新加载槽位成员
  async function reloadSlot(newTypeId: string, newDate: string) {
    if (!orgId || !newTypeId || !newDate) return;
    try {
      const slotData = await fetchSlotAssignments(orgId, newTypeId, newDate);
      const map = new Map<string, string>();
      slotData.forEach((s) => map.set(s.member_id, s.id));
      setSlotMemberMap(map);
      setSelectedMemberIds(Array.from(map.keys()));
    } catch {
      // 忽略，保存时再处理冲突
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    if (!serviceTypeId || !serviceDate) {
      setError("请填写服务类型和服务日期");
      setSubmitting(false);
      return;
    }
    if (selectedMemberIds.length === 0) {
      setError("请至少选择一位服务成员");
      setSubmitting(false);
      return;
    }

    try {
      const notesTrimmed = notes.trim() || undefined;
      const sermonTrimmed = sermonTitle.trim() || undefined;

      // 1. 更新原就存在且仍被选中的 assignments
      const updatePromises = selectedMemberIds
        .filter((mid) => slotMemberMap.has(mid))
        .map((mid) =>
          updateServiceAssignment(
            slotMemberMap.get(mid)!,
            serviceTypeId,
            mid,
            serviceDate,
            sermonTrimmed,
            notesTrimmed,
            status
          )
        );

      // 2. 对新勾选的成员批量创建
      const newMembers = selectedMemberIds.filter((mid) => !slotMemberMap.has(mid));
      const createPromise =
        newMembers.length > 0
          ? createBatchServiceAssignments(
              newMembers.map((mid) => ({
                org_id: orgId,
                service_type_id: serviceTypeId,
                member_id: mid,
                service_date: serviceDate,
                sermon_title: sermonTrimmed,
                notes: notesTrimmed,
                status,
              }))
            )
          : Promise.resolve();

      // 3. 删除取消勾选成员的 assignments
      const deletePromises = Array.from(slotMemberMap.entries())
        .filter(([mid]) => !selectedMemberIds.includes(mid))
        .map(([, aid]) => deleteServiceAssignment(aid));

      await Promise.all([...updatePromises, createPromise, ...deletePromises]);

      router.push("/services");
    } catch (err: any) {
      setError(err.message || "保存失败");
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 20 }}>加载中...</div>;
  }

  return (
    <div style={{ padding: 20, maxWidth: 800, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          编辑服务安排
        </h1>
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

      <form
        onSubmit={handleSubmit}
        style={{
          background: "#f5f5f5",
          padding: 20,
          borderRadius: 8,
          display: "grid",
          gap: 14,
        }}
      >
        <label>
          服务类型：
          <select
            value={serviceTypeId}
            onChange={(e) => {
              setServiceTypeId(e.target.value);
              reloadSlot(e.target.value, serviceDate);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: 8,
              marginTop: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
            required
          >
            {serviceTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          服务日期：
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => {
              setServiceDate(e.target.value);
              reloadSlot(serviceTypeId, e.target.value);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: 8,
              marginTop: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
            required
          />
        </label>

        {/* 成员多选 */}
        <div>
          <div style={{ marginBottom: 6, fontWeight: 500 }}>
            服务成员（可多选）：
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#888" }}>
            当前日期和服务类型下已有 {slotMemberMap.size} 位成员；可勾选新增或取消勾选删除。
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 8,
            }}
          >
            {members.map((m) => {
              const isOriginalSlotMember = slotMemberMap.has(m.id);
              const isChecked = selectedMemberIds.includes(m.id);
              const isPrimary = m.id === primaryMemberId;
              return (
                <label
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 8,
                    background: isChecked
                      ? isPrimary
                        ? "#e6f0ff"
                        : "#e6f9e6"
                      : "white",
                    border: isPrimary ? "1px solid #0366d6" : "1px solid #ddd",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() =>
                      setSelectedMemberIds((prev) =>
                        prev.includes(m.id)
                          ? prev.filter((id) => id !== m.id)
                          : [...prev, m.id]
                      )
                    }
                    style={{ cursor: "pointer" }}
                  />
                  <span>
                    {m.name}
                    {isPrimary && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: "#0366d6" }}>
                        （当前）
                      </span>
                    )}
                    {isOriginalSlotMember && !isPrimary && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: "#888" }}>
                        （已有）
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedMemberIds.length === 0 && (
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#c00" }}>
              请至少选择一位服务成员
            </p>
          )}
        </div>

        {serviceTypes.find((t) => t.id === serviceTypeId)?.name ===
          "分享信息" && (
          <label>
            信息题目：
            <input
              type="text"
              value={sermonTitle}
              onChange={(e) => setSermonTitle(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                padding: 8,
                marginTop: 6,
                border: "1px solid #ddd",
                borderRadius: 4,
              }}
              placeholder="请输入信息题目"
            />
          </label>
        )}

        <label>
          状态：
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              padding: 8,
              marginTop: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
            }}
          >
            <option value="scheduled">已安排</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>

        <label>
          备注（可选）：
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              padding: 8,
              marginTop: 6,
              border: "1px solid #ddd",
              borderRadius: 4,
              minHeight: 80,
            }}
            placeholder="如有特殊说明可在此填写"
          />
        </label>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>
          日历仅显示「---」前的内容（最多 40 字）。「---」后内容仅作内部备注，不在日历显示。
        </p>
        {getVisibleNoteLength(notes) > 40 && (
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#e57c00" }}>
            ⚠️ 日历可见部分已超过 40 字（目前 {getVisibleNoteLength(notes)} 字），日历展示时将自动截断。
          </p>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            type="submit"
            disabled={submitting}
            style={{
              padding: "10px 20px",
              background: submitting ? "#ccc" : "#0366d6",
              color: "white",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "保存中..." : "保存"}
          </button>
          <a
            href="/services"
            style={{
              padding: "10px 20px",
              background: "#f5f5f5",
              border: "1px solid #ddd",
              borderRadius: 4,
              textDecoration: "none",
              color: "#666",
            }}
          >
            取消
          </a>
        </div>
      </form>
    </div>
  );
}
