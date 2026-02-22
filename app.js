import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import YAML from "https://esm.sh/js-yaml@4.1.0";
import Ajv2020 from "https://esm.sh/ajv@8.17.1/dist/2020";
import htm from "https://esm.sh/htm@3.1.1";

const API_BASE = "/api";
const DEBOUNCE_MS = 450;
const MIN_SCALE = 0.05;
const MAX_SCALE = 6;
const html = htm.bind(React.createElement);

const INITIAL_YAML = `nodes:
  - name: A
  - name: B
links:
  - from: A
    to: B
`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatAjvErrors(errors = []) {
  return errors.map((err) => {
    const path = err.instancePath || "/";
    return `${path}: ${err.message}`;
  });
}

function extractSvg(text) {
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start === -1 || end === -1) {
    return "";
  }
  return text.slice(start, end + 6);
}

function parseSvgSize(svg) {
  if (!svg) {
    return { width: 1, height: 1 };
  }
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    const widthAttr = root.getAttribute("width");
    const heightAttr = root.getAttribute("height");
    const viewBoxAttr = root.getAttribute("viewBox");
    const widthIsPercent = widthAttr ? widthAttr.trim().endsWith("%") : false;
    const heightIsPercent = heightAttr ? heightAttr.trim().endsWith("%") : false;
    const width = widthAttr && !widthIsPercent ? Number.parseFloat(widthAttr) : NaN;
    const height = heightAttr && !heightIsPercent ? Number.parseFloat(heightAttr) : NaN;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
    if (viewBoxAttr) {
      const parts = viewBoxAttr.trim().split(/\s+/).map((v) => Number.parseFloat(v));
      if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
        return { width: Math.max(1, parts[2]), height: Math.max(1, parts[3]) };
      }
    }
  } catch (_err) {
    // Keep fallback size when SVG parsing fails.
  }
  return { width: 1, height: 1 };
}

function computeFitView(shellWidth, shellHeight, svgWidth, svgHeight, fitMode) {
  const widthScale = shellWidth / svgWidth;
  const heightScale = shellHeight / svgHeight;
  const fitScale = fitMode === "width" ? widthScale : Math.min(widthScale, heightScale);
  const scale = clamp(Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1, MIN_SCALE, MAX_SCALE);

  const scaledWidth = svgWidth * scale;
  const scaledHeight = svgHeight * scale;
  const x = fitMode === "width" ? (shellWidth - scaledWidth) / 2 : (shellWidth - scaledWidth) / 2;
  const y = fitMode === "width" ? 0 : (shellHeight - scaledHeight) / 2;

  return { scale, x, y };
}

function App() {
  const [yamlText, setYamlText] = useState(INITIAL_YAML);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState("");
  const [svgText, setSvgText] = useState("");
  const [status, setStatus] = useState("Loading schema...");
  const [errors, setErrors] = useState([]);
  const [fitMode, setFitMode] = useState("page");
  const [theme, setTheme] = useState("light");
  const [isManualView, setIsManualView] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  const validateRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const previewShellRef = useRef(null);
  const dragRef = useRef(null);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
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
        setSchemaError("");
        setStatus("Schema loaded.");
      } catch (err) {
        setSchemaError(err.message || "Failed to load schema.");
        setStatus("Schema load failed.");
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
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          setErrors(["Root YAML value must be an object."]);
          setStatus("YAML parse error.");
          return;
        }

        const validate = validateRef.current;
        const isValid = validate(parsed);
        if (!isValid) {
          setErrors(formatAjvErrors(validate.errors));
          setStatus("JSON schema validation failed.");
          return;
        }

        if (abortRef.current) {
          abortRef.current.abort();
        }
        const controller = new AbortController();
        abortRef.current = controller;

        setErrors([]);
        setStatus("Rendering SVG...");
        const response = await fetch(`${API_BASE}/render/svg`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
          signal: controller.signal,
        });

        if (requestId !== requestIdRef.current) {
          return;
        }
        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(`Render failed (${response.status}): ${bodyText.slice(0, 260)}`);
        }

        const contentType = response.headers.get("content-type") || "";
        let nextSvg = "";
        if (contentType.includes("application/json")) {
          const body = await response.json();
          nextSvg = body.svg || body.data || body.result || "";
        } else {
          const text = await response.text();
          nextSvg = extractSvg(text);
        }
        if (!nextSvg) {
          throw new Error("Render response did not contain SVG.");
        }
        setSvgText(nextSvg);
        setIsManualView(false);
        setStatus("Rendered.");
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        setErrors([err.message || "Unexpected error."]);
        setStatus("Render failed.");
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [yamlText, schema, schemaError]);

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

  const svgSize = useMemo(() => parseSvgSize(svgText), [svgText]);

  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell || !svgText) {
      return;
    }

    const applyFitIfNeeded = () => {
      const shellWidth = Math.max(1, shell.clientWidth);
      const shellHeight = Math.max(1, shell.clientHeight);
      const nextView = computeFitView(shellWidth, shellHeight, svgSize.width, svgSize.height, fitMode);
      if (!isManualView) {
        setView(nextView);
      }
    };

    applyFitIfNeeded();
    const resizeObserver = new ResizeObserver(applyFitIfNeeded);
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, [svgText, svgSize.width, svgSize.height, fitMode, isManualView]);

  useEffect(() => {
    const onMouseMove = (event) => {
      const drag = dragRef.current;
      if (!drag || !drag.active) {
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setView((prev) => ({ ...prev, x: drag.startPanX + dx, y: drag.startPanY + dy }));
    };

    const onMouseUp = () => {
      if (dragRef.current?.active) {
        dragRef.current.active = false;
        setIsDragging(false);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const canDownload = useMemo(() => svgText.trim().length > 0, [svgText]);

  function applyFitNow(mode = fitMode) {
    const shell = previewShellRef.current;
    if (!shell || !svgText) {
      return;
    }
    const shellWidth = Math.max(1, shell.clientWidth);
    const shellHeight = Math.max(1, shell.clientHeight);
    setView(computeFitView(shellWidth, shellHeight, svgSize.width, svgSize.height, mode));
  }

  function zoomAtPoint(shellX, shellY, factor) {
    setIsManualView(true);
    setView((prev) => {
      const nextScale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
      const graphX = (shellX - prev.x) / prev.scale;
      const graphY = (shellY - prev.y) / prev.scale;
      const nextX = shellX - graphX * nextScale;
      const nextY = shellY - graphY * nextScale;
      return { scale: nextScale, x: nextX, y: nextY };
    });
  }

  function zoomAtCenter(factor) {
    const shell = previewShellRef.current;
    if (!shell) {
      return;
    }
    zoomAtPoint(shell.clientWidth / 2, shell.clientHeight / 2, factor);
  }

  function handleWheel(event) {
    if (!svgText) {
      return;
    }
    event.preventDefault();
    const shell = previewShellRef.current;
    if (!shell) {
      return;
    }
    const rect = shell.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAtPoint(x, y, factor);
  }

  function handleMouseDown(event) {
    if (!svgText || event.button !== 0) {
      return;
    }
    const current = viewRef.current;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: current.x,
      startPanY: current.y,
    };
    setIsManualView(true);
    setIsDragging(true);
  }

  function resetView() {
    setIsManualView(false);
    applyFitNow();
  }

  function setModeAndRefit(mode) {
    setFitMode(mode);
    setIsManualView(false);
    applyFitNow(mode);
  }

  function downloadSvg() {
    if (!canDownload) {
      return;
    }
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "graph.svg";
    link.click();
    URL.revokeObjectURL(url);
  }

  return html`
    <main className="app">
      <section className="pane pane-left">
        <div className="pane-header">
          <h1>GraphEditor</h1>
          <p>YAML input</p>
        </div>
        <textarea
          value=${yamlText}
          onChange=${(e) => setYamlText(e.target.value)}
          spellCheck=${false}
          className="yaml-editor"
          aria-label="YAML editor"
        />
      </section>
      <section className="pane pane-right">
        <div className="pane-header row">
          <div>
            <h2>SVG Preview</h2>
            <p>${status}</p>
          </div>
          <div className="controls">
            <button type="button" onClick=${() => zoomAtCenter(1.15)}>Zoom +</button>
            <button type="button" onClick=${() => zoomAtCenter(1 / 1.15)}>Zoom -</button>
            <button type="button" onClick=${resetView}>Reset</button>
            <button
              type="button"
              className=${fitMode === "page" ? "active" : ""}
              onClick=${() => setModeAndRefit("page")}
            >
              Fit Page
            </button>
            <button
              type="button"
              className=${fitMode === "width" ? "active" : ""}
              onClick=${() => setModeAndRefit("width")}
            >
              Fit Width
            </button>
            <button type="button" onClick=${downloadSvg} disabled=${!canDownload}>Download SVG</button>
            <button
              type="button"
              className="mode-btn"
              onClick=${() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            >
              ${theme === "light" ? "Dark Mode" : "Light Mode"}
            </button>
          </div>
        </div>
        <div className="errors" role="status">
          ${schemaError ? html`<div>${schemaError}</div>` : null}
          ${!schemaError
            ? errors.map(
                (err, idx) => html`
                  <div key=${`${idx}-${err}`} className="error-item">${err}</div>
                `
              )
            : null}
        </div>
        <div
          className=${`preview-shell ${isDragging ? "is-dragging" : ""}`}
          ref=${previewShellRef}
          onWheel=${handleWheel}
          onMouseDown=${handleMouseDown}
        >
          <div className="svg-preview">
            <div
              className="svg-canvas"
              style=${{
                width: `${svgSize.width * view.scale}px`,
                height: `${svgSize.height * view.scale}px`,
                transform: `translate(${view.x}px, ${view.y}px)`,
              }}
              dangerouslySetInnerHTML=${{ __html: svgText }}
            />
          </div>
        </div>
      </section>
    </main>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
