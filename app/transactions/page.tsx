import { Suspense } from "react";
import TransactionsClient from "./TransactionsClient";

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 1150, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <TransactionsClient />
    </Suspense>
  );
}
