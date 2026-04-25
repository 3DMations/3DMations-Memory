import { PATTERNS } from "./patterns";

export class ScrubberError extends Error {
  readonly patternName: string;
  readonly field: string | null;

  constructor(patternName: string, field: string | null = null) {
    const where = field ? ` in field "${field}"` : "";
    super(
      `hub-scrubber: refusing to send — matched pattern "${patternName}"${where}. ` +
        `Remove the credential, then retry.`,
    );
    this.name = "ScrubberError";
    this.patternName = patternName;
    this.field = field;
  }
}

export function scrub(text: string, field: string | null = null): void {
  if (!text) return;
  for (const p of PATTERNS) {
    if (p.regex.test(text)) {
      throw new ScrubberError(p.name, field);
    }
  }
}

export function scrubPayload(payload: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      scrub(value, field);
    }
  }
}
