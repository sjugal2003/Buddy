import { Suspense } from "react";
import { InboxView } from "@/components/views/inbox-view";

export default function InboxPage() {
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
