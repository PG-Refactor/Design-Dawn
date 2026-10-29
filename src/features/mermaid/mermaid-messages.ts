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
      notFlowchart: "フローチャートとして読み取れません。",
      sourceTooLong: "ソースが長すぎます（50000文字まで）。",
      structureIssue:
        "front matter またはディレクティブの書き方がGUIで扱える形ではありません。",
      unsupportedStatements: "GUIが理解できない文があります。",
      tooManyEdges: "エッジが多すぎます（500本まで）。",
      duplicateEdgeId: "同じIDのエッジが複数あります。",
      nodeSubgraphIdConflict:
        "ノードとサブグラフが同じIDです（サブグラフどうしをエッジでつなぐ書き方を含みます）。",
      nodeEdgeIdConflict: "ノードとエッジが同じIDです。",
      undrawableShape: "Mermaidが描画できない形（ellipse）のノードがあります。",
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
      targetNotFound: "対象の要素が見つかりません。",
      targetMismatch:
        "対象の要素がソースの内容と一致しません。表示を更新しました。",
      invalidIndex: "移動先の位置が正しくありません。",
      singleQuotedLabel:
        "シングルクォートで書かれたラベルはGUIから変更できません。ソースで編集してください。",
      multipleTitles:
        "title が複数あります。ソースで1つにしてから操作してください。",
      noTitle: "削除するタイトルがありません。",
      doubleQuote: 'ラベルにダブルクォート（"）は使えません。',
      backtick: "ラベルにバッククォート（`）は使えません。",
      emptyLabel: "ラベルを入力してください。",
      labelNotTrimmed:
        "ラベルの前後の空白は使えません（Mermaidが取り除くため）。",
      sharedLink:
        "このエッジは A & B のような一括指定の一部のため、GUIでは変更できません。ソースで編集してください。",
      sharedEndpoint:
        "連鎖（A --> B --> C）の途中のノードは隣のエッジと共有されるため、つなぎ替えできません。",
      atBlockNode:
        "@{ ... } で定義されたノードはGUIから変更できません。ソースで編集してください。",
      multipleDefinitions:
        "このノードはラベルが複数回書かれているため、GUIから変更できません。ソースで編集してください。",
      markdownLabel:
        "Markdownラベルは、GUIから変更できません。ソースで編集してください。",
      nodeNotWritten:
        "このノードは style 文だけで作られているため、GUIから変更できません。",
      invalidShape: "この形は書き込めません。",
      invalidDirection: "この向きは書き込めません。",
      invalidLink: "この種類と線の組み合わせは書けません。",
      invalidLinkLength: "線の長さは1〜10の整数で指定してください。",
      invisibleLinkLabel: "見えない線にはラベルを付けられません。",
      tooManyEdges: "エッジが多すぎるため、追加できません（500本まで）。",
      invalidId: "IDは英字で始め、英数字とアンダースコアだけで書いてください。",
      reservedId: "Mermaidの予約語はIDに使えません。",
      ambiguousId: "x と o だけのIDはリンクの一部と読まれるため使えません。",
      duplicateId: "同じIDがすでに図の中で使われています。",
      linkStyleSharesLine:
        "消すべき linkStyle が他の文と同じ行にあるため、削除できません。",
      attributeLineShared:
        "消すべきエッジ属性の行が他の文と同じ行にあるため、削除できません。",
      notPlainlyDeletable:
        "他の部分を変えずにこのエッジだけを消す書き方が見つからないため、削除しませんでした。ソースで編集してください。",
      notPlainlyReconnectable:
        "他の部分を変えずにつなぎ替える書き方が見つからないため、適用しませんでした。ソースで編集してください。",
      planUnverified:
        "変更後の内容が意図どおりに読み取れなかったため、適用しませんでした。",
    },
    flowchart: {
      directionLabel: "向き",
      directions: {
        TB: "上から下（TD）",
        BT: "下から上（BT）",
        LR: "左から右（LR）",
        RL: "右から左（RL）",
      },
      nodesHeading: "ノード",
      edgesHeading: "エッジ",
      subgraphsHeading: "サブグラフ（読み取り専用）",
      nodeListLabel: (shortId: string): string => `ノード一覧（${shortId}）`,
      edgeListLabel: (shortId: string): string => `エッジ一覧（${shortId}）`,
      subgraphListLabel: (shortId: string): string =>
        `サブグラフ一覧（${shortId}）`,
      emptyNodes: "ノードがありません。下から追加してください。",
      emptyEdges: "エッジがありません。",
      emptySubgraphs: "サブグラフはありません。",
      nodeOption: (label: string, id: string): string => `${label}（${id}）`,
      edgeOption: (start: string, end: string, label: string): string =>
        label === "" ? `${start} → ${end}` : `${start} → ${end}（${label}）`,
      subgraphOption: (title: string, id: string, members: string): string =>
        `${title}（${id}）：${members}`,
      noMembers: "メンバーなし",
      memberSeparator: "、",
      noSelection: "一覧からノードまたはエッジを選ぶと編集できます。",
      selectedNodeHeading: "選択中のノード",
      selectedEdgeHeading: "選択中のエッジ",
      nodeLabelField: "ノードのラベル",
      shapeField: "形",
      shapes: {
        doublecircle: "二重円",
        circle: "円",
        stadium: "スタジアム",
        round: "角丸",
        subroutine: "サブルーチン",
        cylinder: "円柱",
        lean_right: "平行四辺形（右）",
        trapezoid: "台形",
        lean_left: "平行四辺形（左）",
        inv_trapezoid: "逆台形",
        square: "四角",
        hexagon: "六角形",
        diamond: "ひし形",
        odd: "旗",
      },
      edgeLabelField: "エッジのラベル（空にすると削除）",
      arrowField: "矢印",
      arrows: {
        arrow_open: "なし（線のみ）",
        arrow_point: "矢印",
        arrow_circle: "丸",
        arrow_cross: "バツ",
        double_arrow_point: "両側の矢印",
        double_arrow_circle: "両側の丸",
        double_arrow_cross: "両側のバツ",
      },
      strokeField: "線",
      strokes: {
        normal: "実線",
        thick: "太線",
        dotted: "点線",
        invisible: "見えない線",
      },
      lengthField: "線の長さ",
      startField: "始点",
      endField: "終点",
      deleteEdge: "エッジを削除",
      edgeEndShared: "連鎖の途中のノードはつなぎ替えできません",
      restrictedNode: "このノードはGUIから変更できません",
      restrictedEdge: "このエッジはGUIから変更できません",
      restrictedLabel: "このラベルはGUIから変更できません",
      addNodeHeading: "ノードを追加",
      newNodeLabel: "新しいノードのラベル",
      newNodeId: "ID（省略すると自動）",
      newNodeShape: "新しいノードの形",
      addNode: "ノードを追加",
      addEdgeHeading: "エッジを追加",
      newEdgeStart: "新しいエッジの始点",
      newEdgeEnd: "新しいエッジの終点",
      newEdgeLabel: "ラベル（省略可）",
      choose: "選んでください",
      addEdge: "エッジを追加",
      endpointsRequired: "始点と終点のノードを選んでください。",
      noNodesForEdge: "エッジをつなぐノードがまだありません。",
      itemChanged:
        "選択した要素がソース側で変わったため、入力は適用していません。入力はそのまま残してあります。もう一度適用するか、「入力を元に戻す」で破棄してください。",
      itemGone:
        "編集していた要素が見つかりません。入力した内容は未適用のまま残っています。",
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
      notFlowchart: "It cannot be read as a flowchart.",
      sourceTooLong: "The source is too long (50000 characters at most).",
      structureIssue:
        "The front matter or a directive is not in a form the GUI can handle.",
      unsupportedStatements: "Some statements are not understood by the GUI.",
      tooManyEdges: "There are too many edges (500 at most).",
      duplicateEdgeId: "Several edges share an id.",
      nodeSubgraphIdConflict:
        "A node and a subgraph share an id (this includes edges between subgraphs).",
      nodeEdgeIdConflict: "A node and an edge share an id.",
      undrawableShape: "A node has a shape Mermaid cannot draw (ellipse).",
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
      targetNotFound: "The element was not found.",
      targetMismatch:
        "The element no longer matches the source. The view was refreshed.",
      invalidIndex: "The target position is not valid.",
      singleQuotedLabel:
        "A single-quoted label cannot be changed from the GUI. Edit it in Source.",
      multipleTitles:
        "There is more than one title. Make it one in Source first.",
      noTitle: "There is no title to remove.",
      doubleQuote: 'A double quote (") cannot be used in a label.',
      backtick: "A backtick (`) cannot be used in a label.",
      emptyLabel: "Enter a label.",
      labelNotTrimmed:
        "A label cannot start or end with blanks (Mermaid removes them).",
      sharedLink:
        "This edge is part of an A & B list and cannot be changed from the GUI. Edit it in Source.",
      sharedEndpoint:
        "A node in the middle of a chain (A --> B --> C) is shared with the next edge, so it cannot be reconnected.",
      atBlockNode:
        "A node defined with @{ ... } cannot be changed from the GUI. Edit it in Source.",
      multipleDefinitions:
        "This node is given a label more than once, so it cannot be changed from the GUI. Edit it in Source.",
      markdownLabel:
        "A markdown label cannot be changed from the GUI. Edit it in Source.",
      nodeNotWritten:
        "This node exists only through a style statement, so it cannot be changed from the GUI.",
      invalidShape: "This shape cannot be written.",
      invalidDirection: "This direction cannot be written.",
      invalidLink: "This combination of arrow and line cannot be written.",
      invalidLinkLength: "The line length must be a whole number from 1 to 10.",
      invisibleLinkLabel: "An invisible line cannot have a label.",
      tooManyEdges: "There are too many edges to add another (500 at most).",
      invalidId:
        "An id starts with a letter and holds only letters, digits and underscores.",
      reservedId: "A Mermaid keyword cannot be used as an id.",
      ambiguousId:
        "An id of just x or o would be read as part of a link and cannot be used.",
      duplicateId: "This id is already used in the diagram.",
      linkStyleSharesLine:
        "A linkStyle that must go shares its line with another statement, so the edge cannot be deleted.",
      attributeLineShared:
        "The edge attribute line that must go shares its line with another statement, so the edge cannot be deleted.",
      notPlainlyDeletable:
        "No way to remove only this edge without changing anything else was found, so nothing was deleted. Edit it in Source.",
      notPlainlyReconnectable:
        "No way to reconnect without changing anything else was found, so nothing was applied. Edit it in Source.",
      planUnverified:
        "The result did not read back as intended, so nothing was applied.",
    },
    flowchart: {
      directionLabel: "Direction",
      directions: {
        TB: "Top to bottom (TD)",
        BT: "Bottom to top (BT)",
        LR: "Left to right (LR)",
        RL: "Right to left (RL)",
      },
      nodesHeading: "Nodes",
      edgesHeading: "Edges",
      subgraphsHeading: "Subgraphs (read-only)",
      nodeListLabel: (shortId) => `Node list (${shortId})`,
      edgeListLabel: (shortId) => `Edge list (${shortId})`,
      subgraphListLabel: (shortId) => `Subgraph list (${shortId})`,
      emptyNodes: "There are no nodes. Add one below.",
      emptyEdges: "There are no edges.",
      emptySubgraphs: "There are no subgraphs.",
      nodeOption: (label, id) => `${label} (${id})`,
      edgeOption: (start, end, label) =>
        label === "" ? `${start} → ${end}` : `${start} → ${end} (${label})`,
      subgraphOption: (title, id, members) => `${title} (${id}): ${members}`,
      noMembers: "no members",
      memberSeparator: ", ",
      noSelection: "Select a node or an edge in a list to edit it.",
      selectedNodeHeading: "Selected node",
      selectedEdgeHeading: "Selected edge",
      nodeLabelField: "Node label",
      shapeField: "Shape",
      shapes: {
        doublecircle: "Double circle",
        circle: "Circle",
        stadium: "Stadium",
        round: "Rounded",
        subroutine: "Subroutine",
        cylinder: "Cylinder",
        lean_right: "Parallelogram (right)",
        trapezoid: "Trapezoid",
        lean_left: "Parallelogram (left)",
        inv_trapezoid: "Inverted trapezoid",
        square: "Rectangle",
        hexagon: "Hexagon",
        diamond: "Diamond",
        odd: "Flag",
      },
      edgeLabelField: "Edge label (empty removes it)",
      arrowField: "Arrow",
      arrows: {
        arrow_open: "None (line only)",
        arrow_point: "Arrow",
        arrow_circle: "Circle",
        arrow_cross: "Cross",
        double_arrow_point: "Arrows on both ends",
        double_arrow_circle: "Circles on both ends",
        double_arrow_cross: "Crosses on both ends",
      },
      strokeField: "Line",
      strokes: {
        normal: "Solid",
        thick: "Thick",
        dotted: "Dotted",
        invisible: "Invisible",
      },
      lengthField: "Line length",
      startField: "Start",
      endField: "End",
      deleteEdge: "Delete edge",
      edgeEndShared: "A node in the middle of a chain cannot be reconnected",
      restrictedNode: "This node cannot be changed from the GUI",
      restrictedEdge: "This edge cannot be changed from the GUI",
      restrictedLabel: "This label cannot be changed from the GUI",
      addNodeHeading: "Add a node",
      newNodeLabel: "New node label",
      newNodeId: "Id (generated when empty)",
      newNodeShape: "New node shape",
      addNode: "Add node",
      addEdgeHeading: "Add an edge",
      newEdgeStart: "New edge start",
      newEdgeEnd: "New edge end",
      newEdgeLabel: "Label (optional)",
      choose: "Choose…",
      addEdge: "Add edge",
      endpointsRequired: "Choose a start node and an end node.",
      noNodesForEdge: "There are no nodes to connect yet.",
      itemChanged:
        'The selected element changed in the source, so your input was not applied. It is kept as it is: apply it again, or discard it with "Revert input".',
      itemGone:
        "The element you were editing cannot be found. What you typed is kept and not applied.",
    },
  },
};

export const MERMAID_MESSAGES: Readonly<
  Record<DisplayLanguage, MermaidMessages>
> = { ja: MERMAID_MESSAGES_JA, en: MERMAID_MESSAGES_EN };
