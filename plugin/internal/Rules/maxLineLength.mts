import type {IAstNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

interface IOptions {
    code?: number;
    tabWidth?: number;
    ignoreUrls?: boolean;
    ignorePattern?: string;
    ignoreStrings?: boolean;
    ignoreTemplateLiterals?: boolean;
}

/** A quote span in a single line, as raw character indexes. */
interface IStringRange {
    start: number;
    end: number;
    quote: string;
}

/** A synthetic node spanning one line; the host validates `range` on every reported node. */
interface ILineNode extends IAstNode {
    range: [number, number];
}

/** The column a tab advances to: the next multiple of the tab width, never a fraction of one. */
const nextTabStop = (column: number, tabWidth: number): number => column + tabWidth - (column % tabWidth);

/** The line's length as displayed, with each tab stretched out to its tab stop. */
const expandedLength = (line: string, tabWidth: number): number => {
    let column = 0;

    for (let i = 0; i < line.length; i++) {
        column = line[i] === '\t' ? nextTabStop(column, tabWidth) : column + 1;
    }

    return column;
};

/** The raw index of the character displayed at `column` — for a line over the limit, the first character that is. */
const indexAtColumn = (line: string, column: number, tabWidth: number): number => {
    let current = 0;

    for (let i = 0; i < line.length; i++) {
        const next = line[i] === '\t' ? nextTabStop(current, tabWidth) : current + 1;

        if (next > column) {
            return i;
        }

        current = next;
    }

    return line.length - 1;
};

/**
 * Finds the quote spans of one line. Tracks quotes, escapes and both comment forms, because a
 * quote inside a comment is prose, not a string; an unterminated block comment runs to the end of
 * the line, and so does an unterminated quote — a template spanning lines is out of scope, only
 * its opening line is covered. `//` is treated as a comment everywhere, which misreads division
 * followed by a regex, an accepted approximation for a style rule.
 */
const scanStrings = (line: string): IStringRange[] => {
    const ranges: IStringRange[] = [];
    let quote: string | null = null;
    let start = 0;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (inLineComment) {
            break;
        }

        if (inBlockComment) {
            if (ch === '/' && line[i - 1] === '*') {
                inBlockComment = false;
            }

            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                ranges.push({start, end: i, quote});
                quote = null;
            }

            continue;
        }

        if (ch === '/' && line[i + 1] === '/') {
            inLineComment = true;
        } else if (ch === '/' && line[i + 1] === '*') {
            inBlockComment = true;
        } else if (ch === '\'' || ch === '"' || ch === '`') {
            quote = ch;
            start = i;
            escaped = false;
        }
    }

    if (quote) {
        ranges.push({start, end: line.length - 1, quote});
    }

    return ranges;
};

/**
 * Reports lines longer than the limit, measuring a tab as advancing to the next tab stop.
 *
 * `ignoreStrings` defaults to true, deliberately unlike eslint's false: this repository's demo
 * already has nine lines over 120, all JSX string-literal attributes — long Tailwind `className`
 * lists and one SVG path `d` in lib/src/ToDo — and wrapping them would make class lists
 * ungreppable and inflate diffs for zero readability gain. A separate task enables this rule
 * repo-wide; it is meant to police logic lines, not class lists.
 */
export const maxLineLength: IRule = {
    meta: {
        type: 'layout',
        docs: {
            description: 'Enforces the maximum length of a source line.',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    code: {type: 'number'},
                    tabWidth: {type: 'number'},
                    ignoreUrls: {type: 'boolean'},
                    ignorePattern: {type: 'string'},
                    ignoreStrings: {type: 'boolean'},
                    ignoreTemplateLiterals: {type: 'boolean'},
                },
                additionalProperties: false,
            },
        ],
    },

    create(context: IRuleContext): TRuleVisitor {
        const options = (context.options[0] as IOptions) || {};

        const limit = options.code ?? 120;
        const tabWidth = options.tabWidth ?? 4;
        const ignoreUrls = options.ignoreUrls ?? false;
        const ignorePattern = options.ignorePattern ? new RegExp(options.ignorePattern) : null;
        const ignoreStrings = options.ignoreStrings ?? true;
        const ignoreTemplateLiterals = options.ignoreTemplateLiterals ?? false;

        return {
            Program: (): void => {
                let offset = 0;

                context.sourceCode.getText().split('\n').forEach((rawLine, index): void => {
                    // A line's span starts where the previous one ended; the newline belongs to
                    // the line it terminates.
                    const start = offset;
                    const end = start + rawLine.length;
                    const lineNode: ILineNode = {type: 'Program', start, end, range: [start, end]};

                    offset = end + 1;

                    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
                    const length = expandedLength(line, tabWidth);

                    if (length <= limit) {
                        return;
                    }

                    // A URL cannot be wrapped, and a line the author marked exempt stays exempt.
                    if (ignoreUrls && /https?:\/\//.test(line)) {
                        return;
                    }

                    if (ignorePattern?.test(line)) {
                        return;
                    }

                    // The first character past the limit decides what pushed the line over: a
                    // literal the author cannot shorten without changing the code is skipped.
                    const at = indexAtColumn(line, limit, tabWidth);
                    const causedByString = scanStrings(line).some((range) => at >= range.start && at <= range.end
                        && (range.quote === '`' ? ignoreTemplateLiterals : ignoreStrings));

                    if (causedByString) {
                        return;
                    }

                    // Positioning uses the host-required `range` field, validated on every report.
                    context.report({
                        node: lineNode,
                        message: `Line ${index + 1} is ${length} characters long; the maximum is ${limit}.`,
                    });
                });
            },
        };
    },
};
