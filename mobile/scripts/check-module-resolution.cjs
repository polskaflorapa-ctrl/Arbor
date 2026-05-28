#!/usr/bin/env node

function checkResolvedModule(request, options) {
  const resolved = require.resolve(request, options);
  require(resolved);
  console.log(`ok ${request} -> ${resolved}`);
  return resolved;
}

console.log('Checking critical Metro module resolution...\n');

const queryStringPath = checkResolvedModule('query-string');
checkResolvedModule('split-on-first', { paths: [queryStringPath] });
checkResolvedModule('filter-obj', { paths: [queryStringPath] });
checkResolvedModule('strict-uri-encode', { paths: [queryStringPath] });
checkResolvedModule('decode-uri-component', { paths: [queryStringPath] });

console.log('\nModule resolution check passed.');
