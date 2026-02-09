"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type CategoryRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type BudgetRow = {
  id: string;
  category_id: string;
  year: number;
  amount: number;
  is_enabled: boolean;
};

function formatYuanFromFen(fen: number) {
  return (fen / 100).toFixed(2);
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

export default function BudgetsPage() {
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [budgetMap, setBudgetMap] = useState<Map<string, BudgetRow>>(new Map());

  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState("");

  const [categoryId, setCategoryId] = useState("");
  const [amountYuan, setAmountYuan] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const isAdmin = role === "admin";

  const amountFen = useMemo(() => {
    const n = Number(amountYuan);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  }, [amountYuan]);

  const loadBudgets = async (orgIdValue: string, yearValue: number) => {
    setLoading(true);
    setMsg("");
    try {
      const [{ data: catData, error: catErr }, { data: budData, error: budErr }] = await Promise.all([
        supabase.from("categories").select("id,name,is_active").eq("org_id", orgIdValue).order("name"),
        supabase
          .from("category_budgets")
          .select("id,category_id,year,amount,is_enabled")
          .eq("org_id", orgIdValue)
          .eq("year", yearValue),
      ]);

      if (catErr) setMsg("加载类别失败：" + catErr.message);
      if (budErr) setMsg("加载预算失败：" + budErr.message);

      const catRows: CategoryRow[] = Array.isArray(catData)
        ? catData.map((c: any) => ({
            id: String(c.id),
            name: String(c.name),
            is_active: Boolean(c.is_active),
          }))
        : [];

      const map = new Map<string, BudgetRow>();
      (budData ?? []).forEach((b: any) => {
        map.set(String(b.category_id), {
          id: String(b.id),
          category_id: String(b.category_id),
          year: Number(b.year),
          amount: Number(b.amount),
          is_enabled: b.is_enabled !== false,
        });
      });

      setCategories(catRows);
      setBudgetMap(map);

      if (catRows.length > 0 && !categoryId) {
        setCategoryId(catRows[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const profile = await getMyProfile();
        setOrgId(profile.orgId);
        setRole(profile.role);
        await loadBudgets(profile.orgId, Number(year));
      } catch (e: any) {
        setMsg(String(e?.message ?? e));
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!orgId) return;
    loadBudgets(orgId, Number(year));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, orgId]);

  const startEdit = (catId: string) => {
    const bud = budgetMap.get(catId);
    setCategoryId(catId);
    setAmountYuan(bud ? formatYuanFromFen(bud.amount) : "");
  };

  const resetForm = () => {
    setAmountYuan("");
  };

  const toggleEnabled = async (catId: string) => {
    const bud = budgetMap.get(catId);
    if (!bud) return;
    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase
        .from("category_budgets")
        .update({ is_enabled: !bud.is_enabled, updated_at: new Date().toISOString() })
        .eq("id", bud.id);

      if (error) return setMsg("切换失败：" + error.message);
      await loadBudgets(orgId, Number(year));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return setMsg("仅管理员可维护预算。");

    const yearNum = Number(year);
    if (!Number.isFinite(yearNum) || yearNum < 2000) return setMsg("请输入正确年份");
    if (!categoryId) return setMsg("请选择类别");
    if (amountFen === null) return setMsg("请输入正确预算金额（>= 0）");

    setLoading(true);
    setMsg("");
    try {
      const { error } = await supabase.from("category_budgets").upsert(
        {
          org_id: orgId,
          category_id: categoryId,
          year: yearNum,
          amount: amountFen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,category_id,year" }
      );

      if (error) return setMsg("保存失败：" + error.message);
      setMsg("✅ 预算已保存");
      resetForm();
      await loadBudgets(orgId, yearNum);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>年度预算管理</h1>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <a href="/transactions" style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6 }}>
            ← 返回流水
          </a>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 14 }}>
          年份：
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            style={{ marginLeft: 8, padding: 6, width: 120 }}
          />
        </label>
      </div>

      {!isAdmin && (
        <div style={{ marginBottom: 12, padding: 10, background: "#f5f5f5", borderRadius: 8 }}>
          你当前为非管理员，仅可查看预算信息。
        </div>
      )}

      {!!msg && <div style={{ marginBottom: 12, padding: 10, background: "#fff3cd", borderRadius: 8 }}>{msg}</div>}

      {isAdmin && (
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10, marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>设置预算</div>

          <label>
            类别：
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.is_active ? "" : "（已停用）"}
                </option>
              ))}
            </select>
          </label>

          <label>
            年度预算（元）：
            <input
              inputMode="decimal"
              value={amountYuan}
              onChange={(e) => setAmountYuan(e.target.value)}
              placeholder="例如：12000"
              style={{ display: "block", width: "100%", padding: 8, marginTop: 6 }}
            />
            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
              将保存为“分”（整数）：{amountFen === null ? "-" : amountFen} 分
            </div>
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={loading} style={{ padding: "8px 12px", fontWeight: 700 }}>
              {loading ? "处理中..." : "保存"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              style={{ padding: "8px 12px", border: "1px solid #ddd", background: "#fff" }}
            >
              清空输入
            </button>
          </div>
        </form>
      )}

      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>类别</th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>状态</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>年度预算（元）</th>
              <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee" }}>参与展示</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} style={{ padding: 14, color: "#666" }}>
                  暂无类别
                </td>
              </tr>
            ) : (
              categories.map((c) => {
                const bud = budgetMap.get(c.id);
                return (
                  <tr key={c.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{c.name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>{c.is_active ? "启用" : "停用"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                      {bud ? formatYuanFromFen(bud.amount) : "-"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                      {bud ? (
                        isAdmin ? (
                          <button
                            type="button"
                            onClick={() => toggleEnabled(c.id)}
                            disabled={loading}
                            style={{
                              border: "1px solid",
                              borderColor: bud.is_enabled ? "#28a745" : "#999",
                              color: bud.is_enabled ? "#28a745" : "#999",
                              background: "transparent",
                              padding: "2px 8px",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12,
                            }}
                          >
                            {bud.is_enabled ? "✅ 展示" : "❌ 隐藏"}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: bud.is_enabled ? "#28a745" : "#999" }}>
                            {bud.is_enabled ? "展示" : "隐藏"}
                          </span>
                        )
                      ) : (
                        <span style={{ color: "#ccc", fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => startEdit(c.id)}
                          style={{ border: "1px solid #0366d6", color: "#0366d6" }}
                        >
                          {bud ? "编辑" : "设置"}
                        </button>
                      ) : (
                        <span style={{ color: "#999" }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
