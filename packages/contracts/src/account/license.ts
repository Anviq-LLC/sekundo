export const ANVIQ_COPYRIGHT_LINE = "© 2026 Anviq LLC. All rights reserved.";
export const ANVIQ_ADDRESS_LINE = "30 N Gould St #69062, Sheridan, WY 82801, USA";
export const LICENSEE_MAX_LENGTH = 80;

export function licensedToLine(licensee: string): string {
  return `Licensed to ${licensee}`;
}
