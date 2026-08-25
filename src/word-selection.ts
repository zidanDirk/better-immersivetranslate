const singleWordPattern =
  /^[\p{L}\p{M}]+(?:['’\-\u2010-\u2015][\p{L}\p{M}]+)*$/u;
const wordJoinerPattern = /['’\-\u2010-\u2015]/u;

export function isSingleWordSelection(text: string): boolean {
  const trimmed = text.trim();
  if (!singleWordPattern.test(trimmed)) return false;
  const wordLikeSegments = Array.from(
    new Intl.Segmenter(undefined, { granularity: "word" }).segment(trimmed),
  ).filter((segment) => segment.isWordLike);
  return (
    wordLikeSegments.length === 1 ||
    (wordJoinerPattern.test(trimmed) && wordLikeSegments.length > 1)
  );
}
