"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import {
  ENTRY_TYPE_LABELS,
  createDraft,
  deleteDraftAttachment,
  errMsg,
  fetchDraftAttachments,
  fetchDraftById,
  getMyProfile,
  updateDraft,
  uploadDraftAttachments,
  type DraftAttachment,
  type DraftEntryType,
  type DraftInput,
} from "../../lib/services/draftService";
import AiTxInputPanel, { type AiTxResult } from "../components/AiTxInputPanel";
import { formatBytes } from "../../lib/services/imageStorageService";

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

export default function DraftFormClient({
  mode,
  draftId,
}: {
  mode: "new" | "edit";
  draftId?: string;
}) {
  const router = useRouter();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [entryType, setEntryType] = useState<DraftEntryType>("reimbursement");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amountYuan, setAmountYuan] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [handler1Id, setHandler1Id] = useState("");
  const [handler2Id, setHandler2Id] = useState("");
  const [description, setDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [msg, setMsg] = useState("");

  const [orgId, setOrgId] = useState("");
  /** 待上传附件（新建时先暂存，保存后才上传） */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  /** 已上传附件（编辑模式） */
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [aiFilled, setAiFilled] = useState("");
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
        const { orgId, role } = await getMyProfile();
        setOrgId(orgId);
        const canWrite = role === "admin" || role === "finance" || role === "coordinator";
        if (!canWrite) {
          router.replace("/drafts");
          return;
        }

        const [{ data: accData }, { data: catData }, { data: memData }] = await Promise.all([
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

        const accs = (accData ?? []) as Account[];
        const cats = (catData ?? []) as Category[];
        setAccounts(accs);
        setCategories(cats);
        setMembers(
          ((memData ?? []) as { id: string; name: string }[]).map((m) => ({
            id: String(m.id),
            name: String(m.name),
          }))
        );

        if (mode === "edit" && draftId) {
          const draft = await fetchDraftById(draftId);
          if (!draft) {
            setMsg("草稿不存在或已被删除。");
            return;
          }
          if (draft.status !== "pending") {
            setMsg("该草稿已确认/转移并锁定，不可编辑。");
            setInitializing(false);
            return;
          }
          setEntryType(draft.entry_type);
          setDate(draft.date.slice(0, 10));
          setDirection(draft.direction);
          setAmountYuan((draft.amount / 100).toFixed(2));
          setAccountId(draft.account_id ?? "");
          setCategoryId(draft.category_id ?? "");
          setHandler1Id(draft.handler1_id ?? "");
          setHandler2Id(draft.handler2_id ?? "");
          setDescription(draft.description ?? "");
          try {
            setAttachments(await fetchDraftAttachments(orgId, draftId));
          } catch (err) {
            console.warn(errMsg(err));
          }
        } else {
          if (accs.length > 0) setAccountId(String(accs[0].id));
          if (cats.length > 0) setCategoryId(String(cats[0].id));
        }
      } catch (e) {
        setMsg(errMsg(e));
      } finally {
        setInitializing(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** AI 解析结果 → 预填表单（不自动提交，用户确认后手动保存） */
  const applyAiResult = useCallback(
    (r: AiTxResult, photo: File | null) => {
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

      if (photo) setPendingFiles((prev) => [...prev, photo]);

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
    },
    [accounts, categories, members]
  );

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    if (attachInputRef.current) attachInputRef.current.value = "";
  };

  /** 编辑模式下立即上传；新建模式在保存后统一上传 */
  const uploadNow = async () => {
    if (mode !== "edit" || !draftId || pendingFiles.length === 0) return;
    setAttBusy(true);
    try {
      const { okCount, savedBytes, errors } = await uploadDraftAttachments(orgId, draftId, pendingFiles);
      setPendingFiles([]);
      setAttachments(await fetchDraftAttachments(orgId, draftId));
      setMsg(
        `✅ 已上传 ${okCount} 张票据（压缩节省约 ${formatBytes(savedBytes)}）。` +
          (errors.length ? `失败 ${errors.length} 个：${errors.join("；")}` : "")
      );
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setAttBusy(false);
    }
  };

  const removeUploaded = async (a: DraftAttachment) => {
    if (!confirm("确定删除这张票据吗？")) return;
    setAttBusy(true);
    try {
      await deleteDraftAttachment(orgId, a.id, a.storage_path);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setAttBusy(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!date) return setMsg("请选择日期");
    if (!accountId) return setMsg("请选择账户");
    if (!categoryId) return setMsg("请选择类别");
    if (amountFen <= 0) return setMsg("请输入正确的金额（必须 > 0）");
    if (handler1Id && handler2Id && handler1Id === handler2Id) {
      return setMsg("经手人1 和 经手人2 不能是同一个人");
    }

    setLoading(true);
    try {
      const { orgId: oid } = await getMyProfile();
      const input: DraftInput = {
        entry_type: entryType,
        date,
        amount: amountFen,
        direction,
        account_id: accountId,
        category_id: categoryId,
        handler1_id: handler1Id || null,
        handler2_id: handler2Id || null,
        description: description.trim() || null,
      };

      if (mode === "edit" && draftId) {
        await updateDraft(draftId, input);
        if (pendingFiles.length > 0) {
          await uploadDraftAttachments(oid, draftId, pendingFiles);
        }
      } else {
        const newId = await createDraft(oid, input);
        if (newId && pendingFiles.length > 0) {
          const { errors } = await uploadDraftAttachments(oid, newId, pendingFiles);
          if (errors.length > 0) {
            setMsg("草稿已保存，但部分票据上传失败：" + errors.join("；"));
            setLoading(false);
            return;
          }
        }
      }
      router.push("/drafts");
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const fieldStyle: React.CSSProperties = { display: "block", width: "100%", padding: 8, marginTop: 6 };

  if (initializing) {
    return <div className="ft-page" style={{ maxWidth: 760 }}>加载中...</div>;
  }

  return (
    <div className="ft-page" style={{ maxWidth: 760 }}>
      <div className="ft-page-head">
        <h1 className="ft-title">{mode === "edit" ? "编辑草稿流水" : "登记草稿流水"}</h1>
        <div style={{ marginLeft: "auto" }}>
          <a href="/drafts" className="ft-btn">
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
          草稿类型：
          <select value={entryType} onChange={(e) => setEntryType(e.target.value as DraftEntryType)} style={fieldStyle}>
            <option value="reimbursement">{ENTRY_TYPE_LABELS.reimbursement}（预登记，待报销后转移至正式流水）</option>
            <option value="proxy">{ENTRY_TYPE_LABELS.proxy}（确认后锁定，不进报表）</option>
          </select>
          <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
            {entryType === "reimbursement"
              ? "适用于：先花了钱、稍后才报销的账目。管理员日后点「转移」即可并入正式流水。"
              : "适用于：组织代为处理、纯记录用途的账目。管理员「确认」后锁定保留，不参与基金与报表计算。"}
          </div>
        </label>

        <label>
          日期：
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
        </label>

        <label>
          收支方向：
          <select value={direction} onChange={(e) => setDirection(e.target.value as "expense" | "income")} style={fieldStyle}>
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
            style={fieldStyle}
          />
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>将保存为“分”（整数）：{amountFen} 分</div>
        </label>

        <label>
          账户：
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={fieldStyle}>
            <option value="">请选择账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.type === "cash" ? "现金" : "银行卡"}）
              </option>
            ))}
          </select>
        </label>

        <label>
          类别：
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={fieldStyle}>
            <option value="">请选择类别</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            经手人1：
            <select value={handler1Id} onChange={(e) => setHandler1Id(e.target.value)} style={fieldStyle}>
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
            <select value={handler2Id} onChange={(e) => setHandler2Id(e.target.value)} style={fieldStyle}>
              <option value="">（可选）</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          备注：
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="例如：买了水果待报销 / 代收某笔款项随即转出"
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </label>

        {/* 票据附件：转移为正式流水时会一并带过去 */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>票据附件：</span>
            <button
              type="button"
              className="ft-btn ft-btn-sm"
              onClick={() => attachInputRef.current?.click()}
              disabled={loading || attBusy}
            >
              📎 添加图片
            </button>
            {mode === "edit" && pendingFiles.length > 0 && (
              <button type="button" className="ft-btn ft-btn-sm ft-btn-primary" onClick={uploadNow} disabled={attBusy}>
                {attBusy ? "上传中…" : `立即上传 ${pendingFiles.length} 张`}
              </button>
            )}
            <span style={{ fontSize: 12, color: "#64748b" }}>
              上传前自动压缩；转移为正式流水时票据会一并同步过去
            </span>
          </div>

          <input
            ref={attachInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
            style={{ display: "none" }}
          />

          {pendingFiles.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {pendingFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                  <span style={{ color: "#94a3b8" }}>{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    style={{ border: "none", background: "transparent", color: "#dc2626", padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {attachments.map((a) => (
                <div key={a.id} style={{ position: "relative" }}>
                  {a.signed_url ? (
                    <a href={a.signed_url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.signed_url}
                        alt="票据"
                        style={{
                          width: 84,
                          height: 84,
                          objectFit: "cover",
                          borderRadius: 8,
                          border: "1px solid #e3e8ef",
                        }}
                      />
                    </a>
                  ) : (
                    <div
                      style={{
                        width: 84,
                        height: 84,
                        borderRadius: 8,
                        border: "1px solid #e3e8ef",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        color: "#94a3b8",
                      }}
                    >
                      无预览
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeUploaded(a)}
                    disabled={attBusy}
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "none",
                      background: "#dc2626",
                      color: "#fff",
                      fontSize: 12,
                      lineHeight: "20px",
                      padding: 0,
                    }}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {msg && (
          <div style={{ padding: 10, background: "#fff3e0", color: "#e65100", borderRadius: 6, fontSize: 13 }}>{msg}</div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "10px 20px",
              fontWeight: 700,
              background: "#1565c0",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {loading ? "保存中..." : mode === "edit" ? "保存修改" : "登记草稿"}
          </button>
          <a
            href="/drafts"
            style={{ padding: "10px 20px", fontWeight: 700, border: "1px solid #ddd", borderRadius: 6, textDecoration: "none", color: "#333" }}
          >
            取消
          </a>
        </div>
      </form>
    </div>
  );
}
