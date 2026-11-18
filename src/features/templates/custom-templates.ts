// Custom templates: saving a block, a sheet or a Document as a template, and making new
// ones from a template. The templates themselves live in Rust (three places, see the
// gateway); this keeps their list for the menus and turns them into blocks, sheets and
// Documents through the usual actions (one undo step for the blocks of a sheet).

import type { ImportedImage } from "../../application/ports/asset-types";
import type { OperationResult } from "../../application/ports/operation-error";
import {
  operationErr,
  operationOk,
} from "../../application/ports/operation-error";
import type {
  TemplateBlockContent,
  TemplateContent,
  TemplateEditInfo,
  TemplateGateway,
  TemplateKind,
  TemplateLoadIssue,
  TemplateRef,
  TemplateScope,
  TemplateSheetContent,
  TemplateSummary,
} from "../../application/ports/template-gateway";
import type { ApplicationStore } from "../../application/state/application-state";
import type { Block } from "../../domain/block/block";
import {
  BLOCK_TYPE_DEFINITIONS,
  parseBlockType,
} from "../../domain/block/block-type";
import type { ContentPath } from "../../domain/block/content-path";
import type {
  BlockId,
  DocumentId,
  FolderId,
  ProjectId,
  SheetId,
} from "../../domain/shared/entity-id";
import { createStore, type Store } from "../../shared/store/store";
import type {
  CanvasActions,
  TemplateBlockInput,
} from "../canvas/canvas-actions";
import type { Extent, Point } from "../canvas/geometry/viewport-math";
import { markdownImageAssets } from "../markdown/render-markdown";
import { addOperationError } from "../workspace/ui-state/shell-ui-state";
import type {
  OperationLabel,
  UiStateStore,
} from "../workspace/ui-state/ui-state";
import type { WorkspaceActions } from "../workspace/workspace-actions";

export interface CustomTemplateState {
  readonly templates: readonly TemplateSummary[];
  readonly issues: readonly TemplateLoadIssue[];
}

const EMPTY_STATE: CustomTemplateState = { templates: [], issues: [] };
const LOADED = "loaded";
const ASSET_PREFIX = "assets/";
const SAVE_LABEL: OperationLabel = "saveTemplate";
const USE_LABEL: OperationLabel = "useTemplate";
const MANAGE_LABEL: OperationLabel = "manageTemplate";

export interface PlaceOnCanvas {
  readonly viewportSize: Extent;
  readonly at?: Point;
}

export interface CustomTemplates {
  readonly store: Store<CustomTemplateState>;
  refresh(): Promise<void>;
  saveBlock(
    documentId: DocumentId,
    sheetId: SheetId,
    blockId: BlockId,
    scope: TemplateScope,
    name: string,
  ): Promise<OperationResult<void>>;
  saveSheet(
    documentId: DocumentId,
    sheetId: SheetId,
    scope: TemplateScope,
    name: string,
  ): Promise<OperationResult<void>>;
  saveDocument(
    documentId: DocumentId,
    scope: TemplateScope,
    name: string,
  ): Promise<OperationResult<void>>;
  // A Markdown or Mermaid template onto the sheet, where a new block would go.
  addBlocks(
    template: TemplateSummary,
    documentId: DocumentId,
    sheetId: SheetId,
    place: PlaceOnCanvas,
  ): Promise<OperationResult<void>>;
  // `name`: the new sheet's name (the template's sheet name when left out).
  createSheet(
    template: TemplateSummary,
    documentId: DocumentId,
    name?: string,
  ): Promise<OperationResult<void>>;
  createDocument(
    template: TemplateSummary,
    name: string,
    parentFolderId: FolderId | null,
  ): Promise<OperationResult<void>>;
  // The Document name a Document template suggests (its own name when it has none).
  documentNameOf(template: TemplateSummary): Promise<string>;
  // The sheet name a sheet template suggests (its own name when it cannot be read).
  sheetNameOf(template: TemplateSummary): Promise<string>;
  // An open Document as a template of `kind` would hold it (for saving an edited template).
  capture(
    documentId: DocumentId,
    kind: TemplateKind,
    name: string,
  ): Promise<OperationResult<TemplateContent>>;
  // An editing window's empty Project gets a Document holding the template.
  fillForEditing(
    info: TemplateEditInfo,
    importAsset: AssetImporter,
  ): Promise<OperationResult<void>>;
  rename(template: TemplateRef, name: string): Promise<OperationResult<void>>;
  // Opens a window that edits the template.
  openEditor(template: TemplateRef): Promise<OperationResult<void>>;
  remove(template: TemplateRef): Promise<OperationResult<void>>;
  move(
    template: TemplateRef,
    to: TemplateScope,
  ): Promise<OperationResult<void>>;
}

export interface CustomTemplateDependencies {
  readonly gateway: TemplateGateway;
  readonly applicationStore: ApplicationStore;
  readonly uiStateStore: UiStateStore;
  readonly actions: Pick<
    WorkspaceActions,
    "createSheet" | "createDocument" | "completeCreatedDocument"
  >;
  readonly canvasActions: Pick<
    CanvasActions,
    "loadSheetContents" | "addTemplateBlocks"
  >;
}

const fileName = (path: string) => path.split("/").at(-1) ?? path;

// Copies one image of a template into a Document's assets.
export type AssetImporter = (
  documentId: DocumentId,
  assetName: string,
) => Promise<OperationResult<ImportedImage>>;

function refOf(template: TemplateSummary): TemplateRef {
  return {
    scope: template.scope,
    kind: template.kind,
    templateId: template.templateId,
  };
}

export function createCustomTemplates({
  gateway,
  applicationStore,
  uiStateStore,
  actions,
  canvasActions,
}: CustomTemplateDependencies): CustomTemplates {
  const store = createStore<CustomTemplateState>(EMPTY_STATE);

  function projectId(): ProjectId | null {
    return applicationStore.getState().project?.projectId ?? null;
  }

  function report<T>(
    label: OperationLabel,
    subject: string | null,
    result: OperationResult<T>,
  ): OperationResult<T> {
    if (!result.ok) {
      uiStateStore.setState((state) =>
        addOperationError(state, label, subject, result.error),
      );
    }
    return result;
  }

  const noProject = () => operationErr("projectNotOpen", "no project is open");

  async function refresh(): Promise<void> {
    const project = projectId();
    if (project === null) {
      store.setState(() => EMPTY_STATE);
      return;
    }
    const listed = await gateway.listTemplates(project);
    if (listed.ok) {
      store.setState(() => ({
        templates: listed.value.templates,
        issues: listed.value.issues,
      }));
    } else {
      report(MANAGE_LABEL, null, listed);
    }
  }

  // The list follows the Project that is open.
  let shownProject: ProjectId | null = null;
  applicationStore.subscribe(() => {
    const current = projectId();
    if (current === shownProject) return;
    shownProject = current;
    void refresh();
  });

  // ---- saving ----

  // A sheet's blocks as a template holds them, and the images its texts show.
  async function capturedSheet(
    documentId: DocumentId,
    sheetId: SheetId,
    only?: BlockId,
  ): Promise<
    OperationResult<{
      readonly sheet: TemplateSheetContent;
      readonly assets: readonly ContentPath[];
    }>
  > {
    const loaded = await canvasActions.loadSheetContents({
      documentId,
      sheetId,
    });
    if (!loaded.ok) return loaded;
    const data = applicationStore.getState().documents.get(documentId);
    const sheet = data?.sheets.get(sheetId);
    if (data === undefined || sheet === undefined) {
      return operationErr("entityNotFound", `sheet ${sheetId} is not open`);
    }
    const blocks: TemplateBlockContent[] = [];
    const assets = new Set<ContentPath>();
    const chosen = sheet.blocks.filter(
      (block) => only === undefined || block.blockId === only,
    );
    for (const block of chosen) {
      const captured = capturedBlock(block, data.contents.get(block.blockId));
      if (captured === null) {
        return operationErr(
          "notWritable",
          `the text of block ${block.blockId} is not loaded`,
        );
      }
      blocks.push(captured);
      if (block.blockType === BLOCK_TYPE_DEFINITIONS.markdown.identifier) {
        for (const asset of markdownImageAssets(
          captured.text ?? "",
          block.contentPath,
        )) {
          assets.add(asset);
        }
      }
    }
    return operationOk({
      sheet: { sheetName: sheet.name, blocks },
      assets: [...assets],
    });
  }

  function capturedBlock(
    block: Block,
    text: string | undefined,
  ): TemplateBlockContent | null {
    const common = {
      blockType: block.blockType,
      x: block.position.x,
      y: block.position.y,
      width: block.size.width,
      height: block.size.height,
      ...(block.caption === undefined ? {} : { caption: block.caption }),
      ...(block.captionPosition === undefined
        ? {}
        : { captionPosition: block.captionPosition }),
    };
    if (block.blockType === "image") {
      return { ...common, asset: block.contentPath };
    }
    return text === undefined ? null : { ...common, text };
  }

  async function save(
    documentId: DocumentId,
    scope: TemplateScope,
    kind: TemplateKind,
    content: TemplateContent,
  ): Promise<OperationResult<void>> {
    const project = projectId();
    if (project === null) return report(SAVE_LABEL, content.name, noProject());
    const saved = report(
      SAVE_LABEL,
      content.name,
      await gateway.saveTemplate(project, documentId, scope, kind, content),
    );
    if (!saved.ok) return saved;
    await refresh();
    return operationOk(undefined);
  }

  // ---- making things from a template ----

  async function readTemplate(
    template: TemplateSummary,
  ): Promise<OperationResult<TemplateContent>> {
    const project = projectId();
    if (project === null) return noProject();
    return gateway.readTemplate(project, refOf(template));
  }

  // The template's images in the Document, by their name in the template. An image that
  // cannot be imported is reported and its blocks are left out.
  async function importAssets(
    importAsset: AssetImporter,
    documentId: DocumentId,
    names: readonly string[],
  ): Promise<ReadonlyMap<string, ContentPath>> {
    const imported = new Map<string, ContentPath>();
    for (const name of new Set(names)) {
      const result = report(
        USE_LABEL,
        name,
        await importAsset(documentId, name),
      );
      if (result.ok) imported.set(name, result.value.contentPath);
    }
    return imported;
  }

  // Imports from a template the app lists.
  function fromTemplate(template: TemplateSummary): AssetImporter {
    return (documentId, name) => {
      const project = projectId();
      return project === null
        ? Promise.resolve(noProject())
        : gateway.importTemplateAsset(
            project,
            documentId,
            refOf(template),
            name,
          );
    };
  }

  function blockInputs(
    blocks: readonly TemplateBlockContent[],
    assets: ReadonlyMap<string, ContentPath>,
  ): TemplateBlockInput[] {
    // An image renamed on import (a file of that name was there) is renamed in the texts
    // that show it too.
    const renamed = [...assets].filter(
      ([name, contentPath]) => fileName(contentPath) !== name,
    );
    const rewrite = (text: string) =>
      renamed.reduce(
        (result, [name, contentPath]) =>
          result.replaceAll(`${ASSET_PREFIX}${name}`, contentPath),
        text,
      );
    return blocks.flatMap((block): TemplateBlockInput[] => {
      const blockType = parseBlockType(block.blockType);
      if (!blockType.ok) return [];
      const contentPath =
        block.asset === undefined ? undefined : assets.get(block.asset);
      if (block.asset !== undefined && contentPath === undefined) return [];
      return [
        {
          blockType: blockType.value,
          position: { x: block.x, y: block.y },
          size: { width: block.width, height: block.height },
          ...(block.text === undefined ? {} : { text: rewrite(block.text) }),
          ...(contentPath === undefined ? {} : { contentPath }),
          ...(block.caption === undefined ? {} : { caption: block.caption }),
          ...(block.captionPosition === undefined
            ? {}
            : { captionPosition: block.captionPosition }),
        },
      ];
    });
  }

  // The images the blocks show and the ones their texts name.
  function assetNamesOf(
    blocks: readonly TemplateBlockContent[],
    textAssets: readonly string[],
  ): string[] {
    return [
      ...blocks.flatMap((block) =>
        block.asset === undefined ? [] : [block.asset],
      ),
      ...textAssets,
    ];
  }

  async function placeBlocks(
    importAsset: AssetImporter,
    documentId: DocumentId,
    sheetId: SheetId,
    blocks: readonly TemplateBlockContent[],
    textAssets: readonly string[],
    place?: PlaceOnCanvas,
  ): Promise<OperationResult<void>> {
    const assets = await importAssets(
      importAsset,
      documentId,
      assetNamesOf(blocks, textAssets),
    );
    return placeImportedBlocks(documentId, sheetId, blocks, assets, place);
  }

  async function placeImportedBlocks(
    documentId: DocumentId,
    sheetId: SheetId,
    blocks: readonly TemplateBlockContent[],
    assets: ReadonlyMap<string, ContentPath>,
    place?: PlaceOnCanvas,
  ): Promise<OperationResult<void>> {
    const placed = await canvasActions.addTemplateBlocks({
      documentId,
      sheetId,
      blocks: blockInputs(blocks, assets),
      ...(place === undefined ? {} : { place }),
      // Added to a sheet that has other blocks (a block template): selected. The content
      // of a sheet just made is not.
      select: place !== undefined,
    });
    return placed.ok ? operationOk(undefined) : placed;
  }

  function activeSheetOf(documentId: DocumentId): SheetId | undefined {
    return uiStateStore.getState().activeSheetIdByDocument.get(documentId);
  }

  async function newSheetWithBlocks(
    importAsset: AssetImporter,
    documentId: DocumentId,
    sheet: TemplateSheetContent,
    textAssets: readonly string[],
  ): Promise<OperationResult<void>> {
    const created = await actions.createSheet(documentId, sheet.sheetName);
    if (!created.ok) return created;
    // createSheet shows the new sheet: it is the active one now.
    const sheetId = activeSheetOf(documentId);
    if (sheetId === undefined) {
      return operationErr("entityNotFound", "the new sheet is not shown");
    }
    return placeBlocks(
      importAsset,
      documentId,
      sheetId,
      sheet.blocks,
      textAssets,
    );
  }

  // Fills a new Document with the template's sheets. Its images are imported once for the
  // whole Document (every sheet shares them), then the Document is saved complete.
  async function fillNewDocument(
    importAsset: AssetImporter,
    documentId: DocumentId,
    sheets: readonly TemplateSheetContent[],
    textAssets: readonly string[],
  ): Promise<OperationResult<void>> {
    const assets = await importAssets(
      importAsset,
      documentId,
      assetNamesOf(
        sheets.flatMap((sheet) => sheet.blocks),
        textAssets,
      ),
    );
    for (const sheet of sheets) {
      const created = await actions.createSheet(documentId, sheet.sheetName);
      if (!created.ok) return created;
      // createSheet shows the new sheet: it is the active one now.
      const sheetId = activeSheetOf(documentId);
      if (sheetId === undefined) {
        return operationErr("entityNotFound", "the new sheet is not shown");
      }
      const placed = await placeImportedBlocks(
        documentId,
        sheetId,
        sheet.blocks,
        assets,
      );
      if (!placed.ok) return placed;
    }
    return actions.completeCreatedDocument(documentId);
  }

  // A whole open Document as a template of `kind` holds it: a block template takes the
  // first block of the first sheet, a sheet template the first sheet.
  async function capturedDocument(
    documentId: DocumentId,
    kind: TemplateKind,
    name: string,
  ): Promise<OperationResult<TemplateContent>> {
    const application = applicationStore.getState();
    const data = application.documents.get(documentId);
    if (data === undefined) {
      return operationErr(
        "entityNotFound",
        `document ${documentId} is not open`,
      );
    }
    const sheetIds = (
      application.documentDetails.get(documentId)?.sheetEntries ?? []
    )
      .filter((entry) => entry.state === LOADED)
      .map((entry) => entry.sheetId);
    const sheets: TemplateSheetContent[] = [];
    const assets: ContentPath[] = [];
    for (const sheetId of kind === "document"
      ? sheetIds
      : sheetIds.slice(0, 1)) {
      const captured = await capturedSheet(documentId, sheetId);
      if (!captured.ok) return captured;
      sheets.push(captured.value.sheet);
      assets.push(...captured.value.assets);
    }
    const unique = [...new Set(assets)];
    if (kind === "markdown" || kind === "mermaid") {
      const block = sheets[0]?.blocks.find(
        (candidate) => candidate.blockType === kind,
      );
      if (block === undefined) {
        return operationErr(
          "invalidTemplate",
          `the sheet holds no ${kind} block`,
        );
      }
      return operationOk({ name, block, sheets: [], assets: unique });
    }
    if (kind === "sheet") {
      return operationOk({ name, sheets: sheets.slice(0, 1), assets: unique });
    }
    return operationOk({
      name,
      sheets,
      documentName: data.document.name,
      assets: unique,
    });
  }

  return {
    store,
    refresh,

    async saveBlock(documentId, sheetId, blockId, scope, name) {
      const captured = report(
        SAVE_LABEL,
        name,
        await capturedSheet(documentId, sheetId, blockId),
      );
      if (!captured.ok) return captured;
      const [block] = captured.value.sheet.blocks;
      if (block === undefined || block.text === undefined) {
        return report(
          SAVE_LABEL,
          name,
          operationErr(
            "invalidTemplate",
            "only a text block can be a template",
          ),
        );
      }
      const kind: TemplateKind =
        block.blockType === BLOCK_TYPE_DEFINITIONS.mermaid.identifier
          ? "mermaid"
          : "markdown";
      return save(documentId, scope, kind, {
        name,
        block: { ...block, x: 0, y: 0 },
        sheets: [],
        assets: captured.value.assets,
      });
    },

    async saveSheet(documentId, sheetId, scope, name) {
      const captured = report(
        SAVE_LABEL,
        name,
        await capturedSheet(documentId, sheetId),
      );
      if (!captured.ok) return captured;
      return save(documentId, scope, "sheet", {
        name,
        sheets: [captured.value.sheet],
        assets: captured.value.assets,
      });
    },

    async saveDocument(documentId, scope, name) {
      const captured = report(
        SAVE_LABEL,
        name,
        await capturedDocument(documentId, "document", name),
      );
      if (!captured.ok) return captured;
      return save(documentId, scope, "document", captured.value);
    },

    capture: capturedDocument,

    async fillForEditing(info, importAsset) {
      // Filled once: a window opened again on the same Project keeps what is there.
      if ((applicationStore.getState().project?.documents.length ?? 0) > 0) {
        return operationOk(undefined);
      }
      const { content } = info;
      const created = await actions.createDocument(
        content.documentName ?? content.name,
        null,
      );
      if (!created.ok) return created;
      const documentId = uiStateStore.getState().activeDocumentId;
      if (documentId === null) {
        return operationErr("entityNotFound", "the new document is not shown");
      }
      const sheets: readonly TemplateSheetContent[] =
        content.block === undefined
          ? content.sheets
          : [{ sheetName: content.name, blocks: [content.block] }];
      return fillNewDocument(importAsset, documentId, sheets, content.assets);
    },

    async addBlocks(template, documentId, sheetId, place) {
      const content = report(
        USE_LABEL,
        template.name,
        await readTemplate(template),
      );
      if (!content.ok) return content;
      const block = content.value.block;
      if (block === undefined) {
        return report(
          USE_LABEL,
          template.name,
          operationErr("invalidTemplate", "the template holds no block"),
        );
      }
      return placeBlocks(
        fromTemplate(template),
        documentId,
        sheetId,
        [block],
        content.value.assets,
        place,
      );
    },

    async createSheet(template, documentId, name) {
      const content = report(
        USE_LABEL,
        template.name,
        await readTemplate(template),
      );
      if (!content.ok) return content;
      const [sheet] = content.value.sheets;
      if (sheet === undefined) {
        return report(
          USE_LABEL,
          template.name,
          operationErr("invalidTemplate", "the template holds no sheet"),
        );
      }
      return newSheetWithBlocks(
        fromTemplate(template),
        documentId,
        name === undefined ? sheet : { ...sheet, sheetName: name },
        content.value.assets,
      );
    },

    async createDocument(template, name, parentFolderId) {
      const content = report(
        USE_LABEL,
        template.name,
        await readTemplate(template),
      );
      if (!content.ok) return content;
      const created = await actions.createDocument(name, parentFolderId);
      if (!created.ok) return created;
      // createDocument opens the new Document and shows it.
      const documentId = uiStateStore.getState().activeDocumentId;
      if (documentId === null) {
        return operationErr("entityNotFound", "the new document is not shown");
      }
      return fillNewDocument(
        fromTemplate(template),
        documentId,
        content.value.sheets,
        content.value.assets,
      );
    },

    async sheetNameOf(template) {
      const content = await readTemplate(template);
      return content.ok
        ? (content.value.sheets[0]?.sheetName ?? template.name)
        : template.name;
    },

    async documentNameOf(template) {
      const content = await readTemplate(template);
      return content.ok
        ? (content.value.documentName ?? content.value.name)
        : template.name;
    },

    async openEditor(template) {
      const project = projectId();
      if (project === null) return report(MANAGE_LABEL, null, noProject());
      return report(
        MANAGE_LABEL,
        null,
        await gateway.openTemplateEditor(project, template),
      );
    },

    async rename(template, name) {
      const project = projectId();
      if (project === null) return report(MANAGE_LABEL, name, noProject());
      const renamed = report(
        MANAGE_LABEL,
        name,
        await gateway.renameTemplate(project, template, name),
      );
      if (renamed.ok) await refresh();
      return renamed;
    },

    async remove(template) {
      const project = projectId();
      if (project === null) return report(MANAGE_LABEL, null, noProject());
      const removed = report(
        MANAGE_LABEL,
        null,
        await gateway.deleteTemplate(project, template),
      );
      if (removed.ok) await refresh();
      return removed;
    },

    async move(template, to) {
      const project = projectId();
      if (project === null) return report(MANAGE_LABEL, null, noProject());
      const moved = report(
        MANAGE_LABEL,
        null,
        await gateway.moveTemplate(project, template, to),
      );
      if (moved.ok) await refresh();
      return moved;
    },
  };
}
