"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabaseClient";
import { fetchUserDisplayMap, resolveUserDisplay } from "../../../../lib/services/userDisplay";

type Account = { id: string; name: string; type: "cash" | "bank" };
type Category = { id: string; name: string };
type Member = { id: string; name: string };

type Tx = {
  id: string;
  date: string;
  amount: number; // 分
  direction: "income" | "expense";
  account_id: string;
  category_id: string;
  description: string | null;
  handler1_id: string | null;
  handler2_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type AttachmentRow = {
  id: string;
  transaction_id: string;
  org_id: string;
  storage_path: string;
  file_url: string;
  created_at: string;
};

type AttachmentView = AttachmentRow & {
  signed_url: string; // 临时访问链接
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const BUCKET = "receipts";
const SIGNED_URL_TTL = 300; // 5分钟

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

export default function EditTransactionPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amountYuan, setAmountYuan] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");

  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const [userDisplayMap, setUserDisplayMap] = useState<Map<string, string>>(new Map());

  // ✅ 经手人1/2
  const [handler1Id, setHandler1Id] = useState<string>("");
  const [handler2Id, setHandler2Id] = useState<string>("");

  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [filesUploading, setFilesUploading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [attMsg, setAttMsg] = useState("");

  const amountFen = useMemo(() => {
    const n = Number(amountYuan);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [amountYuan]);

  const fmtDateTimeMaybe = (v: string | null) => {
    if (!v) return "-";
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return "-";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}`;
  };


  const loadAttachments = async () => {
    setAttMsg("");

    try {
      const { orgId } = await getMyProfile();

      const { data, error } = await supabase
        .from("attachments")
        .select("id, transaction_id, org_id, storage_path, file_url, created_at")
        .eq("transaction_id", id)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) {
        setAttMsg("加载票据失败：" + error.message);
        setAttachments([]);
        return;
      }

      const rows: AttachmentRow[] = Array.isArray(data)
        ? data.map((x: any) => ({
            id: String(x.id),
            transaction_id: String(x.transaction_id),
            org_id: String(x.org_id),
            storage_path: String(x.storage_path ?? ""),
            file_url: String(x.file_url ?? ""),
            created_at: String(x.created_at),
          }))
        : [];

      const views: AttachmentView[] = [];
      for (const r of rows) {
        if (!r.storage_path) {
          views.push({ ...r, signed_url: "" });
          continue;
        }
        const { data: sData, error: sErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(r.storage_path, SIGNED_URL_TTL);

        if (sErr || !sData?.signedUrl) {
          console.error("createSignedUrl error:", sErr);
          views.push({ ...r, signed_url: "" });
        } else {
          views.push({ ...r, signed_url: sData.signedUrl });
        }
      }

      setAttachments(views);
    } catch (e: any) {
      setAttMsg(String(e?.message ?? e));
      setAttachments([]);
    }
  };

  const uploadReceipts = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    for (const f of Array.from(fileList)) {
      if (f.size > MAX_FILE_SIZE) {
        setAttMsg(`❌ 文件 ${f.name} 超过 20MB（${(f.size / 1024 / 1024).toFixed(1)}MB），请压缩后再上传`);
        return;
      }
    }

    setFilesUploading(true);
    setAttMsg("");

    try {
      const { orgId } = await getMyProfile();

      for (const file of Array.from(fileList)) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const storagePath = `${orgId}/${id}/${Date.now()}_${safeName}`;

        // 1) 上传 Storage
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
          upsert: false,
        });

        if (upErr) {
          console.error("UPLOAD ERROR:", upErr);
          setAttMsg("上传失败：" + upErr.message);
          continue;
        }

        // 2) 写 attachments（✅ 同时写 file_url 和 storage_path，避免 NOT NULL）
        const { error: insErr } = await supabase.from("attachments").insert({
          org_id: orgId,
          transaction_id: id,
          storage_path: storagePath,
          file_url: storagePath, // ✅ 用 storagePath 占位（正式版也够用）
        });

        if (insErr) {
          // 写入失败就回滚 storage 文件，避免“storage 有文件但表没记录”
          console.error("INSERT attachment ERROR:", insErr);
          await supabase.storage.from(BUCKET).remove([storagePath]);
          setAttMsg(`写入附件失败（${file.name}）：${insErr.message}（已回滚Storage文件）`);
        }
      }

      await loadAttachments();
      setAttMsg("✅ 上传完成");
    } catch (e: any) {
      setAttMsg(String(e?.message ?? e));
    } finally {
      setFilesUploading(false);
    }
  };

  const deleteReceipt = async (a: AttachmentView) => {
    const ok = confirm("确定要删除这张票据吗？此操作不可恢复。");
    if (!ok) return;

    setAttMsg("");

    try {
      const { orgId } = await getMyProfile();

      const { error: stErr } = await supabase.storage.from(BUCKET).remove([a.storage_path]);
      if (stErr) return setAttMsg("删除 Storage 文件失败：" + stErr.message);

      const { error: dbErr } = await supabase.from("attachments").delete().eq("id", a.id).eq("org_id", orgId);
      if (dbErr) return setAttMsg("删除附件记录失败：" + dbErr.message);

      await loadAttachments();
      setAttMsg("✅ 票据已删除");
    } catch (e: any) {
      setAttMsg("删除异常：" + String(e?.message ?? e));
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setMsg("");

      try {
        const { orgId } = await getMyProfile();

        const [
          { data: acc, error: accErr },
          { data: cat, error: catErr },
          { data: mem, error: memErr },
        ] = await Promise.all([
          supabase.from("accounts").select("id,name,type").order("created_at", { ascending: true }),
          supabase.from("categories").select("id,name").order("created_at", { ascending: true }),
          supabase
            .from("members")
            .select("id,name")
            .eq("org_id", orgId)
            .eq("is_active", true)
            .order("name", { ascending: true }),
        ]);

        if (accErr) setMsg("加载账户失败：" + accErr.message);
        if (catErr) setMsg("加载类别失败：" + catErr.message);
        if (memErr) setMsg("加载成员失败：" + memErr.message);

        setAccounts(acc ?? []);
        setCategories(cat ?? []);
        setMembers(
          Array.isArray(mem)
            ? mem.map((m: any) => ({ id: String(m.id), name: String(m.name) }))
            : []
        );

        const { data: tx, error: txErr } = await supabase
          .from("transactions")
          .select(
            "id,date,amount,direction,account_id,category_id,description,handler1_id,handler2_id,created_by,updated_by,created_at,updated_at"
          )
          .eq("id", id)
          .single();

        if (txErr) {
          setMsg("加载流水失败：" + txErr.message);
          return;
        }

        const t = tx as Tx;
        setDate(t.date);
        setDirection(t.direction);
        setAmountYuan((t.amount / 100).toFixed(2));
        setAccountId(t.account_id);
        setCategoryId(t.category_id);
        setDescription(t.description ?? "");

        setHandler1Id(t.handler1_id ? String(t.handler1_id) : "");
        setHandler2Id(t.handler2_id ? String(t.handler2_id) : "");

        const cb = t.created_by ? String(t.created_by) : null;
        const ub = t.updated_by ? String(t.updated_by) : null;
        setCreatedBy(cb);
        setUpdatedBy(ub);
        setCreatedAt(t.created_at ? String(t.created_at) : null);
        setUpdatedAt(t.updated_at ? String(t.updated_at) : null);

        const ids = Array.from(new Set([cb, ub].filter(Boolean) as string[]));
        if (orgId && ids.length > 0) {
          const displayMap = await fetchUserDisplayMap(ids, orgId);
          setUserDisplayMap(displayMap);
        } else {
          setUserDisplayMap(new Map());
        }

        await loadAttachments();
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    };

    loadAll();
  }, [id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    if (!date) return setMsg("请选择日期");
    if (!accountId) return setMsg("请选择账户");
    if (!categoryId) return setMsg("请选择类别");
    if (amountFen <= 0) return setMsg("金额必须大于 0");

    if (handler1Id && handler2Id && handler1Id === handler2Id) {
      return setMsg("经手人1 和 经手人2 不能是同一个人");
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("transactions")
        .update({
          date,
          direction,
          amount: amountFen,
          account_id: accountId,
          category_id: categoryId,
          description: description.trim() || null,
          handler1_id: handler1Id || null,
          handler2_id: handler2Id || null,
        })
        .eq("id", id);

      if (error) return setMsg("保存失败：" + error.message);
      setMsg("✅ 保存成功");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>编辑流水</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回列表
          </a>
          <a href="/transactions/new" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            + 新增
          </a>
        </div>
      </div>

      {!!msg && <div style={{ background: "#fff3cd", padding: 10, borderRadius: 8 }}>{msg}</div>}

      <div style={{ marginTop: 12, padding: 10, background: "#f5f5f5", borderRadius: 8, fontSize: 12 }}>
        <div>创建人：{resolveUserDisplay(createdBy, userDisplayMap)}</div>
        <div>创建时间：{fmtDateTimeMaybe(createdAt)}</div>
        <div>最后修改人：{resolveUserDisplay(updatedBy, userDisplayMap)}</div>
        <div>最后修改时间：{fmtDateTimeMaybe(updatedAt)}</div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <label>
          日期：
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label>
          类型：
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </label>

        <label>
          金额（元）：
          <input value={amountYuan} onChange={(e) => setAmountYuan(e.target.value)} placeholder="金额（元）" />
        </label>

        <label>
          账户：
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.type === "cash" ? "现金" : "银行卡"}）
              </option>
            ))}
          </select>
        </label>

        <label>
          类别：
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
          <select value={handler1Id} onChange={(e) => setHandler1Id(e.target.value)}>
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
          <select value={handler2Id} onChange={(e) => setHandler2Id(e.target.value)}>
            <option value="">（可选）</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: "#666" }}>提示：经手人1/2 不能选择同一个人。</div>
        </label>

        <label>
          备注：
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="备注" rows={3} />
        </label>

        <button disabled={loading}>{loading ? "保存中..." : "保存"}</button>
      </form>

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 16, fontWeight: 800 }}>票据图片（Private + Signed URL，≤20MB）</h2>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={filesUploading}
          onChange={(e) => uploadReceipts(e.target.files)}
        />
        <button type="button" onClick={loadAttachments} disabled={filesUploading}>
          刷新票据（重新签名）
        </button>
      </div>

      {!!attMsg && <div style={{ marginTop: 8, background: "#f5f5f5", padding: 10, borderRadius: 8 }}>{attMsg}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {attachments.map((a) => (
          <div
            key={a.id}
            style={{ position: "relative", border: "1px solid #eee", borderRadius: 10, overflow: "hidden" }}
          >
            {a.signed_url ? (
              <a href={a.signed_url} target="_blank" rel="noreferrer">
                <img src={a.signed_url} style={{ width: "100%", height: 160, objectFit: "cover" }} />
              </a>
            ) : (
              <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                无法生成签名链接（点刷新重试）
              </div>
            )}

            <button
              type="button"
              onClick={() => deleteReceipt(a)}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(0,0,0,0.65)",
                color: "white",
                border: "none",
                borderRadius: 6,
                padding: "4px 8px",
                cursor: "pointer",
              }}
            >
              删除
            </button>

            <div style={{ padding: 8, fontSize: 12, color: "#666" }}>
              {new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
