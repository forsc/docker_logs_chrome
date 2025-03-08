// Docker API client
class DockerClient {
  constructor() {
    this.baseUrl = 'http://localhost:2375';
    this.containers = [];
    this.metrics = {};
  }

  // Fetch all containers
  async getContainers() {
    try {
      const response = await fetch(`${this.baseUrl}/containers/json?all=true`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      this.containers = await response.json();
      return this.containers;
    } catch (error) {
      console.error('Error fetching containers:', error);
      throw error;
    }
  }

  // Get detailed info about a specific container
  async getContainerInfo(containerId) {
    try {
      const response = await fetch(`${this.baseUrl}/containers/${containerId}/json`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Error fetching container info for ${containerId}:`, error);
      throw error;
    }
  }

  // Get container stats (metrics)
  async getContainerStats(containerId) {
    try {
      const response = await fetch(`${this.baseUrl}/containers/${containerId}/stats?stream=false`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const stats = await response.json();
      
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
    
    // Initialize the UI
    this.initUI();
  }
  
  initUI() {
    // Make the container draggable
    this.initDraggable();
    
    // Set up event listeners
    document.getElementById('refresh-btn').addEventListener('click', () => this.refreshData());
    document.getElementById('back-btn').addEventListener('click', () => this.showContainersList());
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });
    
    // Logs search
    document.getElementById('logs-search').addEventListener('input', (e) => {
      this.filterLogs(e.target.value);
    });
    
    document.getElementById('logs-refresh').addEventListener('click', () => {
      this.loadContainerLogs(this.selectedContainerId);
    });
    
    // Initial data load
    this.refreshData();
    
    // Set up auto-refresh
    this.refreshInterval = setInterval(() => this.refreshData(), 10000);
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
    try {
      const containers = await this.dockerClient.getContainers();
      this.updateContainersList(containers);
      this.updateSystemMetrics(containers);
      this.checkContainerHealth(containers);
      
      // If a container is selected, refresh its details
      if (this.selectedContainerId) {
        try {
          // Check if the selected container still exists
          const containerExists = containers.some(c => c.Id === this.selectedContainerId);
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
        '<div class="error-message">Error connecting to Docker API. Make sure Docker is running and the API is accessible.</div>';
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
    this.selectedContainerId = containerId;
    
    try {
      // Get container info
      const info = await this.dockerClient.getContainerInfo(containerId);
      
      // Update UI with container name (with fallback)
      const containerName = info.Name ? info.Name.replace(/^\//, '') : 
                           (info.Config && info.Config.Hostname) ? info.Config.Hostname :
                           containerId.substring(0, 12);
      document.getElementById('container-name').textContent = containerName;
      
      // Show container details panel
      document.getElementById('containers-list').classList.add('hidden');
      document.getElementById('container-details').classList.remove('hidden');
      
      // Load container info tab
      this.loadContainerInfo(info);
      
      // Load container logs
      this.loadContainerLogs(containerId);
      
      // Load metrics for this container if it's running
      if (info.State.Running) {
        await this.loadContainerMetrics(containerId);
      }
      
      // Initialize or update charts
      this.initCharts(containerId);
      
      // Switch to metrics tab by default
      this.switchTab('metrics');
    } catch (error) {
      console.error(`Error loading details for ${containerId}:`, error);
      this.showAlert(`Error loading container details: ${error.message}`);
      
      // If there's an error, go back to the container list
      this.showContainersList();
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
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Deactivate all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // Activate selected tab button
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
  }
  
  // Show container list (go back from details)
  showContainersList() {
    this.selectedContainerId = null;
    document.getElementById('container-details').classList.add('hidden');
    document.getElementById('containers-list').classList.remove('hidden');
    
    // Refresh the data to ensure the container list is up-to-date
    this.refreshData();
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
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Request notification permission
  if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
  
  // Initialize Docker client and UI controller
  const dockerClient = new DockerClient();
  const uiController = new UIController(dockerClient);
}); 