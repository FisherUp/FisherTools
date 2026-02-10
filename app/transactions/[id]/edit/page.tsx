import { Suspense } from "react";
import EditTransactionClient from "./EditTransactionClient";

export default function EditTransactionPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<div style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <EditTransactionClient id={params.id} />
    </Suspense>
  );
}
