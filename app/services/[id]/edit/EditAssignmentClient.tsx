"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchServiceTypes,
  fetchServiceAssignment,
  updateServiceAssignment,
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
  const [memberId, setMemberId] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [sermonTitle, setSermonTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("scheduled");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const profile = await getMyProfile();
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
      setMemberId(assignmentData.member_id);
      setServiceDate(assignmentData.service_date);
      setSermonTitle(assignmentData.sermon_title || "");
      setNotes(assignmentData.notes || "");
      setStatus(assignmentData.status);
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    if (!serviceTypeId || !memberId || !serviceDate) {
      setError("请填写所有必填字段");
      setSubmitting(false);
      return;
    }

    try {
      await updateServiceAssignment(
        assignmentId,
        serviceTypeId,
        memberId,
        serviceDate,
        sermonTitle.trim() || undefined,
        notes.trim() || undefined,
        status
      );

      router.push("/services");
    } catch (err: any) {
      setError(err.message || "更新失败");
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
            onChange={(e) => setServiceTypeId(e.target.value)}
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
          成员：
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
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
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          服务日期：
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
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
