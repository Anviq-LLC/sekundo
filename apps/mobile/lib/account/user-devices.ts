import type { UserDeviceRequest } from "@anviq/core";
import { listUserDevicesWith, removeUserDeviceWith } from "@anviq/core";
import { t } from "@lingui/core/macro";
import { fetchAuthenticatedAccountJson } from "../api/api";

const request: UserDeviceRequest = async (path, method) => {
  const { response, body } = await fetchAuthenticatedAccountJson<unknown>(
    path,
    method === "DELETE" ? { method } : {},
    method === "DELETE" ? null : {},
  );
  return { ok: response.ok, status: response.status, readBody: async () => body };
};

export function listUserDevices() {
  return listUserDevicesWith(request, t`Could not load`);
}

export function removeUserDevice(deviceId: string) {
  return removeUserDeviceWith(request, deviceId, t`Could not remove`);
}
