import { ResponseError } from '@summer-js/summer'

const E = (statusCode: number, message: string) => {
  return new ResponseError(statusCode, { message })
}

export const ResError = {
  // Movie Errors
  FETCH_MOVIE_LIST_FAIL: E(400, 'Fetch movie list fail'),
  MOVIE_NOT_FOUND: E(404, 'Movie not exist')
}


export class ChatSocketError extends Error {
  // timestamp?: Date;
  constructor(name?: string, message?: string);
  constructor(error: Error);
  constructor(nameOrError?: string | Error, message?: string) {
    if (nameOrError instanceof Error) {
      const err = nameOrError as Error;
      super(err.message);
      Object.assign(this, err);
      this.name = err.name;
      // this.timestamp = new Date();
    } else {
      super(message || '');
      this.name = nameOrError ? nameOrError : new.target.name;
      // this.timestamp = new Date();
    }
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, new.target);
    }
    if (typeof Object.setPrototypeOf === 'function') {
      Object.setPrototypeOf(this, new.target.prototype);
    } else {
      (this as any).__proto__ = new.target.prototype;
    }
  }
  toString() {
    return JSON.stringify(this, Object.getOwnPropertyNames(this));
  }
  toJSON() {
    const json = { name: this.name, message: this.message, stack: this.stack };
    return json;
  }
}
export class EmptyTokenError extends ChatSocketError {
  constructor() {
    super(undefined, undefined);
  }
}
export class InvalidTokenError extends ChatSocketError {
  constructor(token: string) {
    super(undefined, `invalid token:${token}`);
  }
}

export class InvalidRoleError extends ChatSocketError {
  constructor(reason: string) {
    super(undefined, `invalid role:${reason}`);
  }
}