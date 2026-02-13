import { Suspense } from "react";
import InventoryClient from "./InventoryClient";

export default function InventoryPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <InventoryClient />
    </Suspense>
  );
}
