import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /api/inventory/realtime-token
 * 返回 Azure OpenAI Realtime API 的连接凭证
 * api-key 内嵌到 WSS URL 的查询参数（Azure 要求，不支持 subprotocol 的方式）
 */
export async function GET(req: NextRequest) {
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

  // 优先用 AZURE_REALTIME_* 变量，没有则回退到 AZURE_OPENAI_* （同一个资源时无需重复配置）
  const endpoint = (process.env.AZURE_REALTIME_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT);
  const apiKey = (process.env.AZURE_REALTIME_KEY || process.env.AZURE_OPENAI_API_KEY);
  const deployment = process.env.AZURE_REALTIME_DEPLOYMENT;
  const apiVersion = process.env.AZURE_REALTIME_API_VERSION || "2024-10-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    return NextResponse.json(
      { error: "Azure Realtime 未配置（请检查 .env.local 中的 AZURE_REALTIME_DEPLOYMENT 及相关变量）" },
      { status: 500 }
    );
  }

  // Azure 要求：api-key 作为 URL 查询参数（不能用 WebSocket 子协议）
  const endpointHost = endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const wsUrl = `wss://${endpointHost}/openai/realtime?api-version=${apiVersion}&deployment=${deployment}&api-key=${apiKey}`;

  return NextResponse.json({ wsUrl });
}
