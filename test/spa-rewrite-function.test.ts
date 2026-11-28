import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  legacyRedirectTarget,
  legacyRootGuideSlugs,
  legacyRootToolSlugs,
} from '../lib/constructs/legacy-redirects';
import {
  basicAuthSpaRewriteFunctionCode,
  CLOUDFRONT_FUNCTION_MAX_BYTES,
  spaRewriteFunctionCode,
} from '../lib/constructs/spa-rewrite-function';
import { productionDomain } from '../lib/production-domain';

interface CloudFrontRequest {
  readonly uri: string;
  readonly headers: {
    readonly host: { readonly value: string };
    readonly authorization?: { readonly value: string };
  };
  readonly querystring: Record<string, unknown>;
  readonly rawQueryString: () => string | undefined;
}

type CloudFrontHandler = (event: { request: CloudFrontRequest }) => unknown;

function handler(): CloudFrontHandler {
  const candidate: unknown = runInNewContext(
    `${spaRewriteFunctionCode(productionDomain)}; handler;`,
  );
  assert.equal(typeof candidate, 'function');
  return candidate as CloudFrontHandler;
}

function authenticatedHandler(): CloudFrontHandler {
  const candidate: unknown = runInNewContext(
    `${basicAuthSpaRewriteFunctionCode('Basic dGVzdDpwYXNz')}; handler;`,
  );
  assert.equal(typeof candidate, 'function');
  return candidate as CloudFrontHandler;
}

function request(
  host: string,
  uri: string,
  rawQueryString?: string,
  authorization?: string,
): CloudFrontRequest {
  return {
    uri,
    headers: {
      host: { value: host },
      ...(authorization ? { authorization: { value: authorization } } : {}),
    },
    querystring: rawQueryString === undefined ? {} : { present: { value: rawQueryString } },
    rawQueryString: () => rawQueryString,
  };
}

function locationFor(uri: string, rawQueryString?: string): string {
  const result = handler()({
    request: request(productionDomain.apexDomain, uri, rawQueryString),
  }) as {
    readonly headers: { readonly location: { readonly value: string } };
  };
  return result.headers.location.value;
}

void test('redirects the apex root without a query string', () => {
  assert.equal(locationFor('/'), 'https://www.inspectmesh.com/');
});

void test('redirects an apex nested route without a query string', () => {
  assert.equal(locationFor('/stl-quality-check'), 'https://www.inspectmesh.com/stl-quality-check');
});

void test('preserves one apex query-string parameter', () => {
  assert.equal(
    locationFor('/stl-quality-check', 'source=test'),
    'https://www.inspectmesh.com/stl-quality-check?source=test',
  );
});

void test('preserves multiple apex query-string parameters in their original order', () => {
  assert.equal(
    locationFor('/stl-quality-check', 'source=test&campaign=launch'),
    'https://www.inspectmesh.com/stl-quality-check?source=test&campaign=launch',
  );
});

void test('preserves encoded apex query-string values', () => {
  assert.equal(
    locationFor('/stl-quality-check', 'return=%2Ftool%3Ftab%3Dresults&query=one%20two'),
    'https://www.inspectmesh.com/stl-quality-check?return=%2Ftool%3Ftab%3Dresults&query=one%20two',
  );
});

void test('does not redirect the canonical hostname again', () => {
  const canonicalRequest = request(productionDomain.canonicalDomain, '/stl-quality-check');
  const result = handler()({ request: canonicalRequest });

  assert.equal(result, canonicalRequest);
  assert.equal(canonicalRequest.uri, '/stl-quality-check/index.html');
});

void test('never serializes the CloudFront query-string object into a redirect location', () => {
  const locations = [
    locationFor('/'),
    locationFor('/stl-quality-check', 'source=test&campaign=launch'),
  ];

  for (const location of locations) {
    assert.equal(location.includes('[object Object]'), false);
  }
});

void test('redirect target reaches the canonical hostname without a redirect loop', () => {
  const location = locationFor('/stl-quality-check', 'source=test');
  const target = new URL(location);
  const canonicalRequest = request(target.host, target.pathname, target.search.slice(1));

  assert.equal(handler()({ request: canonicalRequest }), canonicalRequest);
});

void test('challenges unauthenticated dev requests before applying the SPA rewrite', () => {
  const unauthenticated = request('dev.example.com', '/stl-tools');
  const response = authenticatedHandler()({ request: unauthenticated }) as {
    readonly statusCode: number;
    readonly headers: { readonly 'www-authenticate': { readonly value: string } };
  };
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['www-authenticate'].value, 'Basic realm="InspectMesh development"');
});

void test('rewrites authenticated dev requests after their credentials are accepted', () => {
  const authenticated = request('dev.example.com', '/stl-tools', undefined, 'Basic dGVzdDpwYXNz');
  const result = authenticatedHandler()({ request: authenticated }) as CloudFrontRequest;
  assert.equal(result.uri, '/stl-tools/index.html');
});

void test('redirects a canonical trailing-slash route to its slashless canonical URL', () => {
  const result = handler()({
    request: request(productionDomain.canonicalDomain, '/guides/', 'source=test'),
  }) as {
    readonly statusCode: number;
    readonly headers: { readonly location: { readonly value: string } };
  };
  assert.equal(result.statusCode, 301);
  assert.equal(result.headers.location.value, 'https://www.inspectmesh.com/guides?source=test');
});

void test('collapses repeated trailing slashes in one redirect', () => {
  const result = handler()({
    request: request(productionDomain.canonicalDomain, '/tools/stl-viewer//'),
  }) as { readonly headers: { readonly location: { readonly value: string } } };
  assert.equal(result.headers.location.value, 'https://www.inspectmesh.com/tools/stl-viewer');
});

void test('strips the apex trailing slash in the same redirect hop', () => {
  assert.equal(locationFor('/guides/'), 'https://www.inspectmesh.com/guides');
});

void test('serves the canonical root without redirecting it', () => {
  const root = request(productionDomain.canonicalDomain, '/');
  assert.equal(handler()({ request: root }), root);
  assert.equal(root.uri, '/index.html');
});

void test('does not redirect API paths that end with a slash', () => {
  const api = request(productionDomain.canonicalDomain, '/api/jobs/');
  assert.equal(handler()({ request: api }), api);
  assert.equal(api.uri, '/api/jobs/');
});

void test('keeps query strings on canonical routes without redirecting them', () => {
  const tracked = request(productionDomain.canonicalDomain, '/guides', 'utm_source=newsletter');
  assert.equal(handler()({ request: tracked }), tracked);
  assert.equal(tracked.uri, '/guides/index.html');
});

function redirectFor(host: string, uri: string, rawQueryString?: string) {
  return handler()({ request: request(host, uri, rawQueryString) }) as {
    readonly statusCode: number;
    readonly headers: { readonly location: { readonly value: string } };
  };
}

const materialSlugs = [
  'pla',
  'petg',
  'abs',
  'asa',
  'tpu',
  'nylon',
  'polycarbonate',
  'polypropylene',
];
const legacyPaths = [
  ...legacyRootToolSlugs.map((slug) => '/' + slug),
  ...legacyRootGuideSlugs.map((slug) => '/' + slug),
  '/3d-printing-materials',
  ...materialSlugs.map((slug) => '/3d-printing-materials/' + slug),
  '/why-wont-my-stl-file-slice',
];

void test('redirects every retired URL to its current page in one hop', () => {
  assert.equal(legacyRootToolSlugs.length, 49);
  assert.equal(legacyRootGuideSlugs.length, 101);
  for (const legacyPath of legacyPaths) {
    const currentPath = legacyRedirectTarget(legacyPath);
    assert.ok(currentPath, legacyPath);
    const result = redirectFor(productionDomain.canonicalDomain, legacyPath);
    assert.equal(result.statusCode, 301);
    assert.equal(result.headers.location.value, `https://www.inspectmesh.com${currentPath}`);
    const target = request(productionDomain.canonicalDomain, currentPath);
    assert.equal(handler()({ request: target }), target);
  }
});

void test('redirects a retired URL from the apex host with a trailing slash and query in one hop', () => {
  const result = redirectFor(productionDomain.apexDomain, '/stl-viewer/', 'source=old');
  assert.equal(
    result.headers.location.value,
    'https://www.inspectmesh.com/tools/stl-viewer?source=old',
  );
});

void test('redirects a renamed guide to its new name in one hop', () => {
  assert.equal(legacyRedirectTarget('/why-wont-my-stl-file-slice'), '/guides/stl-file-wont-slice');
  const result = redirectFor(productionDomain.canonicalDomain, '/why-wont-my-stl-file-slice/');
  assert.equal(result.statusCode, 301);
  assert.equal(
    result.headers.location.value,
    'https://www.inspectmesh.com/guides/stl-file-wont-slice',
  );
  const nested = request(productionDomain.canonicalDomain, '/why-wont-my-stl-file-slice/extra');
  assert.equal(handler()({ request: nested }), nested);
});

void test('leaves the .html object form of a retired URL to 404 at the origin', () => {
  const htmlObject = request(productionDomain.canonicalDomain, '/stl-viewer.html');
  assert.equal(handler()({ request: htmlObject }), htmlObject);
  assert.equal(htmlObject.uri, '/stl-viewer.html');
});

void test('redirects index.html document variants to their clean canonical URL', () => {
  const cases: [string, string][] = [
    ['/index.html', 'https://www.inspectmesh.com/'],
    ['/index.csr.html', 'https://www.inspectmesh.com/'],
    ['/guides/index.html', 'https://www.inspectmesh.com/guides'],
    [
      '/guides/how-to-check-stl-for-errors/index.html',
      'https://www.inspectmesh.com/guides/how-to-check-stl-for-errors',
    ],
  ];
  for (const [uri, location] of cases) {
    const result = redirectFor(productionDomain.canonicalDomain, uri);
    assert.equal(result.statusCode, 301);
    assert.equal(result.headers.location.value, location);
  }
});

void test('redirects the default CloudFront hostname to the canonical hostname', () => {
  const result = redirectFor('d111111abcdef8.cloudfront.net', '/guides', 'a=1');
  assert.equal(result.statusCode, 301);
  assert.equal(result.headers.location.value, 'https://www.inspectmesh.com/guides?a=1');
});

void test('serves static assets and API paths on the canonical host unchanged', () => {
  for (const uri of [
    '/main-ABCDEFGH.js',
    '/examples/collection-review/one-placed-cube.3mf',
    '/api/jobs',
  ]) {
    const asset = request(productionDomain.canonicalDomain, uri);
    assert.equal(handler()({ request: asset }), asset);
    assert.equal(asset.uri, uri);
  }
});

void test('keeps the emitted production function under the CloudFront size limit', () => {
  const size = Buffer.byteLength(spaRewriteFunctionCode(productionDomain), 'utf8');
  assert.ok(size < CLOUDFRONT_FUNCTION_MAX_BYTES, `function is ${size} bytes`);
});

void test('maps root guides, root tools and the old material section to their owners', () => {
  assert.equal(
    redirectFor(productionDomain.canonicalDomain, '/3mf-units-explained').headers.location.value,
    'https://www.inspectmesh.com/guides/3mf-units-explained',
  );
  assert.equal(
    redirectFor(productionDomain.canonicalDomain, '/stl-viewer').headers.location.value,
    'https://www.inspectmesh.com/tools/stl-viewer',
  );
  assert.equal(
    redirectFor(productionDomain.canonicalDomain, '/3d-printing-materials/pla').headers.location
      .value,
    'https://www.inspectmesh.com/materials/pla',
  );
  assert.equal(
    redirectFor(productionDomain.canonicalDomain, '/3d-printing-materials').headers.location.value,
    'https://www.inspectmesh.com/materials',
  );
});

void test('does not redirect current pages, unknown root paths or look-alike prefixes', () => {
  for (const uri of [
    '/guides',
    '/tools',
    '/materials',
    '/examples',
    '/contact',
    '/unknown-page',
    '/3d-printing-materials-extra',
    '/guides/3mf-units-explained',
  ]) {
    const current = request(productionDomain.canonicalDomain, uri);
    assert.equal(handler()({ request: current }), current, uri);
  }
});

void test('keeps tool and guide slug lists disjoint and free of current top-level routes', () => {
  const tools = new Set(legacyRootToolSlugs);
  for (const slug of legacyRootGuideSlugs) {
    assert.equal(tools.has(slug), false, slug);
  }
  for (const slug of [...legacyRootToolSlugs, ...legacyRootGuideSlugs]) {
    assert.ok(/^[a-z0-9-]+$/.test(slug), slug);
    assert.ok(
      ![
        'tools',
        'guides',
        'materials',
        'examples',
        'contact',
        'privacy',
        'cookies',
        '3d-printers',
        'compare',
        'compare-materials',
      ].includes(slug),
      slug,
    );
  }
});

void test('leaves .html object forms of every retired URL to 404 at the origin', () => {
  for (const legacyPath of legacyPaths) {
    const htmlObject = request(productionDomain.canonicalDomain, legacyPath + '.html');
    assert.equal(handler()({ request: htmlObject }), htmlObject, legacyPath + '.html');
    assert.equal(htmlObject.uri, legacyPath + '.html');
  }
});
