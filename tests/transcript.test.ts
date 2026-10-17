import { describe, expect, it } from 'vitest';
import { applyTextReplacements, prepareTranscript } from '../src/shared/transcript';
import { defaultPreferences, validatePreferences } from '../src/shared/preferences';

describe('word replacements', () => {
  it('replaces whole Unicode words, ignores case and preserves the chosen spelling', () => {
    expect(applyTextReplacements('Вакейра, ВАКЕЙРА! вакейрами кот котёнок кот_1', [
      { from: 'вакейра', to: 'Vokeyra' }, { from: 'кот', to: 'cat' },
    ])).toBe('Vokeyra, Vokeyra! вакейрами cat котёнок кот_1');
  });
  it('prefers a full phrase and never cascades replacements', () => {
    expect(applyTextReplacements('нью  йорк и нью, Vokeyra', [
      { from: 'нью', to: 'new' }, { from: 'нью йорк', to: 'New York' },
      { from: 'New York', to: 'NY' }, { from: 'Vokeyra', to: 'Voice app' },
    ])).toBe('New York и new, Voice app');
    expect(applyTextReplacements('нью\nйорк', [{ from: 'нью йорк', to: 'New York' }])).toBe('нью\nйорк');
  });
  it('treats source patterns and replacement dollar signs as literal text', () => {
    expect(applyTextReplacements('C++ a.b aXb', [
      { from: 'C++', to: '$& language' }, { from: 'a.b', to: 'dot' },
    ])).toBe('$& language dot aXb');
  });
  it('supports canonically equivalent text and Unicode case folding', () => {
    expect(applyTextReplacements('cafe\u0301 Σ ς', [{ from: 'café', to: 'coffee' }, { from: 'σ', to: 'sigma' }]))
      .toBe('coffee sigma sigma');
  });
  it('applies the same final formatting to replacement text', () => {
    expect(prepareTranscript(' Эм, вакейра! ', { ...defaultPreferences,
      removeFillerWords: true, punctuation: false, appendSpace: true,
      textReplacements: [{ from: 'вакейра', to: 'Vokeyra.' }],
    })).toBe('Vokeyra ');
    expect(prepareTranscript(' Обычный текст. ', defaultPreferences)).toBe('Обычный текст.');
  });
  it('migrates existing vocabulary and preserves rules when other settings change', () => {
    const old = validatePreferences({ customVocabulary: ['Vokeyra'] });
    expect(old.customVocabulary).toEqual(['Vokeyra']); expect(old.textReplacements).toEqual([]);
    const saved = validatePreferences({ textReplacements: [{ from: '  нью  йорк ', to: ' New York ' }] }, old);
    expect(validatePreferences({ appLanguage: 'en' }, saved).textReplacements).toEqual([{ from: 'нью йорк', to: 'New York' }]);
  });
  it.each([
    null, 'invalid', [{ from: '', to: 'word' }], [{ from: 'word', to: '' }],
    [{ from: '(a+)+', to: 1 }], [{ from: 'one\ntwo', to: 'word' }],
    [{ from: 'word', to: 'a'.repeat(201) }],
    [{ from: 'Слово', to: 'one' }, { from: 'слово', to: 'two' }],
    Array.from({ length: 101 }, (_, index) => ({ from: String(index), to: 'word' })),
  ])('rejects malformed or conflicting rules %#', value => {
    expect(() => validatePreferences({ textReplacements: value })).toThrow();
  });
});
