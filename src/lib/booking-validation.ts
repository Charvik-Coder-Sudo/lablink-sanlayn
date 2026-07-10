export interface BookingTimeValidationResult {
  isValid: boolean;
  error?: string;
  startMinutes?: number;
  endMinutes?: number;
  durationMinutes?: number;
}

const TIME_PATTERN = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i;

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(TIME_PATTERN);
  if (!match) return null;

  const rawHours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isInteger(rawHours) || !Number.isInteger(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  let hours = rawHours;
  if (meridiem === "AM") {
    if (hours === 12) hours = 0;
  } else if (meridiem === "PM") {
    if (hours !== 12) hours += 12;
  } else if (hours > 23) {
    return null;
  }

  if (hours < 0 || hours > 23) return null;

  return hours * 60 + minutes;
}

export function validateBookingTimeRange(input: { startTime: string; endTime: string }): BookingTimeValidationResult {
  const startMinutes = parseTimeToMinutes(input.startTime);
  const endMinutes = parseTimeToMinutes(input.endTime);

  if (startMinutes === null || endMinutes === null) {
    return { isValid: false, error: "Please enter a valid time." };
  }

  if (endMinutes <= startMinutes) {
    return { isValid: false, error: "End time must be after start time." };
  }

  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) {
    return { isValid: false, error: "Booking duration must be greater than zero." };
  }

  return {
    isValid: true,
    startMinutes,
    endMinutes,
    durationMinutes,
  };
}
