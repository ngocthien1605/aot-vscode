// Unit tests for src/xppSource.ts, src/diagnostics.ts and src/codeIntel/formatter.ts (compiled to out/). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const out = path.join(__dirname, '..', '..', 'out');
const src = require(path.join(out, 'xppSource.js'));
const { parseDiagnostics, diagnosticTarget } = require(path.join(out, 'diagnostics.js'));
const { formatXpp } = require(path.join(out, 'codeIntel', 'formatter.js'));

const declaration = 'class ContosoJob extends RunBase\n{\n    int counter;\n}';
const methods = [
    { name: 'run', source: '    public void run()\n    {\n        info("hi");\n    }' },
    // Written at column 0, as older agent tools stored it: shown one level in.
    { name: 'new', source: 'public void new()\n{\n    super();\n}' },
];

test('composeSource lays out a class like the Visual Studio code editor', () => {
    assert.equal(src.composeSource(declaration, methods),
        'class ContosoJob extends RunBase\n{\n    int counter;\n'
        + '    public void run()\n    {\n        info("hi");\n    }\n\n'
        + '    public void new()\n    {\n        super();\n    }\n}\n');
});

test('composeSource treats CRLF and LF alike', () => {
    assert.equal(src.composeSource(declaration.replace(/\n/g, '\r\n'), methods), src.composeSource(declaration, methods));
});

test('splitSource is the inverse of composeSource', () => {
    const doc = src.composeSource(declaration, methods);
    const split = src.splitSource(doc, declaration);
    assert.equal(split.declaration, declaration);
    assert.equal(split.methods.length, 2);
    assert.equal(src.composeSource(split.declaration, split.methods.map((source, i) => ({ name: `m${i}`, source }))), doc);
});

test('splitSource ignores braces in strings and comments', () => {
    const decl = 'class T\n{\n}';
    const body = [
        { name: 'a', source: '    void a()\n    {\n        str s = "}";\n        // }\n        /* { */\n    }' },
        { name: 'b', source: '    void b()\n    {\n    }' },
    ];
    const split = src.splitSource(src.composeSource(decl, body), decl);
    assert.deepEqual(split.methods, body.map(m => m.source));
});

test('methodSpans finds the line of each method', () => {
    const doc = src.composeSource(declaration, methods);
    assert.deepEqual(src.methodSpans(doc), [{ name: 'run', startLine: 3 }, { name: 'new', startLine: 8 }]);
});

test('compiler and document line numbers map both ways', () => {
    const doc = src.composeSource(declaration, methods);
    const lines = doc.split('\n');
    // The compiler counts methods back to back; the document has a blank line between them (line 7).
    const expected = { 1: 0, 3: 2, 4: 3, 7: 6, 8: 8, 11: 11, 12: 12 };
    for (const [compilerLine, documentLine] of Object.entries(expected)) {
        assert.equal(src.compilerLineToDocumentLine(doc, Number(compilerLine)), documentLine, `compiler line ${compilerLine}`);
    }
    assert.equal(lines[src.compilerLineToDocumentLine(doc, 8)], '    public void new()');
    for (let compilerLine = 1; compilerLine <= 12; compilerLine++) {
        const documentLine = src.compilerLineToDocumentLine(doc, compilerLine);
        assert.equal(src.documentLineToCompilerLine(doc, documentLine), compilerLine, `round trip of compiler line ${compilerLine}`);
    }
});

test('parseDiagnostics reads xppc -xmllog output and decodes entities once', () => {
    const xml = '<Diagnostics><Diagnostic><DiagnosticType>Compile</DiagnosticType><Severity>Error</Severity>'
        + '<Path>dynamics://Class/Foo/Method/bar</Path><Moniker>m</Moniker><Message>a &lt;b&gt; &amp;amp;</Message>'
        + '<Line>12</Line><Column>5</Column></Diagnostic><Diagnostic><Message>no position</Message></Diagnostic></Diagnostics>';
    const [first, second] = parseDiagnostics(xml);
    assert.equal(first.message, 'a <b> &amp;');
    assert.equal(first.line, 12);
    assert.equal(first.column, 5);
    assert.equal(first.endLine, undefined);
    assert.equal(second.severity, 'Error');
    assert.equal(second.line, undefined);
});

test('diagnosticTarget names the object of a diagnostic path', () => {
    assert.deepEqual(diagnosticTarget('dynamics://Class/Foo/Method/bar'), { objectType: 'AxClass', objectName: 'Foo', isCode: true });
    assert.deepEqual(diagnosticTarget('AxTable/CustTable'), { objectType: 'AxTable', objectName: 'CustTable', isCode: false });
    assert.equal(diagnosticTarget('Foo'), undefined);
});

test('formatXpp indents with Allman braces and is idempotent', () => {
    const once = formatXpp('void a()\n{\nif (x) {\ny();\n}\nelse\n{\nz();\n}\n}\n');
    assert.equal(once, 'void a()\n{\n    if (x)\n    {\n        y();\n    }\n    else\n    {\n        z();\n    }\n}\n');
    assert.equal(formatXpp(once), once);
});

test('formatXpp ignores braces inside strings', () => {
    assert.equal(formatXpp('str s = "{ not a brace";\nwhile (true)\n{\nbreak;\n}\n'),
        'str s = "{ not a brace";\nwhile (true)\n{\n    break;\n}\n');
});
