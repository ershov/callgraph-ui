// DOM Elements
const outputElement = document.getElementById('output');
const commandForm = document.getElementById('command-form');
const commandInput = document.getElementById('command-input');
const submitButton = document.getElementById('submit-btn');
const interruptButton = document.getElementById('interrupt-btn');
const terminateButton = document.getElementById('terminate-btn');
const statusBar = document.getElementById('status-bar');
const statusBarContent = document.getElementById('status-bar-content');

// Command history functionality
const commandHistory = [];
let historyIndex = -1;

// Status update detection regex
const statusMessageRegex = /\x1b\[K([^\r\n]*)[\r\n]/sg;
const serverStatusMessageRegex = /\n<<<<<<<<<< (.*?) >>>>>>>>>>\n/sg;

let commandOutputCapture = '';

// Global tab counter for unique IDs
let tabIdCounter = 0;

function Uint8Array_to_String(uint8Array) {
  return String.fromCharCode.apply(null, uint8Array);
}

// Initialize the terminal
function initializeTerminal() {
  // Set up the output listener
  window.callgraphTerminal.onCallgraphOutput((output) => {
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
      }).trim();
      if (output.data === "") return;
      commandOutputCapture += output.data;
      return;
    }

    // Regular output handling for non-status messages
    appendOutput(output);
  });

  // Set up form submission
  commandForm.addEventListener('submit', handleCommandSubmit);

  // Add keyboard shortcuts
  commandInput.addEventListener('keydown', handleKeyDown);

  // Set up signal buttons
  interruptButton.addEventListener('click', () => handleSignal('SIGINT'));
  terminateButton.addEventListener('click', () => handleSignal('SIGTERM'));

  // Disable the submit button button initially
  submitButton.disabled = true;

  // Focus the input field
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
}

function onServerReady(message) {
  appendOutput({
    type: 'system',
    data: `[Server ready: ${message}]\n`
  });
  submitButton.disabled = false;
}

function onServerBusy(message) {
  appendOutput({
    type: 'system',
    data: `[Server busy: ${message}]\n`
  });
  submitButton.disabled = true;
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
    default:
      return renderText(content);
  }
}

// Render PNG image
function renderPNG(content) {
  const container = document.createElement('div');
  container.className = 'content-container image-container';

  const img = document.createElement('img');
  img.src = 'data:image/png;base64,' + btoa(content);
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
  iframe.srcdoc = content;

  container.appendChild(iframe);
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
  // Don't process empty output
  if (!output || !output.trim()) return;

  createNewTab(output, `${tabIdCounter + 1}`);
}

// Create a new tab with the given output and title
function createNewTab(output, title) {
  // Increment the global ID counter for unique IDs
  tabIdCounter++;

  // Create tab elements with unique IDs
  const tabId = `tab-${tabIdCounter}`;

  // Create radio button
  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'tabs';
  radio.id = tabId;
  radio.className = 'tab-radio';

  // Create label with close button
  const label = document.createElement('label');
  label.htmlFor = tabId;
  label.className = 'tab-label';

  // Add title span
  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
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

  // Detect content type
  const contentType = detectContentType(output);
  const contentElement = renderContent(output, contentType);

  // Add the content
  panel.appendChild(contentElement);
  titleSpan.textContent = `${contentType} ${title}`;

  // Add to DOM
  const controls = document.getElementById('tab-controls');
  controls.appendChild(radio);
  controls.appendChild(label);
  controls.appendChild(panel);

  // Switch to new tab
  radio.checked = true;
  focusAppropriateElement();
}

// Close a tab and remove its elements
function closeTab(tabId) {
  const radio = document.getElementById(tabId);
  const label = radio.nextElementSibling;
  const panel = label.nextElementSibling;

  // If this tab is active, switch to terminal tab
  if (radio.checked) {
    document.getElementById('tab-terminal').checked = true;
  }

  // Remove tab elements
  radio.remove();
  label.remove();
  panel.remove();
}

// Handle form submission
function handleCommandSubmit(event) {
  event.preventDefault();

  const command = commandInput.value.trim();

  // Don't do anything if command is empty
  if (!command) {
    return;
  }

  // Add to command history
  commandHistory.unshift(command);
  if (commandHistory.length > 100) {
    commandHistory.pop(); // Limit history size
  }
  historyIndex = -1;

  // Display command with prompt
  appendCommandToOutput(command);

  // Send command to main process
  try {
    const success = window.callgraphTerminal.executeCommand(command);
    if (success) {
      // Clear input and update status
      commandInput.value = '';
      updateStatusBar('Command sent');
    } else {
      updateStatus('Failed to send command', 'error');
    }
  } catch (error) {
    console.error('Error executing command:', error);
    updateStatus('Error: ' + error.message, 'error');
  }
}

// Handle keyboard shortcuts
function handleKeyDown(event) {
  // Ctrl+Enter to submit
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    commandForm.dispatchEvent(new Event('submit'));
    return;
  }

  // Up arrow for previous command
  if (event.key === 'ArrowUp') {
    event.preventDefault();

    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      commandInput.value = commandHistory[historyIndex];

      // Move cursor to end of input
      setTimeout(() => {
        commandInput.selectionStart = commandInput.selectionEnd = commandInput.value.length;
      }, 0);
    }
    return;
  }

  // Down arrow for next command
  if (event.key === 'ArrowDown') {
    event.preventDefault();

    if (historyIndex > 0) {
      historyIndex--;
      commandInput.value = commandHistory[historyIndex];
    } else if (historyIndex === 0) {
      historyIndex = -1;
      commandInput.value = '';
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

  outputElement.appendChild(commandElement);

  // Scroll to bottom
  scrollToBottom();
}

// Append output to the terminal
function appendOutput(output) {
  const outputLine = document.createElement('div');
  outputLine.className = output.type;
  outputLine.textContent = output.data;
  outputElement.appendChild(outputLine);
  scrollToBottom();
}

// Scroll output area to bottom
function scrollToBottom() {
  outputElement.scrollTop = outputElement.scrollHeight;
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
    const success = window.callgraphTerminal.sendSignal(signalType);

    // Format friendly names for UI messages
    const signalName = signalType === 'SIGINT' ? 'Interrupt' : 'Terminate';
    const shortcutHint = signalType === 'SIGINT' ? '(Ctrl+C)' : '(Ctrl+T)';

    if (success) {
      // Visual feedback
      updateStatus(`${signalName} signal sent ${shortcutHint}`, 'success');

      // Add visual feedback in the terminal output
      appendOutput({
        type: 'system',
        data: `\n[System: ${signalName} signal (${signalType}) sent to callgraph process]\n`
      });
    } else {
      updateStatus(`Failed to send ${signalName.toLowerCase()} signal`, 'error');
    }

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

  // Ctrl+T to terminate process (SIGTERM)
  if (event.key === 't' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSignal('SIGTERM');
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

// Cache tab selection for better performance
const getTabElements = () => ({
    all: Array.from(document.querySelectorAll('.tab-radio')),
    current: document.querySelector('.tab-radio:checked'),
    terminal: document.getElementById('tab-terminal')
});

// Focus the appropriate element based on the active tab
function focusAppropriateElement() {
    const { current } = getTabElements();
    if (current.id === 'tab-terminal') {
        // Focus command input when in terminal tab
        commandInput.focus();
    } else {
        document.getElementById("tab-controls")?.focus();
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

// Tab navigation functions
function switchToNextTab() {
    const { all, current } = getTabElements();
    if (all.length <= 1) return; // Don't cycle if only terminal tab exists

    const currentIndex = all.indexOf(current);
    const nextIndex = (currentIndex + 1) % all.length;
    all[nextIndex].checked = true;
    focusAppropriateElement();
}

function switchToPreviousTab() {
    const { all, current } = getTabElements();
    if (all.length <= 1) return; // Don't cycle if only terminal tab exists

    const currentIndex = all.indexOf(current);
    const prevIndex = (currentIndex - 1 + all.length) % all.length;
    all[prevIndex].checked = true;
    focusAppropriateElement();
}

function switchToTabByNumber(number) {
    const { all } = getTabElements();
    if (number <= all.length) {
        all[number - 1].checked = true;
        focusAppropriateElement();
    }
}

function closeCurrentTab() {
    const { current, terminal } = getTabElements();
    if (current === terminal) {
        return;
    }
    closeTab(current.id);
    focusAppropriateElement();
}
