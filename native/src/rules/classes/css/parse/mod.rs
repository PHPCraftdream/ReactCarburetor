//! The CSS front end: a structural scanner for what the class rules read — at-rules with their
//! preludes and blocks, style rules with their selectors, declarations, and comments.
//!
//! Not a CSS parser in the specification's sense: values and selectors stay raw text, because no
//! rule needs more than their spelling. What it must get right is structure — strings, comments,
//! escapes and brackets never open or close a block — and it must never panic or recurse without
//! bound on malformed input: every problem becomes a `ParseError` with an offset and the scan goes
//! on.

/// A byte range into the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    /// The text this span covers.
    pub fn text<'a>(&self, source: &'a str) -> &'a str {
        &source[self.start as usize..self.end as usize]
    }
}

/// One statement of a stylesheet or block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    At(AtRule),
    Rule(StyleRule),
    Declaration(Declaration),
}

/// `@name prelude;` or `@name prelude { … }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AtRule {
    /// The name without `@`.
    pub name: Span,
    /// Offset of the `@`.
    pub at: u32,
    /// Everything between the name and `;`/`{`, trimmed.
    pub prelude: Span,
    pub block: Option<Vec<Node>>,
}

/// `selector { … }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleRule {
    pub selector: Span,
    pub body: Vec<Node>,
}

/// `name: value`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Declaration {
    pub name: Span,
    pub value: Span,
}

/// A `/* … */` comment: its content, and where the comment ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Comment {
    pub content: Span,
    pub end: u32,
}

/// Something the scanner could not make sense of, at the offset a reader should look at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub offset: u32,
    pub message: &'static str,
}

/// A scanned stylesheet.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Sheet {
    pub nodes: Vec<Node>,
    pub comments: Vec<Comment>,
    pub errors: Vec<ParseError>,
}

/// Blocks nested deeper than this are skipped with an error rather than followed: real
/// stylesheets nest a handful of levels, and recursion must stay bounded on hostile input.
const MAX_DEPTH: usize = 64;

/// Scans a stylesheet.
pub fn parse(text: &str) -> Sheet {
    let mut scanner = Scanner {
        bytes: text.as_bytes(),
        pos: 0,
        comments: Vec::new(),
        errors: Vec::new(),
    };
    let nodes = scanner.nodes(0);

    Sheet {
        nodes,
        comments: scanner.comments,
        errors: scanner.errors,
    }
}

struct Scanner<'a> {
    bytes: &'a [u8],
    pos: usize,
    comments: Vec<Comment>,
    errors: Vec<ParseError>,
}

impl Scanner<'_> {
    fn error(&mut self, offset: usize, message: &'static str) {
        self.errors.push(ParseError {
            offset: offset as u32,
            message,
        });
    }

    fn at_comment(&self) -> bool {
        self.bytes.get(self.pos) == Some(&b'/') && self.bytes.get(self.pos + 1) == Some(&b'*')
    }

    /// Consumes a comment the cursor sits on, recording it.
    fn comment(&mut self) {
        let start = self.pos;
        let content_start = start + 2;
        let close = self.bytes[content_start.min(self.bytes.len())..]
            .windows(2)
            .position(|pair| pair == b"*/")
            .map(|index| content_start + index);

        let (content_end, end) = match close {
            Some(index) => (index, index + 2),
            None => {
                self.error(start, "this comment is never closed");
                (self.bytes.len(), self.bytes.len())
            }
        };

        self.comments.push(Comment {
            content: Span {
                start: content_start.min(content_end) as u32,
                end: content_end as u32,
            },
            end: end as u32,
        });
        self.pos = end;
    }

    /// Consumes a quoted string the cursor sits on. An unclosed string ends at the line break,
    /// as CSS's bad-string token does.
    fn string(&mut self, quote: u8) {
        self.pos += 1;
        while let Some(&byte) = self.bytes.get(self.pos) {
            match byte {
                b'\\' => self.pos += 2,
                b'\n' => return,
                _ if byte == quote => {
                    self.pos += 1;
                    return;
                }
                _ => self.pos += 1,
            }
        }
        self.pos = self.pos.min(self.bytes.len());
    }

    fn skip_trivia(&mut self) {
        loop {
            while self
                .bytes
                .get(self.pos)
                .is_some_and(|byte| byte.is_ascii_whitespace())
            {
                self.pos += 1;
            }
            if self.at_comment() {
                self.comment();
            } else {
                return;
            }
        }
    }

    /// Reads up to the next `;` at bracket depth zero, or the next `{`/`}` at any depth, and
    /// returns the range read and the byte that stopped it (`None` at the end of input). Braces
    /// stop the read even inside brackets, so one unbalanced `(` cannot swallow the rest of the
    /// file.
    fn chunk(&mut self) -> (usize, usize, Option<u8>) {
        let start = self.pos;
        let mut depth = 0usize;

        while let Some(&byte) = self.bytes.get(self.pos) {
            match byte {
                b'/' if self.at_comment() => {
                    self.comment();
                    continue;
                }
                b'"' | b'\'' => {
                    self.string(byte);
                    continue;
                }
                b'\\' => {
                    self.pos = (self.pos + 2).min(self.bytes.len());
                    continue;
                }
                b'(' | b'[' => depth += 1,
                b')' | b']' => depth = depth.saturating_sub(1),
                b'{' | b'}' => return (start, self.pos, Some(byte)),
                b';' if depth == 0 => return (start, self.pos, Some(byte)),
                _ => {}
            }
            self.pos += 1;
        }

        (start, self.bytes.len(), None)
    }

    fn trim(&self, mut start: usize, mut end: usize) -> Span {
        while start < end && self.bytes[start].is_ascii_whitespace() {
            start += 1;
        }
        while end > start && self.bytes[end - 1].is_ascii_whitespace() {
            end -= 1;
        }

        Span {
            start: start as u32,
            end: end as u32,
        }
    }

    fn nodes(&mut self, depth: usize) -> Vec<Node> {
        let mut nodes = Vec::new();

        loop {
            self.skip_trivia();
            let Some(&byte) = self.bytes.get(self.pos) else {
                return nodes;
            };

            match byte {
                b'}' => {
                    if depth == 0 {
                        self.error(self.pos, "this `}` closes no block");
                        self.pos += 1;
                        continue;
                    }
                    return nodes;
                }
                b';' => self.pos += 1,
                b'@' => {
                    let at = self.pos;
                    self.pos += 1;
                    let name_start = self.pos;
                    while self.bytes.get(self.pos).is_some_and(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
                    }) {
                        self.pos += 1;
                    }
                    let name = Span {
                        start: name_start as u32,
                        end: self.pos as u32,
                    };
                    let (start, end, stop) = self.chunk();
                    let prelude = self.trim(start, end);
                    let block = match stop {
                        Some(b';') => {
                            self.pos += 1;
                            None
                        }
                        Some(b'{') => {
                            self.pos += 1;
                            Some(self.block(depth, at))
                        }
                        _ => None,
                    };
                    nodes.push(Node::At(AtRule {
                        name,
                        at: at as u32,
                        prelude,
                        block,
                    }));
                }
                _ => {
                    let (start, end, stop) = self.chunk();
                    match stop {
                        Some(b'{') => {
                            self.pos += 1;
                            let selector = self.trim(start, end);
                            let body = self.block(depth, start);
                            nodes.push(Node::Rule(StyleRule { selector, body }));
                        }
                        Some(b';') => {
                            self.pos += 1;
                            self.declaration(start, end, &mut nodes);
                        }
                        _ => self.declaration(start, end, &mut nodes),
                    }
                }
            }
        }
    }

    /// The body of a block whose `{` was just consumed, through its `}`.
    fn block(&mut self, depth: usize, opened_at: usize) -> Vec<Node> {
        if depth + 1 > MAX_DEPTH {
            self.error(opened_at, "this block is nested too deeply to check");
            self.skip_block(opened_at);
            return Vec::new();
        }

        let body = self.nodes(depth + 1);
        if self.bytes.get(self.pos) == Some(&b'}') {
            self.pos += 1;
        } else {
            self.error(opened_at, "this block is never closed");
        }

        body
    }

    /// Skips a block without building it, counting braces iteratively.
    fn skip_block(&mut self, opened_at: usize) {
        let mut level = 1usize;

        while level > 0 {
            let (_, _, stop) = self.chunk();
            match stop {
                Some(b'{') => level += 1,
                Some(b'}') => level -= 1,
                Some(_) => {}
                None => {
                    self.error(opened_at, "this block is never closed");
                    return;
                }
            }
            self.pos += 1;
        }
    }

    fn declaration(&mut self, start: usize, end: usize, nodes: &mut Vec<Node>) {
        let span = self.trim(start, end);
        if span.start == span.end {
            return;
        }

        let mut depth = 0usize;
        let mut colon = None;
        for index in span.start as usize..span.end as usize {
            match self.bytes[index] {
                b'(' | b'[' => depth += 1,
                b')' | b']' => depth = depth.saturating_sub(1),
                b':' if depth == 0 => {
                    colon = Some(index);
                    break;
                }
                _ => {}
            }
        }

        let Some(colon) = colon else {
            self.error(span.start as usize, "expected `property: value` or a block");
            return;
        };

        nodes.push(Node::Declaration(Declaration {
            name: self.trim(span.start as usize, colon),
            value: self.trim(colon + 1, span.end as usize),
        }));
    }
}

#[cfg(test)]
mod tests;
