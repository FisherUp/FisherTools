import { Suspense } from "react";
import ProfilesClient from "./ProfilesClient";

export default function ProfilesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: "#888" }}>加载中…</div>}>
      <ProfilesClient />
    </Suspense>
  );
}
