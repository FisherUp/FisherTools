import { Suspense } from "react";
import ReportClient from "./ReportClient";

export default function ReportPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 1400, margin: "40px auto", padding: 16 }}>加载中...</div>}>
      <ReportClient />
    </Suspense>
  );
}
