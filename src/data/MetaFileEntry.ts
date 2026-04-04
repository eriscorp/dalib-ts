/**
 * A single entry in a MetaFile with a string key and optional string properties.
 */
export class MetaFileEntry {
  readonly key: string;
  readonly properties: string[];

  constructor(key: string, properties: string[] = []) {
    this.key = key;
    this.properties = properties;
  }
}
