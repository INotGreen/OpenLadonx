export function formatRelativeTime(timestamp: number) {
  const now = Date.now();
  const diffSeconds = Math.round((timestamp - now) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  if (absSeconds < 5) {
    return "now";
  }
  if (absSeconds < 60) {
    const value = Math.max(1, Math.round(absSeconds));
    return diffSeconds < 0 ? `${value}s ago` : `in ${value}s`;
  }
  if (absSeconds < 60 * 60) {
    const value = Math.max(1, Math.round(absSeconds / 60));
    return diffSeconds < 0 ? `${value}m ago` : `in ${value}m`;
  }
  const ranges: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
    { unit: "year", seconds: 60 * 60 * 24 * 365 },
    { unit: "month", seconds: 60 * 60 * 24 * 30 },
    { unit: "week", seconds: 60 * 60 * 24 * 7 },
    { unit: "day", seconds: 60 * 60 * 24 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "minute", seconds: 60 },
    { unit: "second", seconds: 1 },
  ];
  const range =
    ranges.find((entry) => absSeconds >= entry.seconds) ||
    ranges[ranges.length - 1];
  if (!range) {
    return "now";
  }
  const value = Math.round(diffSeconds / range.seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  return formatter.format(value, range.unit);
}

export function formatRelativeTimeShort(timestamp: number, locale?: string) {
  const now = Date.now();
  const absSeconds = Math.abs(Math.round((timestamp - now) / 1000));
  const isChinese = locale?.toLowerCase().startsWith("zh") ?? false;
  if (absSeconds < 60) {
    return isChinese ? "刚刚" : "now";
  }
  if (absSeconds < 60 * 60) {
    const value = Math.max(1, Math.round(absSeconds / 60));
    return isChinese ? `${value}分` : `${value}m`;
  }
  if (absSeconds < 60 * 60 * 24) {
    const value = Math.max(1, Math.round(absSeconds / (60 * 60)));
    return isChinese ? `${value}时` : `${value}h`;
  }
  if (absSeconds < 60 * 60 * 24 * 7) {
    const value = Math.max(1, Math.round(absSeconds / (60 * 60 * 24)));
    return isChinese ? `${value}天` : `${value}d`;
  }
  if (absSeconds < 60 * 60 * 24 * 30) {
    const value = Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 7)));
    return isChinese ? `${value}周` : `${value}w`;
  }
  if (absSeconds < 60 * 60 * 24 * 365) {
    const value = Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 30)));
    return isChinese ? `${value}月` : `${value}mo`;
  }
  const value = Math.max(1, Math.round(absSeconds / (60 * 60 * 24 * 365)));
  return isChinese ? `${value}年` : `${value}y`;
}
