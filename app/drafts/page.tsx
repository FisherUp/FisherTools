import { Suspense } from "react";
import DraftsClient from "./DraftsClient";

export default function DraftsPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 1150, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <DraftsClient />
    </Suspense>
  );
}
