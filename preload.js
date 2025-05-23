const { contextBridge, ipcRenderer } = require('electron');

// Expose a limited set of functionality to the renderer process
contextBridge.exposeInMainWorld('callgraphTerminal', {
  // Function to send a command to the callgraph process
  executeCommand: (command) => {
    if (typeof command !== 'string') {
      console.error('Invalid command format: Command must be a string');
      return false;
    }

    // Send the command to the main process
    ipcRenderer.send('execute-command', command);
    return true;
  },

  // Function to send a signal to the callgraph process
  sendSignal: (signal = 'SIGINT') => {
    // Validate signal type
    if (!['SIGINT', 'SIGTERM'].includes(signal)) {
      console.error('Invalid signal type:', signal);
      console.error('Supported signals are: SIGINT, SIGTERM');
      return false;
    }

    // Send the signal request to the main process
    ipcRenderer.send('send-signal', signal);
    return true;
  },

  // Function to register a callback for receiving callgraph output
  onCallgraphOutput: (callback) => {
    // Ensure callback is a function
    if (typeof callback !== 'function') {
      console.error('Invalid callback: Must be a function');
      return false;
    }

    // Create a listener for callgraph output events
    const outputListener = (event, output) => {
      // Validate the output structure before passing to callback
      if (
        output &&
        typeof output === 'object' &&
        ['stdout', 'stderr', 'system'].includes(output.type) &&
        (typeof output.data === 'string' || Buffer.isBuffer(output.data) || Uint8Array.prototype.isPrototypeOf(output.data))
      ) {
        callback(output);
      } else {
        console.error('Invalid output format received:', output);
      }
    };

    // Remove any existing listeners to prevent duplicates
    ipcRenderer.removeAllListeners('callgraph-output');

    // Register the new listener
    ipcRenderer.on('callgraph-output', outputListener);

    // Return function to remove the listener when no longer needed
    return () => {
      ipcRenderer.removeListener('callgraph-output', outputListener);
    };
  },

  // Find in page functionality
  findInPage: (searchText, options = {}) => {
    if (typeof searchText !== 'string') {
      console.error('Invalid search text: Must be a string');
      return false;
    }

    // Default options
    const defaultOptions = {
      forward: true,
      findNext: true,
      matchCase: false
    };

    // Merge with user options
    const mergedOptions = { ...defaultOptions, ...options };

    // Send the find request to the main process
    ipcRenderer.send('find-in-page', searchText, mergedOptions);
    return true;
  },

  // Stop find in page
  stopFindInPage: (action = 'clearSelection') => {
    // Valid actions: 'clearSelection', 'keepSelection', 'activateSelection'
    const validActions = ['clearSelection', 'keepSelection', 'activateSelection'];

    if (!validActions.includes(action)) {
      console.error('Invalid action:', action);
      console.error('Supported actions are:', validActions.join(', '));
      action = 'clearSelection';
    }

    // Send the stop find request to the main process
    ipcRenderer.send('stop-find-in-page', action);
    return true;
  },

  // Register for find results
  onFoundInPage: (callback) => {
    if (typeof callback !== 'function') {
      console.error('Invalid callback: Must be a function');
      return false;
    }

    // Remove any existing listeners to prevent duplicates
    ipcRenderer.removeAllListeners('found-in-page-result');

    // Register the new listener
    ipcRenderer.on('found-in-page-result', (event, result) => {
      callback(result);
    });

    // Return function to remove the listener
    return () => {
      ipcRenderer.removeListener('found-in-page-result', callback);
    };
  }
});

// Log when preload script has loaded
console.log('Preload script loaded');

