/** Flat key -> text map. Keys are prefixed by area, e.g. "shell.title". */
export type Dict = Record<string, string>;

/** What every file in src/i18n/strings/ exports. */
export interface AreaDicts {
  en: Dict;
  mn: Dict;
}

export type TranslateVars = Record<string, string | number>;
