/**
 * Expo Config Plugin for SSL Certificate Pinning
 *
 * This plugin configures native SSL pinning for both iOS and Android.
 * It integrates with TrustKit (iOS) and OkHttp CertificatePinner (Android).
 *
 * Usage in app.json:
 * {
 *   "plugins": [
 *     ["./plugins/withSSLPinning", {
 *       "domains": {
 *         "bf-api.tnc.trading": [
 *           "sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
 *           "sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
 *         ]
 *       }
 *     }]
 *   ]
 * }
 */

const {
  withInfoPlist,
  withAndroidManifest,
  withMainApplication,
  withAppBuildGradle,
} = require('@expo/config-plugins');

/**
 * iOS: Configure TrustKit for SSL pinning
 */
function withIOSSSLPinning(config, { domains }) {
  return withInfoPlist(config, (config) => {
    // TrustKit configuration in Info.plist
    const trustKitConfig = {
      TSKSwizzleNetworkDelegates: true,
      TSKPinnedDomains: {},
    };

    for (const [domain, pins] of Object.entries(domains)) {
      trustKitConfig.TSKPinnedDomains[domain] = {
        TSKEnforcePinning: true,
        TSKIncludeSubdomains: false,
        TSKPublicKeyHashes: pins.map((pin) =>
          pin.startsWith('sha256/') ? pin.substring(7) : pin
        ),
        // Report URI for pinning validation failures
        TSKReportUris: ['https://security-monitor.tnc.trading/api/pinning-failure'],
      };
    }

    config.modResults.TSKConfiguration = trustKitConfig;
    return config;
  });
}

/**
 * Android: Add OkHttp certificate pinning dependencies
 */
function withAndroidSSLPinningDependencies(config) {
  return withAppBuildGradle(config, (config) => {
    // OkHttp is already included with React Native, just ensure it's configured
    if (!config.modResults.contents.includes('okhttp-tls')) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*{/,
        `dependencies {
    implementation 'com.squareup.okhttp3:okhttp-tls:4.12.0'`
      );
    }
    return config;
  });
}

/**
 * Android: Configure certificate pinning in MainApplication
 */
function withAndroidSSLPinning(config, { domains }) {
  return withMainApplication(config, (config) => {
    const pinsCode = Object.entries(domains)
      .map(([domain, pins]) => {
        const pinsList = pins
          .map((pin) => `"${pin.startsWith('sha256/') ? pin : `sha256/${pin}`}"`)
          .join(', ');
        return `        .add("${domain}", ${pinsList})`;
      })
      .join('\n');

    // Add certificate pinner initialization
    const sslPinningInit = `
    // SSL Certificate Pinning
    private void initSSLPinning() {
        CertificatePinner certificatePinner = new CertificatePinner.Builder()
${pinsCode}
            .build();

        OkHttpClient client = new OkHttpClient.Builder()
            .certificatePinner(certificatePinner)
            .build();

        // Set as default for all network requests
        OkHttpClientProvider.setOkHttpClientFactory(() -> client);
    }
`;

    // Check if MainActivity contains onCreate
    if (
      config.modResults.contents.includes('onCreate') &&
      !config.modResults.contents.includes('initSSLPinning')
    ) {
      // Add import statements
      if (!config.modResults.contents.includes('import okhttp3.CertificatePinner')) {
        config.modResults.contents = config.modResults.contents.replace(
          /package\s+[\w.]+;/,
          `$&

import okhttp3.CertificatePinner;
import okhttp3.OkHttpClient;
import com.facebook.react.modules.network.OkHttpClientProvider;`
        );
      }

      // Add method before the closing brace of the class
      config.modResults.contents = config.modResults.contents.replace(
        /}\s*$/,
        `${sslPinningInit}
}`
      );

      // Call initSSLPinning in onCreate
      config.modResults.contents = config.modResults.contents.replace(
        /super\.onCreate\(\);/,
        `super.onCreate();
        initSSLPinning();`
      );
    }

    return config;
  });
}

/**
 * Main plugin function
 */
function withSSLPinning(config, props = {}) {
  // `expo.extra.sslPinning.domains` is the single declaration: the JS runtime
  // (lib/ssl-pinning.ts) reads the same object. They used to be declared twice
  // and had already drifted — the production host was pinned natively and left
  // unpinned in JS. Props still win, so a build can override without editing
  // the shared config.
  const domains = props.domains || config.extra?.sslPinning?.domains || {};

  if (Object.keys(domains).length === 0) {
    console.warn(
      '[withSSLPinning] No domains configured for SSL pinning. ' +
        'Set expo.extra.sslPinning.domains in app.json.'
    );
    return config;
  }

  // Apply iOS configuration
  config = withIOSSSLPinning(config, { domains });

  // Apply Android configuration
  config = withAndroidSSLPinningDependencies(config);
  config = withAndroidSSLPinning(config, { domains });

  return config;
}

module.exports = withSSLPinning;
