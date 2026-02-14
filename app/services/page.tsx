import { Suspense } from "react";
import ServicesClient from "./ServicesClient";

export default function ServicesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <ServicesClient />
    </Suspense>
  );
}
