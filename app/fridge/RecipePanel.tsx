"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FridgeItem, daysUntil } from "../../lib/fridge";

type RecipeIngredient = {
  name: string;
  amount: string;
  from_fridge: boolean;
};

type Recipe = {
  name: string;
  summary: string;
  why_healthy: string;
  use_first: string[];
  ingredients: RecipeIngredient[];
  missing_ingredients: string[];
  cooking_minutes: number;
  calories_per_serving: number;
  difficulty: string;
  steps: string[];
  safety_note: string;
};

type Preferences = {
  servings: number;
  mealType: string;
  healthGoal: string;
  preferences: string;
  allergies: string;
};

const INITIAL_PREFERENCES: Preferences = {
  servings: 2,
  mealType: "晚餐",
  healthGoal: "营养均衡",
  preferences: "",
  allergies: "",
};

export default function RecipePanel({ items }: { items: FridgeItem[] }) {
  const [form, setForm] = useState<Preferences>(INITIAL_PREFERENCES);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fridge-recipe-preferences");
      if (saved) setForm({ ...INITIAL_PREFERENCES, ...JSON.parse(saved) });
    } catch {
      // A malformed local preference should not block recipe generation.
    }
  }, []);

  const usableItems = useMemo(
    () => items.filter((item) => daysUntil(item.expiry_date) >= 0).slice(0, 80),
    [items]
  );

  const urgentNames = useMemo(
    () => usableItems.filter((item) => daysUntil(item.expiry_date) <= 3 || item.opened).slice(0, 8),
    [usableItems]
  );

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (usableItems.length === 0) return setError("冰箱里暂时没有未过期食材");
    setLoading(true);
    setError("");
    setRecipes([]);
    try {
      localStorage.setItem("fridge-recipe-preferences", JSON.stringify(form));
      const response = await fetch("/api/fridge/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ingredients: usableItems.map((item) => ({
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            days_left: daysUntil(item.expiry_date),
            opened: item.opened,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "食谱生成失败");
      setRecipes(Array.isArray(data.recipes) ? data.recipes : []);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "食谱生成失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="fridge-recipe-layout">
      <div className="fridge-recipe-settings">
        <div className="fridge-section-heading">
          <div>
            <h2>健康食谱</h2>
            <p>根据当前未过期库存生成，临期和已开封食材优先</p>
          </div>
        </div>

        {urgentNames.length > 0 && (
          <div className="fridge-use-first">
            <strong>建议优先消耗</strong>
            <div>{urgentNames.map((item) => <span key={item.id}>{item.name}</span>)}</div>
          </div>
        )}

        <form onSubmit={generate} className="fridge-recipe-form">
          <div className="fridge-form-grid">
            <label className="fridge-field">
              <span>用餐人数</span>
              <input
                type="number"
                min="1"
                max="10"
                value={form.servings}
                onChange={(event) => setForm({ ...form, servings: Number(event.target.value) })}
              />
            </label>
            <label className="fridge-field">
              <span>餐次</span>
              <select
                value={form.mealType}
                onChange={(event) => setForm({ ...form, mealType: event.target.value })}
              >
                <option>早餐</option>
                <option>午餐</option>
                <option>晚餐</option>
                <option>加餐</option>
                <option>不限</option>
              </select>
            </label>
            <label className="fridge-field fridge-span-2">
              <span>健康目标</span>
              <select
                value={form.healthGoal}
                onChange={(event) => setForm({ ...form, healthGoal: event.target.value })}
              >
                <option>营养均衡</option>
                <option>高蛋白</option>
                <option>控油清淡</option>
                <option>增加蔬菜摄入</option>
                <option>儿童友好</option>
                <option>快速烹饪</option>
              </select>
            </label>
            <label className="fridge-field fridge-span-2">
              <span>饮食偏好</span>
              <input
                value={form.preferences}
                maxLength={300}
                onChange={(event) => setForm({ ...form, preferences: event.target.value })}
                placeholder="例如：少辣、偏中式、素食"
              />
            </label>
            <label className="fridge-field fridge-span-2">
              <span>过敏与忌口</span>
              <input
                value={form.allergies}
                maxLength={300}
                onChange={(event) => setForm({ ...form, allergies: event.target.value })}
                placeholder="例如：花生、海鲜、乳糖"
              />
            </label>
          </div>

          {error && <div className="fridge-message error">{error}</div>}
          <button className="fridge-button primary wide" type="submit" disabled={loading || usableItems.length === 0}>
            {loading ? "正在生成..." : `用 ${usableItems.length} 批可用食材生成食谱`}
          </button>
          <p className="fridge-recipe-note">AI 营养和热量信息为估算值；涉及疾病、婴幼儿或严重过敏时请咨询专业人士。</p>
        </form>
      </div>

      <div className="fridge-recipe-results" aria-live="polite">
        {!loading && recipes.length === 0 && (
          <div className="fridge-empty compact">
            <strong>食谱会显示在这里</strong>
            <span>生成前可先填写偏好和过敏信息</span>
          </div>
        )}
        {recipes.map((recipe, index) => (
          <article className="fridge-recipe-card" key={`${recipe.name}-${index}`}>
            <div className="fridge-recipe-card-head">
              <div>
                <span className="fridge-recipe-number">方案 {index + 1}</span>
                <h3>{recipe.name}</h3>
                <p>{recipe.summary}</p>
              </div>
              <div className="fridge-recipe-meta">
                <span>{recipe.cooking_minutes} 分钟</span>
                <span>{recipe.difficulty}</span>
                {recipe.calories_per_serving > 0 && <span>约 {recipe.calories_per_serving} kcal/份</span>}
              </div>
            </div>

            {recipe.why_healthy && <div className="fridge-health-reason">{recipe.why_healthy}</div>}
            {recipe.use_first.length > 0 && (
              <div className="fridge-recipe-block">
                <h4>优先使用</h4>
                <div className="fridge-inline-tags">{recipe.use_first.map((name) => <span key={name}>{name}</span>)}</div>
              </div>
            )}
            <div className="fridge-recipe-block">
              <h4>食材</h4>
              <ul className="fridge-ingredient-list">
                {recipe.ingredients.map((ingredient, ingredientIndex) => (
                  <li key={`${ingredient.name}-${ingredientIndex}`}>
                    <span>{ingredient.name}</span>
                    <span>{ingredient.amount}</span>
                    <small>{ingredient.from_fridge ? "冰箱现有" : "需另备"}</small>
                  </li>
                ))}
              </ul>
              {recipe.missing_ingredients.length > 0 && (
                <p className="fridge-missing">还需准备：{recipe.missing_ingredients.join("、")}</p>
              )}
            </div>
            <div className="fridge-recipe-block">
              <h4>做法</h4>
              <ol>{recipe.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol>
            </div>
            {recipe.safety_note && <div className="fridge-safety-note">食品安全：{recipe.safety_note}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
