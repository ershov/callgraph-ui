const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep a global reference of objects to prevent garbage collection
let mainWindow = null;
let bashProcess = null;

// Create the main browser window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Security settings
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the HTML file
  mainWindow.loadFile('index.html');
  
  // Open DevTools for debugging (optional, remove in production)
  // mainWindow.webContents.openDevTools();

  // Clean up the window reference when it's closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize bash process
function initBashProcess() {
  try {
    // Spawn a persistent bash session
    // Use login shell to ensure consistent environment
    bashProcess = spawn('bash', ['-l'], {
      shell: false, // Don't spawn within another shell
      env: process.env // Inherit current environment variables
    });

    // Handle stdout data
    bashProcess.stdout.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash-output', {
          type: 'stdout',
          data: data.toString()
        });
      }
    });

    // Handle stderr data
    bashProcess.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash-output', {
          type: 'stderr',
          data: data.toString()
        });
      }
    });

    // Handle process exit
    bashProcess.on('exit', (code, signal) => {
      console.log(`Bash process exited with code ${code} and signal ${signal}`);
      
      // Restart bash process if it crashes unexpectedly
      if (mainWindow && !mainWindow.isDestroyed() && !app.isQuitting) {
        console.log('Restarting bash process...');
        initBashProcess();
        
        mainWindow.webContents.send('bash-output', {
          type: 'system',
          data: `\n[System: Bash process restarted after exiting with code ${code}]\n`
        });
      }
    });

    // Handle process errors
    bashProcess.on('error', (error) => {
      console.error('Failed to start bash process:', error);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash-output', {
          type: 'system',
          data: `\n[System Error: ${error.message}]\n`
        });
      }
    });

    console.log('Bash process initialized');
    
    // Initial welcome message
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('bash-output', {
        type: 'system',
        data: '[System: Bash session started]\n'
      });
    }
  } catch (error) {
    console.error('Error initializing bash process:', error);
  }
}

// Set up IPC handlers
function setupIPC() {
  // Handle command input from renderer
  ipcMain.on('execute-command', (event, command) => {
    if (bashProcess && bashProcess.stdin.writable) {
      try {
        // Write command to bash stdin with a newline
        bashProcess.stdin.write(command + '\n');
      } catch (error) {
        console.error('Error writing to bash stdin:', error);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('bash-output', {
            type: 'system',
            data: `\n[System Error: Failed to send command - ${error.message}]\n`
          });
        }
      }
    } else {
      console.error('Bash process not available or stdin not writable');
      
      // Try to restart the bash process
      if (!bashProcess && !app.isQuitting) {
        initBashProcess();
      }
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bash-output', {
          type: 'system',
          data: '\n[System: Bash process unavailable, attempting restart...]\n'
        });
      }
    }
  });
}

// Set app.isQuitting flag when quitting to prevent process restart
app.on('before-quit', () => {
  app.isQuitting = true;
});

// Initialize app when Electron is ready
app.whenReady().then(() => {
  createWindow();
  initBashProcess();
  setupIPC();

  // Re-create window on macOS when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit app when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up bash process on app quit
app.on('quit', () => {
  if (bashProcess) {
    try {
      // Attempt graceful termination first
      bashProcess.stdin.end();
      
      // Force kill if still running
      if (!bashProcess.killed) {
        bashProcess.kill();
      }
    } catch (error) {
      console.error('Error killing bash process:', error);
    }
  }
});

