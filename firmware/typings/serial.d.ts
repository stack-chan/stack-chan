/*
 * Copyright (c) 2021 Shinya Ishikawa
 *
 *   This file is part of the Moddable SDK Tools.
 *
 *   The Moddable SDK Tools is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Tools is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with the Moddable SDK Tools.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

declare module "serial" {
  class Serial {
    public constructor()
    public setTimeout(ms: number): void
    public setBaudrate(baud: number): void

    public available(): boolean
    public flush(): void

    public readBytes(bytes: number): string
    public readBytes(buffer: ArrayBuffer, bytes?: number): void
    public readLine(): string
    public readLineUntil(terminator: string): string
    public readBytesUntil(character: string, bytes: number): string
    public readBytesUntil(buffer: ArrayBuffer, character: string, bytes: number): void

    public write(msg: ArrayBufferLike): void
    public write(msg: ArrayBufferLike, from: number): void
    public write(msg: ArrayBufferLike, from: number, to: number): void

    public write(): void
    public writeLine(line: string): void
    public onDataReceived: (str: string, len: number) => void
    public poll(dictionary: { terminators: string | string[]; trim: number; chunkSize: number }): void
    public poll(): void
  }
  export { Serial as default }
}
