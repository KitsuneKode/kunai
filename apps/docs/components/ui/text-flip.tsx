/**
 * A vertical text flip, after chanhdai's text-flip: words share one grid cell
 * and cycle through on a fixed rotation — enter from below, hold, exit above.
 * CSS-only; under reduced motion the stack collapses to the first word. The
 * caller keeps the full phrase in an sr-only sibling, so readers and crawlers
 * always get the real sentence.
 */
export function TextFlip({ words }: { readonly words: readonly string[] }) {
  return (
    <span className="kunai-text-flip" aria-hidden="true">
      {words.map((word) => (
        <span key={word}>{word}</span>
      ))}
    </span>
  );
}
