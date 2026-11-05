/**
 * Host-name checks for environment URLs. The URLs come from settings (which a workspace's .vscode/settings.json
 * can supply) and input boxes, and parts of them reach command lines (pac runs through a shell), folder names
 * and database names. WHATWG URL parsing accepts characters such as & ! $ ' ( ) * + , ; = in host names, so the
 * parser alone does not make a host name safe to use there.
 *
 * No 'vscode' import: this module is unit-tested under plain Node.
 */

/** One DNS label: letters, digits and inner hyphens (RFC 1123). */
const Label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** True for a DNS host name made only of letters, digits, hyphens and dots. */
export function isSafeHostName(host: string): boolean {
    return host.length > 0 && host.length <= 253 && host.split('.').every(label => Label.test(label));
}

/** Parses an environment URL given with or without its scheme. Throws on an unparsable URL. */
export function parseEnvironmentUrl(url: string): URL {
    const trimmed = url.trim();
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

/** The org name: the first label of the URL's host name, lower case. */
export function orgName(url: string): string {
    return parseEnvironmentUrl(url).hostname.split('.')[0].toLowerCase();
}

/**
 * The URL reduced to https://<host>, for passing to a command line. Throws when the host name has characters
 * other than letters, digits, hyphens and dots, or the URL carries credentials, a port or plain http.
 */
export function safeEnvironmentOrigin(url: string): string {
    const parsed = parseEnvironmentUrl(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !isSafeHostName(parsed.hostname)) {
        throw new Error(`'${url}' is not a valid environment URL. Use https://<org>.crm.dynamics.com.`);
    }
    return `https://${parsed.hostname.toLowerCase()}`;
}

/** pac profile name for an environment: its org name, at most 30 characters (pac's limit). */
export function pacProfileName(url: string): string {
    const name = orgName(safeEnvironmentOrigin(url)).slice(0, 30);
    // safeEnvironmentOrigin guarantees this; checked again because the name goes onto a shell command line.
    if (!/^[a-z0-9-]+$/.test(name)) {
        throw new Error(`Cannot derive a pac profile name from '${url}'.`);
    }
    return name;
}

/** Model names for pac --model / --modules: comma-separated identifiers. Returns an error message, or undefined when valid. */
export function validateModelList(input: string): string | undefined {
    const names = input.split(',').map(n => n.trim());
    return names.length > 0 && names.every(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))
        ? undefined
        : 'Enter model names (letters, digits and underscores), separated by commas.';
}
