/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  EditorConfig,
  KlassConstructor,
  LexicalEditor,
  Spread,
} from '../LexicalEditor';
import type {
  DOMConversionOutput,
  DOMExportOutput,
  LexicalNode,
} from '../LexicalNode';
import type {BaseSelection, RangeSelection} from '../LexicalSelection';

import {
  $comparePointCaretNext,
  $getCaretInDirection,
  $getChildCaret,
} from '../caret/LexicalCaret';
import {
  $caretRangeFromSelection,
  $getCaretRangeInDirection,
  $normalizeCaret,
} from '../caret/LexicalCaretUtils';
import {ELEMENT_TYPE_TO_FORMAT} from '../LexicalConstants';
import {$isRangeSelection} from '../LexicalSelection';
import {$getSlotFrame} from '../LexicalSlot';
import {
  $applyNodeReplacement,
  $getDocument,
  $setDirectionFromDOM,
  $setFormatFromDOM,
  getCachedClassNameArray,
  isHTMLElement,
  setNodeIndentFromDOM,
} from '../LexicalUtils';
import {
  type ElementFormatType,
  ElementNode,
  type SerializedElementNode,
} from './LexicalElementNode';
import {$isTextNode} from './LexicalTextNode';

export type SerializedParagraphNode = Spread<
  {
    textFormat: number;
    textStyle: string;
  },
  SerializedElementNode
>;

/** @noInheritDoc */
export class ParagraphNode extends ElementNode {
  /** @internal */
  declare ['constructor']: KlassConstructor<typeof ParagraphNode>;

  $config() {
    return this.config('paragraph', {
      extends: ElementNode,
      importDOM: {
        p: () => ({
          conversion: $convertParagraphElement,
          priority: 0,
        }),
      },
    });
  }

  // View

  createDOM(config: EditorConfig): HTMLElement {
    const dom = $getDocument().createElement('p');
    const classNames = getCachedClassNameArray(config.theme, 'paragraph');
    if (classNames !== undefined) {
      const domClassList = dom.classList;
      domClassList.add(...classNames);
    }
    return dom;
  }
  updateDOM(
    prevNode: ParagraphNode,
    dom: HTMLElement,
    config: EditorConfig,
  ): boolean {
    return false;
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    const {element} = super.exportDOM(editor);

    if (isHTMLElement(element)) {
      if (this.isEmpty()) {
        element.append($getDocument().createElement('br'));
      }

      const formatType = this.getFormatType();
      if (formatType) {
        element.style.textAlign = formatType;
      }
    }

    return {
      element,
    };
  }

  extractWithChild(
    child: LexicalNode,
    selection: BaseSelection | null,
    destination: 'clone' | 'html',
  ): boolean {
    // A RangeSelection normalizes its points onto TextNodes, so a range that
    // covers every character of a paragraph still does not contain the
    // paragraph itself unless it also crosses a block boundary. With a single
    // top-level paragraph — the whole document after select-all — there is no
    // boundary to cross, so the exporters saw only the TextNode and dropped
    // every element-level property with the paragraph: indent, alignment and
    // direction (#6086). Opt the paragraph back in when the range spans all
    // of it, which is the state the exporters would have seen had the same
    // content been one of several blocks.
    return $isRangeSelection(selection) && $isFullySelected(this, selection);
  }

  exportJSON(): SerializedParagraphNode {
    const json = super.exportJSON();
    // Provide backwards compatible values, see #7971
    if (json.textFormat === undefined || json.textStyle === undefined) {
      // Compute the same value that the reconciler would
      const firstTextNode = this.getChildren().find($isTextNode);
      if (firstTextNode) {
        json.textFormat = firstTextNode.getFormat();
        json.textStyle = firstTextNode.getStyle();
      } else {
        json.textFormat = this.getTextFormat();
        json.textStyle = this.getTextStyle();
      }
    }
    return json as SerializedParagraphNode;
  }

  // Mutation

  insertNewAfter(
    rangeSelection: RangeSelection,
    restoreSelection: boolean,
  ): ParagraphNode {
    const newElement = $createParagraphNode();
    newElement.setTextFormat(rangeSelection.format);
    newElement.setTextStyle(rangeSelection.style);
    const direction = this.getDirection();
    newElement.setDirection(direction);
    newElement.setFormat(this.getFormatType());
    newElement.setStyle(this.getStyle());
    this.insertAfter(newElement, restoreSelection);
    return newElement;
  }

  collapseAtStart(): boolean {
    const children = this.getChildren();
    // If we have an empty (trimmed) first paragraph and try and remove it,
    // delete the paragraph as long as we have another sibling to go to
    if (
      children.length === 0 ||
      ($isTextNode(children[0]) && children[0].getTextContent().trim() === '')
    ) {
      const nextSibling = this.getNextSibling();
      if (nextSibling !== null) {
        this.selectNext();
        this.remove();
        return true;
      }
      const prevSibling = this.getPreviousSibling();
      if (prevSibling !== null) {
        this.selectPrevious();
        this.remove();
        return true;
      }
    }
    return false;
  }
}

/**
 * Whether `selection` covers every position inside `element`: its start is at
 * or before the first one and its end at or after the last. A range that
 * extends past the element still covers it.
 *
 * The public `$isBlockFullySelected` in `@lexical/utils` answers the same
 * question, but `@lexical/utils` depends on this package, so core keeps its
 * own copy.
 */
function $isFullySelected(
  element: ElementNode,
  selection: RangeSelection,
): boolean {
  const range = $getCaretRangeInDirection(
    $caretRangeFromSelection(selection),
    'next',
  );
  // A named-slot subtree is isolated from its host by a parentless up-link, so
  // a range on the other side of that boundary has no common ancestor to
  // compare against and $comparePointCaretNext would throw. Different frames
  // are never fully selected.
  const anchorFrame = $getSlotFrame(range.anchor.origin);
  const elementFrame = $getSlotFrame(element.getLatest());
  if (
    anchorFrame === null ? elementFrame !== null : !anchorFrame.is(elementFrame)
  ) {
    return false;
  }
  const start = $normalizeCaret($getChildCaret(element, 'next'));
  const end = $getCaretInDirection(
    $normalizeCaret($getChildCaret(element, 'previous')),
    'next',
  );
  return (
    $comparePointCaretNext(range.anchor, start) <= 0 &&
    $comparePointCaretNext(range.focus, end) >= 0
  );
}

function $convertParagraphElement(element: HTMLElement): DOMConversionOutput {
  const node = $createParagraphNode();
  $setFormatFromDOM(node, element);
  setNodeIndentFromDOM(element, node);

  // Check legacy 'align' attribute
  // Only use this if no format was set by CSS
  if (node.getFormatType() === '') {
    const align = element.getAttribute('align');
    if (align) {
      if (align && align in ELEMENT_TYPE_TO_FORMAT) {
        node.setFormat(align as ElementFormatType);
      }
    }
  }
  $setDirectionFromDOM(node, element);
  return {node};
}

/** Creates a ParagraphNode, the default block-level container for text. */
export function $createParagraphNode(): ParagraphNode {
  return $applyNodeReplacement(new ParagraphNode());
}

/** Returns true if the given node is a ParagraphNode. */
export function $isParagraphNode(
  node: LexicalNode | null | undefined,
): node is ParagraphNode {
  return node instanceof ParagraphNode;
}
