export type PresentationSchemaValue = null | boolean | number | string | PresentationSchemaValue[] | {[key: string]: PresentationSchemaValue};
/** Editor hints; semantic validation is performed by the manifest and scene validators. */
export interface PresentationJSONSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  const?: PresentationSchemaValue;
  enum?: PresentationSchemaValue[];
  properties?: Record<string, PresentationJSONSchema>;
  additionalProperties?: boolean | PresentationJSONSchema;
  required?: string[];
  items?: PresentationJSONSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  $ref?: string;
  anyOf?: PresentationJSONSchema[];
  oneOf?: PresentationJSONSchema[];
  allOf?: PresentationJSONSchema[];
  not?: PresentationJSONSchema;
  if?: PresentationJSONSchema;
  then?: PresentationJSONSchema;
}
export interface PresentationObjectSchema extends PresentationJSONSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, PresentationJSONSchema>;
  required: string[];
}
export interface PresentationManifestSchema extends PresentationObjectSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: 'https://digital-card.invalid/schema/manifest-0.1.0.json';
  properties: Record<'format' | 'contractVersion' | 'id' | 'revision' | 'title' | 'summary' | 'profile' | 'canvas' | 'faces' | 'assets' | 'capabilities' | 'quality' | 'credits' | 'inputs' | 'extensions' | 'authoring', PresentationJSONSchema>;
}
export interface PresentationSceneSchema extends PresentationObjectSchema {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: 'https://digital-card.invalid/schema/scene2d-0.1.json';
  properties: Record<'dialect' | 'background' | 'nodes', PresentationJSONSchema>;
  $defs: {node: PresentationObjectSchema; mask: PresentationObjectSchema};
}
export declare const manifestSchema: PresentationManifestSchema;
export declare const sceneSchema: PresentationSceneSchema;
