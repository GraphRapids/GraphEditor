import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App, {
  applySvgColorScheme,
  extractSvg,
  formatAjvErrors,
  normalizeGraphInputForValidation,
  parseSvgDocument,
} from './App';

const { fitToViewerSpy } = vi.hoisted(() => ({
  fitToViewerSpy: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      aria-label="Monaco editor"
    />
  ),
}));

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
    if (url.endsWith('/api/render/svg')) {
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
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/render/svg')).length;
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fitToViewerSpy.mockReset();
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
});
