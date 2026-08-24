import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { spaRewriteFunctionCode } from '../lib/constructs/spa-rewrite-function';
import { productionDomain } from '../lib/production-domain';

interface CloudFrontRequest {
  readonly uri: string;
  readonly headers: { readonly host: { readonly value: string } };
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

function request(host: string, uri: string, rawQueryString?: string): CloudFrontRequest {
  return {
    uri,
    headers: { host: { value: host } },
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
