"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type Account = { id: string; name: string; type: "cash" | "bank"; is_active: boolean };
type Category = { id: string; name: string; is_active: boolean };
type Member = { id: string; name: string };

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

      const { error } = await supabase.from("transactions").insert({
        org_id: orgId, // ✅ 必须写入 org_id（配合 RLS）
        date,
        amount: amountFen,
        direction,
        account_id: accountId,
        category_id: categoryId,
        description: description.trim() || null,
        handler1_id: handler1Id || null,
        handler2_id: handler2Id || null,
      });

      if (error) return setMsg("保存失败：" + error.message);

      setAmountYuan("");
      setDescription("");
      setHandler1Id("");
      setHandler2Id("");

      setMsg("✅ 保存成功！你可以返回列表查看。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>新增收支流水</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a
            href="/transactions"
            style={{
              padding: "8px 12px",
              border: "1px solid #ddd",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            ← 返回列表
          </a>
        </div>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
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
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>将保存为"分"（整数）：{amountFen} 分</div>
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
            style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            rows={3}
          />
        </label>

        <button type="submit" disabled={loading} style={{ padding: 10, fontWeight: 700 }}>
          {loading ? "保存中..." : "保存"}
        </button>

        {!!msg && <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}>{msg}</div>}
      </form>
    </div>
  );
}
