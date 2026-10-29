import { STATUS_CODES } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (resource: string) => new HttpError(404, `${resource} not found`);
export const conflict = (message: string) => new HttpError(409, message);

export function errorBody(statusCode: number, message: string) {
  return { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', message };
}
