import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import YAML from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';
import Editor from '@monaco-editor/react';
import { UncontrolledReactSVGPanZoom, fitToViewer as fitValueToViewer } from 'react-svg-pan-zoom';

const API_BASE = '/api';
const DEBOUNCE_MS = 450;
const STRING_COERCION_KEYS = new Set(['name', 'label', 'id', 'from', 'to']);

const INITIAL_YAML = `nodes:
  - name: A
  - name: B
links:
  - from: A
    to: B
`;

export function formatAjvErrors(errors = []) {
  return errors.map((err) => {
    const path = err.instancePath || '/';
    return `${path}: ${err.message}`;
  });
}

export function extractSvg(text) {
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start === -1 || end === -1) {
    return '';
  }
  return text.slice(start, end + 6);
}

export function parseSvgDocument(svgText) {
  if (!svgText) {
    return { width: 1, height: 1, viewBox: null, inner: '' };
  }
  const svgMatch = svgText.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (svgMatch) {
    const attrs = svgMatch[1] || '';
    const inner = svgMatch[2] || '';
    const widthAttr = (attrs.match(/\bwidth\s*=\s*["']([^"']+)["']/i) || [])[1] || null;
    const heightAttr = (attrs.match(/\bheight\s*=\s*["']([^"']+)["']/i) || [])[1] || null;
    const viewBoxAttr = (attrs.match(/\bviewBox\s*=\s*["']([^"']+)["']/i) || [])[1] || null;
    const widthIsPercent = widthAttr ? widthAttr.trim().endsWith('%') : false;
    const heightIsPercent = heightAttr ? heightAttr.trim().endsWith('%') : false;
    const width = widthAttr && !widthIsPercent ? Number.parseFloat(widthAttr) : NaN;
    const height = heightAttr && !heightIsPercent ? Number.parseFloat(heightAttr) : NaN;
    let parsedWidth = Number.isFinite(width) && width > 0 ? width : NaN;
    let parsedHeight = Number.isFinite(height) && height > 0 ? height : NaN;

    if ((!parsedWidth || !parsedHeight) && viewBoxAttr) {
      const parts = viewBoxAttr.trim().split(/\s+/).map((value) => Number.parseFloat(value));
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
        parsedWidth = Math.max(1, parts[2]);
        parsedHeight = Math.max(1, parts[3]);
      }
    }

    return {
      width: parsedWidth || 1,
      height: parsedHeight || 1,
      viewBox: viewBoxAttr,
      inner,
    };
  }

  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    const widthAttr = root.getAttribute('width');
    const heightAttr = root.getAttribute('height');
    const viewBox = root.getAttribute('viewBox');
    const widthIsPercent = widthAttr ? widthAttr.trim().endsWith('%') : false;
    const heightIsPercent = heightAttr ? heightAttr.trim().endsWith('%') : false;
    const width = widthAttr && !widthIsPercent ? Number.parseFloat(widthAttr) : NaN;
    const height = heightAttr && !heightIsPercent ? Number.parseFloat(heightAttr) : NaN;

    let parsedWidth = Number.isFinite(width) && width > 0 ? width : NaN;
    let parsedHeight = Number.isFinite(height) && height > 0 ? height : NaN;

    if ((!parsedWidth || !parsedHeight) && viewBox) {
      const parts = viewBox.trim().split(/\s+/).map((value) => Number.parseFloat(value));
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
        parsedWidth = Math.max(1, parts[2]);
        parsedHeight = Math.max(1, parts[3]);
      }
    }

    return {
      width: parsedWidth || 1,
      height: parsedHeight || 1,
      viewBox,
      inner: root.innerHTML || '',
    };
  } catch (_err) {
    return { width: 1, height: 1, viewBox: null, inner: '' };
  }
}

export function applySvgColorScheme(svgText, theme) {
  if (!svgText) {
    return '';
  }
  const mode = theme === 'dark' ? 'dark' : 'light';
  const openTagMatch = svgText.match(/<svg\b([^>]*)>/i);
  if (!openTagMatch) {
    return svgText;
  }
  const attrs = openTagMatch[1] || '';
  const styleMatch = attrs.match(/\bstyle\s*=\s*["']([^"']*)["']/i);
  let nextAttrs = attrs;
  if (styleMatch) {
    const prevStyle = styleMatch[1] || '';
    const cleaned = prevStyle
      .replace(/(?:^|;)\s*color-scheme\s*:[^;]*/gi, '')
      .trim()
      .replace(/^;|;$/g, '');
    const nextStyle = `${cleaned ? `${cleaned}; ` : ''}color-scheme: ${mode};`;
    nextAttrs = attrs.replace(styleMatch[0], `style="${nextStyle}"`);
  } else {
    nextAttrs = `${attrs} style="color-scheme: ${mode};"`;
  }
  return svgText.replace(openTagMatch[0], `<svg${nextAttrs}>`);
}

export function normalizeGraphInputForValidation(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGraphInputForValidation(item));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, fieldValue]) => {
      if (
        STRING_COERCION_KEYS.has(key) &&
        (typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || typeof fieldValue === 'bigint')
      ) {
        acc[key] = String(fieldValue);
        return acc;
      }
      acc[key] = normalizeGraphInputForValidation(fieldValue);
      return acc;
    }, {});
  }
  return value;
}

export default function App() {
  const [yamlText, setYamlText] = useState(INITIAL_YAML);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState('');
  const [svgText, setSvgText] = useState('');
  const [status, setStatus] = useState('Loading schema...');
  const [errors, setErrors] = useState([]);
  const [theme, setTheme] = useState('light');
  const [isManualView, setIsManualView] = useState(false);
  const [viewerSize, setViewerSize] = useState({ width: 640, height: 420 });

  const validateRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const previewShellRef = useRef(null);
  const viewerRef = useRef(null);
  const suppressViewEventsRef = useRef(false);
  const [svgObjectUrl, setSvgObjectUrl] = useState('');

  const svgDoc = useMemo(() => parseSvgDocument(svgText), [svgText]);
  const themedSvgText = useMemo(() => applySvgColorScheme(svgText, theme), [svgText, theme]);
  const canDownload = useMemo(() => svgText.trim().length > 0, [svgText]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    async function loadSchema() {
      try {
        const response = await fetch(`${API_BASE}/schemas/minimal-input.schema.json`);
        if (!response.ok) {
          throw new Error(`Schema request failed with ${response.status}`);
        }
        const nextSchema = await response.json();
        if (cancelled) {
          return;
        }
        const ajv = new Ajv2020({ allErrors: true, strict: false });
        validateRef.current = ajv.compile(nextSchema);
        setSchema(nextSchema);
        setSchemaError('');
        setStatus('Schema loaded.');
      } catch (err) {
        setSchemaError(err.message || 'Failed to load schema.');
        setStatus('Schema load failed.');
      }
    }
    loadSchema();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!schema || schemaError) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const parsed = YAML.load(yamlText);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setErrors(['Root YAML value must be an object.']);
          setStatus('YAML parse error.');
          return;
        }

        const normalized = normalizeGraphInputForValidation(parsed);
        const validate = validateRef.current;
        const isValid = validate(normalized);
        if (!isValid) {
          setErrors(formatAjvErrors(validate.errors));
          setStatus('JSON schema validation failed.');
          return;
        }

        if (abortRef.current) {
          abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;

        setErrors([]);
        setStatus('Rendering SVG...');
        const response = await fetch(`${API_BASE}/render/svg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized),
          signal: controller.signal,
        });

        if (requestId !== requestIdRef.current) {
          return;
        }
        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Render failed (${response.status}): ${bodyText.slice(0, 260)}`);
        }

        const contentType = response.headers.get('content-type') || '';
        let nextSvg = '';
        if (contentType.includes('application/json')) {
          const body = await response.json();
          nextSvg = body.svg || body.data || body.result || '';
        } else {
          const text = await response.text();
          nextSvg = extractSvg(text);
        }
        if (!nextSvg) {
          throw new Error('Render response did not contain SVG.');
        }

        setSvgText(nextSvg);
        setStatus('Rendered.');
      } catch (err) {
        if (err.name === 'AbortError') {
          return;
        }
        setErrors([err.message || 'Unexpected error.']);
        setStatus('Render failed.');
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [yamlText, schema, schemaError]);

  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell) {
      return;
    }

    const updateSize = () => {
      setViewerSize({
        width: Math.max(200, Math.floor(shell.clientWidth)),
        height: Math.max(200, Math.floor(shell.clientHeight)),
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, []);

  function applyFit() {
    const viewer = viewerRef.current;
    if (!viewer || !svgText) {
      return;
    }

    suppressViewEventsRef.current = true;
    try {
      viewer.fitToViewer('center', 'center');
    } finally {
      window.setTimeout(() => {
        suppressViewEventsRef.current = false;
      }, 0);
    }
  }

  useEffect(() => {
    if (!svgText || isManualView) {
      return;
    }
    const id = requestAnimationFrame(() => applyFit());
    return () => cancelAnimationFrame(id);
  }, [svgText, svgDoc.width, svgDoc.height, viewerSize.width, viewerSize.height, isManualView]);

  useEffect(() => {
    if (!themedSvgText) {
      setSvgObjectUrl('');
      return;
    }
    const blob = new Blob([themedSvgText], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    setSvgObjectUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [themedSvgText]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function onUserPanZoom(nextValue) {
    if (suppressViewEventsRef.current) {
      return;
    }
    if (!nextValue || typeof nextValue !== 'object') {
      setIsManualView(true);
      return;
    }
    // Re-enable auto-fit when the user uses the toolbar fit action.
    const fitValue = fitValueToViewer(nextValue, 'center', 'center');
    const nearFit =
      Math.abs(nextValue.a - fitValue.a) < 0.0001 &&
      Math.abs(nextValue.e - fitValue.e) < 1 &&
      Math.abs(nextValue.f - fitValue.f) < 1;
    setIsManualView(!nearFit);
  }

  function downloadSvg() {
    if (!canDownload) {
      return;
    }
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'graph.svg';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app">
      <section className="pane pane-left">
        <div className="pane-header">
          <h1>GraphEditor</h1>
          <p>YAML input</p>
        </div>
        <div className="editor-shell" aria-label="YAML editor">
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={yamlText}
            onChange={(value) => setYamlText(value || '')}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 14,
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      </section>
      <section className="pane pane-right">
        <div className="pane-header row">
          <div>
            <h2>SVG Preview</h2>
            <p>{status}</p>
          </div>
          <div className="controls">
            <button type="button" onClick={downloadSvg} disabled={!canDownload}>
              Download SVG
            </button>
            <button
              type="button"
              className="mode-btn"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>
        </div>
        <div className="errors" role="status">
          {schemaError && <div>{schemaError}</div>}
          {!schemaError &&
            errors.map((err, idx) => (
              <div key={`${idx}-${err}`} className="error-item">
                {err}
              </div>
            ))}
        </div>
        <div className="preview-shell" ref={previewShellRef}>
          {svgText ? (
            <UncontrolledReactSVGPanZoom
              ref={viewerRef}
              width={viewerSize.width}
              height={viewerSize.height}
              defaultTool="auto"
              detectAutoPan={false}
              detectWheel
              background="transparent"
              SVGBackground="transparent"
              toolbarProps={{ position: 'right', SVGAlignX: 'center', SVGAlignY: 'center' }}
              miniatureProps={{ position: 'none' }}
              onPan={onUserPanZoom}
              onZoom={onUserPanZoom}
              scaleFactorOnWheel={1.06}
            >
              <svg width={svgDoc.width} height={svgDoc.height} viewBox={`0 0 ${svgDoc.width} ${svgDoc.height}`}>
                <image
                  href={svgObjectUrl || ''}
                  width={svgDoc.width}
                  height={svgDoc.height}
                  preserveAspectRatio="xMidYMid meet"
                />
              </svg>
            </UncontrolledReactSVGPanZoom>
          ) : (
            <div className="preview-empty">Rendered SVG will appear here.</div>
          )}
        </div>
      </section>
    </main>
  );
}
