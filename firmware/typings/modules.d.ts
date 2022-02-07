declare module "modules" {
  export default class Modules {
    static has(name: string): boolean;
    static importNow(name: string): any;
    static get host(): string[];
    static get archive(): string[];
  }
}