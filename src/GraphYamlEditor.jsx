import React from 'react';
import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

const DEFAULT_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  wordWrap: 'on',
  fontSize: 14,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  wordBasedSuggestions: 'off',
  snippetSuggestions: 'none',
  quickSuggestions: { comments: false, strings: true, other: true },
  suggestOnTriggerCharacters: true,
  suggest: {
    showWords: false,
    showSnippets: false,
  },
  tabCompletion: 'on',
};

export default function GraphYamlEditor({
  value,
  onChange,
  theme,
  schemaError,
  diagnostics,
  documentStateRef,
  completionMetaCacheRef,
  emptyCompletionMetaCache,
  nodeTypeSuggestionsRef,
  linkTypeSuggestionsRef,
  autocompleteSpecRef,
  markerFromDiagnostic,
  collectRootSectionPresence,
  buildAutocompleteMetadata,
  buildAutocompleteRuntimeFromMeta,
  getYamlAutocompleteSuggestions,
  lineIndent,
  inferYamlSection,
  buildCompletionDocumentation,
  getYamlAutocompleteContext,
  isRootBoundaryEmptyLine,
  computeIndentBackspaceDeleteCount,
  indentSize,
}) {
  const monacoRef = useRef(null);
  const editorRef = useRef(null);
  const editorModelRef = useRef(null);
  const completionProviderRef = useRef(null);
  const hoverProviderRef = useRef(null);
  const tabSuggestListenerRef = useRef(null);
  const focusSuggestListenerRef = useRef(null);
  const modelContentListenerRef = useRef(null);
  const cursorSuggestListenerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.__graphEditorE2E) {
        delete window.__graphEditorE2E;
      }
    };
  }, []);

  useEffect(() => {
    if (!editorRef.current || value.trim().length > 0) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      editorRef.current?.trigger('empty-model', 'editor.action.triggerSuggest', {});
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [value]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorModelRef.current;
    if (!monaco || !model || !monaco.editor?.setModelMarkers) {
      return;
    }

    const markerOwner = 'grapheditor';
    if (schemaError) {
      monaco.editor.setModelMarkers(model, markerOwner, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: schemaError,
          source: 'schema',
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 2,
        },
      ]);
      return;
    }

    const markers = (diagnostics || []).map((diagnostic) => markerFromDiagnostic(monaco, model, diagnostic));
    monaco.editor.setModelMarkers(model, markerOwner, markers);
  }, [schemaError, diagnostics, markerFromDiagnostic]);

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
      }
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
      }
      if (tabSuggestListenerRef.current) {
        tabSuggestListenerRef.current.dispose();
      }
      if (focusSuggestListenerRef.current) {
        focusSuggestListenerRef.current.dispose();
      }
      if (modelContentListenerRef.current) {
        modelContentListenerRef.current.dispose();
      }
      if (cursorSuggestListenerRef.current) {
        cursorSuggestListenerRef.current.dispose();
      }
      if (monacoRef.current?.editor?.setModelMarkers && editorModelRef.current) {
        monacoRef.current.editor.setModelMarkers(editorModelRef.current, 'grapheditor', []);
      }
    };
  }, []);

  function getCompletionMeta(model) {
    const text = model.getValue();
    const version = typeof model.getVersionId === 'function' ? model.getVersionId() : null;
    const cache = completionMetaCacheRef.current;
    if (cache.version === version && cache.text === text) {
      return cache.meta;
    }

    const latestDocumentState = documentStateRef.current;
    const meta =
      latestDocumentState && latestDocumentState.text === text
        ? {
            lines: text.split('\n'),
            entities: latestDocumentState.entities,
            rootSectionPresence: collectRootSectionPresence(text.split('\n'), latestDocumentState.parsedGraph),
          }
        : buildAutocompleteMetadata(text);

    completionMetaCacheRef.current = { version, text, meta };
    return meta;
  }

  function onEditorMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editorModelRef.current = editor.getModel?.() || null;

    if (typeof window !== 'undefined' && window.__GRAPH_EDITOR_E2E__) {
      window.__graphEditorE2E = {
        setValue(nextValue) {
          editor.getModel?.()?.setValue(String(nextValue ?? ''));
        },
        getValue() {
          return editor.getModel?.()?.getValue?.() || '';
        },
        setPosition(lineNumber, column) {
          editor.setPosition?.({ lineNumber, column });
          editor.focus?.();
        },
        getPosition() {
          return editor.getPosition?.() || null;
        },
        triggerSuggest() {
          editor.trigger('e2e', 'editor.action.triggerSuggest', {});
        },
        focus() {
          editor.focus?.();
        },
      };
    }

    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }
    if (hoverProviderRef.current) {
      hoverProviderRef.current.dispose();
    }
    if (tabSuggestListenerRef.current) {
      tabSuggestListenerRef.current.dispose();
    }
    if (focusSuggestListenerRef.current) {
      focusSuggestListenerRef.current.dispose();
    }
    if (modelContentListenerRef.current) {
      modelContentListenerRef.current.dispose();
    }
    if (cursorSuggestListenerRef.current) {
      cursorSuggestListenerRef.current.dispose();
    }

    function resolveSuggestionsForPosition(model, position) {
      if (!model || !position) {
        return [];
      }
      const meta = getCompletionMeta(model);
      const text = model.getValue();
      const runtime = buildAutocompleteRuntimeFromMeta(text, position.lineNumber, position.column, meta);
      return getYamlAutocompleteSuggestions(runtime.context, {
        objectKeys: runtime.objectKeys,
        itemContextKeys: runtime.itemContextKeys,
        canContinueItemContext: runtime.canContinueItemContext,
        entities: runtime.entities,
        rootSectionPresence: meta.rootSectionPresence,
        nodeTypeSuggestions: nodeTypeSuggestionsRef.current,
        linkTypeSuggestions: linkTypeSuggestionsRef.current,
        spec: autocompleteSpecRef.current,
      });
    }

    function triggerSuggestIfAvailable(source) {
      const model = editor.getModel?.();
      const position =
        editor.getPosition?.() || editor.getSelection?.()?.getPosition?.() || editor.getSelection?.()?.getStartPosition?.();
      if (!model || !position) {
        editor.trigger(source, 'editor.action.triggerSuggest', {});
        return;
      }
      const suggestions = resolveSuggestionsForPosition(model, position);
      if (suggestions.length > 0) {
        editor.trigger(source, 'editor.action.triggerSuggest', {});
        return;
      }
      editor.trigger(source, 'hideSuggestWidget', {});
    }

    function triggerRootSuggestIfMissing(source) {
      const model = editor.getModel?.();
      const position =
        editor.getPosition?.() || editor.getSelection?.()?.getPosition?.() || editor.getSelection?.()?.getStartPosition?.();
      if (!model || !position) {
        return;
      }

      const text = model.getValue();
      if (!text.trim()) {
        return;
      }

      const meta = getCompletionMeta(model);
      const runtime = buildAutocompleteRuntimeFromMeta(text, position.lineNumber, position.column, meta);
      if (runtime.context.kind !== 'rootKey' && runtime.context.kind !== 'rootItemKey') {
        return;
      }

      const suggestions = getYamlAutocompleteSuggestions(runtime.context, {
        objectKeys: runtime.objectKeys,
        itemContextKeys: runtime.itemContextKeys,
        canContinueItemContext: runtime.canContinueItemContext,
        entities: runtime.entities,
        rootSectionPresence: meta.rootSectionPresence,
        nodeTypeSuggestions: nodeTypeSuggestionsRef.current,
        linkTypeSuggestions: linkTypeSuggestionsRef.current,
        spec: autocompleteSpecRef.current,
      });

      if (suggestions.length > 0) {
        editor.trigger(source, 'editor.action.triggerSuggest', {});
        return;
      }

      editor.trigger(source, 'hideSuggestWidget', {});
    }

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('yaml', {
      triggerCharacters: [' ', ':', '-', '.'],
      provideCompletionItems(model, position) {
        const meta = getCompletionMeta(model);
        const text = model.getValue();
        const runtime = buildAutocompleteRuntimeFromMeta(text, position.lineNumber, position.column, meta);
        const context = runtime.context;
        const suggestions = getYamlAutocompleteSuggestions(context, {
          objectKeys: runtime.objectKeys,
          itemContextKeys: runtime.itemContextKeys,
          canContinueItemContext: runtime.canContinueItemContext,
          entities: runtime.entities,
          rootSectionPresence: meta.rootSectionPresence,
          nodeTypeSuggestions: nodeTypeSuggestionsRef.current,
          linkTypeSuggestions: linkTypeSuggestionsRef.current,
          spec: autocompleteSpecRef.current,
        });

        const completionKinds = monaco.languages.CompletionItemKind || {};
        const insertTextRules = monaco.languages.CompletionItemInsertTextRule || {};
        const propertyKind = completionKinds.Property ?? 2;
        const valueKind = completionKinds.Value ?? 1;
        const enumKind = completionKinds.Enum ?? valueKind;

        const startColumn = Math.max(1, position.column - (context.prefix || '').length);
        const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);

        const currentLine =
          typeof model.getLineContent === 'function' ? model.getLineContent(position.lineNumber) : '';
        const currentIndent = lineIndent(currentLine);

        const completionItems = suggestions.map((item, idx) => {
          let itemRange = range;
          let insertText;
          let insertTextRule;
          const normalizedItem = String(item || '');
          const trimmedItem = normalizedItem.trim();
          const isItemStartLabel = /^\-\s+/.test(trimmedItem);
          const suggestionKey = trimmedItem.replace(/^\-\s+/, '').trim();
          const normalizedSuggestionKey = suggestionKey.replace(/:\s*$/, '');
          if (context.kind === 'rootKey') {
            const nextKey =
              item === 'nodes'
                ? autocompleteSpecRef.current.node.entryStartKey
                : autocompleteSpecRef.current.link.entryStartKey;
            insertText = `${item}:\n${' '.repeat(indentSize)}- ${nextKey}: `;
          } else if (context.kind === 'rootItemKey') {
            const rootKey = normalizedSuggestionKey;
            const nextKey =
              rootKey === 'nodes'
                ? autocompleteSpecRef.current.node.entryStartKey
                : autocompleteSpecRef.current.link.entryStartKey;
            itemRange = new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column);
            insertText = `${rootKey}:\n${' '.repeat(indentSize)}- ${nextKey}: `;
          } else if (context.kind === 'itemKey') {
            const sectionInfo = inferYamlSection(meta.lines, position.lineNumber - 1, lineIndent(currentLine));
            const desiredIndent = sectionInfo.sectionIndent + indentSize;
            itemRange = new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column);
            if (isItemStartLabel) {
              insertText = `${' '.repeat(desiredIndent)}- ${suggestionKey}: `;
            } else {
              insertText = `${' '.repeat(desiredIndent + indentSize)}${suggestionKey}: `;
            }
          } else if (context.kind === 'key') {
            const normalizedKey = String(item || '').trim();
            if (normalizedKey === 'nodes' || normalizedKey === 'links') {
              const nextKey =
                normalizedKey === 'nodes'
                  ? autocompleteSpecRef.current.node.entryStartKey
                  : autocompleteSpecRef.current.link.entryStartKey;
              insertText = `${normalizedKey}:\n${' '.repeat(currentIndent + indentSize)}- ${nextKey}: `;
            } else {
              insertText = `${normalizedKey}: `;
            }
          } else if (context.kind === 'endpointValue' && item === ':') {
            itemRange = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
            insertText = ':';
          } else {
            const isTypeValueContext = context.kind === 'nodeTypeValue' || context.kind === 'linkTypeValue';
            if (isTypeValueContext) {
              insertText = `${item}\n$0`;
              insertTextRule = insertTextRules.InsertAsSnippet;
            } else {
              insertText = item;
            }
          }

          const isValueContext =
            context.kind === 'nodeTypeValue' || context.kind === 'linkTypeValue' || context.kind === 'endpointValue';
          const isKeyLikeContext = context.kind === 'key' || context.kind === 'itemKey';
          const isTypeValueContext = context.kind === 'nodeTypeValue' || context.kind === 'linkTypeValue';
          const isEndpointValueContext = context.kind === 'endpointValue';
          const keyToken =
            context.kind === 'itemKey' || context.kind === 'rootItemKey' ? normalizedSuggestionKey : item;
          const shouldTriggerSuggest =
            (isKeyLikeContext && ['type', 'from', 'to'].includes(keyToken)) ||
            isTypeValueContext ||
            (isEndpointValueContext && item !== ':');

          return {
            label: item,
            kind: isValueContext ? enumKind : propertyKind,
            range: itemRange,
            insertText,
            insertTextRules: insertTextRule,
            sortText: `${String(idx).padStart(3, '0')}-${item}`,
            detail: isKeyLikeContext || context.kind === 'rootKey' ? 'Next graph step' : 'Graph value',
            documentation: buildCompletionDocumentation(keyToken),
            command: shouldTriggerSuggest
              ? {
                  id: 'editor.action.triggerSuggest',
                  title: isTypeValueContext
                    ? 'Trigger Next Step Suggestions'
                    : keyToken === 'type'
                      ? 'Trigger Type Suggestions'
                      : 'Trigger Endpoint Suggestions',
                }
              : undefined,
          };
        });

        if (completionItems.length === 0) {
          return undefined;
        }
        return { suggestions: completionItems };
      },
    });

    if (typeof monaco.languages.registerHoverProvider === 'function') {
      hoverProviderRef.current = monaco.languages.registerHoverProvider('yaml', {
        provideHover(model, position) {
          const word = model.getWordAtPosition?.(position);
          if (!word?.word) {
            return null;
          }
          const key = word.word;
          const docs = buildCompletionDocumentation(key);
          if (!docs) {
            return null;
          }

          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [{ value: `**${key}**` }, { value: docs }],
          };
        },
      });
    }

    tabSuggestListenerRef.current = editor.onKeyDown((event) => {
      const isTabKey = event.keyCode === monaco.KeyCode.Tab || event.browserEvent?.key === 'Tab';
      if (isTabKey) {
        window.setTimeout(() => {
          triggerSuggestIfAvailable('keyboard');
        }, 0);
        return;
      }

      const isEnterKey =
        (monaco.KeyCode?.Enter && event.keyCode === monaco.KeyCode.Enter) || event.browserEvent?.key === 'Enter';
      if (isEnterKey) {
        const selection = editor.getSelection?.();
        const model = editor.getModel?.();
        const position =
          selection?.getPosition?.() || selection?.getStartPosition?.() || editor.getPosition?.();
        if (selection?.isEmpty?.() && model && position) {
          const text = model.getValue();
          const context = getYamlAutocompleteContext(text, position.lineNumber, position.column);
          const currentLine = model.getLineContent(position.lineNumber) || '';
          const endpointValue = String(context.prefix || '').trim();
          const valueHasColon = endpointValue.includes(':');
          const portPart = valueHasColon ? endpointValue.split(':').slice(1).join(':').trim() : '';
          const canAdvanceEndpoint = endpointValue.length > 0 && (!valueHasColon || portPart.length > 0);
          if (
            context.kind === 'endpointValue' &&
            context.section === 'links' &&
            (context.endpoint === 'from' || context.endpoint === 'to') &&
            canAdvanceEndpoint
          ) {
            const baseIndent = lineIndent(currentLine);
            const nextIndent =
              context.endpoint === 'from'
                ? /^\s*-\s*/.test(currentLine)
                  ? baseIndent + indentSize
                  : baseIndent
                : Math.max(0, baseIndent - indentSize);
            event.preventDefault?.();
            event.stopPropagation?.();
            if (context.endpoint === 'from') {
              editor.executeEdits?.('link-from-next-to', [
                {
                  range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                  text: `\n${' '.repeat(nextIndent)}to: `,
                },
              ]);
            } else {
              editor.executeEdits?.('link-to-next-step', [
                {
                  range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                  text: `\n${' '.repeat(nextIndent)}`,
                },
              ]);
            }
            window.setTimeout(() => {
              triggerSuggestIfAvailable('enter-next-to');
            }, 0);
            return;
          }

          const trimmedCurrentLine = currentLine.trim();
          const linkLabelValueMatch = trimmedCurrentLine.match(/^(?:-\s*)?label:\s*(.+)$/);
          if (
            context.section === 'links' &&
            linkLabelValueMatch &&
            String(linkLabelValueMatch[1] || '').trim().length > 0
          ) {
            const baseIndent = lineIndent(currentLine);
            const nextIndent = /^\s*-\s*/.test(currentLine) ? baseIndent : Math.max(indentSize, baseIndent - indentSize);
            event.preventDefault?.();
            event.stopPropagation?.();
            editor.executeEdits?.('link-label-next-step', [
              {
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: `\n${' '.repeat(nextIndent)}`,
              },
            ]);
            window.setTimeout(() => {
              triggerSuggestIfAvailable('enter-after-label');
            }, 0);
            return;
          }
        }
        window.setTimeout(() => {
          triggerSuggestIfAvailable('enter');
        }, 0);
        return;
      }

      const isBackspaceKey =
        event.keyCode === monaco.KeyCode.Backspace || event.browserEvent?.key === 'Backspace';
      if (!isBackspaceKey) {
        return;
      }

      const selection = editor.getSelection?.();
      if (!selection || !selection.isEmpty?.()) {
        return;
      }

      const model = editor.getModel?.();
      if (!model) {
        return;
      }

      const position = selection.getPosition?.();
      if (!position) {
        return;
      }

      const lineContent = model.getLineContent(position.lineNumber);
      const modelLineCount =
        typeof model.getLineCount === 'function'
          ? Math.max(1, model.getLineCount())
          : Math.max(1, model.getValue().split('\n').length);
      const modelLines = [];
      for (let i = 1; i <= modelLineCount; i += 1) {
        modelLines.push(typeof model.getLineContent === 'function' ? model.getLineContent(i) : '');
      }
      const currentLineIndex = Math.max(0, Math.min(position.lineNumber - 1, modelLines.length - 1));
      if (isRootBoundaryEmptyLine(modelLines, currentLineIndex)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (position.column > 1) {
          editor.executeEdits?.('root-boundary-backspace', [
            {
              range: new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column),
              text: '',
            },
          ]);
        }
        window.setTimeout(() => {
          triggerSuggestIfAvailable('backspace-root-boundary');
        }, 0);
        return;
      }
      const deleteCount = computeIndentBackspaceDeleteCount(lineContent, position.column, indentSize);
      if (deleteCount <= 0) {
        return;
      }

      event.preventDefault?.();
      event.stopPropagation?.();
      editor.executeEdits?.('indent-backspace', [
        {
          range: new monaco.Range(
            position.lineNumber,
            position.column - deleteCount,
            position.lineNumber,
            position.column
          ),
          text: '',
        },
      ]);
      window.setTimeout(() => {
        triggerSuggestIfAvailable('backspace');
      }, 0);
    });

    focusSuggestListenerRef.current = editor.onDidFocusEditorText?.(() => {
      const model = editor.getModel?.();
      if (!model) {
        return;
      }
      if (model.getValue().trim().length === 0) {
        triggerSuggestIfAvailable('focus');
        return;
      }
      triggerRootSuggestIfMissing('focus-root');
    });

    modelContentListenerRef.current = editor.onDidChangeModelContent?.(() => {
      completionMetaCacheRef.current = emptyCompletionMetaCache;
      const model = editor.getModel?.();
      if (!model) {
        return;
      }
      if (model.getValue().trim().length === 0) {
        window.setTimeout(() => {
          triggerSuggestIfAvailable('empty');
        }, 0);
        return;
      }

      window.setTimeout(() => {
        triggerRootSuggestIfMissing('root-gap');
      }, 0);
    });

    cursorSuggestListenerRef.current = editor.onDidChangeCursorPosition?.(() => {
      window.setTimeout(() => {
        triggerRootSuggestIfMissing('root-cursor');
      }, 0);
    });

    const model = editor.getModel?.();
    if (model && model.getValue().trim().length === 0) {
      triggerSuggestIfAvailable('mount');
    }
  }

  return (
    <div className="editor-shell" aria-label="YAML editor">
      <Editor
        path="graph.yaml"
        keepCurrentModel
        height="100%"
        defaultLanguage="yaml"
        value={value}
        onChange={(nextValue) => onChange(nextValue || '')}
        onMount={onEditorMount}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        options={DEFAULT_EDITOR_OPTIONS}
      />
    </div>
  );
}
