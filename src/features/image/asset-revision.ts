import { createStore } from "../../shared/store/store";

// The webview keeps every picture it has shown, by its address, for as long as the page
// lives (whatever the server says about caching), so a picture file rewritten under the app
// (a Git resolve or Pull, a change made outside) would keep showing its old content. Picture
// addresses therefore carry this number, raised whenever such files may have changed: the
// webview then asks for them again. It lives as long as the page, like that memory, and only
// goes up (a reset to an earlier number would bring the old pictures back).
const ASSET_REVISION_PARAMETER = "v";

export const assetRevisionStore = createStore<{ readonly revision: number }>({
  revision: 0,
});

export function raiseAssetRevision(): void {
  assetRevisionStore.setState((state) => ({ revision: state.revision + 1 }));
}

// `url` with the revision (unchanged before the first raise).
export function withAssetRevision(url: string, revision: number): string {
  if (revision === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${ASSET_REVISION_PARAMETER}=${revision}`;
}
