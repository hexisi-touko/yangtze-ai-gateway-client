const fs = require('node:fs')
const path = require('node:path')
const TOML = require('@iarna/toml')
const { BaseSyncAdapter, atomicWrite, maskSecret, readTextIfExists } = require('./base-sync')

const MANAGED_START = '# BEGIN YANGTZEAPI MANAGED CODEX'
const MANAGED_END = '# END YANGTZEAPI MANAGED CODEX'
const MANAGED_KEYS = ['model', 'model_provider', 'model_catalog_json', 'model_reasoning_effort', 'model_context_window', 'model_auto_compact_token_limit', 'model_supports_reasoning_summaries']

function parseConfig(text) { return text.trim() ? TOML.parse(text) : {} }

function catalogEntry(source, priority, providerName) {
  const metadata = source && typeof source === 'object' ? source : {}
  const slug = typeof source === 'string' ? source : metadata.slug
  const levels = Array.isArray(metadata.supported_reasoning_levels)
    ? metadata.supported_reasoning_levels.filter((level) => typeof level?.effort === 'string').map((level) => ({ effort: level.effort, description: typeof level.description === 'string' ? level.description : level.effort }))
    : []
  const defaultReasoning = levels.some((level) => level.effort === metadata.default_reasoning_level) ? metadata.default_reasoning_level : null
  const reasoningSummaries = metadata.supports_reasoning_summaries === true
  return {
    slug, display_name: typeof metadata.display_name === 'string' && metadata.display_name.trim() ? metadata.display_name : slug,
    description: typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description : providerName,
    priority, visibility: 'list', supported_in_api: true,
    default_reasoning_level: defaultReasoning,
    supported_reasoning_levels: levels,
    shell_type: 'unified_exec', supports_reasoning_summaries: reasoningSummaries,
    supports_reasoning_summary_parameter: reasoningSummaries, default_reasoning_summary: 'none',
    support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10000 },
    input_modalities: Array.isArray(metadata.input_modalities) && metadata.input_modalities.length ? metadata.input_modalities.filter((item) => typeof item === 'string') : ['text'],
    experimental_supported_tools: [],
    supports_parallel_tool_calls: metadata.supports_parallel_tool_calls === true, prefer_websockets: false,
    base_instructions: 'You are a coding assistant. Inspect the workspace, use the provided tools to complete the user task, and verify your changes.',
    model_messages: { instructions_template: 'You are a coding assistant. Inspect the workspace, use the provided tools to complete the user task, and verify your changes.' },
    ...(Number.isInteger(metadata.context_window) && metadata.context_window > 0 ? { context_window: metadata.context_window } : {}),
    ...(Number.isInteger(metadata.auto_compact_token_limit) && metadata.auto_compact_token_limit > 0 ? { auto_compact_token_limit: metadata.auto_compact_token_limit } : {}),
  }
}

function buildCatalog(models, providerName = 'API') {
  return { models: models.map((model, priority) => catalogEntry(model, priority, providerName)) }
}

function mergeToml(existing, config) {
  const doc = parseConfig(existing)
  const profile = buildCatalog(config.modelCatalog || config.availableModels || [config.model], config.providerName).models.find((entry) => entry.slug === config.model)
  const previousEffort = doc.model === config.model ? doc.model_reasoning_effort : null
  for (const key of MANAGED_KEYS) delete doc[key]
  doc.model_provider = 'custom'
  doc.model = config.model
  doc.model_catalog_json = config.catalogPath
  const levels = profile?.supported_reasoning_levels?.map((level) => level.effort) || []
  const effort = levels.includes(previousEffort) ? previousEffort : profile?.default_reasoning_level
  if (effort) doc.model_reasoning_effort = effort
  if (profile?.context_window) doc.model_context_window = profile.context_window
  if (profile?.auto_compact_token_limit) doc.model_auto_compact_token_limit = profile.auto_compact_token_limit
  doc.model_supports_reasoning_summaries = profile?.supports_reasoning_summaries === true
  doc.model_providers ||= {}
  doc.model_providers.custom = {
    name: config.providerName || 'API', base_url: config.apiBaseUrl, wire_api: 'responses',
    requires_openai_auth: false, experimental_bearer_token: config.apiKey,
    supports_websockets: false,
  }
  return `${MANAGED_START}\n${TOML.stringify(doc)}\n${MANAGED_END}\n`
}

class CodexAdapter extends BaseSyncAdapter {
  constructor(options) {
    super(options)
    const directory = options.codexHome || path.join(this.homeDir, '.codex')
    this.authPath = path.join(directory, 'auth.json')
    this.configPath = path.join(directory, 'config.toml')
    this.catalogPath = path.join(directory, 'yangtze-model-catalog.json')
    this.backupPath = path.join(directory, 'yangtze-config-backup.json')
  }

  get toolId() { return 'codex-gpt' }
  get displayName() { return 'Codex' }
  get configPaths() { return [this.authPath, this.configPath, this.catalogPath] }

  getLocalState(config) {
    const text = readTextIfExists(this.configPath)
    const doc = parseConfig(text)
    const provider = doc.model_providers?.custom
    const matches = !config || (doc.model === config.model && provider?.base_url === config.apiBaseUrl && provider?.experimental_bearer_token === config.apiKey && provider?.name === (config.providerName || 'API'))
    return { configured: text.includes(MANAGED_START) && matches, model: doc.model }
  }

  apply(config) {
    if (!config || ['apiKey', 'apiBaseUrl', 'model'].some((key) => typeof config[key] !== 'string' || !config[key].trim())) {
      throw new Error('Codex 配置不完整')
    }
    const models = [...new Set(config.availableModels || [config.model])]
    if (!models.includes(config.model)) throw new Error('默认模型必须包含在授权模型中')
    const existing = readTextIfExists(this.configPath)
    const doc = parseConfig(existing)
    const oldAuth = readTextIfExists(this.authPath)
    const auth = oldAuth.trim() ? JSON.parse(oldAuth) : {}
    const source = config.modelCatalog || models
    const catalog = JSON.stringify(buildCatalog(source, config.providerName), null, 2)
    const toml = mergeToml(existing, { ...config, catalogPath: this.catalogPath })
    const snapshots = [...this.configPaths, this.backupPath].map((file) => ({ file, exists: fs.existsSync(file), text: readTextIfExists(file) }))
    try {
      if (!fs.existsSync(this.backupPath)) {
        const keys = Object.fromEntries(MANAGED_KEYS.filter((key) => Object.hasOwn(doc, key)).map((key) => [key, doc[key]]))
        atomicWrite(this.backupPath, JSON.stringify({ keys, custom: doc.model_providers?.custom, apiKey: auth.OPENAI_API_KEY }))
      }
      auth.OPENAI_API_KEY = config.apiKey
      atomicWrite(this.catalogPath, `${catalog}\n`)
      atomicWrite(this.authPath, `${JSON.stringify(auth, null, 2)}\n`)
      atomicWrite(this.configPath, toml)
    } catch (error) {
      for (const snapshot of snapshots) {
        if (snapshot.exists) atomicWrite(snapshot.file, snapshot.text)
        else fs.rmSync(snapshot.file, { force: true })
      }
      throw error
    }
  }

  remove() {
    const existing = readTextIfExists(this.configPath)
    if (!existing.includes(MANAGED_START)) return
    const doc = parseConfig(existing)
    const backupText = readTextIfExists(this.backupPath)
    const backup = backupText ? JSON.parse(backupText) : { keys: {} }
    for (const key of MANAGED_KEYS) delete doc[key]
    Object.assign(doc, backup.keys)
    if (doc.model_providers) {
      delete doc.model_providers.custom
      if (backup.custom) doc.model_providers.custom = backup.custom
    }
    const auth = JSON.parse(readTextIfExists(this.authPath) || '{}')
    delete auth.OPENAI_API_KEY
    if (backup.apiKey !== undefined) auth.OPENAI_API_KEY = backup.apiKey
    atomicWrite(this.configPath, TOML.stringify(doc))
    atomicWrite(this.authPath, `${JSON.stringify(auth, null, 2)}\n`)
    fs.rmSync(this.catalogPath, { force: true })
    fs.rmSync(this.backupPath, { force: true })
  }

  describe(config) {
    return { id: this.toolId, name: this.displayName, model: config.model,
      providerName: config.providerName || 'API',
      apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey, apiKeyMasked: maskSecret(config.apiKey),
      availableModels: config.availableModels || [] }
  }
}

module.exports = { CodexAdapter, mergeToml, buildCatalog }
