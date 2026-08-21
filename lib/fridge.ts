export const FRIDGE_CATEGORIES = [
  "蔬菜",
  "水果",
  "肉类",
  "海鲜",
  "乳制品",
  "蛋类",
  "主食",
  "熟食",
  "调味品",
  "饮料",
  "其他",
] as const;

export const FRIDGE_LOCATIONS = ["冷藏室", "冷冻室", "常温柜", "其他"] as const;

export type FridgeCategory = (typeof FRIDGE_CATEGORIES)[number];
export type FridgeLocation = (typeof FRIDGE_LOCATIONS)[number];
export type FridgeRole =
  | "admin"
  | "finance"
  | "coordinator"
  | "viewer"
  | "inventory-edit"
  | "learner"
  | "";

export type FridgeItem = {
  id: string;
  org_id: string;
  name: string;
  category: FridgeCategory;
  quantity: number;
  unit: string;
  purchase_date: string;
  expiry_date: string;
  storage_location: FridgeLocation;
  opened: boolean;
  status: "available" | "consumed" | "discarded";
  notes: string | null;
  consumed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type FridgeItemInput = Pick<
  FridgeItem,
  | "name"
  | "category"
  | "quantity"
  | "unit"
  | "purchase_date"
  | "expiry_date"
  | "storage_location"
  | "opened"
> & {
  notes?: string | null;
};

export type FridgeProfile = {
  userId: string;
  orgId: string;
  role: FridgeRole;
};

export function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

export function daysUntil(dateString: string, from = localDateString()): number {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(dateString) - toUtc(from)) / 86_400_000);
}
