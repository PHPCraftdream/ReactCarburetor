/**
 * The UTF-16 string index of a UTF-8 byte offset, as native's `fix` positions arrive.
 *
 * Native's binary reports fix offsets in bytes (see `native/src/fix.rs`), while the host's fixer
 * indexes the source string in UTF-16 units, so each boundary needs converting before any
 * `replaceText` call. The walk measures each character's UTF-8 length by code point (1 to 4
 * bytes) instead of re-encoding, which would allocate per call. An offset that lands inside a
 * multi-byte character stops at that character's start rather than returning a fractional
 * position; such an offset never occurs for spans native derives from the AST.
 *
 * @param text - the source the byte offsets point into
 * @param byteOffset - the UTF-8 byte offset to convert; one past the text's bytes yields `text.length`
 */
export const utf16FromByte = (text: string, byteOffset: number): number => {
    let bytes = 0;
    let units = 0;

    for (const character of text) {
        const codePoint = character.codePointAt(0) ?? 0;
        const width = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

        if (bytes + width > byteOffset) {
            break;
        }

        bytes += width;
        units += character.length;
    }

    return units;
};
