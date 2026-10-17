const word = '[\\p{L}\\p{M}\\p{N}_]';
const space = '[^\\S\\r\\n]';
const dash = '[\\-‐‑‒–—]';
// A single «а» is a conjunction and «м» can be a unit; require repetition.
const hesitation = `(?:э+(?:${space}*${dash}${space}*э+)*|э+м+|м{2,}|м+(?:${space}*${dash}${space}*м+)+|а{2,}|а+(?:${space}*${dash}${space}*а+)+|u+h+|u+m+|e+rm+)`;
const conditional = `(?!${space}+(?:ни|не)(?!${word}))`;
const insertion = `(?:как${space}+бы${conditional}|так${space}+сказать|ну)`;

export function removeFillerWords(value: string): string {
  let text = value;
  const separator = `(?:${space}*[,;:]${space}*|${space}+)`;
  const cluster = `${hesitation}(?:${separator}(?:${hesitation}|${insertion}))*(?!${word}|${dash})`;
  // An entire hesitation-only sentence should not leave an empty full stop.
  text = text.replace(new RegExp(`(?:^|(?<=[.!?…]${space}+))(?:${cluster}|ну)[.!?…]+${space}*`, 'giu'), '');
  text = text.replace(new RegExp(`(?<!${word}|${dash})(?:${cluster})${space}*[,;:]?${space}*`, 'giu'), '');
  // Comma-separated discourse insertions, but not meaningful uses such as
  // «сделай короче», «как бы ни» or «то есть» explanations.
  text = text.replace(new RegExp(`(^|[,.!?;:]${space}*)(?:ну|короче|так${space}+сказать|как${space}+бы)${space}*,${space}*`, 'giu'), '$1');
  text = text.replace(new RegExp(`(^|[,.!?;:]${space}*)(?:ну)${space}+(?!${dash})`, 'giu'), '$1');
  text = text.replace(new RegExp(`((?<!${word})(?:я|ты|он|она|мы|вы|они|это)${space}+)как${space}+бы${conditional}${space}+`, 'giu'), '$1');
  text = text.replace(/[^\S\r\n]+([,.!?;:])/gu, '$1')
    .replace(/,[^\S\r\n]*(?=[,;:.!?])/gu, '')
    .replace(/(^|[.!?][^\S\r\n]*)[,;:][^\S\r\n]*/gu, '$1')
    .replace(/[^\S\r\n]{2,}/gu, ' ').trim();
  // Restore sentence capitals after removing a leading hesitation, without
  // changing mixed-case names such as iPhone.
  if (text !== value.trim()) text = text.replace(/(^|[.!?]\s+)([«“"(]*)(\p{Ll}[\p{Ll}\p{M}]*)(?![\p{L}\p{M}])/gu,
    (_match, prefix: string, quote: string, first: string) => prefix + quote + first[0]!.toUpperCase() + first.slice(1));
  return text;
}
