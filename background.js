// Docker API client for background monitoring
class DockerMonitor {
  constructor() {
    // Default settings
    this.settings = {
      dockerApiUrl: 'http://localhost:2375',
      refreshIntervalSeconds: 30,
      showNotifications: true,
      theme: 'light'
    };
    
    // Load settings
    this.loadSettings();
    
    this.containers = [];
    this.containerStates = {};
    this.isMonitoring = false;
  }
  
  // Load settings from storage
  loadSettings() {
    chrome.storage.local.get('settings', (result) => {
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
      console.log('Background monitor settings loaded:', this.settings);
      
      // Update baseUrl from settings
      this.baseUrl = this.settings.dockerApiUrl;
      
      // Update check interval
      this.checkInterval = this.settings.refreshIntervalSeconds * 1000;
      
      // Start monitoring with new settings
      this.startMonitoring();
    });
  }

  // Start monitoring
  startMonitoring() {
    if (this.isMonitoring) {
      // If already monitoring, stop first to reset with new settings
      this.stopMonitoring();
    }
    
    this.isMonitoring = true;
    this.checkContainers();
    
    // Set up interval for regular checks
    this.monitoringInterval = setInterval(() => {
      this.checkContainers();
    }, this.checkInterval);
    
    console.log(`Docker container monitoring started with interval: ${this.checkInterval}ms`);
  }

  // Stop monitoring
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    clearInterval(this.monitoringInterval);
    this.isMonitoring = false;
    
    console.log('Docker container monitoring stopped');
  }

  // Check container states and detect changes
  async checkContainers() {
    try {
      const containers = await this.getContainers();
      
      // Check for state changes
      containers.forEach(container => {
        const id = container.Id;
        const name = container.Names[0].replace(/^\//, '');
        const currentState = container.State;
        
        // If we have a previous state for this container
        if (this.containerStates[id] !== undefined) {
          const previousState = this.containerStates[id];
          
          // If state changed
          if (previousState !== currentState) {
            // Container stopped unexpectedly
            if (previousState === 'running' && currentState === 'exited') {
              const exitInfo = container.Status.match(/Exited \((\d+)\)/);
              const exitCode = exitInfo ? exitInfo[1] : 'unknown';
              
              // Non-zero exit code indicates an error
              if (exitCode !== '0') {
                this.sendAlert(`Container ${name} stopped unexpectedly with exit code ${exitCode}`);
              }
            }
            // Container started
            else if (previousState === 'exited' && currentState === 'running') {
              this.sendAlert(`Container ${name} started`);
            }
            // Container restarting
            else if (currentState === 'restarting') {
              this.sendAlert(`Container ${name} is restarting`);
            }
          }
        }
        
        // Update state
        this.containerStates[id] = currentState;
      });
      
      // Check for removed containers
      Object.keys(this.containerStates).forEach(id => {
        if (!containers.some(c => c.Id === id)) {
          const name = id.substring(0, 12); // Use ID prefix if name is not available
          this.sendAlert(`Container ${name} was removed`);
          delete this.containerStates[id];
        }
      });
      
      // Store current containers
      this.containers = containers;
      
    } catch (error) {
      console.error('Error checking containers:', error);
      this.sendAlert(`Error monitoring Docker: ${error.message}`);
    }
  }

  // Get all containers
  async getContainers() {
    try {
      const response = await fetch(`${this.baseUrl}/containers/json?all=true`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('Error fetching containers:', error);
      throw error;
    }
  }

  // Send an alert notification
  sendAlert(message) {
    // Check if notifications are enabled in settings
    if (!this.settings.showNotifications) {
      console.log('Notification suppressed (disabled in settings):', message);
      return;
    }
    
    // Send notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'images/icon128.png',
      title: 'Docker Container Monitor',
      message: message,
      priority: 2
    });
    
    // Store alert in storage for the popup to display
    chrome.storage.local.get('alerts', (result) => {
      const alerts = result.alerts || [];
      alerts.push({
        message,
        time: new Date().toISOString()
      });
      
      // Keep only the last 20 alerts
      if (alerts.length > 20) {
        alerts.shift();
      }
      
      chrome.storage.local.set({ alerts });
    });
    
    console.log('Alert sent:', message);
  }
}

// Initialize the monitor
const dockerMonitor = new DockerMonitor();

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.settings) {
    console.log('Settings changed, reloading monitor...');
    dockerMonitor.loadSettings();
  }
});

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkContainers') {
    dockerMonitor.checkContainers();
  }
});

// Create an alarm to check containers regularly
chrome.alarms.create('checkContainers', {
  periodInMinutes: 1
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getContainers') {
    dockerMonitor.getContainers()
      .then(containers => sendResponse({ containers }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Indicates we will send a response asynchronously
  }
});

// Handle installation and updates
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Docker Container Monitor installed');
    
    // Request notification permission
    chrome.permissions.contains({ permissions: ['notifications'] }, (result) => {
      if (!result) {
        chrome.permissions.request({ permissions: ['notifications'] }, (granted) => {
          if (granted) {
            console.log('Notification permission granted');
          } else {
            console.log('Notification permission denied');
          }
        });
      }
    });
    
    // Initialize default settings
    chrome.storage.local.get('settings', (result) => {
      if (!result.settings) {
        const defaultSettings = {
          dockerApiUrl: 'http://localhost:2375',
          refreshIntervalSeconds: 30,
          showNotifications: true,
          theme: 'light'
        };
        
        chrome.storage.local.set({ settings: defaultSettings }, () => {
          console.log('Default settings initialized');
        });
      }
    });
  } else if (details.reason === 'update') {
    console.log('Docker Container Monitor updated');
  }
}); 