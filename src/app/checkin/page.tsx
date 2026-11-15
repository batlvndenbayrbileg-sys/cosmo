import { redirect } from "next/navigation";

/**
 * The old direct check-in screen. The daily check-up now lives behind the "Daily check-up" button of the assistant on
 * "/" (team request 2026-11-15), which also resumes a check-up in progress, so an old link or bookmark lands there. A
 * second, button-less way into the same row would leave it stuck in assistant mode with no way back to the check-up.
 */
export default function CheckInPage() {
  redirect("/");
}
