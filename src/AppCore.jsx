import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import YAML from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';
import GraphYamlEditor from '@graphrapids/graph-yaml-editor';
import GraphView from '@graphrapids/graph-view';

const API_BASE = '/api';
const PROFILE_STAGE = 'published';
const THEME_STAGE = 'published';
const DEFAULT_PROFILE_ID = String(import.meta.env.VITE_GRAPHEDITOR_PROFILE_ID || 'default').trim().toLowerCase();
const DEFAULT_THEME_ID = String(import.meta.env.VITE_GRAPHEDITOR_THEME_ID || 'default').trim().toLowerCase();
const MIN_DEBOUNCE_MS = 170;
const MAX_DEBOUNCE_MS = 380;
const RETRY_DELAY_MS = 180;
const MAX_RENDER_RETRIES = 1;
const INDENT_SIZE = 2;
const MAX_RENDER_CACHE_SIZE = 50;
const FORBIDDEN_AUTOCOMPLETE_KEYS = new Set(['id']);

const STRING_COERCION_KEYS = new Set(['name', 'label', 'id', 'from', 'to']);
const ROOT_SECTION_ALIASES = new Map([['edges', 'links']]);

const DEFAULT_AUTOCOMPLETE_SPEC = {
  rootSections: ['nodes', 'links'],
  node: {
    orderedKeys: ['name', 'type', 'ports', 'nodes', 'links'],
    requiredKeys: ['name'],
    entryStartKey: 'name',
  },
  link: {
    orderedKeys: ['from', 'to', 'label', 'type'],
    requiredKeys: ['from', 'to'],
    entryStartKey: 'from',
  },
};

const KEY_DOCUMENTATION = {
  nodes: 'Collection of graph nodes. Supports nested nodes and nested links.',
  links: 'Collection of graph links/edges. Use from/to as node[:port] references.',
  edges: 'Alias for links. Insertion is normalized to links.',
  name: 'Display name for a node. Also used as a default endpoint identifier.',
  id: 'Stable identifier for nodes/links.',
  type: 'Domain node/link type. Type suggestions are profile-driven.',
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

const EMPTY_COMPLETION_META_CACHE = {
  version: null,
  text: '',
  meta: {
    lines: [''],
    entities: { nodeNames: [], portsByNode: new Map() },
    rootSectionPresence: new Set(),
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

function toPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeProfileSummary(raw = {}) {
  const profileId = String(raw.profileId || '')
    .trim()
    .toLowerCase();
  const profileVersion = toPositiveInt(raw.profileVersion);
  const checksum = String(raw.profileChecksum || raw.checksum || '').trim();
  const iconsetResolutionChecksum = String(raw.iconsetResolutionChecksum || '').trim();
  const rawSources = Array.isArray(raw.iconsetSources)
    ? raw.iconsetSources
    : typeof raw.iconsetSources === 'string'
      ? String(raw.iconsetSources || '')
          .split(',')
          .map((value) => String(value || '').trim())
          .filter(Boolean)
          .map((token) => {
            const [iconsetId, versionToken] = token.split('@');
            const iconsetVersion = toPositiveInt(versionToken);
            return iconsetId && iconsetVersion
              ? { iconsetId: String(iconsetId).trim().toLowerCase(), iconsetVersion }
              : null;
          })
          .filter(Boolean)
      : [];
  const iconsetSources = rawSources
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const iconsetId = String(item.iconsetId || '')
        .trim()
        .toLowerCase();
      const iconsetVersion = toPositiveInt(item.iconsetVersion);
      if (!iconsetId || !iconsetVersion) {
        return null;
      }
      return { iconsetId, iconsetVersion };
    })
    .filter(Boolean);
  return {
    profileId,
    profileVersion,
    checksum,
    iconsetResolutionChecksum,
    iconsetSources,
  };
}

function normalizeThemeSummary(raw = {}) {
  const themeId = String(raw.themeId || '')
    .trim()
    .toLowerCase();
  const themeVersion = toPositiveInt(raw.themeVersion);
  const checksum = String(raw.checksum || '').trim();
  return {
    themeId,
    themeVersion,
    checksum,
  };
}

function resolveSelectedProfileId(profiles = [], preferred = '') {
  const normalizedPreferred = String(preferred || '')
    .trim()
    .toLowerCase();
  if (normalizedPreferred && profiles.some((item) => item.profileId === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return profiles[0]?.profileId || '';
}

function resolveSelectedThemeId(themes = [], preferred = '') {
  const normalizedPreferred = String(preferred || '')
    .trim()
    .toLowerCase();
  if (normalizedPreferred && themes.some((item) => item.themeId === normalizedPreferred)) {
    return normalizedPreferred;
  }
  return themes[0]?.themeId || '';
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
      const normalizedSection = ROOT_SECTION_ALIASES.get(match[2]) || match[2];
      return { section: normalizedSection, sectionIndent };
    }
  }
  return { section: 'root', sectionIndent: 0 };
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
  const pendingEndpoints = [];

  function parseEndpoint(endpoint) {
    if (typeof endpoint !== 'string') {
      return null;
    }
    const [node, port] = endpoint.split(':');
    if (!node) {
      return null;
    }
    return { node, port: port || '' };
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
      visit(node);
    }

    for (const link of links) {
      if (!link || typeof link !== 'object') {
        continue;
      }
      pendingEndpoints.push(parseEndpoint(link.from), parseEndpoint(link.to));
    }
  }

  visit(parsed);

  for (const endpoint of pendingEndpoints) {
    if (!endpoint || !endpoint.node || !endpoint.port) {
      continue;
    }
    if (!nodeNames.has(endpoint.node)) {
      continue;
    }
    if (!portsByNode.has(endpoint.node)) {
      portsByNode.set(endpoint.node, new Set());
    }
    portsByNode.get(endpoint.node).add(endpoint.port);
  }

  const sortedNodeNames = [...nodeNames].sort((a, b) => a.localeCompare(b));
  return {
    nodeNames: sortedNodeNames,
    portsByNode,
  };
}

function collectRootSectionPresence(lines, parsed) {
  const present = new Set();
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of Object.keys(parsed)) {
      const normalized = ROOT_SECTION_ALIASES.get(key) || key;
      if (normalized === 'nodes' || normalized === 'links') {
        present.add(normalized);
      }
    }
  }
  if (present.size > 0) {
    return present;
  }

  for (const line of lines) {
    const match = line.match(/^(\s*)(nodes|links|edges)\s*:\s*$/);
    if (!match) {
      continue;
    }
    if ((match[1] || '').length !== 0) {
      continue;
    }
    const normalized = ROOT_SECTION_ALIASES.get(match[2]) || match[2];
    if (normalized === 'nodes' || normalized === 'links') {
      present.add(normalized);
    }
  }
  return present;
}

function buildAutocompleteMetadata(text) {
  const lines = text.split('\n');
  let entities = { nodeNames: [], portsByNode: new Map() };
  let rootSectionPresence = collectRootSectionPresence(lines, null);
  try {
    const parsed = YAML.load(text);
    entities = collectGraphEntitiesFromParsed(parsed);
    rootSectionPresence = collectRootSectionPresence(lines, parsed);
  } catch (_err) {
    // Best effort only. Completion still works for structural keys.
  }
  return { lines, entities, rootSectionPresence };
}

function endpointSuggestions(prefix, entities, endpoint) {
  const rawPrefix = String(prefix || '');
  const normalizedPrefix = rawPrefix.toLowerCase();
  const nodeNames = Array.isArray(entities?.nodeNames) ? entities.nodeNames : [];
  if (normalizedPrefix.includes(':')) {
    return [];
  }

  const hasExactNodeMatch =
    normalizedPrefix.length > 0 && nodeNames.some((name) => String(name).toLowerCase() === normalizedPrefix);
  if ((endpoint === 'from' || endpoint === 'to') && hasExactNodeMatch) {
    return [':'];
  }

  return nodeNames.filter((name) => String(name).toLowerCase().startsWith(normalizedPrefix));
}

function extractKeyFromLine(line) {
  const match = line.trimStart().match(/^(?:-\s*)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
  return match ? match[1] : null;
}

function collectCurrentObjectKeys(lines, lineIndex, section, endLineIndex = lines.length - 1) {
  if (section !== 'nodes' && section !== 'links') {
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
  for (let i = start; i <= endLineIndex && i < lines.length; i += 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);

    if (i > start && indent <= objectIndent && /^-\s*/.test(trimmed)) {
      break;
    }
    if (i > start && indent < objectIndent) {
      break;
    }
    if (indent > objectIndent + INDENT_SIZE) {
      continue;
    }

    const key = extractKeyFromLine(line);
    if (key) {
      keys.push(key);
    }
  }

  return [...new Set(keys)];
}

function findItemStartBackward(lines, lineIndex, section) {
  if (section !== 'nodes' && section !== 'links') {
    return -1;
  }
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i] || '';
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const indent = lineIndent(line);
    const sectionInfo = inferYamlSection(lines, i, indent);
    if (sectionInfo.section !== section) {
      continue;
    }
    if (/^-\s*/.test(trimmed)) {
      return i;
    }
  }
  return -1;
}

function collectItemContextInfo(lines, lineIndex, section) {
  const currentItemStart = findItemStartBackward(lines, lineIndex, section);
  if (currentItemStart < 0) {
    return { objectKeys: [], canContinue: false };
  }

  const currentItemKeys = collectCurrentObjectKeys(lines, currentItemStart, section, lineIndex);
  if (currentItemKeys.length > 0) {
    return { objectKeys: currentItemKeys, canContinue: true };
  }

  const currentLineTrimmed = (lines[currentItemStart] || '').trim();
  if (!/^-\s*$/.test(currentLineTrimmed)) {
    return { objectKeys: [], canContinue: false };
  }

  const previousItemStart = findItemStartBackward(lines, currentItemStart - 1, section);
  if (previousItemStart < 0) {
    return { objectKeys: [], canContinue: false };
  }

  return {
    objectKeys: collectCurrentObjectKeys(lines, previousItemStart, section, currentItemStart - 1),
    canContinue: true,
  };
}

function collectOrderedKeys(sectionSpec) {
  const requiredKeys = Array.isArray(sectionSpec?.requiredKeys) ? sectionSpec.requiredKeys : [];
  const orderedKeys = Array.isArray(sectionSpec?.orderedKeys) ? sectionSpec.orderedKeys : [];
  const keys = [...requiredKeys, ...orderedKeys];
  return [
    ...new Set(
      keys.filter(
        (key) => typeof key === 'string' && key.trim() && !FORBIDDEN_AUTOCOMPLETE_KEYS.has(String(key).trim())
      )
    ),
  ];
}

function normalizeSectionPrefix(prefix) {
  return String(prefix || '')
    .replace(/^-/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
}

function selectNextObjectKey(sectionSpec, usedKeys, prefix) {
  const orderedKeys = collectOrderedKeys(sectionSpec);
  const used = new Set(usedKeys || []);
  const available = orderedKeys.filter((key) => !used.has(key));
  const normalizedPrefix = normalizeSectionPrefix(prefix);

  if (!normalizedPrefix) {
    return available.length ? [available[0]] : [];
  }
  return available.filter((key) => key.toLowerCase().startsWith(normalizedPrefix)).slice(0, 1);
}

function sectionSpecFor(section, spec) {
  if (section === 'nodes') {
    return spec?.node || DEFAULT_AUTOCOMPLETE_SPEC.node;
  }
  if (section === 'links') {
    return spec?.link || DEFAULT_AUTOCOMPLETE_SPEC.link;
  }
  return null;
}

function resolveItemObjectSchema(arraySchema) {
  const items = arraySchema?.items;
  const candidates = [];
  if (items && typeof items === 'object') {
    candidates.push(items);
    if (Array.isArray(items.anyOf)) {
      candidates.push(...items.anyOf);
    }
    if (Array.isArray(items.oneOf)) {
      candidates.push(...items.oneOf);
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    if (candidate.type === 'object' || candidate.properties) {
      return candidate;
    }
  }
  return null;
}

function resolveSectionSpec(arraySchema, fallback) {
  const objectSpec = resolveItemObjectSchema(arraySchema);
  if (!objectSpec) {
    return fallback;
  }

  const properties = objectSpec.properties && typeof objectSpec.properties === 'object' ? objectSpec.properties : {};
  const preferred = collectOrderedKeys(fallback);
  const schemaKeys = Object.keys(properties).filter((key) => !FORBIDDEN_AUTOCOMPLETE_KEYS.has(key));
  const orderedKeys = preferred.length ? preferred : schemaKeys;
  const schemaRequired = Array.isArray(objectSpec.required)
    ? objectSpec.required.filter((key) => orderedKeys.includes(key))
    : [];
  const fallbackRequired = Array.isArray(fallback?.requiredKeys)
    ? fallback.requiredKeys.filter((key) => orderedKeys.includes(key))
    : [];
  const requiredKeys = [...new Set([...fallbackRequired, ...schemaRequired])];
  const entryStartKey =
    (typeof fallback.entryStartKey === 'string' && orderedKeys.includes(fallback.entryStartKey) && fallback.entryStartKey) ||
    requiredKeys[0] ||
    orderedKeys[0] ||
    fallback.entryStartKey;

  return {
    orderedKeys,
    requiredKeys,
    entryStartKey,
  };
}

function extractAutocompleteSpecFromSchema(schema) {
  const fallback = DEFAULT_AUTOCOMPLETE_SPEC;
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const rootCandidates = Object.keys(properties)
    .map((key) => ROOT_SECTION_ALIASES.get(key) || key)
    .filter((key) => key === 'nodes' || key === 'links');
  const rootSections = [...new Set(rootCandidates)];

  return {
    rootSections: rootSections.length ? rootSections : fallback.rootSections,
    node: resolveSectionSpec(properties.nodes, fallback.node),
    link: resolveSectionSpec(properties.links || properties.edges, fallback.link),
  };
}

function previousNonEmptyLine(lines, startIndex) {
  for (let i = startIndex; i >= 0; i -= 1) {
    const line = lines[i] || '';
    if (!line.trim()) {
      continue;
    }
    return { line, index: i };
  }
  return null;
}

function rootContentBounds(lines) {
  let firstNonEmpty = -1;
  let lastNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!(lines[i] || '').trim()) {
      continue;
    }
    if (firstNonEmpty < 0) {
      firstNonEmpty = i;
    }
    lastNonEmpty = i;
  }
  return { firstNonEmpty, lastNonEmpty };
}

function isRootBoundaryEmptyLine(lines, lineIndex) {
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return false;
  }
  if ((lines[lineIndex] || '').trim().length > 0) {
    return false;
  }
  const { firstNonEmpty, lastNonEmpty } = rootContentBounds(lines);
  if (firstNonEmpty < 0 || lastNonEmpty < 0) {
    return false;
  }
  return lineIndex < firstNonEmpty || lineIndex > lastNonEmpty;
}

function keyFromLine(line) {
  const match = String(line || '').trim().match(/^(?:-\s*)?([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
  return match ? match[1] : null;
}

function isContinuationLineAfterTerminalKey(lines, lineNumber, section, itemIndent) {
  const safeLineIndex = Math.max(0, lineNumber - 1);
  const currentLine = lines[safeLineIndex] || '';
  if (currentLine.trim().length > 0) {
    return false;
  }
  if (lineIndent(currentLine) <= itemIndent) {
    return false;
  }

  const previous = previousNonEmptyLine(lines, safeLineIndex - 1);
  if (!previous) {
    return false;
  }
  if (lineIndent(previous.line) < itemIndent) {
    return false;
  }

  const previousKey = keyFromLine(previous.line);
  if (!previousKey) {
    return false;
  }
  const terminalKey = section === 'nodes' ? 'type' : section === 'links' ? 'type' : null;
  return terminalKey === previousKey;
}

export function getYamlAutocompleteContext(text, lineNumber, column) {
  const lines = text.split('\n');
  while (lineNumber > lines.length) {
    lines.push('');
  }
  const safeLineNumber = Math.max(1, Math.min(lineNumber, lines.length));
  const line = lines[safeLineNumber - 1] || '';
  const safeColumn = Math.max(1, Math.min(column, line.length + 1));
  const leftText = line.slice(0, safeColumn - 1);
  const trimmedLeft = leftText.trim();
  const indent = lineIndent(line);
  const sectionInfo = inferYamlSection(lines, safeLineNumber - 1, indent);
  const section = sectionInfo.section;
  const itemIndent = sectionInfo.sectionIndent + INDENT_SIZE;
  if (section === 'root' && isRootBoundaryEmptyLine(lines, safeLineNumber - 1)) {
    return { kind: 'rootItemKey', section: 'root', prefix: '' };
  }
  if (section !== 'root' && isContinuationLineAfterTerminalKey(lines, safeLineNumber, section, itemIndent)) {
    return { kind: 'itemKey', section, prefix: '' };
  }

  const dashTypeMatch = trimmedLeft.match(/^-\s*type:\s*([a-zA-Z0-9_-]*)$/);
  const typeMatch = trimmedLeft.match(/^type:\s*([a-zA-Z0-9_-]*)$/);
  const typeValueMatch = dashTypeMatch || typeMatch;
  if (typeValueMatch && section === 'nodes') {
    const prefix = typeValueMatch[1] || '';
    return { kind: 'nodeTypeValue', section, prefix };
  }
  if (typeValueMatch && section === 'links') {
    const prefix = typeValueMatch[1] || '';
    return { kind: 'linkTypeValue', section, prefix };
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

  const listKeyMatch = trimmedLeft.match(/^-\s*([a-zA-Z_][a-zA-Z0-9_-]*)?$/);
  if (
    section !== 'root' &&
    (listKeyMatch || (indent <= itemIndent && (trimmedLeft === '' || /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(trimmedLeft))))
  ) {
    return {
      kind: 'itemKey',
      section,
      prefix: listKeyMatch ? listKeyMatch[1] || '' : trimmedLeft,
    };
  }

  const keyMatch = trimmedLeft.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)?$/);
  if (keyMatch) {
    return {
      kind: section === 'root' ? 'rootKey' : 'key',
      section,
      prefix: keyMatch[1] || '',
    };
  }

  return { kind: 'none', section, prefix: '' };
}

function buildAutocompleteRuntimeFromMeta(text, lineNumber, column, meta) {
  const context = getYamlAutocompleteContext(text, lineNumber, column);
  const lineIndex = Math.max(0, Math.min(lineNumber - 1, meta.lines.length - 1));
  const itemContextInfo =
    context.kind === 'itemKey' && (context.section === 'nodes' || context.section === 'links')
      ? collectItemContextInfo(meta.lines, lineIndex, context.section)
      : { objectKeys: [], canContinue: false };
  return {
    context,
    objectKeys:
      context.kind === 'key' && (context.section === 'nodes' || context.section === 'links')
        ? collectCurrentObjectKeys(meta.lines, lineIndex, context.section, lineIndex)
        : [],
    itemContextKeys: itemContextInfo.objectKeys,
    canContinueItemContext: itemContextInfo.canContinue,
    entities: meta.entities,
  };
}

export function getYamlAutocompleteSuggestions(context, meta = {}) {
  const spec = meta.spec || DEFAULT_AUTOCOMPLETE_SPEC;
  const nodeTypes = Array.isArray(meta.nodeTypeSuggestions) ? meta.nodeTypeSuggestions : [];
  const linkTypes = Array.isArray(meta.linkTypeSuggestions) ? meta.linkTypeSuggestions : [];

  if (context.kind === 'nodeTypeValue') {
    return nodeTypes.filter((item) => item.startsWith((context.prefix || '').toLowerCase()));
  }
  if (context.kind === 'linkTypeValue') {
    return linkTypes.filter((item) => item.startsWith((context.prefix || '').toLowerCase()));
  }

  if (context.kind === 'endpointValue') {
    return endpointSuggestions(context.prefix, meta.entities || { nodeNames: [], portsByNode: new Map() }, context.endpoint);
  }

  if (context.kind === 'rootKey') {
    const prefix = normalizeSectionPrefix(context.prefix);
    const present = meta.rootSectionPresence || new Set();
    const rootSections = (spec.rootSections || DEFAULT_AUTOCOMPLETE_SPEC.rootSections).filter(
      (item) => !present.has(item) && item.toLowerCase().startsWith(prefix)
    );
    return rootSections;
  }

  if (context.kind === 'rootItemKey') {
    const rootSections = (spec.rootSections || DEFAULT_AUTOCOMPLETE_SPEC.rootSections).map((item) => String(item || ''));
    const present = meta.rootSectionPresence || new Set();
    return rootSections
      .filter((item) => item && !present.has(item))
      .map((item) => `- ${item}:`);
  }

  if (context.kind === 'itemKey') {
    const sectionSpec = sectionSpecFor(context.section, spec);
    const itemContextKeys = Array.isArray(meta.itemContextKeys) ? meta.itemContextKeys : [];
    const canContinueItem = Boolean(meta.canContinueItemContext);
    const startKey = sectionSpec?.entryStartKey || (context.section === 'nodes' ? 'name' : 'from');
    const normalizedPrefix = normalizeSectionPrefix(context.prefix);

    let continuationKeys = collectOrderedKeys(sectionSpec).filter((key) => key !== startKey);
    if (context.section === 'nodes' && itemContextKeys.includes('type')) {
      continuationKeys = [];
    }
    continuationKeys = continuationKeys.filter((key) => !itemContextKeys.includes(key));

    const options = [{ label: `- ${startKey}`, key: startKey }];
    if (canContinueItem) {
      for (const key of continuationKeys) {
        options.push({ label: `  ${key}`, key });
      }
    }

    if (!normalizedPrefix) {
      return options.map((option) => option.label);
    }
    return options
      .filter((option) => option.key.toLowerCase().startsWith(normalizedPrefix))
      .map((option) => option.label);
  }

  if (context.kind === 'key' && (context.section === 'nodes' || context.section === 'links')) {
    const sectionSpec = sectionSpecFor(context.section, spec);
    return selectNextObjectKey(sectionSpec, meta.objectKeys, context.prefix);
  }

  return [];
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

function resolveAbsoluteApiBase(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    return '';
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      const resolved = new URL(normalizedBaseUrl, window.location.origin);
      return `${resolved.origin}${resolved.pathname}`.replace(/\/+$/, '');
    } catch (_err) {
      // Fall back to raw base URL.
    }
  }
  return normalizedBaseUrl;
}

function buildRenderEndpoint(profileContext = {}, themeContext = {}) {
  const url = new URL(`${API_BASE}/render/svg`, window.location.origin);
  const profileId = String(profileContext.profileId || '')
    .trim()
    .toLowerCase();
  if (profileId) {
    url.searchParams.set('profile_id', profileId);
    url.searchParams.set('profile_stage', String(profileContext.profileStage || PROFILE_STAGE));
  }
  if (Number.isFinite(profileContext.profileVersion) && Number(profileContext.profileVersion) > 0) {
    url.searchParams.set('profile_version', String(Number(profileContext.profileVersion)));
  }
  const themeId = String(themeContext.themeId || '')
    .trim()
    .toLowerCase();
  if (themeId) {
    url.searchParams.set('theme_id', themeId);
    url.searchParams.set('theme_stage', String(themeContext.themeStage || THEME_STAGE));
  }
  if (Number.isFinite(themeContext.themeVersion) && Number(themeContext.themeVersion) > 0) {
    url.searchParams.set('theme_version', String(Number(themeContext.themeVersion)));
  }
  return `${url.pathname}${url.search}`;
}

function resolveProfileSummaryFromHeaders(headers, fallback = {}) {
  const fallbackSummary = normalizeProfileSummary(fallback);
  const profileId =
    String(headers.get('x-graphapi-profile-id') || '')
      .trim()
      .toLowerCase() || fallbackSummary.profileId;
  const profileVersion = toPositiveInt(headers.get('x-graphapi-profile-version')) || fallbackSummary.profileVersion;
  const checksum = String(headers.get('x-graphapi-profile-checksum') || '').trim() || fallbackSummary.checksum;
  const iconsetResolutionChecksum =
    String(headers.get('x-graphapi-iconset-resolution-checksum') || '').trim() ||
    fallbackSummary.iconsetResolutionChecksum;
  const iconsetSourcesHeader = String(headers.get('x-graphapi-iconset-sources') || '').trim();
  const iconsetSources = iconsetSourcesHeader
    ? normalizeProfileSummary({ iconsetSources: iconsetSourcesHeader }).iconsetSources
    : fallbackSummary.iconsetSources;
  return {
    profileId,
    profileVersion,
    checksum,
    iconsetResolutionChecksum,
    iconsetSources,
  };
}

function resolveThemeSummaryFromHeaders(headers, fallback = {}) {
  const fallbackSummary = normalizeThemeSummary(fallback);
  const themeId =
    String(headers.get('x-graphapi-theme-id') || '')
      .trim()
      .toLowerCase() || fallbackSummary.themeId;
  const themeVersion = toPositiveInt(headers.get('x-graphapi-theme-version')) || fallbackSummary.themeVersion;
  const checksum = String(headers.get('x-graphapi-theme-checksum') || '').trim() || fallbackSummary.checksum;
  return {
    themeId,
    themeVersion,
    checksum,
  };
}

async function requestSvgRender(payload, signal, profileContext = {}, themeContext = {}) {
  const endpoint = buildRenderEndpoint(profileContext, themeContext);
  const fallbackProfileSummary = normalizeProfileSummary(profileContext);
  const fallbackThemeSummary = normalizeThemeSummary(themeContext);
  for (let attempt = 0; attempt <= MAX_RENDER_RETRIES; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
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
      return {
        svgText: nextSvg,
        profileSummary: resolveProfileSummaryFromHeaders(response.headers, fallbackProfileSummary),
        themeSummary: resolveThemeSummaryFromHeaders(response.headers, fallbackThemeSummary),
      };
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
  const [profilesError, setProfilesError] = useState('');
  const [themesError, setThemesError] = useState('');
  const [profileCatalogWarning, setProfileCatalogWarning] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [themes, setThemes] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [activeThemeId, setActiveThemeId] = useState('');
  const [activeProfileSummary, setActiveProfileSummary] = useState({
    profileId: '',
    profileVersion: null,
    checksum: '',
    iconsetResolutionChecksum: '',
    iconsetSources: [],
  });
  const [activeThemeSummary, setActiveThemeSummary] = useState({
    themeId: '',
    themeVersion: null,
    checksum: '',
  });
  const [activeRenderProfileSummary, setActiveRenderProfileSummary] = useState({
    profileId: '',
    profileVersion: null,
    checksum: '',
    iconsetResolutionChecksum: '',
    iconsetSources: [],
  });
  const [activeRenderThemeSummary, setActiveRenderThemeSummary] = useState({
    themeId: '',
    themeVersion: null,
    checksum: '',
  });
  const [theme, setTheme] = useState('light');

  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);

  const nodeTypeSuggestionsRef = useRef([]);
  const linkTypeSuggestionsRef = useRef([]);
  const autocompleteSpecRef = useRef(DEFAULT_AUTOCOMPLETE_SPEC);

  const completionMetaCacheRef = useRef(EMPTY_COMPLETION_META_CACHE);
  const documentStateRef = useRef(null);
  const renderCacheRef = useRef(new Map());
  const profileCatalogCacheRef = useRef(new Map());
  const profileApiBaseUrl = useMemo(() => resolveAbsoluteApiBase(API_BASE), []);

  const debounceMs = useMemo(() => computeDebounceMs(yamlText), [yamlText]);
  const documentState = useMemo(() => analyzeYamlDocument(yamlText, validateFn), [yamlText, validateFn]);

  useEffect(() => {
    documentStateRef.current = documentState;
  }, [documentState]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles() {
      try {
        let response = await fetch(`${API_BASE}/v2/profiles`);
        if (response.status === 404) {
          response = await fetch(`${API_BASE}/v1/profiles`);
        }
        if (!response.ok) {
          throw new Error(`Profile list request failed with ${response.status}`);
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        const nextProfiles = Array.isArray(body?.profiles)
          ? body.profiles
              .map((item) => ({
                profileId: String(item?.profileId || '')
                  .trim()
                  .toLowerCase(),
                name: String(item?.name || ''),
              }))
              .filter((item) => item.profileId)
          : [];

        setProfiles(nextProfiles);
        setProfilesError('');
        setActiveProfileId((current) => resolveSelectedProfileId(nextProfiles, current || DEFAULT_PROFILE_ID));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setProfiles([]);
        setActiveProfileId('');
        setProfilesError(err?.message || 'Failed to load profiles.');
      }
    }

    loadProfiles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadThemes() {
      try {
        const response = await fetch(`${API_BASE}/v1/themes`);
        if (!response.ok) {
          throw new Error(`Theme list request failed with ${response.status}`);
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        const nextThemes = Array.isArray(body?.themes)
          ? body.themes
              .map((item) => ({
                themeId: String(item?.themeId || '')
                  .trim()
                  .toLowerCase(),
                name: String(item?.name || ''),
              }))
              .filter((item) => item.themeId)
          : [];
        setThemes(nextThemes);
        setThemesError('');
        setActiveThemeId((current) => resolveSelectedThemeId(nextThemes, current || DEFAULT_THEME_ID));
      } catch (err) {
        if (cancelled) {
          return;
        }
        setThemes([]);
        setActiveThemeId('');
        setThemesError(err?.message || 'Failed to load themes.');
      }
    }

    loadThemes();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeProfileId) {
      setActiveProfileSummary({
        profileId: '',
        profileVersion: null,
        checksum: '',
        iconsetResolutionChecksum: '',
        iconsetSources: [],
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadActiveProfileCatalog() {
      try {
        const url = new URL(`${API_BASE}/v2/autocomplete/catalog`, window.location.origin);
        url.searchParams.set('profile_id', activeProfileId);
        url.searchParams.set('stage', PROFILE_STAGE);
        let response = await fetch(`${url.pathname}${url.search}`, {
          signal: controller.signal,
        });
        if (response.status === 404) {
          const v1Url = new URL(`${API_BASE}/v1/autocomplete/catalog`, window.location.origin);
          v1Url.searchParams.set('profile_id', activeProfileId);
          v1Url.searchParams.set('stage', PROFILE_STAGE);
          response = await fetch(`${v1Url.pathname}${v1Url.search}`, {
            signal: controller.signal,
          });
        }
        if (!response.ok) {
          throw new Error(`Profile catalog request failed with ${response.status}`);
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        setActiveProfileSummary(normalizeProfileSummary(body));
        setProfileCatalogWarning('');
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') {
          return;
        }
        setActiveProfileSummary({
          profileId: activeProfileId,
          profileVersion: null,
          checksum: '',
          iconsetResolutionChecksum: '',
          iconsetSources: [],
        });
        setProfileCatalogWarning(
          `Profile catalog unavailable for '${activeProfileId}': ${err?.message || 'request failed'}`
        );
      }
    }

    loadActiveProfileCatalog();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeProfileId]);

  useEffect(() => {
    if (!activeProfileId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadIconsetResolution() {
      try {
        const url = new URL(
          `${API_BASE}/v2/profiles/${encodeURIComponent(activeProfileId)}/iconset-resolution`,
          window.location.origin
        );
        url.searchParams.set('stage', PROFILE_STAGE);
        if (Number.isFinite(activeProfileSummary.profileVersion) && Number(activeProfileSummary.profileVersion) > 0) {
          url.searchParams.set('profile_version', String(Number(activeProfileSummary.profileVersion)));
        }
        const response = await fetch(`${url.pathname}${url.search}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        setActiveProfileSummary((current) =>
          normalizeProfileSummary({
            ...current,
            iconsetResolutionChecksum: body?.checksum || current.iconsetResolutionChecksum,
            iconsetSources: Array.isArray(body?.sources) ? body.sources : current.iconsetSources,
          })
        );
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') {
          return;
        }
      }
    }

    loadIconsetResolution();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeProfileId, activeProfileSummary.profileVersion]);

  useEffect(() => {
    if (!activeThemeId) {
      setActiveThemeSummary({
        themeId: '',
        themeVersion: null,
        checksum: '',
      });
      setActiveRenderThemeSummary({
        themeId: '',
        themeVersion: null,
        checksum: '',
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function loadActiveThemeBundle() {
      try {
        const url = new URL(`${API_BASE}/v1/themes/${encodeURIComponent(activeThemeId)}/bundle`, window.location.origin);
        url.searchParams.set('stage', THEME_STAGE);
        const response = await fetch(`${url.pathname}${url.search}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Theme bundle request failed with ${response.status}`);
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        setActiveThemeSummary(normalizeThemeSummary(body));
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') {
          return;
        }
        setActiveThemeSummary({
          themeId: activeThemeId,
          themeVersion: null,
          checksum: '',
        });
      }
    }

    loadActiveThemeBundle();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeThemeId]);

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

        autocompleteSpecRef.current = extractAutocompleteSpecFromSchema(nextSchema);

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

      const cacheKey = [
        documentState.normalizedHash,
        activeProfileSummary.profileId || 'no-profile',
        activeProfileSummary.profileVersion || 'no-version',
        activeProfileSummary.checksum || 'no-checksum',
        activeProfileSummary.iconsetResolutionChecksum || 'no-iconset-checksum',
        (activeProfileSummary.iconsetSources || [])
          .map((item) => `${item.iconsetId}@${item.iconsetVersion}`)
          .join(',') || 'no-iconset-sources',
        activeThemeSummary.themeId || 'no-theme',
        activeThemeSummary.themeVersion || 'no-theme-version',
        activeThemeSummary.checksum || 'no-theme-checksum',
      ].join('|');
      if (cacheKey && renderCacheRef.current.has(cacheKey)) {
        const cached = renderCacheRef.current.get(cacheKey);
        const cachedSvg = typeof cached === 'string' ? cached : cached?.svgText;
        const cachedProfileSummary =
          typeof cached === 'string' ? normalizeProfileSummary(activeProfileSummary) : cached?.profileSummary;
        if (!cachedSvg) {
          renderCacheRef.current.delete(cacheKey);
        } else {
          setActiveRenderProfileSummary(cachedProfileSummary || normalizeProfileSummary(activeProfileSummary));
          setActiveRenderThemeSummary(
            (typeof cached === 'string' ? normalizeThemeSummary(activeThemeSummary) : cached?.themeSummary) ||
              normalizeThemeSummary(activeThemeSummary)
          );
          setRenderError('');
          setSvgText(cachedSvg);
          setStatus('Rendered.');
          return;
        }
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setRenderError('');
      setStatus('Rendering SVG...');

      const profileContext = activeProfileId
        ? {
            profileId: activeProfileId,
            profileStage: PROFILE_STAGE,
            profileVersion: activeProfileSummary.profileVersion,
            checksum: activeProfileSummary.checksum,
            iconsetResolutionChecksum: activeProfileSummary.iconsetResolutionChecksum,
            iconsetSources: activeProfileSummary.iconsetSources,
          }
        : {};
      const themeContext = activeThemeId
        ? {
            themeId: activeThemeId,
            themeStage: THEME_STAGE,
            themeVersion: activeThemeSummary.themeVersion,
            checksum: activeThemeSummary.checksum,
          }
        : {};

      try {
        const nextRender = await requestSvgRender(
          documentState.normalizedGraph,
          controller.signal,
          profileContext,
          themeContext
        );
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (cacheKey) {
          withRenderCacheLimit(renderCacheRef.current, cacheKey, nextRender);
        }
        setSvgText(nextRender.svgText);
        setActiveRenderProfileSummary(nextRender.profileSummary || normalizeProfileSummary(profileContext));
        setActiveRenderThemeSummary(nextRender.themeSummary || normalizeThemeSummary(themeContext));
        setRenderError('');
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
  }, [
    schema,
    schemaError,
    validateFn,
    documentState,
    debounceMs,
    activeProfileId,
    activeProfileSummary.profileId,
    activeProfileSummary.profileVersion,
    activeProfileSummary.checksum,
    activeProfileSummary.iconsetResolutionChecksum,
    activeProfileSummary.iconsetSources,
    activeThemeId,
    activeThemeSummary.themeId,
    activeThemeSummary.themeVersion,
    activeThemeSummary.checksum,
  ]);

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

  const errors = useMemo(() => {
    if (schemaError) {
      return [schemaError];
    }
    if (renderError) {
      return [...documentState.validationErrors, renderError];
    }
    return documentState.validationErrors;
  }, [schemaError, renderError, documentState.validationErrors]);

  const profileNotice = useMemo(() => {
    const notices = [];
    if (profilesError) {
      notices.push(`Profile service unavailable: ${profilesError}`);
    }
    if (themesError) {
      notices.push(`Theme service unavailable: ${themesError}`);
    }
    if (profileCatalogWarning) {
      notices.push(profileCatalogWarning);
    }
    return notices.join(' | ');
  }, [profileCatalogWarning, profilesError, themesError]);

  const activeIconsetSummary = useMemo(() => {
    const sources = Array.isArray(activeProfileSummary.iconsetSources)
      ? activeProfileSummary.iconsetSources
      : [];
    const labels = sources
      .map((item) => {
        const iconsetId = String(item?.iconsetId || '')
          .trim()
          .toLowerCase();
        const iconsetVersion = toPositiveInt(item?.iconsetVersion);
        if (!iconsetId || !iconsetVersion) {
          return '';
        }
        return `${iconsetId}@${iconsetVersion}`;
      })
      .filter(Boolean);

    if (!activeProfileSummary.iconsetResolutionChecksum && labels.length === 0) {
      return '';
    }

    const parts = ['Iconsets'];
    if (labels.length) {
      parts.push(labels.join(','));
    }
    if (activeProfileSummary.iconsetResolutionChecksum) {
      parts.push(String(activeProfileSummary.iconsetResolutionChecksum).slice(0, 12));
    }
    return parts.join(' · ');
  }, [activeProfileSummary.iconsetResolutionChecksum, activeProfileSummary.iconsetSources]);

  return (
    <main className="app">
      <section className="pane pane-left">
        <div className="pane-header">
          <h1>GraphEditor</h1>
          <p>YAML input</p>
          <div className="profile-row">
            <label htmlFor="profile-select">Profile</label>
            <select
              id="profile-select"
              value={activeProfileId}
              onChange={(event) => setActiveProfileId(String(event.target.value || ''))}
              disabled={profiles.length === 0}
              data-testid="profile-select"
            >
              {profiles.length === 0 ? <option value="">No profiles</option> : null}
              {profiles.map((item) => (
                <option key={item.profileId} value={item.profileId}>
                  {item.name || item.profileId}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-row">
            <label htmlFor="theme-select">Theme</label>
            <select
              id="theme-select"
              value={activeThemeId}
              onChange={(event) => setActiveThemeId(String(event.target.value || ''))}
              disabled={themes.length === 0}
              data-testid="theme-select"
            >
              {themes.length === 0 ? <option value="">No themes</option> : null}
              {themes.map((item) => (
                <option key={item.themeId} value={item.themeId}>
                  {item.name || item.themeId}
                </option>
              ))}
            </select>
          </div>
          {activeIconsetSummary ? (
            <p className="profile-iconsets" data-testid="profile-iconsets">
              {activeIconsetSummary}
            </p>
          ) : null}
          {profileNotice ? (
            <p className="profile-warning" role="status" data-testid="profile-notice">
              {profileNotice}
            </p>
          ) : null}
        </div>
        <GraphYamlEditor
          value={yamlText}
          onChange={setYamlText}
          theme={theme}
          schemaError={schemaError}
          diagnostics={documentState.diagnostics}
          documentStateRef={documentStateRef}
          completionMetaCacheRef={completionMetaCacheRef}
          emptyCompletionMetaCache={EMPTY_COMPLETION_META_CACHE}
          nodeTypeSuggestionsRef={nodeTypeSuggestionsRef}
          linkTypeSuggestionsRef={linkTypeSuggestionsRef}
          autocompleteSpecRef={autocompleteSpecRef}
          markerFromDiagnostic={markerFromDiagnostic}
          indentSize={INDENT_SIZE}
          profileId={activeProfileId}
          profileApiBaseUrl={profileApiBaseUrl}
          profileStage={PROFILE_STAGE}
          profileVersion={activeProfileSummary.profileVersion}
          profileChecksum={activeProfileSummary.checksum}
          profileCatalogCacheRef={profileCatalogCacheRef}
          onProfileCatalogWarning={setProfileCatalogWarning}
        />
      </section>

      <section className="pane pane-right">
        <GraphView
          svgText={svgText}
          status={status}
          errors={errors}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          profileId={activeRenderProfileSummary.profileId || activeProfileId}
          profileVersion={activeRenderProfileSummary.profileVersion}
          profileChecksum={activeRenderProfileSummary.checksum}
          iconsetResolutionChecksum={
            activeRenderProfileSummary.iconsetResolutionChecksum || activeProfileSummary.iconsetResolutionChecksum
          }
          iconsetSources={
            activeRenderProfileSummary.iconsetSources?.length
              ? activeRenderProfileSummary.iconsetSources
              : activeProfileSummary.iconsetSources
          }
          profileStage={PROFILE_STAGE}
          themeId={activeRenderThemeSummary.themeId || activeThemeId}
          themeVersion={activeRenderThemeSummary.themeVersion}
          themeChecksum={activeRenderThemeSummary.checksum}
          themeStage={THEME_STAGE}
        />
      </section>
    </main>
  );
}
