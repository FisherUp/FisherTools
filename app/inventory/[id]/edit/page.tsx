import { Suspense } from "react";
import EditInventoryClient from "./EditInventoryClient";

export default function EditInventoryPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>加载中…</div>}>
      <EditInventoryClient id={params.id} />
    </Suspense>
  );
}
