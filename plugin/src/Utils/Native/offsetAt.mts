/**
 * The string index of a 1-based line/column pair, the position native reports diagnostics at.
 *
 * The host's own node positions are plain string indices (verified against `getText().slice(...)`
 * elsewhere in this plugin), so a synthetic report node needs the same units. Native counts
 * columns in Unicode scalar values while this string is UTF-16, so a column past an astral
 * character (an emoji, rare scripts) is worth two units per character here; the walk over the
 * line's first `column - 1` characters measures exactly that. Lines are split on `\n` alone: a
 * `\r\n` file leaves a trailing `\r` on each line, which shifts every column after the
 * first line by however many `\r` characters preceded it — negligible for this project's own LF
 * sources, and worth revisiting only if a consumer's repository turns out to use CRLF. A
 * position past the text stops at its end, so a stale line or column can never point a report
 * beyond the buffer it is mapped onto.
 *
 * @param text - the source indexed into; the `\\n` split means a `\\r` left by CRLF counts
 * toward the offsets this returns
 * @param line - the 1-based line to walk to; each line before it adds its length plus one, and a
 * line count past the text's end just stops the walk at the last line
 * @param column - the 1-based position inside that line in characters, 1 being its first character
 */
export const offsetAt = (text: string, line: number, column: number): number => {
    const lines = text.split('\n');
    let offset = 0;

    for (let index = 0; index < line - 1 && index < lines.length; index++) {
        offset += lines[index].length + 1;
    }

    const lineText = lines[Math.min(line - 1, lines.length - 1)] ?? '';
    let units = 0;
    let seen = 0;

    for (const character of lineText) {
        if (seen >= column - 1) {
            break;
        }

        units += character.length;
        seen++;
    }

    return Math.min(offset + units, text.length);
};
