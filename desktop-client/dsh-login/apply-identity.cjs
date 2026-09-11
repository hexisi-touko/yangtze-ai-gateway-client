const fs = require('node:fs');
const path = require('node:path');
const OLD = 'You are an AI agent powered by DeepSeek Harness.';
const IDENTITY = 'You are an AI assistant in 长大计科智慧油田实验室. When introducing yourself, use 长大计科智慧油田实验室 as the application name, not DeepSeek Harness. State the model name only when known from the current model configuration; do not invent a model identity.';
function applyIdentity(projectDir) {
  const file = path.join(projectDir, 'node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js');
  const source = fs.readFileSync(file, 'utf8');
  const current = IDENTITY.replace(', not DeepSeek Harness', '');
  if (!source.includes(current)) {
    const previous = source.includes(IDENTITY) ? IDENTITY : OLD;
    if (source.split(previous).length !== 2) throw new Error('Unsupported system identity template');
    fs.writeFileSync(file, source.replace(previous, current));
  }
  const chatFile = path.join(projectDir, 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js');
  let chat = fs.readFileSync(chatFile, 'utf8');
  const start = chat.indexOf('function SystemPromptRow({ text, t }) {');
  const end = chat.indexOf('const SystemPromptNodeView', start);
  if (start < 0 || end < 0) throw new Error('Unsupported system prompt view');
  let section = chat.slice(start, end);
  if (!section.includes('历史系统提示词')) {
    section = section.replace('title: t("message.systemPrompt"),', 'title: text.includes(' + JSON.stringify(OLD) + ') ? "历史系统提示词（更新前）" : t("message.systemPrompt"),');
    chat = chat.slice(0, start) + section + chat.slice(end);
    fs.writeFileSync(chatFile, chat);
  }
}
module.exports = { applyIdentity, IDENTITY: IDENTITY.replace(', not DeepSeek Harness', '') };
