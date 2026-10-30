// Port for files dropped on the app window. Rust keeps the dropped paths and announces only
// an opaque `dropId` and a count; the Frontend never sees a
// path.

export interface FilesDroppedEvent {
  readonly dropId: string;
  readonly fileCount: number;
}

export interface DragStateEvent {
  // True while files are dragged over the window.
  readonly active: boolean;
}

export interface DropEventSource {
  // Each returns the unsubscribe function.
  subscribeFilesDropped(
    listener: (event: FilesDroppedEvent) => void,
  ): () => void;
  subscribeDragState(listener: (event: DragStateEvent) => void): () => void;
}
