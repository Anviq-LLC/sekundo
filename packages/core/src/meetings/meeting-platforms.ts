import type { MeetingPlatform } from "@anviq/contracts";

export const meetingPlatformNames: Record<MeetingPlatform, string> = {
  zoom: "Zoom",
  google_meet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
};
