"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import AiTxInputPanel, { type AiTxResult } from "../../components/AiTxInputPanel";
import { formatBytes, uploadReceiptImageFile } from "../../../lib/services/imageStorageService";

type Account = { id: string; name: string; type: "cash" | "bank"; is_active: boolean };
type Category = { id: string; name: string; is_active: boolean };
type Member = { id: string; name: string };

/** 按名称在候选列表里找 id（AI 返回的是名称） */
function matchIdByName<T extends { id: string; name: string }>(list: T[], name: string): string {
  const s = (name ?? "").trim();
  if (!s) return "";
  const exact = list.find((x) => x.name === s);
  if (exact) return exact.id;
  const fuzzy = list.find((x) => x.name.includes(s) || s.includes(x.name));
  return fuzzy ? fuzzy.id : "";
}

async function getMyProfile() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw new Error(userErr.message);
  const user = userRes.user;
  if (!user) throw new Error("未登录，请先登录。");

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (pErr) throw new Error("读取 profiles 失败：" + pErr.message);
  if (!profile?.org_id) throw new Error("profiles.org_id 为空，请为该用户设置组织。");

  return { userId: user.id, orgId: String(profile.org_id), role: String(profile.role ?? "") };
}

export default function NewTransactionClient() {
  const searchParams = useSearchParams();

  // ✅ 返回列表时保留来源月份
  const backUrl = useMemo(() => {
    const fy = searchParams.get("from_year");
    const fm = searchParams.get("from_month");
    if (fy && fm) return `/transactions?year=${fy}&month=${fm}`;
    return "/transactions";
  }, [searchParams]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amountYuan, setAmountYuan] = useState<string>("");

  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");

  // ✅ 经手人 1/2
  const [handler1Id, setHandler1Id] = useState<string>("");
  const [handler2Id, setHandler2Id] = useState<string>("");

  const [description, setDescription] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  /** 待上传的票据附件（AI 拍照留存 或 手动选择） */
  const [attachFiles, setAttachFiles] = useState<File[]>([]);
  /** AI 已填表提示，提醒用户确认后再提交 */
  const [aiFilled, setAiFilled] = useState<string>("");
  const attachInputRef = useRef<HTMLInputElement>(null);

  const amountFen = useMemo(() => {
    const n = Number(amountYuan);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [amountYuan]);

  useEffect(() => {
    const load = async () => {
      setMsg("");
      try {
        const { orgId } = await getMyProfile();

        const [{ data: accData, error: accErr }, { data: catData, error: catErr }, { data: memData, error: memErr }] =
          await Promise.all([
            supabase
              .from("accounts")
              .select("id,name,type,is_active")
              .eq("org_id", orgId)
              .eq("is_active", true)
              .order("created_at", { ascending: true }),
            supabase
              .from("categories")
              .select("id,name,is_active")
              .eq("org_id", orgId)
              .eq("is_active", true)
              .order("created_at", { ascending: true }),
            supabase
              .from("members")
              .select("id,name")
              .eq("org_id", orgId)
              .eq("is_active", true)
              .order("name", { ascending: true }),
          ]);

        if (accErr) return setMsg("加载账户失败：" + accErr.message);
        if (catErr) return setMsg("加载类别失败：" + catErr.message);
        if (memErr) return setMsg("加载成员失败：" + memErr.message);

        setAccounts(accData ?? []);
        setCategories(catData ?? []);
        setMembers(
          Array.isArray(memData)
            ? memData.map((m: any) => ({ id: String(m.id), name: String(m.name) }))
            : []
        );

        if ((accData?.length ?? 0) > 0) setAccountId(String(accData![0].id));
        if ((catData?.length ?? 0) > 0) setCategoryId(String(catData![0].id));

        setHandler1Id("");
        setHandler2Id("");

        if ((accData?.length ?? 0) === 0) setMsg("提示：accounts 表还没有数据，请先插入账户。");
        if ((catData?.length ?? 0) === 0) setMsg("提示：categories 表还没有数据，请先插入类别。");
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      }
    };

    load();
  }, []);

  /** AI 解析结果 → 预填表单（不自动提交，用户确认后手动点保存） */
  const applyAiResult = (r: AiTxResult, photo: File | null) => {
    const filled: string[] = [];

    if (r.date) {
      setDate(r.date);
      filled.push("日期");
    }
    setDirection(r.direction);
    filled.push("收支");

    if (r.amount_yuan > 0) {
      setAmountYuan(String(r.amount_yuan));
      filled.push("金额");
    }

    const catId = matchIdByName(categories, r.category);
    if (catId) {
      setCategoryId(catId);
      filled.push("类别");
    }

    const accId = matchIdByName(accounts, r.account);
    if (accId) {
      setAccountId(accId);
      filled.push("账户");
    }

    const h1 = matchIdByName(members, r.handler1);
    if (h1) {
      setHandler1Id(h1);
      filled.push("经手人1");
    }
    const h2 = matchIdByName(members, r.handler2);
    if (h2 && h2 !== h1) {
      setHandler2Id(h2);
      filled.push("经手人2");
    }

    if (r.description) {
      setDescription(r.description);
      filled.push("备注");
    }

    if (photo) setAttachFiles((prev) => [...prev, photo]);

    const missing: string[] = [];
    if (r.amount_yuan <= 0) missing.push("金额");
    if (!catId) missing.push("类别");
    if (!accId) missing.push("账户");

    setAiFilled(
      `AI 已填写：${filled.join("、") || "（无）"}` +
        (missing.length ? `；请手动补充：${missing.join("、")}` : "") +
        "。请核对无误后再点击保存。"
    );
    setMsg("");
  };

  const onPickAttachments = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) setAttachFiles((prev) => [...prev, ...files]);
    if (attachInputRef.current) attachInputRef.current.value = "";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!accountId) return setMsg("请选择账户");
    if (!categoryId) return setMsg("请选择类别");
    if (!date) return setMsg("请选择日期");
    if (amountFen <= 0) return setMsg("请输入正确的金额（必须 > 0）");

    if (handler1Id && handler2Id && handler1Id === handler2Id) {
      return setMsg("经手人1 和 经手人2 不能是同一个人");
    }

    setLoading(true);
    try {
      const { orgId } = await getMyProfile();

      // 需要拿回 id 才能把附件挂到这条流水上
      const { data: inserted, error } = await supabase
        .from("transactions")
        .insert({
          org_id: orgId, // ✅ 必须写入 org_id（配合 RLS）
          date,
          amount: amountFen,
          direction,
          account_id: accountId,
          category_id: categoryId,
          description: description.trim() || null,
          handler1_id: handler1Id || null,
          handler2_id: handler2Id || null,
        })
        .select("id")
        .single();

      if (error) return setMsg("保存失败：" + error.message);

      let attachMsg = "";
      if (inserted?.id && attachFiles.length > 0) {
        attachMsg = await uploadPendingAttachments(orgId, String(inserted.id));
      }

      setAmountYuan("");
      setDescription("");
      setHandler1Id("");
      setHandler2Id("");
      setAttachFiles([]);
      setAiFilled("");

      setMsg(`✅ 保存成功！${attachMsg}你可以返回列表查看。`);
    } finally {
      setLoading(false);
    }
  };

  /** 提交成功后把待上传附件压缩并写入 attachments */
  const uploadPendingAttachments = async (orgId: string, txId: string): Promise<string> => {
    let saved = 0;
    const errors: string[] = [];

    for (const file of attachFiles) {
      try {
        const uploaded = await uploadReceiptImageFile(orgId, txId, file);
        const { error: insErr } = await supabase.from("attachments").insert({
          org_id: orgId,
          transaction_id: txId,
          storage_path: uploaded.storagePath,
          file_url: uploaded.storagePath,
        });
        if (insErr) {
          await supabase.storage.from("receipts").remove([uploaded.storagePath]);
          errors.push(`${file.name}：${insErr.message}`);
          continue;
        }
        saved += Math.max(0, uploaded.originalBytes - uploaded.uploadedBytes);
      } catch (err: unknown) {
        errors.push(`${file.name}：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const okCount = attachFiles.length - errors.length;
    const okText = okCount > 0 ? `已上传 ${okCount} 张附件（压缩节省约 ${formatBytes(saved)}）。` : "";
    const errText = errors.length > 0 ? `附件失败 ${errors.length} 个：${errors.join("；")}。` : "";
    return okText + errText;
  };

  return (
    <div className="ft-page" style={{ maxWidth: 760 }}>
      <div className="ft-page-head">
        <h1 className="ft-title">新增收支流水</h1>

        <div style={{ marginLeft: "auto" }}>
          <a href={backUrl} className="ft-btn">
            ← 返回列表
          </a>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <AiTxInputPanel onParsed={applyAiResult} disabled={loading} />
      </div>

      {!!aiFilled && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 8,
            fontSize: 13,
            color: "#1d4ed8",
          }}
        >
          {aiFilled}
        </div>
      )}

      <form onSubmit={onSubmit} className="ft-card" style={{ display: "grid", gap: 12 }}>
        <label>
          日期：
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
        </label>

        <label>
          类型：
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as any)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </label>

        <label>
          金额（元）：
          <input
            inputMode="decimal"
            placeholder="例如：12.34"
            value={amountYuan}
            onChange={(e) => setAmountYuan(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          />
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>将保存为“分”（整数）：{amountFen} 分</div>
        </label>

        <label>
          账户：
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.type === "cash" ? "现金" : "银行卡"}）
              </option>
            ))}
          </select>
        </label>

        <label>
          类别：
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {/* ✅ 经手人 1/2 */}
        <label>
          经手人1：
          <select
            value={handler1Id}
            onChange={(e) => setHandler1Id(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            <option value="">（可选）</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          经手人2：
          <select
            value={handler2Id}
            onChange={(e) => setHandler2Id(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
          >
            <option value="">（可选）</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>提示：经手人1/2 不能选择同一个人。</div>
        </label>

        <label>
          备注：
          <textarea
            placeholder="例如：12月团建聚餐"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6, boxSizing: "border-box" }}
            rows={3}
          />
        </label>

        {/* 票据附件：提交时一并上传（自动压缩） */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>票据附件：</span>
            <button
              type="button"
              className="ft-btn ft-btn-sm"
              onClick={() => attachInputRef.current?.click()}
              disabled={loading}
            >
              📎 添加图片
            </button>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {attachFiles.length > 0 ? `已选 ${attachFiles.length} 张，保存时自动压缩上传` : "可选，上传前会自动压缩"}
            </span>
          </div>

          <input
            ref={attachInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickAttachments}
            style={{ display: "none" }}
          />

          {attachFiles.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {attachFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    background: "#f6f8fa",
                    border: "1px solid #e3e8ef",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                  <span style={{ color: "#94a3b8" }}>{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setAttachFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    style={{ border: "none", background: "transparent", color: "#dc2626", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button type="submit" disabled={loading} className="ft-btn ft-btn-primary" style={{ height: 42 }}>
          {loading ? "保存中..." : "保存"}
        </button>

        {!!msg && <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}>{msg}</div>}
      </form>
    </div>
  );
}
