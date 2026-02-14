import { Suspense } from "react";
import LeavesClient from "./LeavesClient";

export default function LeavesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <LeavesClient />
    </Suspense>
  );
}
