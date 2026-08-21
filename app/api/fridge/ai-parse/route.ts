import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  FRIDGE_CATEGORIES,
  FRIDGE_LOCATIONS,
  addDays,
  localDateString,
} from "../../../../lib/fridge";
import {
  AzureOpenAIError,
  requestAzureJson,
} from "../../../../lib/server/azureOpenAI";

export const runtime = "edge";

const DEFAULT_DAYS: Record<string, number> = {
  蔬菜: 4,
  水果: 7,
  肉类: 3,
  海鲜: 2,
  乳制品: 7,
  蛋类: 30,
  主食: 30,
  熟食: 2,
  调味品: 90,
  饮料: 14,
  其他: 7,
};

type RequestBody = {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  today?: string;
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "finance", "inventory-edit", "learner"].includes(profile.role)) {
    return NextResponse.json({ error: "当前账号没有食材录入权限" }, { status: 403 });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const text = String(body.text ?? "").trim().slice(0, 2000);
  const imageBase64 = String(body.imageBase64 ?? "").trim();
  const imageMimeType = String(body.imageMimeType ?? "image/jpeg");
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "")
    ? String(body.today)
    : localDateString();

  if (!text && !imageBase64) {
    return NextResponse.json({ error: "请提供食材描述或图片" }, { status: 400 });
  }
  if (imageBase64.length > 4_000_000) {
    return NextResponse.json({ error: "图片过大，请压缩后重试" }, { status: 413 });
  }
  if (imageBase64 && !["image/jpeg", "image/png", "image/webp"].includes(imageMimeType)) {
    return NextResponse.json({ error: "仅支持 JPEG、PNG 或 WebP 图片" }, { status: 400 });
  }

  const systemPrompt = `你是冰箱食材录入助手。请从自然语言、食材照片、包装标签或购物小票中识别食材批次，但不要执行任何写入。

今天是 ${today}。可用分类：${FRIDGE_CATEGORIES.join("、")}。可用位置：${FRIDGE_LOCATIONS.join("、")}。
默认保质期（天）：${Object.entries(DEFAULT_DAYS)
    .map(([name, days]) => `${name}${days}`)
    .join("、")}。冷冻食材可根据常识延长，但不要虚构图片中看不清的日期。

要求：
1. 一种食材一个候选项，数量可为小数；看不清时给出保守值并降低 confidence。
2. 用户明确说出购买日、到期日、开封状态或存放位置时优先采用；否则购买日为今天，并按分类默认天数计算到期日。
3. 小票识别只返回食材和饮品，忽略日用品；照片里不确定是不是食材的对象不要返回。
4. expiry_date 必须是 YYYY-MM-DD，且不能早于明确的 purchase_date，除非包装本身已过期。
5. 严格返回 JSON，不要 markdown。最多返回 30 项。

返回格式：
{"items":[{"name":"番茄","category":"蔬菜","quantity":3,"unit":"个","purchase_date":"${today}","expiry_date":"${addDays(
    today,
    4
  )}","shelf_life_days":4,"storage_location":"冷藏室","opened":false,"notes":"","confidence":0.95}]}`;

  try {
    const parsed = await requestAzureJson({
      systemPrompt,
      userText:
        text || "识别图片中可入库的全部食材，包装日期和数量看不清时请保守估计。",
      imageBase64: imageBase64 || undefined,
      imageMimeType,
      maxTokens: 2400,
      temperature: 0,
    });

    const rawItems = Array.isArray(parsed.items) ? parsed.items.slice(0, 30) : [];
    const items = rawItems.map((item) => normalizeItem(item, today)).filter(Boolean);
    return NextResponse.json({ items, raw_input: text || "[图片识别]" });
  } catch (error: unknown) {
    const status = error instanceof AzureOpenAIError ? error.status : 502;
    const message = error instanceof Error ? error.message : "AI 识别失败";
    return NextResponse.json({ error: message }, { status });
  }
}

function normalizeItem(value: unknown, today: string) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const name = String(item.name ?? "").trim().slice(0, 80);
  if (!name) return null;

  const category = FRIDGE_CATEGORIES.includes(item.category as (typeof FRIDGE_CATEGORIES)[number])
    ? (item.category as (typeof FRIDGE_CATEGORIES)[number])
    : "其他";
  const location = FRIDGE_LOCATIONS.includes(item.storage_location as (typeof FRIDGE_LOCATIONS)[number])
    ? (item.storage_location as (typeof FRIDGE_LOCATIONS)[number])
    : category === "主食" || category === "调味品" || category === "饮料"
      ? "常温柜"
      : "冷藏室";
  const shelfLifeDays = clampNumber(item.shelf_life_days, DEFAULT_DAYS[category], 0, 3650);
  const purchaseDate = validDate(item.purchase_date) ? String(item.purchase_date) : today;
  const expiryDate = validDate(item.expiry_date)
    ? String(item.expiry_date)
    : addDays(purchaseDate, shelfLifeDays);

  return {
    name,
    category,
    quantity: clampNumber(item.quantity, 1, 0.01, 100000),
    unit: String(item.unit ?? "份").trim().slice(0, 16) || "份",
    purchase_date: purchaseDate,
    expiry_date: expiryDate,
    shelf_life_days: shelfLifeDays,
    storage_location: location,
    opened: Boolean(item.opened),
    notes: String(item.notes ?? "").trim().slice(0, 300),
    confidence: clampNumber(item.confidence, 0.7, 0, 1),
  };
}

function validDate(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
