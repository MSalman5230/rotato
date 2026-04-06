const fs = require('fs');
const path = require('path');

class Config {
  constructor() {
    this.port = null;
    this.providers = new Map(); // Map of provider_name -> { apiType, keys, baseUrl }
    this.geminiApiKeys = [];
    this.openaiApiKeys = [];
    this.baseUrl = null;
    this.configPath = this.resolveConfigPath();
    this.currentEnvVars = {};
    this.loadConfig();
  }

  resolveConfigPath() {
    const customPath = process.env.CONFIG_PATH && process.env.CONFIG_PATH.trim();
    return customPath ? path.resolve(customPath) : path.join(process.cwd(), '.env');
  }

  getConfigPath() {
    return this.configPath;
  }

  hasConfigFile() {
    return fs.existsSync(this.configPath);
  }

  getBootstrapEnvVars() {
    const envVars = {};
    const exactKeys = new Set(['PORT', 'ADMIN_PASSWORD', 'BASE_URL']);
    const suffixes = ['_API_KEYS', '_BASE_URL', '_ACCESS_KEY', '_DEFAULT_MODEL', '_MODEL_HISTORY', '_DISABLED'];

    for (const [key, value] of Object.entries(process.env)) {
      if (!value) {
        continue;
      }

      if (exactKeys.has(key) || suffixes.some(suffix => key.endsWith(suffix))) {
        envVars[key] = value;
      }
    }

    return envVars;
  }

  getEffectiveEnvVars() {
    const fileEnvVars = this.hasConfigFile()
      ? this.parseEnvFile(fs.readFileSync(this.configPath, 'utf8'))
      : {};

    return {
      ...this.getBootstrapEnvVars(),
      ...fileEnvVars
    };
  }

  getEnvVars() {
    return { ...this.currentEnvVars };
  }

  loadConfig() {
    const envPath = this.configPath;

    console.log(`[CONFIG] Loading configuration from ${envPath}`);

    if (!this.hasConfigFile()) {
      console.log('[CONFIG] Config file not found, falling back to runtime environment variables');
    }

    const envVars = this.getEffectiveEnvVars();
    this.currentEnvVars = { ...envVars };

    const missingFields = [];

    if (!envVars.PORT) {
      missingFields.push('PORT');
    }

    if (!envVars.ADMIN_PASSWORD) {
      missingFields.push('ADMIN_PASSWORD');
    }

    if (missingFields.length > 0) {
      console.error('\n[CONFIG] ERROR: Required fields missing in configuration');
      console.error(`Missing fields: ${missingFields.join(', ')}`);
      console.error(`Config file path: ${envPath}`);
      console.error('\nBoth PORT and ADMIN_PASSWORD are required to run the server.');
      console.error('Example configuration:');
      console.error('  PORT=8990');
      console.error('  ADMIN_PASSWORD=your-secure-password\n');
      throw new Error(`Required fields missing: ${missingFields.join(', ')}`);
    }

    this.port = parseInt(envVars.PORT, 10);
    this.adminPassword = envVars.ADMIN_PASSWORD;

    console.log(`[CONFIG] Port: ${this.port}`);
    console.log('[CONFIG] Admin panel enabled with password authentication');

    this.providers.clear();

    this.parseProviders(envVars);
    this.parseBackwardCompatibility(envVars);

    console.log(`[CONFIG] Found ${this.providers.size} providers configured`);

    for (const [providerName, config] of this.providers.entries()) {
      const maskedKeys = config.keys.map(key => this.maskApiKey(key));
      console.log(`[CONFIG] Provider '${providerName}' (${config.apiType}): ${config.keys.length} keys [${maskedKeys.join(', ')}] -> ${config.baseUrl}`);
    }

    if (this.providers.size === 0) {
      console.log(`[CONFIG] No providers configured yet - use the admin panel at http://localhost:${this.port}/admin to add providers`);
    }
  }

  parseEnvFile(content) {
    const envVars = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmedLine.substring(0, equalIndex).trim();
      const value = trimmedLine.substring(equalIndex + 1).trim();

      envVars[key] = value;
    }

    return envVars;
  }

  parseApiKeys(keysString) {
    if (!keysString) {
      return [];
    }

    return keysString
      .split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0);
  }

  parseApiKeysWithState(keysString) {
    if (!keysString) {
      return { allKeys: [], enabledKeys: [] };
    }

    const allKeys = [];
    const enabledKeys = [];

    keysString.split(',').forEach(raw => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return;
      }

      if (trimmed.startsWith('~')) {
        const key = trimmed.substring(1);
        if (key.length > 0) {
          allKeys.push({ key, disabled: true });
        }
      } else {
        allKeys.push({ key: trimmed, disabled: false });
        enabledKeys.push(trimmed);
      }
    });

    return { allKeys, enabledKeys };
  }

  parseProviders(envVars) {
    const providerConfigs = new Map();

    const defaultConfig = () => ({
      apiType: null,
      keys: [],
      allKeys: [],
      baseUrl: null,
      accessKey: null,
      defaultModel: null,
      disabled: false
    });

    for (const [key, value] of Object.entries(envVars)) {
      if (key.endsWith('_API_KEYS') && value) {
        const parts = key.replace('_API_KEYS', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          const { allKeys, enabledKeys } = this.parseApiKeysWithState(value);
          providerConfigs.get(provider).keys = enabledKeys;
          providerConfigs.get(provider).allKeys = allKeys;
          providerConfigs.get(provider).apiType = apiType;
        }
      } else if (key.endsWith('_BASE_URL') && value) {
        const parts = key.replace('_BASE_URL', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).baseUrl = value.trim();
        }
      } else if (key.endsWith('_ACCESS_KEY') && value) {
        const parts = key.replace('_ACCESS_KEY', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).accessKey = value.trim();
        }
      } else if (key.endsWith('_DEFAULT_MODEL') && value) {
        const parts = key.replace('_DEFAULT_MODEL', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).defaultModel = value.trim();
        }
      } else if (key.endsWith('_DISABLED') && value) {
        const parts = key.replace('_DISABLED', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).disabled = (value.trim().toLowerCase() === 'true');
        }
      }
    }

    for (const [provider, config] of providerConfigs.entries()) {
      if (config.allKeys.length > 0) {
        if (!config.baseUrl) {
          if (config.apiType === 'openai') {
            config.baseUrl = 'https://api.openai.com/v1';
          } else if (config.apiType === 'gemini') {
            config.baseUrl = 'https://generativelanguage.googleapis.com/v1';
          }
        }

        this.providers.set(provider, config);
      }
    }
  }

  parseBackwardCompatibility(envVars) {
    this.geminiApiKeys = this.parseApiKeys(envVars.GEMINI_API_KEYS);
    this.openaiApiKeys = this.parseApiKeys(envVars.OPENAI_API_KEYS);
    this.baseUrl = (envVars.BASE_URL && envVars.BASE_URL.trim()) ? envVars.BASE_URL.trim() : null;

    if (this.openaiApiKeys.length > 0) {
      const baseUrl = this.baseUrl || 'https://api.openai.com/v1';
      this.providers.set('openai', {
        apiType: 'openai',
        keys: this.openaiApiKeys,
        allKeys: this.openaiApiKeys.map(key => ({ key, disabled: false })),
        baseUrl,
        accessKey: null,
        defaultModel: null,
        disabled: false
      });
    }

    if (this.geminiApiKeys.length > 0) {
      const baseUrl = 'https://generativelanguage.googleapis.com/v1';
      this.providers.set('gemini', {
        apiType: 'gemini',
        keys: this.geminiApiKeys,
        allKeys: this.geminiApiKeys.map(key => ({ key, disabled: false })),
        baseUrl,
        accessKey: null,
        defaultModel: null,
        disabled: false
      });
    }
  }

  getPort() {
    return this.port;
  }

  getGeminiApiKeys() {
    return [...this.geminiApiKeys];
  }

  getOpenaiApiKeys() {
    return [...this.openaiApiKeys];
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getGeminiBaseUrl() {
    return this.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  getOpenaiBaseUrl() {
    return this.baseUrl || 'https://api.openai.com';
  }

  hasGeminiKeys() {
    return this.geminiApiKeys.length > 0;
  }

  hasOpenaiKeys() {
    return this.openaiApiKeys.length > 0;
  }

  getAdminPassword() {
    return this.adminPassword;
  }

  hasAdminPassword() {
    return this.adminPassword && this.adminPassword.length > 0;
  }

  maskApiKey(key) {
    if (!key || key.length < 8) {
      return '***';
    }

    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }

  getProviders() {
    return this.providers;
  }

  getProvider(providerName) {
    return this.providers.get(providerName);
  }

  hasProvider(providerName) {
    return this.providers.has(providerName);
  }

  getProvidersByApiType(apiType) {
    const result = new Map();
    for (const [name, config] of this.providers.entries()) {
      if (config.apiType === apiType) {
        result.set(name, config);
      }
    }
    return result;
  }

  getAllGeminiKeys() {
    const keys = [];
    for (const [, config] of this.providers.entries()) {
      if (config.apiType === 'gemini') {
        keys.push(...config.keys);
      }
    }
    return keys;
  }

  getAllOpenaiKeys() {
    const keys = [];
    for (const [, config] of this.providers.entries()) {
      if (config.apiType === 'openai') {
        keys.push(...config.keys);
      }
    }
    return keys;
  }
}

module.exports = Config;
