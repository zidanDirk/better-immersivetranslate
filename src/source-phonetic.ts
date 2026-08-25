const pinyinToneVowels = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/iu;

const targetScriptPatterns = [
  /\p{Script=Han}/u,
  /\p{Script=Hiragana}|\p{Script=Katakana}/u,
  /\p{Script=Hangul}/u,
  /\p{Script=Arabic}/u,
  /\p{Script=Hebrew}/u,
  /\p{Script=Devanagari}/u,
  /\p{Script=Cyrillic}/u,
];

function comparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function validatedSourcePhonetic(
  sourceText: string,
  translatedText: string,
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const phonetic = value.trim().normalize("NFC");
  if (phonetic.length > 160 || !/^\/[^/\r\n]+\/$/u.test(phonetic)) {
    return undefined;
  }

  const transcription = phonetic.slice(1, -1).trim();
  if (!/[\p{L}\p{M}\p{S}]/u.test(transcription)) return undefined;

  const comparableSource = comparableText(sourceText);
  const comparableTranslation = comparableText(translatedText);
  const comparableTranscription = comparableText(transcription);
  if (
    comparableSource !== comparableTranslation &&
    comparableTranscription === comparableTranslation
  ) {
    return undefined;
  }

  if (
    targetScriptPatterns.some(
      (pattern) =>
        pattern.test(translatedText) &&
        !pattern.test(sourceText) &&
        pattern.test(transcription),
    )
  ) {
    return undefined;
  }

  const translationUsesHan = /\p{Script=Han}/u.test(translatedText);
  const sourceUsesHan = /\p{Script=Han}/u.test(sourceText);
  if (
    translationUsesHan &&
    !sourceUsesHan &&
    pinyinToneVowels.test(transcription)
  ) {
    return undefined;
  }

  return phonetic;
}
