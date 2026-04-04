/**
 * A cursor-based binary writer that grows its internal buffer as needed.
 * Mirrors the C# SpanWriter ref struct — little-endian by default.
 */
export class SpanWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos: number = 0;

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  /** Current write position (bytes written so far). */
  get position(): number {
    return this.pos;
  }

  /** Return the written bytes as a trimmed Uint8Array (no copy if at capacity). */
  toUint8Array(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  /** Return the written bytes as an ArrayBuffer (always a copy). */
  toArrayBuffer(): ArrayBuffer {
    return (this.buf.buffer as ArrayBuffer).slice(0, this.pos);
  }

  private ensureCapacity(needed: number): void {
    if (this.pos + needed <= this.buf.byteLength) return;
    let newCap = this.buf.byteLength * 2;
    while (newCap < this.pos + needed) newCap *= 2;
    const next = new Uint8Array(newCap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  writeUInt8(v: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  writeInt8(v: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
  }

  writeUInt16LE(v: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  writeInt16LE(v: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }

  writeUInt32LE(v: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  writeInt32LE(v: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  writeUInt16BE(v: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.pos, v, false);
    this.pos += 2;
  }

  writeUInt32BE(v: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.pos, v, false);
    this.pos += 4;
  }

  /** Write a Uint8Array verbatim. */
  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.byteLength);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.byteLength;
  }

  /**
   * Write an ASCII string padded / truncated to exactly `fixedLength` bytes.
   * Unused bytes are zero-filled.
   */
  writeFixedAscii(s: string, fixedLength: number): void {
    this.ensureCapacity(fixedLength);
    for (let i = 0; i < fixedLength; i++) {
      this.buf[this.pos + i] = i < s.length ? (s.charCodeAt(i) & 0xff) : 0;
    }
    this.pos += fixedLength;
  }
}
