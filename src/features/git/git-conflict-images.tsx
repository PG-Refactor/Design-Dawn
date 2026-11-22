import { useState } from "react";
import type {
  GitConflictImages,
  GitConflictSide,
} from "../../application/ports/git-gateway";
import { useMessages } from "../workspace/use-messages";

// A conflicted picture: both versions side by side (the common original above them, small),
// each with its pixel size, to choose by looking. A side that deleted the picture says so,
// and choosing it deletes the file.
export function GitConflictImageChoice({
  images,
  busy,
  onChoose,
}: {
  readonly images: GitConflictImages;
  readonly busy: boolean;
  readonly onChoose: (side: GitConflictSide) => void;
}) {
  const texts = useMessages().git.conflict;
  const [large, setLarge] = useState(false);
  const sides = [
    [
      "ours",
      texts.ours,
      images.ours,
      images.oursDeleted,
      texts.resolveWithOurs,
    ],
    [
      "theirs",
      texts.theirs,
      images.theirs,
      images.theirsDeleted,
      texts.resolveWithTheirs,
    ],
  ] as const;
  return (
    <div className="git-conflict-images">
      <div className="git-conflict-images__tools">
        {images.base === null ? null : (
          <figure className="git-conflict-images__base">
            <figcaption>{texts.base}</figcaption>
            <ConflictPicture source={images.base} label={texts.base} />
          </figure>
        )}
        <button
          type="button"
          className="button git-conflict-images__zoom"
          aria-pressed={large}
          onClick={() => setLarge((value) => !value)}
        >
          {large ? texts.shrink : texts.enlarge}
        </button>
      </div>
      <div
        className={
          large
            ? "git-conflict__sides git-conflict-images__sides git-conflict-images__sides--large"
            : "git-conflict__sides git-conflict-images__sides"
        }
      >
        {sides.map(([side, label, source, deleted, resolveLabel]) => {
          return (
            <figure key={side} className="git-conflict__side">
              <figcaption>{label}</figcaption>
              {deleted ? (
                <p className="git-conflict-images__empty">
                  {texts.deletedOnSide}
                </p>
              ) : source === null ? (
                <p className="git-conflict-images__empty">
                  {texts.imageUnreadable}
                </p>
              ) : (
                <ConflictPicture source={source} label={label} />
              )}
              <button
                type="button"
                className="button git-conflict-images__choose"
                // A side whose file cannot be shown is not chosen blind.
                disabled={busy || (!deleted && source === null)}
                onClick={() => onChoose(side)}
              >
                {deleted ? texts.resolveByDeleting : resolveLabel}
              </button>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

function ConflictPicture({
  source,
  label,
}: {
  readonly source: string;
  readonly label: string;
}) {
  const texts = useMessages().git.conflict;
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  return (
    <>
      <div className="git-conflict-images__frame">
        <img
          className="git-conflict-images__picture"
          src={source}
          alt={label}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      </div>
      {size === null ? null : (
        <span className="git-conflict-images__size">
          {texts.imageSize(size.width, size.height)}
        </span>
      )}
    </>
  );
}
