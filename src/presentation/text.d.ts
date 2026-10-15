import type {ActionJson} from '../action-contracts.js';
import type {Schemas} from '../wire-types.js';

export type FontType = 'font/woff2' | 'font/woff' | 'font/ttf' | 'font/otf';
export const FONT_TYPES: FontType[];
export interface FontAxis {name: string; min: number; default: number; max: number}
export type FontPathCommand =
  {command: 'moveTo' | 'lineTo'; args: [number, number]} |
  {command: 'quadraticCurveTo'; args: [number, number, number, number]} |
  {command: 'bezierCurveTo'; args: [number, number, number, number, number, number]} |
  {command: 'closePath'; args: []};
export interface FontLayout {
  glyphs: {path: {commands: FontPathCommand[]}}[];
  positions: {xAdvance: number; yAdvance: number; xOffset: number; yOffset: number}[];
}
/** Font data and operations used by the bundled text renderer. */
export interface PresentationFont {
  familyName?: string;
  subfamilyName?: string;
  unitsPerEm: number;
  numGlyphs: number;
  characterSet: number[];
  variationAxes?: Record<string, FontAxis>;
  italicAngle: number;
  ascent: number;
  'OS/2'?: {usWeightClass: number; fsSelection?: {oblique?: boolean; italic?: boolean}};
  getVariation(axes: Record<string, number>): PresentationFont;
  hasGlyphForCodePoint(codepoint: number): boolean;
  layout(text: string, features?: readonly string[] | Record<string, boolean>, script?: string,
    language?: string, direction?: 'ltr' | 'rtl'): FontLayout;
}
export interface FontInfo {
  family: string;
  face: string;
  unitsPerEm: number;
  glyphs: number;
  axes: Record<string, FontAxis>;
  codepoints: number[];
  weight: number | undefined;
  style: 'normal' | 'italic' | 'oblique';
  italicAngle: number;
}
export function fontHeader(bytes: Uint8Array, type: FontType): void;
export function inspectFont(bytes: Uint8Array, type: FontType): {font: PresentationFont; info: FontInfo};
export interface TextRun {
  text: string;
  color?: string;
  weight?: number;
  style?: 'normal' | 'italic' | 'oblique';
  icon?: string;
}
export interface TextStatBinding {
  key: string;
  scope?: 'card' | 'variant';
  label?: string;
  unit?: string;
  precision?: number;
  missing?: string;
  view?: 'text' | 'badge' | 'bar';
  minimum?: number;
  maximum?: number;
  locale?: string;
}
export interface TextContent {
  text?: string;
  runs?: readonly TextRun[];
  stat?: TextStatBinding;
}
export interface TextNode extends TextContent {
  id?: string;
  width: number;
  height: number;
  typography?: Schemas['CardTypography'];
  readingOrder?: number;
  font?: string;
  color?: string;
}
export interface TextManifest {
  authoring?: {values?: Partial<Record<'card' | 'variant', Readonly<Record<string, ActionJson>>>>};
}
export interface AccessibleTextNode extends TextContent {
  type: string;
  visible?: boolean;
  readingOrder?: number;
  children?: readonly AccessibleTextNode[];
}
export function validateTypography(node: TextContent & Pick<TextNode, 'height' | 'typography' | 'readingOrder'>,
  assets: ReadonlyMap<string, {mediaType: string}>): void;
export function textValue(node: TextContent, manifest: TextManifest): string;
export function fontForNode(font: PresentationFont, node: Pick<TextNode, 'typography'>): PresentationFont;
export type TextMeasure = (value: string, size: number, start?: number) => number;
export interface TextLayout {
  lines: {text: string; start: number; x: number; y: number; width: number}[];
  size: number;
  lineHeight: number;
  height: number;
  overflow: boolean;
  renderHeight: number;
}
export function layoutText(node: Pick<TextNode, 'width' | 'height' | 'typography'>, text: string,
  measure: TextMeasure): TextLayout;
export function fontMeasure(font: PresentationFont, node: TextContent & Pick<TextNode, 'typography'>): TextMeasure;
export function textMeasure(ctx: Pick<CanvasRenderingContext2D, 'font' | 'letterSpacing' | 'measureText'>,
  node: TextContent & Pick<TextNode, 'typography' | 'font'>, font?: PresentationFont | null): TextMeasure;
export function fontDiagnostics(font: Pick<PresentationFont, 'hasGlyphForCodePoint'>,
  node: {id?: string}, text: string): {code: 'FONT_GLYPH'; nodeId: string | undefined; message: string}[];
export function accessibleText(manifest: TextManifest, scene?: {nodes?: readonly AccessibleTextNode[]} | null): string;
export function drawText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  node: TextNode, manifest: TextManifest, font?: PresentationFont | null,
  icons?: ReadonlyMap<string, CanvasImageSource>): TextLayout;
