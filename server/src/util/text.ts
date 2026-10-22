export function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Rounds down to one decimal so a 89.96 is never shown as a green-looking 90.0. */
export function floor1(value: number): number {
  return Math.floor(value * 10 + 1e-9) / 10;
}
