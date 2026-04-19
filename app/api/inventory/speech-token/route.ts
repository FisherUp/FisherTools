import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /api/inventory/speech-token
 * 返回 Azure Speech Services 的临时授权 token（10 分钟有效期）
 * 客户端使用此 token 直接与 Azure Speech 通信，避免暴露密钥
 */
export async function GET(req: NextRequest) {
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

  // 2. 检查环境变量
  const speechKey = process.env.AZURE_SPEECH_KEY;
  const speechRegion = process.env.AZURE_SPEECH_REGION;

  if (!speechKey || !speechRegion) {
    return NextResponse.json(
      { error: "Azure Speech 未配置（请检查 .env.local）" },
      { status: 500 }
    );
  }

  // 3. 获取临时 token
  try {
    const tokenUrl = `https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": speechKey,
        "Content-Length": "0",
      },
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Speech token error:", tokenRes.status, errText);
      return NextResponse.json(
        { error: `获取语音 token 失败 (${tokenRes.status})` },
        { status: 502 }
      );
    }

    const token = await tokenRes.text();

    return NextResponse.json({
      token,
      region: speechRegion,
    });
  } catch (e: any) {
    console.error("Speech token fetch error:", e);
    return NextResponse.json(
      { error: "语音服务调用失败：" + (e.message || String(e)) },
      { status: 502 }
    );
  }
}
