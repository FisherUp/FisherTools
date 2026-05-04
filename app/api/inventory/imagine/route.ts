import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "edge";

/**
 * POST /api/inventory/imagine
 * 根据孩子描述的场景，调用 Azure OpenAI gpt-image-1-mini 生成场景插画
 * 使用 gpt-image-1-mini（1024×1024，质量 medium，性价比高，适合儿童插画）
 * 返回 base64 data URL（gpt-image-1 系列不支持直接返回 URL）
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return req.cookies.get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: {
    item_name: string;
    item_context?: string;
    user_prompt: string;
    language: "zh" | "en";
    age: number;
  };

  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const { item_name, item_context, user_prompt, language, age } = body;

  if (!user_prompt?.trim()) {
    return NextResponse.json({ error: "请描述想要的场景" }, { status: 400 });
  }

  // Build child-appropriate DALL-E 3 prompt
  const ageClamp = Math.max(3, Math.min(18, age ?? 7));
  const artStyle =
    ageClamp <= 6
      ? "cute children's picture book illustration, simple colorful flat design"
      : ageClamp <= 10
      ? "colorful cartoon illustration in the style of a children's educational book"
      : "vibrant semi-realistic digital illustration suitable for young students";

  const ctx = [item_name, item_context].filter(Boolean).join("，目前场景：");
  const safetyRules =
    "family-friendly, child-safe, no violence no scary no weapons, bright cheerful colors, educational and fun";

  // Always write prompt in English for best DALL-E results regardless of UI language
  const dallePrompt =
    `${artStyle}. ` +
    `Central subject: "${item_name}"${item_context ? ` (${item_context})` : ""}. ` +
    `Scene description: ${user_prompt}. ` +
    `Requirements: ${safetyRules}. ` +
    `Age ${ageClamp} audience. Clean composition, rich detail, warm atmosphere.`;

  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
  const deployment = process.env.AZURE_IMAGE_DEPLOYMENT ?? "gpt-image-1-mini";
  // gpt-image-1 系列须用 2025-04-01-preview（硬编码，不依赖可能缺失的 env var）
  const apiVersion = "2025-04-01-preview";

  if (!endpoint || !apiKey) {
    return NextResponse.json({ error: "未配置 AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_API_KEY" }, { status: 500 });
  }

  // Azure OpenAI images/generations endpoint
  const url = `${endpoint}/openai/deployments/${deployment}/images/generations?api-version=${apiVersion}`;

  // Edge Runtime 30s 超时，AbortController 25s 安全裕量
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        prompt: dallePrompt,
        size: "1024x1024",
        quality: "medium",
        n: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = (errData as any)?.error?.message ?? `HTTP ${resp.status}`;
      console.error("gpt-image-1-mini error:", errData);
      return NextResponse.json({ error: "图片生成失败：" + msg }, { status: 500 });
    }

    const data = await resp.json();
    const item = data?.data?.[0];

    let imageUrl: string;
    if (item?.url) {
      imageUrl = item.url;
    } else if (item?.b64_json) {
      imageUrl = `data:image/png;base64,${item.b64_json}`;
    } else {
      console.error("gpt-image-1-mini: unexpected response shape", JSON.stringify(data).slice(0, 300));
      return NextResponse.json({ error: "图片生成成功但未返回图像数据" }, { status: 500 });
    }

    const revisedPrompt: string = item?.revised_prompt ?? "";
    return NextResponse.json({ imageUrl, revisedPrompt });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      return NextResponse.json({ error: "图片生成超时（已等待 25 秒），请重试" }, { status: 504 });
    }
    console.error("gpt-image-1-mini fetch error:", e);
    return NextResponse.json({ error: "图片生成失败：" + (e.message || String(e)) }, { status: 502 });
  }
}
