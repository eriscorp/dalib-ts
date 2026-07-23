import { describe, expect, it } from 'vitest';
import { ControlFile } from '../src/drawing/ControlFile.js';

function parse(text: string): ControlFile {
  return ControlFile.fromBuffer(new TextEncoder().encode(text));
}

// Shaped after the real `_n*.txt` layouts in setoa.dat.
const SAMPLE = `
<CONTROL>
    <NAME> "OK"
    <TYPE> 7
    <RECT> 10 172 71 194
    <IMAGE>
        "_nbtn.spf" 3
        "_nbtn.spf" 4
        "_nbtn.spf" 5
    <VALUE>
        0
    <COLOR>
        20
        31
<ENDCONTROL>
<CONTROL>
    <NAME> "Noname"
    <TYPE> 0
    <RECT> 0 0 640 480
<ENDCONTROL>
`;

describe('ControlFile', () => {
  it('parses names, type, rect, images, value and colors', () => {
    const file = parse(SAMPLE);

    const ok = file.get('OK');
    expect(ok).toBeDefined();
    expect(ok!.type).toBe(7);
    expect(ok!.rect).toEqual({ left: 10, top: 172, right: 71, bottom: 194 });
    expect(ok!.returnValue).toBe(0);
    expect(ok!.colorIndexes).toEqual([20, 31]);
    expect(ok!.images).toEqual([
      { imageName: '_nbtn.spf', frameIndex: 3 },
      { imageName: '_nbtn.spf', frameIndex: 4 },
      { imageName: '_nbtn.spf', frameIndex: 5 },
    ]);
  });

  it('keeps every control and preserves declaration order', () => {
    const file = parse(SAMPLE);
    expect(file.controls).toHaveLength(2);
    expect(file.controls.map(c => c.name)).toEqual(['OK', 'Noname']);
  });

  it('looks controls up case-insensitively', () => {
    const file = parse(SAMPLE);
    expect(file.has('ok')).toBe(true);
    expect(file.has('Ok')).toBe(true);
    expect(file.get('oK')?.name).toBe('OK');
    expect(file.has('missing')).toBe(false);
    expect(file.get('missing')).toBeUndefined();
  });

  // The <IMAGE> block is an ordered list of (name, frame) entries that the
  // image-button helper consumes as normal/hover/pressed. It is NOT a start/end
  // range: real layouts contain non-consecutive runs such as `_nemot.spf` 0, 1, 3,
  // so filling the gaps would invent frames and shift the button states.
  it('does not expand a non-consecutive image run into a range', () => {
    const file = parse(`
<CONTROL>
    <NAME> "Emote"
    <TYPE> 7
    <IMAGE>
        "_nemot.spf" 0
        "_nemot.spf" 1
        "_nemot.spf" 3
<ENDCONTROL>
`);
    expect(file.get('Emote')!.images).toEqual([
      { imageName: '_nemot.spf', frameIndex: 0 },
      { imageName: '_nemot.spf', frameIndex: 1 },
      { imageName: '_nemot.spf', frameIndex: 3 },
    ]);
  });

  it('keeps a repeated frame index rather than collapsing it', () => {
    const file = parse(`
<CONTROL>
    <NAME> "Bg"
    <IMAGE>
        "_ncbg.spf" 2
        "_ncbg.spf" 3
        "_ncbg.spf" 3
<ENDCONTROL>
`);
    expect(file.get('Bg')!.images).toHaveLength(3);
  });

  it('ignores a control with no name', () => {
    const file = parse('<CONTROL>\n    <TYPE> 7\n<ENDCONTROL>\n');
    expect(file.controls).toHaveLength(0);
  });

  it('keeps the first of two controls sharing a name', () => {
    const file = parse(`
<CONTROL>
    <NAME> "Dup"
    <TYPE> 7
<ENDCONTROL>
<CONTROL>
    <NAME> "Dup"
    <TYPE> 0
<ENDCONTROL>
`);
    expect(file.controls).toHaveLength(1);
    expect(file.get('Dup')!.type).toBe(7);
  });

  it('tolerates blank lines and a malformed rect', () => {
    const file = parse(`
<CONTROL>

    <NAME> "Odd"

    <RECT> 1 2 3
<ENDCONTROL>
`);
    // A rect needs exactly four numbers; three leaves it unset rather than throwing.
    expect(file.get('Odd')!.rect).toBeUndefined();
  });

  it('ignores image lines that do not match the quoted-name plus index form', () => {
    const file = parse(`
<CONTROL>
    <NAME> "Img"
    <IMAGE>
        not-a-valid-line
        "good.spf" 2
<ENDCONTROL>
`);
    expect(file.get('Img')!.images).toEqual([{ imageName: 'good.spf', frameIndex: 2 }]);
  });

  it('ignores bare lines that appear before any control', () => {
    const file = parse('stray line\n<CONTROL>\n<NAME> "A"\n<ENDCONTROL>\n');
    expect(file.controls).toHaveLength(1);
  });

  it('parses from an ArrayBuffer', () => {
    const bytes = new TextEncoder().encode(SAMPLE);
    const file = ControlFile.fromBuffer(bytes.buffer as ArrayBuffer);
    expect(file.has('OK')).toBe(true);
  });

  it('handles CRLF line endings', () => {
    const file = parse(SAMPLE.replace(/\n/g, '\r\n'));
    expect(file.get('OK')!.rect?.left).toBe(10);
  });
});
