/**
 * A cursor-based binary reader backed by a DataView.
 * Mirrors the C# SpanReader ref struct — little-endian by default, matching the
 * Dark Ages file format conventions.
 */
export class SpanReader {
  private readonly view: DataView;
  private pos: number;

  constructor(buffer: ArrayBuffer | Uint8Array, byteOffset = 0) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.view = new DataView(buffer);
    }
    this.pos = byteOffset;
  }

  /** Current read position (byte offset from start of the buffer). */
  get position(): number {
    return this.pos;
  }

  /** Total number of bytes in the underlying buffer. */
  get length(): number {
    return this.view.byteLength;
  }

  /** Number of bytes remaining from the current position. */
  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  /** Move the read cursor to an absolute byte offset. */
  seek(offset: number): void {
    if (offset < 0 || offset > this.view.byteLength) {
      throw new RangeError(`Seek offset ${offset} out of bounds [0, ${this.view.byteLength}]`);
    }
    this.pos = offset;
  }

  /** Skip `n` bytes forward. */
  skip(n: number): void {
    this.pos += n;
  }

  readUInt8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readInt8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUInt16LE(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readInt16LE(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  readUInt32LE(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readInt32LE(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readUInt16BE(): number {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  readInt16BE(): number {
    const v = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return v;
  }

  readUInt32BE(): number {
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readInt32BE(): number {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  /** Read `n` bytes as a new Uint8Array (zero-copy slice into the underlying buffer). */
  readBytes(n: number): Uint8Array {
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return slice;
  }

  /**
   * Read a null-terminated ASCII string from exactly `maxLength` bytes.
   * Stops at the first null byte.
   */
  readFixedAscii(maxLength: number): string {
    const bytes = this.readBytes(maxLength);
    const nullIdx = bytes.indexOf(0);
    const len = nullIdx === -1 ? maxLength : nullIdx;
    let result = '';
    for (let i = 0; i < len; i++) {
      result += String.fromCharCode(bytes[i]!);
    }
    return result;
  }

  /** Peek at the next byte without advancing the cursor. */
  peekUInt8(): number {
    return this.view.getUint8(this.pos);
  }
}
