const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

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

// Create the main browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      // Security settings
      nodeIntegration: true,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
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

// Initialize callgraph process
function initCallgraphProcess() {
  try {
    // Spawn a persistent callgraph session
    // Use login shell to ensure consistent environment
    callgraphProcess = spawn('callgraph', ['-server', '-hlends'], {
      shell: false, // Don't spawn within another shell
      env: process.env // Inherit current environment variables
    });

    // Handle stdout data
    callgraphProcess.stdout.on('data', (data) => {
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
  createWindow();
  initCallgraphProcess();
  setupIPC();

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

