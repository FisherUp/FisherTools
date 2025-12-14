"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

type Account = { id: string; name: string; type: "cash" | "bank" };
type Category = { id: string; name: string };

export default function NewTransactionPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amountYuan, setAmountYuan] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
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

      const { data: accData, error: accErr } = await supabase
        .from("accounts")
        .select("id,name,type")
        .order("created_at", { ascending: true });

      if (accErr) return setMsg("加载账户失败：" + accErr.message);

      const { data: catData, error: catErr } = await supabase
        .from("categories")
        .select("id,name")
        .order("created_at", { ascending: true });

      if (catErr) return setMsg("加载类别失败：" + catErr.message);

      setAccounts(accData ?? []);
      setCategories(catData ?? []);

      if ((accData?.length ?? 0) > 0) setAccountId(accData![0].id);
      if ((catData?.length ?? 0) > 0) setCategoryId(catData![0].id);

      if ((accData?.length ?? 0) === 0) setMsg("提示：accounts 表还没有数据，请先插入账户。");
      if ((catData?.length ?? 0) === 0) setMsg("提示：categories 表还没有数据，请先插入类别。");
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

    setLoading(true);
    try {
      const { error } = await supabase.from("transactions").insert({
        date,
        amount: amountFen,
        direction,
        account_id: accountId,
        category_id: categoryId,
        description: description.trim() || null,
      });

      if (error) return setMsg("保存失败：" + error.message);

      setAmountYuan("");
      setDescription("");
      setMsg("✅ 保存成功！你可以返回列表查看。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      {/* 顶部栏 */}
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
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            将保存为“分”（整数）：{amountFen} 分
          </div>
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

        {!!msg && (
          <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 6 }}>
            {msg}
          </div>
        )}
      </form>
    </div>
  );
}
