import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>加载中...</div>}>
      <LoginClient />
    </Suspense>
  );
}
