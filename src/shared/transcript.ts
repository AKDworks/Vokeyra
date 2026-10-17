import type { Preferences, TextReplacement } from './contracts';
import { removeFillerWords } from './filler-words';

const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function applyTextReplacements(value: string, rules: readonly TextReplacement[]): string {
  if (!rules.length || !value) return value;
  // One pass prevents one replacement from triggering another. Long phrases
  // take precedence; Unicode boundaries protect the insides of other words.
  const ordered = [...rules].sort((left, right) => right.from.length - left.from.length);
  const alternatives = ordered.map((rule, index) => `(?<rule${index}>${rule.from.normalize('NFC').split(/[^\S\r\n]+/u).map(escapePattern).join('[^\\S\\r\\n]+')})`);
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
  return value.normalize('NFC').replace(pattern, (match, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    const key = Object.keys(groups).find(key => groups[key] !== undefined);
    return key ? ordered[Number(key.slice(4))]!.to : match;
  });
}

export function prepareTranscript(value: string, settings: Pick<Preferences,
  'removeFillerWords' | 'punctuation' | 'appendSpace' | 'textReplacements'>): string {
  let text = value.trim();
  if (settings.removeFillerWords) text = removeFillerWords(text);
  text = applyTextReplacements(text, settings.textReplacements);
  if (!settings.punctuation) text = text.replace(/\p{P}+/gu, '').replace(/\s{2,}/gu, ' ').trim();
  return text ? text + (settings.appendSpace ? ' ' : '') : '';
}
