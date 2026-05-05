export function formatFullDollar(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatDollar(value: number): string {
  const abs = Math.abs(value);
  return `$${abs.toFixed(2)}`;
}

export function formatDollarSigned(value: number): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatDollar(value)}`;
}

export function formatScaledDollar(value: number): string {
  return formatDollar(value);
}

export function formatScaledDollarSigned(value: number): string {
  return formatDollarSigned(value);
}
