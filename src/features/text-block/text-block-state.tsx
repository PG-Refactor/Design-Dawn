import type { ContentLoadStatus } from "../../application/state/application-state";
import "./text-block-state.css";

export interface TextBlockStateMessages {
  readonly loading: string;
  readonly loadFailed: string;
  readonly loadFailedHint: string;
  readonly errorKind: string;
  readonly errorDetails: string;
}

export interface TextBlockStateProps {
  readonly status: ContentLoadStatus | undefined;
  readonly messages: TextBlockStateMessages;
}

// What a text block shows while its text is not available: the loading note or the error.
export function TextBlockState({ status, messages }: TextBlockStateProps) {
  if (status?.status === "failed") {
    // Never an empty preview: an empty block would look like an empty file, and could
    // invite an edit that overwrites the one that could not be read.
    return (
      <div className="text-block__state text-block__state--error">
        <p className="text-block__headline">{messages.loadFailed}</p>
        <p>{messages.loadFailedHint}</p>
        <details>
          <summary>{messages.errorDetails}</summary>
          <dl className="text-block__details">
            <dt>{messages.errorKind}</dt>
            <dd>{status.error.kind}</dd>
            <dd>{status.error.detail}</dd>
          </dl>
        </details>
      </div>
    );
  }
  return (
    <div className="text-block__state" role="status">
      {messages.loading}
    </div>
  );
}
