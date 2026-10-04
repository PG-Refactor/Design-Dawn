import { convertFileSrc } from "@tauri-apps/api/core";
import type { AssetUrlResolver } from "../../application/ports/asset-url-resolver";
import { ASSET_URL_SCHEME } from "./asset-constants";

const PATH_SEPARATOR = "/";

// Builds `<scheme origin>/<projectId>/<documentId>/<contentPath segments>`. Tauri's
// `convertFileSrc` supplies the platform-specific origin (`dawn-asset://localhost/` or
// `http://dawn-asset.localhost/`). It is called with an empty locator because it
// percent-encodes the WHOLE locator, separators included, and the Rust handler expects
// the separators to stay literal with only each segment encoded. Identifiers and the
// Document-relative contentPath are all that go in: never an absolute path.
export function createTauriAssetUrlResolver(): AssetUrlResolver {
  return {
    urlFor(projectId, documentId, contentPath) {
      const locator = [
        projectId,
        documentId,
        ...contentPath.split(PATH_SEPARATOR),
      ]
        .map(encodeURIComponent)
        .join(PATH_SEPARATOR);
      return `${convertFileSrc("", ASSET_URL_SCHEME)}${locator}`;
    },
  };
}
