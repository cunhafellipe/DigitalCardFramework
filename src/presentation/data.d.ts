export class PresentationError extends Error {
  code: string;
  path: string;
  constructor(code: string, message: string, path?: string);
}
