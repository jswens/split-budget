export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Parse a decimal input as text; no binary floating point dollar arithmetic. */
export function parseMoney(input: string): number {
  const value = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with at most two decimal places.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const result = Number(negative ? -cents : cents);
  if (!Number.isSafeInteger(result)) throw new Error('Amount is too large.');
  return result;
}

export function inputMoney(cents: number): string {
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}

export function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function monthLabel(month: string): string {
  return new Date(`${month}-02T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
