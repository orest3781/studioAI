const {test} = require('node:test');
const assert = require('node:assert/strict');
const {signingConfig} = require('../signing.cjs');
test('no signing identity fails closed', () => {
  assert.throws(() => signingConfig({}), /WINDOWS_PUBLISHER_NAME/);
  assert.throws(() => signingConfig({WINDOWS_PUBLISHER_NAME:'Test'}), /WINDOWS_SIGNING_PROVIDER/);
});
test('certificate release requires credentials and signature verification', () => {
  const env = {WINDOWS_PUBLISHER_NAME:'Test', WINDOWS_SIGNING_PROVIDER:'certificate'};
  assert.throws(() => signingConfig(env), /CSC_LINK/);
  const config = signingConfig({...env, CSC_LINK:'test-only'});
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(config.win.signtoolOptions.publisherName, ['Test']);
});
test('Azure configuration restricts endpoints and requires credentials', () => {
  const env = {WINDOWS_PUBLISHER_NAME:'Test', WINDOWS_SIGNING_PROVIDER:'azure', AZURE_SIGNING_ENDPOINT:'https://eus.codesigning.azure.net',
    AZURE_TENANT_ID:'test', AZURE_CLIENT_ID:'test', AZURE_CLIENT_SECRET:'test', AZURE_SIGNING_ACCOUNT:'test', AZURE_SIGNING_PROFILE:'test'};
  assert.equal(signingConfig(env).win.azureSignOptions.publisherName, 'Test');
  for (const endpoint of ['http://eus.codesigning.azure.net','https://evil.example','https://eus.codesigning.azure.net.evil.example'])
    assert.throws(() => signingConfig({...env, AZURE_SIGNING_ENDPOINT:endpoint}));
  assert.throws(() => signingConfig({...env, AZURE_CLIENT_SECRET:''}), /AZURE_CLIENT_SECRET/);
});
