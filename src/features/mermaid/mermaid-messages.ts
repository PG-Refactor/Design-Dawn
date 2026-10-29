// User-visible strings of the Mermaid block, one catalog per display language.

import type { DisplayLanguage } from "../../config/language-config";
import type { Widen } from "../../shared/i18n/catalog-types";

const MERMAID_MESSAGES_JA = {
  loading: "読み込み中…",
  loadFailed: "ソースを読み込めませんでした",
  loadFailedHint: "選択、移動、サイズ変更、削除はできます。編集はできません。",
  errorKind: "種別",
  errorDetails: "詳細",
  done: "完了",
  empty: "空の図です",
  rendering: "描画中…",
  renderFailed: "図を描画できません",
  editHint: "ダブルクリックで編集できます",
  diagramAlt: (shortId: string): string => `Mermaid図（${shortId}）`,
  previewLabel: (shortId: string): string => `Mermaidプレビュー（${shortId}）`,
  sourceLabel: (shortId: string): string => `Mermaidソース（${shortId}）`,
  editorLabel: (shortId: string): string => `Mermaid編集（${shortId}）`,
  gui: {
    modeGroup: "編集モード",
    modeGui: "GUI",
    modeSource: "ソース",
    panelLabel: (shortId: string): string => `図のGUI編集（${shortId}）`,
    notEditableTitle: "この図はGUIで編集できません",
    notEditableReasonLabel: "理由",
    notEditableDetailLabel: "詳細",
    switchToSource: "ソースに切り替える",
    notEditableReasons: {
      empty: "ソースが空です。ソースで図を書き始めてください。",
      unknownType: "図の種類を判別できません。",
      invalidFrontMatter: "先頭のfront matter（---）が閉じられていません。",
      noEditorForType: "この種類の図にはまだGUI編集がありません。",
      notPie: "円グラフとして読み取れません。",
      unsupportedLines: "GUIが理解できない行があります。",
      duplicateLabels:
        "同じラベルのスライスが複数あります（Mermaidは最初の1つだけを使います）。",
      loneCarriageReturn: "改行コードに単独のCRが含まれています。",
      markupRewrite:
        "Mermaidが読み込み前に書き換えるマークアップ風の文字列があります。",
      styleLikeText: "Mermaidが書き換えるスタイル定義風の文字列があります。",
      inlineDirective: "%%{ ... }%% のディレクティブがあります。",
    },
    notEditableFallback: "GUIで安全に編集できないソースです。",
    titleLabel: "タイトル",
    titleApply: "タイトルを設定",
    titleRemove: "タイトルを削除",
    noTitleToRemove: "タイトルはまだありません",
    slicesHeading: "スライス",
    listLabel: (shortId: string): string => `スライス一覧（${shortId}）`,
    emptySlices: "スライスがありません。下から追加してください。",
    sliceOption: (label: string, value: string): string => `${label}：${value}`,
    selectedHeading: "選択中のスライス",
    noSelection: "一覧からスライスを選ぶと編集できます。",
    labelField: "ラベル",
    valueField: "値",
    apply: "適用",
    deleteSlice: "削除",
    moveUp: "上へ",
    moveDown: "下へ",
    alreadyFirst: "先頭のスライスです",
    alreadyLast: "末尾のスライスです",
    addHeading: "スライスを追加",
    newLabelField: "新しいラベル",
    newValueField: "新しい値",
    addSlice: "追加",
    labelRequired: "ラベルを入力してください。",
    revert: "入力を元に戻す",
    itemChanged:
      "選択したスライスがソース側で変わったため、入力は適用していません。入力はそのまま残してあります。もう一度適用するか、「入力を元に戻す」で破棄してください。",
    itemGone:
      "編集していたスライスが見つかりません。入力した内容は未適用のまま残っています。",
    addInputPending:
      "追加欄に未確定の入力があります。追加するか、入力を消してください",
    unappliedHeading:
      "図のGUIを離れたため、次の入力は適用されていません（ソースは変わっていません）。必要なら入力し直してください。",
    unappliedReasonLabel: "適用されなかった理由",
    unappliedAddReason:
      "追加欄の入力は、Enterか「追加」ボタンを押したときだけ追加します。",
    busy: "適用中…",
    busyReason: "適用中のため操作できません",
    refusalHeading: "変更は適用されませんでした。ソースはそのままです。",
    refusalDetailLabel: "Mermaidのメッセージ",
    refusalFallback: "予期しないエラーのため、変更を適用できませんでした。",
    refusalKinds: {
      diagramNotEditable: "現在のソースはGUIで編集できません。",
      diagramMeaningMismatch:
        "変更によって意図しない内容も変わってしまうため、適用しませんでした。",
      diagramRenderRejected: "変更後の図をMermaidが描画できませんでした。",
      staleContent:
        "直前にブロックの内容が変わったため適用しませんでした。表示を最新の内容に更新しました。もう一度操作してください。",
      invalidDiagramOperation: "この操作は許可されていません。",
    },
    refusalReasons: {
      controlCharacter: "改行・タブなどの制御文字は使えません。",
      backslash: "バックスラッシュ（\\）は使えません。",
      directive: "%%{ を含む文字列は使えません。",
      entityLikeText: "#35; のような文字列（HTMLエンティティ風）は使えません。",
      markup: '<タグ 属性="値"> のようなマークアップ風の文字列は使えません。',
      styleLikeText: "スタイル定義のように見える文字列は使えません。",
      negativeValue: "値に負の数は使えません。",
      invalidValue:
        "値は数字と小数点だけで入力してください（符号・指数・先頭の小数点は不可）。",
      valueOutOfRange: "値が大きすぎます。",
      emptyTitle:
        "タイトルが空です。削除する場合は「タイトルを削除」を使ってください。",
      titleNotNormalized:
        "タイトルの前後の空白や連続する空白は使えません（Mermaidが整形するため）。",
      comment: "%% を含む文字列はコメントとして扱われるため使えません。",
      duplicateLabel: "同じラベルのスライスが既にあります。",
      targetNotFound: "対象のスライスが見つかりません。",
      targetMismatch:
        "対象のスライスがソースの内容と一致しません。表示を更新しました。",
      invalidIndex: "移動先の位置が正しくありません。",
      singleQuotedLabel:
        "シングルクォートで書かれたラベルはGUIから変更できません。ソースで編集してください。",
      multipleTitles:
        "title が複数あります。ソースで1つにしてから操作してください。",
      noTitle: "削除するタイトルがありません。",
    },
  },
} as const;

export type MermaidMessages = Widen<typeof MERMAID_MESSAGES_JA>;

const MERMAID_MESSAGES_EN: MermaidMessages = {
  loading: "Loading…",
  loadFailed: "The source could not be loaded",
  loadFailedHint:
    "You can still select, move, resize and delete the block, but not edit it.",
  errorKind: "Kind",
  errorDetails: "Details",
  done: "Done",
  empty: "The diagram is empty",
  rendering: "Rendering…",
  renderFailed: "The diagram cannot be drawn",
  editHint: "Double-click to edit",
  diagramAlt: (shortId) => `Mermaid diagram (${shortId})`,
  previewLabel: (shortId) => `Mermaid preview (${shortId})`,
  sourceLabel: (shortId) => `Mermaid source (${shortId})`,
  editorLabel: (shortId) => `Mermaid editor (${shortId})`,
  gui: {
    modeGroup: "Editor mode",
    modeGui: "GUI",
    modeSource: "Source",
    panelLabel: (shortId) => `Diagram GUI editor (${shortId})`,
    notEditableTitle: "This diagram cannot be edited with the GUI",
    notEditableReasonLabel: "Reason",
    notEditableDetailLabel: "Details",
    switchToSource: "Switch to Source",
    notEditableReasons: {
      empty: "The source is empty. Start the diagram in Source.",
      unknownType: "The diagram type cannot be determined.",
      invalidFrontMatter: "The front matter (---) at the top is not closed.",
      noEditorForType: "This diagram type has no GUI editor yet.",
      notPie: "It cannot be read as a pie chart.",
      unsupportedLines: "Some lines are not understood by the GUI.",
      duplicateLabels:
        "Several slices share a label (Mermaid keeps only the first).",
      loneCarriageReturn: "The text contains a lone CR line ending.",
      markupRewrite:
        "The text contains markup-like text that Mermaid rewrites before reading.",
      styleLikeText:
        "The text contains style-definition-like text that Mermaid rewrites.",
      inlineDirective: "The text contains a %%{ ... }%% directive.",
    },
    notEditableFallback: "The source cannot be edited safely with the GUI.",
    titleLabel: "Title",
    titleApply: "Set title",
    titleRemove: "Remove title",
    noTitleToRemove: "There is no title yet",
    slicesHeading: "Slices",
    listLabel: (shortId) => `Slice list (${shortId})`,
    emptySlices: "There are no slices. Add one below.",
    sliceOption: (label, value) => `${label}: ${value}`,
    selectedHeading: "Selected slice",
    noSelection: "Select a slice in the list to edit it.",
    labelField: "Label",
    valueField: "Value",
    apply: "Apply",
    deleteSlice: "Delete",
    moveUp: "Move up",
    moveDown: "Move down",
    alreadyFirst: "This is the first slice",
    alreadyLast: "This is the last slice",
    addHeading: "Add a slice",
    newLabelField: "New label",
    newValueField: "New value",
    addSlice: "Add",
    labelRequired: "Enter a label.",
    revert: "Revert input",
    itemChanged:
      'The selected slice changed in the source, so your input was not applied. It is kept as it is: apply it again, or discard it with "Revert input".',
    itemGone:
      "The slice you were editing cannot be found. What you typed is kept and not applied.",
    addInputPending:
      "The add form has input that is not added yet. Add it, or clear the input.",
    unappliedHeading:
      "You left the diagram GUI, so the input below was NOT applied (the source is unchanged). Enter it again if you still need it.",
    unappliedReasonLabel: "Why it was not applied",
    unappliedAddReason:
      'Input in the add form is added only with Enter or the "Add" button.',
    busy: "Applying…",
    busyReason: "Unavailable while a change is being applied",
    refusalHeading: "The change was not applied. The source is unchanged.",
    refusalDetailLabel: "Mermaid message",
    refusalFallback:
      "The change could not be applied because of an unexpected error.",
    refusalKinds: {
      diagramNotEditable: "The current source cannot be edited with the GUI.",
      diagramMeaningMismatch:
        "The change would also alter something else, so it was not applied.",
      diagramRenderRejected:
        "Mermaid cannot draw the diagram after this change.",
      staleContent:
        "The block changed just before, so nothing was applied. The view now shows the latest content. Try again.",
      invalidDiagramOperation: "This operation is not allowed.",
    },
    refusalReasons: {
      controlCharacter:
        "Line breaks, tabs and other control characters are not allowed.",
      backslash: "A backslash (\\) is not allowed.",
      directive: "Text containing %%{ is not allowed.",
      entityLikeText: "Text such as #35; (entity-like) is not allowed.",
      markup: 'Markup-like text such as <tag attr="value"> is not allowed.',
      styleLikeText: "Text that looks like a style definition is not allowed.",
      negativeValue: "A value must not be negative.",
      invalidValue:
        "Use digits with an optional fraction (no sign, exponent or leading dot).",
      valueOutOfRange: "The value is too large.",
      emptyTitle: 'The title is empty. Use "Remove title" to delete it.',
      titleNotNormalized:
        "A title cannot start or end with blanks or hold repeated blanks (Mermaid would change it).",
      comment: "Text containing %% is read as a comment and is not allowed.",
      duplicateLabel: "A slice with this label already exists.",
      targetNotFound: "The slice was not found.",
      targetMismatch:
        "The slice no longer matches the source. The view was refreshed.",
      invalidIndex: "The target position is not valid.",
      singleQuotedLabel:
        "A single-quoted label cannot be changed from the GUI. Edit it in Source.",
      multipleTitles:
        "There is more than one title. Make it one in Source first.",
      noTitle: "There is no title to remove.",
    },
  },
};

export const MERMAID_MESSAGES: Readonly<
  Record<DisplayLanguage, MermaidMessages>
> = { ja: MERMAID_MESSAGES_JA, en: MERMAID_MESSAGES_EN };
