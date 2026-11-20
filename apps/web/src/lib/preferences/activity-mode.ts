import { createStoredPreference } from "./stored-preference";

/** Persisted Codex-style recency mode for the sidebar activity sections. Default off. */
export const ACTIVITY_MODE_KEY = "anviq.activity-mode";

export const activityModePreference = createStoredPreference({
  key: ACTIVITY_MODE_KEY,
  parse: (raw) => raw === "1",
  serialize: (on) => (on ? "1" : null),
});
