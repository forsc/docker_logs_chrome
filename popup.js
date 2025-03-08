// Docker API client
class DockerClient {
  constructor() {
    // Load settings or use defaults
    this.loadSettings();
    
    // Log initialization
    console.log('DockerClient initialized with baseUrl:', this.baseUrl);
    
    // Check if Docker API is accessible
    this.checkApiAccess();
  }
  
  // Load settings from storage
  loadSettings() {
    chrome.storage.local.get('settings', (result) => {
      const settings = result.settings || {};
      this.baseUrl = settings.dockerApiUrl || 'http://localhost:2375';
      this.containers = [];
      this.metrics = {};
      
      console.log('Settings loaded:', settings);
    });
  }

  // Check if Docker API is accessible
  async checkApiAccess() {
    try {
      console.log('Checking Docker API access...');
      
      // Try both localhost and 127.0.0.1
      let response = null;
      let accessUrl = '';
      
      try {
        accessUrl = `http://localhost:2375/version?t=${Date.now()}`;
        console.log('Trying:', accessUrl);
        response = await fetch(accessUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          // Short timeout to quickly check if API is accessible
          signal: AbortSignal.timeout(2000)
        });
        
        if (response.ok) {
          this.baseUrl = 'http://localhost:2375';
          console.log('Docker API accessible at localhost:2375');
        }
      } catch (localhostError) {
        console.log('Could not access Docker API at localhost:2375:', localhostError);
        
        try {
          accessUrl = `http://127.0.0.1:2375/version?t=${Date.now()}`;
          console.log('Trying:', accessUrl);
          response = await fetch(accessUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            },
            // Short timeout to quickly check if API is accessible
            signal: AbortSignal.timeout(2000)
          });
          
          if (response.ok) {
            this.baseUrl = 'http://127.0.0.1:2375';
            console.log('Docker API accessible at 127.0.0.1:2375');
          }
        } catch (ipError) {
          console.log('Could not access Docker API at 127.0.0.1:2375:', ipError);
          throw new Error('Docker API not accessible at localhost:2375 or 127.0.0.1:2375');
        }
      }
      
      if (response && response.ok) {
        const version = await response.json();
        console.log('Docker API version:', version);
        return true;
      } else {
        throw new Error(`HTTP error! status: ${response ? response.status : 'unknown'}`);
      }
    } catch (error) {
      console.error('Error checking Docker API access:', error);
      
      // Show error message in the UI
      const containersGrid = document.getElementById('containers-grid');
      if (containersGrid) {
        containersGrid.innerHTML = `
          <div class="error-message">
            <p>Error connecting to Docker API: ${error.message}</p>
            <p>Make sure Docker is running and the API is exposed on port 2375.</p>
            <p>See the README for instructions on how to configure Docker to expose the API.</p>
            <button id="retry-btn" class="retry-btn">Retry Connection</button>
          </div>
        `;
        
        // Add event listener to retry button
        const retryBtn = document.getElementById('retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            console.log('Retry button clicked');
            this.checkApiAccess().then(success => {
              if (success) {
                // Refresh the UI if connection is successful
                const uiController = window.uiController;
                if (uiController) {
                  uiController.refreshData();
                }
              }
            });
          });
        }
      }
      
      return false;
    }
  }

  // Fetch all containers
  async getContainers() {
    try {
      console.log('Fetching containers from Docker API...');
      
      // Add a timestamp to prevent caching
      const url = `${this.baseUrl}/containers/json?all=true&t=${Date.now()}`;
      console.log('Request URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      this.containers = await response.json();
      console.log('Containers fetched:', this.containers.length);
      return this.containers;
    } catch (error) {
      console.error('Error fetching containers:', error);
      throw error;
    }
  }

  // Get detailed info about a specific container
  async getContainerInfo(containerId) {
    try {
      console.log(`Fetching info for container: ${containerId}`);
      
      const url = `${this.baseUrl}/containers/${containerId}/json?t=${Date.now()}`;
      console.log('Request URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const info = await response.json();
      console.log('Container info fetched successfully');
      return info;
    } catch (error) {
      console.error(`Error fetching container info for ${containerId}:`, error);
      throw error;
    }
  }

  // Get container stats (metrics)
  async getContainerStats(containerId) {
    try {
      console.log(`Fetching stats for container: ${containerId}`);
      
      const url = `${this.baseUrl}/containers/${containerId}/stats?stream=false&t=${Date.now()}`;
      console.log('Request URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const stats = await response.json();
      console.log('Container stats fetched successfully');
      
      // Process and store metrics
      this.metrics[containerId] = this.processStats(stats);
      return this.metrics[containerId];
    } catch (error) {
      console.error(`Error fetching stats for ${containerId}:`, error);
      throw error;
    }
  }

  // Process container stats into usable metrics
  processStats(stats) {
    // CPU usage calculation
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemCpuDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    const cpuPercent = (cpuDelta / systemCpuDelta) * cpuCount * 100;

    // Memory usage calculation
    const memoryUsage = stats.memory_stats.usage;
    const memoryLimit = stats.memory_stats.limit;
    const memoryPercent = (memoryUsage / memoryLimit) * 100;

    // Network I/O
    let networkRx = 0;
    let networkTx = 0;
    if (stats.networks) {
      Object.keys(stats.networks).forEach(iface => {
        networkRx += stats.networks[iface].rx_bytes;
        networkTx += stats.networks[iface].tx_bytes;
      });
    }

    // Block I/O
    let blockRead = 0;
    let blockWrite = 0;
    if (stats.blkio_stats && stats.blkio_stats.io_service_bytes_recursive) {
      stats.blkio_stats.io_service_bytes_recursive.forEach(stat => {
        if (stat.op === 'Read') blockRead += stat.value;
        if (stat.op === 'Write') blockWrite += stat.value;
      });
    }

    return {
      cpuPercent: cpuPercent.toFixed(2),
      memoryUsage: this.formatBytes(memoryUsage),
      memoryPercent: memoryPercent.toFixed(2),
      memoryLimit: this.formatBytes(memoryLimit),
      networkRx: this.formatBytes(networkRx),
      networkTx: this.formatBytes(networkTx),
      blockRead: this.formatBytes(blockRead),
      blockWrite: this.formatBytes(blockWrite),
      timestamp: new Date().toISOString()
    };
  }

  // Get container logs
  async getContainerLogs(containerId, tail = 100) {
    try {
      const response = await fetch(`${this.baseUrl}/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      // Docker logs are returned as a binary stream with a header for each line
      // We need to process this to get the actual log text
      const reader = response.body.getReader();
      let logs = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // Skip the first 8 bytes of each frame (Docker log header)
        // and convert the rest to text
        for (let i = 0; i < value.length; i += 8) {
          const frameSize = value[i + 4] | (value[i + 5] << 8) | (value[i + 6] << 16) | (value[i + 7] << 24);
          if (i + 8 + frameSize <= value.length) {
            logs += new TextDecoder().decode(value.slice(i + 8, i + 8 + frameSize));
          }
        }
      }
      
      return logs;
    } catch (error) {
      console.error(`Error fetching logs for ${containerId}:`, error);
      throw error;
    }
  }

  // Search container logs
  async searchContainerLogs(containerId, searchTerm, tail = 1000) {
    const logs = await this.getContainerLogs(containerId, tail);
    if (!searchTerm) return logs;
    
    const lines = logs.split('\n');
    const matchedLines = lines.filter(line => line.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchedLines.join('\n');
  }

  // Helper function to format bytes
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

// UI Controller
class UIController {
  constructor(dockerClient) {
    this.dockerClient = dockerClient;
    this.selectedContainerId = null;
    this.charts = {};
    this.metricsHistory = {};
    this.alerts = [];
    this.refreshInterval = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    
    // Default settings
    this.settings = {
      dockerApiUrl: 'http://localhost:2375',
      refreshIntervalSeconds: 10,
      showNotifications: true,
      theme: 'light'
    };
    
    // Load settings
    this.loadSettings();
    
    // Initialize the UI
    this.initUI();
    
    // Log initialization
    console.log('UIController initialized');
  }
  
  // Load settings from storage
  loadSettings() {
    chrome.storage.local.get('settings', (result) => {
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
      console.log('Settings loaded:', this.settings);
      
      // Apply theme
      this.applyTheme(this.settings.theme);
      
      // Update UI with settings
      this.updateSettingsUI();
    });
  }
  
  // Save settings to storage
  saveSettings() {
    chrome.storage.local.set({ settings: this.settings }, () => {
      console.log('Settings saved:', this.settings);
      
      // Update Docker client with new API URL
      this.dockerClient.baseUrl = this.settings.dockerApiUrl;
      
      // Update refresh interval
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
      }
      
      this.refreshInterval = setInterval(() => {
        console.log('Auto-refresh triggered');
        this.refreshData();
      }, this.settings.refreshIntervalSeconds * 1000);
      
      // Apply theme
      this.applyTheme(this.settings.theme);
    });
  }
  
  // Apply theme
  applyTheme(theme) {
    const root = document.documentElement;
    
    if (theme === 'dark') {
      root.style.setProperty('--background-color', '#1e1e1e');
      root.style.setProperty('--card-background', '#2d2d2d');
      root.style.setProperty('--text-color', '#e0e0e0');
      root.style.setProperty('--border-color', '#444444');
    } else {
      // Light theme (default)
      root.style.setProperty('--background-color', '#f5f7fa');
      root.style.setProperty('--card-background', '#ffffff');
      root.style.setProperty('--text-color', '#333333');
      root.style.setProperty('--border-color', '#e1e4e8');
    }
  }
  
  // Update settings UI
  updateSettingsUI() {
    const apiUrlInput = document.getElementById('docker-api-url');
    const refreshIntervalInput = document.getElementById('refresh-interval');
    const showAlertsCheckbox = document.getElementById('show-alerts');
    const themeSelect = document.getElementById('theme-select');
    
    if (apiUrlInput) apiUrlInput.value = this.settings.dockerApiUrl;
    if (refreshIntervalInput) refreshIntervalInput.value = this.settings.refreshIntervalSeconds;
    if (showAlertsCheckbox) showAlertsCheckbox.checked = this.settings.showNotifications;
    if (themeSelect) themeSelect.value = this.settings.theme;
  }
  
  initUI() {
    console.log('Initializing UI...');
    
    // Make the container draggable
    this.initDraggable();
    
    // Set up event listeners
    document.getElementById('refresh-btn').addEventListener('click', () => {
      console.log('Refresh button clicked');
      this.refreshData();
    });
    
    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        console.log('Settings button clicked');
        this.showSettings();
      });
    }
    
    // Settings back button
    const settingsBackBtn = document.getElementById('settings-back-btn');
    if (settingsBackBtn) {
      settingsBackBtn.addEventListener('click', () => {
        console.log('Settings back button clicked');
        this.hideSettings();
      });
    }
    
    // Save settings button
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        console.log('Save settings button clicked');
        this.saveSettingsFromUI();
      });
    }
    
    // Reset settings button
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', () => {
        console.log('Reset settings button clicked');
        this.resetSettings();
      });
    }
    
    // Test connection button
    const testConnectionBtn = document.getElementById('test-connection-btn');
    if (testConnectionBtn) {
      testConnectionBtn.addEventListener('click', () => {
        console.log('Test connection button clicked');
        this.testConnection();
      });
    }
    
    // Back button - add multiple event listeners to ensure it works
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      // Regular click event
      backBtn.addEventListener('click', (e) => {
        console.log('Back button clicked');
        e.preventDefault();
        e.stopPropagation();
        this.showContainersList();
      });
      
      // Mousedown event (more immediate)
      backBtn.addEventListener('mousedown', (e) => {
        console.log('Back button mousedown');
        e.preventDefault();
        e.stopPropagation();
      });
      
      // Mouseup event
      backBtn.addEventListener('mouseup', (e) => {
        console.log('Back button mouseup');
        e.preventDefault();
        e.stopPropagation();
        this.showContainersList();
      });
    } else {
      console.error('Back button element not found!');
    }
    
    // Backup back button
    const backupBackBtn = document.getElementById('backup-back-btn');
    if (backupBackBtn) {
      backupBackBtn.addEventListener('click', (e) => {
        console.log('Backup back button clicked');
        e.preventDefault();
        e.stopPropagation();
        this.showContainersList();
      });
    }
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        console.log(`Tab switched to: ${tabName}`);
        this.switchTab(tabName);
      });
    });
    
    // Logs search
    document.getElementById('logs-search').addEventListener('input', (e) => {
      this.filterLogs(e.target.value);
    });
    
    document.getElementById('logs-refresh').addEventListener('click', () => {
      console.log('Logs refresh button clicked');
      this.loadContainerLogs(this.selectedContainerId);
    });
    
    // Initial data load
    console.log('Loading initial data...');
    this.refreshData();
    
    // Set up auto-refresh
    this.refreshInterval = setInterval(() => {
      console.log('Auto-refresh triggered');
      this.refreshData();
    }, this.settings.refreshIntervalSeconds * 1000);
    
    console.log('UI initialization complete');
  }
  
  // Initialize draggable functionality
  initDraggable() {
    const container = document.getElementById('container');
    
    container.addEventListener('mousedown', (e) => {
      if (e.target.id === 'header' || e.target.closest('#header')) {
        this.isDragging = true;
        this.dragOffset.x = e.clientX - container.offsetLeft;
        this.dragOffset.y = e.clientY - container.offsetTop;
      }
    });
    
    document.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        container.style.left = (e.clientX - this.dragOffset.x) + 'px';
        container.style.top = (e.clientY - this.dragOffset.y) + 'px';
        container.style.position = 'absolute';
      }
    });
    
    document.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }
  
  // Refresh all data
  async refreshData() {
    console.log('Refreshing data...');
    
    // Show loading indicator
    document.getElementById('containers-grid').innerHTML = '<div class="loading">Loading containers...</div>';
    
    try {
      const containers = await this.dockerClient.getContainers();
      console.log(`Refreshed ${containers.length} containers`);
      
      this.updateContainersList(containers);
      this.updateSystemMetrics(containers);
      this.checkContainerHealth(containers);
      
      // If a container is selected, refresh its details
      if (this.selectedContainerId) {
        try {
          // Check if the selected container still exists
          const containerExists = containers.some(c => c.Id === this.selectedContainerId);
          console.log(`Selected container ${this.selectedContainerId} exists: ${containerExists}`);
          
          if (containerExists) {
            this.loadContainerDetails(this.selectedContainerId);
          } else {
            // If the container no longer exists, go back to the list
            console.log('Selected container no longer exists, returning to list view');
            this.showContainersList();
          }
        } catch (detailsError) {
          console.error('Error refreshing container details:', detailsError);
          // Don't show an alert here as it might be too noisy
        }
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
      this.showAlert('Error connecting to Docker API: ' + error.message);
      
      // Clear the containers grid to indicate there's a problem
      document.getElementById('containers-grid').innerHTML = 
        `<div class="error-message">
          <p>Error connecting to Docker API: ${error.message}</p>
          <p>Make sure Docker is running and the API is accessible at ${this.dockerClient.baseUrl}.</p>
          <p>Check that Docker API is exposed on port 2375 (see README for instructions).</p>
          <button id="retry-btn" class="retry-btn">Retry Connection</button>
        </div>`;
      
      // Add event listener to retry button
      document.getElementById('retry-btn').addEventListener('click', () => {
        console.log('Retry button clicked');
        this.refreshData();
      });
    }
  }
  
  // Update the containers list in the UI
  updateContainersList(containers) {
    const containersGrid = document.getElementById('containers-grid');
    containersGrid.innerHTML = '';
    
    if (containers.length === 0) {
      containersGrid.innerHTML = '<div class="no-containers">No containers found</div>';
      return;
    }
    
    containers.forEach(container => {
      const card = document.createElement('div');
      card.className = 'container-card';
      card.dataset.id = container.Id;
      
      const name = container.Names[0].replace(/^\//, '');
      const status = container.State;
      const statusClass = status === 'running' ? 'status-running' : 
                          status === 'exited' ? 'status-stopped' : 'status-restarting';
      
      card.innerHTML = `
        <div class="container-name">${name}</div>
        <div class="container-status ${statusClass}">${status}</div>
        <div class="container-image">${container.Image}</div>
        <div class="container-metrics">
          <div class="container-metric">
            <span class="metric-label">CPU</span>
            <span class="metric-value" id="cpu-${container.Id}">-</span>
          </div>
          <div class="container-metric">
            <span class="metric-label">Memory</span>
            <span class="metric-value" id="mem-${container.Id}">-</span>
          </div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        this.loadContainerDetails(container.Id);
      });
      
      containersGrid.appendChild(card);
      
      // Load metrics for this container
      if (status === 'running') {
        this.loadContainerMetrics(container.Id);
      }
    });
    
    // Update counters
    document.getElementById('total-containers').textContent = containers.length;
    document.getElementById('running-containers').textContent = containers.filter(c => c.State === 'running').length;
  }
  
  // Load metrics for a specific container
  async loadContainerMetrics(containerId) {
    try {
      const metrics = await this.dockerClient.getContainerStats(containerId);
      
      // Update the card metrics
      const cpuElement = document.getElementById(`cpu-${containerId}`);
      const memElement = document.getElementById(`mem-${containerId}`);
      
      if (cpuElement) cpuElement.textContent = `${metrics.cpuPercent}%`;
      if (memElement) memElement.textContent = metrics.memoryUsage;
      
      // Store metrics history for charts
      if (!this.metricsHistory[containerId]) {
        this.metricsHistory[containerId] = {
          cpu: [],
          memory: [],
          network: { rx: [], tx: [] },
          disk: { read: [], write: [] },
          timestamps: []
        };
      }
      
      const history = this.metricsHistory[containerId];
      history.cpu.push(parseFloat(metrics.cpuPercent));
      history.memory.push(parseFloat(metrics.memoryPercent));
      history.network.rx.push(metrics.networkRx);
      history.network.tx.push(metrics.networkTx);
      history.disk.read.push(metrics.blockRead);
      history.disk.write.push(metrics.blockWrite);
      history.timestamps.push(new Date());
      
      // Keep only the last 20 data points
      if (history.cpu.length > 20) {
        history.cpu.shift();
        history.memory.shift();
        history.network.rx.shift();
        history.network.tx.shift();
        history.disk.read.shift();
        history.disk.write.shift();
        history.timestamps.shift();
      }
      
      // Update charts if this is the selected container
      if (this.selectedContainerId === containerId) {
        this.updateCharts(containerId);
      }
      
      return metrics;
    } catch (error) {
      console.error(`Error loading metrics for ${containerId}:`, error);
    }
  }
  
  // Update system-wide metrics
  updateSystemMetrics(containers) {
    const runningContainers = containers.filter(c => c.State === 'running');
    
    // Calculate total CPU and memory usage
    let totalCpu = 0;
    let totalMemory = 0;
    
    runningContainers.forEach(container => {
      const metrics = this.dockerClient.metrics[container.Id];
      if (metrics) {
        totalCpu += parseFloat(metrics.cpuPercent);
        totalMemory += parseFloat(metrics.memoryPercent);
      }
    });
    
    // Update UI
    document.getElementById('total-cpu').textContent = `${totalCpu.toFixed(2)}%`;
    document.getElementById('total-memory').textContent = `${totalMemory.toFixed(2)}%`;
  }
  
  // Load detailed information for a container
  async loadContainerDetails(containerId) {
    console.log(`Loading details for container: ${containerId}`);
    
    // Store the selected container ID
    this.selectedContainerId = containerId;
    
    try {
      // Get container info
      const info = await this.dockerClient.getContainerInfo(containerId);
      console.log('Container info loaded successfully');
      
      // Update UI with container name (with fallback)
      const containerName = info.Name ? info.Name.replace(/^\//, '') : 
                           (info.Config && info.Config.Hostname) ? info.Config.Hostname :
                           containerId.substring(0, 12);
      
      const nameElement = document.getElementById('container-name');
      if (nameElement) {
        nameElement.textContent = containerName;
        console.log(`Container name set to: ${containerName}`);
      }
      
      // Direct DOM manipulation to ensure views are properly toggled
      try {
        // Force hide containers list view using direct style manipulation
        const listView = document.getElementById('containers-list');
        if (listView) {
          listView.classList.add('hidden');
          listView.style.display = 'none';
          console.log('Containers list view hidden (direct style)');
        }
        
        // Force show container details panel using direct style manipulation
        const detailsView = document.getElementById('container-details');
        if (detailsView) {
          detailsView.classList.remove('hidden');
          detailsView.style.display = 'flex';
          console.log('Container details view shown (direct style)');
        }
      } catch (viewError) {
        console.error('Error toggling views:', viewError);
      }
      
      // Load container info tab
      this.loadContainerInfo(info);
      
      // Load container logs
      this.loadContainerLogs(containerId);
      
      // Load metrics for this container if it's running
      if (info.State && info.State.Running) {
        await this.loadContainerMetrics(containerId);
      }
      
      // Initialize or update charts
      this.initCharts(containerId);
      
      // Switch to metrics tab by default
      this.switchTab('metrics');
      
      console.log('Container details loaded successfully');
      return true;
    } catch (error) {
      console.error(`Error loading details for ${containerId}:`, error);
      this.showAlert(`Error loading container details: ${error.message}`);
      
      // If there's an error, go back to the container list
      this.showContainersList();
      return false;
    }
  }
  
  // Load container info tab
  loadContainerInfo(info) {
    const infoContainer = document.getElementById('container-info');
    infoContainer.innerHTML = '';
    
    const infoItems = [
      { label: 'ID', value: info.Id.substring(0, 12) },
      { label: 'Name', value: info.Name.replace(/^\//, '') },
      { label: 'Image', value: info.Config.Image },
      { label: 'Created', value: new Date(info.Created).toLocaleString() },
      { label: 'Status', value: info.State.Status },
      { label: 'Platform', value: `${info.Platform || 'Unknown'} ${info.Architecture || ''}` },
      { label: 'Ports', value: this.formatPorts(info.NetworkSettings.Ports) },
      { label: 'Volumes', value: this.formatVolumes(info.Mounts) },
      { label: 'Environment', value: this.formatEnv(info.Config.Env) }
    ];
    
    infoItems.forEach(item => {
      const row = document.createElement('div');
      row.className = 'info-row';
      row.innerHTML = `
        <div class="info-label">${item.label}</div>
        <div class="info-value">${item.value}</div>
      `;
      infoContainer.appendChild(row);
    });
  }
  
  // Format ports for display
  formatPorts(ports) {
    if (!ports || Object.keys(ports).length === 0) return 'None';
    
    return Object.entries(ports)
      .map(([internal, external]) => {
        if (!external) return `${internal} (not published)`;
        return `${external[0].HostPort}:${internal}`;
      })
      .join('<br>');
  }
  
  // Format volumes for display
  formatVolumes(mounts) {
    if (!mounts || mounts.length === 0) return 'None';
    
    return mounts
      .map(mount => `${mount.Source} → ${mount.Destination}`)
      .join('<br>');
  }
  
  // Format environment variables for display
  formatEnv(env) {
    if (!env || env.length === 0) return 'None';
    
    return env
      .map(e => e.replace(/=.*/, '=***')) // Hide values for security
      .join('<br>');
  }
  
  // Load container logs
  async loadContainerLogs(containerId) {
    try {
      const logsElement = document.getElementById('logs-content');
      logsElement.textContent = 'Loading logs...';
      
      const lines = document.getElementById('logs-lines').value;
      const logs = await this.dockerClient.getContainerLogs(containerId, lines);
      
      logsElement.textContent = logs || 'No logs available';
      
      // Apply any existing filter
      const searchTerm = document.getElementById('logs-search').value;
      if (searchTerm) {
        this.filterLogs(searchTerm);
      }
    } catch (error) {
      console.error(`Error loading logs for ${containerId}:`, error);
      document.getElementById('logs-content').textContent = `Error loading logs: ${error.message}`;
    }
  }
  
  // Filter logs based on search term
  filterLogs(searchTerm) {
    const logsElement = document.getElementById('logs-content');
    const lines = logsElement.textContent.split('\n');
    
    if (!searchTerm) {
      // If search term is empty, show all lines
      logsElement.textContent = lines.join('\n');
      return;
    }
    
    const matchedLines = lines.filter(line => 
      line.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    logsElement.textContent = matchedLines.length > 0 
      ? matchedLines.join('\n') 
      : `No logs matching "${searchTerm}"`;
  }
  
  // Initialize charts for container metrics
  initCharts(containerId) {
    // For a real implementation, you would use a charting library like Chart.js
    // For this example, we'll create simple placeholder charts
    
    const chartContainers = [
      { id: 'cpu-chart', title: 'CPU Usage (%)', dataKey: 'cpu' },
      { id: 'memory-chart', title: 'Memory Usage (%)', dataKey: 'memory' },
      { id: 'network-chart', title: 'Network I/O', dataKey: 'network' },
      { id: 'disk-chart', title: 'Disk I/O', dataKey: 'disk' }
    ];
    
    chartContainers.forEach(chart => {
      const canvas = document.getElementById(chart.id);
      if (canvas) {
        // Clear any existing content
        canvas.innerHTML = '';
        
        // Create a simple placeholder chart
        const chartPlaceholder = document.createElement('div');
        chartPlaceholder.className = 'chart-placeholder';
        chartPlaceholder.innerHTML = `
          <h4>${chart.title}</h4>
          <div class="chart-data" id="${chart.id}-data"></div>
        `;
        canvas.appendChild(chartPlaceholder);
      }
    });
    
    // Update charts with current data
    this.updateCharts(containerId);
  }
  
  // Update charts with new data
  updateCharts(containerId) {
    // Make sure we have metrics history for this container
    if (!this.metricsHistory[containerId]) {
      console.log('No metrics history available for container:', containerId);
      return;
    }
    
    const history = this.metricsHistory[containerId];
    
    // Update each chart with the latest data
    const cpuChart = document.getElementById('cpu-chart-data');
    if (cpuChart && history.cpu.length > 0) {
      cpuChart.textContent = `Current: ${history.cpu[history.cpu.length - 1]}%`;
    }
    
    const memoryChart = document.getElementById('memory-chart-data');
    if (memoryChart && history.memory.length > 0) {
      memoryChart.textContent = `Current: ${history.memory[history.memory.length - 1]}%`;
    }
    
    const networkChart = document.getElementById('network-chart-data');
    if (networkChart && history.network.rx.length > 0) {
      networkChart.textContent = `RX: ${history.network.rx[history.network.rx.length - 1]} | TX: ${history.network.tx[history.network.tx.length - 1]}`;
    }
    
    const diskChart = document.getElementById('disk-chart-data');
    if (diskChart && history.disk.read.length > 0) {
      diskChart.textContent = `Read: ${history.disk.read[history.disk.read.length - 1]} | Write: ${history.disk.write[history.disk.write.length - 1]}`;
    }
    
    console.log('Updated charts with data for container:', containerId);
  }
  
  // Switch between tabs in container details
  switchTab(tabName) {
    console.log(`Switching to tab: ${tabName}`);
    
    try {
      // Hide all tabs
      const tabContents = document.querySelectorAll('.tab-content');
      if (tabContents.length > 0) {
        tabContents.forEach(tab => {
          tab.classList.remove('active');
        });
        console.log('All tabs hidden');
      } else {
        console.warn('No tab content elements found');
      }
      
      // Deactivate all tab buttons
      const tabButtons = document.querySelectorAll('.tab-btn');
      if (tabButtons.length > 0) {
        tabButtons.forEach(btn => {
          btn.classList.remove('active');
        });
        console.log('All tab buttons deactivated');
      } else {
        console.warn('No tab button elements found');
      }
      
      // Show selected tab
      const selectedTab = document.getElementById(`${tabName}-tab`);
      if (selectedTab) {
        selectedTab.classList.add('active');
        console.log(`Tab ${tabName} activated`);
      } else {
        console.warn(`Tab element ${tabName}-tab not found`);
      }
      
      // Activate selected tab button
      const selectedButton = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
      if (selectedButton) {
        selectedButton.classList.add('active');
        console.log(`Tab button for ${tabName} activated`);
      } else {
        console.warn(`Tab button for ${tabName} not found`);
      }
    } catch (error) {
      console.error('Error switching tabs:', error);
    }
  }
  
  // Show container list (go back from details)
  showContainersList() {
    console.log('Showing containers list view (back button pressed)');
    
    // Clear the selected container ID
    this.selectedContainerId = null;
    
    // Reset container name display
    document.getElementById('container-name').textContent = 'Container Name';
    
    // Direct DOM manipulation to ensure views are properly toggled
    try {
      // Force hide container details view using direct style manipulation
      const detailsView = document.getElementById('container-details');
      if (detailsView) {
        detailsView.classList.add('hidden');
        detailsView.style.display = 'none';
        console.log('Container details view hidden (direct style)');
      }
      
      // Force show containers list view using direct style manipulation
      const listView = document.getElementById('containers-list');
      if (listView) {
        listView.classList.remove('hidden');
        listView.style.display = 'block';
        console.log('Containers list view shown (direct style)');
      }
      
      // Force a complete refresh of the data
      setTimeout(() => {
        console.log('Refreshing data after back button press');
        this.refreshData();
      }, 100);
    } catch (error) {
      console.error('Error in showContainersList:', error);
      
      // Fallback approach - reload the extension
      console.log('Using fallback approach to return to list view');
      window.location.reload();
    }
  }
  
  // Check container health and show alerts
  checkContainerHealth(containers) {
    // Check for containers that have stopped unexpectedly
    containers.forEach(container => {
      if (container.State === 'exited' && container.Status.includes('Exited (')) {
        const exitCode = container.Status.match(/Exited \((\d+)\)/);
        if (exitCode && exitCode[1] !== '0') {
          this.showAlert(`Container ${container.Names[0]} exited with code ${exitCode[1]}`);
        }
      }
    });
  }
  
  // Show an alert
  showAlert(message) {
    const alertsList = document.getElementById('alerts-list');
    const alertItem = document.createElement('div');
    alertItem.className = 'alert-item';
    
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    
    alertItem.innerHTML = `
      <div class="alert-message">${message}</div>
      <div class="alert-time">${timeString}</div>
    `;
    
    alertsList.appendChild(alertItem);
    
    // Store alert
    this.alerts.push({
      message,
      time: now
    });
    
    // Keep only the last 10 alerts
    if (this.alerts.length > 10) {
      this.alerts.shift();
      if (alertsList.children.length > 10) {
        alertsList.removeChild(alertsList.children[0]);
      }
    }
    
    // Show desktop notification
    this.showNotification(message);
  }
  
  // Show desktop notification
  showNotification(message) {
    // Check if notifications are enabled in settings
    if (!this.settings.showNotifications) {
      console.log('Notification suppressed (disabled in settings):', message);
      return;
    }
    
    if (Notification.permission === 'granted') {
      new Notification('Docker Container Monitor', {
        body: message,
        icon: 'images/icon128.png'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification('Docker Container Monitor', {
            body: message,
            icon: 'images/icon128.png'
          });
        }
      });
    }
  }
  
  // Show settings panel
  showSettings() {
    console.log('Showing settings panel');
    
    // Update settings UI with current values
    this.updateSettingsUI();
    
    // Hide other views
    document.getElementById('containers-list').classList.add('hidden');
    document.getElementById('container-details').classList.add('hidden');
    
    // Show settings panel
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.classList.remove('hidden');
      settingsPanel.style.display = 'flex';
    }
  }
  
  // Hide settings panel
  hideSettings() {
    console.log('Hiding settings panel');
    
    // Hide settings panel
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.classList.add('hidden');
      settingsPanel.style.display = 'none';
    }
    
    // Show containers list
    const listView = document.getElementById('containers-list');
    if (listView) {
      listView.classList.remove('hidden');
      listView.style.display = 'block';
    }
  }
  
  // Save settings from UI
  saveSettingsFromUI() {
    const apiUrlInput = document.getElementById('docker-api-url');
    const refreshIntervalInput = document.getElementById('refresh-interval');
    const showAlertsCheckbox = document.getElementById('show-alerts');
    const themeSelect = document.getElementById('theme-select');
    
    // Update settings object
    if (apiUrlInput) this.settings.dockerApiUrl = apiUrlInput.value;
    if (refreshIntervalInput) this.settings.refreshIntervalSeconds = parseInt(refreshIntervalInput.value);
    if (showAlertsCheckbox) this.settings.showNotifications = showAlertsCheckbox.checked;
    if (themeSelect) this.settings.theme = themeSelect.value;
    
    // Save settings
    this.saveSettings();
    
    // Show success message
    this.showAlert('Settings saved successfully');
    
    // Hide settings panel
    this.hideSettings();
    
    // Refresh data with new settings
    this.refreshData();
  }
  
  // Reset settings to default
  resetSettings() {
    console.log('Resetting settings to default');
    
    // Reset to default values
    this.settings = {
      dockerApiUrl: 'http://localhost:2375',
      refreshIntervalSeconds: 10,
      showNotifications: true,
      theme: 'light'
    };
    
    // Update UI
    this.updateSettingsUI();
    
    // Save settings
    this.saveSettings();
    
    // Show success message
    this.showAlert('Settings reset to default');
  }
  
  // Test Docker API connection
  async testConnection() {
    const apiUrlInput = document.getElementById('docker-api-url');
    const connectionStatus = document.getElementById('connection-status');
    
    if (!apiUrlInput || !connectionStatus) return;
    
    const apiUrl = apiUrlInput.value;
    connectionStatus.textContent = 'Testing connection...';
    connectionStatus.className = '';
    
    try {
      console.log(`Testing connection to ${apiUrl}`);
      
      const response = await fetch(`${apiUrl}/version`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const version = await response.json();
        connectionStatus.textContent = `Connected! Docker ${version.Version}`;
        connectionStatus.className = 'connection-success';
        console.log('Connection test successful:', version);
      } else {
        connectionStatus.textContent = `Error: ${response.status} ${response.statusText}`;
        connectionStatus.className = 'connection-error';
        console.error('Connection test failed:', response.status, response.statusText);
      }
    } catch (error) {
      connectionStatus.textContent = `Error: ${error.message}`;
      connectionStatus.className = 'connection-error';
      console.error('Connection test error:', error);
    }
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing Docker Container Monitor...');
  
  // Request notification permission
  if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      console.log('Notification permission:', permission);
    });
  }
  
  // Initialize Docker client and UI controller
  const dockerClient = new DockerClient();
  const uiController = new UIController(dockerClient);
  
  // Store UI controller in window for access from other methods
  window.uiController = uiController;
  
  // Add global error handler
  window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', message, 'at', source, lineno, colno, error);
    return false;
  };
  
  console.log('Docker Container Monitor initialized');
}); 