import type { ActivityFilters } from "./client-api";
import { addDays } from "./time";

/**
 * Bộ lọc trên màn nhật ký (Story E6-2) → tham số API. Khoảng thời gian chọn nhanh tính theo ngày
 * lịch Việt Nam, tính cả hai đầu: "7 ngày qua" là hôm nay và 6 ngày trước đó.
 */
export const ACTIVITY_PERIODS = [
  "all",
  "today",
  "last7",
  "last30",
  "custom",
] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];

export interface ActivityFilterState {
  actor: string;
  period: ActivityPeriod;
  /** Chỉ dùng khi period = custom (YYYY-MM-DD hoặc rỗng). */
  from: string;
  to: string;
  entity: string;
  action: string;
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilterState = {
  actor: "",
  period: "all",
  from: "",
  to: "",
  entity: "",
  action: "",
};

export function isFiltered(state: ActivityFilterState): boolean {
  return (
    state.actor !== "" ||
    state.entity !== "" ||
    state.action !== "" ||
    (state.period !== "all" &&
      !(state.period === "custom" && state.from === "" && state.to === ""))
  );
}

/** Kết quả: tham số gửi API, hoặc `invalid` khi khoảng tùy chọn ngược (không gọi API). */
export function toApiFilters(
  state: ActivityFilterState,
  today: string,
): { ok: true; filters: ActivityFilters } | { ok: false } {
  const filters: ActivityFilters = {};
  if (state.actor) filters.actor_id = state.actor;
  if (state.entity) filters.entity_type = state.entity;
  if (state.action) filters.action = state.action;
  switch (state.period) {
    case "today":
      filters.from = today;
      filters.to = today;
      break;
    case "last7":
      filters.from = addDays(today, -6);
      filters.to = today;
      break;
    case "last30":
      filters.from = addDays(today, -29);
      filters.to = today;
      break;
    case "custom":
      if (state.from && state.to && state.from > state.to) return { ok: false };
      if (state.from) filters.from = state.from;
      if (state.to) filters.to = state.to;
      break;
    case "all":
      break;
  }
  return { ok: true, filters };
}
