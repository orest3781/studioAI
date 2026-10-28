'use strict';
function signingConfig(env = process.env) {
  const required = name => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Signed releases require ${name}. No unsigned fallback is allowed.`);
    return value;
  };
  const publisherName = required('WINDOWS_PUBLISHER_NAME');
  const provider = required('WINDOWS_SIGNING_PROVIDER');
  const win = {verifyUpdateCodeSignature: true};
  if (provider === 'certificate') {
    required('CSC_LINK');
    win.signtoolOptions = {publisherName: [publisherName], signingHashAlgorithms: ['sha256']};
  } else if (provider === 'azure') {
    const endpoint = required('AZURE_SIGNING_ENDPOINT');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.codesigning.azure.net') || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS Azure code-signing endpoint.');
    for (const key of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']) required(key);
    win.azureSignOptions = {publisherName, endpoint,
      codeSigningAccountName: required('AZURE_SIGNING_ACCOUNT'),
      certificateProfileName: required('AZURE_SIGNING_PROFILE')};
  } else throw new Error('WINDOWS_SIGNING_PROVIDER must be certificate or azure.');
  return {forceCodeSigning: true, win};
}
module.exports = {signingConfig};
