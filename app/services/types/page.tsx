import { Suspense } from "react";
import ServiceTypesClient from "./ServiceTypesClient";

export default function ServiceTypesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <ServiceTypesClient />
    </Suspense>
  );
}
