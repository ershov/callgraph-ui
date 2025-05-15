// DOM Elements
const outputElement = document.getElementById('output');
const commandForm = document.getElementById('command-form');
const commandInput = document.getElementById('command-input');
const submitButton = document.getElementById('submit-btn');
const interruptButton = document.getElementById('interrupt-btn');
const statusElement = document.getElementById('status');

// Command history functionality
const commandHistory = [];
let historyIndex = -1;

// Initialize the terminal
function initializeTerminal() {
  // Set up the output listener
  window.bashTerminal.onBashOutput((output) => {
    appendOutput(output);
  });

  // Set up form submission
  commandForm.addEventListener('submit', handleCommandSubmit);

  // Add keyboard shortcuts
  commandInput.addEventListener('keydown', handleKeyDown);

  // Set up interrupt button
  interruptButton.addEventListener('click', handleInterrupt);

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
    const success = window.bashTerminal.executeCommand(command);
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

  // Ctrl+C to interrupt running process
  if (event.key === 'c' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleInterrupt();
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

  // Set appropriate class based on output type
  if (output.type === 'stderr') {
    outputLine.className = 'stderr';
  } else if (output.type === 'system') {
    outputLine.className = 'system';
  }

  // Set the text content
  outputLine.textContent = output.data;

  // Append to output area
  outputElement.appendChild(outputLine);

  // Scroll to bottom
  scrollToBottom();
}

// Scroll output area to bottom
function scrollToBottom() {
  outputElement.scrollTop = outputElement.scrollHeight;
}

// Update status message
function updateStatus(message, type = '') {
  statusElement.textContent = message;

  // Reset classes
  statusElement.className = 'status';

  // Add type class if specified
  if (type) {
    statusElement.classList.add(type);
  }

  // Clear status after a delay for success/error messages
  if (type === 'success' || type === 'error') {
    setTimeout(() => {
      statusElement.textContent = 'Ready';
      statusElement.className = 'status';
    }, 3000);
  }
}

// Handle interrupt button click (SIGINT / Ctrl+C)
function handleInterrupt() {
  try {
    // Temporarily disable buttons to prevent multiple signals
    interruptButton.disabled = true;

    // Send interrupt signal
    const success = window.bashTerminal.sendInterrupt();

    if (success) {
      // Visual feedback
      updateStatus('Interrupt signal sent (Ctrl+C)', 'success');

      // Add visual feedback in the terminal output
      appendOutput({
        type: 'system',
        data: '\n[System: Interrupt signal (Ctrl+C) sent to bash process]\n'
      });
    } else {
      updateStatus('Failed to send interrupt signal', 'error');
    }

    // Re-enable the button after a short delay
    setTimeout(() => {
      interruptButton.disabled = false;

      // Focus back on input
      commandInput.focus();
    }, 500);
  } catch (error) {
    console.error('Error sending interrupt:', error);
    updateStatus('Error: ' + error.message, 'error');
    interruptButton.disabled = false;
  }
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeTerminal);

