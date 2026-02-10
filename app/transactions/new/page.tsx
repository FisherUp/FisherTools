import { Suspense } from "react";
import NewTransactionClient from "./NewTransactionClient";

export default function NewTransactionPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 760, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <NewTransactionClient />
    </Suspense>
  );
}
