import { SIGNUP_SURFACE_HEADER } from "@anviq/contracts";
import { rememberSignupAttribution } from "@anviq/core/signup-attribution";
import { passkeyClient } from "@better-auth/passkey/client";
import type { OrganizationClientOptions } from "better-auth/client/plugins";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import type { ReactAuthClient } from "better-auth/react";
import { createAuthClient } from "better-auth/react";
import { desktopBridge } from "../platform/desktop";

const signupSurface = desktopBridge() ? "desktop" : "web";
if (typeof window !== "undefined") rememberSignupAttribution(window);

export const authClient: ReactAuthClient<{
  // An uninstantiated generic resolves to `any`, which would erase every plugin's actions.
  plugins: [
    ReturnType<typeof organizationClient<OrganizationClientOptions>>,
    ReturnType<typeof emailOTPClient>,
    ReturnType<typeof passkeyClient>,
  ];
}> = createAuthClient({
  fetchOptions: {
    headers: { [SIGNUP_SURFACE_HEADER]: signupSurface },
  },
  plugins: [organizationClient(), emailOTPClient(), passkeyClient()],
});
