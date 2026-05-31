import { Suspense } from "react";
import DraftFormClient from "../DraftFormClient";

export default function NewDraftPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <DraftFormClient mode="new" />
    </Suspense>
  );
}
