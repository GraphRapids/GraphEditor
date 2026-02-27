import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App, {
  applySvgColorScheme,
  computeIndentBackspaceDeleteCount,
  extractSvg,
  formatAjvErrors,
  getYamlAutocompleteContext,
  getYamlAutocompleteSuggestions,
  normalizeGraphInputForValidation,
  parseSvgDocument,
} from './App';

const {
  fitToViewerSpy,
  registerCompletionProviderSpy,
  completionProviderState,
  completionProviderDisposeSpy,
  editorKeyDownState,
  editorFocusState,
  editorModelState,
  editorTriggerSpy,
  executeEditsSpy,
  keyDownListenerDisposeSpy,
  focusListenerDisposeSpy,
} = vi.hoisted(() => ({
  fitToViewerSpy: vi.fn(),
  registerCompletionProviderSpy: vi.fn(),
  completionProviderState: { provider: null },
  completionProviderDisposeSpy: vi.fn(),
  editorKeyDownState: { handler: null },
  editorFocusState: { handler: null },
  editorModelState: { value: undefined, lineContent: undefined, selection: null },
  editorTriggerSpy: vi.fn(),
  executeEditsSpy: vi.fn(),
  keyDownListenerDisposeSpy: vi.fn(),
  focusListenerDisposeSpy: vi.fn(),
}));

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    default: ({ value, onChange, onMount }) => {
    React.useEffect(() => {
      const fakeMonaco = {
        KeyCode: {
          Tab: 2,
          Backspace: 1,
          Enter: 3,
        },
        Range: class {
          constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
            this.startLineNumber = startLineNumber;
            this.startColumn = startColumn;
            this.endLineNumber = endLineNumber;
            this.endColumn = endColumn;
          }
        },
        languages: {
          CompletionItemKind: {
            Value: 1,
            Property: 2,
          },
          CompletionItemInsertTextRule: {
            InsertAsSnippet: 4,
          },
          registerCompletionItemProvider: (language, provider) => {
            registerCompletionProviderSpy(language);
            completionProviderState.provider = provider;
            return { dispose: completionProviderDisposeSpy };
          },
        },
      };
      const fakeEditor = {
        onKeyDown: (handler) => {
          editorKeyDownState.handler = handler;
          return { dispose: keyDownListenerDisposeSpy };
        },
        onDidFocusEditorText: (handler) => {
          editorFocusState.handler = handler;
          return { dispose: focusListenerDisposeSpy };
        },
        getSelection: () => editorModelState.selection,
        getModel: () => ({
          getValue: () => (editorModelState.value !== undefined ? editorModelState.value : value),
          getLineContent: (lineNumber) => {
            if (editorModelState.lineContent !== undefined) {
              return editorModelState.lineContent;
            }
            const lines = (editorModelState.value !== undefined ? editorModelState.value : value).split('\n');
            return lines[Math.max(0, lineNumber - 1)] || '';
          },
          getLineCount: () => (editorModelState.value !== undefined ? editorModelState.value : value).split('\n').length,
        }),
        executeEdits: (...args) => executeEditsSpy(...args),
        trigger: (...args) => editorTriggerSpy(...args),
      };
      onMount?.(fakeEditor, fakeMonaco);
    }, [onMount]);

    return (
      <textarea
        data-testid="monaco-editor"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        aria-label="Monaco editor"
      />
    );
    },
  };
});

vi.mock('react-svg-pan-zoom', async () => {
  const React = await import('react');

  const fitToViewer = (value) => ({
    ...value,
    a: 1,
    e: 0,
    f: 0,
    lastAction: 'zoom',
  });

  const UncontrolledReactSVGPanZoom = React.forwardRef(function MockViewer(props, ref) {
    React.useImperativeHandle(ref, () => ({
      fitToViewer: (...args) => fitToViewerSpy(...args),
    }));

    return (
      <div data-testid="svg-viewer" data-width={props.width} data-height={props.height}>
        <button
          type="button"
          onClick={() =>
            props.onPan?.({
              lastAction: 'pan',
              a: 1,
              e: 120,
              f: 45,
              viewerWidth: props.width,
              viewerHeight: props.height,
              SVGMinX: 0,
              SVGMinY: 0,
              SVGWidth: 100,
              SVGHeight: 50,
            })
          }
        >
          mock-pan
        </button>
        <button
          type="button"
          onClick={() =>
            props.onZoom?.({
              lastAction: 'zoom',
              a: 1,
              e: 0,
              f: 0,
              viewerWidth: props.width,
              viewerHeight: props.height,
              SVGMinX: 0,
              SVGMinY: 0,
              SVGWidth: 100,
              SVGHeight: 50,
            })
          }
        >
          mock-fit
        </button>
        {props.children}
      </div>
    );
  });

  return {
    UncontrolledReactSVGPanZoom,
    fitToViewer,
  };
});

const MINIMAL_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['nodes', 'links'],
  properties: {
    nodes: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              id: { type: 'string' },
              type: { type: 'string' },
              nodes: { type: 'array' },
              links: { type: 'array' },
            },
            additionalProperties: true,
          },
        ],
      },
    },
    links: {
      type: 'array',
      items: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              id: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string' },
            },
            additionalProperties: true,
          },
        ],
      },
    },
  },
  additionalProperties: false,
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function svgResponse(svg, status = 200) {
  return new Response(svg, {
    status,
    headers: { 'Content-Type': 'image/svg+xml' },
  });
}

function installFetchMock(renderHandler) {
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/api/schemas/minimal-input.schema.json')) {
      return jsonResponse(MINIMAL_SCHEMA);
    }
    if (url.includes('/api/v1/themes/default/bundle')) {
      return jsonResponse({
        schemaVersion: 'v1',
        themeId: 'default',
        themeVersion: 1,
        name: 'Default Render Theme',
        renderCss: '.node.router > rect { fill: #334455; }',
        updatedAt: '2026-02-26T00:00:00Z',
        checksum: 'def',
      });
    }
    if (url.includes('/api/v1/themes')) {
      return jsonResponse({
        themes: [
          {
            themeId: 'default',
            name: 'Default Render Theme',
            draftVersion: 1,
            publishedVersion: 1,
            checksum: 'def',
            updatedAt: '2026-02-26T00:00:00Z',
          },
        ],
      });
    }
    if (url.includes('/api/v1/graph-types/default/runtime')) {
      return jsonResponse({
        schemaVersion: 'v1',
        graphTypeId: 'default',
        graphTypeVersion: 1,
        graphTypeChecksum: 'abc',
        runtimeChecksum: 'runtime-checksum-abc',
        conflictPolicy: 'reject',
        resolvedEntries: {
          router: 'mdi:router',
          switch: 'mdi:switch',
        },
        sources: [
          {
            iconSetId: 'default',
            iconSetVersion: 1,
            checksum: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          },
        ],
        linkTypes: ['directed', 'undirected'],
        edgeTypeOverrides: {},
        keySources: {},
        checksum: 'runtime-checksum-abc',
      });
    }
    if (url.includes('/api/v1/graph-types')) {
      return jsonResponse({
        graphTypes: [
          {
            graphTypeId: 'default',
            name: 'Default Runtime Graph Type',
            draftVersion: 1,
            publishedVersion: 1,
            checksum: 'abc',
            runtimeChecksum: 'runtime-checksum-abc',
            iconSetResolutionChecksum: 'fedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafe',
            updatedAt: '2026-02-26T00:00:00Z',
          },
        ],
      });
    }
    if (url.includes('/api/v1/autocomplete/catalog')) {
      return jsonResponse({
        schemaVersion: 'v1',
        graphTypeId: 'default',
        graphTypeVersion: 1,
        graphTypeChecksum: 'abc',
        runtimeChecksum: 'runtime-checksum-abc',
        iconSetResolutionChecksum: 'fedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafedcbafe',
        checksum: 'abc',
        nodeTypes: ['router', 'switch'],
        linkTypes: ['directed', 'undirected'],
      });
    }
    if (url.includes('/api/render/svg')) {
      return renderHandler(url, init);
    }
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flushDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
}

function countRenderCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/render/svg')).length;
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fitToViewerSpy.mockReset();
    registerCompletionProviderSpy.mockReset();
    completionProviderDisposeSpy.mockReset();
    editorTriggerSpy.mockReset();
    executeEditsSpy.mockReset();
    keyDownListenerDisposeSpy.mockReset();
    focusListenerDisposeSpy.mockReset();
    completionProviderState.provider = null;
    editorKeyDownState.handler = null;
    editorFocusState.handler = null;
    editorModelState.value = undefined;
    editorModelState.lineContent = undefined;
    editorModelState.selection = null;
    vi.mocked(URL.createObjectURL).mockImplementation(() => 'blob:mock-url');
    vi.mocked(URL.revokeObjectURL).mockImplementation(() => {});
  });

  it('renders initial graph after schema load and enables download', async () => {
    const fetchMock = installFetchMock(async () =>
      svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>')
    );

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/schemas/minimal-input.schema.json'));
    await flushDebounce();

    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    expect(countRenderCalls(fetchMock)).toBe(1);
    expect(screen.getByRole('button', { name: /download svg/i })).toBeEnabled();
    await waitFor(() => expect(fitToViewerSpy).toHaveBeenCalledTimes(1));
  });

  it('renders using active profile id/version and shows profile summary in preview', async () => {
    let renderRequestUrl = '';
    const fetchMock = installFetchMock(async (url) => {
      renderRequestUrl = url;
      return new Response('<svg width="100" height="50"><rect width="100" height="50"/></svg>', {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'X-GraphAPI-Graph-Type-Id': 'default',
          'X-GraphAPI-Graph-Type-Version': '1',
          'X-GraphAPI-Graph-Type-Checksum': '0123456789abcdef',
          'X-GraphAPI-Graph-Type-Runtime-Checksum': 'runtime-checksum-abc',
          'X-GraphAPI-Icon-Set-Resolution-Checksum': '111111111111abcdef',
          'X-GraphAPI-Icon-Set-Sources': 'default@1',
          'X-GraphAPI-Theme-Id': 'default',
          'X-GraphAPI-Theme-Version': '2',
          'X-GraphAPI-Theme-Checksum': 'abcdef0123456789',
        },
      });
    });

    render(<App />);
    await flushDebounce();

    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    expect(renderRequestUrl).toContain('/api/render/svg?');
    expect(renderRequestUrl).toContain('graph_type_id=default');
    expect(renderRequestUrl).toContain('graph_type_stage=published');
    expect(renderRequestUrl).toContain('graph_type_version=1');
    expect(renderRequestUrl).toContain('theme_id=default');
    expect(renderRequestUrl).toContain('theme_stage=published');
    expect(renderRequestUrl).toContain('theme_version=1');
    expect(screen.getByTestId('profile-meta').textContent).toContain('Profile: default');
    expect(screen.getByTestId('profile-meta').textContent).toContain('v1');
    expect(screen.getByTestId('profile-meta').textContent).toContain('Theme: default');
    expect(screen.getByTestId('profile-meta').textContent).toContain('Iconsets');
    expect(screen.getByTestId('profile-meta').textContent).toContain('default@1');
    expect(screen.getByTestId('profile-meta').textContent).toContain('111111111111');
    expect(screen.getByTestId('profile-icon_sets').textContent).toContain('Icon Sets');
    expect(screen.getByTestId('profile-icon_sets').textContent).toContain('default@1');

    expect(countRenderCalls(fetchMock)).toBeGreaterThanOrEqual(1);
  });

  it('blocks render requests when schema validation fails', async () => {
    const fetchMock = installFetchMock(async () =>
      svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>')
    );

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());

    const initialRenderCalls = countRenderCalls(fetchMock);
    fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: 'foo: bar' } });
    await flushDebounce();

    await waitFor(() => expect(screen.getByText('JSON schema validation failed.')).toBeInTheDocument());
    expect(countRenderCalls(fetchMock)).toBe(initialRenderCalls);
  });

  it('aborts stale render requests and keeps latest result', async () => {
    let renderCall = 0;
    let firstRequestAborted = false;

    const fetchMock = installFetchMock(async (_url, init) => {
      renderCall += 1;
      if (renderCall === 1) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            firstRequestAborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return svgResponse('<svg width="200" height="80"><circle cx="8" cy="8" r="5"/></svg>');
    });

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(countRenderCalls(fetchMock)).toBe(1));

    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: {
        value: 'nodes:\n  - name: A\nlinks:\n  - from: A\n    to: A\n',
      },
    });

    await flushDebounce();

    await waitFor(() => expect(countRenderCalls(fetchMock)).toBe(2));
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    expect(firstRequestAborted).toBe(true);
  });

  it('re-enables auto-fit when user triggers toolbar fit after manual pan', async () => {
    const fetchMock = installFetchMock(async () =>
      svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>')
    );

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    await waitFor(() => expect(fitToViewerSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'mock-pan' }));
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: {
        value: 'nodes:\n  - name: A\n  - name: B\nlinks:\n  - from: A\n    to: B\n',
      },
    });
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    expect(fitToViewerSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'mock-fit' }));
    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: {
        value: 'nodes:\n  - name: X\n  - name: Y\nlinks:\n  - from: X\n    to: Y\n',
      },
    });
    await flushDebounce();

    await waitFor(() => expect(fitToViewerSpy).toHaveBeenCalledTimes(2));
  });

  it('toggles dark mode and applies color-scheme to rendered SVG blob', async () => {
    installFetchMock(async () =>
      svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>')
    );

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());

    const createObjectURLCallsBefore = vi.mocked(URL.createObjectURL).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /dark mode/i }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await waitFor(() =>
      expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBeGreaterThan(createObjectURLCallsBefore)
    );

    expect(vi.mocked(URL.createObjectURL).mock.calls.at(-1)[0]).toBeTruthy();
  });

  it('downloads the rendered SVG on demand', async () => {
    installFetchMock(async () =>
      svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>')
    );

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());

    const objectUrlCountBefore = vi.mocked(URL.createObjectURL).mock.calls.length;
    const revokeCountBefore = vi.mocked(URL.revokeObjectURL).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /download svg/i }));

    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBe(objectUrlCountBefore + 1);
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBe(revokeCountBefore + 1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
  });

  it('coerces numeric label-like fields to strings before schema validation and render', async () => {
    let sawCoercedPayload = false;
    const fetchMock = installFetchMock(async (_url, init) => {
      const payload = JSON.parse(init.body);
      if (payload.nodes?.[0]?.name === '100') {
        expect(payload.links[0].from).toBe('100');
        expect(payload.links[0].label).toBe('42');
        sawCoercedPayload = true;
      }
      return svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>');
    });

    render(<App />);
    await flushDebounce();
    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: {
        value: 'nodes:\n  - name: 100\n  - name: B\nlinks:\n  - from: 100\n    to: B\n    label: 42\n',
      },
    });
    await flushDebounce();

    await waitFor(() => expect(screen.getByText('Rendered.')).toBeInTheDocument());
    expect(sawCoercedPayload).toBe(true);
    expect(countRenderCalls(fetchMock)).toBeGreaterThanOrEqual(2);
  });

  it('registers yaml completion provider on editor mount and disposes on unmount', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    const { unmount } = render(<App />);
    await flushDebounce();

    expect(registerCompletionProviderSpy).toHaveBeenCalledWith('yaml');
    expect(completionProviderState.provider).toBeTruthy();

    unmount();
    expect(completionProviderDisposeSpy).toHaveBeenCalled();
    expect(keyDownListenerDisposeSpy).toHaveBeenCalled();
    expect(focusListenerDisposeSpy).toHaveBeenCalled();
  });

  it('triggers suggest when Tab key is pressed in Monaco', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    expect(editorKeyDownState.handler).toBeTruthy();
    await act(async () => {
      editorKeyDownState.handler({ keyCode: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(editorTriggerSpy).toHaveBeenCalledWith('keyboard', 'editor.action.triggerSuggest', {});
  });

  it('applies indentation-aware backspace edit on whitespace-only line', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = '    ';
    editorModelState.lineContent = '    ';
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 1, column: 5 }),
    };
    const preventDefault = vi.fn();
    editorKeyDownState.handler({ keyCode: 1, preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalled();
  });

  it('keeps cursor on root-boundary empty line and suggests root sections on Backspace', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = 'nodes:\n  - name: A\n    ';
    editorModelState.lineContent = undefined;
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 3, column: 5 }),
    };
    const preventDefault = vi.fn();

    await act(async () => {
      editorKeyDownState.handler({ keyCode: 1, preventDefault });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalledWith('indent-backspace', [
      expect.objectContaining({
        text: '',
      }),
    ]);
    expect(editorTriggerSpy).toHaveBeenCalledWith('backspace', 'editor.action.triggerSuggest', {});
  });

  it('inserts `to:` on Enter after `from` value when no port suffix is selected', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = 'links:\n  - from: A';
    editorModelState.lineContent = '  - from: A';
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 2, column: 12 }),
    };
    const preventDefault = vi.fn();

    await act(async () => {
      editorKeyDownState.handler({ keyCode: 3, preventDefault });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalledWith('link-from-next-to', [
      expect.objectContaining({
        text: '\n    to: ',
      }),
    ]);
  });

  it('inserts `to:` on Enter after `from` value with node:port', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = 'links:\n  - from: A:eth0';
    editorModelState.lineContent = '  - from: A:eth0';
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 2, column: 17 }),
    };
    const preventDefault = vi.fn();

    await act(async () => {
      editorKeyDownState.handler({ keyCode: 3, preventDefault });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalledWith('link-from-next-to', [
      expect.objectContaining({
        text: '\n    to: ',
      }),
    ]);
  });

  it('goes to next link-step line on Enter after `to` value when port suffix is not selected', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = 'links:\n  - from: A\n    to: B';
    editorModelState.lineContent = '    to: B';
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 3, column: 10 }),
    };
    const preventDefault = vi.fn();

    await act(async () => {
      editorKeyDownState.handler({ keyCode: 3, preventDefault });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalledWith('link-to-next-step', [
      expect.objectContaining({
        text: '\n  ',
      }),
    ]);
  });

  it('goes to next link-step line on Enter after `label` value', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = 'links:\n  - from: A\n    to: B\n    label: my_link_label';
    editorModelState.lineContent = '    label: my_link_label';
    editorModelState.selection = {
      isEmpty: () => true,
      getPosition: () => ({ lineNumber: 4, column: 25 }),
    };
    const preventDefault = vi.fn();

    await act(async () => {
      editorKeyDownState.handler({ keyCode: 3, preventDefault });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(executeEditsSpy).toHaveBeenCalledWith('link-label-next-step', [
      expect.objectContaining({
        text: '\n  ',
      }),
    ]);
  });

  it('triggers suggest on empty document focus', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    editorModelState.value = '';
    editorFocusState.handler();
    expect(editorTriggerSpy).toHaveBeenCalledWith('focus', 'editor.action.triggerSuggest', {});
  });

  it('triggers suggest on mount when model is empty', async () => {
    editorModelState.value = '';
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();
    expect(editorTriggerSpy).toHaveBeenCalledWith('mount', 'editor.action.triggerSuggest', {});
  });

  it('triggers suggest when document becomes empty', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: '' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(editorTriggerSpy).toHaveBeenCalledWith('empty-model', 'editor.action.triggerSuggest', {});
  });

  it('completion provider suggests node keys and node types in context', async () => {
    installFetchMock(async () => svgResponse('<svg width="100" height="50"><rect width="100" height="50"/></svg>'));
    render(<App />);
    await flushDebounce();

    const provider = completionProviderState.provider;
    expect(provider).toBeTruthy();

    const keyResult = provider.provideCompletionItems(
      { getValue: () => 'nodes:\n  - na', getLineContent: () => '  - na' },
      { lineNumber: 2, column: 7 }
    );
    const nameSuggestion = keyResult.suggestions.find((item) => item.label === '- name');
    expect(nameSuggestion).toBeTruthy();
    expect(nameSuggestion.insertText).toBe('  - name: ');
    const typeKeyResult = provider.provideCompletionItems(
      { getValue: () => 'nodes:\n  - name: A\n    ty', getLineContent: () => '    ty' },
      { lineNumber: 3, column: 7 }
    );
    const typeKeySuggestion = typeKeyResult.suggestions.find((item) => item.label === 'type');
    expect(typeKeySuggestion.command).toEqual({
      id: 'editor.action.triggerSuggest',
      title: 'Trigger Type Suggestions',
    });

    const typeResult = provider.provideCompletionItems(
      { getValue: () => 'nodes:\n  - name: A\n    type: ro', getLineContent: () => '    type: ro' },
      { lineNumber: 3, column: 13 }
    );
    const routerSuggestion = typeResult.suggestions.find((item) => item.label === 'router');
    expect(routerSuggestion).toBeTruthy();
    expect(routerSuggestion.insertText).toBe('router\n$0');
    expect(routerSuggestion.insertTextRules).toBe(4);
    expect(routerSuggestion.command).toEqual({
      id: 'editor.action.triggerSuggest',
      title: 'Trigger Next Step Suggestions',
    });

    const linkTypeResult = provider.provideCompletionItems(
      { getValue: () => 'links:\n  - from: A\n    to: B\n    type: di', getLineContent: () => '    type: di' },
      { lineNumber: 4, column: 13 }
    );
    const directedSuggestion = linkTypeResult.suggestions.find((item) => item.label === 'directed');
    expect(directedSuggestion).toBeTruthy();
    expect(directedSuggestion.insertText).toBe('directed\n$0');
    expect(directedSuggestion.insertTextRules).toBe(4);
    expect(directedSuggestion.command).toEqual({
      id: 'editor.action.triggerSuggest',
      title: 'Trigger Next Step Suggestions',
    });

    const nameValueResult = provider.provideCompletionItems(
      { getValue: () => 'nodes:\n  - name: foobar', getLineContent: () => '  - name: foobar' },
      { lineNumber: 2, column: 17 }
    );
    expect(nameValueResult).toBeUndefined();

    const endpointWithoutNodes = provider.provideCompletionItems(
      { getValue: () => 'links:\n  - from: ', getLineContent: () => '  - from: ' },
      { lineNumber: 2, column: 11 }
    );
    expect(endpointWithoutNodes).toBeUndefined();

    const endpointWithNodes = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: A\nlinks:\n  - from: ',
        getLineContent: () => '  - from: ',
      },
      { lineNumber: 4, column: 11 }
    );
    const fromNodeSuggestion = endpointWithNodes.suggestions.find((item) => item.label === 'A');
    expect(fromNodeSuggestion).toBeTruthy();
    expect(fromNodeSuggestion.command).toEqual({
      id: 'editor.action.triggerSuggest',
      title: 'Trigger Endpoint Suggestions',
    });

    const endpointFromSuffix = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: A\nlinks:\n  - from: A',
        getLineContent: () => '  - from: A',
      },
      { lineNumber: 4, column: 12 }
    );
    expect(endpointFromSuffix.suggestions.map((item) => item.label)).toEqual([':']);
    expect(endpointFromSuffix.suggestions[0].insertText).toBe(':');

    const endpointToWithNodes = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: A\nlinks:\n  - from: A\n    to: ',
        getLineContent: () => '    to: ',
      },
      { lineNumber: 5, column: 9 }
    );
    const toNodeSuggestion = endpointToWithNodes.suggestions.find((item) => item.label === 'A');
    expect(toNodeSuggestion).toBeTruthy();
    expect(toNodeSuggestion.command).toEqual({
      id: 'editor.action.triggerSuggest',
      title: 'Trigger Endpoint Suggestions',
    });

    const endpointToSuffix = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: A\nlinks:\n  - from: A\n    to: A',
        getLineContent: () => '    to: A',
      },
      { lineNumber: 5, column: 10 }
    );
    expect(endpointToSuffix.suggestions.map((item) => item.label)).toEqual([':']);
    expect(endpointToSuffix.suggestions[0].insertText).toBe(':');

    const linkAfterLabelResult = provider.provideCompletionItems(
      {
        getValue: () => 'links:\n  - from: A\n    to: B\n    label: my_link_label\n  ',
        getLineContent: () => '  ',
      },
      { lineNumber: 5, column: 3 }
    );
    expect(linkAfterLabelResult.suggestions.map((item) => item.label)).toEqual(['- from', '  type']);

    const rootResult = provider.provideCompletionItems(
      { getValue: () => '', getLineContent: () => '' },
      { lineNumber: 1, column: 1 }
    );
    expect(rootResult.suggestions.map((item) => item.label)).toEqual(['nodes', 'links']);

    const rootAfterNodesResult = provider.provideCompletionItems(
      { getValue: () => 'nodes:\n  - name: A\n', getLineContent: () => '' },
      { lineNumber: 3, column: 1 }
    );
    expect(rootAfterNodesResult.suggestions.map((item) => item.label)).toEqual(['- links:']);

    const rootBeforeLinksResult = provider.provideCompletionItems(
      { getValue: () => '\nlinks:\n  - from: A\n    to: B', getLineContent: () => '' },
      { lineNumber: 1, column: 1 }
    );
    expect(rootBeforeLinksResult.suggestions.map((item) => item.label)).toEqual(['- nodes:']);

    const nodesResult = provider.provideCompletionItems(
      { getValue: () => 'no', getLineContent: () => 'no' },
      { lineNumber: 1, column: 3 }
    );
    const nodesSuggestion = nodesResult.suggestions.find((item) => item.label === 'nodes');
    expect(nodesSuggestion.insertText).toBe('nodes:\n  - name: ');

    const linksResult = provider.provideCompletionItems(
      { getValue: () => 'li', getLineContent: () => 'li' },
      { lineNumber: 1, column: 3 }
    );
    const linksSuggestion = linksResult.suggestions.find((item) => item.label === 'links');
    expect(linksSuggestion.insertText).toBe('links:\n  - from: ');

    const nestedNodesKeyResult = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: subgraph1\n    no',
        getLineContent: () => '    no',
      },
      { lineNumber: 3, column: 7 }
    );
    const nestedNodesSuggestion = nestedNodesKeyResult.suggestions.find((item) => item.label === 'nodes');
    expect(nestedNodesSuggestion).toBeTruthy();
    expect(nestedNodesSuggestion.insertText).toBe('nodes:\n  - name: ');

    const nestedLinksKeyResult = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: subgraph1\n    li',
        getLineContent: () => '    li',
      },
      { lineNumber: 3, column: 7 }
    );
    const nestedLinksSuggestion = nestedLinksKeyResult.suggestions.find((item) => item.label === 'links');
    expect(nestedLinksSuggestion).toBeTruthy();
    expect(nestedLinksSuggestion.insertText).toBe('links:\n  - from: ');

    const nestedBoundaryLinksResult = provider.provideCompletionItems(
      {
        getValue: () =>
          'nodes:\n  - name: node-1\n    type: router\n  - name: subgraph\n    nodes:\n      - name: subnode-1\n      - name: subnode-2\n      ',
        getLineContent: () => '      ',
      },
      { lineNumber: 8, column: 7 }
    );
    const nestedBoundaryLinksSuggestion = nestedBoundaryLinksResult.suggestions.find((item) => item.label === '  links');
    expect(nestedBoundaryLinksSuggestion).toBeTruthy();
    expect(nestedBoundaryLinksSuggestion.insertText).toBe('    links:\n      - from: ');

    const nextNodeAfterTypeResult = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: foobar\n    type: router\n    ',
        getLineContent: () => '    ',
      },
      { lineNumber: 4, column: 5 }
    );
    const nextNodeSuggestion = nextNodeAfterTypeResult.suggestions.find((item) => item.label === '- name');
    expect(nextNodeSuggestion).toBeTruthy();
    expect(nextNodeSuggestion.insertText).toBe('  - name: ');
    expect(nextNodeSuggestion.range.startColumn).toBe(1);

    const continueNodeAfterNameResult = provider.provideCompletionItems(
      {
        getValue: () => 'nodes:\n  - name: foobar\n  ',
        getLineContent: () => '  ',
      },
      { lineNumber: 3, column: 3 }
    );
    expect(continueNodeAfterNameResult.suggestions.map((item) => item.label)).toEqual([
      '- name',
      '  type',
      '  ports',
      '  nodes',
      '  links',
    ]);
    const continueTypeSuggestion = continueNodeAfterNameResult.suggestions.find((item) => item.label === '  type');
    expect(continueTypeSuggestion).toBeTruthy();
    expect(continueTypeSuggestion.insertText).toBe('    type: ');
    expect(continueTypeSuggestion.range.startColumn).toBe(1);
  });
});

describe('helpers', () => {
  it('extractSvg returns svg fragment from mixed payload', () => {
    const payload = 'prefix <svg width="10" height="5"><g/></svg> suffix';
    expect(extractSvg(payload)).toBe('<svg width="10" height="5"><g/></svg>');
  });

  it('parseSvgDocument prefers viewBox when width/height are percentages', () => {
    const parsed = parseSvgDocument(
      '<svg width="100%" height="100%" viewBox="0 0 300 120"><g id="x"/></svg>'
    );
    expect(parsed.width).toBe(300);
    expect(parsed.height).toBe(120);
    expect(parsed.inner).toContain('id="x"');
  });

  it('applySvgColorScheme overrides previous color-scheme style', () => {
    const input = '<svg style="fill: red; color-scheme: light;"><g/></svg>';
    const output = applySvgColorScheme(input, 'dark');
    expect(output).toContain('fill: red; color-scheme: dark;');
  });

  it('formatAjvErrors maps ajv errors to readable path strings', () => {
    const errors = formatAjvErrors([
      { instancePath: '/nodes/0/name', message: 'must be string' },
      { instancePath: '', message: 'must be object' },
    ]);
    expect(errors).toEqual(['/nodes/0/name: must be string', '/: must be object']);
  });

  it('normalizeGraphInputForValidation coerces nested label-like keys to strings', () => {
    const normalized = normalizeGraphInputForValidation({
      nodes: [{ name: 10, nodes: [{ name: true }] }],
      links: [{ from: 1, to: 2, label: 300, id: 7 }],
    });

    expect(normalized).toEqual({
      nodes: [{ name: '10', nodes: [{ name: 'true' }] }],
      links: [{ from: '1', to: '2', label: '300', id: '7' }],
    });
  });

  it('getYamlAutocompleteContext returns root key context', () => {
    const yaml = 'no';
    const context = getYamlAutocompleteContext(yaml, 1, 3);
    expect(context).toEqual({ kind: 'rootKey', section: 'root', prefix: 'no' });
    expect(getYamlAutocompleteSuggestions(context)).toEqual(['nodes']);
  });

  it('getYamlAutocompleteSuggestions only returns schema root sections', () => {
    const context = { kind: 'rootKey', section: 'root', prefix: '' };
    expect(getYamlAutocompleteSuggestions(context)).toEqual(['nodes', 'links']);
  });

  it('getYamlAutocompleteSuggestions only returns missing root sections', () => {
    const context = { kind: 'rootKey', section: 'root', prefix: '' };
    expect(getYamlAutocompleteSuggestions(context, { rootSectionPresence: new Set(['nodes']) })).toEqual(['links']);
    expect(getYamlAutocompleteSuggestions(context, { rootSectionPresence: new Set(['nodes', 'links']) })).toEqual([]);
  });

  it('getYamlAutocompleteSuggestions returns dashed root boundary items excluding existing sections', () => {
    const context = { kind: 'rootItemKey', section: 'root', prefix: '' };
    expect(getYamlAutocompleteSuggestions(context, { rootSectionPresence: new Set(['nodes']) })).toEqual(['- links:']);
  });

  it('getYamlAutocompleteSuggestions prioritizes next required link key and suppresses used keys', () => {
    const context = { kind: 'key', section: 'links', prefix: '' };
    const suggestions = getYamlAutocompleteSuggestions(context, {
      objectKeys: ['from'],
    });
    expect(suggestions).toEqual(['to']);
  });

  it('getYamlAutocompleteSuggestions suggests endpoint values and from-port suffix transition', () => {
    const entities = {
      nodeNames: ['A', 'B'],
      portsByNode: new Map([
        ['A', new Set(['eth0', 'eth1'])],
        ['B', new Set(['eth2'])],
      ]),
    };
    const fromSuffix = getYamlAutocompleteSuggestions(
      { kind: 'endpointValue', section: 'links', endpoint: 'from', prefix: 'A' },
      { state: 'link.endpoint.value', entities }
    );
    expect(fromSuffix).toEqual([':']);

    const toSuffix = getYamlAutocompleteSuggestions(
      { kind: 'endpointValue', section: 'links', endpoint: 'to', prefix: 'A' },
      { state: 'link.endpoint.value', entities }
    );
    expect(toSuffix).toEqual([':']);

    const freeTextPort = getYamlAutocompleteSuggestions(
      { kind: 'endpointValue', section: 'links', endpoint: 'from', prefix: 'A:et' },
      { state: 'link.endpoint.value', entities }
    );
    expect(freeTextPort).toEqual([]);
  });

  it('getYamlAutocompleteContext returns node key context under nodes section', () => {
    const yaml = 'nodes:\n  - na';
    const context = getYamlAutocompleteContext(yaml, 2, 7);
    expect(context).toEqual({ kind: 'itemKey', section: 'nodes', prefix: 'na' });
    expect(getYamlAutocompleteSuggestions(context)).toEqual(['- name']);
  });

  it('getYamlAutocompleteContext returns root item context on empty line after all content', () => {
    const yaml = 'nodes:\n  - name: A\n';
    const context = getYamlAutocompleteContext(yaml, 3, 1);
    expect(context).toEqual({ kind: 'rootItemKey', section: 'root', prefix: '' });
  });

  it('getYamlAutocompleteContext returns link key context under links section', () => {
    const yaml = 'links:\n  - from: A\n    la';
    const context = getYamlAutocompleteContext(yaml, 3, 7);
    expect(context).toEqual({ kind: 'key', section: 'links', prefix: 'la' });
    expect(getYamlAutocompleteSuggestions(context)).toEqual(['label']);
  });

  it('getYamlAutocompleteContext keeps indented line under section item context', () => {
    const yaml = 'nodes:\n  - name: A\n  ';
    const context = getYamlAutocompleteContext(yaml, 3, 5);
    expect(context).toEqual({ kind: 'itemKey', section: 'nodes', prefix: '' });
    expect(getYamlAutocompleteSuggestions(context, { itemContextKeys: ['name'], canContinueItemContext: true })).toEqual(
      ['- name', '  type', '  ports', '  nodes', '  links']
    );
  });

  it('getYamlAutocompleteContext treats blank continuation after node type as next item context', () => {
    const yaml = 'nodes:\n  - name: foobar\n    type: router\n    ';
    const context = getYamlAutocompleteContext(yaml, 4, 5);
    expect(context).toEqual({ kind: 'itemKey', section: 'nodes', prefix: '' });
    expect(
      getYamlAutocompleteSuggestions(context, { itemContextKeys: ['name', 'type'], canContinueItemContext: true })
    ).toEqual(['- name']);
  });

  it('getYamlAutocompleteSuggestions omits node keys already defined on the same node', () => {
    const context = { kind: 'itemKey', section: 'nodes', prefix: '' };
    expect(
      getYamlAutocompleteSuggestions(context, { itemContextKeys: ['name', 'ports'], canContinueItemContext: true })
    ).toEqual(['- name', '  type', '  nodes', '  links']);
    expect(
      getYamlAutocompleteSuggestions(context, { itemContextKeys: ['name', 'type'], canContinueItemContext: true })
    ).toEqual(['- name']);
  });

  it('computeIndentBackspaceDeleteCount removes up to previous indent boundary on empty line', () => {
    expect(computeIndentBackspaceDeleteCount('    ', 5)).toBe(2);
    expect(computeIndentBackspaceDeleteCount('  ', 3)).toBe(2);
    expect(computeIndentBackspaceDeleteCount('   ', 4)).toBe(1);
    expect(computeIndentBackspaceDeleteCount('  text', 3)).toBe(0);
  });

  it('getYamlAutocompleteContext returns node type value context', () => {
    const yaml = 'nodes:\n  - name: A\n    type: ro';
    const context = getYamlAutocompleteContext(yaml, 3, 13);
    expect(context).toEqual({ kind: 'nodeTypeValue', section: 'nodes', prefix: 'ro' });
    expect(getYamlAutocompleteSuggestions(context)).toEqual([]);
    expect(getYamlAutocompleteSuggestions(context, { nodeTypeSuggestions: ['router', 'switch'] })).toContain('router');
  });

  it('getYamlAutocompleteContext returns link type value context', () => {
    const yaml = 'links:\n  - from: A\n    to: B\n    type: di';
    const context = getYamlAutocompleteContext(yaml, 4, 13);
    expect(context).toEqual({ kind: 'linkTypeValue', section: 'links', prefix: 'di' });
    expect(getYamlAutocompleteSuggestions(context)).toEqual([]);
    expect(getYamlAutocompleteSuggestions(context, { linkTypeSuggestions: ['directed', 'undirected'] })).toContain(
      'directed'
    );
  });

  it('getYamlAutocompleteSuggestions never returns id as a key', () => {
    const nodeKeySuggestions = getYamlAutocompleteSuggestions({ kind: 'key', section: 'nodes', prefix: 'i' });
    const linkKeySuggestions = getYamlAutocompleteSuggestions({ kind: 'key', section: 'links', prefix: 'i' });
    expect(nodeKeySuggestions).toEqual([]);
    expect(linkKeySuggestions).toEqual([]);
  });

  it('getYamlAutocompleteContext returns endpoint value context inside links', () => {
    const yaml = 'links:\n  - from: A:e';
    const context = getYamlAutocompleteContext(yaml, 2, 14);
    expect(context).toEqual({ kind: 'endpointValue', section: 'links', endpoint: 'from', prefix: 'A:e' });
  });
});
