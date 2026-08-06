"use strict";
const APP_VERSION = '0.2.0';
const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'password-library-state';
const ENTRIES_SHEET = 'Entries';
const CUSTOM_FIELDS_SHEET = 'CustomFields';
const SETTINGS_SHEET = 'Settings';
const META_SHEET = 'Meta';
const titleInput = getRequiredElement('title-input');
const usernameInput = getRequiredElement('username-input');
const passwordInput = getRequiredElement('password-input');
const notesInput = getRequiredElement('notes-input');
const saveButton = getRequiredElement('save-button');
const formTitle = getRequiredElement('form-title');
const customFieldsContainer = getRequiredElement('custom-fields');
const editorShell = getRequiredElement('editor-shell');
const notificationElement = getRequiredElement('notification');
const librarySummary = getRequiredElement('library-summary');
const themeToggleButton = getRequiredElement('theme-toggle');
const themeToggleIcon = getRequiredElement('theme-toggle-icon');
const searchInput = getRequiredElement('search-input');
const entryList = getRequiredElement('entry-list');
const entryForm = getRequiredElement('entry-form');
const toggleDraftPasswordButton = getRequiredElement('toggle-draft-password');
const draftEyeIcon = getRequiredElement('draft-eye-icon');
const addSectionButton = getRequiredElement('add-section-button');
const clearButton = getRequiredElement('clear-button');
const newEntryButton = getRequiredElement('new-entry-button');
const exportButton = getRequiredElement('export-button');
const importButton = getRequiredElement('import-button');
const importInput = getRequiredElement('import-input');
let draft = createEmptyDraft();
let editingEntryId = null;
let isEditorOpen = false;
let draftPasswordVisible = false;
let revealedPasswords = {};
let notification = null;
let notificationTimeoutId = null;
let searchQuery = '';
let expandedEntryId = null;
let appState = loadInitialState();
bindEvents();
render();
function getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element;
}
function bindEvents() {
    titleInput.addEventListener('input', () => {
        draft.title = titleInput.value;
    });
    usernameInput.addEventListener('input', () => {
        draft.username = usernameInput.value;
    });
    passwordInput.addEventListener('input', () => {
        draft.password = passwordInput.value;
    });
    notesInput.addEventListener('input', () => {
        draft.notes = notesInput.value;
    });
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value;
        renderEntries();
    });
    entryForm.addEventListener('submit', (event) => {
        event.preventDefault();
        saveEntry();
    });
    toggleDraftPasswordButton.addEventListener('click', () => {
        draftPasswordVisible = !draftPasswordVisible;
        renderDraftPassword();
    });
    addSectionButton.addEventListener('click', () => {
        draft.customFields.push(createEmptyCustomField());
        renderCustomFields();
    });
    themeToggleButton.addEventListener('click', () => {
        appState.settings.theme = appState.settings.theme === 'dark' ? 'light' : 'dark';
        appState.meta.updatedAt = createTimestamp();
        persistState();
        renderTheme();
    });
    clearButton.addEventListener('click', () => {
        resetDraft();
        isEditorOpen = false;
        render();
    });
    newEntryButton.addEventListener('click', () => {
        resetDraft();
        isEditorOpen = true;
        setNotification(null);
        render();
    });
    exportButton.addEventListener('click', () => {
        try {
            exportExcel();
        }
        catch (error) {
            setNotification({
                type: 'error',
                message: getErrorMessage(error, 'Export failed. No file was created.'),
            });
            renderNotification();
        }
    });
    importButton.addEventListener('click', () => {
        importInput.click();
    });
    importInput.addEventListener('change', async () => {
        const selectedFile = importInput.files?.[0];
        importInput.value = '';
        if (selectedFile === undefined) {
            return;
        }
        if (!window.confirm('Importing will replace your current local library. Continue?')) {
            return;
        }
        try {
            const nextState = await importExcel(selectedFile);
            appState = nextState;
            revealedPasswords = {};
            expandedEntryId = null;
            resetDraft();
            isEditorOpen = false;
            persistState();
            setNotification({
                type: 'success',
                message: `Imported ${appState.entries.length} entries from ${selectedFile.name}.`,
            });
            render();
        }
        catch (error) {
            setNotification({
                type: 'error',
                message: getErrorMessage(error, 'Import failed. Existing local data was kept unchanged.'),
            });
            renderNotification();
        }
    });
    entryList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const actionButton = target.closest('button[data-action]');
        if (actionButton === null) {
            return;
        }
        const entryId = actionButton.dataset.entryId;
        if (typeof entryId !== 'string' || entryId.length === 0) {
            return;
        }
        const action = actionButton.dataset.action;
        if (action === 'edit') {
            startEditing(entryId);
            return;
        }
        if (action === 'toggle-expand') {
            expandedEntryId = expandedEntryId === entryId ? null : entryId;
            renderEntries();
            return;
        }
        if (action === 'delete') {
            deleteEntry(entryId);
            return;
        }
        if (action === 'toggle-password') {
            revealedPasswords[entryId] = !revealedPasswords[entryId];
            renderEntries();
        }
    });
}
function createTimestamp() {
    return new Date().toISOString();
}
function createId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function createEmptyCustomField() {
    return {
        id: createId('field'),
        label: '',
        value: '',
    };
}
function createEmptyDraft() {
    return {
        title: '',
        username: '',
        password: '',
        notes: '',
        customFields: [],
    };
}
function createInitialState() {
    const now = createTimestamp();
    return {
        schemaVersion: SCHEMA_VERSION,
        settings: {
            maskPasswordsByDefault: true,
            theme: 'dark',
        },
        entries: [],
        meta: {
            createdAt: now,
            updatedAt: now,
            appVersion: APP_VERSION,
            lastExportedAt: null,
            lastImportedAt: null,
        },
    };
}
function loadInitialState() {
    try {
        const storedValue = window.localStorage.getItem(STORAGE_KEY);
        if (storedValue === null) {
            return createInitialState();
        }
        const parsedValue = JSON.parse(storedValue);
        return migrateState(parsedValue);
    }
    catch (error) {
        setNotification({
            type: 'error',
            message: getErrorMessage(error, 'Saved data could not be loaded. A fresh local library was created.'),
        });
        return createInitialState();
    }
}
function setNotification(nextNotification) {
    if (notificationTimeoutId !== null) {
        window.clearTimeout(notificationTimeoutId);
        notificationTimeoutId = null;
    }
    notification = nextNotification;
    if (nextNotification === null) {
        return;
    }
    const timeoutMs = nextNotification.type === 'error' ? 4200 : 2200;
    notificationTimeoutId = window.setTimeout(() => {
        notification = null;
        notificationTimeoutId = null;
        renderNotification();
    }, timeoutMs);
}
function render() {
    renderNotification();
    renderTheme();
    renderSummary();
    renderForm();
    renderSearch();
    renderEntries();
}
function renderNotification() {
    if (notification === null) {
        notificationElement.className = 'banner hidden';
        notificationElement.textContent = '';
        return;
    }
    notificationElement.className = `banner ${notification.type}`;
    notificationElement.textContent = notification.message;
}
function renderSummary() {
    const entryCount = appState.entries.length;
    librarySummary.textContent = entryCount === 1 ? '1 entry' : `${entryCount} entries`;
}
function renderTheme() {
    applyTheme(appState.settings.theme);
    const isDark = appState.settings.theme === 'dark';
    themeToggleButton.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    themeToggleButton.setAttribute('aria-label', themeToggleButton.title);
    themeToggleIcon.innerHTML = isDark
        ? `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd"/></svg>`
        : `<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>`;
}
function renderSearch() {
    searchInput.value = searchQuery;
}
function renderForm() {
    editorShell.classList.toggle('hidden', !isEditorOpen);
    formTitle.textContent = editingEntryId === null ? 'New entry' : 'Update entry';
    saveButton.textContent = editingEntryId === null ? 'Save entry' : 'Update entry';
    titleInput.value = draft.title;
    usernameInput.value = draft.username;
    passwordInput.value = draft.password;
    notesInput.value = draft.notes;
    renderDraftPassword();
    renderCustomFields();
}
function renderDraftPassword() {
    passwordInput.type = draftPasswordVisible ? 'text' : 'password';
    draftEyeIcon.innerHTML = getEyeIconMarkup(draftPasswordVisible);
    toggleDraftPasswordButton.setAttribute('aria-label', draftPasswordVisible ? 'Hide password' : 'Show password');
    toggleDraftPasswordButton.title = draftPasswordVisible ? 'Hide password' : 'Show password';
}
function renderCustomFields() {
    customFieldsContainer.innerHTML = '';
    if (draft.customFields.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'custom-field-empty';
        emptyState.textContent = 'No additional sections';
        customFieldsContainer.append(emptyState);
        return;
    }
    draft.customFields.forEach((field, index) => {
        const row = document.createElement('div');
        row.className = 'custom-field-row';
        const labelInputElement = document.createElement('input');
        labelInputElement.placeholder = `Section ${index + 1} label`;
        labelInputElement.value = field.label;
        labelInputElement.addEventListener('input', () => {
            field.label = labelInputElement.value;
        });
        const valueInputElement = document.createElement('input');
        valueInputElement.placeholder = 'Section value';
        valueInputElement.value = field.value;
        valueInputElement.addEventListener('input', () => {
            field.value = valueInputElement.value;
        });
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'ghost-button';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
            removeCustomField(field.id);
        });
        row.append(labelInputElement, valueInputElement, removeButton);
        customFieldsContainer.append(row);
    });
}
function removeCustomField(fieldId) {
    draft.customFields = draft.customFields.filter((field) => field.id !== fieldId);
    renderCustomFields();
}
function resetDraft() {
    draft = createEmptyDraft();
    editingEntryId = null;
    draftPasswordVisible = true;
}
function saveEntry() {
    const nextEntry = buildEntryFromDraft(draft, editingEntryId);
    const remainingEntries = appState.entries.filter((entry) => entry.id !== nextEntry.id);
    appState.entries = sortEntriesByUpdatedAt([nextEntry, ...remainingEntries]);
    appState.meta.updatedAt = createTimestamp();
    appState.meta.appVersion = APP_VERSION;
    try {
        persistState();
        setNotification({
            type: 'success',
            message: editingEntryId === null ? 'Entry saved locally.' : 'Entry updated locally.',
        });
        expandedEntryId = null;
        resetDraft();
        isEditorOpen = false;
        render();
    }
    catch (error) {
        setNotification({
            type: 'error',
            message: getErrorMessage(error, 'Unable to save this entry locally. Check browser storage availability.'),
        });
        renderNotification();
    }
}
function buildEntryFromDraft(sourceDraft, existingEntryId) {
    const now = createTimestamp();
    const existingEntry = existingEntryId === null
        ? undefined
        : appState.entries.find((entry) => entry.id === existingEntryId);
    return {
        id: existingEntry?.id ?? createId('entry'),
        title: normalizeTrimmedString(sourceDraft.title) || 'Untitled entry',
        username: normalizeString(sourceDraft.username),
        password: normalizeString(sourceDraft.password),
        notes: normalizeString(sourceDraft.notes),
        customFields: sourceDraft.customFields
            .map((field) => ({
            id: field.id || createId('field'),
            label: normalizeTrimmedString(field.label),
            value: normalizeString(field.value),
        }))
            .filter((field) => field.label.length > 0 || field.value.length > 0),
        createdAt: existingEntry?.createdAt ?? now,
        updatedAt: now,
    };
}
function startEditing(entryId) {
    const entry = appState.entries.find((currentEntry) => currentEntry.id === entryId);
    if (entry === undefined) {
        return;
    }
    editingEntryId = entry.id;
    isEditorOpen = true;
    draftPasswordVisible = false;
    draft = {
        title: entry.title,
        username: entry.username,
        password: entry.password,
        notes: entry.notes,
        customFields: entry.customFields.length > 0
            ? entry.customFields.map((field) => ({ ...field }))
            : [],
    };
    setNotification(null);
    render();
}
function deleteEntry(entryId) {
    const entry = appState.entries.find((currentEntry) => currentEntry.id === entryId);
    if (entry === undefined) {
        return;
    }
    if (!window.confirm(`Delete "${entry.title}" from Password Library?`)) {
        return;
    }
    appState.entries = appState.entries.filter((currentEntry) => currentEntry.id !== entryId);
    appState.meta.updatedAt = createTimestamp();
    if (editingEntryId === entryId) {
        resetDraft();
    }
    if (expandedEntryId === entryId) {
        expandedEntryId = null;
    }
    delete revealedPasswords[entryId];
    try {
        persistState();
        setNotification({
            type: 'success',
            message: 'Entry removed from your local library.',
        });
        render();
    }
    catch (error) {
        setNotification({
            type: 'error',
            message: getErrorMessage(error, 'Unable to update local storage after deleting the entry.'),
        });
        renderNotification();
    }
}
function renderEntries() {
    entryList.innerHTML = '';
    const filteredEntries = getFilteredEntries();
    if (appState.entries.length === 0) {
        entryList.append(createEmptyState('No entries yet', 'Create your first password record to start building your secure library.', 'library'));
        return;
    }
    if (filteredEntries.length === 0) {
        entryList.append(createEmptyState('No matches found', 'Try a different title, username, or note keyword.', 'search'));
        return;
    }
    filteredEntries.forEach((entry) => {
        const card = document.createElement('article');
        card.className = 'entry-card';
        const isExpanded = expandedEntryId === entry.id;
        if (isExpanded) {
            card.classList.add('expanded');
        }
        const summaryButton = createActionButton('', 'toggle-expand', entry.id, 'entry-row-toggle');
        summaryButton.setAttribute('aria-expanded', String(isExpanded));
        const titleWrap = document.createElement('span');
        titleWrap.className = 'entry-row-main';
        const leadIcon = document.createElement('span');
        leadIcon.className = 'entry-row-icon';
        leadIcon.innerHTML = getRowIconMarkup();
        const title = document.createElement('span');
        title.className = 'entry-row-title';
        title.textContent = entry.title;
        const expandIcon = document.createElement('span');
        expandIcon.className = 'entry-expand-icon';
        expandIcon.innerHTML = getChevronIconMarkup(isExpanded);
        titleWrap.append(leadIcon, title);
        summaryButton.append(titleWrap, expandIcon);
        card.append(summaryButton);
        if (isExpanded) {
            const body = document.createElement('div');
            body.className = 'entry-card-body';
            const actions = document.createElement('div');
            actions.className = 'entry-actions';
            actions.append(createActionButton('Edit', 'edit', entry.id, 'ghost-button'), createActionButton('Delete', 'delete', entry.id, 'ghost-button danger'));
            const details = document.createElement('dl');
            details.className = 'entry-details';
            details.append(createDetailBlock('Username', entry.username || '-'), createPasswordBlock(entry), createDetailBlock('Notes', entry.notes || '-'));
            body.append(actions, details);
            if (entry.customFields.length > 0) {
                const customFieldSummary = document.createElement('div');
                customFieldSummary.className = 'custom-field-summary';
                entry.customFields.forEach((field) => {
                    const chip = document.createElement('div');
                    chip.className = 'summary-chip';
                    const label = document.createElement('span');
                    label.textContent = field.label || 'Section';
                    const value = document.createElement('strong');
                    value.textContent = field.value || '-';
                    chip.append(label, value);
                    customFieldSummary.append(chip);
                });
                body.append(customFieldSummary);
            }
            card.append(body);
        }
        entryList.append(card);
    });
}
function createEmptyState(titleText, bodyText, variant) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    const illustration = document.createElement('div');
    illustration.className = 'empty-state-illustration';
    illustration.innerHTML =
        variant === 'library' ? getEmptyLibraryIllustrationMarkup() : getEmptySearchIllustrationMarkup();
    const heading = document.createElement('h3');
    heading.textContent = titleText;
    const paragraph = document.createElement('p');
    paragraph.textContent = bodyText;
    emptyState.append(illustration, heading, paragraph);
    return emptyState;
}
function getFilteredEntries() {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
        return appState.entries;
    }
    return appState.entries.filter((entry) => {
        const title = entry.title.toLowerCase();
        const username = entry.username.toLowerCase();
        const notes = entry.notes.toLowerCase();
        return (title.includes(normalizedQuery) ||
            username.includes(normalizedQuery) ||
            notes.includes(normalizedQuery));
    });
}
function createActionButton(label, action, entryId, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action;
    button.dataset.entryId = entryId;
    button.textContent = label;
    return button;
}
function createDetailBlock(label, value) {
    const wrapper = document.createElement('div');
    const title = document.createElement('dt');
    title.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    wrapper.append(title, description);
    return wrapper;
}
function createPasswordBlock(entry) {
    const wrapper = document.createElement('div');
    const title = document.createElement('dt');
    title.textContent = 'Password';
    const description = document.createElement('dd');
    description.className = 'password-value';
    const value = document.createElement('span');
    value.textContent = revealedPasswords[entry.id] ? entry.password || '-' : entry.password ? '***' : '-';
    const button = createActionButton('', 'toggle-password', entry.id, 'icon-button');
    button.innerHTML = getEyeIconMarkup(revealedPasswords[entry.id] ?? false);
    button.setAttribute('aria-label', revealedPasswords[entry.id] ? 'Hide password' : 'Show password');
    button.title = revealedPasswords[entry.id] ? 'Hide password' : 'Show password';
    description.append(value, button);
    wrapper.append(title, description);
    return wrapper;
}
function getEyeIconMarkup(visible) {
    if (visible) {
        return `
      <svg viewBox="0 0 20 20" focusable="false">
        <path d="M1.8 10c1.7-3 4.7-5 8.2-5s6.5 2 8.2 5c-1.7 3-4.7 5-8.2 5s-6.5-2-8.2-5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    `;
    }
    return `
    <svg viewBox="0 0 20 20" focusable="false">
      <path d="M2.5 2.5 17.5 17.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d="M5.1 5.2A9.3 9.3 0 0 1 10 4c3.5 0 6.5 2 8.2 6a9.4 9.4 0 0 1-2.9 3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M8.4 8.5A2.6 2.6 0 0 1 12.6 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M10 16c-3.5 0-6.5-2-8.2-6a9.6 9.6 0 0 1 2.6-3.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}
function getChevronIconMarkup(expanded) {
    const transform = expanded ? 'rotate(180 10 10)' : '';
    return `
    <svg viewBox="0 0 20 20" focusable="false">
      <g transform="${transform}">
        <path d="m5.5 7.5 4.5 5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
  `;
}
function getRowIconMarkup() {
    return `
    <svg viewBox="0 0 20 20" focusable="false">
      <rect x="4" y="4.5" width="12" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M7 8h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <path d="M7 11h4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  `;
}
function getEmptyLibraryIllustrationMarkup() {
    return `
    <svg viewBox="0 0 64 64" focusable="false">
      <rect x="11" y="14" width="42" height="34" rx="8" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M22 26h20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M22 33h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M32 42a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="M32 42v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `;
}
function getEmptySearchIllustrationMarkup() {
    return `
    <svg viewBox="0 0 64 64" focusable="false">
      <circle cx="28" cy="28" r="12" fill="none" stroke="currentColor" stroke-width="2" />
      <path d="m37 37 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M24 28h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M28 24v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `;
}
function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
}
function persistState() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}
function sortEntriesByUpdatedAt(entries) {
    return [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
function normalizeString(value) {
    if (typeof value === 'string') {
        return value.replace(/\r\n/g, '\n');
    }
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/\r\n/g, '\n');
}
function normalizeTrimmedString(value) {
    return normalizeString(value).trim();
}
function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === 'no' || normalized === '0') {
            return false;
        }
    }
    return fallback;
}
function normalizeTheme(value, fallback) {
    if (value === 'dark' || value === 'light') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'dark' || normalized === 'light') {
            return normalized;
        }
    }
    return fallback;
}
function normalizeTimestamp(value, fallback) {
    const candidate = normalizeTrimmedString(value);
    if (candidate.length === 0) {
        return fallback;
    }
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
        return fallback;
    }
    return parsed.toISOString();
}
function normalizeCustomField(value, usedIds) {
    if (!isRecord(value)) {
        return null;
    }
    const label = normalizeTrimmedString(value.label);
    const fieldValue = normalizeString(value.value);
    if (label.length === 0 && fieldValue.length === 0) {
        return null;
    }
    let id = normalizeTrimmedString(value.id);
    if (id.length === 0 || usedIds.has(id)) {
        id = createId('field');
    }
    usedIds.add(id);
    return {
        id,
        label,
        value: fieldValue,
    };
}
function normalizeEntry(value, usedIds) {
    if (!isRecord(value)) {
        return null;
    }
    let id = normalizeTrimmedString(value.id);
    if (id.length === 0 || usedIds.has(id)) {
        id = createId('entry');
    }
    usedIds.add(id);
    const now = createTimestamp();
    const rawCustomFields = Array.isArray(value.customFields) ? value.customFields : [];
    const customFieldIds = new Set();
    return {
        id,
        title: normalizeTrimmedString(value.title) || 'Untitled entry',
        username: normalizeString(value.username),
        password: normalizeString(value.password),
        notes: normalizeString(value.notes),
        customFields: rawCustomFields
            .map((field) => normalizeCustomField(field, customFieldIds))
            .filter((field) => field !== null),
        createdAt: normalizeTimestamp(value.createdAt, now),
        updatedAt: normalizeTimestamp(value.updatedAt, now),
    };
}
function migrateState(value) {
    const source = isRecord(value) ? value : {};
    const rawVersion = source.schemaVersion;
    const version = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : 0;
    if (version > SCHEMA_VERSION) {
        throw new Error(`This file uses schema version ${version}, which is newer than this app can read.`);
    }
    const fallbackState = createInitialState();
    const rawSettings = isRecord(source.settings) ? source.settings : {};
    const rawMeta = isRecord(source.meta) ? source.meta : {};
    const entryIds = new Set();
    const rawEntries = Array.isArray(source.entries) ? source.entries : [];
    return {
        schemaVersion: SCHEMA_VERSION,
        settings: {
            maskPasswordsByDefault: normalizeBoolean(rawSettings.maskPasswordsByDefault, fallbackState.settings.maskPasswordsByDefault),
            theme: normalizeTheme(rawSettings.theme, fallbackState.settings.theme),
        },
        entries: sortEntriesByUpdatedAt(rawEntries
            .map((entry) => normalizeEntry(entry, entryIds))
            .filter((entry) => entry !== null)),
        meta: {
            createdAt: normalizeTimestamp(rawMeta.createdAt, fallbackState.meta.createdAt),
            updatedAt: normalizeTimestamp(rawMeta.updatedAt, fallbackState.meta.updatedAt),
            appVersion: normalizeTrimmedString(rawMeta.appVersion) || APP_VERSION,
            lastExportedAt: normalizeTrimmedString(rawMeta.lastExportedAt).length > 0
                ? normalizeTimestamp(rawMeta.lastExportedAt, fallbackState.meta.updatedAt)
                : null,
            lastImportedAt: normalizeTrimmedString(rawMeta.lastImportedAt).length > 0
                ? normalizeTimestamp(rawMeta.lastImportedAt, fallbackState.meta.updatedAt)
                : null,
        },
    };
}
function exportExcel() {
    const workbook = XLSX.utils.book_new();
    const exportedAt = createTimestamp();
    const entryRows = appState.entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        username: entry.username,
        password: entry.password,
        notes: entry.notes,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
    }));
    const customFieldRows = appState.entries.flatMap((entry) => entry.customFields.map((field) => ({
        entryId: entry.id,
        id: field.id,
        label: field.label,
        value: field.value,
    })));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(entryRows), ENTRIES_SHEET);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(customFieldRows), CUSTOM_FIELDS_SHEET);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
        {
            key: 'maskPasswordsByDefault',
            value: String(appState.settings.maskPasswordsByDefault),
        },
        {
            key: 'theme',
            value: appState.settings.theme,
        },
    ]), SETTINGS_SHEET);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
        { key: 'schemaVersion', value: SCHEMA_VERSION },
        { key: 'appVersion', value: APP_VERSION },
        { key: 'createdAt', value: appState.meta.createdAt },
        { key: 'updatedAt', value: appState.meta.updatedAt },
        { key: 'lastExportedAt', value: exportedAt },
        { key: 'lastImportedAt', value: appState.meta.lastImportedAt ?? '' },
    ]), META_SHEET);
    const fileBytes = XLSX.write(workbook, {
        type: 'array',
        bookType: 'xlsx',
    });
    const safeBuffer = new ArrayBuffer(fileBytes instanceof Uint8Array ? fileBytes.byteLength : fileBytes.byteLength);
    new Uint8Array(safeBuffer).set(fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes));
    const blob = new Blob([safeBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `password-library-${exportedAt.slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    appState.meta.lastExportedAt = exportedAt;
    appState.meta.updatedAt = createTimestamp();
    persistState();
    setNotification({
        type: 'success',
        message: `Exported Password Library to ${link.download}.`,
    });
    renderNotification();
    renderSummary();
}
async function importExcel(file) {
    if (!file.name.toLowerCase().endsWith('.xlsx') && !file.name.toLowerCase().endsWith('.xls')) {
        throw new Error('Import file must be an Excel workbook (.xlsx or .xls).');
    }
    const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
    });
    const entryRows = sheetToJson(workbook, ENTRIES_SHEET);
    const customFieldRows = sheetToJson(workbook, CUSTOM_FIELDS_SHEET);
    const settingsRows = sheetToJson(workbook, SETTINGS_SHEET);
    const metaRows = sheetToJson(workbook, META_SHEET);
    const customFieldsByEntry = new Map();
    customFieldRows.forEach((row) => {
        const entryId = normalizeTrimmedString(row.entryId);
        if (entryId.length === 0) {
            throw new Error('CustomFields sheet contains a row without an entryId.');
        }
        const rows = customFieldsByEntry.get(entryId) ?? [];
        rows.push(row);
        customFieldsByEntry.set(entryId, rows);
    });
    const settings = rowsToMap(settingsRows, SETTINGS_SHEET);
    const meta = rowsToMap(metaRows, META_SHEET);
    return migrateState({
        schemaVersion: Number(meta.schemaVersion || SCHEMA_VERSION),
        settings: {
            maskPasswordsByDefault: settings.maskPasswordsByDefault,
            theme: settings.theme,
        },
        entries: entryRows.map((row) => {
            const entryId = normalizeTrimmedString(row.id);
            const entryCustomFields = customFieldsByEntry.get(entryId) ?? [];
            return {
                id: entryId,
                title: row.title,
                username: row.username,
                password: row.password,
                notes: row.notes,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                customFields: entryCustomFields.map((field) => ({
                    id: field.id,
                    label: field.label,
                    value: field.value,
                })),
            };
        }),
        meta: {
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            appVersion: meta.appVersion,
            lastExportedAt: meta.lastExportedAt,
            lastImportedAt: createTimestamp(),
        },
    });
}
function sheetToJson(workbook, sheetName) {
    const sheet = workbook.Sheets[sheetName];
    if (sheet === undefined) {
        throw new Error(`Missing required worksheet: ${sheetName}.`);
    }
    return XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
    });
}
function rowsToMap(rows, sheetName) {
    const map = {};
    rows.forEach((row) => {
        const key = normalizeTrimmedString(row.key);
        if (key.length === 0) {
            throw new Error(`${sheetName} contains a row without a key.`);
        }
        map[key] = normalizeString(row.value);
    });
    return map;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function getErrorMessage(error, fallback) {
    if (error instanceof Error && error.message.length > 0) {
        return error.message;
    }
    return fallback;
}
