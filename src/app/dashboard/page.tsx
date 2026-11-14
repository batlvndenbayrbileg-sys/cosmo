import { Suspense } from "react";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";

/** /dashboard?checkInId=... : crew dashboard for reloads and deep links (client side fetch). */
export default function DashboardPage() {
  return (
    // useSearchParams needs a Suspense boundary so the rest of the page can be prerendered
    <Suspense fallback={null}>
      <DashboardPageClient />
    </Suspense>
  );
}
