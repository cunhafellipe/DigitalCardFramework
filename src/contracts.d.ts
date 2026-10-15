import type {Schemas, Operations} from './wire-types.js';
import type {ActionJson} from './action-contracts.js';

/** JSON Schema keywords used by the HTTP document. Other keywords require narrowing. */
export interface OpenAPISchema {
  $ref?: string;
  type?: 'null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string' |
    ('null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string')[];
  description?: string;
  format?: string;
  const?: ActionJson;
  enum?: ActionJson[];
  default?: ActionJson;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  additionalProperties?: boolean | OpenAPISchema;
  items?: OpenAPISchema;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  not?: OpenAPISchema;
  if?: OpenAPISchema;
  then?: OpenAPISchema;
  else?: OpenAPISchema;
  dependentRequired?: Record<string, string[]>;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  maxProperties?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
  [keyword: string]: unknown;
}
export interface OpenAPIMediaType {
  schema: OpenAPISchema;
  [field: string]: unknown;
}
export interface OpenAPIJSONContent {
  'application/json': OpenAPIMediaType;
  [mediaType: string]: unknown;
}
export interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: OpenAPISchema;
  [field: string]: unknown;
}
export interface OpenAPIResponse {
  description: string;
  content?: OpenAPIJSONContent;
  [field: string]: unknown;
}
export interface OpenAPIOperation {
  operationId: keyof Operations;
  description?: string;
  security: {hostSession: string[]}[];
  parameters?: OpenAPIParameter[];
  requestBody?: {required: boolean; content: OpenAPIJSONContent; [field: string]: unknown};
  responses: Record<string, OpenAPIResponse>;
  [field: string]: unknown;
}
export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  [field: string]: unknown;
}
/** The exported document describes the framework's current HTTP contract, not arbitrary OpenAPI documents. */
export interface FrameworkOpenAPI {
  openapi: '3.1.0';
  info: {title: string; version: string; description: string; [field: string]: unknown};
  servers: {url: string; [field: string]: unknown}[];
  paths: Record<string, OpenAPIPathItem>;
  components: {
    schemas: {[Name in keyof Schemas]: OpenAPISchema};
    securitySchemes: {
      hostSession: {type: 'apiKey'; in: 'cookie'; name: string; description: string; [field: string]: unknown};
      [scheme: string]: unknown;
    };
    [field: string]: unknown;
  };
  [field: string]: unknown;
}
export const openapi: FrameworkOpenAPI;
