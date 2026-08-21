import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  AzureOpenAIError,
  requestAzureJson,
} from "../../../../lib/server/azureOpenAI";

export const runtime = "edge";

type RecipeRequest = {
  ingredients?: unknown[];
  servings?: number;
  mealType?: string;
  healthGoal?: string;
  preferences?: string;
  allergies?: string;
};

export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: RecipeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const ingredients = (Array.isArray(body.ingredients) ? body.ingredients : [])
    .slice(0, 80)
    .map(normalizeIngredient)
    .filter(Boolean);
  if (ingredients.length === 0) {
    return NextResponse.json({ error: "没有可用于生成食谱的未过期食材" }, { status: 400 });
  }

  const servings = Math.round(clamp(Number(body.servings), 1, 10, 2));
  const mealType = clean(body.mealType, 30) || "不限";
  const healthGoal = clean(body.healthGoal, 80) || "营养均衡";
  const preferences = clean(body.preferences, 300) || "无";
  const allergies = clean(body.allergies, 300) || "无";

  const systemPrompt = `你是谨慎的家庭营养食谱助手。请根据库存生成 3 个可执行的健康食谱。

硬性规则：
1. 过敏/忌口是最高优先级。不得在食材、调味料、替代建议中出现用户声明的过敏项；无法确认安全时明确提示，不要猜测。
2. 优先使用 days_left 最小且大于等于 0 的食材，其次优先 opened=true 的食材。不要使用已过期食物。
3. 可以列少量缺少的常见配料，但主体必须来自现有库存；避免声称能治疗疾病。
4. 热量只是合理估算值。步骤简洁明确，适合家庭烹饪。
5. 严格返回 JSON，不要 markdown。

返回格式：
{"recipes":[{"name":"名称","summary":"一句话说明","why_healthy":"健康理由","use_first":["优先消耗的库存食材"],"ingredients":[{"name":"食材","amount":"用量","from_fridge":true}],"missing_ingredients":["需另备配料"],"cooking_minutes":25,"calories_per_serving":450,"difficulty":"简单","steps":["步骤1","步骤2"],"safety_note":"必要的食品安全提示"}]}`;

  const userText = `人数：${servings}
餐次：${mealType}
健康目标：${healthGoal}
饮食偏好：${preferences}
过敏与忌口：${allergies}
当前库存（已排除过期项）：${JSON.stringify(ingredients)}`;

  try {
    const parsed = await requestAzureJson({
      systemPrompt,
      userText,
      maxTokens: 3000,
      temperature: 0.45,
    });
    const recipes = (Array.isArray(parsed.recipes) ? parsed.recipes : [])
      .slice(0, 3)
      .map(normalizeRecipe)
      .filter(Boolean);
    if (recipes.length === 0) {
      return NextResponse.json({ error: "AI 没有返回可用食谱，请重试" }, { status: 502 });
    }
    return NextResponse.json({ recipes });
  } catch (error: unknown) {
    const status = error instanceof AzureOpenAIError ? error.status : 502;
    const message = error instanceof Error ? error.message : "食谱生成失败";
    return NextResponse.json({ error: message }, { status });
  }
}

function normalizeIngredient(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = clean(item.name, 80);
  const daysLeft = Number(item.days_left);
  if (!name || !Number.isFinite(daysLeft) || daysLeft < 0) return null;
  return {
    name,
    category: clean(item.category, 20),
    quantity: clamp(Number(item.quantity), 0, 100000, 0),
    unit: clean(item.unit, 16),
    days_left: Math.round(daysLeft),
    opened: Boolean(item.opened),
  };
}

function normalizeRecipe(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const recipe = value as Record<string, unknown>;
  const name = clean(recipe.name, 80);
  if (!name) return null;
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.slice(0, 20).map((ingredient) => {
        const row = ingredient && typeof ingredient === "object"
          ? (ingredient as Record<string, unknown>)
          : {};
        return {
          name: clean(row.name, 80),
          amount: clean(row.amount, 40),
          from_fridge: Boolean(row.from_fridge),
        };
      }).filter((row) => row.name)
    : [];
  return {
    name,
    summary: clean(recipe.summary, 180),
    why_healthy: clean(recipe.why_healthy, 300),
    use_first: stringArray(recipe.use_first, 10, 80),
    ingredients,
    missing_ingredients: stringArray(recipe.missing_ingredients, 10, 80),
    cooking_minutes: Math.round(clamp(Number(recipe.cooking_minutes), 1, 360, 30)),
    calories_per_serving: Math.round(
      clamp(Number(recipe.calories_per_serving), 0, 3000, 0)
    ),
    difficulty: clean(recipe.difficulty, 20) || "普通",
    steps: stringArray(recipe.steps, 12, 240),
    safety_note: clean(recipe.safety_note, 240),
  };
}

function stringArray(value: unknown, limit: number, itemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, itemLength)).filter(Boolean).slice(0, limit);
}

function clean(value: unknown, length: number): string {
  return String(value ?? "").trim().slice(0, length);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
