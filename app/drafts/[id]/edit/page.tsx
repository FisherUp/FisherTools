import { Suspense } from "react";
import DraftFormClient from "../../DraftFormClient";

export default function EditDraftPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <DraftFormClient mode="edit" draftId={params.id} />
    </Suspense>
  );
}
