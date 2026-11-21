/* eslint-disable no-var -- CloudFront JavaScript 1.0 requires ES5 syntax in the emitted handler. */
import {
  legacyRootGuideSlugs,
  legacyRootToolSlugs,
  legacySectionRedirects,
} from './legacy-redirects';

export interface CanonicalDomainRedirect {
  readonly apexDomain: string;
  readonly canonicalUrl: string;
}

interface CloudFrontRequest {
  uri: string;
  readonly headers: { readonly host: { readonly value: string } };
  readonly rawQueryString?: () => string | undefined;
}

/** Legacy redirect data in the compact shape emitted into the function. */
interface LegacyRedirectData {
  /** Root-level tool slugs, delimited and wrapped by '|'. */
  readonly tools: string;
  /** Root-level guide slugs, delimited and wrapped by '|'. */
  readonly guides: string;
  readonly sections: Readonly<Record<string, string>>;
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
  canonicalHost: string,
  canonicalUrl: string,
  legacy: LegacyRedirectData,
): CloudFrontRequest | Record<string, unknown> {
  var request = event.request;
  var uri = request.uri;
  var isApi = uri.indexOf('/api/') === 0;
  // Any host other than the canonical one (the apex domain, the distribution's
  // *.cloudfront.net name) is a duplicate copy of the site.
  var isCanonicalHost = request.headers.host.value === canonicalHost;
  var path = uri;
  if (!isApi) {
    // One canonical URL per page. Every variant resolves to its final URL in a
    // single hop, so no request chains redirects:
    //   /guides/            -> /guides
    //   /guides/index.html  -> /guides
    //   /index.html, /index.csr.html -> /
    //   retired /stl-viewer -> /tools/stl-viewer
    //   pre-move /3mf-units-explained -> /guides/3mf-units-explained
    //   /3d-printing-materials/pla -> /materials/pla
    while (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    if (path === '/index.html' || path === '/index.csr.html') {
      path = '/';
    } else if (path.endsWith('/index.html')) {
      path = path.slice(0, -'/index.html'.length);
    }
    var slug = path.slice(1);
    var isRootSlug = slug.length > 0 && slug.indexOf('/') === -1;
    if (isRootSlug && legacy.tools.indexOf('|' + slug + '|') !== -1) {
      path = '/tools/' + slug;
    } else if (isRootSlug && legacy.guides.indexOf('|' + slug + '|') !== -1) {
      path = '/guides/' + slug;
    } else {
      var sections = Object.keys(legacy.sections);
      for (var index = 0; index < sections.length; index++) {
        var from = sections[index]!;
        if (path === from || path.indexOf(from + '/') === 0) {
          path = legacy.sections[from] + path.slice(from.length);
          break;
        }
      }
    }
  }
  if (!isCanonicalHost || path !== uri) {
    var rawQueryString = request.rawQueryString!();
    var location = canonicalUrl + path;
    if (rawQueryString) {
      location += '?' + rawQueryString;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: location } },
    };
  }
  if (isApi || uri.includes('.')) {
    return request;
  }
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }
  request.uri = uri + '/index.html';
  return request;
}

/** CloudFront Functions reject code larger than 10 KB. */
export const CLOUDFRONT_FUNCTION_MAX_BYTES = 10 * 1024;

export function spaRewriteFunctionCode(customDomain?: CanonicalDomainRedirect): string {
  if (!customDomain) {
    return developmentHandler.toString();
  }

  return [
    `var canonicalHost = ${JSON.stringify(new URL(customDomain.canonicalUrl).host)};`,
    `var canonicalUrl = ${JSON.stringify(customDomain.canonicalUrl)};`,
    `var legacy = ${JSON.stringify({
      tools: '|' + legacyRootToolSlugs.join('|') + '|',
      guides: '|' + legacyRootGuideSlugs.join('|') + '|',
      sections: legacySectionRedirects,
    })};`,
    productionRequestHandler.toString(),
    'function handler(event) {',
    '  return productionRequestHandler(event, canonicalHost, canonicalUrl, legacy);',
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
