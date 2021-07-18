declare module "modules" {
  export default class Modules {
    static get host(): any;
    static get archive(): any;
    static has(name: string): boolean;
    static importNow(name: string): any;
  }
}