const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Android 7.0 predates ISRG Root X1 in the system trust store.
 * Keep the bundled public root available for the production Render API
 * domain when its certificate chain uses it, alongside system trust roots.
 * This does not bypass hostname checks, allow cleartext HTTP, or trust
 * arbitrary custom certificates.
 */
function withAuthNetworkSecurity(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Android application manifest entry was not found');
    application.$ ||= {};
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    application.$['android:usesCleartextTraffic'] = 'false';
    return manifestConfig;
  });

  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const sourceCertificate = path.join(
        modConfig.modRequest.projectRoot,
        'assets',
        'certs',
        'isrg-root-x1.crt'
      );
      if (!fs.existsSync(sourceCertificate)) {
        throw new Error(`Missing trusted root certificate: ${sourceCertificate}`);
      }

      const resources = path.join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      const rawDirectory = path.join(resources, 'raw');
      const xmlDirectory = path.join(resources, 'xml');
      fs.mkdirSync(rawDirectory, { recursive: true });
      fs.mkdirSync(xmlDirectory, { recursive: true });
      fs.copyFileSync(sourceCertificate, path.join(rawDirectory, 'isrg_root_x1.pem'));

      const networkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">broskie.onrender.com</domain>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="@raw/isrg_root_x1" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;
      fs.writeFileSync(path.join(xmlDirectory, 'network_security_config.xml'), networkSecurityConfig);
      return modConfig;
    },
  ]);

  return config;
}

module.exports = withAuthNetworkSecurity;
