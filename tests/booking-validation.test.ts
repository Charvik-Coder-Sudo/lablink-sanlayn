import { describe, expect, it } from "vitest";
import { validateBookingTimeRange } from "../src/lib/booking-validation";

describe("validateBookingTimeRange", () => {
  it("rejects end times that are equal to or earlier than the start time", () => {
    expect(validateBookingTimeRange({ startTime: "10:00", endTime: "10:00" })).toEqual(
      expect.objectContaining({ isValid: false, error: "End time must be after start time." }),
    );
    expect(validateBookingTimeRange({ startTime: "14:00", endTime: "13:00" })).toEqual(
      expect.objectContaining({ isValid: false, error: "End time must be after start time." }),
    );
  });

  it("accepts valid 24-hour and 12-hour time values", () => {
    expect(validateBookingTimeRange({ startTime: "09:00", endTime: "10:30" })).toEqual(
      expect.objectContaining({ isValid: true }),
    );
    expect(validateBookingTimeRange({ startTime: "1:00 PM", endTime: "2:30 PM" })).toEqual(
      expect.objectContaining({ isValid: true }),
    );
  });
});
