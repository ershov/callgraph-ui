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

// Initialize the terminal
function initializeTerminal() {
  // Set up the output listener
  window.callgraphTerminal.onCallgraphOutput((output) => {
    // Check if stderr contains status update format
    if (output.type === 'stderr') {
      updateStatusBar(output.data);
      output.data = output.data.replaceAll(statusMessageRegex, (match, p1, offset, string, groups) => {
        // console.log(match, p1, offset, string, groups);
        updateStatusBar(p1);
        return p1;
      }).trim();
      if (output.data === "") return;
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

  // Focus the input field
  commandInput.focus();
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
      updateStatus('Command sent', 'success');
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

  // Tab key indentation
  if (event.key === 'Tab') {
    event.preventDefault();

    const start = commandInput.selectionStart;
    const end = commandInput.selectionEnd;

    // Insert tab at cursor position
    commandInput.value = commandInput.value.substring(0, start) +
                          '  ' +
                          commandInput.value.substring(end);

    // Move cursor after the inserted tab
    commandInput.selectionStart = commandInput.selectionEnd = start + 2;
  }

  // Ctrl+C to interrupt running process (SIGINT)
  if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
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
function updateStatusBar(message) {
  statusBarContent.textContent = message;
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

