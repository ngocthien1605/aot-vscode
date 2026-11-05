// Unit tests for src/hostName.ts (compiled to out/). Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const h = require(path.join(__dirname, '..', '..', 'out', 'hostName.js'));

test('isSafeHostName accepts DNS host names', () => {
    for (const host of ['contoso.crm.dynamics.com', 'org2f1d2adc.crm11.dynamics.com', 'my-org.operations.dynamics.com', 'localhost']) {
        assert.equal(h.isSafeHostName(host), true, host);
    }
});

test('isSafeHostName rejects shell and path metacharacters that URL parsing allows', () => {
    // Each of these parses as a URL host name; none is safe on a cmd.exe or PowerShell command line.
    for (const host of ['a&calc', 'a|b', "a'b", 'a;b', 'a(b)', 'a$b', 'a,b', 'a=b', 'a!b', 'a*b', 'a+b', '-lead', 'trail-', 'a..b', '']) {
        assert.equal(h.isSafeHostName(host), false, host);
    }
    assert.equal(h.isSafeHostName('a'.repeat(64) + '.com'), false, 'label over 63 characters');
});

test('orgName takes the first label, with or without the scheme', () => {
    assert.equal(h.orgName('https://Contoso.crm.dynamics.com/'), 'contoso');
    assert.equal(h.orgName('contoso.crm.dynamics.com'), 'contoso');
    assert.equal(h.orgName('  https://contoso.operations.dynamics.com/?x=1  '), 'contoso');
});

test('safeEnvironmentOrigin keeps only https://<host>', () => {
    assert.equal(h.safeEnvironmentOrigin('contoso.crm.dynamics.com'), 'https://contoso.crm.dynamics.com');
    assert.equal(h.safeEnvironmentOrigin('https://Contoso.crm.dynamics.com/main.aspx?a&b'), 'https://contoso.crm.dynamics.com');
});

test('safeEnvironmentOrigin refuses URLs that could inject into a command line or leak a token', () => {
    const rejected = [
        'https://a&calc&b.crm.dynamics.com',   // & runs a second command in cmd.exe
        'https://a|calc.crm.dynamics.com',
        "https://a';calc;'.crm.dynamics.com",
        'http://contoso.crm.dynamics.com',     // bearer tokens must not go over plain http
        'https://user:pw@contoso.crm.dynamics.com',
        'https://contoso.crm.dynamics.com:8443',
        'not a url',
    ];
    for (const url of rejected) {
        assert.throws(() => h.safeEnvironmentOrigin(url), /not a valid environment URL|Invalid URL/, url);
    }
});

test('pacProfileName is the org name, at most 30 characters, only [a-z0-9-]', () => {
    assert.equal(h.pacProfileName('https://contoso.crm.dynamics.com'), 'contoso');
    const long = 'a'.repeat(40);
    assert.equal(h.pacProfileName(`https://${long}.crm.dynamics.com`), 'a'.repeat(30));
    assert.throws(() => h.pacProfileName('https://a&calc.crm.dynamics.com'));
});

test('validateModelList accepts comma-separated model names only', () => {
    assert.equal(h.validateModelList('ContosoCore'), undefined);
    assert.equal(h.validateModelList('ContosoCore, Contoso_Ext,Fleet2'), undefined);
    for (const bad of ['', 'a b', 'Model;calc', 'Model&calc', 'Model,', '1Model', '$(calc)']) {
        assert.notEqual(h.validateModelList(bad), undefined, bad);
    }
});
