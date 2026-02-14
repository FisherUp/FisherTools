import { Suspense } from "react";
import NewAssignmentClient from "./NewAssignmentClient";

export default function NewAssignmentPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <NewAssignmentClient />
    </Suspense>
  );
}
