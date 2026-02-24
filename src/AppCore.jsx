import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import YAML from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';
import Editor from '@monaco-editor/react';
import { UncontrolledReactSVGPanZoom, fitToViewer as fitValueToViewer } from 'react-svg-pan-zoom';

const API_BASE = '/api';
const MIN_DEBOUNCE_MS = 170;
const MAX_DEBOUNCE_MS = 380;
const RETRY_DELAY_MS = 180;
const MAX_RENDER_RETRIES = 1;
const INDENT_SIZE = 2;
const MAX_RENDER_CACHE_SIZE = 50;

const STRING_COERCION_KEYS = new Set(['name', 'label', 'id', 'from', 'to']);
const COLLECTION_KEYS = new Set(['nodes', 'links', 'edges']);
const ROOT_KEYS = ['nodes', 'links', 'edges'];
const NODE_KEYS = ['name', 'type', 'id', 'style', 'nodes', 'links'];
const LINK_KEYS = ['from', 'to', 'label', 'type', 'id', 'style'];
const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'opacity', 'fontSize', 'fontWeight', 'lineStyle'];

const REQUIRED_NODE_ORDER = ['name', 'type', 'id', 'style', 'nodes', 'links'];
const REQUIRED_LINK_ORDER = ['from', 'to', 'label', 'type', 'id', 'style'];
const REQUIRED_STYLE_ORDER = ['fill', 'stroke', 'strokeWidth', 'opacity', 'fontSize', 'fontWeight', 'lineStyle'];

const AUTOCOMPLETE_STATE = {
  ROOT_KEY: 'root.key',
  NODE_KEY: 'node.key',
  LINK_KEY: 'link.key',
  STYLE_KEY: 'style.key',
  STYLE_VALUE: 'style.value',
  NODE_TYPE_VALUE: 'node.type.value',
  LINK_ENDPOINT_VALUE: 'link.endpoint.value',
  NONE: 'none',
};

const NODE_TYPE_SUGGESTIONS = [
  'router',
  'switch',
  'mpls',
  'vpn',
  'firewall',
  'cloud',
  'datacenter',
  'azure',
  'internet',
  'cpe',
  'database',
  'server',
  'host',
  'ran',
  'radio',
  'splitter',
  'devices',
  'satelliteuplink',
  'satellite',
  'broadcast',
  'lan',
  'diagnostics',
  'analytics',
  'monitor',
  'logging',
  'iam',
  'idea',
  'tools',
  'cctv',
  'process',
  'cooling',
  'security',
  'console',
  'gis',
  'city',
  'settlement',
  'sdu',
  'mdu',
  'company',
  'farm',
  'airport',
  'mine',
  'fieldservice',
  'facility',
  'energy',
  'transmission',
  'ip',
  'mobilecore',
  'access',
  'operation',
  'controller',
  'product',
  'consumer',
  'fortinet',
  'juniper',
  'ericsson',
  'huawei',
  'cisco',
  'mikrotik',
];

const STYLE_VALUE_SUGGESTIONS = {
  lineStyle: ['solid', 'dashed', 'dotted'],
  fontWeight: ['normal', 'bold', '500', '600', '700'],
  fill: ['#ffffff', '#e8f4fd', '#0d6e6e', 'transparent'],
  stroke: ['#1f2c2f', '#3b4f52', '#0d6e6e', '#0f172a'],
};

const KEY_DOCUMENTATION = {
  nodes: 'Collection of graph nodes. Supports nested nodes and nested links.',
  links: 'Collection of graph links/edges. Use from/to as node[:port] references.',
  edges: 'Alias for links. Insertion is normalized to links.',
  name: 'Display name for a node. Also used as a default endpoint identifier.',
  id: 'Stable identifier for nodes/links.',
  type: 'Domain node/link type. Node types are schema-driven plus built-in defaults.',
  from: 'Link source endpoint in node or node:port format.',
  to: 'Link destination endpoint in node or node:port format.',
  label: 'Optional display label for links.',
  style: 'Styling object. Supports fill/stroke/line style tokens.',
  fill: 'Node fill color. Typical value: #RRGGBB.',
  stroke: 'Stroke color for nodes/links.',
  strokeWidth: 'Stroke width in pixels.',
  opacity: 'Opacity between 0 and 1.',
  fontSize: 'Text size in pixels.',
  fontWeight: 'Text weight token such as normal or bold.',
  lineStyle: 'Line decoration token: solid, dashed, dotted.',
};

const INITIAL_YAML = `nodes:
  - name: A
  - name: B
links:
  - from: A
    to: B
`;

const NODE_TEMPLATE_SNIPPET =
  '- name: ${1:NodeA}\\n  type: ${2:router}\\n  id: ${3:node-a}\\n  style:\\n    fill: ${4:#e8f4fd}\\n    stroke: ${5:#1f2c2f}\\n$0';

const EDGE_TEMPLATE_SNIPPET =
  '- from: ${1:NodeA}\\n  to: ${2:NodeB}\\n  label: ${3:A-to-B}\\n  type: ${4:solid}\\n  style:\\n    stroke: ${5:#1f2c2f}\\n    lineStyle: ${6:solid}\\n$0';

const EMPTY_COMPLETION_META_CACHE = {
  version: null,
  text: '',
  meta: {
    lines: [''],
    entities: { nodeNames: [], portsByNode: new Map() },
  },
};

class RenderApiError extends Error {
  constructor(kind, message, status = null, retryable = false) {
    super(message);
    this.name = 'RenderApiError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
  }
}

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
    const width = widthAttr && !widthIsPercent ? Number.parseFloat(widthAttr) : Number.NaN;
    const height = heightAttr && !heightIsPercent ? Number.parseFloat(heightAttr) : Number.NaN;
    let parsedWidth = Number.isFinite(width) && width > 0 ? width : Number.NaN;
    let parsedHeight = Number.isFinite(height) && height > 0 ? height : Number.NaN;

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
    const width = widthAttr && !widthIsPercent ? Number.parseFloat(widthAttr) : Number.NaN;
    const height = heightAttr && !heightIsPercent ? Number.parseFloat(heightAttr) : Number.NaN;

    let parsedWidth = Number.isFinite(width) && width > 0 ? width : Number.NaN;
    let parsedHeight = Number.isFinite(height) && height > 0 ? height : Number.NaN;

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

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function lineIndent(line) {
  const match = line.match(/^(\s*)/);
  return match ? match[1].length : 0;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferYamlSection(lines, lineIndex, indent) {
  for (let i = lineIndex; i >= 0; i -= 1) {
    const text = lines[i];
    const match = text.match(/^(\s*)(nodes|links|edges)\s*:\s*$/);
    if (!match) {
      continue;
    }
    const sectionIndent = match[1].length;
    if (sectionIndent < indent || i === lineIndex) {
      const rawSection = match[2] === 'edges' ? 'links' : match[2];
      return { section: rawSection, sectionIndent };
    }
  }
  return { section: 'root', sectionIndent: 0 };
}

function inferParentKey(lines, lineIndex, indent) {
  for (let i = lineIndex; i >= 0; i -= 1) {
    const text = lines[i] || '';
    if (!text.trim()) {
      continue;
    }
    const currentIndent = lineIndent(text);
    if (currentIndent >= indent) {
      continue;
    }
    const keyMatch = text.trim().match(/^(?:-\s*)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*$/);
    if (keyMatch) {
      return keyMatch[1];
    }
  }
  return null;
}

function decodeJsonPointer(path) {
  if (!path) {
    return [];
  }
  return path
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function findSectionLine(lines, sectionKey) {
  const regex = new RegExp(`^\\s*${escapeRegex(sectionKey)}\\s*:\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    if (regex.test(lines[i] || '')) {
      return i;
    }
  }
  return -1;
}

function findListItemLine(lines, sectionLine, index) {
  if (sectionLine < 0 || index < 0) {
    return -1;
  }
  const sectionIndent = lineIndent(lines[sectionLine] || '');
  let seen = -1;
  for (let i = sectionLine + 1; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent <= sectionIndent && /:\s*$/.test(trimmed)) {
      break;
    }
    if (indent === sectionIndent + INDENT_SIZE && /^-\s*/.test(trimmed)) {
      seen += 1;
      if (seen === index) {
        return i;
      }
    }
  }
  return -1;
}

function findKeyInsideListObject(lines, startLine, keyName) {
  if (startLine < 0) {
    return -1;
  }
  const itemIndent = lineIndent(lines[startLine] || '');
  const keyRegex = new RegExp(`^\\s*(?:-\\s*)?${escapeRegex(keyName)}\\s*:`);
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);
    if (i > startLine && indent <= itemIndent && /^-\s*/.test(trimmed)) {
      break;
    }
    if (i > startLine && indent < itemIndent) {
      break;
    }
    if (keyRegex.test(line)) {
      return i;
    }
  }
  return -1;
}

function locateYamlPositionFromPath(text, instancePath) {
  const lines = text.split('\n');
  const segments = decodeJsonPointer(instancePath);
  if (!segments.length) {
    return { lineNumber: 1, column: 1, endColumn: 2 };
  }

  const first = segments[0] === 'edges' ? 'links' : segments[0];
  if (first === 'nodes' || first === 'links') {
    const sectionLine = findSectionLine(lines, first);
    if (sectionLine >= 0) {
      const baseColumn = Math.max(1, (lines[sectionLine] || '').indexOf(first) + 1);
      if (segments.length === 1) {
        return {
          lineNumber: sectionLine + 1,
          column: baseColumn,
          endColumn: baseColumn + first.length,
        };
      }

      const itemSegment = segments[1];
      if (/^\d+$/.test(itemSegment)) {
        const itemLine = findListItemLine(lines, sectionLine, Number.parseInt(itemSegment, 10));
        if (itemLine >= 0) {
          if (segments.length >= 3) {
            const keyName = segments[2];
            const keyLine = findKeyInsideListObject(lines, itemLine, keyName);
            if (keyLine >= 0) {
              const keyColumn = Math.max(1, (lines[keyLine] || '').indexOf(keyName) + 1);
              return {
                lineNumber: keyLine + 1,
                column: keyColumn,
                endColumn: keyColumn + keyName.length,
              };
            }
          }
          return {
            lineNumber: itemLine + 1,
            column: Math.max(1, (lines[itemLine] || '').indexOf('-') + 1),
            endColumn: Math.max(2, (lines[itemLine] || '').indexOf('-') + 2),
          };
        }
      }

      return {
        lineNumber: sectionLine + 1,
        column: baseColumn,
        endColumn: baseColumn + first.length,
      };
    }
  }

  const leaf = segments.at(-1);
  if (leaf && /^\D/.test(leaf)) {
    const leafRegex = new RegExp(`^\\s*(?:-\\s*)?${escapeRegex(leaf)}\\s*:`);
    for (let i = 0; i < lines.length; i += 1) {
      if (leafRegex.test(lines[i] || '')) {
        const col = Math.max(1, (lines[i] || '').indexOf(leaf) + 1);
        return { lineNumber: i + 1, column: col, endColumn: col + leaf.length };
      }
    }
  }

  return { lineNumber: 1, column: 1, endColumn: 2 };
}

function parseYamlSyntaxDiagnostic(error, text) {
  if (!error) {
    return null;
  }
  const lineCount = text.split('\n').length;
  const lineNumber = Math.max(1, Math.min(lineCount, (error.mark?.line || 0) + 1));
  const column = Math.max(1, (error.mark?.column || 0) + 1);
  const message = error.reason || (error.message ? error.message.split('\n')[0] : 'YAML syntax error');
  return {
    message,
    source: 'yaml',
    severity: 'error',
    lineNumber,
    column,
    endLineNumber: lineNumber,
    endColumn: column + 1,
  };
}

function collectGraphEntitiesFromParsed(parsed) {
  const nodeNames = new Set();
  const portsByNode = new Map();
  const seen = new Set();

  function addEndpoint(endpoint) {
    if (typeof endpoint !== 'string') {
      return;
    }
    const [node, port] = endpoint.split(':');
    if (!node) {
      return;
    }
    nodeNames.add(node);
    if (!port) {
      return;
    }
    if (!portsByNode.has(node)) {
      portsByNode.set(node, new Set());
    }
    portsByNode.get(node).add(port);
  }

  function visit(graphObj) {
    if (!graphObj || typeof graphObj !== 'object') {
      return;
    }
    if (seen.has(graphObj)) {
      return;
    }
    seen.add(graphObj);

    const nodes = Array.isArray(graphObj.nodes) ? graphObj.nodes : [];
    const links = Array.isArray(graphObj.links) ? graphObj.links : Array.isArray(graphObj.edges) ? graphObj.edges : [];

    for (const node of nodes) {
      if (typeof node === 'string') {
        nodeNames.add(node);
        continue;
      }
      if (!node || typeof node !== 'object') {
        continue;
      }
      if (typeof node.name === 'string') {
        nodeNames.add(node.name);
      }
      if (typeof node.id === 'string') {
        nodeNames.add(node.id);
      }
      visit(node);
    }

    for (const link of links) {
      if (!link || typeof link !== 'object') {
        continue;
      }
      addEndpoint(link.from);
      addEndpoint(link.to);
    }
  }

  visit(parsed);

  const sortedNodeNames = [...nodeNames].sort((a, b) => a.localeCompare(b));
  return {
    nodeNames: sortedNodeNames,
    portsByNode,
  };
}

function buildAutocompleteMetadata(text) {
  const lines = text.split('\n');
  let entities = { nodeNames: [], portsByNode: new Map() };
  try {
    const parsed = YAML.load(text);
    entities = collectGraphEntitiesFromParsed(parsed);
  } catch (_err) {
    // Best effort only. Completion still works for structural keys.
  }
  return { lines, entities };
}

function endpointSuggestions(prefix, entities) {
  const normalizedPrefix = (prefix || '').toLowerCase();
  if (!normalizedPrefix.includes(':')) {
    return entities.nodeNames.filter((name) => name.toLowerCase().startsWith(normalizedPrefix));
  }
  const [nodePart, portPartRaw] = normalizedPrefix.split(':');
  const portPart = portPartRaw || '';
  const matches = [];
  for (const nodeName of entities.nodeNames) {
    if (!nodeName.toLowerCase().startsWith(nodePart)) {
      continue;
    }
    const ports = entities.portsByNode.get(nodeName) || new Set();
    for (const port of ports) {
      if (port.toLowerCase().startsWith(portPart)) {
        matches.push(`${nodeName}:${port}`);
      }
    }
  }
  return matches;
}

function extractKeyFromLine(line) {
  const match = line.trimStart().match(/^(?:-\s*)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
  return match ? match[1] : null;
}

function collectCurrentObjectKeys(lines, lineIndex, section) {
  if (section !== 'nodes' && section !== 'links' && section !== 'style') {
    return [];
  }

  let start = lineIndex;
  let objectIndent = null;
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);

    if (section === 'style') {
      const styleMatch = trimmed.match(/^(?:-\s*)?style\s*:\s*$/);
      if (styleMatch) {
        start = i;
        objectIndent = indent;
        break;
      }
    }

    if (/^-\s*/.test(trimmed)) {
      start = i;
      objectIndent = indent;
      break;
    }
  }

  if (objectIndent === null) {
    return [];
  }

  const keys = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);

    if (section === 'style') {
      if (i > start && indent <= objectIndent) {
        break;
      }
      if (indent > objectIndent + INDENT_SIZE) {
        continue;
      }
    } else {
      if (i > start && indent <= objectIndent && /^-\s*/.test(trimmed)) {
        break;
      }
      if (i > start && indent < objectIndent) {
        break;
      }
      if (indent > objectIndent + INDENT_SIZE) {
        continue;
      }
    }

    const key = extractKeyFromLine(line);
    if (key) {
      keys.push(key);
    }
  }

  return [...new Set(keys)];
}

function orderedKeySuggestions(items, usedKeys, requiredOrder, prefix) {
  const used = new Set(usedKeys || []);
  let filtered = items.filter((key) => !used.has(key));
  const normalizedPrefix = (prefix || '').toLowerCase();
  if (normalizedPrefix) {
    filtered = filtered.filter((key) => key.toLowerCase().startsWith(normalizedPrefix));
  }
  if (normalizedPrefix || !requiredOrder?.length) {
    return filtered;
  }
  const nextRequired = requiredOrder.find((key) => filtered.includes(key));
  if (!nextRequired) {
    return filtered;
  }
  return [nextRequired, ...filtered.filter((key) => key !== nextRequired)];
}

export function getYamlAutocompleteContext(text, lineNumber, column) {
  const lines = text.split('\n');
  const safeLineNumber = Math.max(1, Math.min(lineNumber, lines.length));
  const line = lines[safeLineNumber - 1] || '';
  const safeColumn = Math.max(1, Math.min(column, line.length + 1));
  const leftText = line.slice(0, safeColumn - 1);
  const trimmedLeft = leftText.trim();
  const indent = lineIndent(line);
  const sectionInfo = inferYamlSection(lines, safeLineNumber - 1, indent);
  let section = sectionInfo.section;

  if (section !== 'root' && indent === sectionInfo.sectionIndent + INDENT_SIZE && !trimmedLeft.startsWith('-')) {
    section = 'root';
  }

  const parentKey = inferParentKey(lines, safeLineNumber - 1, indent);
  const effectiveSection = parentKey === 'style' ? 'style' : section;

  const dashTypeMatch = trimmedLeft.match(/^-\s*type:\s*([a-zA-Z0-9_-]*)$/);
  const typeMatch = trimmedLeft.match(/^type:\s*([a-zA-Z0-9_-]*)$/);
  const typeValueMatch = dashTypeMatch || typeMatch;
  if (typeValueMatch && section === 'nodes') {
    const prefix = typeValueMatch[1] || '';
    return { kind: 'nodeTypeValue', section, prefix };
  }

  const endpointMatch = trimmedLeft.match(/^(?:-\s*)?(from|to):\s*([^\s]*)$/);
  if (endpointMatch && section === 'links') {
    return {
      kind: 'endpointValue',
      section,
      endpoint: endpointMatch[1],
      prefix: endpointMatch[2] || '',
    };
  }

  const genericValueMatch = trimmedLeft.match(/^(?:-\s*)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*([^\s]*)$/);
  if (genericValueMatch) {
    const field = genericValueMatch[1];
    const prefix = genericValueMatch[2] || '';
    if (STYLE_KEYS.includes(field) || parentKey === 'style') {
      return {
        kind: 'styleValue',
        section,
        styleField: field,
        prefix,
      };
    }
  }

  const listKeyMatch = trimmedLeft.match(/^-\s*([a-zA-Z_][a-zA-Z0-9_-]*)?$/);
  if (listKeyMatch) {
    return {
      kind: 'key',
      section: effectiveSection,
      prefix: listKeyMatch[1] || '',
    };
  }

  const keyMatch = trimmedLeft.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)?$/);
  if (keyMatch) {
    return {
      kind: 'key',
      section: effectiveSection,
      prefix: keyMatch[1] || '',
    };
  }

  return { kind: 'none', section: effectiveSection, prefix: '' };
}

function inferAutocompleteState(context) {
  if (context.kind === 'nodeTypeValue') {
    return AUTOCOMPLETE_STATE.NODE_TYPE_VALUE;
  }
  if (context.kind === 'endpointValue' && context.section === 'links') {
    return AUTOCOMPLETE_STATE.LINK_ENDPOINT_VALUE;
  }
  if (context.kind === 'styleValue') {
    return AUTOCOMPLETE_STATE.STYLE_VALUE;
  }
  if (context.kind === 'key' && context.section === 'style') {
    return AUTOCOMPLETE_STATE.STYLE_KEY;
  }
  if (context.kind === 'key' && context.section === 'root') {
    return AUTOCOMPLETE_STATE.ROOT_KEY;
  }
  if (context.kind === 'key' && context.section === 'nodes') {
    return AUTOCOMPLETE_STATE.NODE_KEY;
  }
  if (context.kind === 'key' && context.section === 'links') {
    return AUTOCOMPLETE_STATE.LINK_KEY;
  }
  return AUTOCOMPLETE_STATE.NONE;
}

function buildAutocompleteRuntimeFromMeta(text, lineNumber, column, meta) {
  const context = getYamlAutocompleteContext(text, lineNumber, column);
  const lineIndex = Math.max(0, Math.min(lineNumber - 1, meta.lines.length - 1));
  const sectionForObject = context.section === 'style' ? 'style' : context.section;
  return {
    context,
    state: inferAutocompleteState(context),
    objectKeys: collectCurrentObjectKeys(meta.lines, lineIndex, sectionForObject),
    entities: meta.entities,
  };
}

export function extractNodeTypesFromSchema(schema) {
  const candidates = [];
  const addEnum = (arr) => {
    if (!Array.isArray(arr)) {
      return;
    }
    for (const value of arr) {
      if (typeof value === 'string' && value.trim()) {
        candidates.push(value);
      }
    }
  };
  try {
    addEnum(schema?.$defs?.MinimalNodeIn?.properties?.type?.enum);
    const anyOf = schema?.$defs?.MinimalNodeIn?.properties?.type?.anyOf;
    if (Array.isArray(anyOf)) {
      for (const item of anyOf) {
        addEnum(item?.enum);
      }
    }
  } catch (_err) {
    // Keep default suggestions.
  }
  return [...new Set(candidates)];
}

export function getYamlAutocompleteSuggestions(context, meta = {}) {
  const state = meta.state || inferAutocompleteState(context);
  const nodeTypes =
    Array.isArray(meta.nodeTypeSuggestions) && meta.nodeTypeSuggestions.length
      ? meta.nodeTypeSuggestions
      : NODE_TYPE_SUGGESTIONS;

  if (state === AUTOCOMPLETE_STATE.NODE_TYPE_VALUE) {
    return nodeTypes.filter((item) => item.startsWith((context.prefix || '').toLowerCase()));
  }

  if (state === AUTOCOMPLETE_STATE.LINK_ENDPOINT_VALUE) {
    return endpointSuggestions(context.prefix, meta.entities || { nodeNames: [], portsByNode: new Map() });
  }

  if (state === AUTOCOMPLETE_STATE.STYLE_VALUE) {
    const field = context.styleField;
    const styleOptions = STYLE_VALUE_SUGGESTIONS[field] || [];
    const prefix = (context.prefix || '').toLowerCase();
    return styleOptions.filter((value) => value.toLowerCase().startsWith(prefix));
  }

  if (context.kind !== 'key') {
    return [];
  }

  if (state === AUTOCOMPLETE_STATE.STYLE_KEY) {
    return orderedKeySuggestions(STYLE_KEYS, meta.objectKeys, REQUIRED_STYLE_ORDER, context.prefix);
  }

  if (state === AUTOCOMPLETE_STATE.NODE_KEY) {
    return orderedKeySuggestions(NODE_KEYS, meta.objectKeys, REQUIRED_NODE_ORDER, context.prefix);
  }

  if (state === AUTOCOMPLETE_STATE.LINK_KEY) {
    return orderedKeySuggestions(LINK_KEYS, meta.objectKeys, REQUIRED_LINK_ORDER, context.prefix);
  }

  return ROOT_KEYS.filter((item) => item.startsWith((context.prefix || '').toLowerCase()));
}

export function computeIndentBackspaceDeleteCount(lineContent, column, indentSize = INDENT_SIZE) {
  const caretIndex = Math.max(0, Math.min(column - 1, lineContent.length));
  const before = lineContent.slice(0, caretIndex);
  const after = lineContent.slice(caretIndex);
  if (!before || before.trim().length > 0 || after.trim().length > 0) {
    return 0;
  }
  const remainder = caretIndex % indentSize;
  return remainder === 0 ? Math.min(indentSize, caretIndex) : remainder;
}

function withRenderCacheLimit(cache, key, value) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > MAX_RENDER_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

function extractSvgFromPayload(payload) {
  const visited = new Set();

  function visit(value, depth) {
    if (depth > 4 || value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return extractSvg(value);
    }
    if (typeof value !== 'object') {
      return '';
    }
    if (visited.has(value)) {
      return '';
    }
    visited.add(value);

    const directFields = ['svg', 'data', 'result', 'output'];
    for (const field of directFields) {
      if (field in value) {
        const found = visit(value[field], depth + 1);
        if (found) {
          return found;
        }
      }
    }

    for (const nested of Object.values(value)) {
      const found = visit(nested, depth + 1);
      if (found) {
        return found;
      }
    }

    return '';
  }

  return visit(payload, 0);
}

function toRenderError(err) {
  if (err instanceof RenderApiError) {
    return err;
  }
  if (err?.name === 'AbortError') {
    return err;
  }
  if (err instanceof TypeError) {
    return new RenderApiError('network', 'Network error while contacting rendering API.', null, true);
  }
  return new RenderApiError('unknown', err?.message || 'Unexpected rendering error.', null, false);
}

async function delayWithAbort(ms, signal) {
  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, ms);
    if (!signal) {
      return;
    }
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestSvgRender(payload, signal) {
  for (let attempt = 0; attempt <= MAX_RENDER_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}/render/svg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const retryable = response.status >= 500;
        const kind = response.status >= 500 ? 'server' : 'validation';
        const message = `Render failed (${response.status}): ${bodyText.slice(0, 260)}`;
        const responseError = new RenderApiError(kind, message, response.status, retryable);
        if (responseError.retryable && attempt < MAX_RENDER_RETRIES) {
          await delayWithAbort(RETRY_DELAY_MS, signal);
          continue;
        }
        throw responseError;
      }

      const contentType = response.headers.get('content-type') || '';
      let nextSvg = '';
      if (contentType.includes('application/json')) {
        const body = await response.json();
        nextSvg = extractSvgFromPayload(body);
      } else {
        const text = await response.text();
        nextSvg = extractSvg(text);
      }
      if (!nextSvg) {
        throw new RenderApiError('response', 'Render response did not contain SVG.', response.status, false);
      }
      return nextSvg;
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw err;
      }
      const mapped = toRenderError(err);
      if (mapped.retryable && attempt < MAX_RENDER_RETRIES) {
        await delayWithAbort(RETRY_DELAY_MS, signal);
        continue;
      }
      throw mapped;
    }
  }

  throw new RenderApiError('unknown', 'Rendering failed after retries.', null, false);
}

function computeDebounceMs(yamlText) {
  const length = yamlText.length;
  if (length < 400) {
    return MIN_DEBOUNCE_MS;
  }
  if (length > 5000) {
    return MAX_DEBOUNCE_MS;
  }
  const ratio = (length - 400) / (5000 - 400);
  return Math.round(MIN_DEBOUNCE_MS + (MAX_DEBOUNCE_MS - MIN_DEBOUNCE_MS) * ratio);
}

function createSchemaDiagnostics(ajvErrors, text) {
  const lines = text.split('\n');
  return (ajvErrors || []).map((err) => {
    const missingProperty = err?.keyword === 'required' ? err?.params?.missingProperty : null;
    const effectivePath = missingProperty
      ? `${err.instancePath || ''}/${String(missingProperty).replace(/\//g, '~1')}`
      : err.instancePath || '';
    const position = locateYamlPositionFromPath(text, effectivePath);
    const line = lines[Math.max(0, position.lineNumber - 1)] || '';
    const width = Math.max(1, position.endColumn - position.column);
    const messagePath = effectivePath || '/';

    return {
      message: `${messagePath}: ${err.message}`,
      source: 'schema',
      severity: 'error',
      lineNumber: position.lineNumber,
      column: position.column,
      endLineNumber: position.lineNumber,
      endColumn: Math.min(line.length + 1, position.column + width),
    };
  });
}

function analyzeYamlDocument(text, validateFn) {
  const base = {
    text,
    parsedGraph: null,
    normalizedGraph: null,
    normalizedHash: '',
    entities: { nodeNames: [], portsByNode: new Map() },
    syntaxError: null,
    validationErrors: [],
    diagnostics: [],
    isRenderable: false,
  };

  let parsed;
  try {
    parsed = YAML.load(text);
  } catch (err) {
    const syntaxDiagnostic = parseYamlSyntaxDiagnostic(err, text);
    return {
      ...base,
      syntaxError: syntaxDiagnostic,
      validationErrors: [syntaxDiagnostic?.message || 'YAML syntax error.'],
      diagnostics: syntaxDiagnostic ? [syntaxDiagnostic] : [],
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const message = 'Root YAML value must be an object.';
    return {
      ...base,
      parsedGraph: parsed,
      entities: collectGraphEntitiesFromParsed(parsed),
      validationErrors: [message],
      diagnostics: [
        {
          message,
          source: 'schema',
          severity: 'error',
          lineNumber: 1,
          column: 1,
          endLineNumber: 1,
          endColumn: 2,
        },
      ],
    };
  }

  const normalized = normalizeGraphInputForValidation(parsed);
  const normalizedHash = hashText(stableStringify(normalized));
  const entities = collectGraphEntitiesFromParsed(normalized);

  if (!validateFn) {
    return {
      ...base,
      parsedGraph: parsed,
      normalizedGraph: normalized,
      normalizedHash,
      entities,
      isRenderable: false,
    };
  }

  const isValid = validateFn(normalized);
  if (!isValid) {
    const validationErrors = formatAjvErrors(validateFn.errors);
    const diagnostics = createSchemaDiagnostics(validateFn.errors, text);
    return {
      ...base,
      parsedGraph: parsed,
      normalizedGraph: normalized,
      normalizedHash,
      entities,
      validationErrors,
      diagnostics,
      isRenderable: false,
    };
  }

  return {
    ...base,
    parsedGraph: parsed,
    normalizedGraph: normalized,
    normalizedHash,
    entities,
    validationErrors: [],
    diagnostics: [],
    isRenderable: true,
  };
}

function markerFromDiagnostic(monaco, model, diagnostic) {
  const maxLine = typeof model.getLineCount === 'function' ? model.getLineCount() : Number.POSITIVE_INFINITY;
  const startLineNumber = Math.max(1, Math.min(maxLine, diagnostic.lineNumber || 1));
  const endLineNumber = Math.max(startLineNumber, Math.min(maxLine, diagnostic.endLineNumber || startLineNumber));
  const lineText = typeof model.getLineContent === 'function' ? model.getLineContent(startLineNumber) : '';
  const minEndColumn = Math.max(2, (diagnostic.column || 1) + 1);
  const startColumn = Math.max(1, diagnostic.column || 1);
  const endColumn = Math.max(minEndColumn, Math.min(lineText.length + 1 || minEndColumn, diagnostic.endColumn || minEndColumn));

  return {
    severity:
      diagnostic.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : diagnostic.severity === 'info'
          ? monaco.MarkerSeverity.Info
          : monaco.MarkerSeverity.Error,
    message: diagnostic.message,
    source: diagnostic.source || 'GraphEditor',
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  };
}

function buildCompletionDocumentation(label) {
  return KEY_DOCUMENTATION[label] || '';
}

export default function App() {
  const [yamlText, setYamlText] = useState(INITIAL_YAML);
  const [schema, setSchema] = useState(null);
  const [validateFn, setValidateFn] = useState(null);
  const [schemaError, setSchemaError] = useState('');
  const [svgText, setSvgText] = useState('');
  const [status, setStatus] = useState('Loading schema...');
  const [renderError, setRenderError] = useState('');
  const [theme, setTheme] = useState('light');
  const [isManualView, setIsManualView] = useState(false);
  const [viewerSize, setViewerSize] = useState({ width: 640, height: 420 });

  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const previewShellRef = useRef(null);
  const viewerRef = useRef(null);
  const suppressViewEventsRef = useRef(false);

  const monacoRef = useRef(null);
  const editorRef = useRef(null);
  const editorModelRef = useRef(null);
  const completionProviderRef = useRef(null);
  const hoverProviderRef = useRef(null);
  const tabSuggestListenerRef = useRef(null);
  const focusSuggestListenerRef = useRef(null);
  const modelContentListenerRef = useRef(null);
  const nodeTypeSuggestionsRef = useRef(NODE_TYPE_SUGGESTIONS);

  const completionMetaCacheRef = useRef(EMPTY_COMPLETION_META_CACHE);
  const documentStateRef = useRef(null);
  const renderCacheRef = useRef(new Map());

  const [svgObjectUrl, setSvgObjectUrl] = useState('');

  const debounceMs = useMemo(() => computeDebounceMs(yamlText), [yamlText]);
  const documentState = useMemo(() => analyzeYamlDocument(yamlText, validateFn), [yamlText, validateFn]);
  const svgDoc = useMemo(() => parseSvgDocument(svgText), [svgText]);
  const themedSvgText = useMemo(() => applySvgColorScheme(svgText, theme), [svgText, theme]);
  const canDownload = useMemo(() => svgText.trim().length > 0, [svgText]);

  useEffect(() => {
    documentStateRef.current = documentState;
  }, [documentState]);

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

        const extractedNodeTypes = extractNodeTypesFromSchema(nextSchema);
        nodeTypeSuggestionsRef.current =
          extractedNodeTypes.length > 0 ? extractedNodeTypes : NODE_TYPE_SUGGESTIONS;

        const ajv = new Ajv2020({ allErrors: true, strict: false });
        const compiledValidate = ajv.compile(nextSchema);

        setSchema(nextSchema);
        setValidateFn(() => compiledValidate);
        setSchemaError('');
        setStatus('Schema loaded.');
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSchemaError(err?.message || 'Failed to load schema.');
        setStatus('Schema load failed.');
      }
    }

    loadSchema();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (schemaError) {
      return;
    }
    if (!validateFn) {
      return;
    }
    if (documentState.syntaxError) {
      setStatus('YAML parse error.');
      return;
    }
    if (documentState.validationErrors.length > 0) {
      setStatus('JSON schema validation failed.');
      return;
    }
  }, [schemaError, validateFn, documentState.syntaxError, documentState.validationErrors]);

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

    const diagnostics = documentState.diagnostics || [];
    const markers = diagnostics.map((diagnostic) => markerFromDiagnostic(monaco, model, diagnostic));
    monaco.editor.setModelMarkers(model, markerOwner, markers);
  }, [schemaError, documentState.diagnostics]);

  useEffect(() => {
    if (!schema || schemaError || !validateFn) {
      return;
    }

    if (!documentState.isRenderable || !documentState.normalizedGraph) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;

      const cacheKey = documentState.normalizedHash;
      if (cacheKey && renderCacheRef.current.has(cacheKey)) {
        setRenderError('');
        setSvgText(renderCacheRef.current.get(cacheKey));
        setStatus('Rendered.');
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setRenderError('');
      setStatus('Rendering SVG...');

      try {
        const nextSvg = await requestSvgRender(documentState.normalizedGraph, controller.signal);
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (cacheKey) {
          withRenderCacheLimit(renderCacheRef.current, cacheKey, nextSvg);
        }
        setSvgText(nextSvg);
        setStatus('Rendered.');
      } catch (err) {
        if (err?.name === 'AbortError') {
          return;
        }
        const mapped = toRenderError(err);
        if (requestId !== requestIdRef.current) {
          return;
        }
        setRenderError(mapped.message || 'Unexpected rendering error.');
        setStatus('Render failed.');
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [schema, schemaError, validateFn, documentState, debounceMs]);

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

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [themedSvgText]);

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
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (monacoRef.current?.editor?.setModelMarkers && editorModelRef.current) {
        monacoRef.current.editor.setModelMarkers(editorModelRef.current, 'grapheditor', []);
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
        ? { lines: text.split('\n'), entities: latestDocumentState.entities }
        : buildAutocompleteMetadata(text);

    completionMetaCacheRef.current = { version, text, meta };
    return meta;
  }

  function onEditorMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editorModelRef.current = editor.getModel?.() || null;

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

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider('yaml', {
      triggerCharacters: [' ', ':', '-', '.'],
      provideCompletionItems(model, position) {
        const meta = getCompletionMeta(model);
        const text = model.getValue();
        const runtime = buildAutocompleteRuntimeFromMeta(text, position.lineNumber, position.column, meta);
        const context = runtime.context;
        const suggestions = getYamlAutocompleteSuggestions(context, {
          state: runtime.state,
          objectKeys: runtime.objectKeys,
          entities: runtime.entities,
          nodeTypeSuggestions: nodeTypeSuggestionsRef.current,
        });

        const completionKinds = monaco.languages.CompletionItemKind || {};
        const insertTextRules = monaco.languages.CompletionItemInsertTextRule || {};
        const propertyKind = completionKinds.Property ?? 2;
        const valueKind = completionKinds.Value ?? 1;
        const enumKind = completionKinds.Enum ?? valueKind;
        const snippetKind = completionKinds.Snippet ?? valueKind;

        const startColumn = Math.max(1, position.column - (context.prefix || '').length);
        const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);

        const currentLine =
          typeof model.getLineContent === 'function' ? model.getLineContent(position.lineNumber) : '';
        const currentIndent = lineIndent(currentLine);
        const baseIndent = context.section === 'root' ? 0 : currentIndent;
        const childIndent = ' '.repeat(baseIndent + INDENT_SIZE);

        const completionItems = suggestions.map((item, idx) => {
          const canonicalKey = item === 'edges' ? 'links' : item;
          const isKeyCompletion =
            runtime.state === AUTOCOMPLETE_STATE.ROOT_KEY ||
            runtime.state === AUTOCOMPLETE_STATE.NODE_KEY ||
            runtime.state === AUTOCOMPLETE_STATE.LINK_KEY ||
            runtime.state === AUTOCOMPLETE_STATE.STYLE_KEY;

          const isCollectionKey = isKeyCompletion && COLLECTION_KEYS.has(item);
          const isLinkCollectionKey = isCollectionKey && canonicalKey === 'links';
          const isNodeCollectionKey = isCollectionKey && canonicalKey === 'nodes';

          let insertText;
          let insertTextRule;

          if (isCollectionKey) {
            if (isLinkCollectionKey) {
              insertText = `${canonicalKey}:\n${childIndent}- from: \${1}\n${childIndent}  to: \${2}\n${childIndent}  label: \${3}\n${childIndent}  type: \${4}\n${childIndent}- from: $0`;
            } else if (isNodeCollectionKey) {
              insertText = `${canonicalKey}:\n${childIndent}- name: \${1}\n${childIndent}  type: \${2}\n${childIndent}  links:\n${childIndent}    - from: \${1}:\${3}\n${childIndent}      to: \${4}:\${5}\n${childIndent}      label: \${6}\n${childIndent}      type: \${7}\n${childIndent}- name: $0`;
            } else {
              insertText = `${canonicalKey}:\n${childIndent}$0`;
            }
            insertTextRule = insertTextRules.InsertAsSnippet;
          } else {
            insertText = isKeyCompletion ? `${canonicalKey}: ` : item;
          }

          const isTypeOrEndpointKey = isKeyCompletion && ['type', 'from', 'to'].includes(item);
          const shouldTriggerSuggest = isTypeOrEndpointKey || isLinkCollectionKey || isNodeCollectionKey;

          return {
            label: item,
            kind:
              runtime.state === AUTOCOMPLETE_STATE.NODE_TYPE_VALUE ||
              runtime.state === AUTOCOMPLETE_STATE.LINK_ENDPOINT_VALUE ||
              runtime.state === AUTOCOMPLETE_STATE.STYLE_VALUE
                ? enumKind
                : isCollectionKey
                  ? snippetKind
                  : propertyKind,
            range,
            insertText,
            insertTextRules: insertTextRule,
            sortText: `${String(idx).padStart(3, '0')}-${item}`,
            detail: isKeyCompletion ? 'Graph key' : 'Graph value',
            documentation: buildCompletionDocumentation(item),
            command: shouldTriggerSuggest
              ? {
                  id: 'editor.action.triggerSuggest',
                  title: isLinkCollectionKey
                    ? 'Trigger Link Suggestions'
                    : isNodeCollectionKey
                      ? 'Trigger Node Suggestions'
                      : item === 'type'
                        ? 'Trigger Type Suggestions'
                        : 'Trigger Endpoint Suggestions',
                }
              : undefined,
          };
        });

        if (runtime.state === AUTOCOMPLETE_STATE.NODE_KEY && !(context.prefix || '').trim()) {
          completionItems.unshift({
            label: 'node template',
            kind: snippetKind,
            range,
            insertText: NODE_TEMPLATE_SNIPPET,
            insertTextRules: insertTextRules.InsertAsSnippet,
            sortText: '000-node-template',
            detail: 'Snippet',
            documentation: 'Insert a complete node object scaffold.',
          });
        }

        if (runtime.state === AUTOCOMPLETE_STATE.LINK_KEY && !(context.prefix || '').trim()) {
          completionItems.unshift({
            label: 'edge template',
            kind: snippetKind,
            range,
            insertText: EDGE_TEMPLATE_SNIPPET,
            insertTextRules: insertTextRules.InsertAsSnippet,
            sortText: '000-edge-template',
            detail: 'Snippet',
            documentation: 'Insert a complete edge/link scaffold.',
          });
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
          const docs = KEY_DOCUMENTATION[key];
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
      if (event.keyCode === monaco.KeyCode.Tab) {
        window.setTimeout(() => {
          editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
        }, 0);
        return;
      }

      if (event.keyCode !== monaco.KeyCode.Backspace) {
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
      const deleteCount = computeIndentBackspaceDeleteCount(lineContent, position.column, INDENT_SIZE);
      if (deleteCount <= 0) {
        return;
      }

      event.preventDefault?.();
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
    });

    focusSuggestListenerRef.current = editor.onDidFocusEditorText?.(() => {
      const model = editor.getModel?.();
      if (!model || model.getValue().trim().length > 0) {
        return;
      }
      editor.trigger('focus', 'editor.action.triggerSuggest', {});
    });

    modelContentListenerRef.current = editor.onDidChangeModelContent?.(() => {
      completionMetaCacheRef.current = EMPTY_COMPLETION_META_CACHE;
    });

    const model = editor.getModel?.();
    if (model && model.getValue().trim().length === 0) {
      editor.trigger('mount', 'editor.action.triggerSuggest', {});
    }
  }

  const errors = useMemo(() => {
    if (schemaError) {
      return [schemaError];
    }
    if (renderError) {
      return [...documentState.validationErrors, renderError];
    }
    return documentState.validationErrors;
  }, [schemaError, renderError, documentState.validationErrors]);

  return (
    <main className="app">
      <section className="pane pane-left">
        <div className="pane-header">
          <h1>GraphEditor</h1>
          <p>YAML input</p>
        </div>
        <div className="editor-shell" aria-label="YAML editor">
          <Editor
            path="graph.yaml"
            keepCurrentModel
            height="100%"
            defaultLanguage="yaml"
            value={yamlText}
            onChange={(value) => setYamlText(value || '')}
            onMount={onEditorMount}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 14,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              quickSuggestions: { comments: false, strings: true, other: true },
              suggestOnTriggerCharacters: true,
              tabCompletion: 'on',
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
          {errors.map((err, idx) => (
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
                {/* Keep SVG isolated via blob URL instead of direct HTML injection. */}
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
