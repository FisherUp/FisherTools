import { Suspense } from "react";
import LeaveSettingsClient from "./LeaveSettingsClient";

export default function LeaveSettingsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>加载中...</div>}>
      <LeaveSettingsClient />
    </Suspense>
  );
}
