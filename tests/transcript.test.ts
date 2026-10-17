import { describe, expect, it } from 'vitest';
import { applyTextReplacements, prepareTranscript } from '../src/shared/transcript';
import { defaultPreferences, validatePreferences } from '../src/shared/preferences';

describe('filler removal', () => {
  const enabled = { ...defaultPreferences, removeFillerWords: true };
  it('cleans the hesitation spellings reported in dictated speech', () => {
    expect(prepareTranscript('А-а, нужно подготовить э-э релиз. Это пять моделей, а-а, переход на Tauri. Ммм, как бы всё готово.', enabled))
      .toBe('Нужно подготовить релиз. Это пять моделей, переход на Tauri. Всё готово.');
  });
  it('removes repeated sounds, separated insertions and conversational ну', () => {
    expect(prepareTranscript('Ну, эм, я как бы говорю. Короче, м-м-м, всё работает.', enabled))
      .toBe('Я говорю. Всё работает.');
    expect(prepareTranscript('Ну и ещё один пункт.', enabled)).toBe('И ещё один пункт.');
    expect(prepareTranscript('Так, ну что теперь?', enabled)).toBe('Так, что теперь?');
  });
  it('preserves meaningful words, conditionals, units and names', () => {
    const text = 'Вот документ, то есть готовый текст. Как бы ни было, сделай короче. А длина — 10 м. Это iPhone и эмаль.';
    expect(prepareTranscript(text, enabled)).toBe(text);
    expect(prepareTranscript('эм, iPhone работает.', enabled)).toBe('iPhone работает.');
  });
  it('does not leave punctuation from hesitation-only sentences', () => {
    expect(prepareTranscript('Эм. Э-э, привет! Ммм.', enabled)).toBe('Привет!');
    expect(prepareTranscript('Эм. Ну. Ммм…', enabled)).toBe('');
  });
  it('keeps the original dictated fillers when disabled and formats punctuation afterwards', () => {
    const text = 'А-а, я как бы говорю.';
    expect(prepareTranscript(text, defaultPreferences)).toBe(text);
    expect(prepareTranscript(text, { ...enabled, punctuation: false })).toBe('Я говорю');
  });
});

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
