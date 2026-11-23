export const EXPENSE_CATEGORIES = ["رسوم محكمة", "طوابع", "خبرة", "تبليغ", "ترجمة", "تنقل", "تصوير ونسخ", "أخرى"] as const;

/** Billed value of logged time at an hourly rate, in fils so rounding never drifts. */
export function timeValueCents(minutes: number, hourlyRate: number) {
  return Math.round((minutes * Math.round(hourlyRate * 100)) / 60);
}

export const formatMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours && rest ? `${hours} س ${rest} د` : hours ? `${hours} س` : `${rest} د`;
};
