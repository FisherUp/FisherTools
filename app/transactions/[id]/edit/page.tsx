"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabaseClient";

type Account = { id: string; name: string; type: "cash" | "bank" };
type Category = { id: string; name: string };

type Tx = {
  id: string;
  date: string;
  amount: number; // 分
  direction: "income" | "expense";
  account_id: string;
  category_id: string;
  description: string | null;
};

type AttachmentRow = {
  id: string;
  transaction_id: string;
  org_id: string;
  storage_path: string;
  created_at: string;
};

type AttachmentView = AttachmentRow & {
  signed_url: string; // 临时访问链接
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const BUCKET = "receipts";
const SIGNED_URL_TTL = 300; // 5分钟

function safeStr(v: any) {
  return v === null || v === undefined ? "" : String(v);
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

  return { userId: user.id, orgId: String(profile.org_id), role: String(profile.role) };
}

export default function EditTransactionPage({ params }: { params: { id: string } }) {
  const id = params.id;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amountYuan, setAmountYuan] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");

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

  // ✅ 读取附件行 + 为每条生成 signed url
  const loadAttachments = async () => {
    setAttMsg("");

    try {
      // 确保登录 + profile OK（也让 RLS 的 current_org_id 生效）
      await getMyProfile();

      const { data, error } = await supabase
        .from("attachments")
        .select("id, transaction_id, org_id, storage_path, created_at")
        .eq("transaction_id", id)
        .order("created_at", { ascending: false });

      if (error) {
        setAttMsg("加载票据失败：" + error.message);
        setAttachments([]);
        return;
      }

      const rows: AttachmentRow[] = Array.isArray(data)
        ? data
            .filter((x: any) => x.storage_path) // 防呆：不显示空路径
            .map((x: any) => ({
              id: safeStr(x.id),
              transaction_id: safeStr(x.transaction_id),
              org_id: safeStr(x.org_id),
              storage_path: safeStr(x.storage_path),
              created_at: safeStr(x.created_at),
            }))
        : [];

      // 并行生成 signed url（更快）
      const views: AttachmentView[] = await Promise.all(
        rows.map(async (r) => {
          const { data: sData, error: sErr } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(r.storage_path, SIGNED_URL_TTL);

          return {
            ...r,
            signed_url: sErr || !sData?.signedUrl ? "" : sData.signedUrl,
          };
        })
      );

      setAttachments(views);
    } catch (e: any) {
      setAttMsg(String(e?.message ?? e));
      setAttachments([]);
    }
  };

  // ✅ 上传：Storage 上传成功后，必须插入 attachments（否则页面无法显示）
  const uploadReceipts = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    // 校验大小
    for (const f of Array.from(fileList)) {
      if (f.size > MAX_FILE_SIZE) {
        setAttMsg(`❌ 文件 ${f.name} 超过 20MB（${(f.size / 1024 / 1024).toFixed(1)}MB），请压缩后再上传`);
        return;
      }
    }

    setFilesUploading(true);
    setAttMsg("");

    try {
      const { orgId, role } = await getMyProfile();

      // 角色提醒（如果你 RLS 只允许 finance/admin 写 attachments）
      if (!["admin", "finance"].includes(role)) {
        setAttMsg(`⚠️ 你的角色是 ${role}，按 RLS 可能没有写入附件权限（finance/admin 才能上传）。`);
      }

      const errors: string[] = [];

      for (const file of Array.from(fileList)) {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const storagePath = `${orgId}/${id}/${Date.now()}_${safeName}`;

        // 1) 上传到 Storage
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
          upsert: false,
        });

        if (upErr) {
          console.error("UPLOAD ERROR:", upErr);
          errors.push(`上传失败(${file.name})：${upErr.message}`);
          continue;
        }

        // 2) 写入 attachments（关键：用 select().single() 强制返回，确保真的写入）
        const { data: insData, error: insErr } = await supabase
          .from("attachments")
          .insert({
            org_id: orgId,
            transaction_id: id,
            storage_path: storagePath,
            // file_url：正式版可不写
          })
          .select("id, transaction_id, org_id, storage_path, created_at")
          .single();

        if (insErr || !insData?.id) {
          console.error("INSERT attachments ERROR:", insErr);

          // 回滚刚上传的文件，避免 Storage 里留下“孤儿文件”
          await supabase.storage.from(BUCKET).remove([storagePath]);

          errors.push(`写入附件失败(${file.name})：${insErr?.message || "unknown error"}（已回滚Storage文件）`);
          continue;
        }
      }

      // 刷新
      await loadAttachments();

      if (errors.length > 0) {
        setAttMsg("部分失败：\n" + errors.join("\n"));
      } else {
        setAttMsg("✅ 上传完成（已写入 attachments，并可显示）");
      }
    } catch (e: any) {
      setAttMsg(String(e?.message ?? e));
    } finally {
      setFilesUploading(false);
    }
  };

  // ✅ 删除：先删 storage 文件，再删 attachments 行
  const deleteReceipt = async (a: AttachmentView) => {
    const ok = confirm("确定要删除这张票据吗？此操作不可恢复。");
    if (!ok) return;

    setAttMsg("");

    try {
      const { orgId } = await getMyProfile();

      const { error: stErr } = await supabase.storage.from(BUCKET).remove([a.storage_path]);
      if (stErr) return setAttMsg("删除 Storage 文件失败：" + stErr.message);

      const { error: dbErr } = await supabase
        .from("attachments")
        .delete()
        .eq("id", a.id)
        .eq("org_id", orgId);

      if (dbErr) return setAttMsg("删除附件记录失败：" + dbErr.message);

      await loadAttachments();
      setAttMsg("✅ 票据已删除");
    } catch (e: any) {
      setAttMsg("删除异常：" + String(e?.message ?? e));
    }
  };

  // 初始化加载
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setMsg("");

      try {
        await getMyProfile();

        const [{ data: acc, error: accErr }, { data: cat, error: catErr }] = await Promise.all([
          supabase.from("accounts").select("id,name,type").order("created_at", { ascending: true }),
          supabase.from("categories").select("id,name").order("created_at", { ascending: true }),
        ]);

        if (accErr) setMsg("加载账户失败：" + accErr.message);
        if (catErr) setMsg("加载类别失败：" + catErr.message);

        setAccounts(acc ?? []);
        setCategories(cat ?? []);

        const { data: tx, error: txErr } = await supabase
          .from("transactions")
          .select("id,date,amount,direction,account_id,category_id,description")
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
        })
        .eq("id", id);

      if (error) return setMsg("保存失败：" + error.message);
      setMsg("✅ 保存成功");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 860, margin: "40px auto", padding: 16 }}>
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

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
        <input value={amountYuan} onChange={(e) => setAmountYuan(e.target.value)} placeholder="金额（元）" />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="备注" />
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

      {!!attMsg && (
        <pre style={{ marginTop: 8, background: "#f5f5f5", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap" }}>
          {attMsg}
        </pre>
      )}

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
                <img src={a.signed_url} style={{ width: "100%", height: 160, objectFit: "cover" }} alt="receipt" />
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
