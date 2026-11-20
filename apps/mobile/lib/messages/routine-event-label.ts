import type { MessageBlock } from "@anviq/contracts";
import { t } from "@lingui/core/macro";

export type RoutineEventBlock = Extract<MessageBlock, { kind: "routine_event" }>;

/** The words of a routine row in the chat. */
export function routineEventLabel({ change, name }: RoutineEventBlock): string {
  switch (change) {
    case "created":
      return t`Created routine "${name}"`;
    case "updated":
      return t`Updated routine "${name}"`;
    case "enabled":
      return t`Enabled routine "${name}"`;
    case "disabled":
      return t`Disabled routine "${name}"`;
    case "deleted":
      return t`Deleted routine "${name}"`;
  }
}
