/* eslint-disable no-var -- CloudFront JavaScript 1.0 requires ES5 syntax in the emitted handler. */
export interface CanonicalDomainRedirect {
  readonly apexDomain: string;
  readonly canonicalUrl: string;
}

interface CloudFrontRequest {
  uri: string;
  readonly headers: { readonly host: { readonly value: string } };
  readonly rawQueryString?: () => string | undefined;
}

interface CloudFrontEvent {
  readonly request: CloudFrontRequest;
}

const developmentHandler = function handler(event: CloudFrontEvent): CloudFrontRequest {
  var request = event.request;
  var uri = request.uri;
  if (uri.includes('.')) return request;
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }
  if (uri.endsWith('/')) uri = uri.slice(0, -1);
  request.uri = uri + '/index.html';
  return request;
};

function productionRequestHandler(
  event: CloudFrontEvent,
  apexDomain: string,
  canonicalUrl: string,
): CloudFrontRequest | Record<string, unknown> {
  var request = event.request;
  if (request.headers.host.value === apexDomain) {
    var rawQueryString = request.rawQueryString!();
    var location = canonicalUrl + request.uri;
    if (rawQueryString) {
      location += '?' + rawQueryString;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: location } },
    };
  }
  var uri = request.uri;
  if (uri.indexOf('/api/') === 0 || uri.includes('.')) {
    return request;
  }
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }
  if (uri.endsWith('/')) {
    uri = uri.slice(0, -1);
  }
  request.uri = uri + '/index.html';
  return request;
}

export function spaRewriteFunctionCode(customDomain?: CanonicalDomainRedirect): string {
  if (!customDomain) {
    return developmentHandler.toString();
  }

  return [
    `var apexDomain = ${JSON.stringify(customDomain.apexDomain)};`,
    `var canonicalUrl = ${JSON.stringify(customDomain.canonicalUrl)};`,
    productionRequestHandler.toString(),
    'function handler(event) {',
    '  return productionRequestHandler(event, apexDomain, canonicalUrl);',
    '}',
  ].join('\n');
}

/**
 * Wraps the existing rewrite handler so every viewer request is challenged
 * before CloudFront selects an origin. The expected value is a complete Basic
 * Authorization header, for example "Basic dXNlcjpwYXNzd29yZA==".
 */
export function basicAuthSpaRewriteFunctionCode(
  expectedAuthorization: string,
  customDomain?: CanonicalDomainRedirect,
): string {
  const rewriteCode = spaRewriteFunctionCode(customDomain).replace(
    'function handler(event)',
    'function rewrite(event)',
  );
  return [
    `var expectedAuthorization = ${JSON.stringify(expectedAuthorization)};`,
    rewriteCode,
    'function handler(event) {',
    '  var authorization = event.request.headers.authorization;',
    '  if (!authorization || authorization.value !== expectedAuthorization) {',
    '    return {',
    '      statusCode: 401,',
    "      statusDescription: 'Unauthorized',",
    "      headers: { 'www-authenticate': { value: 'Basic realm=\"InspectMesh development\"' } },",
    '    };',
    '  }',
    '  return rewrite(event);',
    '}',
  ].join('\n');
}
