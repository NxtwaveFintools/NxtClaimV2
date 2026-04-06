/**
 * Location type constants for expense claims.
 *
 * Used by the NIAT Offline Lead Generation Team department to classify
 * whether an expense occurred at the base location or out-of-station.
 */

export const LOCATION_TYPES = {
  BASE: "Base Location",
  OUT_STATION: "Out Station",
} as const;

export type LocationType = (typeof LOCATION_TYPES)[keyof typeof LOCATION_TYPES];

export const LOCATION_TYPE_OPTIONS: readonly { value: LocationType; label: string }[] = [
  { value: LOCATION_TYPES.BASE, label: "Base Location" },
  { value: LOCATION_TYPES.OUT_STATION, label: "Out Station" },
] as const;

/**
 * Department name that requires the location_type / location_details fields.
 * Matched against `departmentRouting[].name` at runtime.
 */
export const NIAT_OFFLINE_LEAD_GEN_DEPARTMENT = "NIAT Offline Lead Generation Team";
