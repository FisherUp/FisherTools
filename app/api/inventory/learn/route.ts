import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * POST /api/inventory/learn
 * 根据物资信息和儿童年龄，调用 Azure OpenAI 生成适龄学习内容
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
    primary_category?: string;
    sub_category?: string;
    quantity?: number;
    unit?: string;
    location?: string;
    age: number;
    language: "zh" | "en";
    variant: number;
  };

  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const { item_name, primary_category, sub_category, quantity, unit, location, age, language, variant } = body;

  const ageClamp = Math.max(3, Math.min(18, age ?? 7));
  const variantIndex = Math.abs((variant ?? 0) % 6);

  const ageLevel = ageClamp <= 5 ? "3-5岁幼儿（言辞极简，句子短，只用最常见词汇）"
    : ageClamp <= 8 ? "6-8岁小学低年级（简单句，贴近生活，避免生僻词）"
    : ageClamp <= 11 ? "9-11岁小学高年级（可用中等复杂度句式，介绍具体知识点）"
    : "12岁以上中学生（词汇丰富，句式多样，可适度深入介绍原理）";

  const itemContext = [
    `物品：${item_name}`,
    (primary_category || sub_category) ? `分类：${[primary_category, sub_category].filter(Boolean).join(" > ")}` : null,
    quantity ? `数量：${quantity}${unit ?? ""}` : null,
    location ? `位置：${location}` : null,
  ].filter(Boolean).join("，");

  // ── 中文 6 种格式（按 variantIndex 选择）──
  const zhFormats = [
    `写2-3句生动的场景句子，把"${item_name}"自然融入日常生活情境，然后简洁解释：它是什么、有什么用、通常由什么材料制成。`,
    `写一段亲子对话（6-8行，爸爸或妈妈与孩子之间），通过对话自然介绍"${item_name}"的用途、来源和有趣之处，对话结尾孩子说一句有趣的话。`,
    `先出一个关于"${item_name}"的有趣谜语（不要在谜语正文中出现答案），再换行写"谜底：${item_name}"，然后解释它的3个特点或用途。`,
    `写一个5-8句的小故事，故事主角是一个孩子，故事中自然用到"${item_name}"，让读者在故事中了解它的作用和特点。故事要有趣、有起伏。`,
    `用"你知道吗？"格式介绍关于"${item_name}"的3个有趣知识点，每个知识点包含一个🔍小标题和2-3句解释，知识点要新颖不平凡。`,
    `设计3道关于"${item_name}"的填空练习题（每题末尾括号中给词汇提示），然后在下方用"答案："列出答案，帮助孩子学习描述这个物品。`,
  ][variantIndex];

  const zhFormatNames = ["场景造句", "亲子对话", "猜谜时间", "小故事", "你知道吗？", "填空练习"];

  // ── 英文 6 种格式 ──
  const enFormats = [
    `Teach the English word for "${item_name}". Include the word, IPA pronunciation, a simple definition (1-2 sentences), and 3 example sentences showing it in everyday life situations.`,
    `Write a natural parent-child dialogue (6-8 lines) where "${item_name}" is the topic. Use real daily-life situations. Include the English word naturally.`,
    `Write a short story (6-10 sentences) about a child, featuring "${item_name}" as an important object. Make it fun with a small surprise or twist.`,
    `Share 3 fun and surprising facts about "${item_name}" in English. Each fact needs a 🌟 title and 2-3 engaging sentences.`,
    `Explore the vocabulary around "${item_name}": the main English word, 4-5 related words and phrases (with Chinese translations), and a useful everyday phrase using the word.`,
    `Create 3 fill-in-the-blank sentences about "${item_name}" (with word hints in parentheses at the end of each sentence). Provide the answers below.`,
  ][variantIndex];

  const enFormatNames = ["Word Spotlight", "Daily Conversation", "Story Time", "Fun Facts", "Word Explorer", "English Challenge"];

  const zhSystemPrompt = `你是一位专业的儿童教育老师，正帮助${ageLevel}的孩子通过日常物品扩展知识。

物品信息：${itemContext}

任务：${zhFormats}

要求：
- 语言难度严格适合${ageLevel}
- 内容生动有趣，贴近真实日常生活，避免枯燥说教
- 结尾必须加一行亲子互动问题，格式：🤔 你来想一想：[问题]

返回严格 JSON（不含 markdown 代码块标记）：
{
  "title": "认识：${item_name}",
  "format_name": "${zhFormatNames[variantIndex]}",
  "main_content": "主要教学内容（换行用 \\n）",
  "key_fact": "一条核心知识点（一两句，精炼）",
  "question": "🤔 你来想一想：互动问题"
}`;

  const enSystemPrompt = `You are a professional children's English teacher helping a child (age ${ageClamp}) learn English through everyday objects.

Item info: ${itemContext}

Task: ${enFormats}

Requirements:
- Vocabulary and complexity strictly suitable for age ${ageClamp}
- Engaging, relatable to real daily life, NOT dry or lecture-like
- End with one parent-child interaction question: 💭 Think about it: [question]

Return strict JSON (no markdown code blocks):
{
  "title": "Let's Learn: [English word for ${item_name}]",
  "english_word": "the English word",
  "pronunciation": "/IPA/",
  "format_name": "${enFormatNames[variantIndex]}",
  "main_content": "main educational content (use \\n for line breaks)",
  "vocabulary": ["English word: 中文意思"],
  "fun_fact": "one interesting fact (1-2 sentences)",
  "question": "💭 Think about it: interaction question"
}`;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json({ error: "Azure OpenAI 未配置（请检查 .env.local）" }, { status: 500 });
  }

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  try {
    const aiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: language === "zh" ? zhSystemPrompt : enSystemPrompt },
          { role: "user", content: `请为"${item_name}"生成${language === "zh" ? "中文" : "英文"}学习内容（格式：${language === "zh" ? zhFormatNames[variantIndex] : enFormatNames[variantIndex]}，适合${ageClamp}岁）` },
        ],
        temperature: 0.85,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Azure OpenAI learn error:", aiRes.status, errText);
      return NextResponse.json({ error: `AI 生成失败 (${aiRes.status})` }, { status: 502 });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? "";

    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { return NextResponse.json({ error: "AI 返回格式异常", raw: content }, { status: 502 }); }

    return NextResponse.json({ ...parsed, variant: variantIndex, language });
  } catch (e: any) {
    console.error("Learn API error:", e);
    return NextResponse.json({ error: "AI 服务调用失败：" + (e.message || String(e)) }, { status: 502 });
  }
}
