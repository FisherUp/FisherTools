import { Suspense } from "react";
import NewInventoryClient from "./NewInventoryClient";

export default function NewInventoryPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>加载中…</div>}>
      <NewInventoryClient />
    </Suspense>
  );
}
