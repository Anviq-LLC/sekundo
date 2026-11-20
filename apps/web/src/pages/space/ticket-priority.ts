import type { TicketPriority } from "@anviq/contracts";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";

export function useTicketPriorityLabels(): Record<TicketPriority, string> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      low: t`Low`,
      normal: t`Normal`,
      high: t`High`,
      urgent: t`Urgent`,
    }),
    [t],
  );
}
