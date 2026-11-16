import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative as relativePath, resolve, sep } from "node:path";

export type Locale = "en" | "pt-BR";

const en = {
  "app.name": "MCP Router",
  "group.capabilities": "Capabilities",
  "group.servers": "Servers",
  "group.tools": "Tools",
  "group.settings": "Settings",
  "group.storage": "Storage",
  "group.actions": "Actions",
  "action.status": "status",
  "action.capabilities": "capabilities",
  "action.capabilitiesAdd": "capabilities add",
  "action.servers": "servers",
  "action.tools": "tools",
  "action.explain": "explain",
  "action.route": "route",
  "action.check": "check",
  "action.approve": "approve",
  "action.config": "config",
  "action.mode": "mode",
  "action.doctor": "doctor",
  "action.auto": "auto",
  "action.observe": "observe",
  "action.off": "off",
  "action.storageStatus": "storage status",
  "action.storageMigrate": "storage migrate",
  "mode.automatic": "Automatic",
  "mode.observe": "Observe",
  "mode.off": "Off",
  "mode.autoDescription": "Expose locally authorized tools that match the current task.",
  "mode.observeDescription": "Show capability decisions without changing active tools.",
  "mode.offDescription": "Disable automatic MCP tool selection.",
  "mode.defaultAutoDescription": "Allow eligible actions when this extension's policy permits.",
  "mode.defaultObserveDescription": "Show decisions without acting automatically.",
  "mode.defaultOffDescription": "Disable this extension's automatic behavior.",
  "input.capabilityFile": "Capability definition file",
  "input.capabilityIdsRoute": "Capability IDs to route (space-separated)",
  "input.capabilityIdsCheck": "Capability IDs to check (space-separated)",
  "input.approvalFile": "Approval request file",
  "input.storageBackend": "Target backend (files, sqlite, durable)",
  "confirm.capabilityAdd": "Read this capability definition and save it to the local MCP Router catalog?",
  "confirm.route": "Record a local routing decision and update this Pi session's active tools according to the current policy?",
  "confirm.check": "Record a local routing decision and update this Pi session's active tools according to the current policy?",
  "confirm.approve": "Create a local, task-scoped approval from this approval request file?",
  "confirm.doctor": "Run local recovery diagnostics? Recovery may update local store metadata.",
  "confirm.storageMigrate": "Copy the local MCP Router store to the selected backend and switch its local pointer?",
  "ui.currentMode": "Current mode: {mode}",
  "ui.currentLanguage": "Current language: {language}",
  "ui.draftMode": "Draft mode: {mode}",
  "ui.draftLanguage": "Draft language: {language}",
  "ui.groups": "Groups",
  "ui.actions": "Actions",
  "ui.chooseMode": "Choose a mode",
  "ui.chooseLanguage": "Choose a language",
  "ui.move": "Move",
  "ui.open": "Open",
  "ui.close": "Close",
  "ui.back": "Back",
  "ui.chooseDraft": "Choose draft",
  "ui.save": "Save",
  "ui.discard": "discard",
  "ui.saved": "saved",
  "ui.draft": "draft",
  "ui.working": "Working…",
  "ui.savingMode": "Saving mode draft…",
  "ui.running": "Running {label}…",
  "ui.cancelledReady": "Cancelled. The menu is ready.",
  "ui.savedMode": "Saved mode: {mode}.",
  "ui.completed": "Completed: {label}.",
  "ui.couldNotSaveMode": "Could not save the mode. The draft is preserved.",
  "ui.actionFailed": "Action failed. The menu is ready.",
  "ui.cancellationRequested": "Cancellation requested…",
  "ui.unsavedDiscard": "Unsaved draft. Press Esc again to discard.",
  "ui.draftDiscarded": "Draft discarded.",
  "ui.modeAlreadySaved": "Mode is already saved.",
  "ui.enterChoosesDraft": "Enter chooses a draft; Ctrl+S saves.",
  "ui.modeDraftSelected": "Mode draft selected. Press Ctrl+S to save.",
  "ui.modeDraftMatches": "Draft matches the saved mode.",
  "ui.actionCancelled": "Action cancelled; nothing was changed.",
  "ui.inputCancelled": "Input cancelled.",
  "ui.languageDraftSelected": "Language draft selected. Press Ctrl+S to save.",
  "ui.languageAlreadySaved": "Language is already saved.",
  "ui.savingLanguage": "Saving language preference…",
  "ui.savedLanguage": "Saved language: {language}.",
  "ui.couldNotSaveLanguage": "Could not save the language. The draft is preserved.",
  "ui.portugueseTrustedOnly": "Português is available only in trusted projects.",
  "ui.confirm": "Confirm {label}",
  "ui.modeHeading": "{name} / Settings / Mode",
  "ui.languageHeading": "{name} / Settings / Language",
  "ui.groupHeading": "{name} / {group}",
  "ui.modeHelp": "{up} / {down} {move}    {confirm} {chooseDraft}    Ctrl+S {save}    {cancel} {back}",
  "ui.languageHelp": "{up} / {down} {move}    {confirm} {chooseDraft}    Ctrl+S {save}    {cancel} {back}",
  "ui.groupHelp": "{up} / {down} {move}    {confirm} {open}    {cancel} {close}",
  "ui.actionHelp": "{up} / {down} {move}    {confirm} {open}    {cancel} {back}",
  "language.english": "English",
  "language.portuguese": "Português (Brasil)",
  "language.englishName": "English",
  "language.portugueseName": "Brazilian Portuguese",
  "language.rootEntry": "language",
  "language.saveChoice": "Save language",
  "language.savedNotice": "Language preference saved for this trusted project.",
  "language.failedNotice": "Could not save the language preference. The draft is preserved.",
  "language.fallbackNotice": "Using English because this project's locale preference is unavailable or invalid.",
} as const;

const ptBR: Record<keyof typeof en, string> = {
  "app.name": "Roteador MCP",
  "group.capabilities": "Capacidades",
  "group.servers": "Servidores",
  "group.tools": "Ferramentas",
  "group.settings": "Configurações",
  "group.storage": "Armazenamento",
  "group.actions": "Ações",
  "action.status": "status",
  "action.capabilities": "capacidades",
  "action.capabilitiesAdd": "adicionar capacidade",
  "action.servers": "servidores",
  "action.tools": "ferramentas",
  "action.explain": "explicar",
  "action.route": "rotear",
  "action.check": "verificar",
  "action.approve": "aprovar",
  "action.config": "configuração",
  "action.mode": "modo",
  "action.doctor": "diagnóstico",
  "action.auto": "automático",
  "action.observe": "observar",
  "action.off": "desativado",
  "action.storageStatus": "status do armazenamento",
  "action.storageMigrate": "migrar armazenamento",
  "mode.automatic": "Automático",
  "mode.observe": "Observar",
  "mode.off": "Desativado",
  "mode.autoDescription": "Expõe ferramentas autorizadas localmente que correspondem à tarefa atual.",
  "mode.observeDescription": "Mostra decisões de capacidades sem alterar as ferramentas ativas.",
  "mode.offDescription": "Desativa a seleção automática de ferramentas MCP.",
  "mode.defaultAutoDescription": "Permite ações elegíveis quando a política desta extensão autoriza.",
  "mode.defaultObserveDescription": "Mostra decisões sem agir automaticamente.",
  "mode.defaultOffDescription": "Desativa o comportamento automático desta extensão.",
  "input.capabilityFile": "Arquivo de definição da capacidade",
  "input.capabilityIdsRoute": "IDs das capacidades para rotear (separados por espaço)",
  "input.capabilityIdsCheck": "IDs das capacidades para verificar (separados por espaço)",
  "input.approvalFile": "Arquivo da solicitação de aprovação",
  "input.storageBackend": "Backend de destino (files, sqlite, durable)",
  "confirm.capabilityAdd": "Ler esta definição de capacidade e salvá-la no catálogo local do MCP Router?",
  "confirm.route": "Registrar uma decisão local de roteamento e atualizar as ferramentas ativas desta sessão do Pi conforme a política atual?",
  "confirm.check": "Registrar uma decisão local de roteamento e atualizar as ferramentas ativas desta sessão do Pi conforme a política atual?",
  "confirm.approve": "Criar uma aprovação local, limitada à tarefa, a partir deste arquivo de solicitação?",
  "confirm.doctor": "Executar diagnósticos locais de recuperação? A recuperação pode atualizar metadados do armazenamento local.",
  "confirm.storageMigrate": "Copiar o armazenamento local do MCP Router para o backend escolhido e trocar o ponteiro local?",
  "ui.currentMode": "Modo atual: {mode}",
  "ui.currentLanguage": "Idioma atual: {language}",
  "ui.draftMode": "Rascunho do modo: {mode}",
  "ui.draftLanguage": "Rascunho do idioma: {language}",
  "ui.groups": "Grupos",
  "ui.actions": "Ações",
  "ui.chooseMode": "Escolha um modo",
  "ui.chooseLanguage": "Escolha um idioma",
  "ui.move": "Mover",
  "ui.open": "Abrir",
  "ui.close": "Fechar",
  "ui.back": "Voltar",
  "ui.chooseDraft": "Escolher rascunho",
  "ui.save": "Salvar",
  "ui.discard": "descartar",
  "ui.saved": "salvo",
  "ui.draft": "rascunho",
  "ui.working": "Em andamento…",
  "ui.savingMode": "Salvando rascunho do modo…",
  "ui.running": "Executando {label}…",
  "ui.cancelledReady": "Cancelado. O menu está pronto.",
  "ui.savedMode": "Modo salvo: {mode}.",
  "ui.completed": "Concluído: {label}.",
  "ui.couldNotSaveMode": "Não foi possível salvar o modo. O rascunho foi preservado.",
  "ui.actionFailed": "A ação falhou. O menu está pronto.",
  "ui.cancellationRequested": "Cancelamento solicitado…",
  "ui.unsavedDiscard": "Há um rascunho. Pressione Esc novamente para descartá-lo.",
  "ui.draftDiscarded": "Rascunho descartado.",
  "ui.modeAlreadySaved": "O modo já está salvo.",
  "ui.enterChoosesDraft": "Enter seleciona um rascunho; Ctrl+S salva.",
  "ui.modeDraftSelected": "Rascunho de modo selecionado. Pressione Ctrl+S para salvar.",
  "ui.modeDraftMatches": "O rascunho corresponde ao modo salvo.",
  "ui.actionCancelled": "Ação cancelada; nada foi alterado.",
  "ui.inputCancelled": "Entrada cancelada.",
  "ui.languageDraftSelected": "Rascunho de idioma selecionado. Pressione Ctrl+S para salvar.",
  "ui.languageAlreadySaved": "O idioma já está salvo.",
  "ui.savingLanguage": "Salvando preferência de idioma…",
  "ui.savedLanguage": "Idioma salvo: {language}.",
  "ui.couldNotSaveLanguage": "Não foi possível salvar o idioma. O rascunho foi preservado.",
  "ui.portugueseTrustedOnly": "Português está disponível somente em projetos confiáveis.",
  "ui.confirm": "Confirmar {label}",
  "ui.modeHeading": "{name} / Configurações / Modo",
  "ui.languageHeading": "{name} / Configurações / Idioma",
  "ui.groupHeading": "{name} / {group}",
  "ui.modeHelp": "{up} / {down} {move}    {confirm} {chooseDraft}    Ctrl+S {save}    {cancel} {back}",
  "ui.languageHelp": "{up} / {down} {move}    {confirm} {chooseDraft}    Ctrl+S {save}    {cancel} {back}",
  "ui.groupHelp": "{up} / {down} {move}    {confirm} {open}    {cancel} {close}",
  "ui.actionHelp": "{up} / {down} {move}    {confirm} {open}    {cancel} {back}",
  "language.english": "English",
  "language.portuguese": "Português (Brasil)",
  "language.englishName": "Inglês",
  "language.portugueseName": "Português do Brasil",
  "language.rootEntry": "idioma",
  "language.saveChoice": "Salvar idioma",
  "language.savedNotice": "Preferência de idioma salva neste projeto confiável.",
  "language.failedNotice": "Não foi possível salvar a preferência de idioma. O rascunho foi preservado.",
  "language.fallbackNotice": "Usando inglês porque a preferência de idioma deste projeto está indisponível ou inválida.",
};

export const locales = ["en", "pt-BR"] as const;
export const catalogs: Record<Locale, Record<keyof typeof en, string>> = {
  en,
  "pt-BR": ptBR,
};

export function translate(
  locale: Locale,
  key: keyof typeof en,
  values: Record<string, string> = {},
): string {
  return catalogs[locale][key].replace(/\{([a-zA-Z0-9]+)\}/g, (match, name: string) => values[name] ?? match);
}

const menuKeys: Record<string, keyof typeof en> = {
  Capabilities: "group.capabilities",
  Servers: "group.servers",
  Tools: "group.tools",
  Settings: "group.settings",
  Storage: "group.storage",
  Actions: "group.actions",
  status: "action.status",
  capabilities: "action.capabilities",
  "capabilities add": "action.capabilitiesAdd",
  servers: "action.servers",
  tools: "action.tools",
  explain: "action.explain",
  route: "action.route",
  check: "action.check",
  approve: "action.approve",
  config: "action.config",
  mode: "action.mode",
  doctor: "action.doctor",
  auto: "action.auto",
  observe: "action.observe",
  off: "action.off",
  "storage status": "action.storageStatus",
  "storage migrate": "action.storageMigrate",
  language: "language.rootEntry",
  "Capability definition file": "input.capabilityFile",
  "Capability IDs to route (space-separated)": "input.capabilityIdsRoute",
  "Capability IDs to check (space-separated)": "input.capabilityIdsCheck",
  "Approval request file": "input.approvalFile",
  "Target backend (files, sqlite, durable)": "input.storageBackend",
  "Expose locally authorized tools that match the current task.": "mode.autoDescription",
  "Show capability decisions without changing active tools.": "mode.observeDescription",
  "Disable automatic MCP tool selection.": "mode.offDescription",
  "Allow eligible actions when this extension's policy permits.": "mode.defaultAutoDescription",
  "Show decisions without acting automatically.": "mode.defaultObserveDescription",
  "Disable this extension's automatic behavior.": "mode.defaultOffDescription",
  "Read this capability definition and save it to the local MCP Router catalog?": "confirm.capabilityAdd",
  "Record a local routing decision and update this Pi session's active tools according to the current policy?": "confirm.route",
  "Create a local, task-scoped approval from this approval request file?": "confirm.approve",
  "Run local recovery diagnostics? Recovery may update local store metadata.": "confirm.doctor",
  "Copy the local MCP Router store to the selected backend and switch its local pointer?": "confirm.storageMigrate",
};

export function menuText(locale: Locale, value: string): string {
  const exact = menuKeys[value];
  if (exact) return translate(locale, exact);
  const prefix = Object.keys(menuKeys)
    .filter((candidate) => value.startsWith(`${candidate} `))
    .sort((left, right) => right.length - left.length)[0];
  if (!prefix) return value;
  return `${translate(locale, menuKeys[prefix]!)}${value.slice(prefix.length)}`;
}

const localeFile = "pi-mcp-router.locale.json";

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "pt-BR";
}

async function safeLocalePath(cwd: string): Promise<{
  directory: string;
  path: string;
}> {
  const root = await realpath(cwd);
  const directory = resolve(root, ".pi");
  const path = resolve(directory, localeFile);
  const rel = relativePath(root, path);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`)
  )
    throw new Error("locale-path-escape");
  let cursor = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error("locale-symlink-path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { directory, path };
}

export async function readProjectLocale(
  cwd: string,
  trusted: boolean,
): Promise<Locale> {
  if (!trusted) return "en";
  try {
    const { path } = await safeLocalePath(cwd);
    const value = JSON.parse(await readFile(path, "utf8"));
    return value?.schemaVersion === 1 && isLocale(value.locale)
      ? value.locale
      : "en";
  } catch {
    return "en";
  }
}

export async function writeProjectLocale(
  cwd: string,
  trusted: boolean,
  locale: Locale,
  signal?: AbortSignal,
): Promise<void> {
  if (!trusted) throw new Error("untrusted-project");
  if (!isLocale(locale)) throw new Error("invalid-locale");
  if (signal?.aborted) throw new Error("operation-cancelled");
  const { directory, path } = await safeLocalePath(cwd);
  let createdDirectory = false;
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("unsafe-locale-directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
    createdDirectory = true;
  }
  const checkedPath = (await safeLocalePath(cwd)).path;
  const temp = checkedPath + "." + randomUUID() + ".tmp";
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ schemaVersion: 1, locale }, null, 2) + "\n",
        { encoding: "utf8", signal },
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (signal?.aborted) throw new Error("operation-cancelled");
    await rename(temp, checkedPath);
    if (process.platform !== "win32") {
      try {
        const handle = await open(directory, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch {
        // The preference file is already committed; directory sync is best effort.
      }
    }
  } catch (error) {
    await unlink(temp).catch(() => {});
    if (createdDirectory) {
      await rmdir(directory).catch(() => {});
    }
    throw error;
  }
}

export function localePreferencePath(cwd: string): string {
  return join(cwd, ".pi", localeFile);
}
