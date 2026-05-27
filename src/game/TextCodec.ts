interface DecodeTextOptions {
  readonly stopAtTerminator?: boolean;
}

const TERMINATOR = 0x50;

export function decodeGen1Text(bytes: Uint8Array, options: DecodeTextOptions = {}): string {
  const chars: string[] = [];

  for (const byte of bytes) {
    if (options.stopAtTerminator === true && byte === TERMINATOR) break;
    chars.push(decodeGen1Char(byte));
  }

  return chars.join("").replace(/[ \n]+/g, " ").trim();
}

export function decodeGen1Name(bytes: Uint8Array): string {
  return decodeGen1Text(bytes, { stopAtTerminator: true });
}

function decodeGen1Char(byte: number): string {
  if (byte === 0x7f || byte === 0x00 || byte === 0x4f || byte === TERMINATOR) {
    return " ";
  }

  if (byte >= 0x80 && byte <= 0x99) {
    return String.fromCharCode("A".charCodeAt(0) + byte - 0x80);
  }

  if (byte >= 0xa0 && byte <= 0xb9) {
    return String.fromCharCode("a".charCodeAt(0) + byte - 0xa0);
  }

  if (byte >= 0xf6 && byte <= 0xff) {
    return String.fromCharCode("0".charCodeAt(0) + byte - 0xf6);
  }

  switch (byte) {
    case 0xe0:
      return "'";
    case 0xe3:
      return "-";
    case 0xe6:
      return "?";
    case 0xe7:
      return "!";
    case 0xe8:
      return ".";
    case 0xef:
      return "♂";
    case 0xf5:
      return "♀";
    default:
      return " ";
  }
}
