"use client";

import { FormEvent, useState } from "react";
import {
  FRIDGE_CATEGORIES,
  FRIDGE_LOCATIONS,
  FridgeItem,
  FridgeItemInput,
  addDays,
  localDateString,
} from "../../lib/fridge";

type Props = {
  item: FridgeItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: FridgeItemInput) => Promise<void>;
};

function blankInput(): FridgeItemInput {
  const today = localDateString();
  return {
    name: "",
    category: "蔬菜",
    quantity: 1,
    unit: "份",
    purchase_date: today,
    expiry_date: addDays(today, 4),
    storage_location: "冷藏室",
    opened: false,
    notes: "",
  };
}

export default function FridgeItemDialog({ item, saving, onClose, onSave }: Props) {
  const [form, setForm] = useState<FridgeItemInput>(() =>
    item
      ? {
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          purchase_date: item.purchase_date,
          expiry_date: item.expiry_date,
          storage_location: item.storage_location,
          opened: item.opened,
          notes: item.notes ?? "",
        }
      : blankInput()
  );
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return setError("请填写食材名称");
    if (!Number.isFinite(form.quantity) || form.quantity <= 0) return setError("数量必须大于 0");
    if (!form.unit.trim()) return setError("请填写单位");
    if (form.expiry_date < form.purchase_date) return setError("到期日不能早于购买日");
    setError("");
    try {
      await onSave(form);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "保存食材失败");
    }
  };

  return (
    <div className="fridge-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="fridge-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fridge-item-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="fridge-modal-head">
          <h2 id="fridge-item-title">{item ? "编辑食材" : "手工添加食材"}</h2>
          <button className="fridge-icon-button" type="button" onClick={onClose} aria-label="关闭" title="关闭">
            ×
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="fridge-form-grid">
            <label className="fridge-field fridge-span-2">
              <span>食材名称</span>
              <input
                value={form.name}
                maxLength={80}
                autoFocus
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="例如：番茄"
              />
            </label>

            <label className="fridge-field">
              <span>分类</span>
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value as FridgeItemInput["category"] })
                }
              >
                {FRIDGE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>

            <label className="fridge-field">
              <span>存放位置</span>
              <select
                value={form.storage_location}
                onChange={(event) =>
                  setForm({
                    ...form,
                    storage_location: event.target.value as FridgeItemInput["storage_location"],
                  })
                }
              >
                {FRIDGE_LOCATIONS.map((location) => <option key={location}>{location}</option>)}
              </select>
            </label>

            <label className="fridge-field">
              <span>数量</span>
              <input
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                value={form.quantity}
                onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })}
              />
            </label>

            <label className="fridge-field">
              <span>单位</span>
              <input
                value={form.unit}
                maxLength={16}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
                placeholder="个、克、盒"
              />
            </label>

            <label className="fridge-field">
              <span>购买日期</span>
              <input
                type="date"
                value={form.purchase_date}
                onChange={(event) => setForm({ ...form, purchase_date: event.target.value })}
              />
            </label>

            <label className="fridge-field">
              <span>到期日期</span>
              <input
                type="date"
                value={form.expiry_date}
                onChange={(event) => setForm({ ...form, expiry_date: event.target.value })}
              />
            </label>

            <label className="fridge-check fridge-span-2">
              <input
                type="checkbox"
                checked={form.opened}
                onChange={(event) => setForm({ ...form, opened: event.target.checked })}
              />
              <span>已经开封</span>
            </label>

            <label className="fridge-field fridge-span-2">
              <span>备注</span>
              <textarea
                value={form.notes ?? ""}
                maxLength={500}
                rows={3}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="包装状态、用途或其他说明"
              />
            </label>
          </div>

          {error && <div className="fridge-message error">{error}</div>}
          <div className="fridge-modal-actions">
            <button type="button" className="fridge-button secondary" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button type="submit" className="fridge-button primary" disabled={saving}>
              {saving ? "保存中..." : "保存食材"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
