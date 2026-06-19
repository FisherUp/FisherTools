"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import {
  compressReferencedImages,
  formatBytes,
  getImageStorageUsage,
  getImageUsagePercent,
  ImageStorageUsage,
} from "../../lib/services/imageStorageService";

// 不显示导航壳的路由（登录 / 鉴权相关页面保持原样）
const BARE_ROUTES = ["/login", "/reset-password", "/auth"];

type Role =
  | "admin"
  | "finance"
  | "coordinator"
  | "viewer"
  | "inventory-edit"
  | "learner"
  | "";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const FINANCE_ROLES: Role[] = ["admin", "finance", "coordinator", "viewer"];
const ALL_ITEM_ROLES: Role[] = [
  "admin",
  "finance",
  "coordinator",
  "viewer",
  "inventory-edit",
  "learner",
];

const NAV_GROUPS: NavGroup[] = [
  {
    title: "财务记账",
    items: [
      { href: "/transactions", label: "收支流水", icon: "📒", roles: FINANCE_ROLES },
      { href: "/drafts", label: "草稿流水", icon: "📝", roles: FINANCE_ROLES },
      { href: "/transactions/report", label: "年度报表", icon: "📊", roles: FINANCE_ROLES },
      { href: "/funds", label: "资源池", icon: "🏦", roles: FINANCE_ROLES },
    ],
  },
  {
    title: "基础数据",
    items: [
      { href: "/members", label: "经手人", icon: "👥", roles: ["admin"] },
      { href: "/accounts", label: "账户管理", icon: "💳", roles: ["admin"] },
      { href: "/categories", label: "类别管理", icon: "🏷️", roles: ["admin"] },
      { href: "/budgets", label: "资源计划", icon: "📅", roles: ["admin"] },
    ],
  },
  {
    title: "其他模块",
    items: [
      { href: "/inventory", label: "物资管理", icon: "📦", roles: ALL_ITEM_ROLES },
      { href: "/services", label: "服务排班", icon: "🗓️", roles: FINANCE_ROLES },
      { href: "/leaves", label: "休假管理", icon: "🌴", roles: FINANCE_ROLES },
    ],
  },
  {
    title: "系统",
    items: [{ href: "/profiles", label: "用户权限", icon: "🔑", roles: ["admin"] }],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  finance: "财务",
  coordinator: "协调员",
  viewer: "查看者",
  "inventory-edit": "物资编辑员",
  learner: "学习者",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [role, setRole] = useState<Role>("");
  const [orgId, setOrgId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [imageUsage, setImageUsage] = useState<ImageStorageUsage | null>(null);
  const [imageUsageLoading, setImageUsageLoading] = useState(false);
  const [imageUsageMsg, setImageUsageMsg] = useState("");
  const [compressingImages, setCompressingImages] = useState(false);
  const [compressProgress, setCompressProgress] = useState("");

  const isBare = pathname === "/" || BARE_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    if (isBare) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const user = userRes.user;
        if (!user) {
          if (!cancelled) setReady(true);
          return;
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("org_id, role, display_name, email")
          .eq("id", user.id)
          .single();
        if (cancelled) return;
        setRole(((profile?.role as Role) ?? "") as Role);
        setOrgId(String(profile?.org_id ?? ""));
        setDisplayName(
          String(profile?.display_name || profile?.email || user.email || "").trim()
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBare]);

  const loadImageUsage = useCallback(async () => {
    if (!orgId || isBare) return;
    setImageUsageLoading(true);
    setImageUsageMsg("");
    try {
      const usage = await getImageStorageUsage(orgId);
      setImageUsage(usage);
      if (usage.errors.length > 0) setImageUsageMsg("部分文件按数据库引用估算");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setImageUsageMsg("图片容量统计失败：" + message);
    } finally {
      setImageUsageLoading(false);
    }
  }, [isBare, orgId]);

  useEffect(() => {
    void loadImageUsage();
  }, [loadImageUsage]);

  const compressStoredImages = async () => {
    if (!orgId || role !== "admin") return;
    const ok = confirm("将压缩当前组织已上传的票据图片和物资图片。处理过程中请不要关闭页面。是否继续？");
    if (!ok) return;

    setCompressingImages(true);
    setImageUsageMsg("");
    setCompressProgress("准备压缩...");
    try {
      const result = await compressReferencedImages(orgId, (progress) => {
        setCompressProgress(`${progress.index}/${progress.total} ${progress.currentLabel}`);
      });
      const savedText = result.savedBytes > 0 ? `，约节省 ${formatBytes(result.savedBytes)}` : "";
      const failedText = result.failed > 0 ? `，失败 ${result.failed} 张` : "";
      const warningText = result.errors.length > 0 ? `；${result.errors.slice(0, 2).join("；")}` : "";
      setImageUsageMsg(`旧图压缩完成：压缩 ${result.compressed} 张，跳过 ${result.skipped} 张${savedText}${failedText}${warningText}`);
      setCompressProgress("");
      await loadImageUsage();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setImageUsageMsg("旧图压缩失败：" + message);
    } finally {
      setCompressingImages(false);
    }
  };

  // 关闭移动端抽屉：路由变化时
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => it.roles.includes(role)),
    })).filter((g) => g.items.length > 0);
  }, [role]);

  // 当前激活项：最长前缀匹配
  const activeHref = useMemo(() => {
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    let best = "";
    for (const href of all) {
      if (pathname === href || pathname.startsWith(href + "/")) {
        if (href.length > best.length) best = href;
      }
    }
    return best;
  }, [pathname]);

  if (isBare) {
    return <>{children}</>;
  }

  // 角色就绪前先渲染内容，避免闪烁（侧边栏在 ready 后填充）
  return (
    <div className="app-shell">
      <style>{SHELL_CSS}</style>

      {/* 移动端顶栏 */}
      <header className="app-topbar">
        <button className="app-burger" onClick={() => setMobileOpen((v) => !v)} aria-label="菜单">
          ☰
        </button>
        <span className="app-topbar-title">小馒头管理系统</span>
      </header>

      {mobileOpen && <div className="app-overlay" onClick={() => setMobileOpen(false)} />}

      <aside className={`app-sidebar${mobileOpen ? " open" : ""}`}>
        <div className="app-brand">
          <span className="app-brand-logo">🥟</span>
          <span className="app-brand-text">小馒头管理系统</span>
        </div>

        <nav className="app-nav">
          {visibleGroups.map((group) => (
            <div className="app-nav-group" key={group.title}>
              <div className="app-nav-title">{group.title}</div>
              {group.items.map((item) => {
                const active = item.href === activeHref;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`app-nav-item${active ? " active" : ""}`}
                  >
                    <span className="app-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
          {ready && visibleGroups.length === 0 && (
            <div style={{ padding: "12px 16px", fontSize: 12, color: "#94a3b8" }}>加载中…</div>
          )}
        </nav>

        {ready && orgId && (
          <div className="app-storage">
            <div className="app-storage-head">
              <span>图片空间</span>
              <button type="button" onClick={loadImageUsage} disabled={imageUsageLoading || compressingImages}>
                {imageUsageLoading ? "统计中" : "刷新"}
              </button>
            </div>

            <div className="app-storage-total">
              {imageUsage ? `${formatBytes(imageUsage.totalBytes)} / ${formatBytes(imageUsage.quotaBytes)}` : imageUsageLoading ? "统计中..." : "暂无数据"}
            </div>
            <div className="app-storage-bar" aria-hidden="true">
              <span style={{ width: `${imageUsage ? getImageUsagePercent(imageUsage.totalBytes, imageUsage.quotaBytes) : 0}%` }} />
            </div>
            {imageUsage && (
              <div className="app-storage-meta">
                {imageUsage.fileCount} 个文件 · {getImageUsagePercent(imageUsage.totalBytes, imageUsage.quotaBytes).toFixed(1)}%
              </div>
            )}
            {imageUsage && (
              <div className="app-storage-split">
                {imageUsage.buckets.map((b) => (
                  <div key={b.bucket}>
                    {b.label.replace("图片", "")} {formatBytes(b.totalBytes)}
                  </div>
                ))}
              </div>
            )}
            {role === "admin" && (
              <button
                type="button"
                className="app-storage-compress"
                onClick={compressStoredImages}
                disabled={compressingImages || imageUsageLoading}
              >
                {compressingImages ? "压缩中..." : "压缩旧图"}
              </button>
            )}
            {(compressProgress || imageUsageMsg) && (
              <div className="app-storage-msg" title={imageUsageMsg || compressProgress}>
                {compressProgress || imageUsageMsg}
              </div>
            )}
          </div>
        )}

        <div className="app-user">
          <div className="app-user-info">
            <div className="app-user-name" title={displayName}>
              {displayName || "未登录"}
            </div>
            {role && <div className="app-user-role">{ROLE_LABELS[role] ?? role}</div>}
          </div>
          <button
            className="app-logout"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
          >
            退出
          </button>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}

const SHELL_CSS = `
.app-shell { min-height: 100vh; background: #f1f5f9; }
.app-sidebar {
  position: fixed; top: 0; left: 0; bottom: 0; width: 232px;
  background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column;
  z-index: 50; box-shadow: 2px 0 12px rgba(15,23,42,.08);
}
.app-brand {
  display: flex; align-items: center; gap: 10px; padding: 18px 18px 16px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.app-brand-logo { font-size: 24px; }
.app-brand-text { font-size: 15px; font-weight: 800; letter-spacing: .5px; }
.app-nav { flex: 1; overflow-y: auto; padding: 12px 10px 16px; }
.app-nav-group { margin-bottom: 14px; }
.app-nav-title {
  font-size: 11px; color: #64748b; font-weight: 700; letter-spacing: 1px;
  padding: 4px 10px; margin-bottom: 4px; text-transform: uppercase;
}
.app-nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border-radius: 8px; color: #cbd5e1; text-decoration: none; font-size: 14px;
  font-weight: 600; transition: background .15s, color .15s; margin-bottom: 2px;
}
.app-nav-item:hover { background: rgba(255,255,255,.06); color: #fff; }
.app-nav-item.active { background: #2563eb; color: #fff; }
.app-nav-icon { font-size: 16px; width: 20px; text-align: center; }
.app-storage {
  margin: 0 12px 10px; padding: 10px; border-radius: 8px;
  background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.18);
}
.app-storage-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  color: #cbd5e1; font-size: 12px; font-weight: 800;
}
.app-storage-head button,
.app-storage-compress {
  border: 1px solid rgba(148,163,184,.28); background: rgba(255,255,255,.06);
  color: #e2e8f0; border-radius: 6px; font-size: 11px; font-weight: 800;
  padding: 4px 8px; cursor: pointer;
}
.app-storage-head button:disabled,
.app-storage-compress:disabled { opacity: .55; cursor: not-allowed; }
.app-storage-total { margin-top: 8px; color: #f8fafc; font-size: 14px; font-weight: 900; }
.app-storage-bar {
  height: 7px; overflow: hidden; border-radius: 999px; background: rgba(148,163,184,.22);
  margin-top: 7px;
}
.app-storage-bar span {
  display: block; height: 100%; max-width: 100%; border-radius: inherit;
  background: #22c55e; transition: width .2s ease;
}
.app-storage-meta,
.app-storage-split,
.app-storage-msg {
  color: #94a3b8; font-size: 11px; line-height: 1.45; margin-top: 6px;
}
.app-storage-split { display: grid; gap: 2px; }
.app-storage-compress { width: 100%; margin-top: 8px; padding: 6px 8px; }
.app-storage-compress:hover:not(:disabled),
.app-storage-head button:hover:not(:disabled) { background: rgba(37,99,235,.45); color: #fff; }
.app-storage-msg {
  max-height: 46px; overflow: hidden; color: #cbd5e1; word-break: break-word;
}
.app-user {
  padding: 12px 14px; border-top: 1px solid rgba(255,255,255,.08);
  display: flex; align-items: center; gap: 10px;
}
.app-user-info { flex: 1; min-width: 0; }
.app-user-name {
  font-size: 13px; font-weight: 700; color: #f1f5f9;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.app-user-role { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.app-logout {
  padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
  background: rgba(255,255,255,.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,.12);
  border-radius: 6px;
}
.app-logout:hover { background: rgba(239,68,68,.85); border-color: transparent; color: #fff; }
.app-main { margin-left: 232px; min-height: 100vh; }
.app-topbar { display: none; }
.app-overlay { display: none; }

@media (max-width: 860px) {
  .app-topbar {
    display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 40;
    background: #0f172a; color: #fff; padding: 10px 14px;
  }
  .app-burger {
    background: transparent; border: none; color: #fff; font-size: 22px; cursor: pointer; line-height: 1;
  }
  .app-topbar-title { font-size: 15px; font-weight: 800; }
  .app-sidebar { transform: translateX(-100%); transition: transform .22s ease; }
  .app-sidebar.open { transform: translateX(0); }
  .app-overlay {
    display: block; position: fixed; inset: 0; background: rgba(15,23,42,.5); z-index: 45;
  }
  .app-main { margin-left: 0; }
}
`;
