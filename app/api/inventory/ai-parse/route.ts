import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * POST /api/inventory/ai-parse
 * 接收自然语言文本，调用 Azure OpenAI 解析为结构化物资字段
 */
export async function POST(req: NextRequest) {
  // 1. 验证登录态
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
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 2. 获取用户 org_id
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", session.user.id)
    .single();

  if (!profile?.org_id) {
    return NextResponse.json({ error: "用户无组织" }, { status: 403 });
  }

  // 3. 解析请求体
  let body: { text: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const rawText = (body.text ?? "").trim();
  if (!rawText) {
    return NextResponse.json({ error: "输入文本为空" }, { status: 400 });
  }

  // 4. 从数据库加载二级分类树（用于 AI prompt）
  const { data: categories } = await supabase
    .from("inventory_categories")
    .select("id, name, value, parent_id, is_active")
    .eq("org_id", profile.org_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const primaryCats = (categories ?? []).filter((c: any) => !c.parent_id);
  const categoryTree = primaryCats.map((p: any) => ({
    name: p.name,
    children: (categories ?? [])
      .filter((c: any) => c.parent_id === p.id)
      .map((c: any) => c.name),
  }));

  // 5. 加载位置列表
  const { data: locations } = await supabase
    .from("inventory_locations")
    .select("name, value")
    .eq("org_id", profile.org_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const locationNames = (locations ?? []).map((l: any) => l.name);

  // 6. 构建 AI prompt
  const categoryDescription = categoryTree
    .map(
      (cat: any) =>
        `${cat.name}: [${cat.children.join("、")}]`
    )
    .join("\n");

  const systemPrompt = `你是一个物资管理助手。用户会用自然语言描述一批物资，你需要从中提取结构化信息。

可用的一级分类和二级分类如下：
${categoryDescription}

可用的位置：${locationNames.length > 0 ? locationNames.join("、") : "无预设位置"}

请从用户输入中提取以下字段：
- name: 物资名称（必填，简洁明确）
- primary_category: 一级分类名称（从上面列表中选择最匹配的）
- sub_category: 二级分类名称（从对应一级分类的子分类中选择最匹配的）
- quantity: 数量（整数，默认1）
- location: 位置（从上面列表匹配，无法匹配则留空）
- status: 状态（in_use=在用, idle=闲置, pending=待处理, disposed=已处理, lent_out=借出，默认 in_use）
- notes: 备注（用户提到的额外信息）

如果用户一次描述了多个物资，请返回数组。

严格返回 JSON 格式（不包含 markdown 代码块标记），格式如下：
{
  "items": [
    {
      "name": "...",
      "primary_category": "...",
      "sub_category": "...",
      "quantity": 1,
      "location": "",
      "status": "in_use",
      "notes": ""
    }
  ]
}`;

  // 7. 调用 Azure OpenAI
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json(
      { error: "Azure OpenAI 未配置（请检查 .env.local）" },
      { status: 500 }
    );
  }

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  try {
    const aiRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawText },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Azure OpenAI error:", aiRes.status, errText);
      return NextResponse.json(
        { error: `AI 解析失败 (${aiRes.status})` },
        { status: 502 }
      );
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? "";

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: "AI 返回格式异常", raw: content },
        { status: 502 }
      );
    }

    return NextResponse.json({
      items: parsed.items ?? [],
      raw_input: rawText,
    });
  } catch (e: any) {
    console.error("AI parse error:", e);
    return NextResponse.json(
      { error: "AI 服务调用失败：" + (e.message || String(e)) },
      { status: 502 }
    );
  }
}
