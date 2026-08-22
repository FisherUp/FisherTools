"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FRIDGE_CATEGORIES,
  FRIDGE_LOCATIONS,
  FridgeItem,
  FridgeItemInput,
  FridgeProfile,
  daysUntil,
} from "../../lib/fridge";
import {
  canEditFridge,
  consumeFridgeItem,
  createFridgeItems,
  discardFridgeItem,
  getFridgeProfile,
  listFridgeItems,
  updateFridgeItem,
} from "../../lib/services/fridgeService";
import FridgeAiInput from "./FridgeAiInput";
import FridgeItemDialog from "./FridgeItemDialog";
import RecipePanel from "./RecipePanel";

type ExpiryFilter = "all" | "expired" | "critical" | "soon" | "fresh" | "opened";

const PAGE_SIZE = 30;

export default function FridgeClient() {
  const [profile, setProfile] = useState<FridgeProfile | null>(null);
  const [items, setItems] = useState<FridgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"inventory" | "recipes">("inventory");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [location, setLocation] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FridgeItem | null>(null);
  const [consumeTarget, setConsumeTarget] = useState<FridgeItem | null>(null);
  const [consumeQuantity, setConsumeQuantity] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentProfile = await getFridgeProfile();
      const currentItems = await listFridgeItems(currentProfile.orgId);
      setProfile(currentProfile);
      setItems(currentItems);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "加载冰箱数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => setPage(1), [search, category, location, expiryFilter]);

  const editable = Boolean(profile && canEditFridge(profile.role));
  const stats = useMemo(() => {
    let expired = 0;
    let critical = 0;
    let soon = 0;
    for (const item of items) {
      const days = daysUntil(item.expiry_date);
      if (days < 0) expired += 1;
      else if (days <= 3) critical += 1;
      else if (days <= 7) soon += 1;
    }
    return {
      batches: items.length,
      foods: new Set(items.map((item) => item.name.trim().toLowerCase())).size,
      expired,
      critical,
      soon,
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (query && !`${item.name} ${item.notes ?? ""}`.toLowerCase().includes(query)) return false;
      if (category !== "all" && item.category !== category) return false;
      if (location !== "all" && item.storage_location !== location) return false;
      const days = daysUntil(item.expiry_date);
      if (expiryFilter === "expired" && days >= 0) return false;
      if (expiryFilter === "critical" && (days < 0 || days > 3)) return false;
      if (expiryFilter === "soon" && (days < 4 || days > 7)) return false;
      if (expiryFilter === "fresh" && days <= 7) return false;
      if (expiryFilter === "opened" && !item.opened) return false;
      return true;
    });
  }, [category, expiryFilter, items, location, search]);

  const visibleItems = filteredItems.slice(0, page * PAGE_SIZE);

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 3500);
  };

  const confirmAiItems = async (inputs: FridgeItemInput[]) => {
    if (!profile) throw new Error("用户信息尚未加载");
    const created = await createFridgeItems(profile.orgId, inputs);
    setItems((current) => sortItems([...current, ...created]));
    notify(`已加入 ${created.length} 批食材`);
  };

  const saveItem = async (input: FridgeItemInput) => {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      if (editingItem) {
        const updated = await updateFridgeItem(profile.orgId, editingItem.id, input);
        setItems((current) => sortItems(current.map((item) => item.id === updated.id ? updated : item)));
        notify("食材已更新");
      } else {
        const [created] = await createFridgeItems(profile.orgId, [input]);
        setItems((current) => sortItems([...current, created]));
        notify("食材已添加");
      }
      setDialogOpen(false);
      setEditingItem(null);
    } catch (reason: unknown) {
      const errorMessage = reason instanceof Error ? reason.message : "保存失败";
      throw new Error(errorMessage);
    } finally {
      setBusy(false);
    }
  };

  const consume = async () => {
    if (!consumeTarget) return;
    if (!Number.isFinite(consumeQuantity) || consumeQuantity <= 0) {
      return setError("消耗数量必须大于 0");
    }
    if (consumeQuantity > consumeTarget.quantity) {
      return setError(`最多可消耗 ${formatQuantity(consumeTarget.quantity)} ${consumeTarget.unit}`);
    }
    setBusy(true);
    setError("");
    try {
      await consumeFridgeItem(consumeTarget.id, consumeQuantity);
      setItems((current) => {
        if (consumeQuantity >= consumeTarget.quantity) {
          return current.filter((item) => item.id !== consumeTarget.id);
        }
        return current.map((item) =>
          item.id === consumeTarget.id
            ? { ...item, quantity: Number((item.quantity - consumeQuantity).toFixed(2)) }
            : item
        );
      });
      notify(`已记录消耗 ${formatQuantity(consumeQuantity)} ${consumeTarget.unit}`);
      setConsumeTarget(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "记录消耗失败");
    } finally {
      setBusy(false);
    }
  };

  const discard = async (item: FridgeItem) => {
    if (!profile || !confirm(`确定移除“${item.name}”这批食材吗？记录会软删除，不会物理清除。`)) return;
    setBusy(true);
    setError("");
    try {
      await discardFridgeItem(profile.orgId, item.id);
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      notify("食材已移除");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="fridge-page">
      <style>{FRIDGE_CSS}</style>

      <header className="fridge-header">
        <div>
          <h1>冰箱管理</h1>
          <p>食材批次、保质期与健康食谱</p>
        </div>
        <div className="fridge-header-actions">
          <button className="fridge-icon-button" type="button" onClick={() => void load()} title="刷新" aria-label="刷新" disabled={loading}>
            ↻
          </button>
          {editable && tab === "inventory" && (
            <button
              className="fridge-button primary"
              type="button"
              onClick={() => {
                setEditingItem(null);
                setDialogOpen(true);
              }}
            >
              添加食材
            </button>
          )}
        </div>
      </header>

      <div className="fridge-tabs" role="tablist" aria-label="冰箱管理视图">
        <button type="button" role="tab" aria-selected={tab === "inventory"} className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>
          食材库存
        </button>
        <button type="button" role="tab" aria-selected={tab === "recipes"} className={tab === "recipes" ? "active" : ""} onClick={() => setTab("recipes")}>
          健康食谱
        </button>
      </div>

      {message && <div className="fridge-toast" role="status">{message}</div>}
      {error && (
        <div className="fridge-message error page-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="关闭错误">×</button>
        </div>
      )}

      {loading ? (
        <div className="fridge-loading">正在读取冰箱数据...</div>
      ) : tab === "recipes" ? (
        <RecipePanel items={items} />
      ) : (
        <>
          <section className="fridge-summary" aria-label="食材概况">
            <button type="button" onClick={() => setExpiryFilter("all")} className={expiryFilter === "all" ? "active" : ""}>
              <span>食材种类</span><strong>{stats.foods}</strong><small>{stats.batches} 个批次</small>
            </button>
            <button type="button" onClick={() => setExpiryFilter("critical")} className={expiryFilter === "critical" ? "active critical" : "critical"}>
              <span>3 天内到期</span><strong>{stats.critical}</strong><small>优先处理</small>
            </button>
            <button type="button" onClick={() => setExpiryFilter("soon")} className={expiryFilter === "soon" ? "active soon" : "soon"}>
              <span>4-7 天到期</span><strong>{stats.soon}</strong><small>提前安排</small>
            </button>
            <button type="button" onClick={() => setExpiryFilter("expired")} className={expiryFilter === "expired" ? "active expired" : "expired"}>
              <span>已经过期</span><strong>{stats.expired}</strong><small>请检查处理</small>
            </button>
          </section>

          {editable ? (
            <FridgeAiInput onConfirm={confirmAiItems} disabled={busy} />
          ) : (
            <div className="fridge-message info">当前账号为只读权限，可查看库存并生成食谱。</div>
          )}

          <section className="fridge-inventory-section">
            <div className="fridge-section-heading">
              <div><h2>现有食材</h2><p>按到期日从近到远排列</p></div>
              <span>{filteredItems.length} 批</span>
            </div>

            <div className="fridge-filters">
              <label className="fridge-search">
                <span className="sr-only">搜索食材</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或备注" />
              </label>
              <select aria-label="按分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">全部分类</option>
                {FRIDGE_CATEGORIES.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="按位置筛选" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="all">全部位置</option>
                {FRIDGE_LOCATIONS.map((value) => <option key={value}>{value}</option>)}
              </select>
              <select aria-label="按保质期筛选" value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value as ExpiryFilter)}>
                <option value="all">全部状态</option>
                <option value="expired">已经过期</option>
                <option value="critical">3 天内到期</option>
                <option value="soon">4-7 天到期</option>
                <option value="fresh">7 天以上</option>
                <option value="opened">已经开封</option>
              </select>
            </div>

            {filteredItems.length === 0 ? (
              <div className="fridge-empty">
                <strong>{items.length === 0 ? "冰箱还是空的" : "没有符合筛选条件的食材"}</strong>
                <span>{items.length === 0 && editable ? "可以手工添加，也可以用文字、语音或图片识别入库" : "调整筛选条件后再查看"}</span>
              </div>
            ) : (
              <div className="fridge-table-wrap">
                <table className="fridge-table">
                  <thead>
                    <tr><th>食材</th><th>剩余</th><th>位置</th><th>购买日</th><th>保质期</th>{editable && <th className="actions">操作</th>}</tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const expiry = expiryPresentation(item.expiry_date);
                      return (
                        <tr key={item.id} className={expiry.kind === "expired" ? "is-expired" : ""}>
                          <td data-label="食材">
                            <strong>{item.name}</strong>
                            <div className="fridge-row-tags"><span>{item.category}</span>{item.opened && <span className="opened">已开封</span>}</div>
                            {item.notes && <small>{item.notes}</small>}
                          </td>
                          <td data-label="剩余">{formatQuantity(item.quantity)} {item.unit}</td>
                          <td data-label="位置">{item.storage_location}</td>
                          <td data-label="购买日">{item.purchase_date}</td>
                          <td data-label="保质期"><span className={`fridge-expiry ${expiry.kind}`}>{expiry.text}</span><small className="fridge-date">{item.expiry_date}</small></td>
                          {editable && (
                            <td data-label="操作" className="actions">
                              <button type="button" className="fridge-row-button consume" onClick={() => { setConsumeTarget(item); setConsumeQuantity(Math.min(1, item.quantity)); }}>消耗</button>
                              <button type="button" className="fridge-icon-button" title="编辑" aria-label={`编辑 ${item.name}`} onClick={() => { setEditingItem(item); setDialogOpen(true); }}>✎</button>
                              <button type="button" className="fridge-icon-button danger-text" title="移除" aria-label={`移除 ${item.name}`} onClick={() => void discard(item)}>×</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visibleItems.length < filteredItems.length && (
                  <button type="button" className="fridge-button secondary load-more" onClick={() => setPage((value) => value + 1)}>
                    加载更多（剩余 {filteredItems.length - visibleItems.length} 批）
                  </button>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {dialogOpen && (
        <FridgeItemDialog
          key={editingItem?.id ?? "new"}
          item={editingItem}
          saving={busy}
          onClose={() => { if (!busy) { setDialogOpen(false); setEditingItem(null); } }}
          onSave={saveItem}
        />
      )}

      {consumeTarget && (
        <div className="fridge-modal-backdrop" role="presentation" onMouseDown={() => !busy && setConsumeTarget(null)}>
          <div className="fridge-modal fridge-consume-modal" role="dialog" aria-modal="true" aria-labelledby="consume-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="fridge-modal-head"><h2 id="consume-title">记录消耗</h2><button type="button" className="fridge-icon-button" onClick={() => setConsumeTarget(null)} aria-label="关闭">×</button></div>
            <p>当前有 <strong>{formatQuantity(consumeTarget.quantity)} {consumeTarget.unit}</strong> {consumeTarget.name}</p>
            <label className="fridge-field"><span>本次消耗数量</span><input type="number" autoFocus min="0.01" max={consumeTarget.quantity} step="0.01" value={consumeQuantity} onChange={(event) => setConsumeQuantity(Number(event.target.value))} /></label>
            {error && <div className="fridge-message error">{error}</div>}
            <div className="fridge-modal-actions"><button type="button" className="fridge-button secondary" onClick={() => setConsumeTarget(null)} disabled={busy}>取消</button><button type="button" className="fridge-button primary" onClick={() => void consume()} disabled={busy}>{busy ? "记录中..." : "确认消耗"}</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

function sortItems(items: FridgeItem[]): FridgeItem[] {
  return [...items].sort((left, right) => left.expiry_date.localeCompare(right.expiry_date) || right.created_at.localeCompare(left.created_at));
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function expiryPresentation(date: string): { kind: "expired" | "critical" | "soon" | "fresh"; text: string } {
  const days = daysUntil(date);
  if (days < 0) return { kind: "expired", text: `已过期 ${Math.abs(days)} 天` };
  if (days === 0) return { kind: "critical", text: "今天到期" };
  if (days === 1) return { kind: "critical", text: "明天到期" };
  if (days <= 3) return { kind: "critical", text: `${days} 天后到期` };
  if (days <= 7) return { kind: "soon", text: `${days} 天后到期` };
  return { kind: "fresh", text: `还有 ${days} 天` };
}

const FRIDGE_CSS = `
.fridge-page{max-width:1240px;margin:0 auto;padding:28px 28px 60px;color:#17201c;letter-spacing:0}.fridge-page *{box-sizing:border-box}.fridge-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:20px}.fridge-header h1{margin:0;font-size:30px;line-height:1.2;letter-spacing:0}.fridge-header p{margin:6px 0 0;color:#68736d;font-size:14px}.fridge-header-actions{display:flex;align-items:center;gap:8px}.fridge-button,.fridge-icon-button,.fridge-row-button{font:inherit;letter-spacing:0}.fridge-button{min-height:40px;padding:0 15px;border:1px solid transparent;border-radius:6px;font-weight:650;cursor:pointer}.fridge-button:disabled,.fridge-icon-button:disabled{cursor:not-allowed;opacity:.55}.fridge-button.primary{background:#176b4d;color:#fff}.fridge-button.primary:hover:not(:disabled){background:#10583e}.fridge-button.secondary{background:#fff;border-color:#cfd8d3;color:#27352e}.fridge-button.danger{background:#b83c36;color:#fff}.fridge-button.wide{width:100%;margin-top:14px}.fridge-icon-button{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid #d8dfdb;border-radius:6px;background:#fff;color:#425149;font-size:20px;cursor:pointer}.fridge-icon-button:hover{background:#f1f5f2}.fridge-icon-button.danger-text{color:#b33731}.fridge-tabs{display:inline-flex;padding:3px;background:#edf2ef;border-radius:7px;margin-bottom:20px}.fridge-tabs button{min-width:108px;height:36px;padding:0 14px;border:0;border-radius:5px;background:transparent;color:#617069;font-weight:650;cursor:pointer}.fridge-tabs button.active{background:#fff;color:#176b4d;box-shadow:0 1px 3px rgba(24,43,34,.14)}.fridge-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #dfe5e1;border-radius:7px;background:#fff;margin-bottom:18px;overflow:hidden}.fridge-summary button{position:relative;text-align:left;padding:17px 18px;border:0;border-right:1px solid #e5eae7;background:#fff;cursor:pointer}.fridge-summary button:last-child{border-right:0}.fridge-summary button:hover,.fridge-summary button.active{background:#f3f8f5}.fridge-summary button.active:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:#176b4d}.fridge-summary span,.fridge-summary small{display:block;color:#68736d;font-size:12px}.fridge-summary strong{display:block;margin:5px 0 3px;font-size:27px;line-height:1}.fridge-summary .critical strong{color:#c9483f}.fridge-summary .soon strong{color:#a6650e}.fridge-summary .expired strong{color:#8e2f2a}.fridge-ai-panel{border:1px solid #cbdad2;border-radius:7px;background:#f7faf8;margin-bottom:24px;overflow:hidden}.fridge-panel-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;padding:13px 16px;border:0;background:#eaf3ee;color:#174a38;font-weight:750;font-size:15px;cursor:pointer}.fridge-ai-body{padding:16px}.fridge-ai-compose textarea{width:100%;resize:vertical;padding:11px 12px;border:1px solid #cbd5d0;border-radius:6px;background:#fff;font:inherit;line-height:1.5}.fridge-ai-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:9px;flex-wrap:wrap}.fridge-live-text{margin-top:10px;padding:10px 12px;background:#fff4e3;border-left:3px solid #e09a2e;font-size:13px}.fridge-image-preview{display:flex;align-items:center;gap:12px;margin-top:10px;color:#627069;font-size:12px}.fridge-image-preview img{width:62px;height:62px;object-fit:cover;border-radius:5px;border:1px solid #d7dfda}.fridge-message{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0;padding:10px 12px;border-radius:5px;font-size:13px}.fridge-message.error{background:#fff0ef;color:#9c2e28;border:1px solid #efc5c2}.fridge-message.info{background:#eef7ff;color:#245b7e;border:1px solid #c9e0ef}.fridge-message button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}.fridge-message.page-error{margin-top:0}.fridge-toast{position:fixed;right:24px;top:24px;z-index:1100;padding:11px 16px;border-radius:6px;background:#173e30;color:#fff;box-shadow:0 8px 28px rgba(20,46,35,.22);font-size:14px}.fridge-candidates{margin-top:16px;border-top:1px solid #d7e0db;padding-top:15px}.fridge-candidate-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}.fridge-candidate-head strong,.fridge-candidate-head span{display:block}.fridge-candidate-head span{font-size:12px;color:#6b7771;margin-top:3px}.fridge-candidate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fridge-candidate{padding:13px;border:1px solid #d9e1dc;border-radius:6px;background:#fff}.fridge-candidate-title{display:flex;align-items:center;gap:8px;margin-bottom:11px;font-weight:700}.fridge-candidate-title .confidence{margin-left:auto;font-size:11px;color:#447461;font-weight:500}.fridge-candidate-title .confidence.low{color:#b45122}.fridge-candidate-title .fridge-icon-button{width:28px;height:28px}.fridge-candidate-grid,.fridge-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.fridge-span-2{grid-column:span 2}.fridge-field{display:flex;flex-direction:column;gap:5px;min-width:0}.fridge-field>span{font-size:12px;font-weight:650;color:#526159}.fridge-field input,.fridge-field select,.fridge-field textarea,.fridge-filters input,.fridge-filters select{width:100%;min-width:0;border:1px solid #cfd8d3;border-radius:5px;background:#fff;color:#1d2923;font:inherit;font-size:14px}.fridge-field input,.fridge-field select,.fridge-filters input,.fridge-filters select{height:39px;padding:0 9px}.fridge-field textarea{padding:9px;resize:vertical}.fridge-field input:focus,.fridge-field select:focus,.fridge-field textarea:focus,.fridge-filters input:focus,.fridge-filters select:focus{outline:2px solid rgba(23,107,77,.18);border-color:#398466}.fridge-check{display:flex;align-items:center;gap:8px;font-size:13px}.fridge-check input{width:16px;height:16px;accent-color:#176b4d}.fridge-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:13px}.fridge-section-heading h2{margin:0;font-size:19px;letter-spacing:0}.fridge-section-heading p{margin:4px 0 0;color:#738078;font-size:12px}.fridge-section-heading>span{font-size:13px;color:#68736d}.fridge-filters{display:grid;grid-template-columns:minmax(210px,1fr) repeat(3,minmax(130px,180px));gap:8px;margin-bottom:12px}.fridge-table-wrap{border:1px solid #dde4e0;border-radius:7px;overflow:hidden;background:#fff}.fridge-table{width:100%;border-collapse:collapse;font-size:14px}.fridge-table th{padding:11px 13px;background:#f3f6f4;color:#536159;font-size:12px;text-align:left;border-bottom:1px solid #dce3df}.fridge-table td{padding:12px 13px;border-bottom:1px solid #edf0ee;vertical-align:middle}.fridge-table tbody tr:last-child td{border-bottom:0}.fridge-table tbody tr:hover{background:#fafcfb}.fridge-table tr.is-expired{background:#fffafa}.fridge-table td strong{display:block}.fridge-table td small{display:block;max-width:280px;margin-top:4px;color:#77837d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fridge-row-tags{display:flex;gap:5px;margin-top:5px}.fridge-row-tags span,.fridge-inline-tags span,.fridge-use-first span{display:inline-block;padding:2px 6px;border-radius:4px;background:#edf2ef;color:#54655c;font-size:11px}.fridge-row-tags .opened{background:#fff0d9;color:#8b5a0e}.fridge-expiry{display:inline-block;padding:3px 7px;border-radius:4px;font-size:12px;font-weight:700}.fridge-expiry.expired{background:#fbe6e4;color:#9d302a}.fridge-expiry.critical{background:#ffebe8;color:#bd352e}.fridge-expiry.soon{background:#fff2da;color:#92600f}.fridge-expiry.fresh{background:#e7f4ed;color:#257051}.fridge-date{font-size:11px!important}.fridge-table th.actions,.fridge-table td.actions{text-align:right;white-space:nowrap}.fridge-table td.actions .fridge-icon-button{width:32px;height:32px;margin-left:5px;font-size:17px}.fridge-row-button{height:32px;padding:0 10px;border:1px solid #b8d5c8;border-radius:5px;background:#eff8f3;color:#176b4d;font-weight:650;cursor:pointer}.fridge-empty,.fridge-loading{display:grid;place-items:center;gap:6px;min-height:220px;border:1px dashed #ccd6d0;border-radius:7px;color:#6e7b74;text-align:center}.fridge-empty strong{color:#34443b}.fridge-empty span{font-size:13px}.fridge-empty.compact{min-height:150px}.load-more{display:block;margin:14px auto}.fridge-modal-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:20px;background:rgba(19,30,25,.48)}.fridge-modal{width:min(620px,100%);max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);overflow:auto;overscroll-behavior:contain;padding:20px;border-radius:7px;background:#fff;box-shadow:0 24px 70px rgba(17,37,27,.25)}.fridge-modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.fridge-modal-head h2{margin:0;font-size:20px;letter-spacing:0}.fridge-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.fridge-consume-modal{width:min(420px,100%)}.fridge-consume-modal p{margin:0 0 16px;color:#56635c}.fridge-recipe-layout{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:22px;align-items:start}.fridge-recipe-settings{position:sticky;top:20px;padding-right:4px}.fridge-recipe-form{padding-top:15px;border-top:1px solid #dce3df}.fridge-use-first{margin-bottom:15px;padding:11px 12px;background:#fff6e5;border-left:3px solid #d99524;font-size:12px}.fridge-use-first strong{display:block;margin-bottom:7px;color:#80550f}.fridge-use-first div,.fridge-inline-tags{display:flex;gap:5px;flex-wrap:wrap}.fridge-recipe-note{margin:10px 0 0;color:#7a8580;font-size:11px;line-height:1.5}.fridge-recipe-results{display:grid;gap:14px}.fridge-recipe-card{padding:20px;border:1px solid #dce3df;border-radius:7px;background:#fff}.fridge-recipe-card-head{display:flex;justify-content:space-between;gap:18px;padding-bottom:15px;border-bottom:1px solid #e8ece9}.fridge-recipe-number{font-size:11px;color:#176b4d;font-weight:750}.fridge-recipe-card h3{margin:4px 0 5px;font-size:20px;letter-spacing:0}.fridge-recipe-card-head p{margin:0;color:#66736c;font-size:13px}.fridge-recipe-meta{display:flex;align-content:flex-start;justify-content:flex-end;gap:5px;flex-wrap:wrap;max-width:220px}.fridge-recipe-meta span{padding:4px 7px;border-radius:4px;background:#f0f3f1;color:#536159;font-size:11px;white-space:nowrap}.fridge-health-reason{margin:14px 0;padding:10px 12px;background:#eaf6ef;color:#255c44;font-size:13px;line-height:1.55}.fridge-recipe-block{margin-top:15px}.fridge-recipe-block h4{margin:0 0 8px;font-size:13px;color:#33433a}.fridge-ingredient-list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 14px}.fridge-ingredient-list li{display:grid;grid-template-columns:1fr auto;gap:1px 8px;padding:5px 0;border-bottom:1px dotted #dfe5e1;font-size:13px}.fridge-ingredient-list small{grid-column:1/-1;color:#77837d;font-size:10px}.fridge-missing{margin:8px 0 0;color:#8a5d1a;font-size:12px}.fridge-recipe-block ol{margin:0;padding-left:21px}.fridge-recipe-block ol li{margin:7px 0;padding-left:3px;font-size:13px;line-height:1.55}.fridge-safety-note{margin-top:14px;padding-top:12px;border-top:1px solid #ead9d7;color:#913d37;font-size:12px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:900px) and (pointer:coarse){.fridge-modal-backdrop{padding:max(12px,env(safe-area-inset-top,0px)) 12px 12px}.fridge-modal{max-height:calc(100vh - 24px);max-height:calc(100dvh - 24px - env(safe-area-inset-top,0px));scroll-padding-bottom:140px}.fridge-modal-actions{position:sticky;bottom:-20px;z-index:3;margin:18px -20px -20px;padding:12px 20px calc(68px + env(safe-area-inset-bottom,0px));border-top:1px solid #dfe5e1;background:#fff;box-shadow:0 -8px 18px rgba(23,46,35,.08)}.fridge-modal-actions .fridge-button{flex:1}}
@media(max-width:900px){.fridge-page{padding:22px 18px 50px}.fridge-summary{grid-template-columns:repeat(2,1fr)}.fridge-summary button:nth-child(2){border-right:0}.fridge-summary button:nth-child(-n+2){border-bottom:1px solid #e5eae7}.fridge-candidate-list{grid-template-columns:1fr}.fridge-filters{grid-template-columns:1fr 1fr}.fridge-search{grid-column:span 2}.fridge-recipe-layout{grid-template-columns:1fr}.fridge-recipe-settings{position:static}.fridge-table thead{display:none}.fridge-table,.fridge-table tbody,.fridge-table tr,.fridge-table td{display:block;width:100%}.fridge-table tr{padding:12px;border-bottom:1px solid #dfe5e1}.fridge-table tr:last-child{border-bottom:0}.fridge-table td{display:grid;grid-template-columns:86px 1fr;gap:8px;padding:5px 0;border:0}.fridge-table td:before{content:attr(data-label);color:#758078;font-size:12px}.fridge-table td.actions{display:flex;justify-content:flex-end;padding-top:9px}.fridge-table td.actions:before{display:none}.fridge-table td small{max-width:none}.fridge-row-tags{grid-column:2}.fridge-table td>strong,.fridge-table td>.fridge-row-tags,.fridge-table td>small{grid-column:2}.fridge-table td.actions .fridge-icon-button{margin-left:5px}}
@media(max-width:560px){.fridge-page{padding:18px 12px 42px}.fridge-header{align-items:flex-start}.fridge-header h1{font-size:25px}.fridge-header-actions .fridge-button{padding:0 11px}.fridge-tabs{display:flex}.fridge-tabs button{flex:1}.fridge-summary button{padding:14px}.fridge-summary strong{font-size:23px}.fridge-ai-body{padding:12px}.fridge-ai-actions{display:grid;grid-template-columns:1fr 1fr}.fridge-ai-actions .primary{grid-column:span 2}.fridge-candidate-head{align-items:flex-start;flex-direction:column}.fridge-candidate-head .fridge-button{width:100%}.fridge-filters{grid-template-columns:1fr}.fridge-search{grid-column:auto}.fridge-form-grid,.fridge-candidate-grid{grid-template-columns:1fr}.fridge-span-2{grid-column:auto}.fridge-modal{padding:16px}.fridge-modal-actions{bottom:-16px;margin:18px -16px -16px;padding-left:16px;padding-right:16px}.fridge-recipe-card{padding:15px}.fridge-recipe-card-head{display:block}.fridge-recipe-meta{justify-content:flex-start;max-width:none;margin-top:10px}.fridge-ingredient-list{grid-template-columns:1fr}.fridge-toast{left:12px;right:12px;top:12px;text-align:center}}
`;
