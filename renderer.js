// Import Electron modules directly
const { ipcRenderer, clipboard } = require('electron');
const { dialog, Menu } = require('@electron/remote');
const { on } = require('events');
const fs = require('fs').promises;

// DOM Elements
// const outputArea = document.getElementById('outputArea');
// const commandForm = document.getElementById('commandForm');
// const commandInput = document.getElementById('commandInput');
// const commandPalette = document.getElementById('commandPalette');
// const commandPreset = document.getElementById('commandPreset');
const submitButton = document.getElementById('submit-btn');
const interruptButton = document.getElementById('interrupt-btn');
const terminateButton = document.getElementById('terminate-btn');
const statusBar = document.getElementById('status-bar');
const statusBarContent = document.getElementById('status-bar-content');

const inputArea = document.getElementById('input-area');
const terminalContainer = document.getElementById('terminal-container');
const terminalPanel = document.getElementById('panel-tab-0');

// Search elements
const searchBox = document.getElementById('search-box');
const searchInput = document.getElementById('search-input');
const searchPrevBtn = document.getElementById('search-prev');
const searchNextBtn = document.getElementById('search-next');
const searchCloseBtn = document.getElementById('search-close');
const searchCount = document.getElementById('search-count');

const isMac = window.navigator.platform.includes("Mac");

const defaultCommand = "-x copy -x /tier -x /_stat -x /curstat ";

let history;
let process_argv = [];
let pendingCommands = [];

let allFuncs = [];

// Status update detection regex
const statusMessageRegex = /\x1b\[K([^\r\n]*)[\r\n]/sg;
const serverStatusMessageRegex = /\n<<<<<<<<<< (.*?) >>>>>>>>>>\n/sg;

let commandOutputCapture = '';
let openInNewTab = true; // Whether to open output in a new tab or not
let openInNewTabCmd = true; // Captured state of openInNewTab upon command submission

// Global tab counter for unique IDs
let tabIdCounter = 0;
let tabLru = ['tab-0'];

var nonEmptyPreset = false;

function Uint8Array_to_String(uint8Array) {
  return String.fromCharCode.apply(null, uint8Array);
}

function createBlobUrl(content, contentType = 'application/octet-stream') {
  const url = URL.createObjectURL(
    new Blob(
      [Uint8Array.from(content, s => s.charCodeAt(0)).buffer],
      {type: contentType})
  );
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return url;
}

ipcRenderer.on('process-argv', (event, data) => {
  process_argv = data.slice(2);
  if (process_argv.length > 0) console.log("Command line arguments:", process_argv);
});

function formEnable(state) {
  // [...commandForm.querySelectorAll("input,select,textarea,button:not(#interrupt-btn):not(#terminate-btn)")].forEach(e => e.disabled=!state);
  [...commandForm.querySelectorAll("button:not(#interrupt-btn):not(#terminate-btn)")].forEach(e => e.disabled=!state);
}

// Initialize the terminal
function initializeTerminal() {
  // Set up the output listener
  ipcRenderer.on('callgraph-output', (event, output) => {
    if (Uint8Array.prototype.isPrototypeOf(output.data))
      output.data = Uint8Array_to_String(output.data);
    // Check if stderr contains status update format
    if (output.type === 'stderr') {
      output.data = output.data.replaceAll(statusMessageRegex, (match, p1, offset, string, groups) => {
        // console.log(match, p1, offset, string, groups);
        updateStatusBar(p1, true);
        return p1;
      }).trim();
      if (output.data === "") return;
      updateStatusBar(output.data);
    } else if (output.type === 'stdout') {
      // console.log(output.data.split("").map(x => x.charCodeAt(0).toString(16).padStart(2, "0")).join(" "));
      output.data = output.data.replaceAll(serverStatusMessageRegex, (match, p1, offset, string, groups) => {
        onServerStatusMessage(p1);
        return "";
      });
      if (output.data === "") return;
      commandOutputCapture += output.data;
      // updateStatus(`Received ${output.data.length} bytes of output = ${commandOutputCapture.length} total`, 'info');
      return;
    }

    // Regular output handling for non-status messages
    appendOutput(output);
  });

  // Set up form submission
  commandForm.addEventListener('submit', handleCommandSubmit);

  // Add keyboard shortcuts
  commandForm.addEventListener('keydown', handleFormKeyDown);

  document.addEventListener('keydown',   (ev) => openInNewTab = ev.altKey || (isMac ? ev.metaKey : ev.ctrlKey));
  document.addEventListener('keyup',     (ev) => openInNewTab = ev.altKey || (isMac ? ev.metaKey : ev.ctrlKey));
  document.addEventListener('mousedown', (ev) => openInNewTab = ev.altKey || (isMac ? ev.metaKey : ev.ctrlKey));
  document.addEventListener("click",     ev => ev.target.closest("g.edge,g.node > text")?.classList?.toggle("hi"));

  // Set up signal buttons
  interruptButton.addEventListener('click', () => handleSignal('SIGINT'));
  terminateButton.addEventListener('click', () => handleSignal('SIGTERM'));

  btnShowInModules.addEventListener('click', ev => showIn(ev, "-mod"));
  btnShowInFiles.addEventListener('click', ev => showIn(ev));

  commandPalette.addEventListener('input', generateCommandPreset);

  history = terminalPanel.history = {
    commandHistory: [],
    historyIndex: -1,
    lastExecutedCommand: '',
    contentCommand: '',
    contentCommandHistoryEntry: null,
  };

  generateCommandPreset();

  // Disable the submit button button initially
  // formEnable(false); // submitButton.disabled = true;

  // Focus the input field
  commandInput.value = defaultCommand;
  commandInput.focus();
}

function onServerStatusMessage(message) {
  console.log(message);
  if (message.startsWith("Server start"))        { onServerStart(message);      onServerReady(message);
  } else if (message.startsWith("Server error")) { onServerReady(message);
  } else if (message.startsWith("Server end"))   { onServerBusy(message);
  } else if (message.startsWith("Task start"))   { onServerBusy(message);       onServerCommandStart(message);
  } else if (message.startsWith("Task end"))     { onServerCommandEnd(message); onServerReady(message);
  }
}

function onServerStart(message) {
  appendOutput({
    type: 'system',
    data: `[Server started: ${message}]\n`
  });
  updateStatusBar("Ready");

  pendingCommands = [
    {
      cmd: ()=>{
        appendOutput({ type: 'system', data: `Getting list of functions for auto-complete...\n` });
        return "-x copy /. -list"
      },
      res: res => {
        allFuncs = res.trim().split(/\n/);
        appendOutput({ type: 'system', data: `... got ${allFuncs.length} functions.\n` });
        document.body.insertAdjacentHTML("beforeEnd", `<datalist id="funcs-list">${allFuncs.map(x => `<option value="${x}"></option>`).join("")}</datalist>`); // TODO: Why there's no scroll?
      }
    },
  ];
}

function onServerReady(message) {
  appendOutput({
    type: 'system',
    data: `[Server ready: ${message}]\n`
  });
  if (pendingCommands.length > 0) {
    ipcRenderer.send('execute-command', pendingCommands[0].cmd());
    return;
  }
  formEnable(true);
  if (process_argv.length > 0) {
    switchToTabByNumber(1);
    commandInput.value = process_argv.shift();
    console.log("Executing from command line:", commandInput.value);
    if (commandInput.value.startsWith(commandPreset.value)) {
      commandInput.value = commandInput.value.substr(commandPreset.value.length).trim();
    }
    // commandInput.dispatchEvent(new Event('input'));
    // commandForm.dispatchEvent(new Event('submit'));
    handleCommandSubmit();
  }
}

function onServerBusy(message) {
  appendOutput({
    type: 'system',
    data: `[Server busy: ${message}]\n`
  });
  formEnable(false);
}

function onServerCommandStart(message) {
  appendOutput({
    type: 'system',
    data: `[Server command start: ${message}]\n`
  });
  commandOutputCapture = "";
}

function onServerCommandEnd(message) {
  appendOutput({
    type: 'system',
    data: `[Server command end: ${message}]\n`
  });
  onCommandOutputCapture(commandOutputCapture);
  commandOutputCapture = "";
}

// Detect the type of content based on its structure/headers
function detectContentType(content) {
  // console.log(content.substr(0,16));
  // console.log(content.substr(0,16).split("").map(x => x.charCodeAt(0).toString(16).padStart(2, "0")).join(" "));
  // Check for PNG (starts with PNG signature)
  if (content.startsWith('PNG\r\n\x1a\n', 1)) {
    return 'PNG';
  }

  // Check for SVG
  if (content.trim().startsWith('<?xml') || content.trim().startsWith('<svg')) {
    return 'SVG';
  }

  // Check for HTML
  if (content.trim().startsWith('<!DOCTYPE html') ||
      content.trim().startsWith('<html') ||
      (content.includes('<body') && content.includes('</body>'))) {
    return 'HTML';
  }

  // Check for inline HTML
  if (content.trim().startsWith('<') && content.trim().endsWith('>')) {
    return 'inline-HTML';
  }

  // Fallback to plain text
  return 'Text';
}

// Render content based on detected type
function renderContent(content, contentType) {
  switch (contentType) {
    case 'PNG':
      return renderPNG(content);
    case 'SVG':
      return renderSVG(content);
    case 'HTML':
      return renderHTML(content);
    case 'inline-HTML':
      return renderInlineHTML(content);
    default:
      return renderText(content);
  }
}

// Render PNG image
function renderPNG(content) {
  const container = document.createElement('div');
  container.className = 'content-container image-container';

  // console.log(content.length, atob(btoa(content)).length);
  const img = document.createElement('img');
  img.onerror = () => {
    console.error('Error loading image:', img.src);
    container.textContent = 'Error loading image';
  }

  // img.src = 'data:image/png;base64,' + btoa(content);
  img.src = createBlobUrl(content, "image/png");

  container.appendChild(img);
  return container;
}

// Render SVG image
function renderSVG(content) {
  const container = document.createElement('div');
  container.className = 'content-container image-container';
  container.innerHTML = content;

  return container;
}

// Render HTML content
function renderHTML(content) {
  const container = document.createElement('div');
  container.className = 'content-container html-container';

  // Create iframe to sandbox HTML content
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms';
  // iframe.srcdoc = content;
  iframe.src = createBlobUrl(content, "text/html");

  container.appendChild(iframe);
  return container;
}

// Render inline HTML
function renderInlineHTML(content) {
  const container = document.createElement('div');
  // container.className = 'content-container text-container';
  container.className = 'content-container inline-html-container';
  container.innerHTML = content;
  container.tabIndex = -1; // Make it focusable

  return container;
}

// Render plain text
function renderText(content) {
  const container = document.createElement('div');
  // container.className = 'content-container text-container';
  container.className = 'captured-output';
  container.textContent = content;
  container.tabIndex = -1; // Make it focusable

  return container;
}

function onCommandOutputCapture(output) {
  if (pendingCommands.length > 0) {
    pendingCommands.shift().res(output);
    return;
  }

  // Don't process empty output
  if (!output) return;

  const { current } = getTabElements();
  if (openInNewTabCmd || current.id === 'tab-0') {
    let title = history.lastExecutedCommand;
    if (title.length > 10) {
      title = "…"+title.substr(-10);
    }
    createNewTab(output, title);
  } else {
    const panel = document.getElementById(`panel-${current.id}`);
    populateTabContent(panel, output);
    panel.history.contentCommand = history.lastExecutedCommand;
    panel.history.contentCommandHistoryEntry = history.commandHistory[0];
  }
}

// Create a new tab with the given output and title
// Helper function to determine file filters based on content type
function getFileFilters(contentType) {
  switch (contentType) {
    case 'PNG':
      return [
        { name: 'PNG Images', extensions: ['png'] },
        { name: 'All Files', extensions: ['*'] }
      ];
    case 'SVG':
      return [
        { name: 'SVG Images', extensions: ['svg'] },
        { name: 'All Files', extensions: ['*'] }
      ];
    case 'HTML':
      return [
        { name: 'HTML Files', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] }
      ];
    default:
      return [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ];
  }
}

////

function updateTabLru(tabId, reinsert = true) {
  // Reinsert the tab at the beginning of the LRU list
  let index = tabLru.indexOf(tabId);
  if (index !== -1) tabLru.splice(index, 1);
  if (reinsert) tabLru.unshift(tabId);
}

// Create a tab panel with UI elements
function createTabPanel(tabId) {
  // Create radio button
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'tabs';
  radio.id = tabId;
  radio.className = 'tab-radio';
  radio.addEventListener("change", onTabChange);

  // Create label with close button
  const label = document.createElement('label');
  label.htmlFor = tabId;
  label.className = 'tab-label';

  // Add title span
  const titleSpan = document.createElement('span');
  titleSpan.textContent = tabId.replace('tab-', '');
  label.appendChild(titleSpan);

  // Add close button
  const closeButton = document.createElement('span');
  closeButton.className = 'tab-close';
  closeButton.innerHTML = '×';
  closeButton.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeTab(tabId);
  };
  label.appendChild(closeButton);

  // Create panel
  const panel = document.createElement('div');
  panel.className = 'tab-panel';
  panel.id = `panel-${tabId}`;

  // Add to DOM
  const controls = document.getElementById('tab-controls');
  controls.appendChild(radio);
  controls.appendChild(label);
  controls.appendChild(panel);

  // Switch to new tab
  radio.checked = true;
  focusAppropriateElement();

  // Store the command that generated this content
  panel.history = {
    commandHistory: [...history.commandHistory],
    historyIndex: -1,
    lastExecutedCommand: history.lastExecutedCommand,
    contentCommand: history.lastExecutedCommand,
    contentCommandHistoryEntry: history.commandHistory[0],
  };

  // Add context menu handling
  panel.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();

    // Show context menu with relevant data
    showContextMenu({
      command: history.contentCommand,
      contentType: panel.contentType,
      content: panel.content,
      tabId,
      event: ev,
    });
  });

  return panel;
}

// Populate a panel with content
function populateTabContent(panel, output, title=null) {
  // Detect content type
  const contentType = detectContentType(output);
  const contentElement = renderContent(output, contentType);
  panel.contentType = contentType;
  panel.content = output;

  // Add the content
  while (panel.firstChild) panel.firstChild.remove();
  panel.appendChild(contentElement);

  if (title) {
    // Update the title
    const tabId = panel.id.replace('panel-', '');
    const titleSpan = document.querySelector(`label[for="${tabId}"] > span`);
    if (titleSpan) {
      titleSpan.textContent = `${title}`;
    }
  }

  return panel;
}

// Create a new tab with the given output and title
function createNewTab(output, title) {
  // Increment the global ID counter for unique IDs
  tabIdCounter++;

  // Create tab elements with unique IDs
  const tabId = `tab-${tabIdCounter}`;

  // Create the panel UI
  const panel = createTabPanel(tabId);

  // Populate the panel with content
  populateTabContent(panel, output, title);

  onTabChange({target: document.getElementById(tabId)});
}

// Close a tab and remove its elements
function closeTab(tabId) {
  const radio = document.getElementById(tabId);
  const label = radio.nextElementSibling;
  const panel = label.nextElementSibling;

  // If this tab is active, switch to terminal tab
  if (radio.checked) {
    // document.getElementById('tab-0').checked = true;
    let nextActiveTab = tabLru.length > 1 ? tabLru[1] : null;
    if (!nextActiveTab || nextActiveTab.id === tabId || !document.getElementById(nextActiveTab)) {
      nextActiveTab = 'tab-0';
    }
    document.getElementById(nextActiveTab).checked = true;
    onTabChange({target: document.getElementById(nextActiveTab)});
    updateTabLru(tabId, false);
  }

  // Remove tab elements
  radio.remove();
  label.remove();
  panel.remove();
}

function createNewExploreTab() {
  createNewTab(`<div></div>`, "Explore");
  showConsole();
}

// Cache tab selection for better performance
const getTabElements = () => ({
  all: Array.from(document.querySelectorAll('.tab-radio')),
  current: document.querySelector('.tab-radio:checked'),
  terminal: document.getElementById('tab-0')
});

// Focus the appropriate element based on the active tab
function focusAppropriateElement() {
  const { current } = getTabElements();
  if (current.id === 'tab-0' || isConsoleVisible()) {
    // Focus command input when in terminal tab
    commandInput.focus();
  } else {
    // document.getElementById("tab-controls")?.focus();

    // // Focus the captured output div for scrolling
    // const panel = document.getElementById(`panel-${current.id}`);
    // if (panel) {
    //     const outputDiv = panel.querySelector('.captured-output');
    //     if (outputDiv) {
    //         outputDiv.tabIndex = -1; // Make it focusable
    //         outputDiv.focus();
    //     }
    // }
  }
}

document.getElementById('tab-0').addEventListener("change", onTabChange);

function onTabChange(ev) {
  const { all, current } = getTabElements();
  const panel = document.getElementById(`panel-${current.id}`);
  // console.log(prevTabIdx, currentIndex, all.length, current.id, panel);
  if (current.id === tabLru[0]) return;
  updateTabLru(current.id, !!panel);
  if (!panel) return;
  historyPush();
  history.commandHistory[0]["~"] = true;
  history = panel.history;
  if (!history.commandHistory.length || !history.commandHistory[0]["~"]) {
    historyRecall(-1);
  } else {
    historyRecall(0);
    history.historyIndex = -1;
    history.commandHistory.shift();
  }
}

// Tab navigation functions
function switchToNextTab() {
  const { all, current } = getTabElements();
  if (all.length <= 1) return; // Don't cycle if only terminal tab exists

  const currentIndex = all.indexOf(current);
  const nextIndex = (currentIndex + 1) % all.length;
  all[nextIndex].checked = true;
  focusAppropriateElement();
  onTabChange({target: all[nextIndex]});
}

function switchToPreviousTab() {
  const { all, current } = getTabElements();
  if (all.length <= 1) return; // Don't cycle if only terminal tab exists

  const currentIndex = all.indexOf(current);
  const prevIndex = (currentIndex - 1 + all.length) % all.length;
  all[prevIndex].checked = true;
  focusAppropriateElement();
  onTabChange({target: all[prevIndex]});
}

function switchToTabByNumber(number) {
  const { all } = getTabElements();
  if (number <= all.length) {
    all[number - 1].checked = true;
    focusAppropriateElement();
    onTabChange({target: all[number - 1]});
  }
}

function closeCurrentTab() {
  const { current, terminal } = getTabElements();
  if (current === terminal) {
    return;
  }
  closeTab(current.id);
  focusAppropriateElement();
  // onTabChange();
}

////////////

function historyPush() {
  let entry = {"_": commandInput.value};
  commandInput.value = defaultCommand;
  history.historyIndex = -1;
  for (const [contribRet, defval, name, func] of commandOptions) {
    const e = document.getElementById(name);
    if (e) {
      entry[name] = e.value;
      if (defval !== null) e.value = defval;
    } else {
      entry[name] = "";
    }
  }
  history.commandHistory.unshift(entry);
  if (history.commandHistory.length > 100) {
    history.commandHistory.pop(); // Limit history size
  }
}

function historyRecall(index, entry = null) {
  if (!entry) {
    if (index >= history.commandHistory.length) return;
    if (index >= 0) entry = history.commandHistory[index];
  }
  history.historyIndex = index;
  commandInput.value = entry ? entry["_"] : defaultCommand;
  for (const [contribRet, defval, name, func] of commandOptions) {
    const el = document.getElementById(name);
    if (el) {
      if (entry) {
        el.value = entry[name];
      } else if (defval !== null) {
        el.value = defval;
      }
    }
  }
  // Move cursor to end of input
  // setTimeout(() => commandInput.selectionStart = commandInput.selectionEnd = commandInput.value.length, 0);
  generateCommandPreset();
}

function isEmptyCommand() {
  return (commandInput.value.trim() === "" || commandInput.value.trim() === defaultCommand.trim()) && !nonEmptyPreset;
}

function getCombinedCommand() {
  generateCommandPreset();
  if (isEmptyCommand()) return "";

  let ret = commandInput.value.trim();
  if (!ret.startsWith(commandPreset.value)) {
    ret = commandPreset.value + " " + ret;
  }
  return ret.trim();
}

// Handle form submission
function handleCommandSubmit(event = null) {
  event?.preventDefault && event?.preventDefault();

  let cmd = getCombinedCommand();
  if (!cmd) return; // Don't do anything if command is empty

  history.lastExecutedCommand = cmd;
  openInNewTabCmd = openInNewTab;

  // Display command with prompt
  appendCommandToOutput(history.lastExecutedCommand);

  // Send command to main process
  try {
    ipcRenderer.send('execute-command', history.lastExecutedCommand);
    historyPush();
    updateStatusBar('Command sent');
  } catch (error) {
    console.error('Error executing command:', error);
    updateStatus('Error: ' + error.message, 'error');
  }
}

// Handle keyboard shortcuts
function handleFormKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) { // no shift - submit
    event.preventDefault();
    commandForm.dispatchEvent(new Event('submit'));
    return;
  }

  // Up arrow for previous command
  if (event.key === 'ArrowUp' && document.activeElement.tagName !== "SELECT") {
    event.preventDefault();

    if (history.historyIndex < history.commandHistory.length - 1) {
      historyRecall(++history.historyIndex);

      // Move cursor to end of input
      setTimeout(() => {
        commandInput.selectionStart = commandInput.selectionEnd = commandInput.value.length;
      }, 0);
    }
    return;
  }

  // Down arrow for next command
  if (event.key === 'ArrowDown' && document.activeElement.tagName !== "SELECT") {
    event.preventDefault();

    if (history.historyIndex > 0) {
      historyRecall(--history.historyIndex);
    } else if (history.historyIndex === 0) {
      history.historyIndex = -1;
      historyRecall(history.historyIndex);
    }
    return;
  }

  // // Tab key indentation
  // if (event.key === 'Tab') {
  //   event.preventDefault();

  //   const start = commandInput.selectionStart;
  //   const end = commandInput.selectionEnd;

  //   // Insert tab at cursor position
  //   commandInput.value = commandInput.value.substring(0, start) +
  //                         '  ' +
  //                         commandInput.value.substring(end);

  //   // Move cursor after the inserted tab
  //   commandInput.selectionStart = commandInput.selectionEnd = start + 2;
  // }
}

// Append command to output area
function appendCommandToOutput(command) {
  const commandElement = document.createElement('div');

  // Add prompt
  const promptSpan = document.createElement('span');
  promptSpan.className = 'command-prompt';
  promptSpan.textContent = '$ ';
  commandElement.appendChild(promptSpan);

  // Add command text
  const commandText = document.createTextNode(command);
  commandElement.appendChild(commandText);

  outputArea.appendChild(commandElement);

  // Scroll to bottom
  scrollToBottom();
}

// Append output to the terminal
function appendOutput(output) {
  const outputLine = document.createElement('div');
  outputLine.className = output.type;
  outputLine.textContent = output.data;
  outputArea.appendChild(outputLine);
  scrollToBottom();
}

// Scroll output area to bottom
function scrollToBottom() {
  outputArea.scrollTop = outputArea.scrollHeight;
}

// Update status message
function updateStatus(message, type = '') {
  appendOutput({data: message, type});
}

// Update status bar with new status message
function updateStatusBar(message, force = false) {
  if (force || message !== "") statusBarContent.textContent = message;
}

// Handle signal button clicks (SIGINT / SIGTERM)
function handleSignal(signalType) {
  try {
    // Get the button for the current signal type
    const signalButton = signalType === 'SIGINT' ? interruptButton : terminateButton;

    // Temporarily disable buttons to prevent multiple signals
    interruptButton.disabled = true;
    terminateButton.disabled = true;

    // Send the signal
    ipcRenderer.send('send-signal', signalType);

    // Format friendly names for UI messages
    const signalName = signalType === 'SIGINT' ? 'Interrupt' : 'Terminate';
    const shortcutHint = signalType === 'SIGINT' ? '(Ctrl+C)' : '(Ctrl+Shift+R)';

    // Visual feedback
    updateStatus(`${signalName} signal sent ${shortcutHint}`, 'success');

    // Add visual feedback in the terminal output
    appendOutput({
      type: 'system',
      data: `\n[System: ${signalName} signal (${signalType}) sent to callgraph process]\n`
    });

    // Re-enable the buttons after a short delay
    setTimeout(() => {
      interruptButton.disabled = false;
      terminateButton.disabled = false;

      // Focus back on input
      commandInput.focus();
    }, 500);
  } catch (error) {
    console.error(`Error sending ${signalType}:`, error);
    updateStatus('Error: ' + error.message, 'error');
    interruptButton.disabled = false;
    terminateButton.disabled = false;
  }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeTerminal);

// Add global keyboard shortcut handler
document.addEventListener('keydown', (event) => {
  // Ctrl+C to interrupt running process (SIGINT)
  if (event.key === 'c' && (event.ctrlKey)) {
    event.preventDefault();
    handleSignal('SIGINT');
    return;
  }

  // Ctrl+Shift+R to terminate process (SIGTERM)
  if (event.key === 'r' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
    event.preventDefault();
    handleSignal('SIGTERM');
    return;
  }

  // Ctrl+Shift+R to terminate process (SIGTERM)
  if (event.key === 't' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    createNewExploreTab();
    return;
  }

  // // Skip most shortcuts if we're in command input (except for Cmd/Ctrl+W and tabs)
  // if (event.target === commandInput) {
  //   return;
  // }

  // Ctrl+Tab or Cmd+Tab - Next tab
  if ((event.ctrlKey || event.metaKey) && event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault();
    switchToNextTab();
  }

  // Ctrl+Shift+Tab or Cmd+Shift+Tab - Previous tab
  if ((event.ctrlKey || event.metaKey) && event.key === 'Tab' && event.shiftKey) {
    event.preventDefault();
    switchToPreviousTab();
  }

  // Ctrl/Cmd + Number - Switch to specific tab
  if ((event.ctrlKey || event.metaKey) && !isNaN(event.key) && event.key !== '0') {
    event.preventDefault();
    switchToTabByNumber(parseInt(event.key));
  }

  // Ctrl/Cmd + W - Close current tab
  if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
    event.preventDefault();
    closeCurrentTab();
  }
}, true);

// Search functionality
let activeFindInPage = false;
let totalMatches = 0;
let currentMatch = 0;

// Register for search results from main process
ipcRenderer.on('found-in-page-result', (event, result) => {
  // console.log(result);

  // if (result.finalUpdate) {
    totalMatches = result.matches;
  // }

  // Update current match if we have a selection
  if (result.activeMatchOrdinal) {
    currentMatch = result.activeMatchOrdinal;
  }

  updateSearchCount();
  // stopFindInPage('keepSelection');
});

// Update search count display
function updateSearchCount() {
  if (totalMatches === 0) {
    searchCount.textContent = '';
    searchCount.style.color = '#999';
  } else {
    searchCount.textContent = currentMatch ?`${currentMatch}/${totalMatches}` : "(regex)"; // `/re ${totalMatches}`;
    searchCount.style.color = '#333';
  }
}

// Helper functions for IPC
function findInPage(searchText, options = {}) {
  ipcRenderer.send('find-in-page', searchText, options);
  return true;
}

function stopFindInPage(action = 'clearSelection') {
  ipcRenderer.send('stop-find-in-page', action);
  return true;
}

// Helper function to get default extension for a content type
function getDefaultExtension(contentType) {
  switch (contentType) {
    case 'PNG': return 'png';
    case 'SVG': return 'svg';
    case 'HTML': return 'html';
    default: return 'txt';
  }
}

// Enhanced context menu using @electron/remote
function showContextMenu(menuData) {
  const { command, contentType, content, event } = menuData;
  let menuItems = [];

  let e = event.target.closest("g.node");
  if (e) {
    let title = e.querySelector("title")?.textContent ?? "";
    if (title) {
      menuItems.push(
        {
          label: `\t${title}`, // 📝
          click: (menuItem, win, ev) => clipboard.writeText(title),
        },
        {
          label: `🌴\tGrow`, // ＋🌴
          click: (menuItem, win, ev) => {
            historyRecall(-1, history.contentCommandHistoryEntry);
            commandInput.value += ` -grow '${title}'`;
            // commandInput.dispatchEvent(new Event('input'));
            // commandForm.dispatchEvent(new Event('submit'));
            handleCommandSubmit(ev);
          },
        },
        {
          label: `✂️\tPrune`, // －✂
          click: (menuItem, win, ev) => {
            historyRecall(-1, history.contentCommandHistoryEntry);
            // commandInput.value += ` -prune '${title}'`;
            commandPrune.value = (commandPrune.value + ` ${title}`).trim();
            // commandInput.dispatchEvent(new Event('input'));
            // commandForm.dispatchEvent(new Event('submit'));
            handleCommandSubmit(ev);
          },
        },
        {
          label: `❌\tExclude`, // ｘ❌
          click: (menuItem, win, ev) => {
            historyRecall(-1, history.contentCommandHistoryEntry);
            // commandInput.value += ` -x '${title}'`;
            commandExclude.value = (commandExclude.value + ` ${title}`).trim();
            // commandInput.dispatchEvent(new Event('input'));
            // commandForm.dispatchEvent(new Event('submit'));
            handleCommandSubmit(ev);
          },
        },
      );
    }
  }

  e = event.target.closest("g.edge");
  if (e) {
    let title = e.querySelector("title")?.textContent ?? "";
    if (title) {
      menuItems.push({
        label: `\t${title}`, // 📝
        click: (menuItem, win, ev) => clipboard.writeText(title),
      });
    }
  }

  menuItems.push(
    {
      type: 'separator',
    },
    {
      label: `M\tShow in Modules`,
      click: (menuItem, win, ev) => {
        showIn(ev, "-mod");
      },
    },
    {
      label: `F\tShow in Files`,
      click: (menuItem, win, ev) => {
        showIn(ev);
      },
    },
  );

  menuItems.push(
    {
      type: 'separator',
    },
    {
      label: '＞\tShow Command',
      click: (menuItem, win, ev) => showCommandDialog(command)
    },
    {
      label: `💾\tSave ${contentType} as...`, // 💾
      click: async (menuItem, win, ev) => {
        try {
          const { filePath } = await dialog.showSaveDialog({
            defaultPath: `output.${getDefaultExtension(contentType)}`,
            filters: getFileFilters(contentType)
          });

          if (filePath) {
            if (contentType === 'PNG') {
              await fs.writeFile(filePath, Buffer.from(Uint8Array.from(content, s => s.charCodeAt(0)).buffer));
            } else {
              await fs.writeFile(filePath, content, 'utf8');
            }
            updateStatusBar(`Content saved to: ${filePath}`);
          }
        } catch (error) {
          console.error('Error saving content:', error);
          updateStatusBar(`Error saving content: ${error.message}`);
        }
      }
    },
    {
      type: 'separator',
    },
    {
      label: '📲\tSave Session',
      click: (menuItem, win, ev) => showCommandDialog("callgraph-ui " +
        [...document.querySelectorAll(`[id^="panel-"]`)].map(e => e.history.contentCommand).filter(x => x).map(x => `'${x}'`).join(" ")
      ),
    },
  );

  const menu = Menu.buildFromTemplate(menuItems);

  menu.popup();
}

// Start search with given text
function startSearch(searchText, options = {}) {
  if (searchText.length < 2) {
    if (activeFindInPage) {
      stopFindInPage('keepSelection');
    }
    [...document.querySelectorAll('.search-highlight')].forEach(e => e.classList.remove("search-highlight"));
    activeFindInPage = false;
    totalMatches = 0;
    currentMatch = 0;
    updateSearchCount();
    return;
  }

  if (!searchText.startsWith('/')) {
    [...document.querySelectorAll('.search-highlight')].forEach(e => e.classList.remove("search-highlight"));
    activeFindInPage = true;
    findInPage(searchText, options);
  } else {
    if (activeFindInPage) {
      stopFindInPage('keepSelection');
      activeFindInPage = false;
    }
    currentMatch = totalMatches = 0;
    let re;
    try {
      re = new RegExp(searchText.substr(1), "i");
      searchInput.style.backgroundColor = "";
    } catch {
      searchInput.style.backgroundColor = "#FCC";
    }
    // TODO: handle tabs
    for (let e of document.querySelectorAll('text')) {
      if (re && re.test(e.textContent)) {
        // TODO: use <tspan fill="#f00"> / <tspan class=hi> for highlighting in SVG and <mark class=hi> for HTML
        e.classList.add("search-highlight");
        ++totalMatches;
      } else {
        e.classList.remove("search-highlight");
      }
    }
    updateSearchCount();
  }
}

// Find next match
function findNext() {
  if (!activeFindInPage) {
    startSearch(searchInput.value);
    return;
  }

  // Continue search in forward direction
  !searchInput.value.startsWith("/") && findInPage(searchInput.value, {
    findNext: true,
    forward: true
  });
}

// Find previous match
function findPrevious() {
  if (!activeFindInPage) {
    startSearch(searchInput.value, { forward: false });
    return;
  }

  // Continue search in backward direction
  !searchInput.value.startsWith("/") && findInPage(searchInput.value, {
    findNext: true,
    forward: false
  });
}

// Close search and clear highlights
function closeSearch() {
  stopFindInPage('keepSelection');
  [...document.querySelectorAll('.search-highlight')].forEach(e => e.classList.remove("search-highlight"));
  activeFindInPage = false;
  totalMatches = 0;
  currentMatch = 0;
  updateSearchCount();

  searchBox.style.display = 'none';

  // Clear search input for next time
  // searchInput.value = '';

  // Return focus to appropriate element
  focusAppropriateElement();
}

// Show search box
function showSearchBox() {
  searchBox.style.display = '';
  searchInput.focus();
  searchInput.select();
}

// Event Listeners
searchInput.addEventListener('input', () => {
  // Regular search is extremely slow and loses focus when typing.
  searchInput.value.startsWith("/") && startSearch(searchInput.value);
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    startSearch(searchInput.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeSearch();
  }
}, true);

searchNextBtn.addEventListener('click', findNext);
searchPrevBtn.addEventListener('click', findPrevious);
searchCloseBtn.addEventListener('click', closeSearch);

// Global keyboard shortcuts for search
document.addEventListener('keydown', (event) => {
  // Open search with Ctrl+F or Cmd+F
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    showSearchBox();
  }

  // Next match with Ctrl+G or Cmd+G
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g' && !event.shiftKey) {
    event.preventDefault();
    if (searchBox.style.display !== 'none') {
      findNext();
    }
  }

  // Previous match with Shift+Ctrl+G or Shift+Cmd+G
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g' && event.shiftKey) {
    event.preventDefault();
    if (searchBox.style.display !== 'none') {
      findPrevious();
    }
  }

  // Close search with Escape
  if (event.key === 'Escape' && searchBox.style.display !== 'none') {
    event.preventDefault();
    closeSearch();
  }
});

////

document.addEventListener('keydown', ev => {
  if (ev.key === "`" /* && (ev.ctrlKey || ev.metaKey) */ ) {
    ev.preventDefault();
    toggleConsole();
  }
});


function showConsole() {
  inputArea.classList.add("floating-panel");
  document.body.appendChild(inputArea);
  commandInput.focus();
}

function hideConsole() {
  inputArea.classList.remove("floating-panel");
  terminalContainer.appendChild(inputArea);
  focusAppropriateElement();
}

function isConsoleVisible() {
  return inputArea.classList.contains("floating-panel");
}

function toggleConsole() {
  isConsoleVisible() ? hideConsole() : showConsole();
}

/////

const commandOptions = [
  [0, null,  "commandDepth",        val => `-d ${val}`],
  [0, null,  "commandTimeout",      val => `--timeout ${val}`],
  [0, "lr",  "commandDir",          val => `--dir ${val}`],
  [0, "svg", "commandOutputFormat", val => val === "text" ? "-text -nohlends" : val === "text-indent" ? "--indents -nohlends" : `-${val}`],
  [1, "",    "commandFrom",         val => val.trim().split(/\s+/).map(x => `-f ${x}`).join(" ")],
  [1, "",    "commandTo",           val => val.trim().split(/\s+/).map(x => `-t ${x}`).join(" ")],
  [0, "",    "commandExclude",      val => val.trim().split(/\s+/).map(x => `-x ${x}`).join(" ")],
  [0, "",    "commandPrune",        val => val.trim().split(/\s+/).map(x => `-prune ${x}`).join(" ")],
];

function generateCommandPreset(ev) {
  let nonempty = false;
  let val = ["--continue"];
  if (ev && ev.inputType === "insertText" && (ev.target.id == "commandFrom" || ev.target.id == "commandTo")) {
    const [from, to, depth] = [commandFrom, commandTo, commandDepth];
    const [target, other] = ev.target.id == "commandFrom" ? [from, to] : [to, from];
    if (target.value.length === 1 && other.value.length > 0 && !depth.value) {
      depth.value = "4";
    }
  }
  for (const [contribRet, defval, name, func] of commandOptions) {
    const el = document.getElementById(name);
    if (el && el.value !== "") {
      if (contribRet) nonempty = true;
      val.push(func(el.value));
    }
  }
  commandPreset.value = val.join(" ");
  nonEmptyPreset = nonempty;
}

var mouseX = 600;
var mouseY = 450;

var moving = false;
document.addEventListener("mousedown", ev => (ev.altKey || (!isMac && ev.ctrlKey) || ev.metaKey || ev.shiftKey) && (moving = true), {passive: true});
document.addEventListener("mouseup", ev => moving = false, {passive: true});
document.addEventListener("mousemove", ev => {
  [mouseX, mouseY] = [ev.clientX, ev.clientY-30];

  if (!moving) return;

  let { current } = getTabElements();
  if (current) {
    let panel = document.getElementById("panel-" + current.id);
    let scrollElem = panel?.querySelector('.content-container');
    moving && scrollElem.scrollBy(-ev.movementX, -ev.movementY);
  }
}, {passive: true});

function zoomBy(delta) {
  if (delta == 0) return;
  const container = document.getElementById("panel-" + getTabElements().current.id)?.querySelector('.content-container');
  if (!container) return;
  let e = container.firstElementChild;

  let prevScrollWidth = container.scrollWidth, prevScrollHeight = container.scrollHeight;
  let prevZoom = (container.zoomLevel || 0);
  let zoom = Math.min(Math.max(delta + prevZoom, 0), 8.);
  if (zoom == prevZoom) return;
  let posX = container.scrollLeft + mouseX /* container.clientWidth / 2 */,
      posY = container.scrollTop  + mouseY /* container.clientHeight / 2 */;
  let zoomFactor = Math.pow(2, zoom);
  let zoomPct = `${zoomFactor * 100}%`;
  e.style.maxWidth = zoomPct;
  e.style.maxHeight = zoomPct;
  if (delta > 0 && prevScrollWidth == container.scrollWidth && prevScrollHeight == container.scrollHeight) {
    // Reached the browser's limit.
    zoomFactor = Math.pow(2, prevZoom);
    zoomPct = `${zoomFactor * 100}%`;
    e.style.maxWidth = zoomPct;
    e.style.maxHeight = zoomPct;
    return;
  }
  container.zoomLevel = zoom;
  // console.log(container.scrollWidth);
  container.scrollTo(posX * (container.scrollWidth  / prevScrollWidth)  - mouseX /* container.clientWidth / 2 */,
                     posY * (container.scrollHeight / prevScrollHeight) - mouseY /* container.clientHeight / 2 */);
  // let prevZoomFactor = Math.pow(2, prevZoom);
  // let zoomChg = zoomFactor / prevZoomFactor;
  // console.log(`delta = ${delta}   prevZoom = ${prevZoom}   zoom = ${zoom}   zoomFactor = ${zoomFactor}`, [container.scrollWidth, container.clientWidth, container.offsetWidth, container.naturalWidth, container.scrollLeft], zoomChg);
  // container.scrollBy(zoomChg * container.scrollWidth / posX,
  //                    zoomChg * container.scrollHeight / posY);
}

document.addEventListener("wheel", ev => {
  if (!ev.shiftKey && (ev.altKey || ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    // ev.cancelBubble = true;
    let delta = ev.wheelDeltaY ? -ev.wheelDeltaY : ev.wheelDeltaX ? -ev.wheelDeltaX : 0;
    if (delta == 0) return;
    zoomBy(delta * 0.001);
  }
}, {passive: false});

// Shows a command in a dialog
function showCommandDialog(command) {
  // Remove any existing dialog
  let dialog = document.querySelector('dialog#command-dialog');
  if (dialog) {
    dialog.remove();
  }

  // Create dialog element
  dialog = document.createElement('dialog');
  dialog.id = 'command-dialog';

  // Create dialog content
  dialog.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-header">
        <span class="dialog-title">Command</span>
        <button class="dialog-close" id="dialog-close-x">&times;</button>
      </div>
      <div class="dialog-body">
        <textarea readonly>${command}</textarea>
      </div>
      <div class="dialog-footer">
        <button id="dialog-copy" class="command-btn submit-btn" autofocus>Copy to clipboard</button>
        <button id="dialog-close">Close</button>
      </div>
    </div>
  `;

  // Add dialog to document
  document.body.appendChild(dialog);

  // Show the dialog
  dialog.showModal();

  // Set up event handlers
  document.getElementById('dialog-close-x').addEventListener('click', () => dialog.close());
  document.getElementById('dialog-close').addEventListener('click', () => dialog.close());

  // Copy command to clipboard
  document.getElementById('dialog-copy').addEventListener('click', () => {
    clipboard.writeText(command);
    updateStatusBar('Command copied to clipboard');
  });

  // Close on Escape key is handled automatically by the dialog element

  // Remove dialog when closed
  dialog.addEventListener('close', () => {
    dialog.remove();
  });
}

function showIn(ev = null, args = "") {
  historyRecall(-1, history.contentCommandHistoryEntry);
  let cmd = getCombinedCommand();
  if (!cmd || cmd.includes("-g ")) return;
  console.log(`Wrapping command: ${cmd}`);
  historyRecall(-1);
  commandInput.value = `-g ${args} *\$(${cmd} -list)`;
  console.log(`Wrapped command: ${commandInput.value}`);
  let openInNewTab_ = openInNewTab;
  openInNewTab = true;
  handleCommandSubmit(ev);
  openInNewTab = openInNewTab_; // Restore original value
}

