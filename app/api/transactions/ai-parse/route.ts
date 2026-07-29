import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "edge";

/**
 * POST /api/transactions/ai-parse
 *
 * 把一句自然语言（或一张票据照片）解析为一条财务流水草稿。
 * 返回结果只作为「预填」，前端必须让用户确认后才提交。
 *
 * 性能取舍：
 *  - 优先使用 AZURE_OPENAI_FAST_DEPLOYMENT（建议部署 gpt-4.1-mini / gpt-4o-mini），
 *    纯文字场景比 gpt-4.1 快 2~4 倍，本场景字段少、约束强，准确率基本无损。
 *  - 图片场景使用 AZURE_OPENAI_VISION_DEPLOYMENT（默认回退到主部署）。
 *  - prompt 精简 + max_tokens 收紧 + response_format=json_object，减少输出耗时。
 */

type ParsedTx = {
  date: string;
  direction: "income" | "expense";
  amount_yuan: number;
  category: string;
  account: string;
  handler1: string;
  handler2: string;
  description: string;
};

const TIMEOUT_MS = 25000;

function todayInShanghai(): string {
  // Edge runtime 时区为 UTC，这里换算到 Asia/Shanghai
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

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
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", session.user.id)
    .single();

  if (!profile?.org_id) return NextResponse.json({ error: "用户无组织" }, { status: 403 });

  let body: { text?: string; imageBase64?: string; imageMimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const rawText = (body.text ?? "").trim();
  const imageBase64 = (body.imageBase64 ?? "").trim();
  const imageMimeType = body.imageMimeType || "image/jpeg";

  if (!rawText && !imageBase64) {
    return NextResponse.json({ error: "请提供文本或图片" }, { status: 400 });
  }

  // 并行加载可选项，减少串行等待
  const [catRes, accRes, memRes] = await Promise.all([
    supabase
      .from("categories")
      .select("name")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("accounts")
      .select("name, type")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("members")
      .select("name")
      .eq("org_id", profile.org_id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const categoryNames = (catRes.data ?? []).map((c: any) => String(c.name));
  const accountNames = (accRes.data ?? []).map((a: any) => String(a.name));
  const memberNames = (memRes.data ?? []).map((m: any) => String(m.name));

  const today = todayInShanghai();

  const systemPrompt = `你是财务记账助手。把用户的一句话或一张票据照片解析成一条流水记录。

今天是 ${today}（Asia/Shanghai）。
可选类别：${categoryNames.join("、") || "（无）"}
可选账户：${accountNames.join("、") || "（无）"}
可选成员：${memberNames.join("、") || "（无）"}

规则：
1. date 用 YYYY-MM-DD。"今天"=${today}；"昨天""前天""上周五"等按此推算；票据上有日期则优先用票据日期。无法判断时用 ${today}。
2. direction：花钱/报销/购买/支付=expense；收到/奉献/捐款/收入/退款=income。默认 expense。
3. amount_yuan：金额，单位元，数字（可含两位小数）。票据取「合计/应付/实付」金额。识别不到填 0。
4. category / account / handler1 / handler2 必须从上面列表里原样挑一个，挑不准就填空字符串 ""，不要杜撰。
5. handler1/handler2 是经手人，不能相同；没提到就填 ""。
6. description：简短备注（20 字内），概括用途/商家；不要重复金额。

只返回 JSON，不要 markdown 代码块：
{"date":"","direction":"expense","amount_yuan":0,"category":"","account":"","handler1":"","handler2":"","description":""}`;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const baseDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const deployment = imageBase64
    ? process.env.AZURE_OPENAI_VISION_DEPLOYMENT || baseDeployment
    : process.env.AZURE_OPENAI_FAST_DEPLOYMENT || baseDeployment;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json({ error: "Azure OpenAI 未配置（请检查 .env.local）" }, { status: 500 });
  }

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const userMessage = imageBase64
    ? {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${imageMimeType};base64,${imageBase64}`, detail: "low" },
          },
          {
            type: "text",
            text: rawText || "识别这张票据，按要求返回 JSON。",
          },
        ],
      }
    : { role: "user", content: rawText };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const aiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [{ role: "system", content: systemPrompt }, userMessage],
        temperature: 0,
        top_p: 1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Azure OpenAI error:", aiRes.status, errText);
      return NextResponse.json({ error: `AI 解析失败 (${aiRes.status})` }, { status: 502 });
    }

    const aiData = await aiRes.json();
    const content: string = aiData.choices?.[0]?.message?.content ?? "";

    const stripped = content
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      const match = stripped.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          /* ignore */
        }
      }
    }
    if (!parsed) {
      return NextResponse.json({ error: "AI 返回格式异常", raw: content }, { status: 502 });
    }

    // 归一化 + 白名单校验，杜绝 AI 杜撰出不存在的类别/账户/成员
    const pick = (v: unknown, list: string[]) => {
      const s = String(v ?? "").trim();
      if (!s) return "";
      const hit = list.find((x) => x === s) ?? list.find((x) => x.includes(s) || s.includes(x));
      return hit ?? "";
    };

    const amountRaw = Number(parsed.amount_yuan ?? parsed.amount ?? 0);
    const handler1 = pick(parsed.handler1, memberNames);
    let handler2 = pick(parsed.handler2, memberNames);
    if (handler2 && handler2 === handler1) handler2 = "";

    const result: ParsedTx = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date ?? "")) ? String(parsed.date) : today,
      direction: parsed.direction === "income" ? "income" : "expense",
      amount_yuan: Number.isFinite(amountRaw) && amountRaw > 0 ? Math.round(amountRaw * 100) / 100 : 0,
      category: pick(parsed.category, categoryNames),
      account: pick(parsed.account, accountNames),
      handler1,
      handler2,
      description: String(parsed.description ?? "").trim().slice(0, 100),
    };

    return NextResponse.json({ result, raw_input: rawText || "[图片识别]" });
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") {
      return NextResponse.json({ error: "AI 解析超时（已等待 25 秒），请重试" }, { status: 504 });
    }
    console.error("ai-parse error:", e);
    return NextResponse.json({ error: "AI 解析异常：" + (e?.message ?? String(e)) }, { status: 500 });
  }
}
