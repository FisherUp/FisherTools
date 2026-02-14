import { Suspense } from "react";
import NewLeaveClient from "./NewLeaveClient";

export default function NewLeavePage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <NewLeaveClient />
    </Suspense>
  );
}
