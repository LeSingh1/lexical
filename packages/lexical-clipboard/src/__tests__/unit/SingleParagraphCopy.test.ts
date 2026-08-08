/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {$getHtmlContent, $getLexicalContent} from '@lexical/clipboard';
import {buildEditorFromExtensions} from '@lexical/extension';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isTextNode,
  $selectAll,
  defineExtension,
  type LexicalEditor,
} from 'lexical';
import {assert, describe, expect, test} from 'vitest';

function makeEditor(paragraphTexts: string[]) {
  return buildEditorFromExtensions(
    defineExtension({
      $initialEditorState() {
        $getRoot()
          .clear()
          .append(
            ...paragraphTexts.map(text => {
              const paragraph = $createParagraphNode().append(
                $createTextNode(text),
              );
              paragraph.setIndent(2);
              return paragraph;
            }),
          );
      },
      name: 'host',
    }),
  );
}

function $selectAllAndCopy(editor: LexicalEditor) {
  // The DOM selection after Ctrl+A: $selectAll normalizes the root's element
  // points onto the TextNodes, so with a single paragraph the range never
  // contains the ParagraphNode itself.
  $selectAll();
  const selection = $getSelection();
  assert(selection !== null, 'expected a selection');
  return {
    html: $getHtmlContent(editor, selection),
    json: $getLexicalContent(editor, selection),
  };
}

describe('copying a fully selected paragraph (#6086)', () => {
  test('a lone paragraph keeps its indent', () => {
    using editor = makeEditor(['Hello']);
    let result!: ReturnType<typeof $selectAllAndCopy>;
    editor.update(
      () => {
        result = $selectAllAndCopy(editor);
      },
      {discrete: true},
    );
    const {html, json} = result;
    expect(html).toBe(
      '<p style="padding-inline-start: 80px;" data-lexical-indent="2">' +
        '<span style="white-space: pre-wrap;">Hello</span></p>',
    );
    assert(json !== null, 'expected clipboard JSON');
    expect(JSON.parse(json).nodes).toMatchObject([
      {indent: 2, type: 'paragraph'},
    ]);
  });

  test('two paragraphs keep their indent', () => {
    // Control: a range that crosses a block boundary already contained both
    // paragraphs, so this passes with or without the fix.
    using editor = makeEditor(['Hello', 'World']);
    let result!: ReturnType<typeof $selectAllAndCopy>;
    editor.update(
      () => {
        result = $selectAllAndCopy(editor);
      },
      {discrete: true},
    );
    const {html, json} = result;
    expect(html).toBe(
      '<p style="padding-inline-start: 80px;" data-lexical-indent="2">' +
        '<span style="white-space: pre-wrap;">Hello</span></p>' +
        '<p style="padding-inline-start: 80px;" data-lexical-indent="2">' +
        '<span style="white-space: pre-wrap;">World</span></p>',
    );
    assert(json !== null, 'expected clipboard JSON');
    expect(JSON.parse(json).nodes).toMatchObject([
      {indent: 2, type: 'paragraph'},
      {indent: 2, type: 'paragraph'},
    ]);
  });

  test('a partial selection still copies inline content only', () => {
    using editor = makeEditor(['Hello']);
    let html = '';
    let json: string | null = null;
    editor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        assert($isTextNode(text), 'expected a TextNode');
        const selection = text.select(1, 3);
        html = $getHtmlContent(editor, selection);
        json = $getLexicalContent(editor, selection);
      },
      {discrete: true},
    );
    expect(html).toBe('<span style="white-space: pre-wrap;">el</span>');
    assert(json !== null, 'expected clipboard JSON');
    expect(JSON.parse(json).nodes).toMatchObject([{type: 'text'}]);
  });
});
