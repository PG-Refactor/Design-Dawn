import { GIT_MESSAGES } from "./git-messages";
import "./git-panel.css";

// Takes the place of the document area while the Git panel is shown. The diff view
// comes in a later step; until a file is selected it only says what to do.
export function GitMainArea() {
  return (
    <section className="git-main-area" aria-label={GIT_MESSAGES.mainAreaLabel}>
      <p className="git-main-area__placeholder">
        {GIT_MESSAGES.mainAreaPlaceholder}
      </p>
    </section>
  );
}
