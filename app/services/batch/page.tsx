import { Suspense } from "react";
import BatchAssignmentClient from "./BatchAssignmentClient";

export default function BatchAssignmentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <BatchAssignmentClient />
    </Suspense>
  );
}
