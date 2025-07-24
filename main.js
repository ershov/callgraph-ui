const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { initialize, enable } = require('@electron/remote/main');

// Keep a global reference of objects to prevent garbage collection
let mainWindow = null;
let callgraphProcess = null;

// Helper function to kill the callgraph process
function killCallgraphProcess() {
  app.isQuitting = true;
  if (callgraphProcess && callgraphProcess.exitCode === null) {
    try {
      // Attempt graceful termination
      callgraphProcess.stdin.end();

      // Force kill if still running
      if (callgraphProcess.exitCode === null) {
        callgraphProcess.kill();
      }
    } catch (error) {
      console.error('Error killing callgraph process:', error);
    }
    callgraphProcess = null;
  }
}

// Helper function to find the callgraph binary path
function getCallgraphPath() {
  const fs = require('fs');

  // In development (source tree), callgraph is in bin/callgraph relative to main.js
  const developmentPath = path.join(__dirname, 'bin', 'callgraph');
  if (fs.existsSync(developmentPath)) {
    return developmentPath;
  }

  // In packaged app, callgraph should be in extraResources
  if (app.isPackaged) {
    console.log('Running in packaged mode, searching for callgraph binary...');
    // Try different possible locations for packaged apps
    const resourcesPath = process.resourcesPath;
    const possiblePaths = [
      path.join(resourcesPath, 'bin', 'callgraph'),
      path.join(resourcesPath, 'callgraph'),
      path.join(resourcesPath, '..', 'bin', 'callgraph'), // Some packaging structures
      path.join(app.getAppPath(), 'bin', 'callgraph'),
      path.join(app.getAppPath(), '..', 'bin', 'callgraph')
    ];

    console.log('Checking paths:', possiblePaths);

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        console.log(`Found callgraph binary at: ${possiblePath}`);
        return possiblePath;
      }
    }

    console.warn('Could not find callgraph binary in expected packaged locations');
  }

  // Fallback to just 'callgraph' and hope it's in PATH
  console.log('Falling back to PATH lookup for callgraph binary');
  return 'callgraph';
}// Removed redundant IPC handlers that are now handled directly in renderer via @electron/remote

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(__dirname, 'assets/icon.png'),
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {}),
    webPreferences: {
      // Security settings
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      disableBlinkFeatures: 'SmoothScrolling'
    }
  });

  // Load the HTML file
  mainWindow.loadFile('index.html');

  // Open DevTools for debugging (optional, remove in production)
  // mainWindow.webContents.openDevTools();

  // Clean up resources and quit when window is closed
  mainWindow.on('closed', () => {
    // Clean up callgraph process
    killCallgraphProcess();

    mainWindow = null;

    // Quit the app
    app.quit();
  });
}

let server_started = false;

// Initialize callgraph process
function initCallgraphProcess() {
  try {
    // Get the path to the callgraph binary
    const callgraphPath = getCallgraphPath();
    console.log(`Using callgraph binary at: ${callgraphPath}`);

    // Spawn a persistent callgraph session
    callgraphProcess = spawn(callgraphPath,
      [
        '-server',
        '-hlends',
        ...(process.env.SRC_HOME !== undefined ? ["--home", process.env.SRC_HOME] : [])
      ],
      {
        shell: false, // Don't spawn within another shell
        env: process.env // Inherit current environment variables
      }
    );

    // Handle stdout data
    callgraphProcess.stdout.on('data', (data) => {
      if (!server_started && data.includes("\n<<<<<<<<<< Server start")) {
        console.log('Callgraph server started.');
        server_started = true;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('callgraph-output', {
          type: 'stdout',
          data: data, // Buffer as Uint8Array
        });
      }
    });

    // Handle stderr data
    callgraphProcess.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('callgraph-output', {
          type: 'stderr',
          data: data, // Buffer as Uint8Array
        });
      }
    });

    // Handle process exit
    callgraphProcess.on('exit', (code, signal) => {
      console.log(`Callgraph process exited with code ${code} and signal ${signal}`);
      if (!server_started) {
        // app.quit(); // Don't quit to show error message in the UI.
        console.log('NOT restarting callgraph process since the server crashed during startup.');
        mainWindow.webContents.send('callgraph-output', {
          type: 'system',
          data: `\n[System: NOT restarting callgraph process since the server crashed during startup.]\n`
        });
        return;
      }

      // Restart callgraph process if it crashes unexpectedly
      if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
        console.log('Restarting callgraph process...');
        initCallgraphProcess();

        mainWindow.webContents.send('callgraph-output', {
          type: 'system',
          data: `\n[System: Callgraph process restarted after exiting with code ${code}]\n`
        });
      }
    });

    // Handle process errors
    callgraphProcess.on('error', (error) => {
      console.error('Failed to start callgraph process:', error);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('callgraph-output', {
          type: 'system',
          data: `\n[System Error: ${error.message}]\n`
        });
      }
    });

    console.log('Callgraph process initialized');

    // Initial welcome message
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('callgraph-output', {
        type: 'system',
        data: '[System: Callgraph session started]\n'
      });
    }
  } catch (error) {
    console.error('Error initializing callgraph process:', error);
  }
}

// Set up IPC handlers
function setupIPC() {
  // Find in page functionality
  ipcMain.on('find-in-page', (event, searchText, options) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Start or continue a find operation
      const requestId = mainWindow.webContents.findInPage(searchText, options);
      // console.log(`Find in page request: "${searchText}", requestId: ${requestId}`);
    }
  });

  ipcMain.on('stop-find-in-page', (event, action) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Stop the current find operation
      mainWindow.webContents.stopFindInPage(action || 'clearSelection');
      // console.log('Find in page stopped');
    }
  });
  // Handle command input from renderer
  ipcMain.on('execute-command', (event, command) => {
    if (callgraphProcess && callgraphProcess.stdin.writable) {
      try {
        // Write command to callgraph stdin with a newline
        callgraphProcess.stdin.write(command.replaceAll(/\n/g, "\\\n") + '\n');
      } catch (error) {
        console.error('Error writing to callgraph stdin:', error);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('callgraph-output', {
            type: 'system',
            data: `\n[System Error: Failed to send command - ${error.message}]\n`
          });
        }
      }
    } else {
      console.error('Callgraph process not available or stdin not writable');

      // Try to restart the callgraph process
      if (!callgraphProcess && !app.isQuitting) {
        initCallgraphProcess();
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('callgraph-output', {
          type: 'system',
          data: '\n[System: Callgraph process unavailable, attempting restart...]\n'
        });
      }
    }
  });

  // Handle signal request from renderer
  ipcMain.on('send-signal', (event, signal = 'SIGINT') => {
    if (callgraphProcess && callgraphProcess.exitCode === null) {
      try {
        console.log(`Sending ${signal} to callgraph process`);

        // Send the signal to the callgraph process
        const result = callgraphProcess.kill(signal);

        // Notify renderer about the result
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (result) {
            mainWindow.webContents.send('callgraph-output', {
              type: 'system',
              data: `\n[System: ${signal} signal sent to process]\n`
            });
          } else {
            mainWindow.webContents.send('callgraph-output', {
              type: 'system',
              data: `\n[System Error: Failed to send ${signal} signal]\n`
            });
          }
        }
      } catch (error) {
        console.error(`Error sending ${signal} to callgraph process:`, error);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('callgraph-output', {
            type: 'system',
            data: `\n[System Error: Failed to send ${signal} - ${error.message}]\n`
          });
        }
      }
    } else {
      console.error(`Callgraph process not available to send ${signal}`);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('callgraph-output', {
          type: 'system',
          data: '\n[System: No active callgraph process to send signal to]\n'
        });

        // Try to restart the callgraph process if it doesn't exist
        if (!callgraphProcess && !app.isQuitting) {
          initCallgraphProcess();
        }
      }
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-argv', process.argv);
  }
}

// Handle termination signals (SIGINT, SIGTERM)
const handleTerminationSignal = (signal) => {
  console.log(`Received ${signal} signal. Shutting down...`);

  killCallgraphProcess();

  app.quit();

  // Force exit after a short timeout if app.quit() doesn't exit cleanly
  //setTimeout(() => {
  //  console.log('Forcing exit after timeout');
  //  process.exit(0);
  //}, 1000);
};

// Add signal handlers
process.on('SIGINT', () => handleTerminationSignal('SIGINT'));
process.on('SIGTERM', () => handleTerminationSignal('SIGTERM'));

// Initialize app when Electron is ready
app.whenReady().then(() => {
  // Initialize remote module
  initialize();

  createWindow();

  // Enable remote module for the window
  enable(mainWindow.webContents);

  initCallgraphProcess();
  setupIPC();

  // Listen for found-in-page results
  mainWindow.webContents.on('found-in-page', (event, result) => {
    if (mainWindow && !mainWindow.isDestroyed() && result.finalUpdate) {
      // Send search results back to renderer
      mainWindow.webContents.send('found-in-page-result', result);
    }
  });

  // Re-create window on macOS when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => killCallgraphProcess());
app.on('quit', () => killCallgraphProcess());

