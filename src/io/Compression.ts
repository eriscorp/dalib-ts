/**
 * HPF compression/decompression — adaptive Huffman coding.
 * Original algorithm by Eru/illuvatar; ported from DALib/IO/Compression.cs.
 *
 * Header signature (4 bytes, little-endian): 0xFF02AA55
 *   byte[0] = 0x55, byte[1] = 0xAA, byte[2] = 0x02, byte[3] = 0xFF
 */

const HPF_SIGNATURE = new Uint8Array([0x55, 0xaa, 0x02, 0xff]);
const HPF_SIGNATURE_UINT32 = 0xff02aa55;

/** True if the buffer starts with the HPF signature. */
export function isHpfCompressed(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false;
  return (
    buffer[0] === HPF_SIGNATURE[0] &&
    buffer[1] === HPF_SIGNATURE[1] &&
    buffer[2] === HPF_SIGNATURE[2] &&
    buffer[3] === HPF_SIGNATURE[3]
  );
}

/**
 * Decompress an HPF-compressed buffer (including its 4-byte header).
 * Returns a new Uint8Array containing the raw decompressed bytes.
 */
export function decompressHpf(buffer: Uint8Array): Uint8Array {
  let k = 7;
  let val = 0;
  let l = 0;
  let m = 0;

  const hpfSize = buffer.length;
  const rawBytes = new Uint8Array(hpfSize * 10);

  const intOdd = new Uint32Array(256);
  const intEven = new Uint32Array(256);
  const bytePair = new Uint8Array(513);

  for (let i = 0; i < 256; i++) {
    intOdd[i] = 2 * i + 1;
    intEven[i] = 2 * i + 2;
    bytePair[i * 2 + 1] = i;
    bytePair[i * 2 + 2] = i;
  }

  while (val !== 0x100) {
    val = 0;

    while (val <= 0xff) {
      if (k === 7) {
        l++;
        k = 0;
      } else {
        k++;
      }

      val = (buffer[4 + l - 1]! & (1 << k)) !== 0 ? intEven[val]! : intOdd[val]!;
    }

    let val3 = val;
    let val2 = bytePair[val]!;

    while (val3 !== 0 && val2 !== 0) {
      const i = bytePair[val2]!;
      let j = intOdd[i]!;

      if (j === val2) {
        j = intEven[i]!;
        intEven[i] = val3;
      } else {
        intOdd[i] = val3;
      }

      if (intOdd[val2] === val3) {
        intOdd[val2] = j;
      } else {
        intEven[val2] = j;
      }

      bytePair[val3] = i;
      bytePair[j] = val2;
      val3 = i;
      val2 = bytePair[val3]!;
    }

    // val += 0xFFFFFF00  (C# uint wrapping) — in JS we use a 32-bit subtraction
    val = (val + 0xffffff00) >>> 0;

    if (val === 0x100) continue;

    rawBytes[m] = val & 0xff;
    m++;
  }

  return rawBytes.subarray(0, m);
}

/**
 * Compress a raw byte buffer using HPF adaptive Huffman coding.
 * Returns a new Uint8Array with the 4-byte signature prepended.
 */
export function compressHpf(buffer: Uint8Array): Uint8Array {
  const intOdd = new Uint32Array(256);
  const intEven = new Uint32Array(256);
  const bytePair = new Uint8Array(513);

  for (let i = 0; i < 256; i++) {
    intOdd[i] = 2 * i + 1;
    intEven[i] = 2 * i + 2;
    bytePair[i * 2 + 1] = i;
    bytePair[i * 2 + 2] = i;
  }

  const bits: boolean[] = [];

  for (let byteIndex = 0; byteIndex <= buffer.length; byteIndex++) {
    const symbol = byteIndex < buffer.length ? buffer[byteIndex]! : 0x100;
    const targetNode = symbol + 0x100;
    let currentNode = 0;

    while (currentNode !== targetNode) {
      if (isNodeInSubtree(targetNode, intOdd[currentNode]!, intOdd, intEven)) {
        bits.push(false);
        currentNode = intOdd[currentNode]!;
      } else if (isNodeInSubtree(targetNode, intEven[currentNode]!, intOdd, intEven)) {
        bits.push(true);
        currentNode = intEven[currentNode]!;
      } else {
        throw new Error(`Cannot reach node ${targetNode} from ${currentNode}`);
      }
    }

    let val = targetNode;
    let val3 = val;
    let val2 = bytePair[val]!;

    while (val3 !== 0 && val2 !== 0) {
      const idx = bytePair[val2]!;
      let j = intOdd[idx]!;

      if (j === val2) {
        j = intEven[idx]!;
        intEven[idx] = val3;
      } else {
        intOdd[idx] = val3;
      }

      if (intOdd[val2] === val3) {
        intOdd[val2] = j;
      } else {
        intEven[val2] = j;
      }

      bytePair[val3] = idx;
      bytePair[j] = val2;
      val3 = idx;
      val2 = bytePair[val3]!;
    }
  }

  const compressedSize = (bits.length + 7) >> 3;
  const compressedData = new Uint8Array(compressedSize);

  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === true) {
      compressedData[i >> 3]! |= 1 << (i & 7);
    }
  }

  const output = new Uint8Array(4 + compressedSize);
  output.set(HPF_SIGNATURE, 0);
  output.set(compressedData, 4);
  return output;
}

/** Check whether `target` is reachable from `root` by traversing intOdd/intEven. */
function isNodeInSubtree(
  target: number,
  root: number,
  intOdd: Uint32Array,
  intEven: Uint32Array,
): boolean {
  if (root === target) return true;
  if (root > 0xff) return false;
  return (
    isNodeInSubtree(target, intOdd[root]!, intOdd, intEven) ||
    isNodeInSubtree(target, intEven[root]!, intOdd, intEven)
  );
}

export { HPF_SIGNATURE_UINT32 };
