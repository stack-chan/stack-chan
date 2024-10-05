declare module 'fetch' {
  export function fetch(href: string, info?: {
    method?: string;
    headers?: Headers | { [key: string]: string };
    body?: ArrayBuffer | string;
  }): Promise<Response>;

  export class Headers {
    constructor(init?: { [key: string]: string });
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callbackfn: (value: string, key: string, headers: Headers) => void, thisArg?: any): void;
  }

  export class Response {
    constructor(url: string, status: number, headers: Headers, body: Promise<ArrayBuffer>, redirected: boolean);

    readonly bodyUsed: boolean;
    readonly headers: Headers;
    readonly ok: boolean;
    readonly redirected: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly url: string;

    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<any>;
    text(): Promise<string>;
  }
}

export default fetch;
