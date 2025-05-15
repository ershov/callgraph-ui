const { contextBridge, ipcRenderer } = require('electron');

// Expose a limited set of functionality to the renderer process
contextBridge.exposeInMainWorld('bashTerminal', {
  // Function to send a command to the bash process
  executeCommand: (command) => {
    if (typeof command !== 'string') {
      console.error('Invalid command format: Command must be a string');
      return false;
    }

    // Send the command to the main process
    ipcRenderer.send('execute-command', command);
    return true;
  },

  // Function to send SIGINT (Ctrl+C) to the bash process
  sendInterrupt: () => {
    // Send the SIGINT request to the main process
    ipcRenderer.send('send-sigint');
    return true;
  },

  // Function to register a callback for receiving bash output
  onBashOutput: (callback) => {
    // Ensure callback is a function
    if (typeof callback !== 'function') {
      console.error('Invalid callback: Must be a function');
      return false;
    }

    // Create a listener for bash output events
    const outputListener = (event, output) => {
      // Validate the output structure before passing to callback
      if (
        output &&
        typeof output === 'object' &&
        ['stdout', 'stderr', 'system'].includes(output.type) &&
        typeof output.data === 'string'
      ) {
        callback(output);
      } else {
        console.error('Invalid output format received:', output);
      }
    };

    // Remove any existing listeners to prevent duplicates
    ipcRenderer.removeAllListeners('bash-output');

    // Register the new listener
    ipcRenderer.on('bash-output', outputListener);

    // Return function to remove the listener when no longer needed
    return () => {
      ipcRenderer.removeListener('bash-output', outputListener);
    };
  }
});

// Log when preload script has loaded
console.log('Preload script loaded');

