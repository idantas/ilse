/**
 * Where a copy goes in the code. Duplicate puts the copy right after the original; the
 * designer may then drag it anywhere. The place the agent is told comes from where the copy
 * stands on the page when the note is sent, not from the drag gesture (a reorder of a copy
 * that isn't in the code yet would name an order the code doesn't have).
 */

/** A neighbour of the copy on the page, as plain data */
export interface Neighbour {
  /** `<CopyCommand>` or `<a>` */
  name: string;
  /** Its visible text, one line */
  text: string;
  /** Same tag, classes and text as the copy: the original (or another twin of it) */
  twin: boolean;
}

/**
 * The place, in words for the agent — or undefined when the copy is still right after
 * its original (the default the command already says)
 */
export function copyPlacement(prev: Neighbour | null, next: Neighbour | null, parent: Neighbour | null): string | undefined {
  if (prev?.twin) return undefined;
  const say = (n: Neighbour) => `${n.name}${n.text ? ` "${n.text}"` : ''}`;
  if (prev) return `logo depois de ${say(prev)}`;
  if (next) return `logo antes de ${say(next)}`;
  if (parent) return `dentro de ${say(parent)}`;
  return undefined;
}

/** Whitespace-insensitive one-line text, cut to a readable length */
export function lineOf(text: string, max = 60): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
