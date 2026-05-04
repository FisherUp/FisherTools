import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 1) 放行 Next 内部资源 / API 路由 / favicon / 其它静态
  //    API 路由有自己的 session 鉴权，不应被页面级路由守卫重定向
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml")
  ) {
    return NextResponse.next();
  }

  // 2) 放行 auth 回调路由（如果你后续用 OAuth / magic link，会用到）
  if (pathname.startsWith("/auth")) {
    return NextResponse.next();
  }

  // 3) 兜底处理：如果 Supabase 的 code/token_hash 被 Site URL 回退到 / 或 /login，
  //    仍然交给统一回调页换取 session，再进入设置密码页。
  if (req.nextUrl.searchParams.has("code") || req.nextUrl.searchParams.has("token_hash")) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/callback";
    if (!url.searchParams.has("next")) url.searchParams.set("next", "reset-password");
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 4) 登录页逻辑：
  //    - 未登录：允许访问 /login
  //    - 已登录：禁止停留在 /login，根据角色跳转
  if (pathname === "/login") {
    if (session) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      const url = req.nextUrl.clone();
      url.pathname = profile?.role === "inventory-edit" || profile?.role === "learner" ? "/inventory" : "/transactions";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return res;
  }

  // 5) 其他所有路由：要求必须登录
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  // 6) inventory-edit / learner 角色：只允许访问 /inventory 及其子路由
  if (!pathname.startsWith("/inventory")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (profile?.role === "inventory-edit" || profile?.role === "learner") {
      const url = req.nextUrl.clone();
      url.pathname = "/inventory";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
